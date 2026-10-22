import { formatSaoPaulo, fromSaoPauloWall, parseBrazilianDateTimeParts, saoPauloYmd, normalizeText } from "./brazil.ts";
import { notifyStudioStaff } from "./staff-alert.ts";

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

async function slotTaken(supabase: Sb, studioId: string, start: Date, end: Date, professionalId: string | null) {
  const { data } = await supabase.from("appointments")
    .select("id, professional_id")
    .eq("studio_id", studioId)
    .neq("status", "cancelled")
    .lt("start_time", end.toISOString())
    .gt("end_time", start.toISOString());
  return (data || []).some((a) => {
    if (!professionalId) return true;
    return !a.professional_id || a.professional_id === professionalId;
  });
}

async function pickFreeProfessional(supabase: Sb, studioId: string, start: Date, end: Date) {
  const { data: profs } = await supabase.from("professionals").select("id, name").eq("studio_id", studioId).eq("active", true).order("name");
  for (const p of profs || []) {
    if (!(await slotTaken(supabase, studioId, start, end, p.id))) return p;
  }
  return null;
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
          day_text: { type: "string", description: "Dia em português, ex: hoje, amanhã, sexta, 22/10" },
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
          when_text: { type: "string", description: "O horário que a CLIENTE escolheu, ex: amanhã 14h" },
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
      description: "Cancela um horário futuro da cliente. Sem id, cancela o próximo.",
      parameters: { type: "object", properties: { appointment_id: { type: "string" } } },
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
}): Promise<string | null> {
  const { apiKey, model, supabase, studioId, clientId, convId, userText, history } = opts;
  const { data: studio } = await supabase.from("studios").select("name, address, phone").eq("id", studioId).maybeSingle();
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

  const system = `Você é a menina do WhatsApp do ${studio?.name || "studio"}, não um chatbot. Pessoas reais te escrevem no meio do dia, às vezes com erro de digitação, áudio transcrito, mensagem curta.

Quem fala com você: ${firstName || "ainda não falou o nome"}.
Personalidade do studio: ${persona}. ${tomHint}
Agora em São Paulo: ${formatSaoPaulo(new Date())}.

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
- Sem saber procedimento ou período (manhã/tarde/dia): pergunta isso primeiro.
- Nunca invente preço, vaga ou endereço. Use as ferramentas.
- Só cancela se ela pedir.

Errado: "Pronto! Botox agendado para 14:00. Te esperamos!"
Certo: "Fechei o botox amanhã às 14h pra você. Qualquer coisa é só chamar."`;

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
      return JSON.stringify((data || []).map((a) => ({ id: a.id, title: a.title, when: formatSaoPaulo(new Date(a.start_time)), status: a.status })));
    }
    if (name === "list_available_slots") {
      const { data: procs } = await supabase.from("procedures").select("id, name, price, duration").eq("studio_id", studioId).eq("active", true);
      const proc = fuzzyProcedure(String(args.procedure_name || ""), procs || []);
      const parsed = parseBrazilianDateTimeParts(String(args.day_text || ""), new Date());
      const ymd = parsed?.ymd || saoPauloYmd(new Date());
      const duration = Number(proc?.duration || 60);
      const slots: string[] = [];
      for (let h = 9; h <= 18; h++) {
        for (const min of [0, 30]) {
          if (h === 18 && min > 0) continue;
          const start = fromSaoPauloWall(ymd, h, min);
          if (start.getTime() <= Date.now()) continue;
          const end = new Date(start.getTime() + duration * 60 * 1000);
          const free = await pickFreeProfessional(supabase, studioId, start, end);
          if (free || !(await slotTaken(supabase, studioId, start, end, null))) {
            const hh = String(h).padStart(2, "0");
            const mm = String(min).padStart(2, "0");
            slots.push(`${hh}:${mm}`);
          }
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
      const parsed = parseBrazilianDateTimeParts(String(args.when_text || ""), new Date());
      if (!proc) return JSON.stringify({ error: "procedimento_nao_encontrado", opcoes: (procs || []).map((p) => p.name) });
      if (!parsed?.hasTime) return JSON.stringify({ error: "falta_horario", detalhe: "Peça dia e hora, ex: amanhã 14h" });
      if (parsed.at.getTime() <= Date.now()) return JSON.stringify({ error: "horario_passado" });
      const duration = Number(proc.duration || 60);
      const end = new Date(parsed.at.getTime() + duration * 60 * 1000);
      const free = await pickFreeProfessional(supabase, studioId, parsed.at, end);
      if (!free && await slotTaken(supabase, studioId, parsed.at, end, null)) {
        const tips: string[] = [];
        for (const addH of [1, 2, 3, 24, 25]) {
          const s = new Date(parsed.at.getTime() + addH * 60 * 60 * 1000);
          const e = new Date(s.getTime() + duration * 60 * 1000);
          if (s.getTime() <= Date.now()) continue;
          const f = await pickFreeProfessional(supabase, studioId, s, e);
          if (f || !(await slotTaken(supabase, studioId, s, e, null))) tips.push(formatSaoPaulo(s));
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
        date: saoPauloYmd(parsed.at),
        status: "confirmed",
        price: Number(proc.price || 0),
        payment_status: "pending",
        notes: "Criado pela SecretarIA (GPT) no WhatsApp",
      }).select("id").single();
      if (error) return JSON.stringify({ error: error.message });
      await supabase.from("conversations").update({ ai_state: { last_appointment_id: created?.id } }).eq("id", convId);
      await supabase.from("notifications").insert({
        studio_id: studioId,
        client_id: clientId,
        type: "new_appointment",
        title: "Novo agendamento (WhatsApp GPT)",
        content: `${proc.name} em ${formatSaoPaulo(parsed.at)}`,
      });
      void notifyStudioStaff(supabase, studioId, `📅 Novo agendamento (GPT)\n${clientName || "Cliente"} — ${proc.name}\n${formatSaoPaulo(parsed.at)}`);
      return JSON.stringify({ ok: true, when: formatSaoPaulo(parsed.at), procedure: proc.name, price: Number(proc.price) });
    }
    if (name === "cancel_appointment") {
      let q = supabase.from("appointments").select("id, title, start_time")
        .eq("studio_id", studioId).eq("client_id", clientId)
        .in("status", ["pending", "confirmed"]).gte("start_time", new Date().toISOString()).order("start_time").limit(1);
      if (args.appointment_id) {
        const { data: one } = await supabase.from("appointments").select("id, title, start_time")
          .eq("id", String(args.appointment_id)).eq("studio_id", studioId).eq("client_id", clientId).maybeSingle();
        if (!one) return JSON.stringify({ error: "nao_encontrado" });
        await supabase.from("appointments").update({ status: "cancelled" }).eq("id", one.id);
        void notifyStudioStaff(supabase, studioId, `❌ Cancelamento\n${clientName || "Cliente"} — ${one.title}\n${formatSaoPaulo(new Date(one.start_time))}`);
        return JSON.stringify({ ok: true, title: one.title, when: formatSaoPaulo(new Date(one.start_time)) });
      }
      const { data: list } = await q;
      const one = list?.[0];
      if (!one) return JSON.stringify({ error: "nenhum_horario" });
      await supabase.from("appointments").update({ status: "cancelled" }).eq("id", one.id);
      void notifyStudioStaff(supabase, studioId, `❌ Cancelamento\n${clientName || "Cliente"} — ${one.title}\n${formatSaoPaulo(new Date(one.start_time))}`);
      return JSON.stringify({ ok: true, title: one.title, when: formatSaoPaulo(new Date(one.start_time)) });
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
