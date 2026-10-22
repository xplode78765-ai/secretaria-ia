import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import type { Professional } from '@/lib/supabase'
import { Plus, Stethoscope, Trash2, Edit, Phone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'

export function ProfissionaisPage() {
  const { profile } = useAuth()
  const [professionals, setProfessionals] = useState<Professional[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editProf, setEditProf] = useState<Professional | null>(null)
  const [form, setForm] = useState({ name: '', specialty: '', phone: '', active: true, commission_percent: '0' })
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadProfessionals() }, [])

  const loadProfessionals = async () => {
    const { data } = await supabase.from('professionals').select('*').order('name')
    setProfessionals(data ?? [])
    setLoading(false)
  }

  const openNew = () => { setEditProf(null); setForm({ name: '', specialty: '', phone: '', active: true, commission_percent: '0' }); setDialogOpen(true) }
  const openEdit = (p: Professional) => { setEditProf(p); setForm({ name: p.name, specialty: p.specialty, phone: p.phone, active: p.active, commission_percent: String(p.commission_percent ?? 0) }); setDialogOpen(true) }

  const save = async () => {
    if (!profile?.studio_id) { toast.error('Studio não encontrado'); return }
    setSaving(true)
    const payload = { studio_id: profile.studio_id, name: form.name, specialty: form.specialty, phone: form.phone, active: form.active, commission_percent: parseFloat(form.commission_percent) || 0 }
    let result
    if (editProf) result = await supabase.from('professionals').update({ name: payload.name, specialty: payload.specialty, phone: payload.phone, active: payload.active, commission_percent: payload.commission_percent }).eq('id', editProf.id)
    else result = await supabase.from('professionals').insert(payload)
    if (result.error) { toast.error('Erro ao salvar: ' + result.error.message); setSaving(false); return }
    setDialogOpen(false); setSaving(false); loadProfessionals()
  }

  const toggleActive = async (p: Professional) => { await supabase.from('professionals').update({ active: !p.active }).eq('id', p.id); loadProfessionals() }
  const del = async (id: string) => { await supabase.from('professionals').delete().eq('id', id); loadProfessionals() }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-serif font-medium">Profissionais</h1><p className="text-sm text-[var(--ink-500)] mt-0.5">{professionals.length} cadastrados</p></div>
        <Button className="btn-gold gap-2" onClick={openNew}><Plus className="size-4" /> Novo Profissional</Button>
      </div>

      {loading ? <div className="flex justify-center p-12"><Spinner className="text-[var(--gold)]" /></div> : professionals.length === 0 ? (
        <div className="luxury-card p-12 flex flex-col items-center text-center">
          <Stethoscope className="size-12 text-[var(--ink-300)] mb-3" />
          <p className="text-sm font-medium text-[var(--ink-500)]">Nenhum profissional cadastrado</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {professionals.map(p => (
            <div key={p.id} className="luxury-card p-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full gold-gradient flex items-center justify-center flex-shrink-0 text-sm font-medium">{p.name.slice(0, 1).toUpperCase()}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  <p className="text-xs text-[var(--ink-500)]">{p.specialty || 'Sem especialidade'}</p>
                  {p.phone && <p className="text-xs text-[var(--ink-500)] flex items-center gap-1 mt-0.5"><Phone className="size-3" />{p.phone}</p>}
                  <p className="text-xs text-[var(--ink-400)] mt-0.5">Comissão {Number(p.commission_percent || 0)}%</p>
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
          <DialogHeader><DialogTitle>{editProf ? 'Editar Profissional' : 'Novo Profissional'}</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5"><Label>Nome *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Nome completo" /></div>
            <div className="space-y-1.5"><Label>Especialidade</Label><Input value={form.specialty} onChange={e => setForm(f => ({ ...f, specialty: e.target.value }))} placeholder="Ex: Esteticista" /></div>
            <div className="space-y-1.5"><Label>Telefone</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="(11) 99999-9999" /></div>
            <div className="space-y-1.5"><Label>Comissão %</Label><Input type="number" value={form.commission_percent} onChange={e => setForm(f => ({ ...f, commission_percent: e.target.value }))} /></div>
            <div className="flex items-center gap-2"><Switch checked={form.active} onCheckedChange={v => setForm(f => ({ ...f, active: v }))} /><Label>Ativo</Label></div>
            <div className="flex gap-2 pt-2"><Button variant="outline" className="flex-1" onClick={() => setDialogOpen(false)}>Cancelar</Button><Button className="flex-1 btn-gold" onClick={save} disabled={saving || !form.name}>{saving ? <Spinner className="size-4" /> : 'Salvar'}</Button></div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
