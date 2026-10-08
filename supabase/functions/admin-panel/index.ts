import { createClient } from "npm:@supabase/supabase-js@2";

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

    // Check is_super_admin
    const { data: userData } = await supabase.from("users").select("is_super_admin, studio_id").eq("id", user.id).maybeSingle();
    if (!userData?.is_super_admin) {
      // Log access attempt
      await supabase.from("activity_logs").insert({
        studio_id: userData?.studio_id || null,
        user_id: user.id,
        action: "admin_access_denied",
        entity_type: "admin_panel",
        description: "Attempted to access admin panel without super admin privileges",
      });
      return new Response(JSON.stringify({ error: "Access denied" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Log admin access
    await supabase.from("activity_logs").insert({
      studio_id: userData?.studio_id || null,
      user_id: user.id,
      action: "admin_panel_access",
      entity_type: "admin_panel",
      description: "Accessed admin panel",
    });

    const body = await req.json();
    const action = body.action;

    if (action === "overview") {
      const { data: studios } = await supabase.from("studios").select("*").order("created_at", { ascending: false });
      const { data: allClients } = await supabase.from("clients").select("id, studio_id");
      const { data: allApts } = await supabase.from("appointments").select("studio_id, price, status");
      const totalRevenue = (allApts || []).filter((a) => a.status === "done").reduce((acc, a) => acc + (a.price || 0), 0);
      const clientsByStudio: Record<string, number> = {};
      for (const c of allClients || []) {
        if (!c.studio_id) continue;
        clientsByStudio[c.studio_id] = (clientsByStudio[c.studio_id] || 0) + 1;
      }
      const revenueByStudio: Record<string, number> = {};
      for (const a of allApts || []) {
        if (a.status !== "done" || !a.studio_id) continue;
        revenueByStudio[a.studio_id] = (revenueByStudio[a.studio_id] || 0) + (a.price || 0);
      }
      const studiosWithStats = (studios || []).map((s) => ({
        ...s,
        client_count: clientsByStudio[s.id] || 0,
        revenue: revenueByStudio[s.id] || 0,
      }));

      return new Response(JSON.stringify({
        totalStudios: studios?.length || 0,
        totalClients: allClients?.length || 0,
        totalRevenue,
        totalAppointments: allApts?.length || 0,
        studios: studiosWithStats,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "studio-detail") {
      const studioId = body.studio_id;
      const { data: studio } = await supabase.from("studios").select("*").eq("id", studioId).maybeSingle();
      const { data: clients } = await supabase.from("clients").select("*").eq("studio_id", studioId);
      const { data: apts } = await supabase.from("appointments").select("*").eq("studio_id", studioId);
      const { data: payments } = await supabase.from("payments").select("*").eq("studio_id", studioId);

      return new Response(JSON.stringify({ studio, clients, appointments: apts, payments }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
