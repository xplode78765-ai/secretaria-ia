// Date/time helpers. Every function that depends on "local time" takes the
// studio's IANA timezone (studios.timezone) as a REQUIRED argument, so nothing
// silently falls back to São Paulo.

export const DEFAULT_TZ = "America/Sao_Paulo";

// Returns tz if the runtime knows it, otherwise the default.
export function safeTz(tz: string | null | undefined): string {
  const v = String(tz || "").trim();
  if (!v) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: v });
    return v;
  } catch {
    return DEFAULT_TZ;
  }
}

export function normalizePhone(raw: string): string {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d;
}

export function phoneLookupValues(raw: string): string[] {
  const n = normalizePhone(raw);
  const values = new Set<string>([raw, n].filter(Boolean));
  if (n.startsWith("55") && n.length >= 12) values.add(n.slice(2));
  return [...values];
}

// UTC offset of tz at a given instant, as "+HH:MM" / "-HH:MM".
function offsetAt(at: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "longOffset",
  }).formatToParts(at);
  const name = parts.find((p) => p.type === "timeZoneName")?.value || "GMT";
  const m = name.match(/GMT([+-]\d{2}:\d{2})/i);
  return m ? m[1] : "+00:00"; // "GMT" alone means UTC
}

export function zonedYmd(at: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

export function zonedHour(at: Date, tz: string): number {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    hour12: false,
  }).format(at);
  return Number.parseInt(hour, 10) % 24;
}

export function zonedMinutesOfDay(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === "hour")?.value || 0) % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value || 0);
  return h * 60 + m;
}

// The instant that shows `hour:minute` on the wall clock of tz on day ymd.
export function fromZonedWall(ymd: string, hour: number, minute: number, tz: string): Date {
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  // Offset taken at (roughly) that moment, so DST zones resolve correctly.
  const guess = new Date(`${ymd}T${hh}:${mm}:00Z`);
  const first = new Date(`${ymd}T${hh}:${mm}:00${offsetAt(guess, tz)}`);
  const offset = offsetAt(first, tz);
  return new Date(`${ymd}T${hh}:${mm}:00${offset}`);
}

