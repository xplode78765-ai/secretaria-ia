import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useT } from '@/i18n'
import { callEdge } from '@/lib/edge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'

// Official WhatsApp API (Meta Cloud API), Pro plan. The token typed here goes
// straight to the server and is not stored by the app.
export function OfficialApiCard() {
  const t = useT('sales')
  const { profile } = useAuth()
  const [provider, setProvider] = useState('evolution')
  const [form, setForm] = useState({ phone_number_id: '', business_id: '', token: '' })
  const [saving, setSaving] = useState(false)
  const allowed = !!profile?.plan_features?.includes('official_api')

  useEffect(() => {
    if (!profile?.studio_id) return
    void supabase.from('studios').select('whatsapp_provider').eq('id', profile.studio_id).maybeSingle()
      .then(({ data }) => setProvider(data?.whatsapp_provider || 'evolution'))
  }, [profile?.studio_id])

  const connect = async () => {
    setSaving(true)
    const res = await callEdge('evolution-manager', { action: 'connect_cloud', ...form })
    setSaving(false)
    if (!res.ok) { toast.error(res.data.error || ''); return }
    setForm({ phone_number_id: '', business_id: '', token: '' })
    setProvider('cloud_api')
    toast.success(t('officialOk'))
  }

  return (
    <div className="luxury-card p-6">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-10 h-10 rounded-lg bg-[var(--ink-100)] flex items-center justify-center"><ShieldCheck className="size-5 text-[var(--gold)]" /></div>
        <div><h2 className="font-serif font-medium text-lg">{t('officialTitle')}</h2><p className="text-xs text-[var(--ink-500)]">{t('officialText')}</p></div>
      </div>
      {provider === 'cloud_api' ? (
        <p className="text-sm text-[var(--success-700)]">{t('officialConnected')}</p>
      ) : !allowed ? (
        <p className="text-sm text-[var(--ink-500)]">{t('officialProOnly')}</p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>{t('officialPhoneId')}</Label><Input inputMode="numeric" value={form.phone_number_id} onChange={(e) => setForm((f) => ({ ...f, phone_number_id: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>{t('officialBusinessId')}</Label><Input inputMode="numeric" value={form.business_id} onChange={(e) => setForm((f) => ({ ...f, business_id: e.target.value }))} /></div>
          </div>
          <div className="space-y-1.5"><Label>{t('officialToken')}</Label><Input type="password" autoComplete="off" value={form.token} onChange={(e) => setForm((f) => ({ ...f, token: e.target.value }))} /></div>
          <Button className="btn-gold" disabled={saving || !form.phone_number_id || !form.business_id || form.token.length < 20} onClick={() => void connect()}>
            {saving ? <Spinner className="size-4" /> : t('officialConnect')}
          </Button>
        </div>
      )}
    </div>
  )
}
