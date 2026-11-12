// Helpers shared by the WhatsApp webhook, the GPT secretary and the reminders job:
// human hand-off, waitlist, Pix deposit, plan limits.
import { formatZoned, zonedYmd } from "./brazil.ts";
import { getEvolutionConfig, sendEvolutionText } from "./evolution.ts";
import { type Locale, msg } from "./messages.ts";
import { notifyStudioStaff } from "./staff-alert.ts";

type Sb = { from: (table: string) => any };

/** Marks the conversation for a person to answer and alerts the team. */
export async function flagHuman(supabase: Sb, opts: {
  studioId: string; convId: string; clientId: string; clientName: string; reason: string; locale: Locale;
}) {
  const reason = String(opts.reason || "").replace(/\s+/g, " ").trim().slice(0, 200) || "-";
  await supabase.from("conversations").update({ needs_human: true, needs_human_reason: reason }).eq("id", opts.convId);
  await supabase.from("notifications").insert({
    studio_id: opts.studioId,
    client_id: opts.clientId,
    type: "needs_human",
    title: msg(opts.locale, "notifHuman"),
    content: `${opts.clientName || msg(opts.locale, "client")}: ${reason}`,
  });
  void notifyStudioStaff(supabase, opts.studioId, msg(opts.locale, "staffHuman", { client: opts.clientName || msg(opts.locale, "client"), reason }));
}

/** Deposit (sinal) asked by the studio for this price; 0 when the studio does not use it. */
export function depositFor(studio: { deposit_percent?: number | null; pix_key?: string | null } | null, price: number): number {
  const pct = Number(studio?.deposit_percent || 0);
  if (!pct || !String(studio?.pix_key || "").trim() || !(price > 0)) return 0;
  return Math.round(price * pct) / 100;
}

/**
 * A slot opened (cancellation): tell the clients waiting for that day.
 * Each waiting client is notified once; the first to answer books through the AI.
 */
export async function notifyWaitlist(supabase: Sb, opts: {
  studioId: string; start: Date; tz: string; locale: Locale; skipClientId?: string;
}): Promise<number> {
  if (opts.start.getTime() <= Date.now()) return 0;
  const ymd = zonedYmd(opts.start, opts.tz);
  const { data: waiting } = await supabase.from("waitlist")
    .select("id, client_id, clients(name, phone, whatsapp)")
    .eq("studio_id", opts.studioId).eq("desired_date", ymd).eq("status", "waiting")
    .order("created_at").limit(5);
  if (!waiting?.length) return 0;
  const { data: conn } = await supabase.from("evolution_api_connections")
    .select("instance_name").eq("studio_id", opts.studioId).eq("status", "connected").maybeSingle();
  const evo = await getEvolutionConfig(supabase);
  if (!conn?.instance_name || !evo) return 0;

  const [dateText, timeText] = formatZoned(opts.start, opts.tz).split(", ");
  let sent = 0;
  for (const w of waiting) {
    if (w.client_id === opts.skipClientId) continue;
    const client = Array.isArray(w.clients) ? w.clients[0] : w.clients;
    const number = client?.whatsapp || client?.phone;
    if (!number) continue;
    const named = client?.name && !/^\d+$/.test(client.name) ? `, ${String(client.name).split(/\s+/)[0]}` : "";
    const text = msg(opts.locale, "waitlistOpen", { name: named, day: dateText.slice(0, 5), time: timeText || "" });
    const { data: convs } = await supabase.from("conversations").select("id").eq("studio_id", opts.studioId).eq("client_id", w.client_id).limit(1);
    const convId = convs?.[0]?.id;
    // Saved as pending BEFORE sending so the WhatsApp echo is recognised as ours.
    const { data: saved } = convId
      ? await supabase.from("messages").insert({ conversation_id: convId, sender_type: "ai", content: text, message_type: "text", status: "pending", metadata: { type: "waitlist" } }).select("id").single()
      : { data: null };
    const res = await sendEvolutionText(evo, conn.instance_name, number, text);
    if (saved?.id) await supabase.from("messages").update({ status: res.ok ? "sent" : "failed" }).eq("id", saved.id);
    if (!res.ok) continue;
    await supabase.from("waitlist").update({ status: "notified", notified_at: new Date().toISOString() }).eq("id", w.id);
    sent++;
  }
  if (sent > 0) {
    await supabase.from("notifications").insert({
      studio_id: opts.studioId,
      type: "waitlist",
      title: msg(opts.locale, "notifWaitlist"),
      content: msg(opts.locale, "notifWaitlistContent", { count: sent, when: formatZoned(opts.start, opts.tz) }),
    });
  }
  return sent;
}

/**
 * Sends a system message to a client and records it in the conversation as the
 * assistant BEFORE sending, so the WhatsApp echo (fromMe) is recognised as ours
 * and does not pause the AI. Creates the conversation when there is none.
 */
export async function sendSystemMessageToClient(supabase: Sb, opts: {
  studioId: string; clientId: string; number: string; text: string; type: string;
}): Promise<boolean> {
  const { data: conn } = await supabase.from("evolution_api_connections")
    .select("instance_name").eq("studio_id", opts.studioId).eq("status", "connected").maybeSingle();
  const evo = await getEvolutionConfig(supabase);
  if (!conn?.instance_name || !evo || !opts.number) return false;
  let convId: string | null = null;
  const { data: convs } = await supabase.from("conversations").select("id").eq("studio_id", opts.studioId).eq("client_id", opts.clientId).limit(1);
  convId = convs?.[0]?.id ?? null;
  if (!convId) {
    const created = await supabase.from("conversations")
      .insert({ studio_id: opts.studioId, client_id: opts.clientId, channel: "whatsapp", status: "active", ai_enabled: true, ai_state: {} })
      .select("id").single();
    convId = created.data?.id ?? null;
    if (!convId) {
      const retry = await supabase.from("conversations").select("id").eq("studio_id", opts.studioId).eq("client_id", opts.clientId).limit(1);
      convId = retry.data?.[0]?.id ?? null;
    }
  }
  const { data: saved } = convId
    ? await supabase.from("messages").insert({ conversation_id: convId, sender_type: "ai", content: opts.text, message_type: "text", status: "pending", metadata: { type: opts.type } }).select("id").single()
    : { data: null };
  const res = await sendEvolutionText(evo, conn.instance_name, opts.number, opts.text);
  if (saved?.id) await supabase.from("messages").update({ status: res.ok ? "sent" : "failed" }).eq("id", saved.id);
  if (convId && res.ok) await supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", convId);
  return res.ok;
}

export type StudioPlanInfo = { status: string; aiMonthlyLimit: number | null; features: string[] };

/** Subscription state and plan limits of a studio. */
export async function getStudioPlan(supabase: Sb, studioId: string): Promise<StudioPlanInfo> {
  const { data } = await supabase.from("studios").select("subscription_status, plan, plans(ai_messages_month, features)").eq("id", studioId).maybeSingle();
  const plan = Array.isArray(data?.plans) ? data.plans[0] : data?.plans;
  return {
    status: String(data?.subscription_status || "active"),
    aiMonthlyLimit: plan?.ai_messages_month ?? null,
    features: (plan?.features as string[] | undefined) || [],
  };
}

/** The AI (and automations) stop when the subscription is paused or cancelled. */
export function subscriptionAllowsAi(status: string): boolean {
  return status !== "paused" && status !== "cancelled";
}
