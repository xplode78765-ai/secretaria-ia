import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Studio } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Store, Save, Phone, MapPin, Clock, CheckCircle2, Link2, MessageSquare } from 'lucide-react'
import { toast } from 'sonner'
import { slugify } from '@/lib/slots'
import { DEFAULT_TZ, STUDIO_TIMEZONES } from '@/lib/timezone'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { defaultWeek, loadWeek, validateWeek, WEEK_ORDER, weekdayLabels, type WeekConfig } from '@/lib/business-hours'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { useT } from '@/i18n'
import { useI18n } from '@/i18n'

export function StudioPage() {
  const tc = useT('common')
  const t = useT('studio')
  const { profile, refreshProfile } = useAuth()
  const [studio, setStudio] = useState<Studio | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', address: '', whatsapp_number: '', staff_whatsapp: '', instagram: '', slug: '' })
  const [hours, setHours] = useState<WeekConfig>(defaultWeek())
  const { lang } = useI18n()
  const dayNames = weekdayLabels(lang)
  const [timezone, setTimezone] = useState(DEFAULT_TZ)
  const [locale, setLocale] = useState<'pt' | 'es'>('pt')
  const [bookingMode, setBookingMode] = useState<'auto' | 'approval'>('auto')
  const [depositPercent, setDepositPercent] = useState('0')
  const [pixKey, setPixKey] = useState('')
  const ts = useT('sales')

  useEffect(() => { void loadStudio() }, [profile?.studio_id])

  const loadStudio = async () => {
    if (profile?.studio_id) {
      const { data } = await supabase.from('studios').select('*').eq('id', profile.studio_id).maybeSingle()
      if (data) {
        setStudio(data as Studio)
        setForm({ name: data.name, phone: data.phone, address: data.address, whatsapp_number: data.whatsapp_number, staff_whatsapp: data.staff_whatsapp || '', instagram: data.instagram, slug: data.slug || '' })
        setHours(loadWeek(data.business_hours))
        setTimezone(data.timezone || DEFAULT_TZ)
        setLocale(data.locale === 'es' ? 'es' : 'pt')
        setBookingMode(data.booking_mode === 'approval' ? 'approval' : 'auto')
        setDepositPercent(String(data.deposit_percent ?? 0))
        setPixKey(data.pix_key || '')
      }
    }
    setLoading(false)
  }

  const save = async () => {
    setSaving(true)
    if (profile?.studio_id) {
      const invalid = validateWeek(hours, lang)
      if (invalid) { toast.error(invalid); setSaving(false); return }
      const slug = slugify(form.slug || form.name)
      const { error } = await supabase.from('studios').update({ ...form, slug, business_hours: hours, timezone, locale, booking_mode: bookingMode, deposit_percent: Math.min(100, Math.max(0, parseInt(depositPercent) || 0)), pix_key: pixKey.trim() }).eq('id', profile.studio_id)
      if (error) { toast.error(error.message); setSaving(false); return }
      setForm((f) => ({ ...f, slug }))
      // The profile carries the studio timezone used by every screen.
      if (timezone !== profile.studio_timezone || locale !== profile.studio_locale) await refreshProfile()
    }
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 3000)
  }

  if (loading) return <div className="flex justify-center p-12"><Spinner className="text-[var(--gold)]" /></div>

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div><h1 className="text-2xl font-serif font-medium flex items-center gap-2"><Store className="size-6 text-[var(--gold)]" />{t('title')}</h1><p className="text-sm text-[var(--ink-500)] mt-0.5">{t('subtitle')}</p></div>

      <div className="luxury-card p-6">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-xl gold-gradient flex items-center justify-center text-2xl font-serif font-medium gold-shadow">{(form.name || 'S').slice(0, 1).toUpperCase()}</div>
          <div><h2 className="text-lg font-serif font-medium">{form.name || t('yourStudio')}</h2><p className="text-sm text-[var(--ink-500)]">{studio?.email}</p></div>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5"><Label>{t('studioName')}</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Studio Beauté Gold" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label className="flex items-center gap-1.5"><Phone className="size-3.5" />{tc('phone')}</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="(11) 99999-9999" /></div>
            <div className="space-y-1.5"><Label className="flex items-center gap-1.5"><Clock className="size-3.5" />{t('studioWhatsapp')}</Label><Input value={form.whatsapp_number} onChange={e => setForm(f => ({ ...f, whatsapp_number: e.target.value }))} placeholder="5511999999999" /></div>
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5"><Phone className="size-3.5" />{t('staffWhatsapp')}</Label>
            <Input value={form.staff_whatsapp} onChange={e => setForm(f => ({ ...f, staff_whatsapp: e.target.value }))} placeholder="5511988887777" />
            <p className="text-xs text-[var(--ink-500)]">{t('staffWhatsappHelp')}</p>
          </div>
          <div className="space-y-1.5"><Label className="flex items-center gap-1.5"><MapPin className="size-3.5" />{t('address')}</Label><Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder={t('addressPh')} /></div>
          <div className="space-y-1.5"><Label className="flex items-center gap-1.5"><Clock className="size-3.5" />{t('instagram')}</Label><Input value={form.instagram} onChange={e => setForm(f => ({ ...f, instagram: e.target.value }))} placeholder="@studio" /></div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5"><Link2 className="size-3.5" />{t('publicLink')}</Label>
            <Input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} placeholder={t('slugPh')} />
            {form.slug && (
              <button
                type="button"
                className="text-xs text-[var(--gold)] underline"
                onClick={() => {
                  const url = `${window.location.origin}/agendar/${form.slug}`
                  void navigator.clipboard.writeText(url)
                  toast.success(t('linkCopied'))
                }}
              >
                {window.location.origin}/agendar/{form.slug}
              </button>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5"><MessageSquare className="size-3.5" />{t('clientLanguage')}</Label>
            <Select value={locale} onValueChange={(v) => setLocale(v === 'es' ? 'es' : 'pt')}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pt">Português</SelectItem>
                <SelectItem value="es">Español</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-[var(--ink-500)]">{t('clientLanguageHelp')}</p>
          </div>

          <div className="space-y-1.5">
            <Label>{ts('bookingMode')}</Label>
            <Select value={bookingMode} onValueChange={(v) => setBookingMode(v === 'approval' ? 'approval' : 'auto')}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{ts('bookingAuto')}</SelectItem>
                <SelectItem value="approval">{ts('bookingApproval')}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-[var(--ink-500)]">{ts('bookingModeHelp')}</p>
          </div>

          <div className="space-y-1.5">
            <Label>{ts('deposit')}</Label>
            <div className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-3">
              <Input inputMode="numeric" value={depositPercent} onChange={(e) => setDepositPercent(e.target.value.replace(/\D/g, '').slice(0, 3))} aria-label={ts('depositPercent')} placeholder={ts('depositPercent')} />
              <Input value={pixKey} onChange={(e) => setPixKey(e.target.value)} aria-label={ts('pixKey')} placeholder={ts('pixKey')} />
            </div>
            <p className="text-xs text-[var(--ink-500)]">{ts('depositHelp')}</p>
          </div>

          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5"><Clock className="size-3.5" />{t('timezone')}</Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(STUDIO_TIMEZONES.some((z) => z.value === timezone) ? STUDIO_TIMEZONES : [{ value: timezone, label: timezone }, ...STUDIO_TIMEZONES]).map((z) => (
                  <SelectItem key={z.value} value={z.value}>{z.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-[var(--ink-500)]">{t('timezoneHelp')}</p>
          </div>

          <div className="space-y-2 pt-2">
            <Label className="flex items-center gap-1.5"><Clock className="size-3.5" />{t('hours')}</Label>
            <p className="text-xs text-[var(--ink-500)]">{t('hoursHelp')}</p>
            <div className="rounded-lg border border-[var(--ink-200)] divide-y divide-[var(--ink-200)]">
              {WEEK_ORDER.map((d) => {
                const day = hours[String(d)]
                const setDay = (patch: Partial<typeof day>) => setHours((h) => ({ ...h, [String(d)]: { ...h[String(d)], ...patch } }))
                return (
                  <div key={d} className="flex flex-wrap items-center gap-3 px-3 py-2">
                    <span className="w-20 text-sm">{dayNames[d]}</span>
                    <label className="flex items-center gap-1.5 text-xs text-[var(--ink-600)]">
                      <input type="checkbox" checked={!day.closed} onChange={(e) => setDay({ closed: !e.target.checked })} />
                      {t('open')}
                    </label>
                    {!day.closed && (
                      <div className="flex items-center gap-2">
                        <Input type="time" className="h-8 w-28" value={day.open} onChange={(e) => setDay({ open: e.target.value })} aria-label={t('opens', { day: dayNames[d] })} />
                        <span className="text-xs text-[var(--ink-500)]">{t('to')}</span>
                        <Input type="time" className="h-8 w-28" value={day.close} onChange={(e) => setDay({ close: e.target.value })} aria-label={t('closes', { day: dayNames[d] })} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <Button className="btn-gold gap-2" onClick={save} disabled={saving}>{saving ? <Spinner className="size-4" /> : saved ? <CheckCircle2 className="size-4" /> : <Save className="size-4" />}{saving ? tc('saving') : saved ? tc('saved') : t('saveChanges')}</Button>
        </div>
      </div>
    </div>
  )
}
