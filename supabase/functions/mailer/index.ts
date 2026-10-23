import { createClient } from "npm:@supabase/supabase-js@2";
import { sendResendEmail, wrapEmail } from "../_shared/resend.ts";

const DEFAULT_ORIGIN = "https://secretaria.app";
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

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
  const allowlist = (configured || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowlist.includes(DEFAULT_ORIGIN)) allowlist.push(DEFAULT_ORIGIN);
  const requestOrigin = req.headers.get("Origin") || "";
  const origin = originAllowed(requestOrigin, allowlist) ? requestOrigin : (allowlist[0] || DEFAULT_ORIGIN);
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
      const to = me?.email || user.email;
      if (!to) {
        return new Response(JSON.stringify({ error: "Sem e-mail no cadastro" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const name = body.user_name || me?.name || "oi";
      const studio = body.studio_name || "seu studio";
      const appUrl = (await getAppSecret("allowed_origin")) || "https://secretaria-ia-studio-otpx.bolt.host";
      const html = wrapEmail(
        `Bem-vinda, ${name}`,
        `<p>Seu espaço na SecretarIA para <strong>${studio}</strong> já está pronto.</p>
         <p>Por lá você agenda pelo WhatsApp, vê o dia e recebe aviso no celular.</p>
         <p><a href="${appUrl}" style="color:#b08d57;">Abrir o app</a></p>`,
      );
      const sent = await sendResendEmail({ apiKey, from, to, subject: `Bem-vinda à SecretarIA, ${name}`, html });
      return new Response(JSON.stringify(sent), { status: sent.ok ? 200 : 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!me?.is_super_admin) {
      return new Response(JSON.stringify({ error: "Apenas o admin da plataforma" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
