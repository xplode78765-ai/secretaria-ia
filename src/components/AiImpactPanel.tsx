import { useEffect, useState } from 'react'
import { Bot, Moon, CalendarCheck, BellRing, HeartHandshake, MessageSquare } from 'lucide-react'
import { startOfMonth } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useT } from '@/i18n'
import { isStaffRole } from '@/lib/roles'
import { fromStudioClock, nowInStudio, useStudioTz } from '@/lib/timezone'
import { Skeleton } from '@/components/ui/skeleton'

type Stats = { ai_replies: number; after_hours: number; ai_bookings: number; reminders: number; kept_after_reminder: number; rescued: number }

// "What the AI did for you" this month (numbers from public.studio_ai_stats).
export function AiImpactPanel() {
  const t = useT('sales')
  const { profile } = useAuth()
  const tz = useStudioTz()
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const visible = !!profile?.studio_id && isStaffRole(profile?.role)

  useEffect(() => {
    if (!visible || !profile?.studio_id) return
    const from = fromStudioClock(startOfMonth(nowInStudio(tz)), tz).toISOString()
    void supabase.rpc('studio_ai_stats', { p_studio: profile.studio_id, p_from: from }).then(({ data }) => {
      setStats((data as Stats | null) ?? null)
      setLoading(false)
    })
  }, [visible, profile?.studio_id, tz])

  if (!visible) return null
  const items = [
    { icon: MessageSquare, label: t('impactReplies'), value: stats?.ai_replies ?? 0, sub: '' },
    { icon: Moon, label: t('impactAfterHours'), value: stats?.after_hours ?? 0, sub: '' },
    { icon: CalendarCheck, label: t('impactBookings'), value: stats?.ai_bookings ?? 0, sub: '' },
    { icon: BellRing, label: t('impactKept'), value: stats?.kept_after_reminder ?? 0, sub: t('impactKeptOf', { total: stats?.reminders ?? 0 }) },
    { icon: HeartHandshake, label: t('impactRescued'), value: stats?.rescued ?? 0, sub: '' },
  ]
  return (
    <div className="luxury-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg gold-gradient flex items-center justify-center"><Bot className="size-4 text-[var(--ink-900)]" /></div>
        <div><h2 className="font-serif font-medium text-lg leading-tight">{t('impactTitle')}</h2><p className="text-xs text-[var(--ink-500)]">{t('impactMonth')}</p></div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {items.map(({ icon: Icon, label, value, sub }) => (
          <div key={label} className="rounded-lg border border-[var(--ink-200)] p-3">
            <Icon className="size-4 text-[var(--gold)] mb-2" />
            {loading ? <Skeleton className="h-7 w-12" /> : <p className="text-2xl font-serif font-medium">{value}</p>}
            <p className="text-xs text-[var(--ink-500)] mt-0.5">{label}</p>
            {sub && !loading && <p className="text-[10px] text-[var(--ink-400)]">{sub}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}
