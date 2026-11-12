import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Tag } from 'lucide-react'
import { useT } from '@/i18n'
import { callEdge } from '@/lib/edge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'

type Plan = { id: string; name: string; price_cents: number; ai_messages_month: number | null }
type Draft = { price: string; limit: string }

// Platform admin: monthly price and AI-reply limit of each plan.
export function AdminPlans() {
  const t = useT('sales')
  const tc = useT('common')
  const [plans, setPlans] = useState<Plan[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [saving, setSaving] = useState('')

  const load = useCallback(async () => {
    const res = await callEdge<{ plans: Plan[] }>('admin-panel', { action: 'plans' })
    if (!res.ok) return
    setPlans(res.data.plans || [])
    const next: Record<string, Draft> = {}
    for (const p of res.data.plans || []) next[p.id] = { price: (p.price_cents / 100).toFixed(2), limit: p.ai_messages_month === null ? '' : String(p.ai_messages_month) }
    setDrafts(next)
  }, [])
  useEffect(() => { void load() }, [load])

  const save = async (p: Plan) => {
    const d = drafts[p.id]
    const price = Math.round(parseFloat(d.price.replace(',', '.')) * 100)
    if (!Number.isFinite(price) || price < 0) { toast.error(t('planError', { error: d.price })); return }
    setSaving(p.id)
    const res = await callEdge('admin-panel', { action: 'plan-update', id: p.id, price_cents: price, ai_messages_month: d.limit.trim() === '' ? null : Number(d.limit) })
    setSaving('')
    if (!res.ok) { toast.error(res.data.error || ''); return }
    toast.success(t('adminSaved'))
    void load()
  }

  if (plans.length === 0) return null
  return (
    <div className="luxury-card p-6 space-y-4">
      <div>
        <div className="flex items-center gap-2"><Tag className="size-4 text-[var(--gold)]" /><h2 className="font-serif font-medium text-lg">{t('adminPlans')}</h2></div>
        <p className="text-xs text-[var(--ink-500)] mt-1">{t('adminPlansHelp')}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {plans.map((p) => (
          <div key={p.id} className="rounded-lg border border-[var(--ink-200)] p-4 space-y-3">
            <p className="font-serif font-medium">{p.name}</p>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('adminPrice')}</Label>
              <Input inputMode="decimal" value={drafts[p.id]?.price ?? ''} onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: { ...d[p.id], price: e.target.value } }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('adminLimit')}</Label>
              <Input inputMode="numeric" value={drafts[p.id]?.limit ?? ''} onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: { ...d[p.id], limit: e.target.value.replace(/\D/g, '') } }))} />
            </div>
            <Button size="sm" className="btn-gold" disabled={saving === p.id} onClick={() => void save(p)}>{saving === p.id ? <Spinner className="size-4" /> : tc('save')}</Button>
          </div>
        ))}
      </div>
    </div>
  )
}
