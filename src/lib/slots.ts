export function appointmentsOverlap(
  startA: string | Date,
  endA: string | Date,
  startB: string | Date,
  endB: string | Date,
) {
  const a1 = new Date(startA).getTime()
  const a2 = new Date(endA).getTime()
  const b1 = new Date(startB).getTime()
  const b2 = new Date(endB).getTime()
  return a1 < b2 && b1 < a2
}

export function slugify(text: string) {
  const base = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return base || 'studio'
}
