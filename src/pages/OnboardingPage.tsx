import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'
import { ArrowRight, CheckCircle2, Bot, AlertTriangle } from 'lucide-react'
import { useI18n, useT } from '@/i18n'
import { LanguageToggle } from '@/components/LanguageToggle'
import { WhatsAppConnect } from '@/components/WhatsAppConnect'
import { defaultAiTemplates } from '@/lib/ai-engine'
import { defaultWeek, validateWeek, WEEK_ORDER, weekdayLabels, type WeekConfig } from '@/lib/business-hours'
import { cn } from '@/lib/utils'

// Guided first access, 4 steps: studio -> procedures -> WhatsApp -> see the AI answer.
// The goal is that the owner sees the AI replying on her own WhatsApp in a few minutes.
type ProcRow = { name: string; price: string; duration: string; checked: boolean }
type TestMsg = { id: string; sender_type: string; content: string; created_at: string }

const SUGGESTED: { key: 'sug1' | 'sug2' | 'sug3' | 'sug4' | 'sug5' | 'sug6' | 'sug7' | 'sug8' | 'sug9' | 'sug10'; duration: number }[] = [
  { key: 'sug1', duration: 30 }, { key: 'sug2', duration: 60 }, { key: 'sug3', duration: 45 }, { key: 'sug4', duration: 45 },
  { key: 'sug5', duration: 120 }, { key: 'sug6', duration: 30 }, { key: 'sug7', duration: 45 }, { key: 'sug8', duration: 60 },
  { key: 'sug9', duration: 30 }, { key: 'sug10', duration: 60 },
]

