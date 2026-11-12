import { format as dfFormat } from 'date-fns'
import { useAuth } from '@/contexts/AuthContext'

// The app shows and edits times on the STUDIO's clock (studios.timezone), not the
// browser's. Technique: convert an instant to a "studio clock" Date whose local
// fields (getHours, getDate...) equal the studio's wall clock, so date-fns works
// unchanged; convert back with fromStudioClock before saving.

export { DEFAULT_TZ, STUDIO_TIMEZONES, safeTz, toStudioClock, fromStudioClock, browserDiffersFrom, tzCity } from '@/lib/tz-core'
import { safeTz, toStudioClock } from '@/lib/tz-core'

export function nowInStudio(tz: string): Date {
  return toStudioClock(new Date(), tz)
}

export function formatInStudio(input: string | Date, pattern: string, tz: string, opts?: Parameters<typeof dfFormat>[2]): string {
  return dfFormat(toStudioClock(input, tz), pattern, opts)
}

export function useStudioTz(): string {
  const { profile } = useAuth()
  return safeTz(profile?.studio_timezone)
}

