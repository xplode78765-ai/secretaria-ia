import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'
import { browserDiffersFrom, tzCity } from '@/lib/timezone'
import { useT } from '@/i18n'
import { LanguageToggle } from '@/components/LanguageToggle'
import { useI18n } from '@/i18n'
import { describeWeek, loadWeek } from '@/lib/business-hours'

type PublicStudio = { name: string; address: string; phone: string; instagram: string; hours_text?: string; timezone?: string; business_hours?: Record<string, unknown> }
type PublicProc = { id: string; name: string; price: number; duration: number }

export function AgendarPage() {
  const t = useT('booking')
  const { slug } = useParams()
  const [studio, setStudio] = useState<PublicStudio | null>(null)
  const [procedures, setProcedures] = useState<PublicProc[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const { lang } = useI18n()
  // Server errors come with a code; show them in the page language.
  const errorText = (json: { code?: string; error?: string; max_days?: number }) => {
    switch (json.code) {
      case 'invalid_input': return t('err_invalid_input')
      case 'past': return t('err_past')
      case 'too_far': return t('err_too_far', { days: json.max_days ?? 90 })
      case 'invalid_procedure': return t('err_invalid_procedure')
      case 'outside_hours': return t('err_outside_hours')
      case 'rate_limited': return t('err_rate_limited')
      case 'unavailable': return t('err_unavailable')
      case 'internal': return t('err_internal')
      case 'not_found': return t('errNotFound')
      default: return json.error || t('errGeneric')
    }
  }
  const [form, setForm] = useState({ name: '', phone: '', procedure_id: '', start_time: '' })

  useEffect(() => {
    const run = async () => {
      const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/public-booking?slug=${encodeURIComponent(slug || '')}`
      const res = await fetch(url, { headers: { apikey: anon, Authorization: `Bearer ${anon}` } })
      const json = await res.json()
      if (!res.ok) { toast.error(json.code === 'not_found' ? t('errNotFound') : (json.error || t('errNotFound'))); setLoading(false); return }
      setStudio(json.studio)
      setProcedures(json.procedures || [])
      setLoading(false)
    }
    void run()
  }, [slug])

  const submit = async () => {
    setSaving(true)
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/public-booking?slug=${encodeURIComponent(slug || '')}`
    const startIso = form.start_time.length === 16 ? `${form.start_time}:00` : form.start_time
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` },
      body: JSON.stringify({ ...form, start_time: startIso, slug }),
    })
    const json = await res.json()
    setSaving(false)
    if (!res.ok) { toast.error(errorText(json)); return }
    toast.success(t('sent'))
    setDone(true)
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Spinner className="text-[var(--gold)]" /></div>
  if (!studio) return <div className="min-h-screen flex items-center justify-center text-sm text-[var(--ink-500)]">{t('invalidLink')}</div>

  return (
    <div className="min-h-screen bg-[var(--canvas)] flex items-center justify-center p-6">
      <div className="luxury-card w-full max-w-md p-6 space-y-5">
        <div className="flex justify-end"><LanguageToggle /></div>
        <div>
          <p className="text-[10px] tracking-[0.2em] uppercase text-[var(--ink-400)]">{t('kicker')}</p>
          <h1 className="text-2xl font-serif font-medium">{studio.name}</h1>
          {studio.address && <p className="text-sm text-[var(--ink-500)] mt-1">{studio.address}</p>}
          {(studio.business_hours || studio.hours_text) && <p className="text-xs text-[var(--ink-500)] mt-1">{t('hours', { hours: studio.business_hours ? describeWeek(loadWeek(studio.business_hours), lang) : (studio.hours_text || '') })}</p>}
          {studio.timezone && browserDiffersFrom(studio.timezone) && <p className="text-xs text-[var(--warning-700)] mt-1">{t('tzHint', { city: tzCity(studio.timezone) })}</p>}
        </div>
        {done ? (
          <p className="text-sm text-[var(--success-700)]">{t('done')}</p>
        ) : (
          <>
            <div className="space-y-1.5"><Label>{t('yourName')}</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>{t('whatsapp')}</Label><Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="11999999999" /></div>
            <div className="space-y-1.5">
              <Label>{t('procedure')}</Label>
              <Select value={form.procedure_id} onValueChange={(v) => setForm((f) => ({ ...f, procedure_id: v }))}>
                <SelectTrigger><SelectValue placeholder={t('choose')} /></SelectTrigger>
                <SelectContent>
                  {procedures.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name} · R$ {Number(p.price).toFixed(0)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('when')}</Label>
              <Input type="datetime-local" value={form.start_time} onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))} />
            </div>
            <Button className="w-full btn-gold" disabled={saving || !form.name || !form.phone || !form.start_time} onClick={() => void submit()}>
              {saving ? <Spinner className="size-4" /> : t('submit')}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