export function OnboardingPage() {
  const t = useT('onboarding')
  const ts = useT('sales')
  const tc = useT('common')
  const { lang } = useI18n()
  const { profile, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [studioData, setStudioData] = useState({ name: '', phone: '', address: '' })
  const [hours, setHours] = useState<WeekConfig>(defaultWeek())
  const [procs, setProcs] = useState<ProcRow[]>(() => SUGGESTED.map((s) => ({ name: '', price: '', duration: String(s.duration), checked: false })))
  const procsSaved = useRef(false)
  const [waConnected, setWaConnected] = useState(false)
  const [testMsgs, setTestMsgs] = useState<TestMsg[]>([])
  const testStartedAt = useRef<string>('')
  const dayNames = weekdayLabels(lang)
  const studioId = profile?.studio_id

  // Suggested names follow the interface language until the owner edits them.
  const procName = (i: number) => procs[i].name || (i < SUGGESTED.length ? ts(SUGGESTED[i].key) : '')

  const saveStudio = async () => {
    if (!studioId) { toast.error(t('errNoStudio')); return }
    const invalid = validateWeek(hours, lang)
    if (invalid) { toast.error(invalid); return }
    setLoading(true)
    const { error } = await supabase.from('studios').update({
      name: studioData.name, phone: studioData.phone, address: studioData.address,
      whatsapp_number: studioData.phone, business_hours: hours, locale: lang,
    }).eq('id', studioId)
    if (!error && lang === 'es') {
      // Default AI replies were created in Portuguese at signup: switch them to Spanish.
      await supabase.from('ai_settings').update(defaultAiTemplates('es')).eq('studio_id', studioId)
    }
    setLoading(false)
    if (error) { toast.error(t('errSaveStudio', { error: error.message })); return }
    setStep(1)
  }

  const saveProcedures = async () => {
    if (!studioId) { toast.error(t('errNoStudio')); return }
    const chosen = procs.map((p, i) => ({ ...p, name: procName(i).trim() })).filter((p) => p.checked && p.name)
    if (chosen.length === 0 || chosen.some((p) => !(parseFloat(p.price.replace(',', '.')) > 0))) { toast.error(ts('obProcNeedOne')); return }
    if (procsSaved.current) { setStep(2); return } // going back and forward must not duplicate them
    setLoading(true)
    const { error } = await supabase.from('procedures').insert(chosen.map((p) => ({
      studio_id: studioId, name: p.name.slice(0, 80),
      price: parseFloat(p.price.replace(',', '.')) || 0,
      duration: Math.min(Math.max(parseInt(p.duration) || 60, 10), 480),
    })))
    setLoading(false)
    if (error) { toast.error(ts('obSaveError', { error: error.message })); return }
    procsSaved.current = true
    setStep(2)
  }

  // Step 4: watch the conversation arrive (client message, then the AI reply).
  useEffect(() => {
    if (step !== 3) return
    if (!testStartedAt.current) testStartedAt.current = new Date(Date.now() - 60 * 1000).toISOString()
    const poll = async () => {
      const { data } = await supabase.from('messages')
        .select('id, sender_type, content, created_at')
        .gte('created_at', testStartedAt.current)
        .order('created_at', { ascending: true }).limit(6)
      setTestMsgs((data ?? []) as TestMsg[])
    }
    void poll()
    const timer = setInterval(() => void poll(), 3000)
    return () => clearInterval(timer)
  }, [step])

  const aiAnswered = testMsgs.some((m) => m.sender_type === 'ai') && testMsgs.some((m) => m.sender_type === 'client')

  const finish = async () => {
    if (!studioId) { toast.error(t('errNoStudio')); return }
    setLoading(true)
    const { error } = await supabase.from('studios').update({ onboarding_completed: true }).eq('id', studioId)
    if (error) { setLoading(false); toast.error(t('errSaveStudio', { error: error.message })); return }
    await refreshProfile()
    setLoading(false)
    toast.success(t('done'))
    navigate('/app', { replace: true })
  }

  const stepTitles = [ts('obStudio'), ts('obProcedures'), ts('obWhatsapp'), ts('obTest')]

  return (
    <div className="min-h-screen bg-[var(--canvas-subtle)] flex flex-col">
      <header className="border-b border-[var(--ink-200)] bg-[var(--canvas)] px-4 sm:px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg gold-gradient flex items-center justify-center">
            <span className="text-sm font-serif font-semibold">S</span>
          </div>
          <span className="font-serif text-lg font-medium">SecretarIA</span>
          <span className="ml-auto text-sm text-[var(--ink-500)] hidden sm:inline">{t('headerRight')}</span>
          <LanguageToggle className="ml-auto sm:ml-0" />
        </div>
      </header>

      <div className="max-w-3xl mx-auto w-full px-4 sm:px-6 py-6">
        {/* Progress bar */}
        <div className="mb-6" role="progressbar" aria-valuemin={1} aria-valuemax={4} aria-valuenow={step + 1} aria-label={ts('obStep', { n: step + 1 })}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium">{stepTitles[step]}</p>
            <p className="text-xs text-[var(--ink-500)]">{ts('obStep', { n: step + 1 })}</p>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {stepTitles.map((_, i) => <div key={i} className={cn('h-1.5 rounded-full', i <= step ? 'gold-gradient' : 'bg-[var(--ink-200)]')} />)}
          </div>
        </div>

        <div className="luxury-card p-5 sm:p-8">
          {step === 0 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-serif font-medium mb-1">{t('studioTitle')}</h2>
                <p className="text-sm text-[var(--ink-500)]">{t('studioSubtitle')}</p>
              </div>
              <div className="space-y-1.5">
                <Label>{t('studioName')}</Label>
                <Input value={studioData.name} onChange={e => setStudioData({ ...studioData, name: e.target.value })} placeholder="Studio Beauté Gold" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>{t('whatsapp')}</Label>
                  <Input inputMode="tel" value={studioData.phone} onChange={e => setStudioData({ ...studioData, phone: e.target.value })} placeholder="5511999999999" />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('address')}</Label>
                  <Input value={studioData.address} onChange={e => setStudioData({ ...studioData, address: e.target.value })} placeholder={t('addressPh')} />
                </div>
              </div>

              <div className="space-y-2">
                <Label>{ts('obHoursTitle')}</Label>
                <div className="rounded-lg border border-[var(--ink-200)] divide-y divide-[var(--ink-200)]">
                  {WEEK_ORDER.map((d) => {
                    const day = hours[String(d)]
                    const setDay = (patch: Partial<typeof day>) => setHours((h) => ({ ...h, [String(d)]: { ...h[String(d)], ...patch } }))
                    return (
                      <div key={d} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                        <label className="flex items-center gap-2 text-sm w-28">
                          <input type="checkbox" checked={!day.closed} onChange={(e) => setDay({ closed: !e.target.checked })} />
                          {dayNames[d]}
                        </label>
                        {!day.closed && (
                          <div className="flex items-center gap-2">
                            <Input type="time" className="h-8 w-[6.5rem]" value={day.open} onChange={(e) => setDay({ open: e.target.value })} aria-label={`${dayNames[d]} ↑`} />
                            <span className="text-xs text-[var(--ink-500)]">–</span>
                            <Input type="time" className="h-8 w-[6.5rem]" value={day.close} onChange={(e) => setDay({ close: e.target.value })} aria-label={`${dayNames[d]} ↓`} />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <Button className="btn-gold gap-2" onClick={() => void saveStudio()} disabled={!studioData.name.trim() || loading}>
                  {loading ? <Spinner className="size-4" /> : null}{t('continue')} <ArrowRight className="size-4" />
                </Button>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-serif font-medium mb-1">{ts('obProcTitle')}</h2>
                <p className="text-sm text-[var(--ink-500)]">{ts('obProcSubtitle')}</p>
              </div>
              <div className="space-y-2">
                {procs.map((p, i) => {
                  const set = (patch: Partial<ProcRow>) => setProcs((list) => list.map((row, j) => j === i ? { ...row, ...patch } : row))
                  return (
                    <div key={i} className={cn('grid grid-cols-[auto_1fr] sm:grid-cols-[auto_1fr_7rem_6rem] items-center gap-2 rounded-lg border px-3 py-2', p.checked ? 'border-[var(--gold)] bg-[var(--gold-50)]/30' : 'border-[var(--ink-200)]')}>
                      <input type="checkbox" checked={p.checked} onChange={(e) => set({ checked: e.target.checked })} aria-label={procName(i)} />
                      <Input className="h-9" value={procName(i)} onChange={(e) => set({ name: e.target.value, checked: true })} placeholder={t('procName')} />
                      <Input className="h-9 col-start-2 sm:col-start-auto" inputMode="decimal" value={p.price} onChange={(e) => set({ price: e.target.value, checked: true })} placeholder={`${t('procPrice')} (R$)`} />
                      <Input className="h-9 col-start-2 sm:col-start-auto" inputMode="numeric" value={p.duration} onChange={(e) => set({ duration: e.target.value })} placeholder={t('procMin')} aria-label={t('procMin')} />
                    </div>
                  )
                })}
              </div>
              <Button variant="outline" size="sm" onClick={() => setProcs((list) => [...list, { name: '', price: '', duration: '60', checked: true }])}>{ts('obProcAdd')}</Button>
              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => setStep(0)}>{t('back')}</Button>
                <Button className="btn-gold gap-2" onClick={() => void saveProcedures()} disabled={loading}>
                  {loading ? <Spinner className="size-4" /> : null}{t('continue')} <ArrowRight className="size-4" />
                </Button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-serif font-medium mb-1">{ts('obWaTitle')}</h2>
                <p className="text-sm text-[var(--ink-500)]">{ts('obWaSubtitle')}</p>
              </div>
              <p className="flex gap-2 text-xs text-[var(--warning-700)] bg-[var(--warning-50)] border border-[var(--warning-100)] rounded-lg px-3 py-2">
                <AlertTriangle className="size-4 flex-shrink-0" />{ts('obWaRisk')}
              </p>
              <WhatsAppConnect onConnected={() => setWaConnected(true)} />
              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => setStep(1)}>{t('back')}</Button>
                <Button className={cn('gap-2', waConnected && 'btn-gold')} variant={waConnected ? 'default' : 'outline'} onClick={() => setStep(3)}>
                  {waConnected ? t('continue') : ts('obSkipWa')} <ArrowRight className="size-4" />
                </Button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-serif font-medium mb-1">{ts('obTestTitle')}</h2>
                <p className="text-sm text-[var(--ink-500)]">{waConnected ? ts('obTestText') : ts('obTestNoWa')}</p>
              </div>
              {waConnected && (
                <div className="rounded-xl border border-[var(--ink-200)] bg-[var(--canvas-subtle)] p-4 min-h-[9rem] space-y-2" aria-live="polite">
                  {testMsgs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-6 text-center">
                      <Spinner className="size-6 text-[var(--gold)] mb-2" />
                      <p className="text-sm text-[var(--ink-500)]">{ts('obTestWaiting')}</p>
                    </div>
                  ) : testMsgs.map((m) => (
                    <div key={m.id} className={cn('flex', m.sender_type === 'client' ? 'justify-start' : 'justify-end')}>
                      <div className={cn('max-w-[85%] rounded-2xl px-3 py-2 text-sm', m.sender_type === 'client' ? 'bg-[var(--ink-100)]' : 'gold-gradient text-[var(--ink-900)]')}>
                        <p className="text-[10px] opacity-60 mb-0.5 flex items-center gap-1">
                          {m.sender_type !== 'client' && <Bot className="size-3" />}{m.sender_type === 'client' ? ts('obTestClient') : ts('obTestAi')}
                        </p>
                        {m.content}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {aiAnswered && (
                <p className="flex items-center gap-2 text-sm font-medium text-[var(--success-700)]"><CheckCircle2 className="size-4" />{ts('obTestDone')}</p>
              )}
              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => setStep(2)}>{t('back')}</Button>
                <Button className={cn('gap-2', (aiAnswered || !waConnected) && 'btn-gold')} variant={aiAnswered || !waConnected ? 'default' : 'outline'} onClick={() => void finish()} disabled={loading}>
                  {loading ? <Spinner className="size-4" /> : null}{ts('obFinish')} <ArrowRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
        <p className="text-center text-xs text-[var(--ink-400)] mt-4">{tc('rights')}</p>
      </div>
    </div>
  )
}
