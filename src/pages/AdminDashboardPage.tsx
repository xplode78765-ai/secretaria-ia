import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useNavigate } from 'react-router-dom'
import { Shield, Building2, Users, DollarSign, CalendarDays, LogOut, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'
import { useT } from '@/i18n'
import { LanguageToggle } from '@/components/LanguageToggle'
import { AdminPlans } from '@/components/AdminPlans'
import { callEdge } from '@/lib/edge'

type OverviewData = {
  totalStudios: number
  totalClients: number
  totalRevenue: number
  totalAppointments: number
  studios: { id: string; name: string; email: string; created_at: string; client_count: number; revenue: number; plan: string; subscription_status: string }[]
}

export function AdminDashboardPage() {
  const tc = useT('common')
  const t = useT('settings')
  const navigate = useNavigate()
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const ts = useT('sales')

  const changeSubscription = async (studioId: string, patch: { plan?: string; status?: string }) => {
    const res = await callEdge('admin-panel', { action: 'studio-subscription', studio_id: studioId, ...patch })
    if (!res.ok) { toast.error(res.data.error || ''); return }
    toast.success(ts('adminSubChanged'))
    void loadData()
  }

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    try {
      const { data: json, error } = await supabase.functions.invoke('admin-panel', {
        body: { action: 'overview' },
      })
      // A session without the second factor goes back to the admin login.
      const ctx = (error as { context?: Response } | null)?.context
      const body = json ?? (ctx && typeof ctx.json === 'function' ? await ctx.clone().json().catch(() => null) : null)
      if (body?.error === 'mfa_required') { navigate('/admin', { replace: true }); return }
      if (error) throw new Error(error.message)
      if (json?.error) throw new Error(json.error)
      const studios = (json.studios ?? []).map((s: { id: string; name: string; email: string; created_at: string; client_count?: number; revenue?: number; plan?: string; subscription_status?: string }) => ({
        id: s.id,
        name: s.name,
        email: s.email,
        created_at: s.created_at,
        client_count: s.client_count ?? 0,
        revenue: s.revenue ?? 0,
        plan: s.plan ?? 'studio',
        subscription_status: s.subscription_status ?? 'active',
      }))
      setData({
        totalStudios: json.totalStudios ?? 0,
        totalClients: json.totalClients ?? 0,
        totalRevenue: json.totalRevenue ?? 0,
        totalAppointments: json.totalAppointments ?? 0,
        studios,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('adminLoadError'))
    } finally {
      setLoading(false)
    }
  }

  const handleSignOut = async () => { await supabase.auth.signOut(); navigate('/admin') }

  const sendMail = async (action: 'test' | 'broadcast') => {
    setSending(true)
    const { data: json, error: fnError } = await supabase.functions.invoke('mailer', {
      body: action === 'test' ? { action: 'test' } : { action: 'broadcast', subject, message },
    })
    setSending(false)
    if (fnError) { toast.error(fnError.message); return }
    if (json?.error) { toast.error(json.error); return }
    if (action === 'test') toast.success(t('adminTestSent', { to: json?.to || t('yourEmail') }))
    else {
      toast.success(t('adminSent', { sent: json?.sent ?? 0, total: json?.total ?? 0 }))
      if (json?.errors?.length) toast.error(json.errors[0])
    }
  }

  if (loading) return <div className="flex justify-center p-12"><Spinner className="text-[var(--gold)]" /></div>
  if (error) return <div className="flex justify-center p-12 text-red-500 text-sm">{error}</div>

  const cards = [
    { title: t('adminStudios'), value: data?.totalStudios ?? 0, icon: Building2 },
    { title: t('adminClients'), value: data?.totalClients ?? 0, icon: Users },
    { title: t('adminRevenue'), value: `R$ ${(data?.totalRevenue ?? 0).toFixed(2)}`, icon: DollarSign },
    { title: t('adminAppointments'), value: data?.totalAppointments ?? 0, icon: CalendarDays },
  ]

  return (
    <div className="min-h-screen bg-[var(--canvas-subtle)]">
      <header className="bg-[var(--ink-900)] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg gold-gradient flex items-center justify-center"><Shield className="size-4 text-[var(--ink-900)]" /></div>
          <div><h1 className="text-sm font-serif font-medium text-white">{t('adminTitle')}</h1><p className="text-xs text-white/40">SecretarIA Platform</p></div>
        </div>
        <Button variant="ghost" size="sm" className="text-white/60 hover:text-white" onClick={handleSignOut}><LogOut className="size-4" />{tc('signOut')}</Button>
        <LanguageToggle tone="dark" />
      </header>

      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {cards.map((c, i) => (
            <div key={i} className="luxury-card p-5">
              <div className="flex items-center justify-between mb-3"><p className="text-sm text-[var(--ink-500)] font-medium">{c.title}</p><div className="p-2 rounded-lg gold-gradient"><c.icon className="size-4 text-[var(--ink-900)]" /></div></div>
              <p className="text-2xl font-serif font-medium gold-gradient-text">{c.value}</p>
            </div>
          ))}
        </div>

        <div className="luxury-card p-6 space-y-4">
          <div className="flex items-center gap-2"><Mail className="size-4 text-[var(--gold)]" /><h2 className="font-serif font-medium text-lg">{t('emailTitle')}</h2></div>
          <p className="text-xs text-[var(--ink-500)]">{t('emailHelp')}</p>
          <div className="space-y-1.5"><Label>{t('subject')}</Label><Input value={subject} onChange={e => setSubject(e.target.value)} placeholder={t('subjectPh')} /></div>
          <div className="space-y-1.5">
            <Label>{t('message')}</Label>
            <textarea className="w-full min-h-28 rounded-md border border-[var(--ink-200)] bg-transparent px-3 py-2 text-sm" value={message} onChange={e => setMessage(e.target.value)} placeholder={t('messagePh')} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={sending} onClick={() => void sendMail('test')}>{sending ? <Spinner className="size-4" /> : null}{t('sendTest')}</Button>
            <Button className="btn-gold" disabled={sending} onClick={() => void sendMail('broadcast')}>{sending ? <Spinner className="size-4" /> : <Mail className="size-4" />}{t('sendAll')}</Button>
          </div>
        </div>

        <AdminPlans />

        <div className="luxury-card overflow-hidden">
          <div className="px-6 py-4 border-b border-[var(--ink-200)]"><h2 className="font-serif font-medium text-lg">{t('studiosTable')}</h2></div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-[var(--ink-200)] bg-[var(--ink-100)]">
                <th className="text-left text-xs font-medium text-[var(--ink-500)] px-6 py-3">{t('colStudio')}</th>
                <th className="text-left text-xs font-medium text-[var(--ink-500)] px-6 py-3">{tc('email')}</th>
                <th className="text-right text-xs font-medium text-[var(--ink-500)] px-6 py-3">{t('adminClients')}</th>
                <th className="text-left text-xs font-medium text-[var(--ink-500)] px-6 py-3">{ts('adminColPlan')}</th>
                <th className="text-left text-xs font-medium text-[var(--ink-500)] px-6 py-3">{ts('adminColStatus')}</th>
                <th className="text-right text-xs font-medium text-[var(--ink-500)] px-6 py-3">{t('adminRevenue')}</th>
              </tr></thead>
              <tbody>
                {data?.studios.map(s => (
                  <tr key={s.id} className="border-b border-[var(--ink-200)] hover:bg-[var(--ink-100)]/50">
                    <td className="px-6 py-3 text-sm font-medium">{s.name}</td>
                    <td className="px-6 py-3 text-sm text-[var(--ink-500)]">{s.email}</td>
                    <td className="px-6 py-3 text-sm text-right">{s.client_count}</td>
                    <td className="px-6 py-3 text-sm">
                      <select className="rounded-md border border-[var(--ink-200)] bg-transparent px-2 py-1 text-xs" value={s.plan} onChange={(e) => void changeSubscription(s.id, { plan: e.target.value })} aria-label={ts('adminColPlan')}>
                        <option value="essencial">Essencial</option><option value="studio">Studio</option><option value="pro">Pro</option>
                      </select>
                    </td>
                    <td className="px-6 py-3 text-sm">
                      <select className="rounded-md border border-[var(--ink-200)] bg-transparent px-2 py-1 text-xs" value={s.subscription_status} onChange={(e) => void changeSubscription(s.id, { status: e.target.value })} aria-label={ts('adminColStatus')}>
                        <option value="trialing">{ts('statusTrialing')}</option><option value="active">{ts('statusActive')}</option><option value="past_due">{ts('statusPastDue')}</option><option value="paused">{ts('statusPaused')}</option><option value="cancelled">{ts('statusCancelled')}</option>
                      </select>
                    </td>
                    <td className="px-6 py-3 text-sm text-right font-medium">R$ {s.revenue.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
