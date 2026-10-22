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
    if (host.endsWith(".bolt.new") || host.endsWith(".bolt.host") || host.endsWith(".stackblitz.io") || host.endsWith(".netlify.app")) return true;
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

async function getConnection(studioId: string) {
  const { data } = await supabase
    .from("evolution_api_connections")
    .select("id, studio_id, instance_name, status, phone_number, qr_code, qr_code_updated_at, last_connected_at, error_message, created_at, updated_at, evolution_api_key, evolution_api_url")
    .eq("studio_id", studioId)
    .maybeSingle();
  return data;
}

function extractQrCode(qrData: unknown): string {
  if (!qrData || typeof qrData !== "object") return "";
  const d = qrData as Record<string, unknown>;
  // Format 1: { base64: "data:image/png;base64,...", code: "..." } (root level)
  if (typeof d.base64 === "string" && d.base64.length > 0) return d.base64;
  // Format 2: { qrcode: { base64: "...", code: "..." } }
  if (d.qrcode && typeof d.qrcode === "object") {
    const q = d.qrcode as Record<string, unknown>;
    if (typeof q.base64 === "string" && q.base64.length > 0) return q.base64;
    if (typeof q.code === "string" && q.code.length > 0) return q.code;
  }
  // Format 3: { data: { base64: "..." } } or { data: { qrcode: { base64: "..." } } }
  if (d.data && typeof d.data === "object") {
    const inner = d.data as Record<string, unknown>;
    if (typeof inner.base64 === "string" && inner.base64.length > 0) return inner.base64;
    if (inner.qrcode && typeof inner.qrcode === "object") {
      const q2 = inner.qrcode as Record<string, unknown>;
      if (typeof q2.base64 === "string" && q2.base64.length > 0) return q2.base64;
      if (typeof q2.code === "string" && q2.code.length > 0) return q2.code;
    }
  }
  return "";
}

