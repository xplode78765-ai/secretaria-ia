// Studio subscription ("Meu plano"): status, subscribe, change plan, cancel.
// Charges are created in Asaas; the customer picks Pix, card or boleto on the
// Asaas invoice page. Payment confirmations arrive in the asaas-webhook function.
import { createClient } from "npm:@supabase/supabase-js@2";
import { DEFAULT_ORIGIN, originAllowed } from "../_shared/cors.ts";
import { asaas, asaasDate, getAsaasConfig } from "../_shared/asaas.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
    Vary: "Origin",
  };
}

function validCpfCnpj(v: string): boolean {
  return /^\d{11}$/.test(v) || /^\d{14}$/.test(v);
}

Deno.serve(async (req: Request) => {
  const corsHeaders = await getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Missing authorization" }, 401);
    const token = authHeader.replace("Bearer ", "");
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false } });
    const { data: { user }, error: authError } = await userClient.auth.getUser(token);
    if (authError || !user) return json({ error: "Invalid token" }, 401);

    const { data: me } = await supabase.from("users").select("id, studio_id, role, name, email").eq("id", user.id).maybeSingle();
    if (!me?.studio_id) return json({ error: "No studio found", code: "no_studio" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "status");

    const { data: studio } = await supabase.from("studios")
      .select("id, name, email, plan, subscription_status, trial_ends_at, past_due_since, asaas_customer_id, asaas_subscription_id")
      .eq("id", me.studio_id).maybeSingle();
    if (!studio) return json({ error: "No studio found", code: "no_studio" }, 403);
    const { data: plans } = await supabase.from("plans").select("id, name, audience, price_cents, ai_messages_month, features, sort").eq("active", true).order("sort");

    if (action === "status") {
      return json({
        plan: studio.plan,
        status: studio.subscription_status,
        trial_ends_at: studio.trial_ends_at,
        past_due_since: studio.past_due_since,
        has_subscription: !!studio.asaas_subscription_id,
        billing_ready: !!(await getAsaasConfig(supabase)),
        plans: plans || [],
      });
    }

    // Everything below changes the subscription: owner only.
    if (me.role !== "owner" && me.role !== "admin") return json({ error: "Apenas a dona do studio pode alterar o plano", code: "owner_only" }, 403);

    const cfg = await getAsaasConfig(supabase);
    if (!cfg) return json({ error: "Cobrança ainda não configurada", code: "billing_not_configured" }, 503);

    if (action === "subscribe" || action === "change_plan") {
      const plan = (plans || []).find((p) => p.id === String(body.plan || ""));
      if (!plan) return json({ error: "Plano inválido", code: "invalid_plan" }, 400);
      const value = Number(plan.price_cents) / 100;
      if (!(value > 0)) return json({ error: "Plano sem preço definido", code: "invalid_plan" }, 400);

      // Existing subscription: just change its value.
      if (studio.asaas_subscription_id) {
        let upd = await asaas(cfg, "PUT", `/subscriptions/${studio.asaas_subscription_id}`, { value, description: `SecretarIA ${plan.name}`, updatePendingPayments: true });
        if (!upd.ok && (upd.status === 404 || upd.status === 405)) {
          upd = await asaas(cfg, "POST", `/subscriptions/${studio.asaas_subscription_id}`, { value, description: `SecretarIA ${plan.name}`, updatePendingPayments: true });
        }
        if (!upd.ok) {
          console.error("[billing] change plan failed", upd.status, upd.error);
          return json({ error: "Não foi possível trocar o plano agora", code: "provider_error" }, 502);
        }
        await supabase.from("studios").update({ plan: plan.id }).eq("id", studio.id);
        return json({ ok: true, plan: plan.id });
      }

      // New subscription: Asaas requires the payer's CPF or CNPJ.
      const cpfCnpj = String(body.cpf_cnpj || "").replace(/\D/g, "");
      if (!validCpfCnpj(cpfCnpj)) return json({ error: "Informe um CPF ou CNPJ válido", code: "invalid_document" }, 400);

      let customerId = studio.asaas_customer_id as string | null;
      if (!customerId) {
        const created = await asaas<{ id?: string }>(cfg, "POST", "/customers", {
          name: String(studio.name || me.name || "Studio").slice(0, 100),
          email: user.email,
          cpfCnpj,
          externalReference: studio.id,
          notificationDisabled: false,
        });
        if (!created.ok || !created.data.id) {
          console.error("[billing] create customer failed", created.status, created.error);
          return json({ error: created.status === 400 ? "Dados de cobrança inválidos. Confira o CPF/CNPJ." : "Não foi possível iniciar a assinatura", code: "provider_error" }, 502);
        }
        customerId = created.data.id;
        await supabase.from("studios").update({ asaas_customer_id: customerId }).eq("id", studio.id);
      }

      const sub = await asaas<{ id?: string }>(cfg, "POST", "/subscriptions", {
        customer: customerId,
        billingType: "UNDEFINED", // the customer chooses Pix, card or boleto on the invoice
        value,
        nextDueDate: asaasDate(new Date()),
        cycle: "MONTHLY",
        description: `SecretarIA ${plan.name}`,
        externalReference: studio.id,
      });
      if (!sub.ok || !sub.data.id) {
        console.error("[billing] create subscription failed", sub.status, sub.error);
        return json({ error: "Não foi possível criar a assinatura", code: "provider_error" }, 502);
      }
      await supabase.from("studios").update({ asaas_subscription_id: sub.data.id, plan: plan.id }).eq("id", studio.id);

      // First invoice: where the owner pays.
      const pays = await asaas<{ data?: { invoiceUrl?: string }[] }>(cfg, "GET", `/subscriptions/${sub.data.id}/payments`);
      const invoiceUrl = pays.data?.data?.[0]?.invoiceUrl || null;
      return json({ ok: true, plan: plan.id, invoice_url: invoiceUrl });
    }

    if (action === "invoice") {
      if (!studio.asaas_subscription_id) return json({ error: "Sem assinatura", code: "no_subscription" }, 404);
      const pays = await asaas<{ data?: { invoiceUrl?: string; status?: string }[] }>(cfg, "GET", `/subscriptions/${studio.asaas_subscription_id}/payments?status=PENDING`);
      let url = pays.data?.data?.[0]?.invoiceUrl || null;
      if (!url) {
        const overdue = await asaas<{ data?: { invoiceUrl?: string }[] }>(cfg, "GET", `/subscriptions/${studio.asaas_subscription_id}/payments?status=OVERDUE`);
        url = overdue.data?.data?.[0]?.invoiceUrl || null;
      }
      return json({ invoice_url: url });
    }

    if (action === "cancel") {
      if (studio.asaas_subscription_id) {
        const del = await asaas(cfg, "DELETE", `/subscriptions/${studio.asaas_subscription_id}`);
        if (!del.ok && del.status !== 404) {
          console.error("[billing] cancel failed", del.status, del.error);
          return json({ error: "Não foi possível cancelar agora", code: "provider_error" }, 502);
        }
      }
      await supabase.from("studios").update({ subscription_status: "cancelled", asaas_subscription_id: null, past_due_since: null }).eq("id", studio.id);
      await supabase.from("activity_logs").insert({ studio_id: studio.id, user_id: user.id, action: "subscription_cancelled", entity_type: "billing", description: "Assinatura cancelada pela dona" });
      return json({ ok: true });
    }

    return json({ error: "Invalid action" }, 400);
  } catch (err) {
    console.error("[billing] unhandled", err);
    return json({ error: "Erro interno. Tente novamente." }, 500);
  }
});
