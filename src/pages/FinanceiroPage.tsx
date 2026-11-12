import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import type { Payment, Client } from '@/lib/supabase'
import { startOfDay, endOfDay, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Plus, DollarSign, Trash2, CheckCircle2, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'
import { fetchAll } from '@/lib/fetch-all'
import { useConfirm } from '@/components/ConfirmDialog'
import { formatInStudio, fromStudioClock, nowInStudio, useStudioTz } from '@/lib/timezone'
import { useT } from '@/i18n'
import { useI18n } from '@/i18n'

type Period = 'month' | 'last_month' | 'all'

export function FinanceiroPage() {
  const tc = useT('common')
  const t = useT('finance')
  const tz = useStudioTz()
  const [period, setPeriod] = useState<Period>('month')
  const { dateLocale } = useI18n()
  const periodLabel = period === 'month' ? t('periodMonth') : period === 'last_month' ? t('periodLastMonth') : t('periodAll')
  const [confirm, confirmDialog] = useConfirm()
  const { profile } = useAuth()
  const [payments, setPayments] = useState<(Payment & { clients: Pick<Client, 'name'> | null })[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState({ client_id: '', amount: '', status: 'pending', method: 'pix', due_date: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    type PayRow = Payment & { clients: Pick<Client, 'name'> | null }
    try {
      const [pays, cls] = await Promise.all([
        fetchAll<PayRow>((from, to) => supabase.from('payments').select('*, clients(name)').order('created_at', { ascending: false }).range(from, to)),
        fetchAll<Client>((from, to) => supabase.from('clients').select('*').order('name').range(from, to)),
      ])
      setPayments(pays)
      setClients(cls)
    } catch (e) {
      toast.error(t('loadError', { error: (e as Error).message }))
    }
    setLoading(false)
  }

  const save = async () => {
    if (!profile?.studio_id) { toast.error(t('noStudio')); return }
    setSaving(true)
    const paid = form.status === 'paid'
    const { error } = await supabase.from('payments').insert({ studio_id: profile.studio_id, client_id: form.client_id || null, amount: parseFloat(form.amount) || 0, status: form.status, method: form.method, due_date: form.due_date || null, paid_at: paid ? new Date().toISOString() : null })
    if (error) { toast.error(t('saveError', { error: error.message })); setSaving(false); return }
    setDialogOpen(false); setSaving(false); setForm({ client_id: '', amount: '', status: 'pending', method: 'pix', due_date: '' }); loadData()
  }

  const markPaid = async (p: Payment) => {
    const { error } = await supabase.from('payments').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', p.id)
    if (error) { toast.error(error.message); return }
    loadData()
  }
  const del = async (id: string) => {
    if (!(await confirm({ title: t('deleteTitle'), description: t('deleteText'), confirmLabel: tc('delete') }))) return
   
    const { error } = await supabase.from('payments').delete().eq('id', id)
    if (error) { toast.error(error.message); return }
    loadData()
  }

  const dayStart = fromStudioClock(startOfDay(nowInStudio(tz)), tz).getTime()
  const dayEnd = fromStudioClock(endOfDay(nowInStudio(tz)), tz).getTime()
  const inToday = (iso: string | null | undefined) => {
    if (!iso) return false
    const t = new Date(iso).getTime()
    return t >= dayStart && t <= dayEnd
  }
  // Totals and list follow the selected period (studio clock), instead of summing all history.
  const studioNow = nowInStudio(tz)
  const periodRange = (() => {
    if (period === 'all') return null
    const base = period === 'month' ? studioNow : subMonths(studioNow, 1)
    return { from: fromStudioClock(startOfMonth(base), tz).getTime(), to: fromStudioClock(endOfMonth(base), tz).getTime() }
  })()
  const paymentTime = (p: Payment) => new Date((p.status === 'paid' ? p.paid_at : null) || p.created_at).getTime()
  const inPeriod = payments.filter((p) => !periodRange || (paymentTime(p) >= periodRange.from && paymentTime(p) <= periodRange.to))
  const totalPaid = inPeriod.filter(p => p.status === 'paid').reduce((acc, p) => acc + Number(p.amount || 0), 0)
  const totalPending = inPeriod.filter(p => p.status === 'pending').reduce((acc, p) => acc + Number(p.amount || 0), 0)
  const caixaHoje = payments.filter(p => p.status === 'paid' && inToday(p.paid_at || p.created_at)).reduce((acc, p) => acc + Number(p.amount || 0), 0)
  const comissaoHoje = payments.filter(p => p.status === 'paid' && inToday(p.paid_at || p.created_at)).reduce((acc, p) => acc + Number(p.commission_amount || 0), 0)

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-serif font-medium">{t('title')}</h1><p className="text-sm text-[var(--ink-500)] mt-0.5">{t('subtitle')}</p></div>
        <Button className="btn-gold gap-2" onClick={() => setDialogOpen(true)}><Plus className="size-4" /> {t('newPayment')}</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <div className="luxury-card p-5"><div className="flex items-center justify-between mb-2"><p className="text-sm text-[var(--ink-500)]">{t('cashToday')}</p><DollarSign className="size-4 text-[var(--gold)]" /></div><p className="text-2xl font-serif font-medium gold-gradient-text">R$ {caixaHoje.toFixed(2)}</p></div>
        <div className="luxury-card p-5"><div className="flex items-center justify-between mb-2"><p className="text-sm text-[var(--ink-500)]">{t('commissionsToday')}</p><Clock className="size-4 text-[var(--ink-400)]" /></div><p className="text-2xl font-serif font-medium">R$ {comissaoHoje.toFixed(2)}</p></div>
        <div className="luxury-card p-5"><div className="flex items-center justify-between mb-2"><p className="text-sm text-[var(--ink-500)]">{t('received', { period: periodLabel })}</p><CheckCircle2 className="size-4 text-[var(--success)]" /></div><p className="text-2xl font-serif font-medium text-[var(--success-700)]">R$ {totalPaid.toFixed(2)}</p></div>
        <div className="luxury-card p-5"><div className="flex items-center justify-between mb-2"><p className="text-sm text-[var(--ink-500)]">{t('pendingTotal', { period: periodLabel })}</p><Clock className="size-4 text-[var(--warning)]" /></div><p className="text-2xl font-serif font-medium text-[var(--warning-700)]">R$ {totalPending.toFixed(2)}</p></div>
        <div className="luxury-card p-5"><div className="flex items-center justify-between mb-2"><p className="text-sm text-[var(--ink-500)]">{t('total', { period: periodLabel })}</p><DollarSign className="size-4 text-[var(--gold)]" /></div><p className="text-2xl font-serif font-medium gold-gradient-text">R$ {(totalPaid + totalPending).toFixed(2)}</p></div>
      </div>

      {loading ? <div className="flex justify-center p-12"><Spinner className="text-[var(--gold)]" /></div> : (
        <div className="luxury-card overflow-hidden">
          <div className="px-6 py-4 border-b border-[var(--ink-200)] flex items-center justify-between gap-3 flex-wrap">
            <h2 className="font-serif font-medium text-lg">{t('transactions')}</h2>
            <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
              <TabsList>
                <TabsTrigger value="month">{t('tabMonth')}</TabsTrigger>
                <TabsTrigger value="last_month">{t('tabLastMonth')}</TabsTrigger>
                <TabsTrigger value="all">{t('tabAll')}</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="divide-y divide-[var(--ink-200)]">
            {inPeriod.length === 0 ? <p className="text-sm text-[var(--ink-500)] text-center py-8">{t('empty')}</p> : inPeriod.map(p => (
              <div key={p.id} className="flex items-center gap-3 px-6 py-3 hover:bg-[var(--ink-100)]/50">
                <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{p.clients?.name ?? tc('noClient')}</p><p className="text-xs text-[var(--ink-500)]">{p.method} · {formatInStudio(p.created_at, 'dd/MM/yyyy', tz, { locale: dateLocale })}</p></div>
                <span className="text-sm font-medium">R$ {Number(p.amount || 0).toFixed(2)}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${p.status === 'paid' ? 'bg-[var(--success-50)] text-[var(--success-700)]' : 'bg-[var(--warning-50)] text-[var(--warning-700)]'}`}>{p.status === 'paid' ? tc('paid') : tc('pending')}</span>
                {p.status === 'pending' && <Button variant="ghost" size="sm" onClick={() => markPaid(p)} className="text-xs">{t('markPaid')}</Button>}
                <Button variant="ghost" size="icon-sm" onClick={() => del(p.id)}><Trash2 className="size-3.5 text-[var(--danger)]" /></Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t('newPayment')}</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5"><Label>{tc('client')}</Label><Select value={form.client_id} onValueChange={v => setForm(f => ({ ...f, client_id: v }))}><SelectTrigger><SelectValue placeholder={t('clientPh')} /></SelectTrigger><SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>{t('amount')}</Label><Input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder={t('amountPh')} /></div>
              <div className="space-y-1.5"><Label>{tc('status')}</Label><Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pending">{tc('pending')}</SelectItem><SelectItem value="paid">{tc('paid')}</SelectItem></SelectContent></Select></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>{t('method')}</Label><Select value={form.method} onValueChange={v => setForm(f => ({ ...f, method: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pix">{t('pix')}</SelectItem><SelectItem value="cash">{t('cash')}</SelectItem><SelectItem value="card">{t('card')}</SelectItem><SelectItem value="transfer">{t('transfer')}</SelectItem></SelectContent></Select></div>
              <div className="space-y-1.5"><Label>{t('dueDate')}</Label><Input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} /></div>
            </div>
            <div className="flex gap-2 pt-2"><Button variant="outline" className="flex-1" onClick={() => setDialogOpen(false)}>{tc('cancel')}</Button><Button className="flex-1 btn-gold" onClick={save} disabled={saving || !form.amount}>{saving ? <Spinner className="size-4" /> : tc('save')}</Button></div>
          </div>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </div>
  )
}
