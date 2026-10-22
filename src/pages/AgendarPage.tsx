import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'

type PublicStudio = { name: string; address: string; phone: string; instagram: string }
type PublicProc = { id: string; name: string; price: number; duration: number }

export function AgendarPage() {
  const { slug } = useParams()
  const [studio, setStudio] = useState<PublicStudio | null>(null)
  const [procedures, setProcedures] = useState<PublicProc[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', procedure_id: '', start_time: '' })

  useEffect(() => {
    const run = async () => {
      const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/public-booking?slug=${encodeURIComponent(slug || '')}`
      const res = await fetch(url, { headers: { apikey: anon, Authorization: `Bearer ${anon}` } })
      const json = await res.json()
      if (!res.ok) { toast.error(json.error || 'Studio não encontrado'); setLoading(false); return }
      setStudio(json.studio)
      setProcedures(json.procedures || [])
      setLoading(false)
    }
    void run()
  }, [slug])

  const submit = async () => {
    setSaving(true)
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/public-booking?slug=${encodeURIComponent(slug || '')}`
    const startIso = form.start_time.length === 16 ? `${form.start_time}:00` : form.start_time
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` },
      body: JSON.stringify({ ...form, start_time: startIso, slug }),
    })
    const json = await res.json()
    setSaving(false)
    if (!res.ok) { toast.error(json.error || 'Não foi possível agendar'); return }
    toast.success('Pedido enviado')
    setDone(true)
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Spinner className="text-[var(--gold)]" /></div>
  if (!studio) return <div className="min-h-screen flex items-center justify-center text-sm text-[var(--ink-500)]">Link inválido</div>

  return (
    <div className="min-h-screen bg-[var(--canvas)] flex items-center justify-center p-6">
      <div className="luxury-card w-full max-w-md p-6 space-y-5">
        <div>
          <p className="text-[10px] tracking-[0.2em] uppercase text-[var(--ink-400)]">Agendar</p>
          <h1 className="text-2xl font-serif font-medium">{studio.name}</h1>
          {studio.address && <p className="text-sm text-[var(--ink-500)] mt-1">{studio.address}</p>}
        </div>
        {done ? (
          <p className="text-sm text-[var(--success-700)]">Pedido enviado! O studio confirma em breve pelo WhatsApp.</p>
        ) : (
          <>
            <div className="space-y-1.5"><Label>Seu nome *</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>WhatsApp *</Label><Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="11999999999" /></div>
            <div className="space-y-1.5">
              <Label>Procedimento</Label>
              <Select value={form.procedure_id} onValueChange={(v) => setForm((f) => ({ ...f, procedure_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Escolha" /></SelectTrigger>
                <SelectContent>
                  {procedures.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name} · R$ {Number(p.price).toFixed(0)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Data e hora *</Label>
              <Input type="datetime-local" value={form.start_time} onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))} />
            </div>
            <Button className="w-full btn-gold" disabled={saving || !form.name || !form.phone || !form.start_time} onClick={() => void submit()}>
              {saving ? <Spinner className="size-4" /> : 'Pedir horário'}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
