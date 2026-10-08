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

    const { data: userData } = await supabase.from("users").select("studio_id").eq("id", user.id).maybeSingle();
    if (!userData?.studio_id) {
      return new Response(JSON.stringify({ error: "No studio found" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const { conversation_id, content } = body;

    // Verify conversation belongs to this studio
    const { data: conv } = await supabase.from("conversations").select("*, clients(whatsapp, phone)").eq("id", conversation_id).eq("studio_id", userData.studio_id).maybeSingle();
    if (!conv) {
      return new Response(JSON.stringify({ error: "Conversation not found or not authorized" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Save message as pending before sending
    const { data: insertedMsg } = await supabase.from("messages").insert({
      conversation_id: conversation_id,
      sender_type: "professional",
      content: content,
      message_type: "text",
      status: "pending",
    }).select("id").single();
    await supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", conversation_id);

    // Get connection info for Evolution API
    const { data: conn } = await supabase.from("evolution_api_connections").select("instance_name, evolution_api_key, evolution_api_url").eq("studio_id", userData.studio_id).maybeSingle();
    if (!conn) {
      if (insertedMsg) await supabase.from("messages").update({ status: "failed" }).eq("id", insertedMsg.id);
      return new Response(JSON.stringify({ error: "WhatsApp not connected" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const phone = conv.clients?.whatsapp || conv.clients?.phone || "";
    if (!phone) {
      if (insertedMsg) await supabase.from("messages").update({ status: "failed" }).eq("id", insertedMsg.id);
      return new Response(JSON.stringify({ error: "No phone number for client" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Send via Evolution API
    const sendRes = await fetch(`${conn.evolution_api_url}/message/sendText/${conn.instance_name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: conn.evolution_api_key },
      body: JSON.stringify({ number: phone, text: content }),
    });

    if (!sendRes.ok) {
      if (insertedMsg) await supabase.from("messages").update({ status: "failed" }).eq("id", insertedMsg.id);
      return new Response(JSON.stringify({ error: "Failed to send message" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (insertedMsg) await supabase.from("messages").update({ status: "sent" }).eq("id", insertedMsg.id);

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
