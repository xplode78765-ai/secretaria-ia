import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import type { Appointment, Client } from '@/lib/supabase'
import { format, startOfDay, endOfDay } from 'date-fns'
import { CalendarDays, Users, TrendingUp, Bot, ChevronRight, MessageSquare, DollarSign } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { formatInStudio, fromStudioClock, nowInStudio, useStudioTz } from '@/lib/timezone'
import { useT } from '@/i18n'
import { useI18n } from '@/i18n'
import { statusKey } from '@/i18n/status'
import { AiImpactPanel } from '@/components/AiImpactPanel'
import { WaitlistCard } from '@/components/WaitlistCard'

type AptWithClient = Appointment & { clients: Pick<Client, 'name'> | null }

export function DashboardPage() {
  const tc = useT('common')
  const t = useT('dashboard')
  const { profile } = useAuth()
  const [todayApts, setTodayApts] = useState<AptWithClient[]>([])
  const [totalClients, setTotalClients] = useState(0)
  const [monthRevenue, setMonthRevenue] = useState(0)
  const [activeConvs, setActiveConvs] = useState(0)
  const [caixaHoje, setCaixaHoje] = useState(0)
  const [loading, setLoading] = useState(true)
  const tz = useStudioTz()
  const { dateLocale, intlLocale } = useI18n()
  // "Today" and the month are the STUDIO's (studios.timezone), not the browser's.
  const today = nowInStudio(tz)

  useEffect(() => { loadData() }, [profile?.professional_id, profile?.role])

  const loadData = async () => {
    const startOfToday = fromStudioClock(startOfDay(today), tz).toISOString()
    const endOfToday = fromStudioClock(endOfDay(today), tz).toISOString()
    const startOfMonth = fromStudioClock(new Date(today.getFullYear(), today.getMonth(), 1), tz).toISOString()

    let aptsQuery = supabase.from('appointments').select('*, clients(name)').gte('start_time', startOfToday).lte('start_time', endOfToday).order('start_time')
    if (profile?.role === 'professional' && profile.professional_id) {
      aptsQuery = aptsQuery.eq('professional_id', profile.professional_id)
    }
    const [aptsRes, clientsRes, monthRes, convsRes, payRes] = await Promise.all([
      aptsQuery,
      supabase.from('clients').select('id', { count: 'exact', head: true }),
      supabase.from('appointments').select('price').gte('start_time', startOfMonth).eq('status', 'done'),
      supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('payments').select('amount').eq('status', 'paid').gte('paid_at', startOfToday).lte('paid_at', endOfToday),
    ])

    const apts = (aptsRes.data ?? []) as AptWithClient[]
    setTodayApts(apts)
    setTotalClients(clientsRes.count ?? 0)
    setMonthRevenue((monthRes.data ?? []).reduce((acc, a) => acc + (a.price ?? 0), 0))
    setActiveConvs(convsRes.count ?? 0)
    setCaixaHoje((payRes.data ?? []).reduce((acc, p) => acc + Number(p.amount ?? 0), 0))
    setLoading(false)
  }

  const statusBadge: Record<string, string> = {
    pending: 'bg-[var(--warning-50)] text-[var(--warning-700)] border-[var(--warning-100)]',
    confirmed: 'bg-[var(--success-50)] text-[var(--success-700)] border-[var(--success-100)]',
    done: 'bg-blue-50 text-blue-700 border-blue-100',
    cancelled: 'bg-[var(--danger-50)] text-[var(--danger-700)] border-[var(--danger-100)]',
  }

  const cards = [
    { title: t('cardToday'), value: todayApts.length, icon: CalendarDays, desc: t('cardTodayDesc', { count: todayApts.filter(a => a.status === 'confirmed').length }), gold: true },
    { title: t('cardClients'), value: totalClients, icon: Users, desc: t('cardClientsDesc') },
    { title: t('cardRevenue'), value: `R$ ${monthRevenue.toLocaleString(intlLocale, { minimumFractionDigits: 2 })}`, icon: TrendingUp, desc: t('cardRevenueDesc') },
    { title: t('cardCash'), value: `R$ ${caixaHoje.toLocaleString(intlLocale, { minimumFractionDigits: 2 })}`, icon: DollarSign, desc: t('cardCashDesc') },
    { title: t('cardConvs'), value: activeConvs, icon: MessageSquare, desc: t('cardConvsDesc') },
  ]

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-medium">{t('hello')}</h1>
          <p className="text-sm text-[var(--ink-500)] mt-0.5">{format(today, t('longDate'), { locale: dateLocale })}</p>
        </div>
        <Link to="/app/agenda">
          <Button className="btn-gold gap-2"><CalendarDays className="size-4" />{t('newBooking')}</Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        {cards.map((c, i) => (
          <div key={i} className={`luxury-card p-5 ${c.gold ? 'relative overflow-hidden' : ''}`}>
            {c.gold && <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'repeating-linear-gradient(45deg, #D4AF37 0px, #D4AF37 1px, transparent 1px, transparent  8px)' }} />}
            <div className="relative">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-[var(--ink-500)] font-medium">{c.title}</p>
                <div className={`p-2 rounded-lg ${c.gold ? 'gold-gradient' : 'bg-[var(--ink-100)]'}`}>
                  <c.icon className={`size-4 ${c.gold ? 'text-[var(--ink-900)]' : 'text-[var(--ink-500)]'}`} />
                </div>
              </div>
              {loading ? <Skeleton className="h-8 w-24 mb-1" /> : <p className={`text-2xl font-serif font-medium ${c.gold ? 'gold-gradient-text' : ''}`}>{c.value}</p>}
              <p className="text-xs text-[var(--ink-500)] mt-1">{c.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <AiImpactPanel />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 luxury-card">
          <div className="px-6 py-4 border-b border-[var(--ink-200)] flex items-center justify-between">
            <div>
              <h2 className="font-serif font-medium text-lg">{t('todayAgenda')}</h2>
              <p className="text-xs text-[var(--ink-500)] mt-0.5">{format(today, t('shortDate'), { locale: dateLocale })}</p>
            </div>
            <Link to="/app/agenda"><Button variant="ghost" size="sm" className="text-xs gap-1">{t('seeAll')} <ChevronRight className="size-3" /></Button></Link>
          </div>
          <div className="p-4 space-y-2 max-h-80 overflow-y-auto">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-lg border border-[var(--ink-200)]">
                  <Skeleton className="w-12 h-10 rounded" />
                  <div className="flex-1 space-y-1.5"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-24" /></div>
                </div>
              ))
            ) : todayApts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="w-12 h-12 rounded-2xl gold-gradient flex items-center justify-center mb-3 opacity-40"><CalendarDays className="size-5" /></div>
                <p className="text-sm font-medium text-[var(--ink-500)]">{t('noneToday')}</p>
                <p className="text-xs text-[var(--ink-500)] mt-1">{t('relax')}</p>
              </div>
            ) : (
              todayApts.map(apt => (
                <div key={apt.id} className="flex items-center gap-3 p-3 rounded-lg border border-[var(--ink-200)] hover:border-[var(--gold-200)] hover:bg-[var(--gold-50)]/30 transition-all">
                  <div className="text-center min-w-[3rem] bg-[var(--ink-100)] rounded-lg py-1.5">
                    <p className="text-xs font-bold leading-none">{formatInStudio(apt.start_time, 'HH:mm', tz)}</p>
                    <p className="text-[10px] text-[var(--ink-500)] mt-0.5">{formatInStudio(apt.end_time, 'HH:mm', tz)}</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{apt.title}</p>
                    <p className="text-xs text-[var(--ink-500)]">{apt.clients?.name ?? tc('client')}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {apt.price > 0 && <span className="text-xs font-medium text-[var(--success-700)]">R$ {apt.price.toFixed(2)}</span>}
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusBadge[apt.status] ?? ''}`}>{statusKey(apt.status) ? tc(statusKey(apt.status)!) : apt.status}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="luxury-card">
          <div className="px-6 py-4 border-b border-[var(--ink-200)]"><h2 className="font-serif font-medium text-lg">{t('shortcuts')}</h2></div>
          <div className="p-4 space-y-2">
            {[
              { to: '/app/agenda', icon: CalendarDays, label: t('scNewApt'), desc: t('scNewAptDesc') },
              { to: '/app/clientes', icon: Users, label: t('scNewClient'), desc: t('scNewClientDesc') },
              { to: '/app/secretaria-ia', icon: Bot, label: t('scAi'), desc: t('scAiDesc') },
              { to: '/app/conversas', icon: MessageSquare, label: t('scConvs'), desc: t('scConvsDesc') },
            ].map(({ to, icon: Icon, label, desc }) => (
              <Link key={to} to={to}>
                <div className="flex items-center gap-3 p-3 rounded-lg border border-[var(--ink-200)] hover:border-[var(--gold-200)] hover:bg-[var(--gold-50)]/30 transition-all group cursor-pointer">
                  <div className="w-9 h-9 rounded-lg gold-gradient flex items-center justify-center flex-shrink-0 gold-shadow"><Icon className="size-4 text-[var(--ink-900)]" /></div>
                  <div className="flex-1 min-w-0"><p className="text-sm font-medium">{label}</p><p className="text-xs text-[var(--ink-500)]">{desc}</p></div>
                  <ChevronRight className="size-4 text-[var(--ink-500)] group-hover:translate-x-0.5 transition-transform" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      <WaitlistCard />

      <div className="rounded-xl overflow-hidden relative" style={{ background: 'linear-gradient(135deg, #111111 0%, #2A2A2A 100%)' }}>
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 80% 50%, #D4AF37, transparent 60%)' }} />
        <div className="relative px-6 py-6 flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 rounded gold-gradient flex items-center justify-center"><Bot className="size-3.5" /></div>
              <span className="text-xs font-medium tracking-[0.15em] uppercase" style={{ color: '#E4C982' }}>SecretarIA</span>
            </div>
            <h3 className="text-lg font-serif font-medium text-white mb-1">{t('bannerTitle')}</h3>
            <p className="text-sm text-white/50">{t('bannerText')}</p>
          </div>
          <Link to="/app/secretaria-ia" className="flex-shrink-0"><Button className="btn-gold whitespace-nowrap">{t('bannerCta')}</Button></Link>
        </div>
      </div>
    </div>
  )
}
