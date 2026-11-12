import { createClient } from "npm:@supabase/supabase-js@2";
import { DEFAULT_ORIGIN, originAllowed } from "../_shared/cors.ts";
import { formatZoned, normalizePhone, normalizeText, parseBrazilianDateTimeParts, phoneLookupValues, zonedDayBounds, zonedYmd, safeTz, fromZonedWall } from "../_shared/brazil.ts";
import { notifyStudioStaff } from "../_shared/staff-alert.ts";
import { type DayWindow, describeDay, describeWeek, isWithinBusinessHours, normalizeBusinessHours } from "../_shared/hours.ts";
import { getEvolutionConfig, sendEvolutionText } from "../_shared/evolution.ts";
import { runGptSecretary } from "../_shared/gpt-secretary.ts";
import { type Locale, msg, safeLocale } from "../_shared/messages.ts";
import { depositFor, flagHuman, getStudioPlan, notifyWaitlist, subscriptionAllowsAi } from "../_shared/sales.ts";


const ECHO_WINDOW_MS = 10 * 60 * 1000;
// Cost guards for the GPT secretary.
const MAX_INPUT_CHARS = 1500; // longer messages are truncated before going to GPT
const MAX_AI_REPLIES_PER_CONV_10MIN = 10; // above this the AI stops answering (bot loops / flooding)
const DEFAULT_GPT_DAILY_LIMIT_PER_STUDIO = 300; // override with app_secrets.openai_daily_limit_per_studio

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

