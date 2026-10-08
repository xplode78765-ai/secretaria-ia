import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Studio } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Store, Save, Phone, MapPin, Clock, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'

export function StudioPage() {
  const { profile } = useAuth()
  const [studio, setStudio] = useState<Studio | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', address: '', whatsapp_number: '', instagram: '' })

  useEffect(() => { loadStudio() }, [])

  const loadStudio = async () => {
    if (profile?.studio_id) {
      const { data } = await supabase.from('studios').select('*').eq('id', profile.studio_id).maybeSingle()
      if (data) { setStudio(data as Studio); setForm({ name: data.name, phone: data.phone, address: data.address, whatsapp_number: data.whatsapp_number, instagram: data.instagram }) }
    }
    setLoading(false)
  }

  const save = async () => {
    setSaving(true)
    if (profile?.studio_id) await supabase.from('studios').update(form).eq('id', profile.studio_id)
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 3000)
  }

  if (loading) return <div className="flex justify-center p-12"><Spinner className="text-[var(--gold)]" /></div>

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div><h1 className="text-2xl font-serif font-medium flex items-center gap-2"><Store className="size-6 text-[var(--gold)]" />Studio</h1><p className="text-sm text-[var(--ink-500)] mt-0.5">Dados do seu estabelecimento</p></div>

      <div className="luxury-card p-6">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-xl gold-gradient flex items-center justify-center text-2xl font-serif font-medium gold-shadow">{(form.name || 'S').slice(0, 1).toUpperCase()}</div>
          <div><h2 className="text-lg font-serif font-medium">{form.name || 'Seu Studio'}</h2><p className="text-sm text-[var(--ink-500)]">{studio?.email}</p></div>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5"><Label>Nome do Estúdio</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Studio Beauté Gold" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label className="flex items-center gap-1.5"><Phone className="size-3.5" />Telefone</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="(11) 99999-9999" /></div>
            <div className="space-y-1.5"><Label className="flex items-center gap-1.5"><Clock className="size-3.5" />WhatsApp</Label><Input value={form.whatsapp_number} onChange={e => setForm(f => ({ ...f, whatsapp_number: e.target.value }))} placeholder="5511999999999" /></div>
          </div>
          <div className="space-y-1.5"><Label className="flex items-center gap-1.5"><MapPin className="size-3.5" />Endereço</Label><Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Rua das Flores, 123" /></div>
          <div className="space-y-1.5"><Label className="flex items-center gap-1.5"><Clock className="size-3.5" />Instagram</Label><Input value={form.instagram} onChange={e => setForm(f => ({ ...f, instagram: e.target.value }))} placeholder="@studio" /></div>

          <Button className="btn-gold gap-2" onClick={save} disabled={saving}>{saving ? <Spinner className="size-4" /> : saved ? <CheckCircle2 className="size-4" /> : <Save className="size-4" />}{saving ? 'Salvando...' : saved ? 'Salvo!' : 'Salvar alterações'}</Button>
        </div>
      </div>
    </div>
  )
}
