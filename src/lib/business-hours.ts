// Business hours stored in studios.business_hours (jsonb), keyed by weekday
// "0" (Sunday) .. "6" (Saturday). Keep in sync with supabase/functions/_shared/hours.ts.

export type DayConfig = { open: string; close: string; closed: boolean }
export type WeekConfig = Record<string, DayConfig>

type Lang = 'pt' | 'es'
const LABELS: Record<Lang, string[]> = {
  pt: ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'],
  es: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'],
}
const SHORT: Record<Lang, string[]> = {
  pt: ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'],
  es: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'],
}
const CLOSED: Record<Lang, string> = { pt: 'fechado', es: 'cerrado' }

export function weekdayLabels(lang: Lang = 'pt') { return LABELS[lang] }
/** @deprecated use weekdayLabels(lang) */
export const WEEKDAY_LABELS = LABELS.pt
// Monday first, the way people read a week.
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]

export function defaultWeek(): WeekConfig {
  const w: WeekConfig = {}
  for (let d = 0; d < 7; d++) w[String(d)] = { open: '09:00', close: '19:00', closed: d === 0 }
  return w
}

const TIME_RE = /^\d{2}:\d{2}$/

export function loadWeek(raw: unknown): WeekConfig {
  const base = defaultWeek()
  if (!raw || typeof raw !== 'object') return base
  // Older format: { open: "09:00", close: "19:00", weekdays: [1,2,3,4,5,6] }
  const legacy = raw as { open?: unknown; close?: unknown; weekdays?: unknown }
  if (Array.isArray(legacy.weekdays)) {
    const open = TIME_RE.test(String(legacy.open)) ? String(legacy.open) : '09:00'
    const close = TIME_RE.test(String(legacy.close)) ? String(legacy.close) : '19:00'
    const days = new Set(legacy.weekdays.map(Number))
    for (let d = 0; d < 7; d++) base[String(d)] = { open, close, closed: !days.has(d) }
    return base
  }
  const src = raw as Record<string, Partial<DayConfig>>
  if (!Object.keys(src).some((k) => /^[0-6]$/.test(k))) return base
  for (let d = 0; d < 7; d++) {
    const day = src[String(d)]
    if (!day) { base[String(d)] = { ...base[String(d)], closed: true }; continue }
    base[String(d)] = {
      open: TIME_RE.test(String(day.open)) ? String(day.open) : '09:00',
      close: TIME_RE.test(String(day.close)) ? String(day.close) : '19:00',
      closed: !!day.closed,
    }
  }
  return base
}

export function validateWeek(w: WeekConfig, lang: Lang = 'pt'): string | null {
  for (let d = 0; d < 7; d++) {
    const day = w[String(d)]
    if (day.closed) continue
    if (!TIME_RE.test(day.open) || !TIME_RE.test(day.close) || day.close <= day.open) {
      return lang === 'es'
        ? `${LABELS.es[d]}: el cierre debe ser después de la apertura.`
        : `${LABELS.pt[d]}: o fechamento precisa ser depois da abertura.`
    }
  }
  return null
}

// Hour range for the Agenda grid: from the earliest opening to the latest closing.
export function agendaHourRange(w: WeekConfig): { from: number; to: number } {
  let from = 24
  let to = 0
  for (const day of Object.values(w)) {
    if (day.closed) continue
    from = Math.min(from, Number(day.open.slice(0, 2)))
    to = Math.max(to, Math.ceil((Number(day.close.slice(0, 2)) * 60 + Number(day.close.slice(3))) / 60) - 1)
  }
  if (from > to) return { from: 7, to: 20 }
  return { from, to }
}

export function describeWeek(w: WeekConfig, lang: Lang = 'pt'): string {
  return WEEK_ORDER.map((d) => {
    const day = w[String(d)]
    return `${SHORT[lang][d]} ${day.closed ? CLOSED[lang] : `${day.open}–${day.close}`}`
  }).join(' · ')
}
