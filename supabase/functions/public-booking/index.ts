import { createClient } from "npm:@supabase/supabase-js@2";
import { formatSaoPaulo, normalizePhone, parseNaiveAsSaoPaulo, phoneLookupValues, saoPauloYmd } from "../_shared/brazil.ts";
import { notifyStudioStaff } from "../_shared/staff-alert.ts";

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
    const url = new URL(req.url);
    const slug = url.searchParams.get("slug") || "";

    if (req.method === "GET") {
      const { data: studio } = await supabase.from("studios").select("id, name, slug, address, phone, instagram").eq("slug", slug).maybeSingle();
      if (!studio) {
        return new Response(JSON.stringify({ error: "Studio não encontrado" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { data: procedures } = await supabase.from("procedures").select("id, name, price, duration").eq("studio_id", studio.id).eq("active", true).order("name");
      return new Response(JSON.stringify({ studio, procedures: procedures || [] }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const { data: studio } = await supabase.from("studios").select("id, name, slug").eq("slug", body.slug || slug).maybeSingle();
    if (!studio) {
      return new Response(JSON.stringify({ error: "Studio não encontrado" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const name = String(body.name || "").trim();
    const phone = normalizePhone(body.phone || "");
    const start = parseNaiveAsSaoPaulo(String(body.start_time || ""));
    if (!name || phone.length < 12 || Number.isNaN(start.getTime())) {
      return new Response(JSON.stringify({ error: "Informe nome, telefone e horário válidos" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (start.getTime() <= Date.now()) {
      return new Response(JSON.stringify({ error: "Escolha um horário futuro" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count: recent } = await supabase.from("appointments").select("id", { count: "exact", head: true })
      .eq("studio_id", studio.id)
      .like("notes", `%(${ip})%`)
      .gte("created_at", since);
    if ((recent ?? 0) > 8) {
      return new Response(JSON.stringify({ error: "Muitos pedidos agora. Tente em alguns minutos." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: proc } = body.procedure_id
      ? await supabase.from("procedures").select("id, name, price, duration").eq("id", body.procedure_id).eq("studio_id", studio.id).maybeSingle()
      : { data: null };
    const duration = Number(proc?.duration || body.duration || 60);
    const end = new Date(start.getTime() + duration * 60 * 1000);

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
      return new Response(JSON.stringify({ error: "Horário indisponível. Escolha outro." }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const ors = phoneLookupValues(phone).flatMap((v) => [`phone.eq.${v}`, `whatsapp.eq.${v}`]).join(",");
    let { data: client } = await supabase.from("clients").select("id").eq("studio_id", studio.id).or(ors).maybeSingle();
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
      return new Response(JSON.stringify({ error: "Não foi possível cadastrar a cliente" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const title = proc?.name || "Agendamento online";
    const { error } = await supabase.from("appointments").insert({
      studio_id: studio.id,
      client_id: client.id,
      professional_id: freePro?.id || null,
      procedure_id: proc?.id || null,
      title,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      date: saoPauloYmd(start),
      status: "pending",
      price: Number(proc?.price || 0),
      payment_status: "pending",
      notes: `Criado pelo link público (${ip})`,
    });
    if (error) {
      const msg = String(error.message || "");
      if (msg.includes("appointments_no_overlap") || error.code === "23P01") {
        return new Response(JSON.stringify({ error: "Horário indisponível. Escolha outro." }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await supabase.from("notifications").insert({
      studio_id: studio.id,
      client_id: client.id,
      type: "new_appointment",
      title: "Agendamento pelo link público",
      content: `${name} — ${title} em ${formatSaoPaulo(start)}`,
    });
    void notifyStudioStaff(
      supabase,
      studio.id,
      `📅 Novo agendamento (link público)\n${name} — ${title}\n${formatSaoPaulo(start)}`,
    );

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
