export const SP_TZ = "America/Sao_Paulo";

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

function spOffset(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SP_TZ,
    timeZoneName: "longOffset",
  }).formatToParts(at);
  const name = parts.find((p) => p.type === "timeZoneName")?.value || "GMT-03:00";
  const m = name.match(/GMT([+-]\d{2}:\d{2})/i);
  return m ? m[1] : "-03:00";
}

export function saoPauloYmd(at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

export function saoPauloHour(at = new Date()): number {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: SP_TZ,
    hour: "2-digit",
    hour12: false,
  }).format(at);
  return Number.parseInt(hour, 10);
}

export function saoPauloDayBounds(now = new Date()) {
  const day = saoPauloYmd(now);
  const offset = spOffset(now);
  const start = new Date(`${day}T00:00:00${offset}`);
  const end = new Date(`${day}T23:59:59.999${offset}`);
  return { start, end, day, offset };
}

export function fromSaoPauloWall(ymd: string, hour: number, minute: number, at = new Date()) {
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return new Date(`${ymd}T${hh}:${mm}:00${spOffset(at)}`);
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function formatSaoPaulo(d: Date): string {
  return d.toLocaleString("pt-BR", { timeZone: SP_TZ });
}

export type StudioHours = { open: string; close: string; weekdays: number[] };

export const DEFAULT_HOURS: StudioHours = { open: "09:00", close: "19:00", weekdays: [1, 2, 3, 4, 5, 6] };

export function parseStudioHours(raw: unknown): StudioHours {
  const obj = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const open = typeof obj.open === "string" && /^\d{2}:\d{2}$/.test(obj.open) ? obj.open : DEFAULT_HOURS.open;
  const close = typeof obj.close === "string" && /^\d{2}:\d{2}$/.test(obj.close) ? obj.close : DEFAULT_HOURS.close;
  const weekdays = Array.isArray(obj.weekdays)
    ? [...new Set(obj.weekdays.map(Number).filter((n) => n >= 0 && n <= 6))]
    : DEFAULT_HOURS.weekdays;
  return { open, close, weekdays: weekdays.length ? weekdays : DEFAULT_HOURS.weekdays };
}

export function saoPauloClock(at: Date): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SP_TZ,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const wd = parts.find((p) => p.type === "weekday")?.value || "Sun";
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hour = Number(parts.find((p) => p.type === "hour")?.value || "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value || "0");
  return { weekday: map[wd] ?? 0, minutes: hour * 60 + minute };
}

export function outsideStudioHours(start: Date, end: Date, raw: unknown): string | null {
  const hours = parseStudioHours(raw);
  const clock = saoPauloClock(start);
  const endClock = saoPauloClock(end);
  if (!hours.weekdays.includes(clock.weekday)) return "O studio não atende neste dia.";
  const [oh, om] = hours.open.split(":").map(Number);
  const [ch, cm] = hours.close.split(":").map(Number);
  if (clock.minutes < oh * 60 + om || endClock.minutes > ch * 60 + cm || endClock.weekday !== clock.weekday) {
    return `Escolha um horário dentro do expediente (${hours.open}–${hours.close}).`;
  }
  return null;
}

export function parseNaiveAsSaoPaulo(value: string): Date {
  const v = String(value || "").trim();
  if (!v) return new Date(NaN);
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(v)) return new Date(v);
  const local = v.length === 16 ? `${v}:00` : v;
  return new Date(`${local}${spOffset(new Date())}`);
}

export function normalizeText(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

export type ParsedWhen = { at: Date; hasTime: boolean; hasDay: boolean; ymd: string };

export function parseBrazilianDateTimeParts(text: string, now = new Date(), defaultYmd?: string): ParsedWhen | null {
  const n = normalizeText(text);
  let ymd = defaultYmd && /^\d{4}-\d{2}-\d{2}$/.test(defaultYmd) ? defaultYmd : saoPauloYmd(now);
  let daySet = !!(defaultYmd && defaultYmd !== saoPauloYmd(now) && !n.includes("hoje") && !n.includes("amanha"));
  if (n.includes("amanha")) {
    ymd = addDaysYmd(saoPauloYmd(now), 1);
    daySet = true;
  } else if (n.includes("hoje")) {
    ymd = saoPauloYmd(now);
    daySet = true;
  } else {
    const m = n.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/) || n.match(/\bdia\s+(\d{1,2})\b/);
    if (m && m[2]) {
      const d = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10);
      let y = m[3] ? parseInt(m[3], 10) : Number(saoPauloYmd(now).slice(0, 4));
      if (y < 100) y += 2000;
      ymd = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      daySet = true;
    } else if (m) {
      const d = parseInt(m[1], 10);
      const nowYmd = saoPauloYmd(now);
      const mo = Number(nowYmd.slice(5, 7));
      const y = Number(nowYmd.slice(0, 4));
      ymd = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      if (ymd < nowYmd) {
        const nextMo = mo === 12 ? 1 : mo + 1;
        const nextY = mo === 12 ? y + 1 : y;
        ymd = `${nextY}-${String(nextMo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      }
      daySet = true;
    } else {
      const week = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
      const idx = week.findIndex((w) => n.includes(w));
      if (idx >= 0) {
        const [yy, mm, dd] = saoPauloYmd(now).split("-").map(Number);
        const weekdayNow = new Date(Date.UTC(yy, mm - 1, dd, 12, 0, 0)).getUTCDay();
        const diff = (idx - weekdayNow + 7) % 7 || 7;
        ymd = addDaysYmd(saoPauloYmd(now), diff);
        daySet = true;
      }
    }
  }
  let hour: number | null = null;
  let minute = 0;
  const hm = n.match(/(\d{1,2})\s*(?:h|:|hs)\s*(\d{2})?/) || n.match(/(?:as|às)\s+(\d{1,2})\b/) || n.match(/(\d{1,2})\s*horas?/);
  if (hm) {
    hour = parseInt(hm[1], 10);
    minute = hm[2] ? parseInt(hm[2], 10) : 0;
  } else if (n.includes("almoco") || n.includes("depois do almoco")) {
    hour = 14;
  } else if (/\bmanha\b/.test(n)) {
    hour = 10;
  } else if (/\btarde\b/.test(n)) {
    hour = 15;
  } else if (/\bnoite\b/.test(n)) {
    hour = 18;
  }
  if (hour === null && !daySet) return null;
  const hasTime = hour !== null;
  return { at: fromSaoPauloWall(ymd, hour ?? 10, minute), hasTime, hasDay: daySet, ymd };
}

export function parseBrazilianDateTime(text: string, now = new Date()): Date | null {
  const p = parseBrazilianDateTimeParts(text, now);
  if (!p?.hasTime) return null;
  return p.at;
}
