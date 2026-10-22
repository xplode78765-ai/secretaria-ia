import { createClient } from "npm:@supabase/supabase-js@2";
import {
  formatSaoPaulo,
  normalizePhone,
  normalizeText,
  parseBrazilianDateTimeParts,
  phoneLookupValues,
  saoPauloYmd,
} from "../_shared/brazil.ts";
import { notifyStudioStaff } from "../_shared/staff-alert.ts";
import { runGptSecretary } from "../_shared/gpt-secretary.ts";

const DEFAULT_ORIGIN = "https://secretaria.app";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

async function getAppSecret(key: string): Promise<string | null> {
  const { data } = await supabase.from("app_secrets").select("value").eq("key", key).maybeSingle();
  const value = data?.value ?? null;
  return value && value.length > 0 ? value : null;
}

function originAllowed(origin: string, allowlist: string[]): boolean {
  if (!origin) return false;
  if (allowlist.includes("*") || allowlist.includes(origin)) return true;
  try {
    const host = new URL(origin).hostname;
    if (host === "localhost" || host === "127.0.0.1") return true;
    if (host.endsWith(".bolt.new") || host.endsWith(".bolt.host") || host.endsWith(".stackblitz.io") || host.endsWith(".netlify.app")) return true;
  } catch {
    return false;
  }
  return false;
}

async function getCorsHeaders(req: Request): Promise<Record<string, string>> {
  const configured = await getAppSecret("allowed_origin");
  const allowlist = (configured || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!allowlist.includes(DEFAULT_ORIGIN)) allowlist.push(DEFAULT_ORIGIN);
  const requestOrigin = req.headers.get("Origin") || "";
  const origin = originAllowed(requestOrigin, allowlist) ? requestOrigin : (allowlist[0] || DEFAULT_ORIGIN);
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Webhook-Secret, X-Cron-Secret",
    Vary: "Origin",
  };
}

