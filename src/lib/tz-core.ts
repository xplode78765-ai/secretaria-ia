// Pure timezone helpers (no React, no date-fns) so they can be unit-tested.
// See timezone.ts for the explanation of the 'studio clock' technique.

export const DEFAULT_TZ = 'America/Sao_Paulo'

export const STUDIO_TIMEZONES: { value: string; label: string }[] = [
  { value: 'America/Sao_Paulo', label: 'Brasília (UTC−3) — SP, RJ, MG, Sul, Nordeste, GO, DF, PA, AP, TO' },
  { value: 'America/Manaus', label: 'Manaus (UTC−4) — AM' },
  { value: 'America/Cuiaba', label: 'Cuiabá (UTC−4) — MT' },
  { value: 'America/Campo_Grande', label: 'Campo Grande (UTC−4) — MS' },
  { value: 'America/Porto_Velho', label: 'Porto Velho (UTC−4) — RO' },
  { value: 'America/Boa_Vista', label: 'Boa Vista (UTC−4) — RR' },
  { value: 'America/Rio_Branco', label: 'Rio Branco (UTC−5) — AC' },
  { value: 'America/Noronha', label: 'Fernando de Noronha (UTC−2)' },
]

export function safeTz(tz: string | null | undefined): string {
  const v = String(tz || '').trim()
  if (!v) return DEFAULT_TZ
  try { new Intl.DateTimeFormat('en-US', { timeZone: v }); return v } catch { return DEFAULT_TZ }
}

const fmtCache = new Map<string, Intl.DateTimeFormat>()
function partsIn(at: Date, tz: string) {
  let f = fmtCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    fmtCache.set(tz, f)
  }
  const p: Record<string, number> = {}
  for (const part of f.formatToParts(at)) if (part.type !== 'literal') p[part.type] = Number(part.value)
  return { y: p.year, mo: p.month, d: p.day, h: p.hour % 24, mi: p.minute, s: p.second }
}

// Minutes to add to UTC to get the wall clock of tz at instant `at`.
function offsetMinutes(at: Date, tz: string) {
  const p = partsIn(at, tz)
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s)
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000)
}

/** Instant (ISO string or Date) -> Date whose LOCAL fields show the studio's wall clock. */
export function toStudioClock(input: string | Date, tz: string): Date {
  const at = typeof input === 'string' ? new Date(input) : input
  if (Number.isNaN(at.getTime())) return at
  const p = partsIn(at, tz)
  return new Date(p.y, p.mo - 1, p.d, p.h, p.mi, p.s, at.getMilliseconds())
}

/** Inverse of toStudioClock: a Date whose local fields are a studio wall time -> real instant. */
export function fromStudioClock(local: Date, tz: string): Date {
  const wall = Date.UTC(local.getFullYear(), local.getMonth(), local.getDate(), local.getHours(), local.getMinutes(), local.getSeconds(), local.getMilliseconds())
  let instant = wall - offsetMinutes(new Date(wall), tz) * 60000
  instant = wall - offsetMinutes(new Date(instant), tz) * 60000 // second pass for DST zones
  return new Date(instant)
}

/** Short label like "horário de Manaus" when the browser is in a different zone. */
export function browserDiffersFrom(tz: string): boolean {
  const browser = Intl.DateTimeFormat().resolvedOptions().timeZone
  const now = new Date()
  return offsetMinutes(now, browser) !== offsetMinutes(now, tz)
}

export function tzCity(tz: string): string {
  return (tz.split('/').pop() || tz).replace(/_/g, ' ')
}
