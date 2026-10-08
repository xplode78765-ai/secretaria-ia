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

export function AutomacoesPage() {
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
    if (!profile?.studio_id) { toast.error('Studio não encontrado'); return }
    setSaving(true)
    const { error } = await supabase.from('automations').insert({ studio_id: profile.studio_id, name: form.name, trigger: form.trigger, enabled: true })
    if (error) { toast.error('Erro ao criar: ' + error.message); setSaving(false); return }
    setDialogOpen(false); setSaving(false); setForm({ name: '', trigger: '' }); loadAutomations()
  }

  const toggle = async (a: Automation) => { await supabase.from('automations').update({ enabled: !a.enabled }).eq('id', a.id); loadAutomations() }
  const del = async (id: string) => { await supabase.from('automations').delete().eq('id', id); loadAutomations() }

  const triggerLabels: Record<string, string> = {
    'reminder_24h': 'Lembrete 24h antes',
    'reminder_1h': 'Lembrete 1h antes',
    'birthday': 'Mensagem de aniversário',
    'follow_up_7d': 'Follow-up 7 dias',
    'winback_30d': 'Resgate 30 dias',
    'winback_60d': 'Resgate 60 dias',
    'winback_90d': 'Resgate 90 dias',
    'post_procedure': 'Pós-procedimento',
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-serif font-medium">Automações</h1><p className="text-sm text-[var(--ink-500)] mt-0.5">{automations.length} automações configuradas</p></div>
        <Button className="btn-gold gap-2" onClick={() => setDialogOpen(true)}><Plus className="size-4" /> Nova Automação</Button>
      </div>

      {loading ? <div className="flex justify-center p-12"><Spinner className="text-[var(--gold)]" /></div> : automations.length === 0 ? (
        <div className="luxury-card p-12 flex flex-col items-center text-center">
          <Zap className="size-12 text-[var(--ink-300)] mb-3" />
          <p className="text-sm font-medium text-[var(--ink-500)]">Nenhuma automação configurada</p>
          <p className="text-xs text-[var(--ink-400)] mt-1">Crie automações para engajar seus clientes</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {automations.map(a => (
            <div key={a.id} className="luxury-card p-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg gold-gradient flex items-center justify-center flex-shrink-0"><Zap className="size-4 text-[var(--ink-900)]" /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{a.name}</p>
                  <p className="text-xs text-[var(--ink-500)] mt-0.5">{triggerLabels[a.trigger] || a.trigger || 'Sem gatilho'}</p>
                </div>
                <Button variant="ghost" size="icon-sm" onClick={() => del(a.id)}><Trash2 className="size-3.5 text-[var(--danger)]" /></Button>
              </div>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--ink-200)]">
                <span className="text-xs text-[var(--ink-500)]">{a.enabled ? 'Ativa' : 'Pausada'}</span>
                <Switch checked={a.enabled} onCheckedChange={() => toggle(a)} />
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nova Automação</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5"><Label>Nome *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ex: Lembrete de consulta" /></div>
            <div className="space-y-1.5"><Label>Gatilho</Label><Select value={form.trigger} onValueChange={v => setForm(f => ({ ...f, trigger: v }))}><SelectTrigger><SelectValue placeholder="Selecione um gatilho" /></SelectTrigger><SelectContent>{Object.entries(triggerLabels).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></div>
            <div className="flex gap-2 pt-2"><Button variant="outline" className="flex-1" onClick={() => setDialogOpen(false)}>Cancelar</Button><Button className="flex-1 btn-gold" onClick={save} disabled={saving || !form.name}>{saving ? <Spinner className="size-4" /> : 'Criar'}</Button></div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
