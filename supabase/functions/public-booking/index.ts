import { createClient } from "npm:@supabase/supabase-js@2";
import { DEFAULT_ORIGIN, originAllowed } from "../_shared/cors.ts";
import { formatZoned, normalizePhone, parseNaiveInZone, phoneLookupValues, zonedYmd, safeTz } from "../_shared/brazil.ts";
import { notifyStudioStaff } from "../_shared/staff-alert.ts";
import { msg, safeLocale } from "../_shared/messages.ts";
import { sendSystemMessageToClient } from "../_shared/sales.ts";
import { describeDay, describeWeek, isWithinBusinessHours, normalizeBusinessHours } from "../_shared/hours.ts";


const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DAYS_AHEAD = 90;
const LIMIT_PER_PHONE = 3; // attempts per hour
const LIMIT_PER_IP = 10;
const LIMIT_PER_STUDIO = 30;

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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
    Vary: "Origin",
  };
}

Deno.serve(async (req: Request) => {
  const corsHeaders = await getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const slug = url.searchParams.get("slug") || "";

    if (req.method === "GET") {
      const { data: row } = await supabase.from("studios").select("id, name, slug, address, phone, instagram, business_hours, timezone").eq("slug", slug).maybeSingle();
      if (!row) {
        return new Response(JSON.stringify({ error: "Studio não encontrado", code: "not_found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { business_hours, ...studio } = row;
      const { data: procedures } = await supabase.from("procedures").select("id, name, price, duration").eq("studio_id", row.id).eq("active", true).order("name");
      return new Response(JSON.stringify({
        // hours_text stays for older pages; business_hours lets the page describe it in its own language.
        studio: { ...studio, hours_text: describeWeek(normalizeBusinessHours(business_hours)), business_hours: business_hours || {} },
        procedures: procedures || [],
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const { data: studio } = await supabase.from("studios").select("id, name, slug, business_hours, timezone, locale").eq("slug", body.slug || slug).maybeSingle();
    if (!studio) {
      return new Response(JSON.stringify({ error: "Studio não encontrado", code: "not_found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    // The form sends "2026-11-05T14:00" with no offset: it is the studio's wall clock.
    const tz = safeTz(studio.timezone);
    const L = safeLocale(studio.locale);

    const json = (payload: unknown, status: number) =>
      new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const name = String(body.name || "").replace(/\s+/g, " ").trim().slice(0, 80);
    const phone = normalizePhone(String(body.phone || "")).slice(0, 15);
    const start = parseNaiveInZone(String(body.start_time || ""), tz);
    if (name.length < 2 || phone.length < 12 || Number.isNaN(start.getTime())) {
      return json({ error: "Informe nome, telefone e horário válidos", code: "invalid_input" }, 400);
    }
    if (start.getTime() <= Date.now()) {
      return json({ error: "Escolha um horário futuro", code: "past" }, 400);
    }
    if (start.getTime() > Date.now() + MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000) {
      return json({ error: `Agende com no máximo ${MAX_DAYS_AHEAD} dias de antecedência`, code: "too_far", max_days: MAX_DAYS_AHEAD }, 400);
    }

    // Duration ALWAYS comes from the procedure (never from the request body).
    const procedureId = typeof body.procedure_id === "string" && UUID_RE.test(body.procedure_id) ? body.procedure_id : null;
    const { data: proc } = procedureId
      ? await supabase.from("procedures").select("id, name, price, duration").eq("id", procedureId).eq("studio_id", studio.id).eq("active", true).maybeSingle()
      : { data: null };
    if (procedureId && !proc) return json({ error: "Procedimento inválido", code: "invalid_procedure" }, 400);
    const duration = Math.min(Math.max(Number(proc?.duration) || 60, 15), 8 * 60);
    const end = new Date(start.getTime() + duration * 60 * 1000);

    const hours = normalizeBusinessHours(studio.business_hours);
    if (!isWithinBusinessHours(hours, start, end, tz)) {
      return json({ error: `Fora do horário de funcionamento (${describeDay(hours, zonedYmd(start, tz))}). Escolha outro horário.`, code: "outside_hours" }, 400);
    }

    // Rate limit: every attempt is recorded in a table only the server can read.
    const ip = (req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown").slice(0, 64);
    await supabase.from("public_booking_attempts").insert({ studio_id: studio.id, ip, phone });
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const countSince = async (col: "studio_id" | "ip" | "phone", value: string) => {
      const { count } = await supabase.from("public_booking_attempts").select("id", { count: "exact", head: true })
        .eq(col, value).gte("created_at", hourAgo);
      return count ?? 0;
    };
    const [byPhone, byIp, byStudio] = await Promise.all([
      countSince("phone", phone),
      countSince("ip", ip),
      countSince("studio_id", studio.id),
    ]);
    if (byPhone > LIMIT_PER_PHONE || byIp > LIMIT_PER_IP || byStudio > LIMIT_PER_STUDIO) {
      return json({ error: "Muitos pedidos agora. Tente de novo mais tarde ou chame o studio no WhatsApp.", code: "rate_limited" }, 429);
    }

    const { data: openSlots } = await supabase.from("appointments")
      .select("id, professional_id")
      .eq("studio_id", studio.id)
      .neq("status", "cancelled")
      .lt("start_time", end.toISOString())
      .gt("end_time", start.toISOString());
    const { data: profs } = await supabase.from("professionals").select("id").eq("studio_id", studio.id).eq("active", true).order("name");
    const busy = new Set((openSlots || []).map((a) => a.professional_id).filter(Boolean));
    const studioBusy = (openSlots || []).some((a) => !a.professional_id);
    const freePro = (profs || []).find((p) => !busy.has(p.id));
    if (studioBusy || ((profs || []).length > 0 && !freePro)) {
      return new Response(JSON.stringify({ error: "Horário indisponível. Escolha outro.", code: "unavailable" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const ors = phoneLookupValues(phone).flatMap((v) => [`phone.eq.${v}`, `whatsapp.eq.${v}`]).join(",");
    const { data: found } = await supabase.from("clients").select("id").eq("studio_id", studio.id).or(ors).order("created_at").limit(1);
    let client: { id: string } | null = found?.[0] ?? null;
    if (!client) {
      const created = await supabase.from("clients").insert({
        studio_id: studio.id,
        name,
        phone,
        whatsapp: phone,
        source: "public_link",
        status: "active",
      }).select("id").single();
      client = created.data;
    }
    if (!client?.id) {
      return new Response(JSON.stringify({ error: "Não foi possível cadastrar a cliente", code: "internal" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const title = proc?.name || msg(L, "publicTitle");
    const { error } = await supabase.from("appointments").insert({
      studio_id: studio.id,
      client_id: client.id,
      professional_id: freePro?.id || null,
      procedure_id: proc?.id || null,
      title,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      date: zonedYmd(start, tz),
      status: "pending",
      price: Number(proc?.price || 0),
      payment_status: "pending",
      notes: msg(L, "notePublic"),
      source: "public",
    });
    if (error) {
      const msg = String(error.message || "");
      if (msg.includes("appointments_no_overlap") || error.code === "23P01") {
        return new Response(JSON.stringify({ error: "Horário indisponível. Escolha outro.", code: "unavailable" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      console.error("[public-booking] insert failed", error.message);
      return new Response(JSON.stringify({ error: "Não foi possível agendar agora. Tente novamente.", code: "internal" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await supabase.from("notifications").insert({
      studio_id: studio.id,
      client_id: client.id,
      type: "new_appointment",
      title: msg(L, "notifNewPublic"),
      content: msg(L, "notifPublicContent", { client: name, title, when: formatZoned(start, tz) }),
    });
    void notifyStudioStaff(
      supabase,
      studio.id,
      msg(L, "staffNewPublic", { client: name, title, when: formatZoned(start, tz) }),
    );
    // Tell the client the request arrived (when the studio WhatsApp is connected).
    void sendSystemMessageToClient(supabase, {
      studioId: studio.id,
      clientId: client.id,
      number: phone,
      text: msg(L, "publicReceived", { title, when: formatZoned(start, tz) }),
      type: "public_booking_received",
    }).catch(() => false);

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[public-booking] unhandled", err);
    return new Response(JSON.stringify({ error: "Erro inesperado. Tente novamente.", code: "internal" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
