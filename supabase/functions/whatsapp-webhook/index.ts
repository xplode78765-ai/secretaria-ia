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

function normalizeText(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function matchesKeyword(normalizedMessage: string, keyword: string): boolean {
  const needle = normalizeText(keyword);
  if (!needle) return false;
  if (needle.includes(" ")) return normalizedMessage.includes(needle);
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)${escaped}(?:$|\\s|[?!.,;:])`).test(normalizedMessage);
}

function matchPattern(message: string, patterns: any[], customMessages: any[]) {
  const normalized = normalizeText(message);
  for (const pattern of patterns) {
    if (!pattern.enabled) continue;
    for (const keyword of pattern.keywords || []) {
      if (matchesKeyword(normalized, keyword)) {
        return { matched: true, pattern, response: pattern.response, trigger: pattern.trigger };
      }
    }
  }
  const fallback = (customMessages || []).find((m) => m.trigger === "fallback" && m.enabled);
  return { matched: false, pattern: null, response: fallback?.message || "Obrigada pela mensagem! Nossa equipe vai responder em breve.", trigger: "fallback" };
}

Deno.serve(async (req: Request) => {
  const corsHeaders = await getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const webhookSecret = req.headers.get("X-Webhook-Secret");
    if (!webhookSecret) {
      return new Response(JSON.stringify({ error: "Missing webhook secret" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Validate against webhook_secret in app_secrets (not evolution_api_key)
    const { data: secretData } = await supabase.from("app_secrets").select("value").eq("key", "webhook_secret").maybeSingle();
    const storedSecret = secretData?.value;

    if (!storedSecret || storedSecret.length === 0) {
      console.error("[whatsapp-webhook] webhook_secret not configured in app_secrets");
      return new Response(JSON.stringify({ error: "Webhook secret not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (webhookSecret !== storedSecret) {
      console.error("[whatsapp-webhook] Invalid webhook secret received");
      return new Response(JSON.stringify({ error: "Invalid webhook secret" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const event = body?.event;
    const instanceName = body?.instance;

    // Handle QR code updated event
    if (event === "qrcode.updated" || event === "QRCODE_UPDATED") {
      console.log(`[whatsapp-webhook] QR code updated event for instance: ${instanceName}`);
      const d = body?.data;
      let base64 = "";
      if (d?.qrcode?.base64) base64 = d.qrcode.base64;
      else if (d?.base64) base64 = d.base64;
      else if (d?.qrcode?.code) base64 = d.qrcode.code;
      if (base64 && instanceName) {
        await supabase.from("evolution_api_connections")
          .update({ qr_code: base64, qr_code_updated_at: new Date().toISOString(), status: "connecting", error_message: "" })
          .eq("instance_name", instanceName);
        console.log(`[whatsapp-webhook] QR code saved for instance: ${instanceName}`);
      } else {
        console.warn(`[whatsapp-webhook] QR code updated event but no base64 found in payload`);
      }
      return new Response(JSON.stringify({ received: true, event }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Handle connection update event
    if (event === "connection.update" || event === "CONNECTION_UPDATE") {
      const d = body?.data;
      const state = (d?.state || d?.connection || "").toLowerCase();
      console.log(`[whatsapp-webhook] Connection update event for instance: ${instanceName}, state: ${state}`);
      if (state === "open") {
        const phone = (d?.wuid || d?.ownerJid || "").split("@")[0] || "";
        await supabase.from("evolution_api_connections")
          .update({ status: "connected", qr_code: "", qr_code_updated_at: null, last_connected_at: new Date().toISOString(), error_message: "", ...(phone ? { phone_number: phone } : {}) })
          .eq("instance_name", instanceName);
        console.log(`[whatsapp-webhook] Connection opened for instance: ${instanceName}`);
      } else if (state === "close") {
        await supabase.from("evolution_api_connections")
          .update({ status: "disconnected", qr_code: "" })
          .eq("instance_name", instanceName);
        console.log(`[whatsapp-webhook] Connection closed for instance: ${instanceName}`);
      }
      return new Response(JSON.stringify({ received: true, event }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (event !== "messages.upsert" && event !== "MESSAGES_UPSERT") {
      return new Response(JSON.stringify({ received: true, event }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const messageData = body?.data;
    if (messageData?.key?.fromMe) {
      return new Response(JSON.stringify({ received: true, ignored: "fromMe" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const remoteJid = messageData?.key?.remoteJid || "";
    if (remoteJid.includes("@g.us") || remoteJid.includes("status@broadcast") || remoteJid.includes("@broadcast")) {
      return new Response(JSON.stringify({ received: true, ignored: "group_or_status" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const from = remoteJid.replace("@s.whatsapp.net", "").replace("@c.us", "").replace(/\D/g, "");
    const text = messageData?.message?.conversation || messageData?.message?.extendedTextMessage?.text || "";
    const evolutionMessageId = messageData?.key?.id;

    if (!from || !text) {
      return new Response(JSON.stringify({ received: true, message: "No text message" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Find the studio by instance name
    const { data: conn } = await supabase.from("evolution_api_connections").select("studio_id, evolution_api_key, evolution_api_url").eq("instance_name", instanceName).maybeSingle();
    if (!conn?.studio_id) {
      console.log(`[whatsapp-webhook] Studio not found for instance: ${instanceName}`);
      return new Response(JSON.stringify({ received: true, message: "Studio not found" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const studioId = conn.studio_id;

    const { data: matchedClients, error: clientLookupError } = await supabase.from("clients").select("id").eq("studio_id", studioId).or(`phone.eq.${from},whatsapp.eq.${from}`).limit(1);
    if (clientLookupError) {
      console.error(`[whatsapp-webhook] Client lookup failed: ${clientLookupError.message}`);
      return new Response(JSON.stringify({ error: "Client lookup failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    let client = matchedClients?.[0] ?? null;
    if (!client) {
      const newClient = await supabase.from("clients").insert({ studio_id: studioId, name: from, phone: from, whatsapp: from, source: "whatsapp" }).select("id").single();
      client = newClient.data;
    }
    if (!client?.id) {
      console.error("[whatsapp-webhook] Failed to create client");
      return new Response(JSON.stringify({ error: "Failed to create client" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: matchedConvs } = await supabase.from("conversations").select("id, ai_enabled").eq("studio_id", studioId).eq("client_id", client.id).limit(1);
    let conv = matchedConvs?.[0] ?? null;
    if (!conv) {
      const newConv = await supabase.from("conversations").insert({ studio_id: studioId, client_id: client.id, channel: "whatsapp", status: "active", ai_enabled: true }).select("id, ai_enabled").single();
      conv = newConv.data;
    }
    if (!conv?.id) {
      console.error("[whatsapp-webhook] Failed to create conversation");
      return new Response(JSON.stringify({ error: "Failed to create conversation" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Dedup: check if a message with the same evolution_message_id already exists
    if (evolutionMessageId) {
      const { data: existingMsg } = await supabase.from("messages")
        .select("id")
        .eq("conversation_id", conv.id)
        .eq("metadata->>evolution_message_id", evolutionMessageId)
        .limit(1);

      if (existingMsg && existingMsg.length > 0) {
        console.log(`[whatsapp-webhook] Duplicate message ignored: evolution_message_id=${evolutionMessageId}`);
        return new Response(JSON.stringify({ received: true, dedup: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Save incoming message
    await supabase.from("messages").insert({
      conversation_id: conv.id,
      sender_type: "client",
      content: text,
      message_type: "text",
      metadata: { evolution_message_id: evolutionMessageId || null },
    });
    await supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", conv.id);

    // If AI is enabled, generate and send response
    if (conv.ai_enabled) {
      const { data: aiSettings } = await supabase.from("ai_settings").select("ai_patterns, custom_messages, tom_voz").eq("studio_id", studioId).maybeSingle();
      const patterns = aiSettings?.ai_patterns || [];
      const customMessages = aiSettings?.custom_messages || [];
      const result = matchPattern(text, patterns, customMessages);
      const tom = (aiSettings?.tom_voz || "").toLowerCase();
      if (tom.includes("formal")) {
        result.response = result.response.replace(/!+/g, ".");
      }

      // Save AI response message
      await supabase.from("messages").insert({
        conversation_id: conv.id,
        sender_type: "ai",
        content: result.response,
        message_type: "text",
      });

      // Send via Evolution API
      await fetch(`${conn.evolution_api_url}/message/sendText/${instanceName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: conn.evolution_api_key },
        body: JSON.stringify({ number: from, text: result.response }),
      });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error(`[whatsapp-webhook] Unhandled error: ${err.message}`);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
