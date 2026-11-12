// Receives payment events from Asaas and updates the studio subscription.
// Configure in Asaas (Integrações > Webhooks): URL of this function and the
// "token de autenticação" equal to app_secrets.asaas_webhook_token.
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const { data: secret } = await supabase.from("app_secrets").select("value").eq("key", "asaas_webhook_token").maybeSingle();
    const expected = String(secret?.value || "");
    const received = req.headers.get("asaas-access-token") || "";
    if (!expected || !safeEqual(received, expected)) return json({ error: "Invalid token" }, 401);

    const body = await req.json();
    const event = String(body?.event || "");
    const payment = body?.payment || {};
    const subscription = body?.subscription || {};
    const subscriptionId = String(payment.subscription || subscription.id || "");
    const externalRef = String(payment.externalReference || subscription.externalReference || "");

    // Find the studio by subscription id (preferred) or by the reference we sent.
    let studio: { id: string; subscription_status: string; past_due_since: string | null } | null = null;
    if (subscriptionId) {
      const { data } = await supabase.from("studios").select("id, subscription_status, past_due_since").eq("asaas_subscription_id", subscriptionId).maybeSingle();
      studio = data;
    }
    if (!studio && /^[0-9a-f-]{36}$/i.test(externalRef) && subscriptionId) {
      const { data } = await supabase.from("studios").select("id, subscription_status, past_due_since").eq("id", externalRef).maybeSingle();
      studio = data;
    }
    if (!studio) return json({ received: true, ignored: "unknown_subscription" });

    if (event === "PAYMENT_CONFIRMED" || event === "PAYMENT_RECEIVED") {
      await supabase.from("studios").update({ subscription_status: "active", past_due_since: null, trial_ends_at: null }).eq("id", studio.id);
    } else if (event === "PAYMENT_OVERDUE") {
      // Keep the original date so the 3-day warning period is not restarted.
      if (studio.subscription_status === "active" || studio.subscription_status === "trialing") {
        await supabase.from("studios").update({ subscription_status: "past_due", past_due_since: new Date().toISOString() }).eq("id", studio.id);
      }
    } else if (event === "PAYMENT_REFUNDED" || event === "PAYMENT_CHARGEBACK_REQUESTED") {
      await supabase.from("studios").update({ subscription_status: "past_due", past_due_since: studio.past_due_since || new Date().toISOString() }).eq("id", studio.id);
    } else if (event === "SUBSCRIPTION_DELETED" || event === "SUBSCRIPTION_INACTIVATED") {
      await supabase.from("studios").update({ subscription_status: "cancelled", asaas_subscription_id: null }).eq("id", studio.id);
    }

    await supabase.from("activity_logs").insert({ studio_id: studio.id, action: "asaas_event", entity_type: "billing", description: event.slice(0, 80) });
    return json({ received: true });
  } catch (err) {
    console.error("[asaas-webhook] unhandled", err);
    return json({ error: "Erro interno" }, 500);
  }
});