export function zonedDayBounds(now: Date, tz: string) {
  const day = zonedYmd(now, tz);
  const start = fromZonedWall(day, 0, 0, tz);
  const next = fromZonedWall(addDaysYmd(day, 1), 0, 0, tz);
  const end = new Date(next.getTime() - 1);
  return { start, end, day };
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function formatZoned(d: Date, tz: string): string {
  return d.toLocaleString("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// "2026-11-05T14:00" (no offset) is read as wall-clock time in tz.
export function parseNaiveInZone(value: string, tz: string): Date {
  const v = String(value || "").trim();
  if (!v) return new Date(NaN);
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(v)) return new Date(v);
  const m = v.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!m) return new Date(NaN);
  return fromZonedWall(m[1], Number(m[2]), Number(m[3]), tz);
}

export function normalizeText(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

function isValidYmd(ymd: string): boolean {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export type ParsedWhen = { at: Date; hasTime: boolean; hasDay: boolean; ymd: string };

// Understands Portuguese and Spanish: "amanhã 14h", "sexta de manhã", "22/10 às 10h",
// "dia 5", "mañana a las 3", "el lunes por la tarde", "pasado mañana"... relative to
// "now" in the studio's timezone. Also the canonical "2026-11-12 14:30" (used by GPT).
// Impossible dates/times ("31/02", "25h") => null.
export function parseBrazilianDateTimeParts(text: string, now: Date, tz: string, defaultYmd?: string): ParsedWhen | null {
  const today = zonedYmd(now, tz);
  const iso = String(text || "").trim().match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (iso) {
    if (!isValidYmd(iso[1])) return null;
    if (!iso[2]) return { at: fromZonedWall(iso[1], 10, 0, tz), hasTime: false, hasDay: true, ymd: iso[1] };
    const h = Number(iso[2]);
    const mi = Number(iso[3]);
    if (h > 23 || mi > 59) return null;
    return { at: fromZonedWall(iso[1], h, mi, tz), hasTime: true, hasDay: true, ymd: iso[1] };
  }

  let n = normalizeText(text);
  // Spanish "mañana" means "tomorrow", but "por/de la mañana" means "in the morning".
  const esMorning = /\b(por|de|en) la manana\b/.test(n);
  n = n.replace(/\b(por|de|en) la manana\b/g, " $1 la_manana ");
  const dayAfter = /depois de amanha|pasado manana/.test(n);
  const tomorrow = !dayAfter && (/\bamanha\b/.test(n) || /\bmanana\b/.test(n));
  const isToday = /\bhoje\b|\bhoy\b/.test(n);

  let ymd = defaultYmd && /^\d{4}-\d{2}-\d{2}$/.test(defaultYmd) ? defaultYmd : today;
  let daySet = !!(defaultYmd && defaultYmd !== today && !isToday && !tomorrow && !dayAfter);
  if (dayAfter) {
    ymd = addDaysYmd(today, 2);
    daySet = true;
  } else if (tomorrow) {
    ymd = addDaysYmd(today, 1);
    daySet = true;
  } else if (isToday) {
    ymd = today;
    daySet = true;
  } else {
    const m = n.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/) || n.match(/\bdia\s+(\d{1,2})\b/);
    if (m && m[2]) {
      const d = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10);
      let y = m[3] ? parseInt(m[3], 10) : Number(today.slice(0, 4));
      if (y < 100) y += 2000;
      ymd = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      daySet = true;
    } else if (m) {
      const d = parseInt(m[1], 10);
      const mo = Number(today.slice(5, 7));
      const y = Number(today.slice(0, 4));
      ymd = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      if (ymd < today) {
        const nextMo = mo === 12 ? 1 : mo + 1;
        const nextY = mo === 12 ? y + 1 : y;
        ymd = `${nextY}-${String(nextMo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      }
      daySet = true;
    } else {
      const week = [
        ["domingo"], ["segunda", "lunes"], ["terca", "martes"], ["quarta", "miercoles"],
        ["quinta", "jueves"], ["sexta", "viernes"], ["sabado"],
      ];
      const idx = week.findIndex((names) => names.some((w) => new RegExp(`\\b${w}\\b`).test(n)));
      if (idx >= 0) {
        const [yy, mm, dd] = today.split("-").map(Number);
        const weekdayNow = new Date(Date.UTC(yy, mm - 1, dd, 12, 0, 0)).getUTCDay();
        const diff = (idx - weekdayNow + 7) % 7 || 7;
        ymd = addDaysYmd(today, diff);
        daySet = true;
      }
    }
  }
  if (!isValidYmd(ymd)) return null;
  let hour: number | null = null;
  let minute = 0;
  const morning = /\bmanha\b/.test(n) || esMorning;
  const afternoon = /\btarde\b/.test(n);
  const night = /\bnoite\b|\bnoche\b/.test(n);
  const clock = n.match(/(\d{1,2})\s*(?:h|:|hs)\s*(\d{2})?/); // "14h", "14:30" (24-hour habit)
  const spoken = clock ? null : n.match(/\b(?:as|a las|a la)\s+(\d{1,2})(?:\s*(?:e|y)\s*(meia|media))?\b/); // "às 3", "a las 3 y media"
  const hm = clock || spoken || n.match(/(\d{1,2})\s*horas?/);
  if (hm) {
    hour = parseInt(hm[1], 10);
    minute = hm[2] === "meia" || hm[2] === "media" ? 30 : hm[2] ? parseInt(hm[2], 10) : 0;
    if (hour > 23 || minute > 59) return null;
    // "3 da tarde" / "3 de la tarde" / "8 da noite" = 15h / 20h.
    if (hour >= 1 && hour <= 11 && (afternoon || night)) hour += 12;
    // Spoken "às 3" / "a las 3" with no "manhã/mañana" means the afternoon
    // (studios do not open at 3 a.m.). "3h" / "3:00" are kept as written.
    else if (spoken && hour >= 1 && hour <= 7 && !morning) hour += 12;
  } else if (/\balmoco\b|\balmuerzo\b/.test(n)) {
    hour = 14;
  } else if (/\bmediodia\b|\bmeio dia\b|\bmeio-dia\b/.test(n)) {
    hour = 12;
  } else if (morning) {
    hour = 10;
  } else if (afternoon) {
    hour = 15;
  } else if (night) {
    hour = 18;
  }
  if (hour === null && !daySet) return null;
  const hasTime = hour !== null;
  return { at: fromZonedWall(ymd, hour ?? 10, minute, tz), hasTime, hasDay: daySet, ymd };
}

export function parseBrazilianDateTime(text: string, now: Date, tz: string): Date | null {
  const p = parseBrazilianDateTimeParts(text, now, tz);
  if (!p?.hasTime) return null;
  return p.at;
}