function matchesKeyword(normalizedMessage: string, keyword: string): boolean {
  const needle = normalizeText(keyword);
  if (!needle) return false;
  if (needle.includes(" ")) return normalizedMessage.includes(needle);
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)${escaped}(?:$|\\s|[?!.,;:])`).test(normalizedMessage);
}

function matchPattern(message: string, patterns: any[], customMessages: any[], locale: Locale = "pt") {
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
  return { matched: false, pattern: null, response: fallback?.message || msg(locale, "fallback"), trigger: "fallback" };
}

async function slotTaken(studioId: string, start: Date, end: Date, professionalId: string | null, ignoreId?: string) {
  const { data } = await supabase.from("appointments")
    .select("id, professional_id")
    .eq("studio_id", studioId)
    .neq("status", "cancelled")
    .lt("start_time", end.toISOString())
    .gt("end_time", start.toISOString());
  return (data || []).some((a) => {
    if (a.id === ignoreId) return false;
    if (!professionalId) return true;
    return !a.professional_id || a.professional_id === professionalId;
  });
}

async function pickFreeProfessional(studioId: string, start: Date, end: Date, ignoreId?: string) {
  const { data: profs } = await supabase.from("professionals").select("id, name").eq("studio_id", studioId).eq("active", true).order("name");
  for (const p of profs || []) {
    if (!(await slotTaken(studioId, start, end, p.id, ignoreId))) return p;
  }
  return null;
}

function fuzzyProcedure(n: string, procedures: { id: string; name: string; price: number; duration: number }[]) {
  return procedures.find((p) => {
    const pn = normalizeText(p.name);
    if (!pn) return false;
    if (n.includes(pn) || pn.includes(n)) return true;
    const words = pn.split(/\s+/).filter((w) => w.length > 3);
    return words.length > 0 && words.every((w) => n.includes(w));
  }) || null;
}

function looksGreeting(n: string) {
  return /^(oi+|ola+|ola\s+tudo\s+bem|bom\s+dia|boa\s+tarde|boa\s+noite|hey|eai|e\s+ai|hola+|hola\s+que\s+tal|buen\s+dia|buenos\s+dias|buenas|buenas\s+tardes|buenas\s+noches)[\s!?.]*$/.test(n);
}

async function suggestOtherSlots(studioId: string, start: Date, durationMin: number, hours: DayWindow[], tz: string) {
  const tips: string[] = [];
  const duration = durationMin * 60 * 1000;
  for (const addH of [1, 2, 3, 24, 25, 26, 48, 49]) {
    const s = new Date(start.getTime() + addH * 60 * 60 * 1000);
    if (s.getTime() <= Date.now()) continue;
    const e = new Date(s.getTime() + duration);
    if (!isWithinBusinessHours(hours, s, e, tz)) continue;
    const free = await pickFreeProfessional(studioId, s, e);
    if (free || !(await slotTaken(studioId, s, e, null))) {
      tips.push(formatZoned(s, tz));
    }
    if (tips.length >= 3) break;
  }
  return tips;
}

async function handleAiTurn(opts: {
  studioId: string;
  clientId: string;
  conv: { id: string; ai_state?: Record<string, unknown> };
  text: string;
  patterns: unknown[];
  customMessages: unknown[];
}): Promise<string> {
  const { studioId, clientId, conv, text } = opts;
  const n = normalizeText(text);
  const state = { ...(conv.ai_state || {}) } as Record<string, unknown>;
  const { data: clientRow } = await supabase.from("clients").select("name").eq("id", clientId).maybeSingle();
  const clientName = (clientRow?.name && !/^\d+$/.test(clientRow.name)) ? clientRow.name : "";
  const { data: studio } = await supabase.from("studios").select("name, address, phone, business_hours, timezone, locale, booking_mode, deposit_percent, pix_key").eq("id", studioId).maybeSingle();
  const needsApproval = studio?.booking_mode === "approval";
  const hours = normalizeBusinessHours(studio?.business_hours);
  const tz = safeTz(studio?.timezone);
  // Replies go out in the studio's language (studios.locale); intent words are understood in PT and ES.
  const L: Locale = safeLocale(studio?.locale);
  const t = (key: Parameters<typeof msg>[1], vars?: Record<string, string | number>) => msg(L, key, vars);
  const when = (iso: string | Date) => formatZoned(typeof iso === "string" ? new Date(iso) : iso, tz);
  const { data: procedures } = await supabase.from("procedures").select("id, name, price, duration").eq("studio_id", studioId).eq("active", true);
  const procs = procedures || [];
  const matchedProc = fuzzyProcedure(n, procs);
  const pendingYmd = typeof state.pending_ymd === "string" ? state.pending_ymd : undefined;
  const parsed = parseBrazilianDateTimeParts(text, new Date(), tz, pendingYmd);
  const patternHit = matchPattern(text, opts.patterns as any[], opts.customMessages as any[], L);
  const customByTrigger = (t: string) => (opts.customMessages as { trigger?: string; enabled?: boolean; message?: string }[] || []).find((m) => m.trigger === t && m.enabled)?.message;

  // "1" / "2" only mean confirm / cancel right after a reminder (or "meus horários"),
  // which put the conversation in the awaiting_confirm step. Elsewhere a bare number
  // ("quero 2 sessões") must not cancel anything.
  const awaitingConfirm = state.step === "awaiting_confirm";
  const cancelByNumber = awaitingConfirm && n === "2";
  const cancelByWords = n.includes("cancelar") || n.includes("desmarcar") || n.includes("anular") || n.includes("nao vou") || n.includes("nao posso ir") || n.includes("no voy") || n.includes("no puedo ir");
  const cancelish = cancelByNumber || cancelByWords;
  const confirmish = (awaitingConfirm && n === "1") || n === "confirmar" || n.includes("confirmo");
  const saysYes = /^(sim|s|si|pode|pode sim|pode cancelar|isso|confirmo|confirmar|cancela|cancelar|quero cancelar|quiero cancelar|dale|claro|1)[\s!.]*$/.test(n);
  const saysNo = /^(nao|n|no|nao quero|no quiero|deixa|mantem|manter|mantenha|mantener|mantenla|nao cancela|no cancela|nao precisa|no hace falta|2)[\s!.]*$/.test(n);
  const reschedule = n.includes("remarcar") || n.includes("reagendar") || n.includes("trocar horario") || n.includes("mudar horario") || n.includes("reprogramar") || n.includes("cambiar horario") || n.includes("cambiar la cita") || n.includes("cambiar mi cita");
  const askMine = n.includes("meu horario") || n.includes("meus horarios") || n.includes("tenho agendamento") || n.includes("quando e meu") || n.includes("qual meu horario") || n.includes("mi cita") || n.includes("mis citas") || n.includes("tengo cita") || n.includes("cuando es mi") || n.includes("mi turno");
  const askPrice = patternHit.trigger === "pricing" || n.includes("quanto custa") || n.includes("qual o valor") || n.includes("preco") || n.includes("cuanto cuesta") || n.includes("cuanto sale") || n.includes("precio");
  const askHours = patternHit.trigger === "hours" || n.includes("que horario") || n.includes("a que hora abren") || n.includes("horario de atencion");
  const askAddress = patternHit.trigger === "address" || n.includes("donde queda") || n.includes("donde estan") || n.includes("direccion");
  const askProcs = patternHit.trigger === "procedures" || n.includes("o que voces fazem") || n.includes("quais procedimentos") || n.includes("que hacen") || n.includes("que procedimientos") || n.includes("que servicios");
  const wantsBook = n.includes("agendar") || (/\bmarcar\b/.test(n) && !n.includes("remarcar")) || n.includes("reservar") || n.includes("quero ir") || n.includes("quiero ir") || n.includes("sacar turno") || n.includes("pedir turno") || n.includes("una cita") || n.includes("un turno");
  const inScheduling = state.step === "scheduling";

  const lastAptId = typeof state.appointment_id === "string"
    ? state.appointment_id
    : typeof state.last_appointment_id === "string"
      ? state.last_appointment_id
      : null;

  async function upcoming() {
    const { data } = await supabase.from("appointments")
      .select("id, title, start_time, status")
      .eq("studio_id", studioId)
      .eq("client_id", clientId)
      .in("status", ["pending", "confirmed"])
      .gte("start_time", new Date().toISOString())
      .order("start_time")
      .limit(5);
    return data || [];
  }

  async function cancelApt(apt: { id: string; title: string; start_time: string }) {
    await supabase.from("appointments").update({ status: "cancelled" }).eq("id", apt.id);
    await notifyWaitlist(supabase, { studioId, start: new Date(apt.start_time), tz, locale: L, skipClientId: clientId });
    void notifyStudioStaff(supabase, studioId, t("staffCancel", { client: clientName || t("client"), title: apt.title, when: when(apt.start_time) }));
  }

  // Health questions, reactions and complaints are never answered by the bot.
  if (/alergi|reacao|reaccion|inchad|inchaco|hinchaz|ardendo|ardencia|queimou|quemo|\bdor\b|doendo|dolor|me duele|gestante|gravida|embaraz|reclamac|reclamo|reembolso|devolucao|devolucion|falar com (uma |a )?(pessoa|atendente|dona)|hablar con (una |la )?(persona|duena)/.test(n)) {
    await flagHuman(supabase, { studioId, convId: conv.id, clientId, clientName, reason: text.slice(0, 200), locale: L });
    return t("humanReply");
  }

  // Second step of a cancellation: only cancel after an explicit "sim".
  if (state.step === "confirm_cancel" && typeof state.cancel_id === "string") {
    const list = await upcoming();
    const apt = list.find((a) => a.id === state.cancel_id);
    if (apt && saysYes) {
      await cancelApt(apt);
      await supabase.from("conversations").update({ ai_state: { step: "scheduling" } }).eq("id", conv.id);
      return t("cancelDone", { title: apt.title, when: when(apt.start_time) });
    }
    await supabase.from("conversations").update({ ai_state: { last_appointment_id: state.cancel_id } }).eq("id", conv.id);
    delete state.step;
    delete state.cancel_id;
    if (!apt) return t("aptGone");
    if (saysNo) return t("kept", { title: apt.title, when: when(apt.start_time) });
    // Anything else: keep the appointment and handle the message normally below.
  }

  if (looksGreeting(n)) {
    const g = customByTrigger("greeting") || t("greeting", { name: clientName ? `, ${clientName}` : "" });
    return clientName ? g : `${g}\n${t("askName")}`;
  }

  const named = n.match(/(?:meu nome e|me chamo|sou a |sou o |mi nombre es|me llamo|soy )\s*([a-zà-ú][a-zà-ú\s]{1,40})/);
  if (named) {
    const name = named[1].trim().replace(/\s+/g, " ");
    await supabase.from("clients").update({ name }).eq("id", clientId);
    await supabase.from("conversations").update({ ai_state: { ...state, client_name: name } }).eq("id", conv.id);
    return t("niceToMeet", { name });
  }

  if (askMine) {
    const list = await upcoming();
    if (!list.length) return t("noUpcoming");
    await supabase.from("conversations").update({ ai_state: { step: "awaiting_confirm", appointment_id: list[0].id } }).eq("id", conv.id);
    return t("upcomingList", { list: list.map((a) => t("upcomingItem", { title: a.title, when: when(a.start_time) })).join("\n") });
  }

  if (cancelish) {
    const list = await upcoming();
    const apt = list.find((a) => a.id === lastAptId) || list[0];
    if (!apt) return t("noneToCancel");
    // Never cancel on the first message: ask for an explicit "sim".
    await supabase.from("conversations").update({ ai_state: { step: "confirm_cancel", cancel_id: apt.id } }).eq("id", conv.id);
    return t("confirmCancel", { title: apt.title, when: when(apt.start_time) });
  }

  if (confirmish) {
    const list = await upcoming();
    const apt = list.find((a) => a.id === lastAptId) || list[0];
    if (!apt) return t("noneToConfirm");
    if (apt.status !== "confirmed" && needsApproval) return t("pendingApproval", { title: apt.title, when: when(apt.start_time) });
    if (apt.status !== "confirmed") await supabase.from("appointments").update({ status: "confirmed" }).eq("id", apt.id);
    await supabase.from("conversations").update({ ai_state: { last_appointment_id: apt.id } }).eq("id", conv.id);
    void notifyStudioStaff(supabase, studioId, t("staffConfirm", { client: clientName || t("client"), title: apt.title, when: when(apt.start_time) }));
    return t("confirmed", { title: apt.title, when: when(apt.start_time) });
  }

  if (askPrice) {
    if (matchedProc) return t("priceOne", { name: matchedProc.name, price: Number(matchedProc.price).toFixed(0), duration: matchedProc.duration });
    if (procs.length) return t("priceList", { list: procs.map((p) => t("priceItem", { name: p.name, price: Number(p.price).toFixed(0) })).join("\n") });
    return patternHit.response;
  }

  if (askProcs && procs.length) {
    return t("procsList", { studio: studio?.name || "studio", list: procs.map((p) => t("procsItem", { name: p.name, price: Number(p.price).toFixed(0) })).join("\n") });
  }

  if (askAddress) {
    return studio?.address
      ? t("addressIs", { address: studio.address, phone: studio.phone ? t("addressPhone", { phone: studio.phone }) : "" })
      : (patternHit.response || customByTrigger("address") || t("addressUnknown"));
  }

  if (askHours) {
    const configured = studio?.business_hours && Object.keys(studio.business_hours).length > 0;
    return configured
      ? t("hoursAre", { hours: describeWeek(hours, L) })
      : (patternHit.response || customByTrigger("hours") || t("hoursGeneric"));
  }

  if (reschedule) {
    const list = await upcoming();
    const apt = list.find((a) => a.id === lastAptId) || list[0];
    if (!apt) {
      await supabase.from("conversations").update({ ai_state: { step: "scheduling" } }).eq("id", conv.id);
      return t("noneToReschedule");
    }
    if (parsed?.hasTime) {
      // Do NOT cancel yet: the old appointment is only cancelled after the new one
      // is saved (see the booking block below).
      state.reschedule_id = apt.id;
      state.procedure_name = apt.title;
      state.step = "scheduling";
    } else {
      await supabase.from("conversations").update({
        ai_state: { step: "scheduling", last_appointment_id: apt.id, reschedule_id: apt.id, procedure_name: apt.title },
      }).eq("id", conv.id);
      return t("rescheduleAsk", { title: apt.title });
    }
  }

  const wantsSchedule = wantsBook || inScheduling || (parsed?.hasTime && (inScheduling || !!matchedProc || !!state.procedure_id || !!state.procedure_name));
  if (wantsSchedule) {
    const proc = matchedProc || procs.find((p) => p.id === state.procedure_id) || null;
    if (!proc && procs.length > 0 && !state.procedure_name) {
      const list = procs.map((p) => t("procOption", { name: p.name, price: Number(p.price).toFixed(0) })).join("\n");
      await supabase.from("conversations").update({ ai_state: { step: "scheduling", pending_ymd: parsed?.ymd } }).eq("id", conv.id);
      return t("whichProcedure", { list });
    }
    if (!parsed?.hasTime) {
      await supabase.from("conversations").update({
        ai_state: {
          step: "scheduling",
          procedure_id: proc?.id,
          procedure_name: proc?.name || state.procedure_name,
          duration: proc?.duration || state.duration,
          price: proc?.price || state.price,
          pending_ymd: parsed?.ymd || pendingYmd,
          reschedule_id: state.reschedule_id,
        },
      }).eq("id", conv.id);
      return t("whichTime", { proc: proc || state.procedure_name ? t("forProc", { name: String(proc?.name || state.procedure_name) }) : "", day: parsed?.hasDay ? t("onDay", { day: parsed.ymd.split("-").reverse().slice(0, 2).join("/") }) : "" });
    }
    const at = parsed.at;
    if (at.getTime() <= Date.now()) {
      return t("pastTime");
    }
    const duration = Number(proc?.duration || state.duration || 60);
    const end = new Date(at.getTime() + duration * 60 * 1000);
    if (!isWithinBusinessHours(hours, at, end, tz)) {
      await supabase.from("conversations").update({
        ai_state: {
          step: "scheduling",
          procedure_id: proc?.id || state.procedure_id,
          procedure_name: proc?.name || state.procedure_name,
          duration,
          price: proc?.price || state.price,
          reschedule_id: state.reschedule_id,
        },
      }).eq("id", conv.id);
      const alts = await suggestOtherSlots(studioId, at, duration, hours, tz);
      const dayInfo = describeDay(hours, zonedYmd(at, tz), L);
      return alts.length
        ? t("outsideHoursAlts", { day: dayInfo, alts: alts.join(", ") })
        : t("outsideHours", { day: dayInfo });
    }
    // When rescheduling, the client's own old appointment does not count as "busy".
    const rescheduleId = typeof state.reschedule_id === "string" ? state.reschedule_id : undefined;
    const free = await pickFreeProfessional(studioId, at, end, rescheduleId);
    if (!free && await slotTaken(studioId, at, end, null, rescheduleId)) {
      // Keep the scheduling context so the next answer ("e às 16h?") still works.
      await supabase.from("conversations").update({
        ai_state: {
          step: "scheduling",
          procedure_id: proc?.id || state.procedure_id,
          procedure_name: proc?.name || state.procedure_name,
          duration,
          price: proc?.price || state.price,
          reschedule_id: rescheduleId,
        },
      }).eq("id", conv.id);
      const alts = await suggestOtherSlots(studioId, at, duration, hours, tz);
      return alts.length
        ? t("busyAlts", { alts: alts.join(", ") })
        : t("busy");
    }
    // Free the old slot right before inserting (the overlap constraint would block a
    // new time that overlaps the old one). If the insert fails, it is restored below.
    let old: { id: string; title: string; start_time: string; status: string } | null = null;
    if (rescheduleId) {
      const { data } = await supabase.from("appointments").select("id, title, start_time, status")
        .eq("id", rescheduleId).eq("studio_id", studioId).eq("client_id", clientId)
        .in("status", ["pending", "confirmed"]).maybeSingle();
      old = data;
      if (old) await supabase.from("appointments").update({ status: "cancelled" }).eq("id", old.id);
    }
    const restoreOld = async () => {
      if (old) await supabase.from("appointments").update({ status: old.status }).eq("id", old.id);
    };
    const professionalId = free?.id || null;
    const title = String(proc?.name || state.procedure_name || t("appointment"));
    const price = Number(proc?.price || state.price || 0);
    const deposit = depositFor(studio, price);
    const depositLine = deposit > 0 ? `\n${t("depositInfo", { amount: deposit.toFixed(2), key: String(studio?.pix_key || "") })}` : "";
    const { data: created, error } = await supabase.from("appointments").insert({
      studio_id: studioId,
      client_id: clientId,
      professional_id: professionalId,
      procedure_id: proc?.id || null,
      title,
      start_time: at.toISOString(),
      end_time: end.toISOString(),
      date: zonedYmd(at, tz),
      status: needsApproval ? "pending" : "confirmed",
      price,
      payment_status: "pending",
      notes: t("noteWhatsapp"),
      source: "ai",
      deposit_amount: deposit,
    }).select("id").single();
    if (error) {
      console.error(`[whatsapp-webhook] schedule insert failed: ${error.message}`);
      await restoreOld();
      if (String(error.message || "").includes("appointments_no_overlap") || error.code === "23P01") {
        const alts = await suggestOtherSlots(studioId, at, duration, hours, tz);
        return alts.length ? t("justTakenAlts", { alts: alts.join(t("or")) }) : t("justTaken");
      }
      return t("saveFailed");
    }
    await supabase.from("conversations").update({ ai_state: { last_appointment_id: created?.id } }).eq("id", conv.id);
    await supabase.from("notifications").insert({
      studio_id: studioId,
      client_id: clientId,
      type: "new_appointment",
      title: t("notifNewWhatsapp"),
      content: t("notifAptContent", { title, when: when(at) }),
    });
    void notifyStudioStaff(
      supabase,
      studioId,
      old
        ? t("staffReschedule", { client: clientName || t("client"), title, from: when(old.start_time), to: when(at) })
        : t(needsApproval ? "staffNeedsApproval" : "staffNewAuto", { client: clientName || t("client"), title, when: when(at) }),
    );
    if (old) {
      return (needsApproval ? t("pendingApproval", { title, when: when(at) }) : t("rescheduled", { name: clientName ? `, ${clientName}` : "", title, when: when(at) })) + depositLine;
    }
    return (needsApproval ? t("pendingApproval", { title, when: when(at) }) : t("booked", { name: clientName ? `, ${clientName}` : "", title, when: when(at) })) + depositLine;
  }

  if (matchedProc) {
    await supabase.from("conversations").update({
      ai_state: { step: "scheduling", procedure_id: matchedProc.id, procedure_name: matchedProc.name, duration: matchedProc.duration, price: matchedProc.price },
    }).eq("id", conv.id);
    return t("procInfo", { name: matchedProc.name, price: Number(matchedProc.price).toFixed(0), duration: matchedProc.duration });
  }

  const result = matchPattern(text, opts.patterns as any[], opts.customMessages as any[], L);
  return result.response;
}

// Voice notes: OpenAI transcription. Returns "" when it cannot be transcribed.
async function transcribeAudio(opts: {
  base64: string; mimetype: string; seconds: number; instanceName: string; messageKey: unknown; language: Locale;
}): Promise<string> {
  try {
    const apiKey = await getAppSecret("openai_api_key");
    if (!apiKey) return "";
    if (opts.seconds > 180) return ""; // long audios are left for a person
    let b64 = opts.base64;
    if (!b64) {
      // The webhook did not carry the media: ask Evolution for it.
      const evo = await getEvolutionConfig(supabase);
      if (!evo) return "";
      const res = await fetch(`${evo.apiUrl}/chat/getBase64FromMediaMessage/${encodeURIComponent(opts.instanceName)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: evo.apiKey },
        body: JSON.stringify({ message: { key: opts.messageKey }, convertToMp4: false }),
      });
      if (!res.ok) return "";
      b64 = String((await res.json())?.base64 || "");
    }
    b64 = b64.replace(/^data:[^,]+,/, "");
    if (!b64 || b64.length > 12_000_000) return "";
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: opts.mimetype.split(";")[0] || "audio/ogg" }), "audio.ogg");
    form.append("model", (await getAppSecret("openai_transcribe_model")) || "whisper-1");
    form.append("language", opts.language);
    const tr = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form });
    if (!tr.ok) {
      console.error("[whatsapp-webhook] transcription failed", tr.status);
      return "";
    }
    return String((await tr.json())?.text || "").trim().slice(0, MAX_INPUT_CHARS);
  } catch (err) {
    console.error("[whatsapp-webhook] transcription error", err);
    return "";
  }
}

