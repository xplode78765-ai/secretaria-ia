import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { Client, Appointment, Payment } from '@/lib/supabase'
import { format } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import { ArrowLeft, Phone, Mail, CalendarDays, DollarSign, Edit, Save } from 'lucide-react'
import { toast } from 'sonner'

export function ClienteDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [client, setClient] = useState<Client | null>(null)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', whatsapp: '', email: '', notes: '', birthday: '', anamnesis: '' })
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (id) loadData(id) }, [id])

  const loadData = async (clientId: string) => {
    const [clientRes, aptsRes, paysRes] = await Promise.all([
      supabase.from('clients').select('*').eq('id', clientId).maybeSingle(),
      supabase.from('appointments').select('*').eq('client_id', clientId).order('start_time', { ascending: false }),
      supabase.from('payments').select('*').eq('client_id', clientId).order('created_at', { ascending: false }),
    ])
    setClient(clientRes.data as Client | null)
    setAppointments(aptsRes.data ?? [])
    setPayments(paysRes.data ?? [])
    if (clientRes.data) setForm({
      name: clientRes.data.name,
      phone: clientRes.data.phone,
      whatsapp: clientRes.data.whatsapp,
      email: clientRes.data.email,
      notes: clientRes.data.notes,
      birthday: clientRes.data.birthday || '',
      anamnesis: clientRes.data.anamnesis || '',
    })
    setLoading(false)
  }

  const saveEdit = async () => {
    setSaving(true)
    if (id) {
      const { error } = await supabase.from('clients').update({ ...form, birthday: form.birthday || null }).eq('id', id)
      if (error) { toast.error(error.message); setSaving(false); return }
      toast.success('Ficha atualizada')
      loadData(id)
      setEditing(false)
    }
    setSaving(false)
  }

  const uploadPhoto = async (file: File) => {
    if (!id || !client) return
    setUploading(true)
    const path = `${client.studio_id}/${id}-${Date.now()}`
    const { error } = await supabase.storage.from('client-photos').upload(path, file, { upsert: true })
    if (error) { toast.error(error.message); setUploading(false); return }
    const { data } = supabase.storage.from('client-photos').getPublicUrl(path)
    await supabase.from('clients').update({ photo_url: data.publicUrl }).eq('id', id)
    setUploading(false)
    loadData(id)
  }

  const statusBadge: Record<string, string> = {
    pending: 'bg-[var(--warning-50)] text-[var(--warning-700)]',
    confirmed: 'bg-[var(--success-50)] text-[var(--success-700)]',
    done: 'bg-blue-50 text-blue-700',
    cancelled: 'bg-[var(--danger-50)] text-[var(--danger-700)]',
  }

  if (loading) return <div className="flex justify-center p-12"><Spinner className="text-[var(--gold)]" /></div>
  if (!client) return <div className="p-6 text-center text-[var(--ink-500)]">Cliente não encontrado</div>

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={() => navigate('/app/clientes')}><ArrowLeft className="size-4" /></Button>
        <h1 className="text-2xl font-serif font-medium">Ficha do Cliente</h1>
      </div>

      <div className="luxury-card p-6">
        <div className="flex items-start gap-4">
          {client.photo_url ? (
            <img src={client.photo_url} alt="" className="w-16 h-16 rounded-full object-cover flex-shrink-0" />
          ) : (
            <div className="w-16 h-16 rounded-full gold-gradient flex items-center justify-center text-xl font-medium flex-shrink-0">{client.name.slice(0, 1).toUpperCase()}</div>
          )}
          <div className="flex-1">
            {editing ? (
              <div className="space-y-3">
                <div className="space-y-1"><Label className="text-xs">Nome</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1"><Label className="text-xs">Telefone</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
                  <div className="space-y-1"><Label className="text-xs">WhatsApp</Label><Input value={form.whatsapp} onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))} /></div>
                </div>
                <div className="space-y-1"><Label className="text-xs">E-mail</Label><Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
                <div className="space-y-1"><Label className="text-xs">Aniversário</Label><Input type="date" value={form.birthday} onChange={e => setForm(f => ({ ...f, birthday: e.target.value }))} /></div>
                <div className="space-y-1"><Label className="text-xs">Foto</Label><Input type="file" accept="image/*" disabled={uploading} onChange={e => { const f = e.target.files?.[0]; if (f) void uploadPhoto(f) }} /></div>
                <div className="space-y-1"><Label className="text-xs">Anamnese</Label><Textarea value={form.anamnesis} onChange={e => setForm(f => ({ ...f, anamnesis: e.target.value }))} rows={4} /></div>
                <div className="space-y-1"><Label className="text-xs">Observações</Label><Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
                <div className="flex gap-2"><Button className="btn-gold gap-2" onClick={saveEdit} disabled={saving}><Save className="size-3.5" />Salvar</Button><Button variant="outline" onClick={() => setEditing(false)}>Cancelar</Button></div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-2">
                  <h2 className="text-xl font-serif font-medium">{client.name}</h2>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${client.status === 'active' ? 'bg-[var(--success-50)] text-[var(--success-700)]' : 'bg-[var(--ink-100)] text-[var(--ink-500)]'}`}>{client.status === 'active' ? 'Ativo' : 'Inativo'}</span>
                  <Button variant="ghost" size="icon-sm" onClick={() => setEditing(true)}><Edit className="size-3.5" /></Button>
                </div>
                <div className="space-y-1 text-sm text-[var(--ink-600)]">
                  {client.phone && <p className="flex items-center gap-2"><Phone className="size-3.5 text-[var(--ink-400)]" />{client.phone}</p>}
                  {client.email && <p className="flex items-center gap-2"><Mail className="size-3.5 text-[var(--ink-400)]" />{client.email}</p>}
                  {client.birthday && <p className="text-sm text-[var(--ink-500)]">Aniversário: {format(new Date(client.birthday + 'T12:00:00'), 'dd/MM')}</p>}
                  {client.anamnesis && <p className="mt-2 text-sm whitespace-pre-wrap">{client.anamnesis}</p>}
                  {client.notes && <p className="mt-2 text-[var(--ink-500)] italic">{client.notes}</p>}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="luxury-card">
          <div className="px-6 py-4 border-b border-[var(--ink-200)] flex items-center gap-2"><CalendarDays className="size-4 text-[var(--gold)]" /><h3 className="font-serif font-medium">Histórico de Agendamentos</h3></div>
          <div className="p-4 space-y-2 max-h-64 overflow-y-auto">
            {appointments.length === 0 ? <p className="text-sm text-[var(--ink-500)] text-center py-4">Nenhum agendamento</p> : appointments.map(apt => (
              <div key={apt.id} className="flex items-center gap-3 p-2 rounded-lg border border-[var(--ink-200)]">
                <div className="text-center min-w-[2.5rem]"><p className="text-xs font-bold">{format(new Date(apt.start_time), 'dd/MM')}</p><p className="text-[10px] text-[var(--ink-500)]">{format(new Date(apt.start_time), 'HH:mm')}</p></div>
                <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{apt.title}</p></div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${statusBadge[apt.status] ?? ''}`}>{apt.status}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="luxury-card">
          <div className="px-6 py-4 border-b border-[var(--ink-200)] flex items-center gap-2"><DollarSign className="size-4 text-[var(--gold)]" /><h3 className="font-serif font-medium">Pagamentos</h3></div>
          <div className="p-4 space-y-2 max-h-64 overflow-y-auto">
            {payments.length === 0 ? <p className="text-sm text-[var(--ink-500)] text-center py-4">Nenhum pagamento</p> : payments.map(pay => (
              <div key={pay.id} className="flex items-center gap-3 p-2 rounded-lg border border-[var(--ink-200)]">
                <div className="flex-1"><p className="text-sm font-medium">R$ {pay.amount.toFixed(2)}</p><p className="text-xs text-[var(--ink-500)]">{pay.method || 'Sem método'}</p></div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${pay.status === 'paid' ? 'bg-[var(--success-50)] text-[var(--success-700)]' : 'bg-[var(--warning-50)] text-[var(--warning-700)]'}`}>{pay.status === 'paid' ? 'Pago' : 'Pendente'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
