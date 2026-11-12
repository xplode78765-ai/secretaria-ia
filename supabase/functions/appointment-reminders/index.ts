import { createClient } from "npm:@supabase/supabase-js@2";
import { DEFAULT_ORIGIN, originAllowed } from "../_shared/cors.ts";
import { formatZoned, zonedDayBounds, zonedHour, zonedYmd, safeTz } from "../_shared/brazil.ts";
import { notifyStudioStaff } from "../_shared/staff-alert.ts";
import { type Locale, msg, safeLocale } from "../_shared/messages.ts";
import { subscriptionAllowsAi } from "../_shared/sales.ts";
import { type EvolutionConfig, getEvolutionConfig, sendEvolutionText } from "../_shared/evolution.ts";


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


async function getCorsHeaders(req: Request): Promise<Record<string, string>> {
  const configured = await getAppSecret("allowed_origin");
  const allowlist = (configured || "").split(",").map((s) => s.trim()).filter(Boolean);
  const allowLocalhost = (await getAppSecret("cors_allow_localhost")) === "true";
  const requestOrigin = req.headers.get("Origin") || "";
  const origin = originAllowed(requestOrigin, allowlist, allowLocalhost) ? requestOrigin : (allowlist[0] || DEFAULT_ORIGIN);
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Webhook-Secret, X-Cron-Secret",
    Vary: "Origin",
  };
}

async function ensureConversation(studioId: string, clientId: string) {
  const { data: existing } = await supabase.from("conversations").select("id").eq("studio_id", studioId).eq("client_id", clientId).limit(1);
  if (existing?.[0]?.id) return existing[0];
  const inserted = await supabase.from("conversations").insert({
    studio_id: studioId,
    client_id: clientId,
    channel: "whatsapp",
    status: "active",
    ai_enabled: true,
  }).select("id").single();
  if (inserted.data?.id) return inserted.data;
  const { data: retry } = await supabase.from("conversations").select("id").eq("studio_id", studioId).eq("client_id", clientId).limit(1);
  return retry?.[0] ?? null;
}

// Has this reminder type ever been sent (or is it being sent) for this appointment?
// Not limited to "today": windows that cross midnight used to send it twice.
async function reminderAlreadySent(conversationId: string, appointmentId: string, types: string[]) {
  const { data } = await supabase.from("messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("metadata->>appointment_id", appointmentId)
    .in("metadata->>type", types)
    .neq("status", "failed")
    .limit(1);
  return !!(data && data.length > 0);
}

// Promotional messages (win-back, birthday): at most this many per studio per hour,
// only to clients who already wrote to the studio and did not opt out ("SAIR").
const MARKETING_MAX_PER_HOUR = 50;
// Subscription: days of warning between "payment missing" and pausing the AI.
const PAST_DUE_GRACE_DAYS = 3;

// Client-facing messages only go out between 08:00 and 19:59 (São Paulo).
const CLIENT_SEND_FROM_HOUR = 8;
const CLIENT_SEND_UNTIL_HOUR = 20;
// Appointments booked less than this before the run don't get a reminder: the
// client just talked to the studio.
const MIN_AGE_FOR_REMINDER_MS = 2 * 60 * 60 * 1000;

// Save the message as "pending" BEFORE sending, so the WhatsApp echo (fromMe) is
// recognised by the webhook as ours and does not pause the AI.
async function sendAndLog(conn: { instance_name: string }, conversationId: string, number: string, text: string, metadata: Record<string, unknown>) {
  const { data: msg, error } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender_type: "ai",
    content: text,
    message_type: "text",
    status: "pending",
    metadata,
  }).select("id").single();
  if (error || !msg?.id) return false;
  const ok = await sendWhatsApp(conn, number, text);
  await supabase.from("messages").update({ status: ok ? "sent" : "failed" }).eq("id", msg.id);
  return ok;
}

let evoConfig: EvolutionConfig | null = null;