async function fetchQrCodeWithRetries(apiUrl: string, instanceName: string, apiKey: string, maxRetries = 3): Promise<{ qrCode: string; rawBody: string; error?: string }> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`[evolution-manager] Fetching QR code (attempt ${attempt}/${maxRetries}) for instance ${instanceName}`);
    try {
      const qrRes = await fetch(`${apiUrl}/instance/connect/${instanceName}`, {
        method: "GET",
        headers: { apikey: apiKey },
      });
      const rawBody = await qrRes.text();
      console.log(`[evolution-manager] QR response status: ${qrRes.status}, body length: ${rawBody.length}`);

      if (!qrRes.ok) {
        console.error(`[evolution-manager] QR fetch failed (attempt ${attempt}): status=${qrRes.status}, body=${rawBody.slice(0, 500)}`);
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        return { qrCode: "", rawBody, error: `Evolution API returned status ${qrRes.status}: ${rawBody.slice(0, 300)}` };
      }

      let qrData: unknown;
      try {
        qrData = JSON.parse(rawBody);
      } catch {
        console.error(`[evolution-manager] Failed to parse QR response as JSON: ${rawBody.slice(0, 500)}`);
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        return { qrCode: "", rawBody, error: `Invalid JSON response from Evolution API: ${rawBody.slice(0, 300)}` };
      }

      const qrCode = extractQrCode(qrData);
      if (qrCode) {
        console.log(`[evolution-manager] QR code extracted successfully (length: ${qrCode.length})`);
        return { qrCode, rawBody };
      }

      console.error(`[evolution-manager] QR code not found in response (attempt ${attempt}): ${rawBody.slice(0, 500)}`);
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      return { qrCode: "", rawBody, error: `QR code not found in Evolution API response. Raw body: ${rawBody.slice(0, 500)}` };
    } catch (err) {
      console.error(`[evolution-manager] Error fetching QR (attempt ${attempt}): ${err.message}`);
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      return { qrCode: "", rawBody: "", error: `Network error: ${err.message}` };
    }
  }
  return { qrCode: "", rawBody: "", error: "Max retries exceeded" };
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

    const { data: me } = await supabase.from("users").select("studio_id, role").eq("id", user.id).maybeSingle();
    const studioId = me?.studio_id ?? null;
    if (!studioId) {
      return new Response(JSON.stringify({ error: "No studio found" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (me.role !== "owner" && me.role !== "admin") {
      return new Response(JSON.stringify({ error: "Apenas a dona do studio pode gerenciar o WhatsApp" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const action = body.action;

    const apiKey = await getAppSecret("evolution_api_key");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Evolution API key not configured. Set 'evolution_api_key' in app_secrets." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Read webhook_secret and evolution_api_url from app_secrets
    const webhookSecret = await getAppSecret("webhook_secret");
    const defaultApiUrl = await getAppSecret("evolution_api_url");

    let conn = await getConnection(studioId);
    const instanceName = conn?.instance_name || `studio-${studioId.slice(0, 8)}`;
    // Use the URL from the connection record if it exists, otherwise from app_secrets
    const apiUrl = conn?.evolution_api_url || defaultApiUrl || "";

    if (!apiUrl) {
      return new Response(JSON.stringify({ error: "Evolution API URL not configured. Set 'evolution_api_url' in app_secrets." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "connect") {
      if (!webhookSecret) {
        return new Response(JSON.stringify({ error: "webhook_secret not configured in app_secrets. Apply the latest migration or set it in SQL." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const webhookHeaders: Record<string, string> = { "X-Webhook-Secret": webhookSecret };

      const webhookUrl = `${supabaseUrl}/functions/v1/whatsapp-webhook`;
      const webhookEvents = ["QRCODE_UPDATED", "CONNECTION_UPDATE", "MESSAGES_UPSERT"];
      const webhookObject = {
        url: webhookUrl,
        headers: webhookHeaders,
        byEvents: false,
        base64: true,
        events: webhookEvents,
      };

      // Check if we need to create the instance (no DB record yet, or DB record exists but instance 404s on Evolution API)
      let needsCreate = !conn;

      // If DB record exists, check if the instance still exists on the Evolution API
      // Use fetchInstances (metadata-only) instead of /instance/connect to avoid
      // resetting the Baileys pairing session and generating spurious QR codes.
      if (conn) {
        console.log(`[evolution-manager] Checking if instance ${instanceName} still exists via fetchInstances`);
        try {
          const checkRes = await fetch(`${apiUrl}/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`, {
            method: "GET",
            headers: { apikey: apiKey },
          });
          if (checkRes.status === 404) {
            console.warn(`[evolution-manager] Instance ${instanceName} returned 404 from fetchInstances — will recreate on Evolution API`);
            needsCreate = true;
          } else if (checkRes.ok) {
            const checkData = await checkRes.json();
            const instances = Array.isArray(checkData) ? checkData : (Array.isArray(checkData?.data) ? checkData.data : []);
            if (!Array.isArray(instances) || instances.length === 0) {
              console.warn(`[evolution-manager] Instance ${instanceName} not found in fetchInstances response (empty) — will recreate`);
              needsCreate = true;
            } else {
              console.log(`[evolution-manager] Instance ${instanceName} exists in fetchInstances response — no need to recreate`);
            }
          } else {
            console.warn(`[evolution-manager] fetchInstances returned status ${checkRes.status} — treating as needsCreate`);
            needsCreate = true;
          }
        } catch (checkErr) {
          console.warn(`[evolution-manager] fetchInstances request failed: ${checkErr.message} — treating as needsCreate`);
          needsCreate = true;
        }
      }

      async function registerWebhook() {
        const webhookSetRes = await fetch(`${apiUrl}/webhook/set/${instanceName}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: apiKey },
          body: JSON.stringify({
            webhook: {
              enabled: true,
              url: webhookUrl,
              headers: webhookHeaders,
              byEvents: false,
              base64: true,
              events: webhookEvents,
            },
          }),
        });
        if (!webhookSetRes.ok) {
          const webhookErr = await webhookSetRes.text();
          console.error(`[evolution-manager] Webhook registration failed for ${instanceName}: ${webhookErr.slice(0, 500)}`);
        }
      }

      if (!needsCreate) {
        try {
          const statusRes = await fetch(`${apiUrl}/instance/connectionState/${instanceName}`, {
            method: "GET",
            headers: { apikey: apiKey },
          });
          if (statusRes.ok) {
            const statusData = await statusRes.json();
            const state = String(statusData?.instance?.state || "").toUpperCase();
            if (state === "OPEN" || state === "CONNECTED") {
              await registerWebhook();
              const phone = statusData?.instance?.ownerJid?.split("@")[0] || "";
              await supabase.from("evolution_api_connections").update({
                status: "connected",
                phone_number: phone,
                last_connected_at: new Date().toISOString(),
                qr_code: "",
                error_message: "",
              }).eq("studio_id", studioId);
              return new Response(JSON.stringify({ status: "connected", phone }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }
          }
        } catch (stateErr) {
          console.warn(`[evolution-manager] connectionState check failed: ${stateErr.message}`);
        }
        await registerWebhook();
      }

      if (needsCreate) {
        // Create instance in Evolution API (v2 format with integration + qrcode + full webhook)
        console.log(`[evolution-manager] Creating instance ${instanceName} for studio ${studioId}`);
        let createRes = await fetch(`${apiUrl}/instance/create`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: apiKey },
          body: JSON.stringify({
            instanceName,
            integration: "WHATSAPP-BAILEYS",
            qrcode: true,
            webhook: webhookObject,
          }),
        });

        // Fallback for v2.0/v2.1 which reject nested webhook in /instance/create
        if (!createRes.ok && createRes.status === 400) {
          const errText = await createRes.text();
          console.warn(`[evolution-manager] /instance/create with nested webhook returned 400: ${errText.slice(0, 500)}`);
          console.log(`[evolution-manager] Retrying /instance/create without webhook (will register webhook separately)`);
          createRes = await fetch(`${apiUrl}/instance/create`, {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: apiKey },
            body: JSON.stringify({
              instanceName,
              integration: "WHATSAPP-BAILEYS",
              qrcode: true,
            }),
          });

          // If the fallback create succeeded, register the webhook in a separate call
          if (createRes.ok) {
            console.log(`[evolution-manager] Instance ${instanceName} created without webhook — registering webhook separately`);
            const webhookSetRes = await fetch(`${apiUrl}/webhook/set/${instanceName}`, {
              method: "POST",
              headers: { "Content-Type": "application/json", apikey: apiKey },
              body: JSON.stringify({
                webhook: {
                  enabled: true,
                  url: webhookUrl,
                  headers: webhookHeaders,
                  byEvents: false,
                  base64: true,
                  events: webhookEvents,
                },
              }),
            });
            if (!webhookSetRes.ok) {
              const webhookErr = await webhookSetRes.text();
              console.error(`[evolution-manager] Webhook registration failed for ${instanceName}: ${webhookErr.slice(0, 500)} — continuing anyway`);
            } else {
              console.log(`[evolution-manager] Webhook registered successfully for ${instanceName}`);
            }
          }
        }

        if (!createRes.ok) {
          const errText = await createRes.text();
          console.error(`[evolution-manager] Instance creation failed: status=${createRes.status}, body=${errText.slice(0, 500)}`);
          return new Response(JSON.stringify({ error: `Failed to create instance: ${errText.slice(0, 300)}` }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        console.log(`[evolution-manager] Instance ${instanceName} created successfully`);

        // Insert or update connection record
        if (!conn) {
          await supabase.from("evolution_api_connections").insert({
            studio_id: studioId,
            instance_name: instanceName,
            status: "connecting",
            evolution_api_key: apiKey,
            evolution_api_url: apiUrl,
          });
        } else {
          await supabase.from("evolution_api_connections").update({ status: "connecting", error_message: "" }).eq("studio_id", studioId);
        }
        conn = await getConnection(studioId);
      }

      // Get QR code with retries
      const { qrCode, error: qrError } = await fetchQrCodeWithRetries(apiUrl, instanceName, apiKey, 3);

      if (qrCode) {
        await supabase.from("evolution_api_connections").update({ qr_code: qrCode, qr_code_updated_at: new Date().toISOString(), status: "connecting", error_message: "" }).eq("studio_id", studioId);
        return new Response(JSON.stringify({ status: "connecting", qr_code: qrCode }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // QR code not obtained — save error and return it
      const errorMsg = qrError || "Failed to obtain QR code after retries";
      console.error(`[evolution-manager] QR code retrieval failed for studio ${studioId}: ${errorMsg}`);
      await supabase.from("evolution_api_connections").update({ error_message: errorMsg, status: "error" }).eq("studio_id", studioId);
      return new Response(JSON.stringify({ status: "error", error: errorMsg }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "refresh_qr") {
      if (!conn) {
        return new Response(JSON.stringify({ error: "No WhatsApp connection found. Call 'connect' first." }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      console.log(`[evolution-manager] Refreshing QR code for instance ${instanceName}`);
      const { qrCode: refreshQr, error: refreshErr } = await fetchQrCodeWithRetries(apiUrl, instanceName, apiKey, 3);
      if (refreshQr) {
        await supabase.from("evolution_api_connections").update({ qr_code: refreshQr, qr_code_updated_at: new Date().toISOString(), status: "connecting", error_message: "" }).eq("studio_id", studioId);
        return new Response(JSON.stringify({ status: "connecting", qr_code: refreshQr }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const refreshErrorMsg = refreshErr || "Failed to refresh QR code after retries";
      console.error(`[evolution-manager] QR refresh failed for studio ${studioId}: ${refreshErrorMsg}`);
      await supabase.from("evolution_api_connections").update({ error_message: refreshErrorMsg }).eq("studio_id", studioId);
      return new Response(JSON.stringify({ status: "error", error: refreshErrorMsg }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "status") {
      const statusRes = await fetch(`${apiUrl}/instance/connectionState/${instanceName}`, {
        method: "GET",
        headers: { apikey: apiKey },
      });
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        const state = statusData?.instance?.state?.toUpperCase() || "DISCONNECTED";
        const phone = statusData?.instance?.ownerJid?.split("@")[0] || "";
        if (state === "OPEN" || state === "CONNECTED") {
          await supabase.from("evolution_api_connections").update({ status: "connected", phone_number: phone, last_connected_at: new Date().toISOString(), qr_code: "", qr_code_updated_at: null, error_message: "" }).eq("studio_id", studioId);
        } else {
          // If not connected and QR code is older than 60 seconds, clear it
          if (conn?.qr_code_updated_at) {
            const qrAge = (Date.now() - new Date(conn.qr_code_updated_at).getTime()) / 1000;
            if (qrAge > 60) {
              console.log(`[evolution-manager] QR code expired (${qrAge.toFixed(0)}s old) — clearing from DB`);
              await supabase.from("evolution_api_connections").update({ qr_code: "" }).eq("studio_id", studioId);
            }
          }
        }
        return new Response(JSON.stringify({ status: state.toLowerCase(), phone }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ status: conn?.status || "disconnected" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "disconnect") {
      await fetch(`${apiUrl}/instance/logout/${instanceName}`, { method: "DELETE", headers: { apikey: apiKey } });
      await supabase.from("evolution_api_connections").update({ status: "disconnected", qr_code: "", error_message: "" }).eq("studio_id", studioId);
      return new Response(JSON.stringify({ status: "disconnected" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error(`[evolution-manager] Unhandled error: ${err.message}`);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
