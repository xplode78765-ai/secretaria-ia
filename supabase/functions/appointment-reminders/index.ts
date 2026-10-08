import { createClient } from "npm:@supabase/supabase-js@2";

const DEFAULT_ORIGIN = "https://secretaria.app";
const TZ = "America/Sao_Paulo";

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
    if (host.endsWith(".bolt.new") || host.endsWith(".stackblitz.io") || host.endsWith(".netlify.app")) return true;
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

function saoPauloDayBounds(now = new Date()) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const start = new Date(`${day}T00:00:00-03:00`);
  const end = new Date(`${day}T23:59:59.999-03:00`);
  return { start, end, day };
}

async function ensureConversation(studioId: string, clientId: string) {
  const { data: existing } = await supabase.from("conversations").select("id").eq("studio_id", studioId).eq("client_id", clientId).limit(1);
  if (existing?.[0]?.id) return existing[0];
  const { data } = await supabase.from("conversations").insert({
    studio_id: studioId,
    client_id: clientId,
    channel: "whatsapp",
    status: "active",
    ai_enabled: true,
  }).select("id").single();
  return data;
}

async function reminderAlreadySent(conversationId: string, appointmentId: string, sinceIso: string, extraType?: string) {
  let query = supabase.from("messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("metadata->>appointment_id", appointmentId)
    .gte("created_at", sinceIso)
    .limit(1);
  if (extraType) query = query.eq("metadata->>type", extraType);
  else query = query.eq("metadata->>type", "appointment_reminder");
  const { data } = await query;
  return !!(data && data.length > 0);
}

async function sendWhatsApp(conn: { evolution_api_url: string; evolution_api_key: string; instance_name: string }, number: string, text: string) {
  await fetch(`${conn.evolution_api_url}/message/sendText/${conn.instance_name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: conn.evolution_api_key },
    body: JSON.stringify({ number, text }),
  });
}

Deno.serve(async (req: Request) => {
  const corsHeaders = await getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const cronSecret = req.headers.get("X-Cron-Secret");
    if (!cronSecret) {
      return new Response(JSON.stringify({ error: "Missing cron secret" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: secretData } = await supabase.from("app_secrets").select("value").eq("key", "cron_secret").maybeSingle();
    if (!secretData?.value || cronSecret !== secretData.value) {
      return new Response(JSON.stringify({ error: "Invalid cron secret" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const now = new Date();
    const { start: startOfToday, end: endOfToday } = saoPauloDayBounds(now);
    const startOfTodayIso = startOfToday.toISOString();
    const in1hStart = new Date(now.getTime() + 45 * 60 * 1000);
    const in1hEnd = new Date(now.getTime() + 75 * 60 * 1000);
    const in24hStart = new Date(now.getTime() + 23 * 60 * 60 * 1000);
    const in24hEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);
    const day7start = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    const day7end = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const yesterdayStart = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);

    const { data: connections } = await supabase.from("evolution_api_connections")
      .select("studio_id, instance_name, evolution_api_key, evolution_api_url, status")
      .eq("status", "connected");

    let sentCount = 0;
    const connByStudio: Record<string, NonNullable<typeof connections>[number]> = {};
    for (const c of connections || []) connByStudio[c.studio_id] = c;

    const { data: automations } = await supabase.from("automations").select("studio_id, trigger, enabled");
    const enabledByStudio: Record<string, Set<string>> = {};
    for (const a of automations || []) {
      if (!a.enabled) continue;
      if (!enabledByStudio[a.studio_id]) enabledByStudio[a.studio_id] = new Set();
      enabledByStudio[a.studio_id].add(a.trigger);
    }

    async function processAppointment(apt: {
      id: string;
      studio_id: string;
      client_id: string | null;
      title: string;
      start_time: string;
      clients?: { name?: string; phone?: string; whatsapp?: string } | null;
      professionals?: { name?: string; phone?: string } | null;
    }, reminderType: string, textBuilder: () => string) {
      if (!apt.client_id) return;
      const conn = connByStudio[apt.studio_id];
      if (!conn) return;
      const conv = await ensureConversation(apt.studio_id, apt.client_id);
      if (!conv?.id) return;
      if (await reminderAlreadySent(conv.id, apt.id, startOfTodayIso, reminderType)) return;
      const clientPhone = apt.clients?.whatsapp || apt.clients?.phone;
      if (!clientPhone) return;
      const reminderText = textBuilder();
      await sendWhatsApp(conn, clientPhone, reminderText);
      await supabase.from("messages").insert({
        conversation_id: conv.id,
        sender_type: "ai",
        content: reminderText,
        message_type: "text",
        metadata: { type: reminderType, appointment_id: apt.id },
      });
      if (apt.professionals?.phone) {
        await sendWhatsApp(conn, apt.professionals.phone, `Lembrete: ${apt.clients?.name} — ${apt.title}.`);
      }
      await supabase.from("notifications").insert({
        studio_id: apt.studio_id,
        client_id: apt.client_id,
        type: reminderType,
        title: "Lembrete enviado",
        content: `Lembrete enviado para ${apt.clients?.name} sobre ${apt.title}`,
      });
      sentCount++;
    }

    const { data: upcoming } = await supabase.from("appointments")
      .select("*, clients(name, phone, whatsapp), professionals(name, phone)")
      .in("status", ["pending", "confirmed"])
      .gte("start_time", now.toISOString())
      .lte("start_time", in24hEnd.toISOString());

    for (const apt of upcoming || []) {
      const triggers = enabledByStudio[apt.studio_id];
      const start = new Date(apt.start_time).getTime();
      const useDefaultToday = !triggers || triggers.size === 0;
      const startDate = new Date(apt.start_time);

      if ((useDefaultToday || triggers?.has("reminder_24h") || triggers?.has("reminder_1h")) && startDate >= startOfToday && startDate <= endOfToday) {
        if (useDefaultToday || triggers?.has("reminder_24h") || !triggers) {
          await processAppointment(apt, "appointment_reminder", () => `Olá ${apt.clients?.name || ""}! Lembrando do seu agendamento para ${apt.title} hoje. Te esperamos!`);
        }
      }
      if (triggers?.has("reminder_1h") && start >= in1hStart.getTime() && start <= in1hEnd.getTime()) {
        await processAppointment(apt, "appointment_reminder_1h", () => `Olá ${apt.clients?.name || ""}! Seu horário de ${apt.title} é daqui a pouco. Te esperamos!`);
      }
      if (triggers?.has("reminder_24h") && start >= in24hStart.getTime() && start <= in24hEnd.getTime()) {
        await processAppointment(apt, "appointment_reminder_24h", () => `Olá ${apt.clients?.name || ""}! Lembrando do seu agendamento de ${apt.title} amanhã. Qualquer imprevisto, é só avisar.`);
      }
    }

    const { data: doneWeek } = await supabase.from("appointments")
      .select("*, clients(name, phone, whatsapp)")
      .eq("status", "done")
      .gte("start_time", day7start.toISOString())
      .lte("start_time", day7end.toISOString());
    for (const apt of doneWeek || []) {
      if (!enabledByStudio[apt.studio_id]?.has("follow_up_7d")) continue;
      await processAppointment(apt, "follow_up_7d", () => `Olá ${apt.clients?.name || ""}! Já faz uma semana do seu ${apt.title}. Como você está? Qualquer dúvida, estamos aqui.`);
    }

    const { data: doneYesterday } = await supabase.from("appointments")
      .select("*, clients(name, phone, whatsapp)")
      .eq("status", "done")
      .gte("start_time", yesterdayStart.toISOString())
      .lt("start_time", startOfTodayIso);
    for (const apt of doneYesterday || []) {
      if (!enabledByStudio[apt.studio_id]?.has("post_procedure")) continue;
      await processAppointment(apt, "post_procedure", () => `Olá ${apt.clients?.name || ""}! Tudo bem após o ${apt.title}? Se precisar de orientação, é só responder aqui.`);
    }

    for (const days of [30, 60, 90] as const) {
      const trigger = `winback_${days}d`;
      const windowStart = new Date(now.getTime() - (days + 1) * 24 * 60 * 60 * 1000);
      const windowEnd = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      const { data: stale } = await supabase.from("appointments")
        .select("*, clients(name, phone, whatsapp)")
        .eq("status", "done")
        .gte("start_time", windowStart.toISOString())
        .lte("start_time", windowEnd.toISOString());
      for (const apt of stale || []) {
        if (!enabledByStudio[apt.studio_id]?.has(trigger)) continue;
        await processAppointment(apt, trigger, () => `Olá ${apt.clients?.name || ""}! Sentimos sua falta. Que tal agendar um retorno? É só responder esta mensagem.`);
      }
    }

    return new Response(JSON.stringify({ success: true, sent: sentCount }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
