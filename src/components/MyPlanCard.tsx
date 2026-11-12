import { useCallback, useEffect, useState } from 'react'
import { CreditCard, Check } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { useI18n, useT } from '@/i18n'
import { callEdge } from '@/lib/edge'
import { formatInStudio, useStudioTz } from '@/lib/timezone'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { useConfirm } from '@/components/ConfirmDialog'
import { cn } from '@/lib/utils'

type Plan = { id: string; name: string; audience: string; price_cents: number; ai_messages_month: number | null; features: string[] }
type Status = {
  plan: string; status: string; trial_ends_at: string | null; has_subscription: boolean; billing_ready: boolean; plans: Plan[]
}

const FEATURE_KEYS = { team: 'featTeam', finance: 'featFinance', reports: 'featReports', automations: 'featAutomations', official_api: 'featOfficialApi' } as const
const STATUS_KEYS = { trialing: 'statusTrialing', active: 'statusActive', past_due: 'statusPastDue', paused: 'statusPaused', cancelled: 'statusCancelled' } as const

// "Meu plano": current plan, trial, subscribe (Asaas), change plan, cancel.
export function MyPlanCard() {
  const t = useT('sales')
  const { intlLocale, dateLocale } = useI18n()
  const { profile, refreshProfile } = useAuth()
  const tz = useStudioTz()
  const [confirm, confirmDialog] = useConfirm()
  const [info, setInfo] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [doc, setDoc] = useState('')
  const [invoiceUrl, setInvoiceUrl] = useState('')
  const isOwner = profile?.role === 'owner' || profile?.role === 'admin'

  const load = useCallback(async () => {
    const res = await callEdge<Status>('billing', { action: 'status' })
    if (res.ok) setInfo(res.data)
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])

  const fail = (data: { error?: string; code?: string }) => {
    if (data.code === 'billing_not_configured') toast.error(t('billingNotReady'))
    else if (data.code === 'invalid_document') toast.error(t('invalidDocument'))
    else if (data.code === 'owner_only') toast.error(t('ownerOnly'))
    else toast.error(t('planError', { error: data.error || '' }))
  }

  const pick = async (plan: Plan) => {
    if (!info) return
    const digits = doc.replace(/\D/g, '')
    if (!info.has_subscription && digits.length !== 11 && digits.length !== 14) { toast.error(t('invalidDocument')); return }
    setBusy(plan.id)
    const res = await callEdge<{ invoice_url?: string | null }>('billing', {
      action: info.has_subscription ? 'change_plan' : 'subscribe', plan: plan.id, cpf_cnpj: digits,
    })
    setBusy('')
    if (!res.ok) { fail(res.data); return }
    if (res.data.invoice_url) {
      setInvoiceUrl(res.data.invoice_url)
      window.open(res.data.invoice_url, '_blank', 'noopener')
      toast.success(t('subscribeOk'))
    } else {
      toast.success(t('planChanged'))
    }
    await load()
    await refreshProfile()
  }

  const openInvoice = async () => {
    setBusy('invoice')
    const res = await callEdge<{ invoice_url?: string | null }>('billing', { action: 'invoice' })
    setBusy('')
    if (res.ok && res.data.invoice_url) window.open(res.data.invoice_url, '_blank', 'noopener')
    else if (!res.ok) fail(res.data)
  }

  const cancel = async () => {
    if (!(await confirm({ title: t('cancelTitle'), description: t('cancelText'), confirmLabel: t('cancelConfirm') }))) return
    setBusy('cancel')
    const res = await callEdge('billing', { action: 'cancel' })
    setBusy('')
    if (!res.ok) { fail(res.data); return }
    toast.success(t('cancelled'))
    await load()
    await refreshProfile()
  }

  const money = (cents: number) => (cents / 100).toLocaleString(intlLocale, { minimumFractionDigits: 2 })

  return (
    <div className="luxury-card p-6" id="meu-plano">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-10 h-10 rounded-lg bg-[var(--ink-100)] flex items-center justify-center"><CreditCard className="size-5 text-[var(--gold)]" /></div>
        <div>
          <h2 className="font-serif font-medium text-lg">{t('planTitle')}</h2>
          {info && (
            <p className="text-xs text-[var(--ink-500)]">
              {t(STATUS_KEYS[info.status as keyof typeof STATUS_KEYS] ?? 'statusActive')}
              {info.status === 'trialing' && info.trial_ends_at ? ` · ${t('trialUntil', { date: formatInStudio(info.trial_ends_at, 'dd/MM', tz, { locale: dateLocale }) })}` : ''}
            </p>
          )}
        </div>
      </div>

      {loading ? <div className="flex justify-center py-6"><Spinner className="text-[var(--gold)]" /></div> : !info ? null : (
        <div className="space-y-4">
          {!info.billing_ready && <p className="text-xs text-[var(--warning-700)] bg-[var(--warning-50)] border border-[var(--warning-100)] rounded-lg px-3 py-2">{t('billingNotReady')}</p>}

          {isOwner && !info.has_subscription && info.billing_ready && (
            <div className="space-y-1.5">
              <Label htmlFor="cpfcnpj">{t('cpfCnpj')}</Label>
              <Input id="cpfcnpj" inputMode="numeric" autoComplete="off" value={doc} onChange={(e) => setDoc(e.target.value)} placeholder="000.000.000-00" className="max-w-xs" />
              <p className="text-xs text-[var(--ink-500)]">{t('cpfCnpjHelp')}</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {info.plans.map((p) => {
              const isCurrent = p.id === info.plan
              const subscribed = info.has_subscription && isCurrent
              return (
                <div key={p.id} className={cn('rounded-xl border p-4 flex flex-col gap-2', isCurrent ? 'border-[var(--gold)] bg-[var(--gold-50)]/40' : 'border-[var(--ink-200)]')}>
                  <div>
                    <p className="font-serif font-medium">{p.name}</p>
                    <p className="text-xs text-[var(--ink-500)]">{p.audience}</p>
                  </div>
                  <p className="text-lg font-serif">{t('perMonth', { price: money(p.price_cents) })}</p>
                  <ul className="text-xs text-[var(--ink-600)] space-y-1 flex-1">
                    <li className="flex gap-1.5"><Check className="size-3.5 mt-0.5 text-[var(--gold)] flex-shrink-0" />{t('featBase')}</li>
                    <li className="flex gap-1.5"><Check className="size-3.5 mt-0.5 text-[var(--gold)] flex-shrink-0" />{p.ai_messages_month === null ? t('aiUnlimited') : t('aiLimit', { count: p.ai_messages_month })}</li>
                    {p.features.map((f) => f in FEATURE_KEYS && (
                      <li key={f} className="flex gap-1.5"><Check className="size-3.5 mt-0.5 text-[var(--gold)] flex-shrink-0" />{t(FEATURE_KEYS[f as keyof typeof FEATURE_KEYS])}</li>
                    ))}
                  </ul>
                  {subscribed ? (
                    <span className="text-xs font-medium text-[var(--gold)]">{t('current')}</span>
                  ) : isOwner && (
                    <Button size="sm" className={cn(isCurrent ? 'btn-gold' : '')} variant={isCurrent ? 'default' : 'outline'} disabled={!!busy || !info.billing_ready} onClick={() => void pick(p)}>
                      {busy === p.id ? <Spinner className="size-4" /> : info.has_subscription ? t('switchTo') : t('choose')}
                    </Button>
                  )}
                </div>
              )
            })}
          </div>

          {isOwner && info.has_subscription && (
            <div className="flex flex-wrap gap-2 pt-1">
              {(invoiceUrl || info.status !== 'active') && (
                <Button variant="outline" size="sm" disabled={!!busy} onClick={() => invoiceUrl ? window.open(invoiceUrl, '_blank', 'noopener') : void openInvoice()}>{t('payNow')}</Button>
              )}
              <Button variant="ghost" size="sm" className="text-[var(--danger)]" disabled={!!busy} onClick={() => void cancel()}>{t('cancelSub')}</Button>
            </div>
          )}
          {!isOwner && <p className="text-xs text-[var(--ink-500)]">{t('ownerOnly')}</p>}
        </div>
      )}
      {confirmDialog}
    </div>
  )
}
