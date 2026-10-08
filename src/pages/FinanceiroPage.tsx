import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import type { Payment, Client } from '@/lib/supabase'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Plus, DollarSign, Trash2, CheckCircle2, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'

export function FinanceiroPage() {
  const { profile } = useAuth()
  const [payments, setPayments] = useState<(Payment & { clients: Pick<Client, 'name'> | null })[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState({ client_id: '', amount: '', status: 'pending', method: 'pix', due_date: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    const [payRes, clientRes] = await Promise.all([
      supabase.from('payments').select('*, clients(name)').order('created_at', { ascending: false }),
      supabase.from('clients').select('*').order('name'),
    ])
    setPayments((payRes.data ?? []) as (Payment & { clients: Pick<Client, 'name'> | null })[])
    setClients(clientRes.data ?? [])
    setLoading(false)
  }

  const save = async () => {
    if (!profile?.studio_id) { toast.error('Studio não encontrado'); return }
    setSaving(true)
    const { error } = await supabase.from('payments').insert({ studio_id: profile.studio_id, client_id: form.client_id || null, amount: parseFloat(form.amount) || 0, status: form.status, method: form.method, due_date: form.due_date || null })
    if (error) { toast.error('Erro ao salvar: ' + error.message); setSaving(false); return }
    setDialogOpen(false); setSaving(false); setForm({ client_id: '', amount: '', status: 'pending', method: 'pix', due_date: '' }); loadData()
  }

  const markPaid = async (p: Payment) => { await supabase.from('payments').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', p.id); loadData() }
  const del = async (id: string) => { await supabase.from('payments').delete().eq('id', id); loadData() }

  const totalPaid = payments.filter(p => p.status === 'paid').reduce((acc, p) => acc + p.amount, 0)
  const totalPending = payments.filter(p => p.status === 'pending').reduce((acc, p) => acc + p.amount, 0)

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-serif font-medium">Financeiro</h1><p className="text-sm text-[var(--ink-500)] mt-0.5">Controle de pagamentos</p></div>
        <Button className="btn-gold gap-2" onClick={() => setDialogOpen(true)}><Plus className="size-4" /> Novo Pagamento</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="luxury-card p-5"><div className="flex items-center justify-between mb-2"><p className="text-sm text-[var(--ink-500)]">Recebido</p><CheckCircle2 className="size-4 text-[var(--success)]" /></div><p className="text-2xl font-serif font-medium text-[var(--success-700)]">R$ {totalPaid.toFixed(2)}</p></div>
        <div className="luxury-card p-5"><div className="flex items-center justify-between mb-2"><p className="text-sm text-[var(--ink-500)]">Pendente</p><Clock className="size-4 text-[var(--warning)]" /></div><p className="text-2xl font-serif font-medium text-[var(--warning-700)]">R$ {totalPending.toFixed(2)}</p></div>
        <div className="luxury-card p-5"><div className="flex items-center justify-between mb-2"><p className="text-sm text-[var(--ink-500)]">Total</p><DollarSign className="size-4 text-[var(--gold)]" /></div><p className="text-2xl font-serif font-medium gold-gradient-text">R$ {(totalPaid + totalPending).toFixed(2)}</p></div>
      </div>

      {loading ? <div className="flex justify-center p-12"><Spinner className="text-[var(--gold)]" /></div> : (
        <div className="luxury-card overflow-hidden">
          <div className="px-6 py-4 border-b border-[var(--ink-200)]"><h2 className="font-serif font-medium text-lg">Transações</h2></div>
          <div className="divide-y divide-[var(--ink-200)]">
            {payments.length === 0 ? <p className="text-sm text-[var(--ink-500)] text-center py-8">Nenhum pagamento registrado</p> : payments.map(p => (
              <div key={p.id} className="flex items-center gap-3 px-6 py-3 hover:bg-[var(--ink-100)]/50">
                <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{p.clients?.name ?? 'Sem cliente'}</p><p className="text-xs text-[var(--ink-500)]">{p.method} · {format(new Date(p.created_at), 'dd/MM/yyyy', { locale: ptBR })}</p></div>
                <span className="text-sm font-medium">R$ {p.amount.toFixed(2)}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${p.status === 'paid' ? 'bg-[var(--success-50)] text-[var(--success-700)]' : 'bg-[var(--warning-50)] text-[var(--warning-700)]'}`}>{p.status === 'paid' ? 'Pago' : 'Pendente'}</span>
                {p.status === 'pending' && <Button variant="ghost" size="sm" onClick={() => markPaid(p)} className="text-xs">Marcar pago</Button>}
                <Button variant="ghost" size="icon-sm" onClick={() => del(p.id)}><Trash2 className="size-3.5 text-[var(--danger)]" /></Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Novo Pagamento</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5"><Label>Cliente</Label><Select value={form.client_id} onValueChange={v => setForm(f => ({ ...f, client_id: v }))}><SelectTrigger><SelectValue placeholder="Selecionar cliente" /></SelectTrigger><SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Valor (R$) *</Label><Input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0,00" /></div>
              <div className="space-y-1.5"><Label>Status</Label><Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pending">Pendente</SelectItem><SelectItem value="paid">Pago</SelectItem></SelectContent></Select></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Método</Label><Select value={form.method} onValueChange={v => setForm(f => ({ ...f, method: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pix">PIX</SelectItem><SelectItem value="cash">Dinheiro</SelectItem><SelectItem value="card">Cartão</SelectItem><SelectItem value="transfer">Transferência</SelectItem></SelectContent></Select></div>
              <div className="space-y-1.5"><Label>Vencimento</Label><Input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} /></div>
            </div>
            <div className="flex gap-2 pt-2"><Button variant="outline" className="flex-1" onClick={() => setDialogOpen(false)}>Cancelar</Button><Button className="flex-1 btn-gold" onClick={save} disabled={saving || !form.amount}>{saving ? <Spinner className="size-4" /> : 'Salvar'}</Button></div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
