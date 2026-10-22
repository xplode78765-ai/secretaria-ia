import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import type { Client } from '@/lib/supabase'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Plus, Search, Users, Phone, Mail, MoreVertical, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'

export function ClientesPage() {
  const { profile } = useAuth()
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', whatsapp: '', email: '', status: 'active', notes: '', source: 'manual', birthday: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadClients() }, [])

  const loadClients = async () => {
    const { data } = await supabase.from('clients').select('*').order('created_at', { ascending: false })
    setClients(data ?? [])
    setLoading(false)
  }

  const saveClient = async () => {
    if (!profile?.studio_id) { toast.error('Studio não encontrado'); return }
    setSaving(true)
    const { error } = await supabase.from('clients').insert({ ...form, birthday: form.birthday || null, studio_id: profile.studio_id })
    if (error) { toast.error('Erro ao salvar cliente: ' + error.message); setSaving(false); return }
    setDialogOpen(false); setSaving(false); setForm({ name: '', phone: '', whatsapp: '', email: '', status: 'active', notes: '', source: 'manual', birthday: '' })
    toast.success('Cliente cadastrado!')
    loadClients()
  }

  const deleteClient = async (id: string) => { await supabase.from('clients').delete().eq('id', id); loadClients() }

  const filtered = clients.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search))

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-serif font-medium">Clientes</h1><p className="text-sm text-[var(--ink-500)] mt-0.5">{clients.length} cadastrados</p></div>
        <Button className="btn-gold gap-2" onClick={() => setDialogOpen(true)}><Plus className="size-4" /> Novo Cliente</Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-[var(--ink-400)]" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nome ou telefone..." className="pl-9" />
      </div>

      {loading ? <div className="flex justify-center p-12"><Spinner className="text-[var(--gold)]" /></div> : filtered.length === 0 ? (
        <div className="luxury-card p-12 flex flex-col items-center text-center">
          <Users className="size-12 text-[var(--ink-300)] mb-3" />
          <p className="text-sm font-medium text-[var(--ink-500)]">Nenhum cliente encontrado</p>
          <p className="text-xs text-[var(--ink-400)] mt-1">Cadastre seu primeiro cliente</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(c => (
            <Link key={c.id} to={`/app/clientes/${c.id}`}>
              <div className="luxury-card p-4 group cursor-pointer">
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-full gold-gradient flex items-center justify-center text-sm font-medium flex-shrink-0">{c.name.slice(0, 1).toUpperCase()}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{c.name}</p>
                    <p className="text-xs text-[var(--ink-500)] flex items-center gap-1 mt-0.5"><Phone className="size-3" />{c.phone || 'Sem telefone'}</p>
                    {c.email && <p className="text-xs text-[var(--ink-500)] flex items-center gap-1 mt-0.5"><Mail className="size-3" />{c.email}</p>}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" onClick={e => e.preventDefault()}><MoreVertical className="size-3.5" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem variant="destructive" onClick={(e) => { e.preventDefault(); deleteClient(c.id) }}><Trash2 className="size-3.5" />Excluir</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[var(--ink-200)]">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${c.status === 'active' ? 'bg-[var(--success-50)] text-[var(--success-700)]' : 'bg-[var(--ink-100)] text-[var(--ink-500)]'}`}>{c.status === 'active' ? 'Ativo' : 'Inativo'}</span>
                  <span className="text-xs text-[var(--ink-400)] ml-auto">{format(new Date(c.created_at), 'dd/MM/yyyy', { locale: ptBR })}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Novo Cliente</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5"><Label>Nome *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Nome completo" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Telefone</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="(11) 99999-9999" /></div>
              <div className="space-y-1.5"><Label>WhatsApp</Label><Input value={form.whatsapp} onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))} placeholder="5511999999999" /></div>
            </div>
            <div className="space-y-1.5"><Label>E-mail</Label><Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="email@exemplo.com" /></div>
            <div className="space-y-1.5"><Label>Aniversário</Label><Input type="date" value={form.birthday} onChange={e => setForm(f => ({ ...f, birthday: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Status</Label><Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Ativo</SelectItem><SelectItem value="inactive">Inativo</SelectItem></SelectContent></Select></div>
            <div className="space-y-1.5"><Label>Observações</Label><Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
            <div className="flex gap-2 pt-2"><Button variant="outline" className="flex-1" onClick={() => setDialogOpen(false)}>Cancelar</Button><Button className="flex-1 btn-gold" onClick={saveClient} disabled={saving || !form.name}>{saving ? <Spinner className="size-4" /> : 'Salvar'}</Button></div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
