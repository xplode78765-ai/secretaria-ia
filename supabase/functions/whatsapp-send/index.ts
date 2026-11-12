import { createClient } from "npm:@supabase/supabase-js@2";
import { DEFAULT_ORIGIN, originAllowed } from "../_shared/cors.ts";
import { getEvolutionConfig, sendEvolutionText } from "../_shared/evolution.ts";
import { formatZoned, safeTz } from "../_shared/brazil.ts";
import { msg, safeLocale } from "../_shared/messages.ts";
import { notifyStudioStaff } from "../_shared/staff-alert.ts";


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

    const { data: userData } = await supabase.from("users").select("studio_id, role").eq("id", user.id).maybeSingle();
    if (!userData?.studio_id) {
      return new Response(JSON.stringify({ error: "No studio found" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();

    // Alert to the studio's own staff number (used when someone saves in the Agenda).
    // Any member of the studio may trigger it; the text only goes to the studio's number.
    if (body.action === "staff_alert") {
      const text = String(body.text || "").trim().slice(0, 500);
      if (text.length < 3) {
        return new Response(JSON.stringify({ error: "Texto curto demais" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const ok = await notifyStudioStaff(supabase, userData.studio_id, text);
      return new Response(JSON.stringify({ ok }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // The WhatsApp inbox is for staff only (owner/admin/reception), same as the RLS policies.
    if (!["owner", "admin", "reception"].includes(String(userData.role || ""))) {
      return new Response(JSON.stringify({ error: "Sem permissão para enviar mensagens" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // The owner approved a booking made by the AI (approval mode): tell the client.
    // Sent as the assistant, so it does not pause the AI in that conversation.
    if (body.kind === "appointment_confirmed") {
      const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: apt } = await supabase.from("appointments")
        .select("id, title, start_time, status, client_id, clients(whatsapp, phone)")
        .eq("id", String(body.appointment_id || "")).eq("studio_id", userData.studio_id).maybeSingle();
      if (!apt?.client_id || apt.status !== "confirmed") return json({ error: "Agendamento não encontrado" }, 404);
      const aptClient = Array.isArray(apt.clients) ? apt.clients[0] : apt.clients;
      const number = aptClient?.whatsapp || aptClient?.phone;
      const { data: st } = await supabase.from("studios").select("timezone, locale").eq("id", userData.studio_id).maybeSingle();
      const { data: conn } = await supabase.from("evolution_api_connections").select("instance_name").eq("studio_id", userData.studio_id).eq("status", "connected").maybeSingle();
      const evo = await getEvolutionConfig(supabase);
      if (!number || !conn?.instance_name || !evo) return json({ ok: false, skipped: "whatsapp_unavailable" });
      const text = msg(safeLocale(st?.locale), "aptApproved", { title: apt.title, when: formatZoned(new Date(apt.start_time), safeTz(st?.timezone)) });
      const { data: convs } = await supabase.from("conversations").select("id").eq("studio_id", userData.studio_id).eq("client_id", apt.client_id).limit(1);
      const convId = convs?.[0]?.id;
      const { data: saved } = convId
        ? await supabase.from("messages").insert({ conversation_id: convId, sender_type: "ai", content: text, message_type: "text", status: "pending", metadata: { type: "appointment_approved", appointment_id: apt.id } }).select("id").single()
        : { data: null };
      const res = await sendEvolutionText(evo, conn.instance_name, number, text);
      if (saved?.id) await supabase.from("messages").update({ status: res.ok ? "sent" : "failed" }).eq("id", saved.id);
      return json({ ok: res.ok });
    }

    const conversation_id = String(body.conversation_id || "");
    const content = String(body.content || "").trim();
    if (!conversation_id || !content || content.length > 4096) {
      return new Response(JSON.stringify({ error: "Mensagem inválida" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

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
    const { data: conn } = await supabase.from("evolution_api_connections").select("instance_name").eq("studio_id", userData.studio_id).maybeSingle();
    const evo = await getEvolutionConfig(supabase);
    if (!conn || !evo) {
      if (insertedMsg) await supabase.from("messages").update({ status: "failed" }).eq("id", insertedMsg.id);
      return new Response(JSON.stringify({ error: "WhatsApp not connected" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const phone = conv.clients?.whatsapp || conv.clients?.phone || "";
    if (!phone) {
      if (insertedMsg) await supabase.from("messages").update({ status: "failed" }).eq("id", insertedMsg.id);
      return new Response(JSON.stringify({ error: "No phone number for client" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Send via Evolution API
    const sendRes = await sendEvolutionText(evo, conn.instance_name, phone, content);

    if (!sendRes.ok) {
      if (insertedMsg) await supabase.from("messages").update({ status: "failed" }).eq("id", insertedMsg.id);
      return new Response(JSON.stringify({ error: "Failed to send message" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (insertedMsg) await supabase.from("messages").update({ status: "sent" }).eq("id", insertedMsg.id);
    // A person from the team answered: pause the AI in this conversation so the two
    // don't reply at the same time. It can be turned back on from the Conversas screen.
    await supabase.from("conversations").update({ ai_enabled: false, needs_human: false, needs_human_reason: "" }).eq("id", conversation_id);

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[whatsapp-send] unhandled", err);
    return new Response(JSON.stringify({ error: "Erro interno. Tente novamente." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
