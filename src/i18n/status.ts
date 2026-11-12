// Appointment status -> key in the "common" texts.
const STATUS_KEYS = {
  pending: 'statusPending',
  confirmed: 'statusConfirmed',
  done: 'statusDone',
  cancelled: 'statusCancelled',
} as const

export function statusKey(status: string): (typeof STATUS_KEYS)[keyof typeof STATUS_KEYS] | null {
  return (STATUS_KEYS as Record<string, (typeof STATUS_KEYS)[keyof typeof STATUS_KEYS]>)[status] ?? null
}
