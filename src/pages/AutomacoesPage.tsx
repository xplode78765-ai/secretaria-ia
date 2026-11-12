import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import type { Automation } from '@/lib/supabase'
import { Zap, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { useConfirm } from '@/components/ConfirmDialog'
import { useT } from '@/i18n'

export function AutomacoesPage() {
  const tc = useT('common')
  const t = useT('catalog')
  const [confirm, confirmDialog] = useConfirm()
  const { profile } = useAuth()
  const [automations, setAutomations] = useState<Automation[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState({ name: '', trigger: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadAutomations() }, [])

  const loadAutomations = async () => {
    const { data } = await supabase.from('automations').select('*').order('created_at', { ascending: false })
    setAutomations(data ?? [])
    setLoading(false)
  }

  const save = async () => {
    if (!profile?.studio_id) { toast.error(t('noStudio')); return }
    setSaving(true)
    const { error } = await supabase.from('automations').insert({ studio_id: profile.studio_id, name: form.name, trigger: form.trigger, enabled: true })
    if (error) { toast.error(t('autoCreateError', { error: error.message })); setSaving(false); return }
    setDialogOpen(false); setSaving(false); setForm({ name: '', trigger: '' }); loadAutomations()
  }

  const toggle = async (a: Automation) => { await supabase.from('automations').update({ enabled: !a.enabled }).eq('id', a.id); loadAutomations() }
  const del = async (id: string) => {
    if (!(await confirm({ title: t('autoDeleteTitle'), description: t('autoDeleteText'), confirmLabel: tc('delete') }))) return
    await supabase.from('automations').delete().eq('id', id); loadAutomations() }

  const triggerLabels: Record<string, string> = {
    'reminder_24h': t('trig_reminder_24h'),
    'reminder_1h': t('trig_reminder_1h'),
    'reminder_day_of': t('trig_reminder_day_of'),
    'birthday': t('trig_birthday'),
    'follow_up_7d': t('trig_follow_up_7d'),
    'winback_30d': t('trig_winback_30d'),
    'winback_60d': t('trig_winback_60d'),
    'winback_90d': t('trig_winback_90d'),
    'post_procedure': t('trig_post_procedure'),
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-serif font-medium">{t('autoTitle')}</h1><p className="text-sm text-[var(--ink-500)] mt-0.5">{t('autoCount', { count: automations.length })}</p></div>
        <Button className="btn-gold gap-2" onClick={() => setDialogOpen(true)}><Plus className="size-4" /> {t('autoNew')}</Button>
      </div>

      {loading ? <div className="flex justify-center p-12"><Spinner className="text-[var(--gold)]" /></div> : automations.length === 0 ? (
        <div className="luxury-card p-12 flex flex-col items-center text-center">
          <Zap className="size-12 text-[var(--ink-300)] mb-3" />
          <p className="text-sm font-medium text-[var(--ink-500)]">{t('autoEmpty')}</p>
          <p className="text-xs text-[var(--ink-400)] mt-1">{t('autoEmptyHint')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {automations.map(a => (
            <div key={a.id} className="luxury-card p-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg gold-gradient flex items-center justify-center flex-shrink-0"><Zap className="size-4 text-[var(--ink-900)]" /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{a.name}</p>
                  <p className="text-xs text-[var(--ink-500)] mt-0.5">{triggerLabels[a.trigger] || a.trigger || t('noTrigger')}</p>
                </div>
                <Button variant="ghost" size="icon-sm" onClick={() => del(a.id)}><Trash2 className="size-3.5 text-[var(--danger)]" /></Button>
              </div>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--ink-200)]">
                <span className="text-xs text-[var(--ink-500)]">{a.enabled ? t('autoOn') : t('autoOff')}</span>
                <Switch checked={a.enabled} onCheckedChange={() => toggle(a)} />
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t('autoNew')}</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5"><Label>{tc('name')} *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder={t('autoNamePh')} /></div>
            <div className="space-y-1.5"><Label>{t('trigger')}</Label><Select value={form.trigger} onValueChange={v => setForm(f => ({ ...f, trigger: v }))}><SelectTrigger><SelectValue placeholder={t('triggerPh')} /></SelectTrigger><SelectContent>{Object.entries(triggerLabels).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></div>
            <div className="flex gap-2 pt-2"><Button variant="outline" className="flex-1" onClick={() => setDialogOpen(false)}>{tc('cancel')}</Button><Button className="flex-1 btn-gold" onClick={save} disabled={saving || !form.name}>{saving ? <Spinner className="size-4" /> : t('create')}</Button></div>
          </div>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </div>
  )
}
