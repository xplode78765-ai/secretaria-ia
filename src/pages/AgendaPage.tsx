import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import type { Appointment, Client, Procedure, Professional } from '@/lib/supabase'
import { format, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, addWeeks, subWeeks, addMonths, subMonths, startOfMonth, endOfMonth, addHours } from 'date-fns'
import { ChevronLeft, ChevronRight, Plus, X, CalendarDays, Clock, User, DollarSign } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { browserDiffersFrom, fromStudioClock, nowInStudio, toStudioClock, tzCity, useStudioTz } from '@/lib/timezone'
import { agendaHourRange, defaultWeek, loadWeek, type WeekConfig } from '@/lib/business-hours'
import { fetchAll } from '@/lib/fetch-all'
import { useConfirm } from '@/components/ConfirmDialog'
import { useT } from '@/i18n'
import { translate, useI18n } from '@/i18n'
import { weekdayLabels } from '@/lib/business-hours'
import { callEdge } from '@/lib/edge'

type AptWithClient = Appointment & { clients: Pick<Client, 'name'> | null }


export function AgendaPage() {
  const tc = useT('common')
  const t = useT('agenda')
  const [confirm, confirmDialog] = useConfirm()
  const { profile } = useAuth()
  // Everything on this screen is shown on the STUDIO's clock (studios.timezone).
  const tz = useStudioTz()
  const { lang, dateLocale } = useI18n()
  const sc = (iso: string) => toStudioClock(iso, tz)
  const showTzHint = browserDiffersFrom(tz)
  const [appointments, setAppointments] = useState<AptWithClient[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [procedures, setProcedures] = useState<Procedure[]>([])
  const [professionals, setProfessionals] = useState<Professional[]>([])
  const [currentDate, setCurrentDate] = useState(() => nowInStudio(tz))
  const [view, setView] = useState<'week' | 'month' | 'day'>('week')
  const [loading, setLoading] = useState(true)
  const [week, setWeek] = useState<WeekConfig>(defaultWeek())
  // Grid hours follow the business hours, stretched to include any appointment
  // outside them (e.g. booked by hand at 21h) so nothing is hidden.
  const HOURS = (() => {
    let { from, to } = agendaHourRange(week)
    for (const a of appointments) {
      const h = sc(a.start_time).getHours()
      from = Math.min(from, h)
      to = Math.max(to, h)
    }
    return Array.from({ length: to - from + 1 }, (_, i) => i + from)
  })()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editApt, setEditApt] = useState<AptWithClient | null>(null)
  const [form, setForm] = useState({ title: '', client_id: '', professional_id: '', procedure_id: '', start_time: '', end_time: '', price: '', status: 'pending', notes: '' })
  const [saving, setSaving] = useState(false)
  const [depositPaid, setDepositPaid] = useState(false)
  const ts = useT('sales')

  useEffect(() => { loadData() }, [currentDate, view, profile?.professional_id, profile?.role])

  const loadData = async () => {
    let start: Date, end: Date
    if (view === 'week') { start = startOfWeek(currentDate, { weekStartsOn: 0 }); end = endOfWeek(currentDate, { weekStartsOn: 0 }) }
    else if (view === 'month') { start = startOfMonth(currentDate); end = endOfMonth(currentDate) }
    else { start = new Date(currentDate); start.setHours(0, 0, 0, 0); end = new Date(currentDate); end.setHours(23, 59, 59, 999) }

    let aptsQuery = supabase.from('appointments').select('*, clients(name)').gte('start_time', fromStudioClock(start, tz).toISOString()).lte('start_time', fromStudioClock(end, tz).toISOString()).order('start_time')
    if (profile?.role === 'professional' && profile.professional_id) {
      aptsQuery = aptsQuery.eq('professional_id', profile.professional_id)
    }
    const [aptsRes, allClients, procsRes, profsRes, studioRes] = await Promise.all([
      aptsQuery,
      fetchAll<Client>((from, to) => supabase.from('clients').select('*').order('name').range(from, to)).catch(() => [] as Client[]),
      supabase.from('procedures').select('*').eq('active', true).order('name'),
      supabase.from('professionals').select('*').eq('active', true).order('name'),
      profile?.studio_id ? supabase.from('studios').select('business_hours').eq('id', profile.studio_id).maybeSingle() : Promise.resolve({ data: null }),
    ])
    setAppointments((aptsRes.data ?? []) as AptWithClient[])
    setWeek(loadWeek(studioRes.data?.business_hours))
    setClients(allClients)
    setProcedures(procsRes.data ?? [])
    setProfessionals(profsRes.data ?? [])
    setLoading(false)
  }

  const navigate = (dir: 1 | -1) => {
    if (view === 'week') setCurrentDate(d => dir === 1 ? addWeeks(d, 1) : subWeeks(d, 1))
    else if (view === 'month') setCurrentDate(d => dir === 1 ? addMonths(d, 1) : subMonths(d, 1))
    else setCurrentDate(d => { const n = new Date(d); n.setDate(n.getDate() + dir); return n })
  }

  const openNew = (date?: Date) => {
    const start = date ?? nowInStudio(tz); start.setMinutes(0, 0, 0)
    const end = addHours(start, 1)
    setEditApt(null)
    setForm({ title: '', client_id: '', professional_id: '', procedure_id: '', start_time: format(start, "yyyy-MM-dd'T'HH:mm"), end_time: format(end, "yyyy-MM-dd'T'HH:mm"), price: '', status: 'pending', notes: '' })
    setDialogOpen(true)
  }

  const openEdit = (apt: AptWithClient) => {
    setEditApt(apt)
    setDepositPaid(!!apt.deposit_paid)
    setForm({ title: apt.title, client_id: apt.client_id ?? '', professional_id: apt.professional_id ?? '', procedure_id: apt.procedure_id ?? '', start_time: format(sc(apt.start_time), "yyyy-MM-dd'T'HH:mm"), end_time: format(sc(apt.end_time), "yyyy-MM-dd'T'HH:mm"), price: apt.price?.toString() ?? '', status: apt.status, notes: apt.notes ?? '' })
    setDialogOpen(true)
  }

  const saveApt = async () => {
    if (!profile?.studio_id) { toast.error(t('noStudio')); return }
    setSaving(true)
    // The form holds studio wall-clock times; convert to real instants before saving.
    const startLocal = fromStudioClock(new Date(form.start_time), tz)
    const endLocal = fromStudioClock(new Date(form.end_time), tz)
    if (endLocal.getTime() <= startLocal.getTime()) { toast.error(t('endBeforeStart')); setSaving(false); return }
    let clashQuery = supabase.from('appointments').select('id, professional_id, status').eq('studio_id', profile.studio_id).neq('status', 'cancelled').lt('start_time', endLocal.toISOString()).gt('end_time', startLocal.toISOString())
    const { data: clashRows } = await clashQuery
    const clash = (clashRows ?? []).some((a) => {
      if (editApt && a.id === editApt.id) return false
      if (form.professional_id && a.professional_id && a.professional_id !== form.professional_id) return false
      return true
    })
    if (clash) { toast.error(t('clash')); setSaving(false); return }
    const payload = { studio_id: profile.studio_id, title: form.title, client_id: form.client_id || null, professional_id: form.professional_id || null, procedure_id: form.procedure_id || null, start_time: startLocal.toISOString(), end_time: endLocal.toISOString(), price: parseFloat(form.price) || 0, status: form.status, notes: form.notes, date: form.start_time.slice(0, 10), ...(editApt ? { deposit_paid: depositPaid } : {}) }
    let result
    let aptId = editApt?.id
    if (editApt) {
      result = await supabase.from('appointments').update(payload).eq('id', editApt.id).select('id').single()
      aptId = result.data?.id ?? editApt.id
    } else {
      result = await supabase.from('appointments').insert(payload).select('id').single()
      aptId = result.data?.id
    }
    if (result.error) { toast.error(t('saveError', { error: result.error.message })); setSaving(false); return }
    // Bell notification + WhatsApp alert to the studio, in the studio's language.
    {
      const sl = profile.studio_locale
      const clientName = clients.find((c) => c.id === form.client_id)?.name || translate(sl, 'common', 'noClient')
      const whenLabel = format(new Date(form.start_time), 'dd/MM/yyyy HH:mm')
      const verb = translate(sl, 'agenda', !editApt ? 'alertNew' : form.status === 'cancelled' ? 'alertCancelled' : 'alertChanged')
      const what = form.title || translate(sl, 'agenda', 'alertDefaultTitle')
      void supabase.from('notifications').insert({
        studio_id: profile.studio_id,
        client_id: form.client_id || null,
        type: form.status === 'cancelled' ? 'appointment_cancelled' : 'new_appointment',
        title: verb,
        content: `${clientName} — ${what} · ${whenLabel}`,
      })
      void supabase.functions.invoke('whatsapp-send', {
        body: { action: 'staff_alert', text: `📅 ${verb}\n${clientName} — ${what}\n${whenLabel}` },
      })
    }
    if (form.status === 'done' && (parseFloat(form.price) || 0) > 0) {
      let commission = 0
      if (form.professional_id) {
        const { data: prof } = await supabase.from('professionals').select('commission_percent').eq('id', form.professional_id).maybeSingle()
        commission = ((parseFloat(form.price) || 0) * Number(prof?.commission_percent || 0)) / 100
      }
      const { data: existingPay } = aptId
        ? await supabase.from('payments').select('id').eq('appointment_id', aptId).limit(1)
        : { data: [] }
      if (aptId && (!existingPay || existingPay.length === 0)) {
        const { error: payError } = await supabase.from('payments').insert({
          studio_id: profile.studio_id,
          client_id: form.client_id || null,
          appointment_id: aptId,
          professional_id: form.professional_id || null,
          amount: parseFloat(form.price) || 0,
          commission_amount: commission,
          status: 'paid',
          method: 'caixa',
          paid_at: new Date().toISOString(),
        })
        if (payError) toast.error(t('cashError', { error: payError.message }))
      }
    }
    // Approval mode: the AI told the client the time was pre-booked; tell her it is confirmed.
    if (editApt && editApt.source === 'ai' && editApt.status === 'pending' && form.status === 'confirmed' && aptId) {
      const res = await callEdge<{ ok?: boolean }>('whatsapp-send', { kind: 'appointment_confirmed', appointment_id: aptId })
      if (res.ok && res.data.ok) toast.success(ts('approvedNotified'))
    }
    setDialogOpen(false); setSaving(false); loadData()
  }

  const deleteApt = async (id: string) => {
    if (!(await confirm({ title: t('confirmDeleteTitle'), description: t('confirmDeleteText'), confirmLabel: tc('delete') }))) return
   
    const { error } = await supabase.from('appointments').delete().eq('id', id)
    if (error) { toast.error(error.message); return }
    setDialogOpen(false); loadData()
  }

  const statusColor: Record<string, string> = {
    pending: 'bg-[var(--warning-50)] border-[var(--warning-100)] text-[var(--warning-700)]',
    confirmed: 'bg-[var(--success-50)] border-[var(--success-100)] text-[var(--success-700)]',
    done: 'bg-blue-50 border-blue-100 text-blue-700',
    cancelled: 'bg-[var(--danger-50)] border-[var(--danger-100)] text-[var(--danger-700)]',
  }

  const weekDays = eachDayOfInterval({ start: startOfWeek(currentDate, { weekStartsOn: 0 }), end: endOfWeek(currentDate, { weekStartsOn: 0 }) })
  const monthDays = (() => {
    const start = startOfMonth(currentDate), end = endOfMonth(currentDate)
    return eachDayOfInterval({ start: startOfWeek(start, { weekStartsOn: 0 }), end: endOfWeek(end, { weekStartsOn: 0 }) })
  })()

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-serif font-medium">{t('title')}</h1><p className="text-sm text-[var(--ink-500)] mt-0.5">{t('subtitle')}</p></div>
        <Button className="btn-gold gap-2" onClick={() => openNew()}><Plus className="size-4" /> {t('newApt')}</Button>
      </div>

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon-sm" onClick={() => navigate(-1)}><ChevronLeft className="size-4" /></Button>
          <h2 className="text-sm font-semibold min-w-[160px] text-center">
            {view === 'week' && `${format(weekDays[0], 'dd/MM')} – ${format(weekDays[6], 'dd/MM/yyyy')}`}
            {view === 'month' && format(currentDate, 'MMMM yyyy', { locale: dateLocale })}
            {view === 'day' && format(currentDate, t('dayHeader'), { locale: dateLocale })}
          </h2>
          <Button variant="outline" size="icon-sm" onClick={() => navigate(1)}><ChevronRight className="size-4" /></Button>
          <Button variant="outline" size="sm" onClick={() => setCurrentDate(nowInStudio(tz))}>{t('today')}</Button>
          {showTzHint && <span className="text-xs text-[var(--ink-500)]" title={t('tzTitle')}>{t('tzHint', { city: tzCity(tz) })}</span>}
        </div>
        <Tabs value={view} onValueChange={v => setView(v as 'week' | 'month' | 'day')}>
          <TabsList><TabsTrigger value="day">{t('day')}</TabsTrigger><TabsTrigger value="week">{t('week')}</TabsTrigger><TabsTrigger value="month">{t('month')}</TabsTrigger></TabsList>
        </Tabs>
      </div>

      <div className="luxury-card overflow-hidden">
        {loading ? <div className="flex items-center justify-center h-64"><Spinner className="text-[var(--gold)]" /></div> : view === 'month' ? (
          <div>
            <div className="grid grid-cols-7 border-b border-[var(--ink-200)] bg-[var(--ink-100)]">
              {weekdayLabels(lang).map(l => l.slice(0, 3)).map(d => <div key={d} className="text-center text-xs font-medium text-[var(--ink-500)] py-3">{d}</div>)}
            </div>
            <div className="grid grid-cols-7">
              {monthDays.map((day, i) => {
                const dayApts = appointments.filter(a => isSameDay(sc(a.start_time), day))
                const isCurrentMonth = day.getMonth() === currentDate.getMonth()
                return (
                  <div key={i} onClick={() => { setCurrentDate(day); setView('day') }} className={`min-h-[80px] border-r border-b border-[var(--ink-200)] p-2 cursor-pointer hover:bg-[var(--gold-50)]/30 transition-colors ${!isCurrentMonth ? 'opacity-40' : ''}`}>
                    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium mb-1 ${isSameDay(day, nowInStudio(tz)) ? 'gold-gradient text-[var(--ink-900)]' : ''}`}>{format(day, 'd')}</span>
                    <div className="space-y-0.5">
                      {dayApts.slice(0, 3).map(apt => <div key={apt.id} onClick={e => { e.stopPropagation(); openEdit(apt) }} className={`text-[10px] px-1.5 py-0.5 rounded truncate border cursor-pointer ${statusColor[apt.status] ?? 'bg-[var(--ink-100)] border-[var(--ink-200)]'}`}>{format(sc(apt.start_time), 'HH:mm')} {apt.title}</div>)}
                      {dayApts.length > 3 && <div className="text-[10px] text-[var(--ink-500)]">+{dayApts.length - 3} mais</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : view === 'week' ? (
          <div className="overflow-x-auto"><div className="min-w-[700px]">
            <div className="grid grid-cols-8 border-b border-[var(--ink-200)]">
              <div className="border-r border-[var(--ink-200)]" />
              {weekDays.map((day, i) => <div key={i} onClick={() => { setCurrentDate(day); setView('day') }} className={`text-center py-3 border-r border-[var(--ink-200)] cursor-pointer hover:bg-[var(--gold-50)]/30 ${isSameDay(day, nowInStudio(tz)) ? 'bg-[var(--gold-50)]/50' : ''}`}>
                <p className="text-xs text-[var(--ink-500)]">{format(day, 'EEE', { locale: dateLocale })}</p>
                <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-semibold mt-0.5 ${isSameDay(day, nowInStudio(tz)) ? 'gold-gradient' : ''}`}>{format(day, 'd')}</span>
              </div>)}
            </div>
            <div className="overflow-y-auto max-h-[520px]">
              {HOURS.map(hour => (
                <div key={hour} className="grid grid-cols-8 border-b border-[var(--ink-200)]">
                  <div className="border-r border-[var(--ink-200)] py-2 px-2 text-xs text-[var(--ink-500)] text-right">{hour}:00</div>
                  {weekDays.map((day, j) => {
                    const slotApts = appointments.filter(a => isSameDay(sc(a.start_time), day) && sc(a.start_time).getHours() === hour)
                    return <div key={j} className="border-r border-[var(--ink-200)] min-h-[48px] p-0.5 hover:bg-[var(--gold-50)]/10 cursor-pointer" onClick={() => { const d = new Date(day); d.setHours(hour, 0, 0, 0); openNew(d) }}>
                      {slotApts.map(apt => <div key={apt.id} onClick={e => { e.stopPropagation(); openEdit(apt) }} className={`text-[10px] px-1.5 py-1 rounded border mb-0.5 cursor-pointer truncate ${statusColor[apt.status] ?? 'bg-[var(--ink-100)] border-[var(--ink-200)]'}`}>{apt.title}</div>)}
                    </div>
                  })}
                </div>
              ))}
            </div>
          </div></div>
        ) : (
          <div className="overflow-y-auto max-h-[600px]">
            {HOURS.map(hour => {
              const slotApts = appointments.filter(a => isSameDay(sc(a.start_time), currentDate) && sc(a.start_time).getHours() === hour)
              return (
                <div key={hour} className="flex border-b border-[var(--ink-200)]">
                  <div className="w-16 flex-shrink-0 py-3 px-2 text-xs text-[var(--ink-500)] text-right border-r border-[var(--ink-200)]">{hour}:00</div>
                  <div className="flex-1 min-h-[56px] p-1 hover:bg-[var(--gold-50)]/10 cursor-pointer" onClick={() => { const d = new Date(currentDate); d.setHours(hour, 0, 0, 0); openNew(d) }}>
                    {slotApts.map(apt => <div key={apt.id} onClick={e => { e.stopPropagation(); openEdit(apt) }} className={`px-3 py-2 rounded-lg border mb-1 cursor-pointer ${statusColor[apt.status] ?? 'bg-[var(--ink-100)] border-[var(--ink-200)]'}`}>
                      <p className="text-sm font-medium">{apt.title}</p>
                      <p className="text-xs">{apt.clients?.name ?? tc('noClient')} · {format(sc(apt.start_time), 'HH:mm')}–{format(sc(apt.end_time), 'HH:mm')}</p>
                    </div>)}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><CalendarDays className="size-4 text-[var(--gold)]" />{editApt ? t('editApt') : t('newApt')}</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5"><Label className="text-sm flex items-center gap-1.5"><Clock className="size-3.5" />{t('procedure')}</Label><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder={t('procedurePh')} /></div>
            <div className="space-y-1.5"><Label className="text-sm flex items-center gap-1.5"><User className="size-3.5" />{t('client')}</Label><Select value={form.client_id} onValueChange={v => setForm(f => ({ ...f, client_id: v }))}><SelectTrigger><SelectValue placeholder={t('clientPh')} /></SelectTrigger><SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-sm">{t('professional')}</Label><Select value={form.professional_id} onValueChange={v => setForm(f => ({ ...f, professional_id: v }))}><SelectTrigger><SelectValue placeholder={t('optional')} /></SelectTrigger><SelectContent>{professionals.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1.5"><Label className="text-sm">{t('service')}</Label><Select value={form.procedure_id} onValueChange={v => { const proc = procedures.find(p => p.id === v); setForm(f => ({ ...f, procedure_id: v, title: proc?.name ?? f.title, price: proc ? proc.price.toString() : f.price })) }}><SelectTrigger><SelectValue placeholder={t('optional')} /></SelectTrigger><SelectContent>{procedures.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-sm">{t('start')}</Label><Input type="datetime-local" value={form.start_time} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label className="text-sm">{t('end')}</Label><Input type="datetime-local" value={form.end_time} onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-sm flex items-center gap-1.5"><DollarSign className="size-3.5" />{t('price')}</Label><Input type="number" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} placeholder={t('pricePh')} /></div>
              <div className="space-y-1.5"><Label className="text-sm">{tc('status')}</Label><Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pending">{tc('statusPending')}</SelectItem><SelectItem value="confirmed">{tc('statusConfirmed')}</SelectItem><SelectItem value="done">{tc('statusDone')}</SelectItem><SelectItem value="cancelled">{tc('statusCancelled')}</SelectItem></SelectContent></Select></div>
            </div>
            {editApt && Number(editApt.deposit_amount) > 0 && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={depositPaid} onChange={(e) => setDepositPaid(e.target.checked)} />
                {ts('depositLine', { amount: Number(editApt.deposit_amount).toFixed(2) })} · {ts('depositPaid')}
              </label>
            )}
            <div className="space-y-1.5"><Label className="text-sm">{tc('notes')}</Label><Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder={t('notesPh')} /></div>
            <div className="flex gap-2 pt-2">
              {editApt && <Button variant="destructive" size="sm" onClick={() => deleteApt(editApt.id)}><X className="size-4" /></Button>}
              <Button variant="outline" className="flex-1" onClick={() => setDialogOpen(false)}>{tc('cancel')}</Button>
              <Button className="flex-1 btn-gold" onClick={saveApt} disabled={saving || !form.title}>{saving ? <Spinner className="size-4" /> : tc('save')}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </div>
  )
}
