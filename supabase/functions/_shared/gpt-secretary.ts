import { formatZoned, fromZonedWall, parseBrazilianDateTimeParts, zonedYmd, normalizeText, safeTz } from "./brazil.ts";
import { notifyStudioStaff } from "./staff-alert.ts";
import { type Locale, msg, safeLocale } from "./messages.ts";
import { depositFor, flagHuman, notifyWaitlist } from "./sales.ts";
import { describeDay, describeWeek, isWithinBusinessHours, normalizeBusinessHours, windowForYmd } from "./hours.ts";

type Sb = { from: (table: string) => any };

function fuzzyProcedure(n: string, procedures: { id: string; name: string; price: number; duration: number }[]) {
  const q = normalizeText(n);
  return procedures.find((p) => {
    const pn = normalizeText(p.name);
    if (!pn) return false;
    if (q.includes(pn) || pn.includes(q)) return true;
    const words = pn.split(/\s+/).filter((w) => w.length > 3);
    return words.length > 0 && words.every((w) => q.includes(w));
  }) || null;
}

async function slotTaken(supabase: Sb, studioId: string, start: Date, end: Date, professionalId: string | null, ignoreId?: string) {
  const { data } = await supabase.from("appointments")
    .select("id, professional_id")
    .eq("studio_id", studioId)
    .neq("status", "cancelled")
    .lt("start_time", end.toISOString())
    .gt("end_time", start.toISOString());
  return (data || []).some((a) => {
    if (a.id === ignoreId) return false;
    if (!professionalId) return true;
    return !a.professional_id || a.professional_id === professionalId;
  });
}

async function pickFreeProfessional(supabase: Sb, studioId: string, start: Date, end: Date, ignoreId?: string) {
  const { data: profs } = await supabase.from("professionals").select("id, name").eq("studio_id", studioId).eq("active", true).order("name");
  for (const p of profs || []) {
    if (!(await slotTaken(supabase, studioId, start, end, p.id, ignoreId))) return p;
  }
  return null;
}

type DayApt = { id: string; professional_id: string | null; start: number; end: number };

// Loads one day's appointments and the active professionals ONCE, so checking
// ~20 candidate times is done in memory instead of ~20 × N queries.
async function loadDayAgenda(supabase: Sb, studioId: string, ymd: string, tz: string) {
  const from = fromZonedWall(ymd, 0, 0, tz);
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  const [{ data: apts }, { data: profs }] = await Promise.all([
    supabase.from("appointments").select("id, professional_id, start_time, end_time")
      .eq("studio_id", studioId).neq("status", "cancelled")
      .lt("start_time", to.toISOString()).gt("end_time", from.toISOString()),
    supabase.from("professionals").select("id, name").eq("studio_id", studioId).eq("active", true).order("name"),
  ]);
  const dayApts: DayApt[] = (apts || []).map((a: { id: string; professional_id: string | null; start_time: string; end_time: string }) => ({
    id: a.id, professional_id: a.professional_id, start: new Date(a.start_time).getTime(), end: new Date(a.end_time).getTime(),
  }));
  return { apts: dayApts, profs: (profs || []) as { id: string; name: string }[] };
}