function matchesKeyword(normalizedMessage: string, keyword: string): boolean {
  const needle = normalizeText(keyword);
  if (!needle) return false;
  if (needle.includes(" ")) return normalizedMessage.includes(needle);
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)${escaped}(?:$|\\s|[?!.,;:])`).test(normalizedMessage);
}

function matchPattern(message: string, patterns: any[], customMessages: any[]) {
  const normalized = normalizeText(message);
  for (const pattern of patterns) {
    if (!pattern.enabled) continue;
    for (const keyword of pattern.keywords || []) {
      if (matchesKeyword(normalized, keyword)) {
        return { matched: true, pattern, response: pattern.response, trigger: pattern.trigger };
      }
    }
  }
  const fallback = (customMessages || []).find((m) => m.trigger === "fallback" && m.enabled);
  return { matched: false, pattern: null, response: fallback?.message || "Obrigada pela mensagem! Nossa equipe vai responder em breve.", trigger: "fallback" };
}

async function slotTaken(studioId: string, start: Date, end: Date, professionalId: string | null, ignoreId?: string) {
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

async function pickFreeProfessional(studioId: string, start: Date, end: Date) {
  const { data: profs } = await supabase.from("professionals").select("id, name").eq("studio_id", studioId).eq("active", true).order("name");
  for (const p of profs || []) {
    if (!(await slotTaken(studioId, start, end, p.id))) return p;
  }
  return null;
}

function fuzzyProcedure(n: string, procedures: { id: string; name: string; price: number; duration: number }[]) {
  return procedures.find((p) => {
    const pn = normalizeText(p.name);
    if (!pn) return false;
    if (n.includes(pn) || pn.includes(n)) return true;
    const words = pn.split(/\s+/).filter((w) => w.length > 3);
    return words.length > 0 && words.every((w) => n.includes(w));
  }) || null;
}

function looksGreeting(n: string) {
  return /^(oi+|ola+|ola\s+tudo\s+bem|bom\s+dia|boa\s+tarde|boa\s+noite|hey|eai|e\s+ai)[\s!?.]*$/.test(n);
}

async function suggestOtherSlots(studioId: string, start: Date, durationMin: number) {
  const tips: string[] = [];
  const duration = durationMin * 60 * 1000;
  for (const addH of [1, 2, 3, 24, 25, 26]) {
    const s = new Date(start.getTime() + addH * 60 * 60 * 1000);
    if (s.getTime() <= Date.now()) continue;
    const e = new Date(s.getTime() + duration);
    const free = await pickFreeProfessional(studioId, s, e);
    if (free || !(await slotTaken(studioId, s, e, null))) {
      tips.push(formatSaoPaulo(s));
    }
    if (tips.length >= 3) break;
  }
  return tips;
}

async function handleAiTurn(opts: {
  studioId: string;
  clientId: string;
  conv: { id: string; ai_state?: Record<string, unknown> };
  text: string;
  patterns: unknown[];
  customMessages: unknown[];
}): Promise<string> {
  const { studioId, clientId, conv, text } = opts;
  const n = normalizeText(text);
  const state = { ...(conv.ai_state || {}) } as Record<string, unknown>;
  const { data: clientRow } = await supabase.from("clients").select("name").eq("id", clientId).maybeSingle();
  const clientName = (clientRow?.name && !/^\d+$/.test(clientRow.name)) ? clientRow.name : "";
  const { data: studio } = await supabase.from("studios").select("name, address, phone").eq("id", studioId).maybeSingle();
  const { data: procedures } = await supabase.from("procedures").select("id, name, price, duration").eq("studio_id", studioId).eq("active", true);
  const procs = procedures || [];
  const matchedProc = fuzzyProcedure(n, procs);
  const pendingYmd = typeof state.pending_ymd === "string" ? state.pending_ymd : undefined;
  const parsed = parseBrazilianDateTimeParts(text, new Date(), pendingYmd);
  const patternHit = matchPattern(text, opts.patterns as any[], opts.customMessages as any[]);
  const customByTrigger = (t: string) => (opts.customMessages as { trigger?: string; enabled?: boolean; message?: string }[] || []).find((m) => m.trigger === t && m.enabled)?.message;

  const cancelish = n === "2" || n.includes("cancelar") || n.includes("desmarcar") || n.includes("nao vou") || n.includes("nao posso ir");
  const confirmish = n === "1" || n === "confirmar" || n.includes("confirmo");
  const reschedule = n.includes("remarcar") || n.includes("reagendar") || n.includes("trocar horario") || n.includes("mudar horario");
  const askMine = n.includes("meu horario") || n.includes("meus horarios") || n.includes("tenho agendamento") || n.includes("quando e meu") || n.includes("qual meu horario");
  const askPrice = patternHit.trigger === "pricing" || n.includes("quanto custa") || n.includes("qual o valor") || n.includes("preco") || n.includes("preço");
  const askHours = patternHit.trigger === "hours";
  const askAddress = patternHit.trigger === "address";
  const askProcs = patternHit.trigger === "procedures" || n.includes("o que voces fazem") || n.includes("quais procedimentos");
  const wantsBook = n.includes("agendar") || (/\bmarcar\b/.test(n) && !n.includes("remarcar")) || n.includes("reservar") || n.includes("quero ir");
  const inScheduling = state.step === "scheduling";

  const lastAptId = typeof state.appointment_id === "string"
    ? state.appointment_id
    : typeof state.last_appointment_id === "string"
      ? state.last_appointment_id
      : null;

  async function upcoming() {
    const { data } = await supabase.from("appointments")
      .select("id, title, start_time, status")
      .eq("studio_id", studioId)
      .eq("client_id", clientId)
      .in("status", ["pending", "confirmed"])
      .gte("start_time", new Date().toISOString())
      .order("start_time")
      .limit(5);
    return data || [];
  }

  async function cancelApt(apt: { id: string; title: string; start_time: string }) {
    await supabase.from("appointments").update({ status: "cancelled" }).eq("id", apt.id);
    void notifyStudioStaff(supabase, studioId, `❌ Cancelamento\n${clientName || "Cliente"} — ${apt.title}\n${formatSaoPaulo(new Date(apt.start_time))}`);
  }

  if (looksGreeting(n)) {
    const g = customByTrigger("greeting") || `Olá${clientName ? `, ${clientName}` : ""}! Como posso ajudar? Posso agendar, falar de preços ou de horários.`;
    return clientName ? g : `${g}\nSe quiser, me diz seu nome 🙂`;
  }

  const named = n.match(/(?:meu nome e|me chamo|sou a |sou o )\s*([a-zà-ú][a-zà-ú\s]{1,40})/);
  if (named) {
    const name = named[1].trim().replace(/\s+/g, " ");
    await supabase.from("clients").update({ name }).eq("id", clientId);
    await supabase.from("conversations").update({ ai_state: { ...state, client_name: name } }).eq("id", conv.id);
    return `Prazer, ${name}! Quer agendar um horário, ver preços ou seus agendamentos?`;
  }

  if (askMine) {
    const list = await upcoming();
    if (!list.length) return "Você não tem horário marcado. Quer agendar? Me diga o procedimento e o dia/hora.";
    return "Seus próximos horários:\n" + list.map((a) => `• ${a.title} em ${formatSaoPaulo(new Date(a.start_time))}`).join("\n") + "\nPara cancelar, responda 2. Para remarcar, diga o novo dia e hora.";
  }

  if (cancelish) {
    const list = await upcoming();
    const apt = list.find((a) => a.id === lastAptId) || list[0];
    if (!apt) return "Não achei um horário seu para cancelar. Quer marcar um novo?";
    await cancelApt(apt);
    await supabase.from("conversations").update({ ai_state: { step: "scheduling" } }).eq("id", conv.id);
    return `Cancelei ${apt.title} de ${formatSaoPaulo(new Date(apt.start_time))}. Se quiser remarcar, me manda o procedimento e o novo horário.`;
  }

  if (confirmish) {
    const list = await upcoming();
    const apt = list.find((a) => a.id === lastAptId) || list[0];
    if (!apt) return "Não achei um horário pendente. Pode me dizer o que deseja agendar?";
    if (apt.status !== "confirmed") await supabase.from("appointments").update({ status: "confirmed" }).eq("id", apt.id);
    await supabase.from("conversations").update({ ai_state: { last_appointment_id: apt.id } }).eq("id", conv.id);
    void notifyStudioStaff(supabase, studioId, `✅ Confirmação de atendimento\n${clientName || "Cliente"} — ${apt.title}\n${formatSaoPaulo(new Date(apt.start_time))}`);
    return `Confirmado! ${apt.title} em ${formatSaoPaulo(new Date(apt.start_time))}. Te esperamos.`;
  }

  if (askPrice) {
    if (matchedProc) return `${matchedProc.name} fica R$ ${Number(matchedProc.price).toFixed(0)} (${matchedProc.duration} min). Quer agendar? Pode mandar o dia e a hora.`;
    if (procs.length) return "Nossos valores:\n" + procs.map((p) => `• ${p.name}: R$ ${Number(p.price).toFixed(0)}`).join("\n") + "\nQual você quer agendar?";
    return patternHit.response;
  }

  if (askProcs && procs.length) {
    return `No ${studio?.name || "studio"} temos:\n` + procs.map((p) => `• ${p.name} — R$ ${Number(p.price).toFixed(0)}`).join("\n") + "\nQual te interessa?";
  }

  if (askAddress) {
    return studio?.address
      ? `Estamos em ${studio.address}.${studio.phone ? ` Tel: ${studio.phone}.` : ""} Te esperamos!`
      : (patternHit.response || customByTrigger("address") || "Me confirma o endereço com a equipe, tá?");
  }

  if (askHours) return patternHit.response || customByTrigger("hours") || "Funcionamos em horário comercial. Qual dia você prefere?";

  if (reschedule) {
    const list = await upcoming();
    const apt = list.find((a) => a.id === lastAptId) || list[0];
    if (!apt) {
      await supabase.from("conversations").update({ ai_state: { step: "scheduling" } }).eq("id", conv.id);
      return "Não achei um horário para remarcar. Me diga o procedimento e o dia/hora.";
    }
    if (parsed?.hasTime) {
      await cancelApt(apt);
      state.procedure_name = apt.title;
      state.step = "scheduling";
    } else {
      await supabase.from("conversations").update({
        ai_state: { step: "scheduling", last_appointment_id: apt.id, reschedule_id: apt.id, procedure_name: apt.title },
      }).eq("id", conv.id);
      return `Vamos remarcar ${apt.title}. Qual o novo dia e horário? Ex: amanhã 14h.`;
    }
  }

  const wantsSchedule = wantsBook || inScheduling || (parsed?.hasTime && (inScheduling || !!matchedProc || !!state.procedure_id || !!state.procedure_name));
  if (wantsSchedule) {
    const proc = matchedProc || procs.find((p) => p.id === state.procedure_id) || null;
    if (!proc && procs.length > 0 && !state.procedure_name) {
      const list = procs.map((p) => `• ${p.name} (R$ ${Number(p.price).toFixed(0)})`).join("\n");
      await supabase.from("conversations").update({ ai_state: { step: "scheduling", pending_ymd: parsed?.ymd } }).eq("id", conv.id);
      return `Claro! Qual procedimento você quer?\n${list}\nPode mandar também o dia e a hora, tipo: amanhã 14h.`;
    }
    if (!parsed?.hasTime) {
      await supabase.from("conversations").update({
        ai_state: {
          step: "scheduling",
          procedure_id: proc?.id,
          procedure_name: proc?.name || state.procedure_name,
          duration: proc?.duration || state.duration,
          price: proc?.price || state.price,
          pending_ymd: parsed?.ymd || pendingYmd,
          reschedule_id: state.reschedule_id,
        },
      }).eq("id", conv.id);
      return `Perfeito${proc || state.procedure_name ? ` para ${proc?.name || state.procedure_name}` : ""}${parsed?.hasDay ? ` no dia ${parsed.ymd}` : ""}. Qual horário? Ex: 14h ou 15/10 às 10h.`;
    }
    const when = parsed.at;
    if (when.getTime() <= Date.now()) {
      return "Esse horário já passou. Escolhe outro dia ou uma hora mais tarde?";
    }
    const duration = Number(proc?.duration || state.duration || 60);
    const end = new Date(when.getTime() + duration * 60 * 1000);
    const free = await pickFreeProfessional(studioId, when, end);
    if (!free && await slotTaken(studioId, when, end, null)) {
      const alts = await suggestOtherSlots(studioId, when, duration);
      return alts.length
        ? `Esse horário já está ocupado. Tenho ${alts.join(", ")}. Qual prefere?`
        : "Esse horário já está ocupado. Pode escolher outro dia ou hora?";
    }
    if (typeof state.reschedule_id === "string") {
      const { data: old } = await supabase.from("appointments").select("id, title, start_time").eq("id", state.reschedule_id).maybeSingle();
      if (old) await cancelApt(old);
    }
    const professionalId = free?.id || null;
    const title = String(proc?.name || state.procedure_name || "Agendamento");
    const price = Number(proc?.price || state.price || 0);
    const { data: created, error } = await supabase.from("appointments").insert({
      studio_id: studioId,
      client_id: clientId,
      professional_id: professionalId,
      procedure_id: proc?.id || null,
      title,
      start_time: when.toISOString(),
      end_time: end.toISOString(),
      date: saoPauloYmd(when),
      status: "confirmed",
      price,
      payment_status: "pending",
      notes: "Criado pela SecretarIA no WhatsApp",
    }).select("id").single();
    if (error) {
      console.error(`[whatsapp-webhook] schedule insert failed: ${error.message}`);
      if (String(error.message || "").includes("appointments_no_overlap") || error.code === "23P01") {
        const alts = await suggestOtherSlots(studioId, when, duration);
        return alts.length ? `Esse horário acabou de ocupar. Que tal ${alts.join(" ou ")}?` : "Esse horário já está ocupado. Pode escolher outro?";
      }
      return "Não consegui gravar o horário agora. Nossa equipe confirma em instantes.";
    }
    await supabase.from("conversations").update({ ai_state: { last_appointment_id: created?.id } }).eq("id", conv.id);
    await supabase.from("notifications").insert({
      studio_id: studioId,
      client_id: clientId,
      type: "new_appointment",
      title: "Novo agendamento (WhatsApp)",
      content: `${title} em ${formatSaoPaulo(when)}`,
    });
    void notifyStudioStaff(
      supabase,
      studioId,
      `📅 Novo agendamento (automático)\n${clientName || "Cliente"} — ${title}\n${formatSaoPaulo(when)}`,
    );
    return `Pronto${clientName ? `, ${clientName}` : ""}! ${title} está agendado para ${formatSaoPaulo(when)}. Te esperamos. Se precisar cancelar, é só falar.`;
  }

  if (matchedProc) {
    await supabase.from("conversations").update({
      ai_state: { step: "scheduling", procedure_id: matchedProc.id, procedure_name: matchedProc.name, duration: matchedProc.duration, price: matchedProc.price },
    }).eq("id", conv.id);
    return `${matchedProc.name} é R$ ${Number(matchedProc.price).toFixed(0)} (${matchedProc.duration} min). Quer agendar? Me manda o dia e a hora.`;
  }

  const result = matchPattern(text, opts.patterns as any[], opts.customMessages as any[]);
  return result.response;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = await getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const webhookSecret = req.headers.get("X-Webhook-Secret");
    if (!webhookSecret) {
      return new Response(JSON.stringify({ error: "Missing webhook secret" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Validate against webhook_secret in app_secrets (not evolution_api_key)
    const { data: secretData } = await supabase.from("app_secrets").select("value").eq("key", "webhook_secret").maybeSingle();
    const storedSecret = secretData?.value;

    if (!storedSecret || storedSecret.length === 0) {
      console.error("[whatsapp-webhook] webhook_secret not configured in app_secrets");
      return new Response(JSON.stringify({ error: "Webhook secret not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (webhookSecret !== storedSecret) {
      console.error("[whatsapp-webhook] Invalid webhook secret received");
      return new Response(JSON.stringify({ error: "Invalid webhook secret" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const event = body?.event;
    const instanceName = body?.instance;

    // Handle QR code updated event
    if (event === "qrcode.updated" || event === "QRCODE_UPDATED") {
      console.log(`[whatsapp-webhook] QR code updated event for instance: ${instanceName}`);
      const d = body?.data;
      let base64 = "";
      if (d?.qrcode?.base64) base64 = d.qrcode.base64;
      else if (d?.base64) base64 = d.base64;
      else if (d?.qrcode?.code) base64 = d.qrcode.code;
      if (base64 && instanceName) {
        await supabase.from("evolution_api_connections")
          .update({ qr_code: base64, qr_code_updated_at: new Date().toISOString(), status: "connecting", error_message: "" })
          .eq("instance_name", instanceName);
        console.log(`[whatsapp-webhook] QR code saved for instance: ${instanceName}`);
      } else {
        console.warn(`[whatsapp-webhook] QR code updated event but no base64 found in payload`);
      }
      return new Response(JSON.stringify({ received: true, event }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Handle connection update event
    if (event === "connection.update" || event === "CONNECTION_UPDATE") {
      const d = body?.data;
      const state = (d?.state || d?.connection || "").toLowerCase();
      console.log(`[whatsapp-webhook] Connection update event for instance: ${instanceName}, state: ${state}`);
      if (state === "open") {
        const phone = (d?.wuid || d?.ownerJid || "").split("@")[0] || "";
        await supabase.from("evolution_api_connections")
          .update({ status: "connected", qr_code: "", qr_code_updated_at: null, last_connected_at: new Date().toISOString(), error_message: "", ...(phone ? { phone_number: phone } : {}) })
          .eq("instance_name", instanceName);
        console.log(`[whatsapp-webhook] Connection opened for instance: ${instanceName}`);
      } else if (state === "close") {
        await supabase.from("evolution_api_connections")
          .update({ status: "disconnected", qr_code: "" })
          .eq("instance_name", instanceName);
        console.log(`[whatsapp-webhook] Connection closed for instance: ${instanceName}`);
      }
      return new Response(JSON.stringify({ received: true, event }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (event !== "messages.upsert" && event !== "MESSAGES_UPSERT") {
      return new Response(JSON.stringify({ received: true, event }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const messageData = body?.data;
    if (messageData?.key?.fromMe) {
      return new Response(JSON.stringify({ received: true, ignored: "fromMe" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const remoteJid = messageData?.key?.remoteJid || "";
    if (remoteJid.includes("@g.us") || remoteJid.includes("status@broadcast") || remoteJid.includes("@broadcast")) {
      return new Response(JSON.stringify({ received: true, ignored: "group_or_status" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const from = remoteJid.replace("@s.whatsapp.net", "").replace("@c.us", "").replace(/\D/g, "");
    const text = messageData?.message?.conversation || messageData?.message?.extendedTextMessage?.text || "";
    const evolutionMessageId = messageData?.key?.id;

    if (!from || !text) {
      return new Response(JSON.stringify({ received: true, message: "No text message" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Find the studio by instance name
    const { data: conn } = await supabase.from("evolution_api_connections").select("studio_id, evolution_api_key, evolution_api_url").eq("instance_name", instanceName).maybeSingle();
    if (!conn?.studio_id) {
      console.log(`[whatsapp-webhook] Studio not found for instance: ${instanceName}`);
      return new Response(JSON.stringify({ received: true, message: "Studio not found" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const studioId = conn.studio_id;

    const digits = normalizePhone(from);
    const ors = phoneLookupValues(from).flatMap((v) => [`phone.eq.${v}`, `whatsapp.eq.${v}`]).join(",");
    const { data: matchedClients, error: clientLookupError } = await supabase.from("clients").select("id").eq("studio_id", studioId).or(ors).limit(1);
    if (clientLookupError) {
      console.error(`[whatsapp-webhook] Client lookup failed: ${clientLookupError.message}`);
      return new Response(JSON.stringify({ error: "Client lookup failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    let client = matchedClients?.[0] ?? null;
    const isNewClient = !client;
    if (!client) {
      const newClient = await supabase.from("clients").insert({ studio_id: studioId, name: from, phone: digits, whatsapp: digits, source: "whatsapp" }).select("id").single();
      client = newClient.data;
    }
    if (!client?.id) {
      console.error("[whatsapp-webhook] Failed to create client");
      return new Response(JSON.stringify({ error: "Failed to create client" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: matchedConvs } = await supabase.from("conversations").select("id, ai_enabled, ai_state").eq("studio_id", studioId).eq("client_id", client.id).limit(1);
    let conv = matchedConvs?.[0] ?? null;
    const isNewConv = !conv;
    if (!conv) {
      const newConv = await supabase.from("conversations").insert({ studio_id: studioId, client_id: client.id, channel: "whatsapp", status: "active", ai_enabled: true, ai_state: {} }).select("id, ai_enabled, ai_state").single();
      if (newConv.error && String(newConv.error.message || "").toLowerCase().includes("duplicate")) {
        const retry = await supabase.from("conversations").select("id, ai_enabled, ai_state").eq("studio_id", studioId).eq("client_id", client.id).limit(1);
        conv = retry.data?.[0] ?? null;
      } else {
        conv = newConv.data;
      }
    }
    if (!conv?.id) {
      console.error("[whatsapp-webhook] Failed to create conversation");
      return new Response(JSON.stringify({ error: "Failed to create conversation" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Dedup: check if a message with the same evolution_message_id already exists
    if (evolutionMessageId) {
      const { data: existingMsg } = await supabase.from("messages")
        .select("id")
        .eq("conversation_id", conv.id)
        .eq("metadata->>evolution_message_id", evolutionMessageId)
        .limit(1);

      if (existingMsg && existingMsg.length > 0) {
        console.log(`[whatsapp-webhook] Duplicate message ignored: evolution_message_id=${evolutionMessageId}`);
        return new Response(JSON.stringify({ received: true, dedup: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const { error: inMsgErr } = await supabase.from("messages").insert({
      conversation_id: conv.id,
      sender_type: "client",
      content: text,
      message_type: "text",
      metadata: { evolution_message_id: evolutionMessageId || null },
    });
    if (inMsgErr && String(inMsgErr.message || "").toLowerCase().includes("duplicate")) {
      return new Response(JSON.stringify({ received: true, dedup: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    await supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", conv.id);
    if (isNewConv || isNewClient) {
      await supabase.from("notifications").insert({
        studio_id: studioId,
        client_id: client.id,
        type: "whatsapp_message",
        title: "Nova conversa no WhatsApp",
        content: text.slice(0, 180),
      });
    }

    // If AI is enabled, generate and send response
    if (conv.ai_enabled) {
      const { data: aiSettings } = await supabase.from("ai_settings").select("ai_patterns, custom_messages, tom_voz, personalidade").eq("studio_id", studioId).maybeSingle();
      const patterns = aiSettings?.ai_patterns || [];
      const customMessages = aiSettings?.custom_messages || [];
      let response: string | null = null;
      const openaiKey = await getAppSecret("openai_api_key");
      if (openaiKey) {
        const { data: hist } = await supabase.from("messages")
          .select("sender_type, content")
          .eq("conversation_id", conv.id)
          .order("created_at", { ascending: false })
          .limit(16);
        const chronological = (hist || []).slice().reverse();
        const history = chronological.slice(0, -1)
          .filter((m) => m.sender_type === "client" || m.sender_type === "ai")
          .map((m) => ({
            role: (m.sender_type === "ai" ? "assistant" : "user") as "assistant" | "user",
            content: String(m.content || ""),
          }));
        const model = (await getAppSecret("openai_model")) || "gpt-4o-mini";
        response = await runGptSecretary({
          apiKey: openaiKey,
          model,
          supabase,
          studioId,
          clientId: client.id,
          convId: conv.id,
          userText: text,
          history,
          personalidade: aiSettings?.personalidade,
          tomVoz: aiSettings?.tom_voz,
        });
      }
      if (!response) {
        if (openaiKey) {
          response = "Tive um instável agora. Me manda de novo o que você quer — agendar, preço ou teus horários?";
        } else {
          response = await handleAiTurn({
            studioId,
            clientId: client.id,
            conv,
            text,
            patterns,
            customMessages,
          });
        }
      }
      if (!openaiKey) {
        const tom = (aiSettings?.tom_voz || "").toLowerCase();
        if (tom.includes("formal")) {
          response = response.replace(/!+/g, ".");
        }
      }

      const { data: aiMsg } = await supabase.from("messages").insert({
        conversation_id: conv.id,
        sender_type: "ai",
        content: response,
        message_type: "text",
        status: "pending",
      }).select("id").single();

      const sendRes = await fetch(`${conn.evolution_api_url}/message/sendText/${instanceName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: conn.evolution_api_key },
        body: JSON.stringify({ number: digits || from, text: response }),
      });
      if (aiMsg?.id) {
        await supabase.from("messages").update({ status: sendRes.ok ? "sent" : "failed" }).eq("id", aiMsg.id);
      }
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error(`[whatsapp-webhook] Unhandled error: ${err.message}`);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