// A message typed by the studio team directly on the phone (fromMe) means a human
// took over the conversation: record it and pause the AI for this conversation.
// Messages the system itself sent (AI, panel, reminders) come back as fromMe too;
// they are recognised because the same text was saved moments before sending.
async function handleOutgoingFromPhone(opts: {
  studioId: string;
  ors: string;
  text: string;
  evolutionMessageId?: string;
  corsHeaders: Record<string, string>;
}) {
  const { studioId, ors, text, evolutionMessageId, corsHeaders } = opts;
  const ok = (extra: Record<string, unknown>) =>
    new Response(JSON.stringify({ received: true, ...extra }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  // Never create clients from outgoing messages (e.g. alerts sent to the staff phone).
  const { data: clients } = await supabase.from("clients").select("id").eq("studio_id", studioId).or(ors).limit(1);
  const clientId = clients?.[0]?.id;
  if (!clientId) return ok({ ignored: "fromMe_unknown_contact" });
  const { data: convs } = await supabase.from("conversations").select("id").eq("studio_id", studioId).eq("client_id", clientId).limit(1);
  const convId = convs?.[0]?.id;
  if (!convId) return ok({ ignored: "fromMe_no_conversation" });

  const since = new Date(Date.now() - ECHO_WINDOW_MS).toISOString();
  const { data: echo } = await supabase.from("messages")
    .select("id")
    .eq("conversation_id", convId)
    .in("sender_type", ["ai", "professional"])
    .eq("content", text)
    .gte("created_at", since)
    .limit(1);
  if (echo && echo.length > 0) return ok({ ignored: "fromMe_echo" });

  const { error } = await supabase.from("messages").insert({
    conversation_id: convId,
    sender_type: "professional",
    content: text,
    message_type: "text",
    status: "sent",
    metadata: { evolution_message_id: evolutionMessageId || null, source: "phone" },
  });
  if (error && String(error.message || "").toLowerCase().includes("duplicate")) return ok({ dedup: true });
  await supabase.from("conversations").update({ ai_enabled: false, last_message_at: new Date().toISOString() }).eq("id", convId);
  return ok({ human_takeover: true });
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
    const fromMe = !!messageData?.key?.fromMe;
    const remoteJid = messageData?.key?.remoteJid || "";
    if (remoteJid.includes("@g.us") || remoteJid.includes("status@broadcast") || remoteJid.includes("@broadcast")) {
      return new Response(JSON.stringify({ received: true, ignored: "group_or_status" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    // Newer WhatsApp versions may hide the number behind a "LID" (1234@lid). The real
    // number then comes in an alternate field. Without it, the LID itself identifies the
    // contact (and is used to reply), instead of becoming a fake phone number.
    const key = messageData?.key || {};
    const isLid = remoteJid.endsWith("@lid");
    const altJid = [key.remoteJidAlt, key.senderPn, key.participantAlt]
      .find((v: unknown) => typeof v === "string" && /@(s\.whatsapp\.net|c\.us)$/.test(v)) as string | undefined;
    const lidOnly = isLid && !altJid;
    const phoneJid = isLid ? (altJid || "") : remoteJid;
    const from = lidOnly ? remoteJid : phoneJid.replace("@s.whatsapp.net", "").replace("@c.us", "").replace(/\D/g, "");
    let text: string = messageData?.message?.conversation || messageData?.message?.extendedTextMessage?.text || "";
    const evolutionMessageId = messageData?.key?.id;
    const audio = messageData?.message?.audioMessage;
    const isAudio = !text && !!audio && !fromMe;
    let audioFailed = false;

    if (!from || (!text && !isAudio)) {
      return new Response(JSON.stringify({ received: true, message: "No text message" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Find the studio by instance name
    const { data: conn } = await supabase.from("evolution_api_connections").select("studio_id").eq("instance_name", instanceName).maybeSingle();
    if (!conn?.studio_id) {
      console.log(`[whatsapp-webhook] Studio not found for instance: ${instanceName}`);
      return new Response(JSON.stringify({ received: true, message: "Studio not found" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const studioId = conn.studio_id;
    const { data: studioTzRow } = await supabase.from("studios").select("timezone, locale").eq("id", studioId).maybeSingle();
    const tz = safeTz(studioTzRow?.timezone);
    const studioLocale: Locale = safeLocale(studioTzRow?.locale);

    // Voice note: transcribe it and treat the text like a typed message.
    if (isAudio) {
      const transcript = await transcribeAudio({
        base64: String(messageData?.message?.base64 || messageData?.base64 || ""),
        mimetype: String(audio?.mimetype || "audio/ogg"),
        seconds: Number(audio?.seconds || 0),
        instanceName,
        messageKey: messageData?.key,
        language: studioLocale,
      });
      if (transcript) text = transcript;
      else { audioFailed = true; text = "[áudio]"; }
    }

    const digits = lidOnly ? remoteJid : normalizePhone(from);
    const ors = lidOnly
      ? `whatsapp.eq."${remoteJid.replace(/[^0-9a-z@.]/gi, "")}"`
      : [
        ...phoneLookupValues(from).flatMap((v) => [`phone.eq.${v}`, `whatsapp.eq.${v}`]),
        ...(isLid ? [`whatsapp.eq."${remoteJid.replace(/[^0-9a-z@.]/gi, "")}"`] : []),
      ].join(",");
    if (fromMe) {
      return await handleOutgoingFromPhone({ studioId, ors, text, evolutionMessageId, corsHeaders });
    }

    const { data: matchedClients, error: clientLookupError } = await supabase.from("clients").select("id").eq("studio_id", studioId).or(ors).limit(1);
    if (clientLookupError) {
      console.error(`[whatsapp-webhook] Client lookup failed: ${clientLookupError.message}`);
      return new Response(JSON.stringify({ error: "Client lookup failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    let client = matchedClients?.[0] ?? null;
    const isNewClient = !client;
    if (!client) {
      // Name stays digits-only until the client says it (the AI treats a numeric name as "unknown").
      const newClient = await supabase.from("clients").insert({
        studio_id: studioId,
        name: lidOnly ? remoteJid.replace(/\D/g, "") : from,
        phone: lidOnly ? "" : digits,
        whatsapp: digits,
        source: "whatsapp",
      }).select("id").single();
      client = newClient.data;
    }
    if (!client?.id) {
      console.error("[whatsapp-webhook] Failed to create client");
      return new Response(JSON.stringify({ error: "Failed to create client" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: matchedConvs } = await supabase.from("conversations").select("id, ai_enabled, ai_state").eq("studio_id", studioId).eq("client_id", client.id).limit(1);
    let conv = matchedConvs?.[0] ?? null;
    const isNewConv = !conv;
    if (!conv) {
      const newConv = await supabase.from("conversations").insert({ studio_id: studioId, client_id: client.id, channel: "whatsapp", status: "active", ai_enabled: true, ai_state: {} }).select("id, ai_enabled, ai_state").single();
      if (newConv.error && String(newConv.error.message || "").toLowerCase().includes("duplicate")) {
        const retry = await supabase.from("conversations").select("id, ai_enabled, ai_state").eq("studio_id", studioId).eq("client_id", client.id).limit(1);
        conv = retry.data?.[0] ?? null;
      } else {
        conv = newConv.data;
      }
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

    const { error: inMsgErr } = await supabase.from("messages").insert({
      conversation_id: conv.id,
      sender_type: "client",
      content: text,
      message_type: isAudio ? "audio" : "text",
      metadata: { evolution_message_id: evolutionMessageId || null },
    });
    if (inMsgErr && String(inMsgErr.message || "").toLowerCase().includes("duplicate")) {
      return new Response(JSON.stringify({ received: true, dedup: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    await supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", conv.id);
    if (isNewConv || isNewClient) {
      await supabase.from("notifications").insert({
        studio_id: studioId,
        client_id: client.id,
        type: "whatsapp_message",
        title: msg(studioLocale, "notifNewConversation"),
        content: text.slice(0, 180),
      });
    }

    // LGPD opt-out: "SAIR" / "SALIR" stops promotional messages for this client.
    if (/^(sair|parar|pare|stop|salir|baja|cancelar promocoes|cancelar promociones)[\s!.]*$/.test(normalizeText(text))) {
      await supabase.from("clients").update({ marketing_opt_out: true, opted_out_at: new Date().toISOString() }).eq("id", client.id);
      const reply = msg(studioLocale, "optOutDone");
      const { data: outMsg } = await supabase.from("messages").insert({ conversation_id: conv.id, sender_type: "ai", content: reply, message_type: "text", status: "pending", metadata: { type: "opt_out" } }).select("id").single();
      const evoCfg = await getEvolutionConfig(supabase);
      const ok = evoCfg ? (await sendEvolutionText(evoCfg, instanceName, digits || from, reply)).ok : false;
      if (outMsg?.id) await supabase.from("messages").update({ status: ok ? "sent" : "failed" }).eq("id", outMsg.id);
      return new Response(JSON.stringify({ success: true, opt_out: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Subscription: a paused or cancelled studio keeps receiving messages in the
    // panel, but the AI does not answer.
    const planInfo = await getStudioPlan(supabase, studioId);

    // Flood guard: if the AI already answered a lot in this conversation in the last
    // 10 minutes (another bot, spam), stop answering. The team still sees the messages.
    let aiAllowed = !!conv.ai_enabled && subscriptionAllowsAi(planInfo.status);
    if (aiAllowed) {
      const { count: recentAi } = await supabase.from("messages").select("id", { count: "exact", head: true })
        .eq("conversation_id", conv.id)
        .eq("sender_type", "ai")
        .gte("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());
      if ((recentAi ?? 0) >= MAX_AI_REPLIES_PER_CONV_10MIN) {
        console.warn(`[whatsapp-webhook] AI paused by flood guard for conversation ${conv.id}`);
        aiAllowed = false;
      }
    }

    // If AI is enabled, generate and send response
    if (aiAllowed) {
      const { data: aiSettings } = await supabase.from("ai_settings").select("ai_patterns, custom_messages, tom_voz, personalidade").eq("studio_id", studioId).maybeSingle();
      const patterns = aiSettings?.ai_patterns || [];
      const customMessages = aiSettings?.custom_messages || [];
      let response: string | null = null;
      let engine: "gpt" | "rules" = "rules";
      let openaiKey = await getAppSecret("openai_api_key");
      // Short answers to a reminder / cancel question ("1", "2", "sim") are handled by
      // the deterministic engine, which knows which appointment the question was about.
      const convState = (conv.ai_state || {}) as Record<string, unknown>;
      const shortReply = /^(1|2|sim|s|nao|n|pode|pode sim|confirmo|confirmar|cancelar|cancela)[\s!.]*$/.test(normalizeText(text));
      if ((convState.step === "awaiting_confirm" || convState.step === "confirm_cancel") && shortReply) openaiKey = null;
      if (openaiKey) {
        // Daily GPT budget per studio. Above it, the free rule-based engine answers.
        const limit = Number(await getAppSecret("openai_daily_limit_per_studio")) || DEFAULT_GPT_DAILY_LIMIT_PER_STUDIO;
        const { count: usedToday } = await supabase.from("messages")
          .select("id, conversations!inner(studio_id)", { count: "exact", head: true })
          .eq("conversations.studio_id", studioId)
          .eq("metadata->>engine", "gpt")
          .gte("created_at", zonedDayBounds(new Date(), tz).start.toISOString());
        if ((usedToday ?? 0) >= limit) {
          console.warn(`[whatsapp-webhook] GPT daily limit reached for studio ${studioId} (${usedToday}/${limit})`);
          openaiKey = null;
        }
      }
      if (openaiKey && planInfo.aiMonthlyLimit !== null) {
        // Plan limit: GPT replies per month. Above it, the keyword engine answers.
        const monthStart = fromZonedWall(`${zonedYmd(new Date(), tz).slice(0, 7)}-01`, 0, 0, tz);
        const { count: usedMonth } = await supabase.from("messages")
          .select("id, conversations!inner(studio_id)", { count: "exact", head: true })
          .eq("conversations.studio_id", studioId)
          .eq("metadata->>engine", "gpt")
          .gte("created_at", monthStart.toISOString());
        if ((usedMonth ?? 0) >= planInfo.aiMonthlyLimit) {
          console.warn(`[whatsapp-webhook] plan GPT limit reached for studio ${studioId} (${usedMonth}/${planInfo.aiMonthlyLimit})`);
          openaiKey = null;
        }
      }
      if (audioFailed) {
        response = msg(studioLocale, "audioFailed");
        openaiKey = null;
      }
      if (openaiKey) {
        const { data: hist } = await supabase.from("messages")
          .select("sender_type, content")
          .eq("conversation_id", conv.id)
          .order("created_at", { ascending: false })
          .limit(16);
        const chronological = (hist || []).slice().reverse();
        const history = chronological.slice(0, -1)
          .filter((m) => m.sender_type === "client" || m.sender_type === "ai")
          .map((m) => ({
            role: (m.sender_type === "ai" ? "assistant" : "user") as "assistant" | "user",
            content: String(m.content || ""),
          }));
        const model = (await getAppSecret("openai_model")) || "gpt-4o-mini";
        response = await runGptSecretary({
          apiKey: openaiKey,
          model,
          supabase,
          studioId,
          clientId: client.id,
          convId: conv.id,
          userText: text.slice(0, MAX_INPUT_CHARS),
          history: history.map((m) => ({ ...m, content: m.content.slice(0, MAX_INPUT_CHARS) })),
          personalidade: aiSettings?.personalidade,
          tomVoz: aiSettings?.tom_voz,
          customMessages: customMessages as { trigger?: string; label?: string; message?: string; enabled?: boolean }[],
          patterns: patterns as { label?: string; keywords?: string[]; response?: string; enabled?: boolean }[],
        });
        if (response) engine = "gpt";
      }
      if (!response) {
        // No OpenAI key, budget exhausted, or GPT failed: the rule-based engine answers.
        response = await handleAiTurn({
          studioId,
          clientId: client.id,
          conv,
          text,
          patterns,
          customMessages,
        });
      }
      if (engine === "rules") {
        const tom = (aiSettings?.tom_voz || "").toLowerCase();
        if (tom.includes("formal")) {
          response = response.replace(/!+/g, ".");
        }
      }

      const { data: aiMsg } = await supabase.from("messages").insert({
        conversation_id: conv.id,
        sender_type: "ai",
        content: response,
        message_type: "text",
        status: "pending",
        metadata: { engine },
      }).select("id").single();

      const evo = await getEvolutionConfig(supabase);
      const sendOk = evo ? (await sendEvolutionText(evo, instanceName, digits || from, response)).ok : false;
      if (!evo) console.error("[whatsapp-webhook] evolution_api_url/evolution_api_key missing in app_secrets");
      if (aiMsg?.id) {
        await supabase.from("messages").update({ status: sendOk ? "sent" : "failed" }).eq("id", aiMsg.id);
      }
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error(`[whatsapp-webhook] Unhandled error: ${err.message}`);
    console.error("[whatsapp-webhook] unhandled", err);
    return new Response(JSON.stringify({ error: "Erro interno. Tente novamente." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