// PostgREST returns at most 1000 rows per request: read every page.
// deno-lint-ignore no-explicit-any
async function fetchAllRows(page: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: { message: string } | null }>) {
  // deno-lint-ignore no-explicit-any
  const out: any[] = [];
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) { console.error("[appointment-reminders] query failed", error.message); break; }
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function sendWhatsApp(conn: { instance_name: string }, number: string, text: string) {
  if (!evoConfig) return false;
  const res = await sendEvolutionText(evoConfig, conn.instance_name, number, text);
  return res.ok;
}

// Subscription life cycle (runs every hour with the reminders):
//   trial over            -> past_due (AI keeps working, owner is warned)
//   past_due for 3 days   -> paused   (AI and automations stop)
// Payments confirmed by the Asaas webhook put the studio back to "active".
async function runBillingSweep(now: Date) {
  const out = { trialEnded: 0, warned: 0, paused: 0 };
  const alert = async (studio: { id: string; locale: string }, key: "billTrialEnded" | "billPastDue" | "billPaused", vars: Record<string, string | number> = {}) => {
    const L = safeLocale(studio.locale);
    const text = msg(L, key, vars);
    await supabase.from("notifications").insert({ studio_id: studio.id, type: "billing", title: msg(L, "notifBilling"), content: text });
    await notifyStudioStaff(supabase, studio.id, text).catch(() => false);
  };

  const { data: ended } = await supabase.from("studios").select("id, locale")
    .eq("subscription_status", "trialing").lt("trial_ends_at", now.toISOString());
  for (const st of ended || []) {
    const { data: moved } = await supabase.from("studios")
      .update({ subscription_status: "past_due", past_due_since: now.toISOString() })
      .eq("id", st.id).eq("subscription_status", "trialing").select("id");
    if (moved?.length) { await alert(st, "billTrialEnded"); out.trialEnded++; }
  }

  const { data: late } = await supabase.from("studios").select("id, locale, past_due_since").eq("subscription_status", "past_due");
  for (const st of late || []) {
    const since = st.past_due_since ? new Date(st.past_due_since).getTime() : now.getTime();
    const daysLate = (now.getTime() - since) / (24 * 60 * 60 * 1000);
    if (daysLate >= PAST_DUE_GRACE_DAYS) {
      const { data: moved } = await supabase.from("studios").update({ subscription_status: "paused" })
        .eq("id", st.id).eq("subscription_status", "past_due").select("id");
      if (moved?.length) { await alert(st, "billPaused"); out.paused++; }
      continue;
    }
    // One warning per day while the payment is missing.
    const { data: warnedToday } = await supabase.from("notifications").select("id")
      .eq("studio_id", st.id).eq("type", "billing")
      .gte("created_at", new Date(now.getTime() - 23 * 60 * 60 * 1000).toISOString()).limit(1);
    if (!warnedToday?.length) {
      await alert(st, "billPastDue", { days: Math.max(1, Math.ceil(PAST_DUE_GRACE_DAYS - daysLate)) });
      out.warned++;
    }
  }
  return out;
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
    const in1hStart = new Date(now.getTime() + 45 * 60 * 1000);
    const in1hEnd = new Date(now.getTime() + 75 * 60 * 1000);
    const in24hStart = new Date(now.getTime() + 23 * 60 * 60 * 1000);
    const in24hEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);
    const day7start = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    const day7end = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const billing = await runBillingSweep(now);

    evoConfig = await getEvolutionConfig(supabase);
    if (!evoConfig) {
      return new Response(JSON.stringify({ error: "evolution_api_url/evolution_api_key missing in app_secrets" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: connections } = await supabase.from("evolution_api_connections")
      .select("studio_id, instance_name, phone_number, status")
      .eq("status", "connected");

    let sentCount = 0;
    const connByStudio: Record<string, NonNullable<typeof connections>[number]> = {};
    for (const c of connections || []) connByStudio[c.studio_id] = c;

    // "Today", the local hour (quiet hours, 7h/20h digests) and day labels are
    // computed in EACH studio's own timezone.
    type StudioClock = { tz: string; locale: Locale; features: string[]; start: Date; end: Date; startIso: string; day: string; hour: number; clientHoursOk: boolean };
    const clockByStudio: Record<string, StudioClock> = {};
    const studioIds = Object.keys(connByStudio);
    const { data: studioRows } = studioIds.length
      ? await supabase.from("studios").select("id, timezone, locale, subscription_status, plans(features)").in("id", studioIds)
      : { data: [] as { id: string; timezone: string; locale: string; subscription_status: string; plans: { features: string[] } | { features: string[] }[] | null }[] };
    for (const s of studioRows || []) {
      // Paused / cancelled subscription: nothing is sent for this studio.
      if (!subscriptionAllowsAi(String(s.subscription_status || "active"))) { delete connByStudio[s.id]; continue; }
      const planRow = Array.isArray(s.plans) ? s.plans[0] : s.plans;
      const tz = safeTz(s.timezone);
      const { start, end, day } = zonedDayBounds(now, tz);
      const hour = zonedHour(now, tz);
      clockByStudio[s.id] = {
        tz, locale: safeLocale(s.locale), features: planRow?.features || [], start, end, day, hour, startIso: start.toISOString(),
        clientHoursOk: hour >= CLIENT_SEND_FROM_HOUR && hour < CLIENT_SEND_UNTIL_HOUR,
      };
    }

    const { data: automations } = await supabase.from("automations").select("studio_id, trigger, enabled");
    const enabledByStudio: Record<string, Set<string>> = {};
    const dayOfOff = new Set<string>();
    const dayOfOn = new Set<string>();
    for (const a of automations || []) {
      if (a.trigger === "reminder_day_of") {
        if (a.enabled) dayOfOn.add(a.studio_id);
        else dayOfOff.add(a.studio_id);
      }
      if (!a.enabled) continue;
      if (!enabledByStudio[a.studio_id]) enabledByStudio[a.studio_id] = new Set();
      enabledByStudio[a.studio_id].add(a.trigger);
    }

    for (const [studioId, set] of Object.entries(enabledByStudio)) {
      if (clockByStudio[studioId]?.features.includes("automations")) continue;
      for (const trigger of [...set]) if (!trigger.startsWith("reminder_")) set.delete(trigger);
    }

    // Promotional sends in the last hour, per studio (loaded on first use).
    const marketingSent: Record<string, number> = {};
    async function marketingAllowed(studioId: string, clientId: string, convId: string): Promise<boolean> {
      const { data: c } = await supabase.from("clients").select("marketing_opt_out").eq("id", clientId).maybeSingle();
      if (c?.marketing_opt_out) return false;
      // Only clients who already talked to the studio on WhatsApp.
      const { data: wrote } = await supabase.from("messages").select("id").eq("conversation_id", convId).eq("sender_type", "client").limit(1);
      if (!wrote?.length) return false;
      if (marketingSent[studioId] === undefined) {
        const { count } = await supabase.from("messages")
          .select("id, conversations!inner(studio_id)", { count: "exact", head: true })
          .eq("conversations.studio_id", studioId)
          .eq("metadata->>marketing", "true")
          .gte("created_at", new Date(now.getTime() - 60 * 60 * 1000).toISOString());
        marketingSent[studioId] = count ?? 0;
      }
      return marketingSent[studioId] < MARKETING_MAX_PER_HOUR;
    }

    const T = (studioId: string, key: Parameters<typeof msg>[1], vars?: Record<string, string | number>) =>
      msg(clockByStudio[studioId]?.locale ?? "pt", key, vars);

    async function processAppointment(apt: {
      id: string;
      studio_id: string;
      client_id: string | null;
      title: string;
      start_time: string;
      created_at?: string;
      clients?: { name?: string; phone?: string; whatsapp?: string } | null;
      professionals?: { name?: string; phone?: string } | null;
    }, reminderType: string, textBuilder: () => string, opts: { skipIfSent?: string[]; requireAge?: boolean; marketing?: boolean } = {}) {
      if (!clockByStudio[apt.studio_id]?.clientHoursOk) return; // never message clients at night (studio time)
      if (!apt.client_id) return;
      if (opts.requireAge && apt.created_at && now.getTime() - new Date(apt.created_at).getTime() < MIN_AGE_FOR_REMINDER_MS) return;
      const conn = connByStudio[apt.studio_id];
      if (!conn) return;
      const conv = await ensureConversation(apt.studio_id, apt.client_id);
      if (!conv?.id) return;
      if (await reminderAlreadySent(conv.id, apt.id, [reminderType, ...(opts.skipIfSent || [])])) return;
      const clientPhone = apt.clients?.whatsapp || apt.clients?.phone;
      if (!clientPhone) return;
      if (opts.marketing && !(await marketingAllowed(apt.studio_id, apt.client_id, conv.id))) return;
      const reminderText = textBuilder() + (opts.marketing ? T(apt.studio_id, "optOutFooter") : "");
      const sent = await sendAndLog(conn, conv.id, clientPhone, reminderText, { type: reminderType, appointment_id: apt.id, ...(opts.marketing ? { marketing: true } : {}) });
      if (!sent) return;
      if (opts.marketing) marketingSent[apt.studio_id] = (marketingSent[apt.studio_id] ?? 0) + 1;
      // Only appointment reminders wait for a "1 / 2" answer.
      if (reminderType.startsWith("appointment_reminder")) {
        await supabase.from("conversations").update({
          ai_state: { step: "awaiting_confirm", appointment_id: apt.id },
        }).eq("id", conv.id);
      }
      if (reminderType.startsWith("appointment_reminder") && apt.professionals?.phone) {
        await sendWhatsApp(conn, apt.professionals.phone, T(apt.studio_id, "remProfessional", { client: apt.clients?.name || T(apt.studio_id, "client"), title: apt.title }));
      }
      await supabase.from("notifications").insert({
        studio_id: apt.studio_id,
        client_id: apt.client_id,
        type: reminderType,
        title: T(apt.studio_id, "notifReminderSent"),
        content: T(apt.studio_id, "notifReminderContent", { client: apt.clients?.name || T(apt.studio_id, "client"), title: apt.title }),
      });
      sentCount++;
    }

    const upcoming = await fetchAllRows((from, to) => supabase.from("appointments")
      .select("*, clients(name, phone, whatsapp), professionals(name, phone)")
      .in("status", ["pending", "confirmed"])
      .gte("start_time", now.toISOString())
      .lte("start_time", in24hEnd.toISOString())
      .order("id")
      .range(from, to));

    for (const apt of upcoming || []) {
      const triggers = enabledByStudio[apt.studio_id];
      const start = new Date(apt.start_time).getTime();
      const sendDayOf = dayOfOn.has(apt.studio_id) || !dayOfOff.has(apt.studio_id);
      const startDate = new Date(apt.start_time);
      const clock = clockByStudio[apt.studio_id];
      if (!clock) continue;

      if (sendDayOf && startDate >= clock.start && startDate <= clock.end) {
        // Skipped if the 24h reminder already went out: one reminder per day is enough.
        await processAppointment(apt, "appointment_reminder", () => T(apt.studio_id, "remDayOf", { name: apt.clients?.name || "", title: apt.title }), { skipIfSent: ["appointment_reminder_24h"], requireAge: true });
      }
      if (triggers?.has("reminder_1h") && start >= in1hStart.getTime() && start <= in1hEnd.getTime()) {
        await processAppointment(apt, "appointment_reminder_1h", () => T(apt.studio_id, "rem1h", { name: apt.clients?.name || "", title: apt.title }), { requireAge: true });
      }
      if (triggers?.has("reminder_24h") && start >= in24hStart.getTime() && start <= in24hEnd.getTime()) {
        await processAppointment(apt, "appointment_reminder_24h", () => T(apt.studio_id, "rem24h", { name: apt.clients?.name || "", title: apt.title }), { requireAge: true });
      }
    }

    const doneWeek = await fetchAllRows((from, to) => supabase.from("appointments")
      .select("*, clients(name, phone, whatsapp)")
      .eq("status", "done")
      .gte("start_time", day7start.toISOString())
      .lte("start_time", day7end.toISOString())
      .order("id")
      .range(from, to));
    for (const apt of doneWeek || []) {
      if (!enabledByStudio[apt.studio_id]?.has("follow_up_7d")) continue;
      await processAppointment(apt, "follow_up_7d", () => T(apt.studio_id, "remFollow7", { name: apt.clients?.name || "", title: apt.title }));
    }

    // Wide window (covers every timezone), then "yesterday" is checked per studio.
    const doneYesterday = await fetchAllRows((from, to) => supabase.from("appointments")
      .select("*, clients(name, phone, whatsapp)")
      .eq("status", "done")
      .gte("start_time", new Date(now.getTime() - 50 * 60 * 60 * 1000).toISOString())
      .lt("start_time", now.toISOString())
      .order("id")
      .range(from, to));
    for (const apt of doneYesterday || []) {
      if (!enabledByStudio[apt.studio_id]?.has("post_procedure")) continue;
      const clock = clockByStudio[apt.studio_id];
      if (!clock) continue;
      const t = new Date(apt.start_time).getTime();
      if (t < clock.start.getTime() - 24 * 60 * 60 * 1000 || t >= clock.start.getTime()) continue;
      await processAppointment(apt, "post_procedure", () => T(apt.studio_id, "remPost", { name: apt.clients?.name || "", title: apt.title }));
    }

    for (const days of [30, 60, 90] as const) {
      const trigger = `winback_${days}d`;
      const windowStart = new Date(now.getTime() - (days + 1) * 24 * 60 * 60 * 1000);
      const windowEnd = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      const stale = await fetchAllRows((from, to) => supabase.from("appointments")
        .select("*, clients(name, phone, whatsapp)")
        .eq("status", "done")
        .gte("start_time", windowStart.toISOString())
        .lte("start_time", windowEnd.toISOString())
        .order("id")
        .range(from, to));
      for (const apt of stale || []) {
        if (!enabledByStudio[apt.studio_id]?.has(trigger)) continue;
        if (!apt.client_id) continue;
        // Only clients who did NOT come back: skip if there is any later appointment
        // (done or still scheduled) after this one.
        const { data: later } = await supabase.from("appointments")
          .select("id")
          .eq("studio_id", apt.studio_id)
          .eq("client_id", apt.client_id)
          .neq("status", "cancelled")
          .gt("start_time", apt.start_time)
          .limit(1);
        if (later && later.length > 0) continue;
        await processAppointment(apt, trigger, () => T(apt.studio_id, "remWinback", { name: apt.clients?.name || "" }), { marketing: true });
      }
    }

    // birthday is a DATE column: `.like()` failed silently. The lookup now happens in
    // SQL against "today" in each studio's timezone (public.birthday_clients_today).
    const { data: birthdayClients, error: birthdayErr } = await supabase.rpc("birthday_clients_today");
    if (birthdayErr) console.error("[appointment-reminders] birthday lookup failed", birthdayErr.message);
    for (const client of (birthdayClients || []) as { id: string; studio_id: string; name: string; phone: string; whatsapp: string }[]) {
      if (!enabledByStudio[client.studio_id]?.has("birthday")) continue;
      const clock = clockByStudio[client.studio_id];
      if (!clock?.clientHoursOk) continue;
      const conv = await ensureConversation(client.studio_id, client.id);
      if (!conv?.id) continue;
      const sinceIso = clock.startIso;
      const { data: already } = await supabase.from("messages")
        .select("id")
        .eq("conversation_id", conv.id)
        .eq("metadata->>type", "birthday")
        .neq("status", "failed")
        .gte("created_at", sinceIso)
        .limit(1);
      if (already && already.length > 0) continue;
      const conn = connByStudio[client.studio_id];
      if (!conn) continue;
      const number = client.whatsapp || client.phone;
      if (!number) continue;
      if (!(await marketingAllowed(client.studio_id, client.id, conv.id))) continue;
      const text = T(client.studio_id, "remBirthday", { name: client.name }) + T(client.studio_id, "optOutFooter");
      const sent = await sendAndLog(conn, conv.id, number, text, { type: "birthday", marketing: true });
      if (!sent) continue;
      marketingSent[client.studio_id] = (marketingSent[client.studio_id] ?? 0) + 1;
      sentCount++;
    }

    // Staff digests at 07h and 20h on each studio's own clock.
    for (const studioId of Object.keys(connByStudio)) {
      const clock = clockByStudio[studioId];
      if (!clock || clock.hour !== 7) continue;
      const { tz, day, startIso: startOfTodayIso, end: endOfToday } = clock;
      {
        const { data: already } = await supabase.from("notifications")
          .select("id")
          .eq("studio_id", studioId)
          .eq("type", "staff_digest_morning")
          .gte("created_at", startOfTodayIso)
          .limit(1);
        if (already && already.length > 0) continue;
        const { data: todays } = await supabase.from("appointments")
          .select("title, start_time, status, clients(name)")
          .eq("studio_id", studioId)
          .neq("status", "cancelled")
          .gte("start_time", startOfTodayIso)
          .lte("start_time", endOfToday.toISOString())
          .order("start_time");
        const lines = (todays || []).map((apt) => {
          const client = Array.isArray(apt.clients) ? apt.clients[0] : apt.clients;
          const when = formatZoned(new Date(apt.start_time), tz).split(" ")[1] || formatZoned(new Date(apt.start_time), tz);
          return T(studioId, "digestMorningLine", { time: when, client: client?.name || T(studioId, "client"), title: apt.title });
        });
        const text = lines.length
          ? T(studioId, "digestMorning", { day, lines: lines.join("\n") })
          : T(studioId, "digestMorningEmpty", { day });
        const sent = await notifyStudioStaff(supabase, studioId, text, connByStudio[studioId]);
        if (!sent) continue;
        await supabase.from("notifications").insert({
          studio_id: studioId,
          type: "staff_digest_morning",
          title: T(studioId, "notifDigestMorning"),
          content: text,
        });
        sentCount++;
      }
    }

    for (const studioId of Object.keys(connByStudio)) {
      const clock = clockByStudio[studioId];
      if (!clock || clock.hour !== 20) continue;
      const { day, startIso: startOfTodayIso, end: endOfToday } = clock;
      {
        const { data: already } = await supabase.from("notifications")
          .select("id")
          .eq("studio_id", studioId)
          .eq("type", "staff_digest_evening")
          .gte("created_at", startOfTodayIso)
          .limit(1);
        if (already && already.length > 0) continue;
        const { data: todays } = await supabase.from("appointments")
          .select("title, start_time, status, clients(name)")
          .eq("studio_id", studioId)
          .gte("start_time", startOfTodayIso)
          .lte("start_time", endOfToday.toISOString())
          .order("start_time");
        const list = todays || [];
        const done = list.filter((a) => a.status === "done").length;
        const cancelled = list.filter((a) => a.status === "cancelled").length;
        const confirmed = list.filter((a) => a.status === "confirmed" || a.status === "pending").length;
        const lines = list.map((apt) => {
          const client = Array.isArray(apt.clients) ? apt.clients[0] : apt.clients;
          const label = T(studioId, apt.status === "cancelled" ? "labelCancelled" : apt.status === "done" ? "labelDone" : "labelOpen");
          return T(studioId, "digestEveningLine", { client: client?.name || T(studioId, "client"), title: apt.title, label });
        });
        const { data: stats } = await supabase.rpc("studio_ai_stats", { p_studio: studioId, p_from: startOfTodayIso });
        const aiLine = stats && (Number(stats.ai_replies) > 0 || Number(stats.ai_bookings) > 0)
          ? T(studioId, "digestAi", { replies: Number(stats.ai_replies) || 0, bookings: Number(stats.ai_bookings) || 0 })
          : "";
        const text = T(studioId, "digestEvening", { day, done, open: confirmed, cancelled, lines: lines.length ? lines.join("\n") : T(studioId, "digestEveningEmpty") }) + aiLine;
        const sent = await notifyStudioStaff(supabase, studioId, text, connByStudio[studioId]);
        if (!sent) continue;
        await supabase.from("notifications").insert({
          studio_id: studioId,
          type: "staff_digest_evening",
          title: T(studioId, "notifDigestEvening"),
          content: text,
        });
        sentCount++;
      }
    }

    return new Response(JSON.stringify({ success: true, sent: sentCount, billing }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[appointment-reminders] unhandled", err);
    return new Response(JSON.stringify({ error: "Erro interno. Tente novamente." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