// Same rule as slotTaken/pickFreeProfessional: with professionals, the slot is free
// if one of them has nothing overlapping (an appointment without professional
// blocks everyone); without professionals, any overlap blocks the slot.
function isFreeInMemory(day: { apts: DayApt[]; profs: { id: string }[] }, start: Date, end: Date) {
  const s = start.getTime();
  const e = end.getTime();
  const overlapping = day.apts.filter((a) => a.start < e && a.end > s);
  if (day.profs.length === 0) return overlapping.length === 0;
  return day.profs.some((p) => !overlapping.some((a) => !a.professional_id || a.professional_id === p.id));
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_catalog",
      description: "Lista procedimentos, preços, endereço e telefone reais do studio.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_appointments",
      description: "Lista os próximos agendamentos desta cliente.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "save_client_name",
      description: "Salva o nome da cliente quando ela se apresenta.",
      parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_available_slots",
      description: "Lista horários LIVRES de um dia. Use quando a cliente perguntar o que tem, disponibilidade, vagas. NUNCA marca horário. Só lista.",
      parameters: {
        type: "object",
        properties: {
          day_text: { type: "string", description: "Dia no formato AAAA-MM-DD (ou em palavras: hoje, amanhã, sexta, 22/10)" },
          procedure_name: { type: "string", description: "Procedimento se já souber, para usar a duração certa" },
        },
        required: ["day_text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "book_appointment",
      description: "SÓ marca depois que a cliente escolher UM horário e disser que quer esse (pode ser, marca esse, quero esse, pode sim). Perguntar 'que horas tem' NÃO é permissão para marcar.",
      parameters: {
        type: "object",
        properties: {
          procedure_name: { type: "string" },
          when_text: { type: "string", description: "O horário que a CLIENTE escolheu, no formato AAAA-MM-DD HH:MM (ex: 2026-11-12 14:00)" },
          client_confirmed: { type: "boolean", description: "true só se ela aceitou explicitamente esse horário" },
        },
        required: ["procedure_name", "when_text", "client_confirmed"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_appointment",
      description: "Cancela um horário futuro da cliente. Antes, PERGUNTE qual horário e se ela quer mesmo cancelar; só chame com client_confirmed=true depois do 'sim' dela. Sem id, cancela o próximo.",
      parameters: {
        type: "object",
        properties: {
          appointment_id: { type: "string" },
          client_confirmed: { type: "boolean", description: "true só depois que ela confirmou o cancelamento" },
        },
        required: ["client_confirmed"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reschedule_appointment",
      description: "Remarca o próximo horário da cliente (ou o do appointment_id) para um novo dia/hora que ELA escolheu. Só com client_confirmed=true.",
      parameters: {
        type: "object",
        properties: {
          appointment_id: { type: "string" },
          new_when_text: { type: "string", description: "Novo horário no formato AAAA-MM-DD HH:MM" },
          client_confirmed: { type: "boolean" },
        },
        required: ["new_when_text", "client_confirmed"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_human",
      description: "Chama uma pessoa da equipe. Use para: dúvida de saúde ou diagnóstico, reação alérgica ou dor após procedimento, reclamação, pedido de desconto/negociação, ou quando você não souber responder. Depois diga à cliente, com cuidado, que alguém da equipe vai falar com ela.",
      parameters: { type: "object", properties: { reason: { type: "string", description: "Resumo curto do motivo" } }, required: ["reason"] },
    },
  },
  {
    type: "function",
    function: {
      name: "join_waitlist",
      description: "Coloca a cliente na lista de espera de um dia que está sem vaga. Use quando ela quiser um dia lotado e aceitar ser avisada se abrir horário.",
      parameters: {
        type: "object",
        properties: {
          day_text: { type: "string", description: "Dia no formato AAAA-MM-DD" },
          procedure_name: { type: "string" },
        },
        required: ["day_text"],
      },
    },
  },
];

export async function runGptSecretary(opts: {
  apiKey: string;
  model: string;
  supabase: Sb;
  studioId: string;
  clientId: string;
  convId: string;
  userText: string;
  history: { role: "user" | "assistant"; content: string }[];
  personalidade?: string;
  tomVoz?: string;
  customMessages?: { trigger?: string; label?: string; message?: string; enabled?: boolean }[];
  patterns?: { label?: string; keywords?: string[]; response?: string; enabled?: boolean }[];
}): Promise<string | null> {
  const { apiKey, model, supabase, studioId, clientId, convId, userText, history } = opts;
  const { data: studio } = await supabase.from("studios").select("name, address, phone, business_hours, timezone, locale, booking_mode, deposit_percent, pix_key").eq("id", studioId).maybeSingle();
  const needsApproval = studio?.booking_mode === "approval";
  const hours = normalizeBusinessHours(studio?.business_hours);
  const tz = safeTz(studio?.timezone);
  const L: Locale = safeLocale(studio?.locale);
  // What the owner wrote in the SecretarIA screen (fixed messages + keyword
  // answers) becomes guidance for GPT, so the customisation is not lost when GPT is on.
  // Scheduling/confirm/cancel templates are left out: tools handle those.
  const SKIP = new Set(["scheduling", "confirm", "cancel", "fallback"]);
  const guidanceLines = [
    ...(opts.customMessages || [])
      .filter((m) => m.enabled && m.message && !SKIP.has(String(m.trigger || "")))
      .map((m) => `- ${m.label || m.trigger}: ${String(m.message).slice(0, 300)}`),
    ...(opts.patterns || [])
      .filter((p) => p.enabled && p.response && !SKIP.has(String((p as { trigger?: string }).trigger || "")))
      .map((p) => `- Quando falarem de ${(p.keywords || []).slice(0, 4).join(", ") || p.label}: ${String(p.response).slice(0, 300)}`),
  ].slice(0, 20);
  const studioGuidance = guidanceLines.length
    ? `\n\nO que o studio escreveu para você usar (siga o conteúdo, mas com suas palavras; preço, vaga e endereço reais continuam vindo das ferramentas):\n${guidanceLines.join("\n")}`
    : "";
  const { data: clientRow } = await supabase.from("clients").select("name").eq("id", clientId).maybeSingle();
  const clientName = clientRow?.name && !/^\d+$/.test(clientRow.name) ? clientRow.name : "";
  const firstName = clientName.split(/\s+/)[0] || "";
  const tom = (opts.tomVoz || "amigavel").toLowerCase();
  const persona = (opts.personalidade || "atenciosa").toLowerCase();
  const tomHint = tom.includes("formal")
    ? "Você um pouco mais educada, mas ainda WhatsApp — sem 'prezada' e sem parágrafo de e-mail."
    : tom.includes("descontra") || tom.includes("divert")
      ? "Bem leve, como amiga do studio. Sem exagerar em kkk ou gíria forçada."
      : "Calorosa e simples, como recepção que já conhece a cliente.";

  const systemEs = `Eres la chica que atiende el WhatsApp de ${studio?.name || "el estudio"}, no un chatbot. Te escriben personas reales en medio del día, a veces con errores, audios transcritos o mensajes cortos.

Quién te escribe: ${firstName || "todavía no dijo su nombre"}.
Personalidad del estudio: ${persona}. ${tom.includes("formal")
    ? "Un poco más formal, pero sigue siendo WhatsApp: nada de 'estimada' ni párrafos de correo."
    : tom.includes("descontra") || tom.includes("divert")
      ? "Muy ligera, como una amiga del estudio. Sin exagerar con jajaja ni jerga forzada."
      : "Cálida y sencilla, como una recepcionista que ya conoce a la clienta."}
Ahora (hora del estudio): ${formatZoned(new Date(), tz)}.

RESPONDE SIEMPRE EN ESPAÑOL neutro (latinoamericano), aunque te escriban en otro idioma.

Cómo hablar:
- Mensajes cortos, 1–3 frases. Una sola pregunta.
- Español de todos los días. NO hables como call center ("quedo a tu disposición", "¿en qué puedo ayudarle?", "¡te esperamos!").
- No empieces cada turno con Hola / ¿Cómo estás? Si la conversación ya empezó, continúa.
- Usa el nombre de pila solo de vez en cuando.
- Máximo 1 emoji, y solo si encaja. Cero emojis también está muy bien.
- Horarios: habla como persona ("en la mañana tengo 10 y 11, en la tarde 14 y 16, ¿cuál te queda mejor?"), nunca una lista de 10 opciones.
- Precio: un número y una pregunta ("sale 280, ¿te busco un horario?").
- Si solo saluda, responde el saludo y pregunta qué necesita, sin menú.

Agenda (no negociable):
- Pide turno / horarios → list_available_slots, ofrece de 2 a 4 opciones y ESPERA que elija. No reserves.
- book_appointment solo con client_confirmed=true después de que elija ("dale, a las 14", "ese me sirve").
- En when_text y day_text escribe SIEMPRE la fecha en formato AAAA-MM-DD HH:MM (o AAAA-MM-DD para un día).
- Si no sabes el procedimiento o el momento del día (mañana/tarde/día), pregúntalo primero.
- Nunca inventes precio, horario disponible ni dirección. Usa las herramientas.
- Solo cancela si ella lo pide, y después de confirmar.
- Para cambiar de horario usa reschedule_appointment (no canceles y reserves de nuevo).
- Si book_appointment devuelve aguardando_aprovacao, di que quedó prerreservado y que el equipo lo confirma. Nunca digas "confirmado" en ese caso.
- Si viene "sinal", informa el monto de la seña y la clave Pix, y pide el comprobante.
- Día sin lugar: ofrece otro día o la lista de espera (join_waitlist).

Cuándo llamar al equipo (request_human) en lugar de responder sola:
- dudas de salud, diagnóstico, embarazo, medicación, reacción alérgica, dolor o hinchazón después de un procedimiento;
- reclamos, pedidos de reembolso, descuento o negociación de precio;
- cualquier cosa que no sepas por las herramientas.
En esos casos no des orientación médica: contén en una frase y di que alguien del equipo le va a escribir.

Mal: "¡Listo! Bótox reservado para las 14:00. ¡Te esperamos!"
Bien: "Te dejé el bótox mañana a las 14. Cualquier cosa me escribes."

Horario de atención: ${describeWeek(hours, "es")}.${studioGuidance}`;

  const systemPt = `Você é a menina do WhatsApp do ${studio?.name || "studio"}, não um chatbot. Pessoas reais te escrevem no meio do dia, às vezes com erro de digitação, áudio transcrito, mensagem curta.

Quem fala com você: ${firstName || "ainda não falou o nome"}.
Personalidade do studio: ${persona}. ${tomHint}
Agora (horário do studio): ${formatZoned(new Date(), tz)}.

Como falar:
- Mensagem curta, 1–3 frases. Uma pergunta só.
- Português do dia a dia: "pra", "tá", "a gente", "pode ser?". NÃO fale como SAC ("fico à disposição", "como posso ajudá-la", "te esperamos!", "anotei seu pedido").
- Não comece todo turno com Oi / Olá / Tudo bem? Se a conversa já começou, continue.
- Use o primeiro nome no máximo de vez em quando, não em toda frase.
- No máximo 1 emoji, e só se couber. Zero emoji também é ótimo.
- Horários: fale como gente ("de manhã tenho 10h e 11h, de tarde 14h e 16h — o que fica melhor pra você?"), nunca uma listinha de 10 itens.
- Preço: um número e uma pergunta ("fica 280, quer que eu veja um horário?").
- Se ela só cumprimentar, responde o cumprimento e pergunta o que ela precisa, sem menu.

Agenda (não negociável):
- Pediu vaga / horários → list_available_slots, oferece 2 a 4 opções e ESPERA ela escolher. Não marca.
- book_appointment só com client_confirmed=true depois de ela escolher ("pode ser 14h", "marca esse").
- Em when_text e day_text escreva SEMPRE a data no formato AAAA-MM-DD HH:MM (ou AAAA-MM-DD para um dia).
- Sem saber procedimento ou período (manhã/tarde/dia): pergunta isso primeiro.
- Nunca invente preço, vaga ou endereço. Use as ferramentas.
- Só cancela se ela pedir.
- Para trocar de horário use reschedule_appointment (não cancele e marque de novo).
- Se book_appointment devolver aguardando_aprovacao, diga que ficou pré-reservado e que a equipe confirma. Nunca diga "confirmado" nesse caso.
- Se vier "sinal", informe o valor e a chave Pix e peça o comprovante.
- Dia sem vaga: ofereça outro dia ou a lista de espera (join_waitlist).

Quando chamar a equipe (request_human) em vez de responder sozinha:
- dúvida de saúde, diagnóstico, gestante, medicação, reação alérgica, dor ou inchaço depois de um procedimento;
- reclamação, pedido de reembolso, desconto ou negociação de preço;
- qualquer coisa que você não saiba pelas ferramentas.
Nesses casos não dê orientação médica: acolha em uma frase e diga que alguém da equipe vai falar com ela.

Errado: "Pronto! Botox agendado para 14:00. Te esperamos!"
Certo: "Fechei o botox amanhã às 14h pra você. Qualquer coisa é só chamar."

Horário de funcionamento: ${describeWeek(hours)}.${studioGuidance}`;

  const system = L === "es" ? systemEs : systemPt;

  const messages: Record<string, unknown>[] = [
    { role: "system", content: system },
    ...history.slice(-10).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userText },
  ];

  function wantsOnlyAvailability(msg: string) {
    const t = normalizeText(msg);
    const asking = /disponiv|tem vaga|quais horarios|que horas tem|horario livre|o que tem|tem horario|tem encaixe/.test(t);
    const choosing = /pode marcar|marca esse|quero esse|pode ser|confirma|pode sim|isso|fechou|agend[ae] esse|pode esse|pode as |pode às |pode as\s+\d/.test(t);
    return asking && !choosing;
  }

  async function execTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (name === "get_catalog") {
      const { data: procs } = await supabase.from("procedures").select("name, price, duration").eq("studio_id", studioId).eq("active", true);
      return JSON.stringify({
        studio: studio?.name,
        address: studio?.address || "",
        phone: studio?.phone || "",
        horario_de_funcionamento: describeWeek(hours, L),
        procedures: (procs || []).map((p) => ({ name: p.name, price: Number(p.price), duration_min: p.duration })),
      });
    }
    if (name === "get_my_appointments") {
      const { data } = await supabase.from("appointments")
        .select("id, title, start_time, status")
        .eq("studio_id", studioId)
        .eq("client_id", clientId)
        .in("status", ["pending", "confirmed"])
        .gte("start_time", new Date().toISOString())
        .order("start_time")
        .limit(8);
      return JSON.stringify((data || []).map((a) => ({ id: a.id, title: a.title, when: formatZoned(new Date(a.start_time), tz), status: a.status })));
    }
    if (name === "list_available_slots") {
      const { data: procs } = await supabase.from("procedures").select("id, name, price, duration").eq("studio_id", studioId).eq("active", true);
      const proc = fuzzyProcedure(String(args.procedure_name || ""), procs || []);
      const parsed = parseBrazilianDateTimeParts(String(args.day_text || ""), new Date(), tz);
      const ymd = parsed?.ymd || zonedYmd(new Date(), tz);
      const duration = Number(proc?.duration || 60);
      const win = windowForYmd(hours, ymd);
      if (!win) {
        return JSON.stringify({
          dia: ymd,
          fechado: true,
          horario_da_semana: describeWeek(hours, L),
          aviso: "O studio não abre nesse dia. Diga isso com naturalidade e sugira outro dia.",
        });
      }
      const day = await loadDayAgenda(supabase, studioId, ymd, tz);
      const slots: string[] = [];
      for (let m = win.open; m + duration <= win.close; m += 30) {
        const start = fromZonedWall(ymd, Math.floor(m / 60), m % 60, tz);
        if (start.getTime() <= Date.now()) continue;
        const end = new Date(start.getTime() + duration * 60 * 1000);
        if (isFreeInMemory(day, start, end)) {
          slots.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
        }
      }
      const manha = slots.filter((s) => Number(s.slice(0, 2)) < 12).slice(0, 3);
      const tarde = slots.filter((s) => Number(s.slice(0, 2)) >= 12).slice(0, 3);
      return JSON.stringify({
        dia: ymd,
        procedimento: proc?.name || null,
        manha,
        tarde,
        aviso: "Fale 2–4 horários em frase natural e pergunte qual ela prefere. NÃO marque.",
      });
    }
    if (name === "save_client_name") {
      const name = String(args.name || "").trim().slice(0, 80);
      if (name.length < 2) return "Nome inválido";
      await supabase.from("clients").update({ name }).eq("id", clientId);
      return `Nome salvo: ${name}`;
    }
    if (name === "book_appointment") {
      if (args.client_confirmed !== true && String(args.client_confirmed) !== "true") {
        return JSON.stringify({ error: "precisa_confirmacao", detalhe: "Mostre horários e espere ela escolher. Não marque." });
      }
      if (wantsOnlyAvailability(userText)) {
        return JSON.stringify({ error: "so_perguntou_vagas", detalhe: "Use list_available_slots e pergunte a preferência." });
      }
      const { data: procs } = await supabase.from("procedures").select("id, name, price, duration").eq("studio_id", studioId).eq("active", true);
      const proc = fuzzyProcedure(String(args.procedure_name || ""), procs || []);
      const parsed = parseBrazilianDateTimeParts(String(args.when_text || ""), new Date(), tz);
      if (!proc) return JSON.stringify({ error: "procedimento_nao_encontrado", opcoes: (procs || []).map((p) => p.name) });
      if (!parsed?.hasTime) return JSON.stringify({ error: "falta_horario", detalhe: "Peça dia e hora, ex: amanhã 14h" });
      if (parsed.at.getTime() <= Date.now()) return JSON.stringify({ error: "horario_passado" });
      const duration = Number(proc.duration || 60);
      const end = new Date(parsed.at.getTime() + duration * 60 * 1000);
      if (!isWithinBusinessHours(hours, parsed.at, end, tz)) {
        return JSON.stringify({
          error: "fora_do_horario",
          horario_do_dia: describeDay(hours, zonedYmd(parsed.at, tz), L),
          detalhe: "Esse horário está fora do funcionamento. Use list_available_slots e ofereça opções.",
        });
      }
      const deposit = depositFor(studio, Number(proc.price || 0));
      const free = await pickFreeProfessional(supabase, studioId, parsed.at, end);
      if (!free && await slotTaken(supabase, studioId, parsed.at, end, null)) {
        const tips: string[] = [];
        for (const addH of [1, 2, 3, 24, 25]) {
          const s = new Date(parsed.at.getTime() + addH * 60 * 60 * 1000);
          const e = new Date(s.getTime() + duration * 60 * 1000);
          if (s.getTime() <= Date.now()) continue;
          if (!isWithinBusinessHours(hours, s, e, tz)) continue;
          const f = await pickFreeProfessional(supabase, studioId, s, e);
          if (f || !(await slotTaken(supabase, studioId, s, e, null))) tips.push(formatZoned(s, tz));
          if (tips.length >= 3) break;
        }
        return JSON.stringify({ error: "ocupado", alternativas: tips });
      }
      const { data: created, error } = await supabase.from("appointments").insert({
        studio_id: studioId,
        client_id: clientId,
        professional_id: free?.id || null,
        procedure_id: proc.id,
        title: proc.name,
        start_time: parsed.at.toISOString(),
        end_time: end.toISOString(),
        date: zonedYmd(parsed.at, tz),
        status: needsApproval ? "pending" : "confirmed",
        price: Number(proc.price || 0),
        payment_status: "pending",
        notes: msg(L, "noteGpt"),
        source: "ai",
        deposit_amount: deposit,
      }).select("id").single();
      if (error) {
        console.error("[gpt-secretary] booking insert failed", error.message);
        return JSON.stringify({ error: error.code === "23P01" ? "ocupado" : "falha_ao_gravar" });
      }
      await supabase.from("conversations").update({ ai_state: { last_appointment_id: created?.id } }).eq("id", convId);
      await supabase.from("notifications").insert({
        studio_id: studioId,
        client_id: clientId,
        type: "new_appointment",
        title: msg(L, "notifNewGpt"),
        content: msg(L, "notifAptContent", { title: proc.name, when: formatZoned(parsed.at, tz) }),
      });
      void notifyStudioStaff(supabase, studioId, msg(L, needsApproval ? "staffNeedsApproval" : "staffNewGpt", { client: clientName || msg(L, "client"), title: proc.name, when: formatZoned(parsed.at, tz) }));
      return JSON.stringify({
        ok: true,
        when: formatZoned(parsed.at, tz),
        procedure: proc.name,
        price: Number(proc.price),
        ...(needsApproval ? { aguardando_aprovacao: true, aviso: "NÃO diga que está confirmado. Diga que ficou pré-reservado e que a equipe confirma e avisa por aqui." } : {}),
        ...(deposit > 0 ? { sinal: { valor: deposit, chave_pix: studio?.pix_key, aviso: "Informe o valor do sinal e a chave Pix, e peça o comprovante." } } : {}),
      });
    }
    if (name === "cancel_appointment") {
      if (args.client_confirmed !== true && String(args.client_confirmed) !== "true") {
        return JSON.stringify({ error: "precisa_confirmacao", detalhe: "Pergunte se ela quer mesmo cancelar (diga dia e hora) e espere o sim." });
      }
      let q = supabase.from("appointments").select("id, title, start_time")
        .eq("studio_id", studioId).eq("client_id", clientId)
        .in("status", ["pending", "confirmed"]).gte("start_time", new Date().toISOString()).order("start_time").limit(1);
      if (args.appointment_id) {
        const { data: one } = await supabase.from("appointments").select("id, title, start_time")
          .eq("id", String(args.appointment_id)).eq("studio_id", studioId).eq("client_id", clientId).maybeSingle();
        if (!one) return JSON.stringify({ error: "nao_encontrado" });
        await supabase.from("appointments").update({ status: "cancelled" }).eq("id", one.id);
        void notifyStudioStaff(supabase, studioId, msg(L, "staffCancel", { client: clientName || msg(L, "client"), title: one.title, when: formatZoned(new Date(one.start_time), tz) }));
        await notifyWaitlist(supabase, { studioId, start: new Date(one.start_time), tz, locale: L, skipClientId: clientId });
        return JSON.stringify({ ok: true, title: one.title, when: formatZoned(new Date(one.start_time), tz) });
      }
      const { data: list } = await q;
      const one = list?.[0];
      if (!one) return JSON.stringify({ error: "nenhum_horario" });
      await supabase.from("appointments").update({ status: "cancelled" }).eq("id", one.id);
      void notifyStudioStaff(supabase, studioId, msg(L, "staffCancel", { client: clientName || msg(L, "client"), title: one.title, when: formatZoned(new Date(one.start_time), tz) }));
      await notifyWaitlist(supabase, { studioId, start: new Date(one.start_time), tz, locale: L, skipClientId: clientId });
      return JSON.stringify({ ok: true, title: one.title, when: formatZoned(new Date(one.start_time), tz) });
    }
    if (name === "reschedule_appointment") {
      if (args.client_confirmed !== true && String(args.client_confirmed) !== "true") {
        return JSON.stringify({ error: "precisa_confirmacao", detalhe: "Confirme o novo horário com ela antes de remarcar." });
      }
      let query = supabase.from("appointments").select("id, title, start_time, end_time, status, procedure_id")
        .eq("studio_id", studioId).eq("client_id", clientId).in("status", ["pending", "confirmed"])
        .gte("start_time", new Date().toISOString()).order("start_time").limit(1);
      if (args.appointment_id) query = query.eq("id", String(args.appointment_id));
      const { data: found } = await query;
      const old = found?.[0];
      if (!old) return JSON.stringify({ error: "nenhum_horario" });
      const parsed = parseBrazilianDateTimeParts(String(args.new_when_text || ""), new Date(), tz);
      if (!parsed?.hasTime) return JSON.stringify({ error: "falta_horario" });
      if (parsed.at.getTime() <= Date.now()) return JSON.stringify({ error: "horario_passado" });
      const duration = Math.max(15, Math.round((new Date(old.end_time).getTime() - new Date(old.start_time).getTime()) / 60000));
      const end = new Date(parsed.at.getTime() + duration * 60 * 1000);
      if (!isWithinBusinessHours(hours, parsed.at, end, tz)) {
        return JSON.stringify({ error: "fora_do_horario", horario_do_dia: describeDay(hours, zonedYmd(parsed.at, tz), L) });
      }
      const free = await pickFreeProfessional(supabase, studioId, parsed.at, end, old.id);
      if (!free && await slotTaken(supabase, studioId, parsed.at, end, null, old.id)) return JSON.stringify({ error: "ocupado" });
      // One UPDATE moves the appointment: the old time is never lost if this fails.
      const { error: moveError } = await supabase.from("appointments").update({
        start_time: parsed.at.toISOString(),
        end_time: end.toISOString(),
        date: zonedYmd(parsed.at, tz),
        professional_id: free?.id || null,
        status: needsApproval ? "pending" : old.status,
      }).eq("id", old.id);
      if (moveError) {
        console.error("[gpt-secretary] reschedule failed", moveError.message);
        return JSON.stringify({ error: moveError.code === "23P01" ? "ocupado" : "falha_ao_gravar" });
      }
      void notifyStudioStaff(supabase, studioId, msg(L, "staffReschedule", { client: clientName || msg(L, "client"), title: old.title, from: formatZoned(new Date(old.start_time), tz), to: formatZoned(parsed.at, tz) }));
      await notifyWaitlist(supabase, { studioId, start: new Date(old.start_time), tz, locale: L, skipClientId: clientId });
      return JSON.stringify({ ok: true, title: old.title, de: formatZoned(new Date(old.start_time), tz), para: formatZoned(parsed.at, tz), ...(needsApproval ? { aguardando_aprovacao: true } : {}) });
    }
    if (name === "request_human") {
      await flagHuman(supabase, { studioId, convId, clientId, clientName, reason: String(args.reason || ""), locale: L });
      return JSON.stringify({ ok: true, aviso: "A equipe foi avisada. Diga com cuidado que alguém vai falar com ela por aqui. Não dê orientação de saúde." });
    }
    if (name === "join_waitlist") {
      const parsed = parseBrazilianDateTimeParts(String(args.day_text || ""), new Date(), tz);
      if (!parsed?.hasDay || parsed.ymd < zonedYmd(new Date(), tz)) return JSON.stringify({ error: "dia_invalido" });
      const { data: procs } = await supabase.from("procedures").select("id, name, price, duration").eq("studio_id", studioId).eq("active", true);
      const proc = fuzzyProcedure(String(args.procedure_name || ""), procs || []);
      const { error: wlError } = await supabase.from("waitlist").insert({
        studio_id: studioId, client_id: clientId, desired_date: parsed.ymd,
        procedure_id: proc?.id || null, procedure_name: proc?.name || String(args.procedure_name || "").slice(0, 80),
      });
      if (wlError && wlError.code !== "23505") return JSON.stringify({ error: "falha_ao_gravar" });
      return JSON.stringify({ ok: true, dia: parsed.ymd, aviso: "Diga que ela está na lista de espera e será avisada se abrir horário." });
    }
    return "ferramenta desconhecida";
  }

  try {
    for (let i = 0; i < 6; i++) {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          temperature: 0.9,
          frequency_penalty: 0.45,
          presence_penalty: 0.25,
          max_tokens: 220,
          messages,
          tools: TOOLS,
        }),
      });
      if (!res.ok) {
        console.error("[gpt-secretary]", res.status, await res.text().catch(() => ""));
        return null;
      }
      const data = await res.json();
      const msg = data?.choices?.[0]?.message;
      if (!msg) return null;
      messages.push(msg);
      const calls = msg.tool_calls || [];
      if (!calls.length) return String(msg.content || "").trim() || null;
      for (const call of calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function?.arguments || "{}");
        } catch {
          args = {};
        }
        const out = await execTool(call.function?.name || "", args);
        messages.push({ role: "tool", tool_call_id: call.id, content: out });
      }
    }
    return null;
  } catch (err) {
    console.error("[gpt-secretary]", err);
    return null;
  }
}
