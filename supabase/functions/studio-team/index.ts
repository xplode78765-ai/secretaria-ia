import { createClient } from "npm:@supabase/supabase-js@2";

const DEFAULT_ORIGIN = "https://secretaria.app";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

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
  const allowlist = (configured || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowlist.includes(DEFAULT_ORIGIN)) allowlist.push(DEFAULT_ORIGIN);
  const requestOrigin = req.headers.get("Origin") || "";
  const origin = originAllowed(requestOrigin, allowlist) ? requestOrigin : (allowlist[0] || DEFAULT_ORIGIN);
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
    Vary: "Origin",
  };
}

const ROLES = new Set(["owner", "reception", "professional"]);

Deno.serve(async (req: Request) => {
  const corsHeaders = await getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const token = authHeader.replace("Bearer ", "");
    const userClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    const { data: { user }, error: authError } = await userClient.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: me } = await supabase.from("users").select("id, studio_id, role").eq("id", user.id).maybeSingle();
    if (!me?.studio_id || (me.role !== "owner" && me.role !== "admin")) {
      return new Response(JSON.stringify({ error: "Apenas a dona do studio pode gerenciar a equipe" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = req.method === "GET" ? { action: "list" } : await req.json();
    if (req.method === "GET" || body.action === "list") {
      const { data: members } = await supabase.from("users")
        .select("id, name, email, role, professional_id")
        .eq("studio_id", me.studio_id)
        .order("name");
      return new Response(JSON.stringify({ members: members || [] }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (req.method === "DELETE" || body.action === "remove") {
      const memberId = body.user_id;
      if (!memberId || memberId === me.id) {
        return new Response(JSON.stringify({ error: "Não é possível remover esta conta" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      await supabase.from("users").update({ studio_id: null, role: "removed" }).eq("id", memberId).eq("studio_id", me.studio_id);
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const email = String(body.email || "").trim().toLowerCase();
    const name = String(body.name || email).trim();
    const role = ROLES.has(body.role) ? body.role : "reception";
    const professionalId = body.professional_id || null;
    if (!email) {
      return new Response(JSON.stringify({ error: "Informe o e-mail" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (role === "professional" && !professionalId) {
      return new Response(JSON.stringify({ error: "Vincule um profissional do cadastro" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: invited, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
      data: { studio_id: me.studio_id, role, name },
    });
    if (inviteError && !String(inviteError.message).includes("already")) {
      return new Response(JSON.stringify({ error: inviteError.message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let userId = invited?.user?.id;
    if (!userId) {
      const { data: existing } = await supabase.from("users").select("id, studio_id, role").eq("email", email).maybeSingle();
      userId = existing?.id;
      if (existing?.studio_id && existing.studio_id !== me.studio_id && existing.role !== "removed") {
        return new Response(JSON.stringify({ error: "Este e-mail já pertence a outro studio" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }
    if (!userId) {
      const adminRes = await fetch(`${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
        headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey },
      });
      if (adminRes.ok) {
        const adminJson = await adminRes.json();
        userId = adminJson?.users?.[0]?.id || adminJson?.id || null;
      }
    }
    if (!userId) {
      return new Response(JSON.stringify({ error: "Não foi possível criar o convite" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: existingRow } = await supabase.from("users").select("id, studio_id, role").eq("id", userId).maybeSingle();
    if (existingRow?.studio_id && existingRow.studio_id !== me.studio_id && existingRow.role !== "removed") {
      return new Response(JSON.stringify({ error: "Este e-mail já pertence a outro studio" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (existingRow) {
      await supabase.from("users").update({
        studio_id: me.studio_id,
        name,
        role,
        professional_id: professionalId,
      }).eq("id", userId);
    } else {
      await supabase.from("users").insert({
        id: userId,
        studio_id: me.studio_id,
        email,
        name,
        role,
        professional_id: professionalId,
      });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
