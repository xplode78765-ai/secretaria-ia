// Business hours stored in studios.business_hours (jsonb), keyed by weekday
// "0" (Sunday) .. "6" (Saturday):  { "1": { "open": "09:00", "close": "19:00" }, "0": { "closed": true } }
// Keep in sync with src/lib/business-hours.ts.
import { zonedMinutesOfDay, zonedYmd } from "./brazil.ts";

export type DayWindow = { open: number; close: number } | null; // minutes since 00:00, null = closed

const DEFAULT_DAY = { open: 9 * 60, close: 19 * 60 };
export const WEEKDAY_NAMES = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

function toMinutes(v: unknown): number | null {
  const m = String(v ?? "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  return Math.min(h * 60 + min, 24 * 60);
}

// Empty / invalid config => Mon–Sat 09:00–19:00, Sunday closed.
// Older format saved by the first "Expediente do link público" editor:
//   { open: "09:00", close: "19:00", weekdays: [1,2,3,4,5,6] }
function fromLegacy(raw: Record<string, unknown>): DayWindow[] | null {
  if (!Array.isArray(raw.weekdays)) return null;
  const open = toMinutes(raw.open) ?? DEFAULT_DAY.open;
  const close = toMinutes(raw.close) ?? DEFAULT_DAY.close;
  const days = new Set(raw.weekdays.map(Number).filter((n) => n >= 0 && n <= 6));
  if (close <= open || days.size === 0) return null;
  return Array.from({ length: 7 }, (_, d) => (days.has(d) ? { open, close } : null));
}

export function normalizeBusinessHours(raw: unknown): DayWindow[] {
  const src = raw && typeof raw === "object" ? raw as Record<string, Record<string, unknown>> : {};
  const legacy = fromLegacy(src as Record<string, unknown>);
  if (legacy) return legacy;
  const configured = Object.keys(src).some((k) => /^[0-6]$/.test(k));
  return Array.from({ length: 7 }, (_, d) => {
    if (!configured) return d === 0 ? null : { ...DEFAULT_DAY };
    const day = src[String(d)];
    if (!day || day.closed) return null;
    const open = toMinutes(day.open);
    const close = toMinutes(day.close);
    if (open === null || close === null || close <= open) return null;
    return { open, close };
  });
}

export function weekdayOfYmd(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
}

export function windowForYmd(hours: DayWindow[], ymd: string): DayWindow {
  return hours[weekdayOfYmd(ymd)] ?? null;
}

export function isWithinBusinessHours(hours: DayWindow[], start: Date, end: Date, tz: string): boolean {
  const ymd = zonedYmd(start, tz);
  if (zonedYmd(new Date(end.getTime() - 1), tz) !== ymd) return false;
  const w = windowForYmd(hours, ymd);
  if (!w) return false;
  const s = zonedMinutesOfDay(start, tz);
  const e = s + Math.round((end.getTime() - start.getTime()) / 60000);
  return s >= w.open && e <= w.close;
}

export function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

type Lang = "pt" | "es";
const NAMES: Record<Lang, string[]> = {
  pt: WEEKDAY_NAMES,
  es: ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"],
};
const WORDS: Record<Lang, { to: string; closed: string }> = {
  pt: { to: "às", closed: "fechado" },
  es: { to: "a", closed: "cerrado" },
};

export function describeDay(hours: DayWindow[], ymd: string, lang: Lang = "pt"): string {
  const w = windowForYmd(hours, ymd);
  const name = NAMES[lang][weekdayOfYmd(ymd)];
  return w ? `${name}: ${fmtMinutes(w.open)} ${WORDS[lang].to} ${fmtMinutes(w.close)}` : `${name}: ${WORDS[lang].closed}`;
}

export function describeWeek(hours: DayWindow[], lang: Lang = "pt"): string {
  return [1, 2, 3, 4, 5, 6, 0].map((d) => {
    const w = hours[d];
    return `${NAMES[lang][d]} ${w ? `${fmtMinutes(w.open)}–${fmtMinutes(w.close)}` : WORDS[lang].closed}`;
  }).join(", ");
}
