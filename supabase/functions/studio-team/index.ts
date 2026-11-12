import { createClient } from "npm:@supabase/supabase-js@2";
import { DEFAULT_ORIGIN, originAllowed } from "../_shared/cors.ts";


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


async function getCorsHeaders(req: Request): Promise<Record<string, string>> {
  const configured = await getAppSecret("allowed_origin");
  const allowlist = (configured || "").split(",").map((s) => s.trim()).filter(Boolean);
  const allowLocalhost = (await getAppSecret("cors_allow_localhost")) === "true";
  const requestOrigin = req.headers.get("Origin") || "";
  const origin = originAllowed(requestOrigin, allowlist, allowLocalhost) ? requestOrigin : (allowlist[0] || DEFAULT_ORIGIN);
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
      const { data: target } = await supabase.from("users").select("id, role").eq("id", memberId).eq("studio_id", me.studio_id).maybeSingle();
      if (!target) {
        return new Response(JSON.stringify({ error: "Pessoa não encontrada na equipe" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      // Access ends immediately: every RLS policy reads users.studio_id, which becomes null.
      await supabase.from("users").update({ studio_id: null, role: "removed", professional_id: null }).eq("id", memberId).eq("studio_id", me.studio_id);
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const email = String(body.email || "").trim().toLowerCase().slice(0, 254);
    const name = String(body.name || email).replace(/\s+/g, " ").trim().slice(0, 80);
    const role = ROLES.has(body.role) ? body.role : "reception";
    // Only a professional account is linked to a professional record.
    const professionalId = role === "professional" ? (body.professional_id || null) : null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(JSON.stringify({ error: "Informe um e-mail válido" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (role === "professional" && !professionalId) {
      return new Response(JSON.stringify({ error: "Vincule um profissional do cadastro" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (professionalId) {
      // The professional record must belong to THIS studio.
      const { data: prof } = await supabase.from("professionals").select("id").eq("id", String(professionalId)).eq("studio_id", me.studio_id).maybeSingle();
      if (!prof) {
        return new Response(JSON.stringify({ error: "Profissional não encontrado neste studio" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
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
      // The admin users endpoint does NOT filter by e-mail: it returns pages of ALL
      // users. Taking users[0] attached a random account to the studio. Search the
      // pages for the exact e-mail instead.
      for (let page = 1; page <= 50 && !userId; page++) {
        const { data: list, error: listError } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
        if (listError || !list?.users?.length) break;
        userId = list.users.find((u) => String(u.email || "").toLowerCase() === email)?.id;
        if (list.users.length < 1000) break;
      }
    }
    if (!userId) {
      return new Response(JSON.stringify({ error: "Não foi possível criar o convite" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (userId === me.id) {
      return new Response(JSON.stringify({ error: "Você não pode alterar o seu próprio acesso por convite" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { data: existingRow } = await supabase.from("users").select("id, studio_id, role, is_super_admin").eq("id", userId).maybeSingle();
    if (existingRow?.is_super_admin) {
      return new Response(JSON.stringify({ error: "Este e-mail não pode ser convidado" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
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
    console.error("[studio-team] unhandled", err);
    return new Response(JSON.stringify({ error: "Erro interno. Tente novamente." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
