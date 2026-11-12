import { createClient } from "npm:@supabase/supabase-js@2";
import { DEFAULT_ORIGIN, originAllowed } from "../_shared/cors.ts";
import { MFA_REQUIRED_ERROR, tokenAal } from "../_shared/jwt.ts";
import { msg, safeLocale } from "../_shared/messages.ts";
import { sendResendEmail, wrapEmail } from "../_shared/resend.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
    Vary: "Origin",
  };
}

Deno.serve(async (req: Request) => {
  const corsHeaders = await getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const token = authHeader.replace("Bearer ", "");
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false } });
    const { data: { user }, error: authError } = await userClient.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: me } = await supabase.from("users").select("id, email, name, is_super_admin, studio_id").eq("id", user.id).maybeSingle();
    const body = await req.json();
    const action = body.action;
    const apiKey = await getAppSecret("resend_api_key");
    const from = await getAppSecret("resend_from");
    if (!apiKey || !from) {
      return new Response(JSON.stringify({ error: "Resend ainda não configurado. Preencha resend_api_key e resend_from em app_secrets." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "welcome") {
      // Only to the address verified by Supabase Auth, only once per user, and with
      // name/studio read from the database (never from the request body).
      const to = user.email;
      if (!to || !me?.id) {
        return new Response(JSON.stringify({ error: "Sem e-mail no cadastro" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { data: claimed } = await supabase.from("users")
        .update({ welcome_email_sent_at: new Date().toISOString() })
        .eq("id", me.id)
        .is("welcome_email_sent_at", null)
        .select("id");
      if (!claimed || claimed.length === 0) {
        return new Response(JSON.stringify({ ok: true, skipped: "already_sent" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { data: studioRow } = me.studio_id
        ? await supabase.from("studios").select("name, locale").eq("id", me.studio_id).maybeSingle()
        : { data: null };
      // Language: the one the person signed up in (app sends "pt"/"es"), else the studio's.
      const L = body.lang === "es" || body.lang === "pt" ? body.lang : safeLocale(studioRow?.locale);
      const name = escapeHtml(String(me.name || "").slice(0, 80) || msg(L, "welcomeHi"));
      const studio = escapeHtml(String(studioRow?.name || "").slice(0, 120) || msg(L, "welcomeYourStudio"));
      const configured = ((await getAppSecret("allowed_origin")) || "").split(",").map((s) => s.trim()).find((s) => s.startsWith("https://"));
      const appUrl = configured || "https://usesecretaria.netlify.app";
      const html = wrapEmail(
        msg(L, "welcomeTitle", { name }),
        `<p>${msg(L, "welcomeBody1", { studio })}</p>
         <p>${msg(L, "welcomeBody2")}</p>
         <p><a href="${escapeHtml(appUrl)}" style="color:#b08d57;">${msg(L, "welcomeCta")}</a></p>`,
        msg(L, "welcomeFooter"),
      );
      const plainName = String(me.name || "").replace(/[\r\n]+/g, " ").slice(0, 80) || msg(L, "welcomeHi");
      const sent = await sendResendEmail({ apiKey, from, to, subject: msg(L, "welcomeSubject", { name: plainName }), html });
      if (!sent.ok) await supabase.from("users").update({ welcome_email_sent_at: null }).eq("id", me.id);
      return new Response(JSON.stringify({ ok: sent.ok }), { status: sent.ok ? 200 : 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!me?.is_super_admin) {
      return new Response(JSON.stringify({ error: "Apenas o admin da plataforma" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    // E-mailing every studio requires the second factor in this session.
    if (tokenAal(token) !== "aal2") {
      return new Response(JSON.stringify({ error: MFA_REQUIRED_ERROR }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "test") {
      const to = me.email || user.email;
      if (!to) return new Response(JSON.stringify({ error: "Seu usuário não tem e-mail" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const html = wrapEmail("Teste Resend", "<p>Se você está lendo isto, o Resend da SecretarIA está no ar.</p>");
      const sent = await sendResendEmail({ apiKey, from, to, subject: "Teste SecretarIA / Resend", html });
      return new Response(JSON.stringify({ ...sent, to }), { status: sent.ok ? 200 : 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "broadcast") {
      const subject = String(body.subject || "").trim();
      const message = String(body.message || "").trim();
      if (subject.length < 3 || message.length < 3) {
        return new Response(JSON.stringify({ error: "Assunto e texto são obrigatórios" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { data: studios } = await supabase.from("studios").select("email");
      const { data: owners } = await supabase.from("users").select("email").in("role", ["owner", "admin"]);
      const emails = [...new Set(
        [...(studios || []), ...(owners || [])]
          .map((r) => String(r.email || "").trim().toLowerCase())
          .filter((e) => e.includes("@")),
      )];
      if (emails.length === 0) {
        return new Response(JSON.stringify({ error: "Nenhum e-mail de studio/dona encontrado" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const html = wrapEmail(subject, `<p style="white-space:pre-wrap;">${message.replace(/</g, "&lt;")}</p>`);
      let sentCount = 0;
      const errors: string[] = [];
      for (const to of emails) {
        const sent = await sendResendEmail({ apiKey, from, to, subject, html });
        if (sent.ok) sentCount++;
        else errors.push(`${to}: ${sent.error}`);
      }
      await supabase.from("activity_logs").insert({
        user_id: user.id,
        action: "email_broadcast",
        entity_type: "mailer",
        description: `Promo/aviso: ${subject} (${sentCount}/${emails.length})`,
      });
      return new Response(JSON.stringify({ ok: errors.length === 0, sent: sentCount, total: emails.length, errors: errors.slice(0, 8) }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[mailer] unhandled", err);
    return new Response(JSON.stringify({ error: "Erro interno. Tente novamente." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
