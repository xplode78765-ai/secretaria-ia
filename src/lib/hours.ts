export type StudioHours = { open: string; close: string; weekdays: number[] }

export const DEFAULT_HOURS: StudioHours = { open: '09:00', close: '19:00', weekdays: [1, 2, 3, 4, 5, 6] }

export const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

export function parseStudioHours(raw: unknown): StudioHours {
  const obj = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const open = typeof obj.open === 'string' && /^\d{2}:\d{2}$/.test(obj.open) ? obj.open : DEFAULT_HOURS.open
  const close = typeof obj.close === 'string' && /^\d{2}:\d{2}$/.test(obj.close) ? obj.close : DEFAULT_HOURS.close
  const weekdays = Array.isArray(obj.weekdays)
    ? [...new Set(obj.weekdays.map(Number).filter((n) => n >= 0 && n <= 6))]
    : DEFAULT_HOURS.weekdays
  return { open, close, weekdays: weekdays.length ? weekdays : DEFAULT_HOURS.weekdays }
}

export function formatHoursLabel(hours: StudioHours) {
  const days = hours.weekdays.slice().sort((a, b) => a - b).map((d) => WEEKDAY_LABELS[d]).join(', ')
  return `${days} · ${hours.open}–${hours.close}`
}
