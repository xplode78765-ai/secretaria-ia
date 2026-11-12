import { useCallback, useEffect, useState } from 'react'
import { Hourglass, X } from 'lucide-react'
import { format } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useI18n, useT } from '@/i18n'
import { isStaffRole } from '@/lib/roles'
import { nowInStudio, useStudioTz } from '@/lib/timezone'
import { Button } from '@/components/ui/button'

type Row = { id: string; desired_date: string; procedure_name: string; status: string; clients: { name: string } | { name: string }[] | null }

// Clients waiting for a slot. The AI adds them; when someone cancels through the
// AI, the people waiting for that day are told automatically.
export function WaitlistCard() {
  const t = useT('sales')
  const { dateLocale } = useI18n()
  const { profile } = useAuth()
  const tz = useStudioTz()
  const [rows, setRows] = useState<Row[]>([])
  const visible = !!profile?.studio_id && isStaffRole(profile?.role)

  const load = useCallback(async () => {
    const today = format(nowInStudio(tz), 'yyyy-MM-dd')
    const { data } = await supabase.from('waitlist')
      .select('id, desired_date, procedure_name, status, clients(name)')
      .in('status', ['waiting', 'notified']).gte('desired_date', today)
      .order('desired_date').limit(20)
    setRows((data ?? []) as Row[])
  }, [tz])
  useEffect(() => { if (visible) void load() }, [visible, load])

  const remove = async (id: string) => {
    await supabase.from('waitlist').update({ status: 'removed' }).eq('id', id)
    void load()
  }

  if (!visible || rows.length === 0) return null
  return (
    <div className="luxury-card">
      <div className="px-6 py-4 border-b border-[var(--ink-200)] flex items-center gap-2"><Hourglass className="size-4 text-[var(--gold)]" /><h2 className="font-serif font-medium text-lg">{t('waitTitle')}</h2></div>
      <div className="p-4 space-y-2">
        {rows.map((r) => {
          const client = Array.isArray(r.clients) ? r.clients[0] : r.clients
          return (
            <div key={r.id} className="flex items-center gap-3 p-2 rounded-lg border border-[var(--ink-200)]">
              <div className="text-xs font-bold min-w-[3rem] text-center">{format(new Date(r.desired_date + 'T12:00:00'), 'dd/MM', { locale: dateLocale })}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{client?.name ?? '—'}</p>
                <p className="text-xs text-[var(--ink-500)] truncate">{r.procedure_name}{r.status === 'notified' ? ` · ${t('waitNotified')}` : ''}</p>
              </div>
              <Button variant="ghost" size="icon-sm" title={t('waitRemove')} aria-label={t('waitRemove')} onClick={() => void remove(r.id)}><X className="size-3.5" /></Button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
