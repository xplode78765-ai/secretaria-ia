import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Professional } from '@/lib/supabase'
import { Users, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'

type Member = { id: string; name: string; email: string; role: string; professional_id: string | null }

const roleLabel: Record<string, string> = {
  owner: 'Dona',
  admin: 'Dona',
  reception: 'Recepção',
  professional: 'Profissional',
}

export function EquipePage() {
  const [members, setMembers] = useState<Member[]>([])
  const [professionals, setProfessionals] = useState<Professional[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', role: 'reception', professional_id: '' })

  const load = async () => {
    const [{ data, error }, profs] = await Promise.all([
      supabase.functions.invoke('studio-team', { body: { action: 'list' } }),
      supabase.from('professionals').select('*').order('name'),
    ])
    if (error) toast.error(error.message)
    setMembers((data?.members ?? []) as Member[])
    setProfessionals(profs.data ?? [])
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  const invite = async () => {
    if (form.role === 'professional' && !form.professional_id) {
      toast.error('Vincule um profissional do cadastro')
      return
    }
    setSaving(true)
    const { data, error } = await supabase.functions.invoke('studio-team', {
      body: {
        action: 'invite',
        name: form.name,
        email: form.email,
        role: form.role,
        professional_id: form.professional_id || null,
      },
    })
    setSaving(false)
    if (error || data?.error) { toast.error(data?.error || error?.message || 'Falha no convite'); return }
    toast.success('Convite enviado')
    setDialogOpen(false)
    setForm({ name: '', email: '', role: 'reception', professional_id: '' })
    void load()
  }

  const remove = async (user_id: string) => {
    const { data, error } = await supabase.functions.invoke('studio-team', { body: { action: 'remove', user_id } })
    if (error || data?.error) { toast.error(data?.error || error?.message || 'Não foi possível remover'); return }
    void load()
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-medium">Equipe</h1>
          <p className="text-sm text-[var(--ink-500)] mt-0.5">Dona, recepção e profissionais com acesso ao sistema</p>
        </div>
        <Button className="btn-gold gap-2" onClick={() => setDialogOpen(true)}><Plus className="size-4" /> Convidar</Button>
      </div>

      {loading ? <div className="flex justify-center p-12"><Spinner className="text-[var(--gold)]" /></div> : members.length === 0 ? (
        <div className="luxury-card p-12 flex flex-col items-center text-center">
          <Users className="size-12 text-[var(--ink-300)] mb-3" />
          <p className="text-sm text-[var(--ink-500)]">Nenhum membro listado</p>
        </div>
      ) : (
        <div className="luxury-card divide-y divide-[var(--ink-200)]">
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 px-5 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{m.name || m.email}</p>
                <p className="text-xs text-[var(--ink-500)]">{m.email} · {roleLabel[m.role] || m.role}</p>
              </div>
              {m.role !== 'owner' && m.role !== 'admin' && (
                <Button variant="ghost" size="icon-sm" onClick={() => void remove(m.id)}><Trash2 className="size-3.5 text-[var(--danger)]" /></Button>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Convidar pessoa</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5"><Label>Nome</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>E-mail *</Label><Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></div>
            <div className="space-y-1.5">
              <Label>Papel</Label>
              <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="reception">Recepção</SelectItem>
                  <SelectItem value="professional">Profissional</SelectItem>
                  <SelectItem value="owner">Dona</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.role === 'professional' && (
              <div className="space-y-1.5">
                <Label>Vincular profissional</Label>
                <Select value={form.professional_id} onValueChange={(v) => setForm((f) => ({ ...f, professional_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Obrigatório" /></SelectTrigger>
                  <SelectContent>
                    {professionals.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button className="flex-1 btn-gold" onClick={() => void invite()} disabled={saving || !form.email || (form.role === 'professional' && !form.professional_id)}>{saving ? <Spinner className="size-4" /> : 'Enviar convite'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
