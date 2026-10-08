import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import type { Procedure } from '@/lib/supabase'
import { Plus, Scissors, Trash2, Edit, DollarSign, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'

export function ProcedimentosPage() {
  const { profile } = useAuth()
  const [procedures, setProcedures] = useState<Procedure[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editProc, setEditProc] = useState<Procedure | null>(null)
  const [form, setForm] = useState({ name: '', price: '', duration: '60', active: true })
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadProcedures() }, [])

  const loadProcedures = async () => {
    const { data } = await supabase.from('procedures').select('*').order('name')
    setProcedures(data ?? [])
    setLoading(false)
  }

  const openNew = () => { setEditProc(null); setForm({ name: '', price: '', duration: '60', active: true }); setDialogOpen(true) }
  const openEdit = (p: Procedure) => { setEditProc(p); setForm({ name: p.name, price: p.price.toString(), duration: p.duration.toString(), active: p.active }); setDialogOpen(true) }

  const save = async () => {
    if (!profile?.studio_id) { toast.error('Studio não encontrado'); return }
    setSaving(true)
    const payload = { studio_id: profile.studio_id, name: form.name, price: parseFloat(form.price) || 0, duration: parseInt(form.duration) || 60, active: form.active }
    let result
    if (editProc) result = await supabase.from('procedures').update({ name: payload.name, price: payload.price, duration: payload.duration, active: payload.active }).eq('id', editProc.id)
    else result = await supabase.from('procedures').insert(payload)
    if (result.error) { toast.error('Erro ao salvar: ' + result.error.message); setSaving(false); return }
    setDialogOpen(false); setSaving(false); loadProcedures()
  }

  const toggleActive = async (p: Procedure) => { await supabase.from('procedures').update({ active: !p.active }).eq('id', p.id); loadProcedures() }
  const del = async (id: string) => { await supabase.from('procedures').delete().eq('id', id); loadProcedures() }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-serif font-medium">Procedimentos</h1><p className="text-sm text-[var(--ink-500)] mt-0.5">{procedures.length} serviços cadastrados</p></div>
        <Button className="btn-gold gap-2" onClick={openNew}><Plus className="size-4" /> Novo Procedimento</Button>
      </div>

      {loading ? <div className="flex justify-center p-12"><Spinner className="text-[var(--gold)]" /></div> : procedures.length === 0 ? (
        <div className="luxury-card p-12 flex flex-col items-center text-center">
          <Scissors className="size-12 text-[var(--ink-300)] mb-3" />
          <p className="text-sm font-medium text-[var(--ink-500)]">Nenhum procedimento cadastrado</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {procedures.map(p => (
            <div key={p.id} className="luxury-card p-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg gold-gradient flex items-center justify-center flex-shrink-0"><Scissors className="size-4 text-[var(--ink-900)]" /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-[var(--ink-500)]">
                    <span className="flex items-center gap-1"><DollarSign className="size-3" />R$ {p.price.toFixed(2)}</span>
                    <span className="flex items-center gap-1"><Clock className="size-3" />{p.duration}min</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon-sm" onClick={() => openEdit(p)}><Edit className="size-3.5" /></Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => del(p.id)}><Trash2 className="size-3.5 text-[var(--danger)]" /></Button>
                </div>
              </div>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--ink-200)]">
                <span className="text-xs text-[var(--ink-500)]">{p.active ? 'Ativo' : 'Inativo'}</span>
                <Switch checked={p.active} onCheckedChange={() => toggleActive(p)} />
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editProc ? 'Editar Procedimento' : 'Novo Procedimento'}</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5"><Label>Nome *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ex: Botox" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Preço (R$)</Label><Input type="number" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} placeholder="0,00" /></div>
              <div className="space-y-1.5"><Label>Duração (min)</Label><Input type="number" value={form.duration} onChange={e => setForm(f => ({ ...f, duration: e.target.value }))} /></div>
            </div>
            <div className="flex items-center gap-2"><Switch checked={form.active} onCheckedChange={v => setForm(f => ({ ...f, active: v }))} /><Label>Ativo</Label></div>
            <div className="flex gap-2 pt-2"><Button variant="outline" className="flex-1" onClick={() => setDialogOpen(false)}>Cancelar</Button><Button className="flex-1 btn-gold" onClick={save} disabled={saving || !form.name}>{saving ? <Spinner className="size-4" /> : 'Salvar'}</Button></div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
