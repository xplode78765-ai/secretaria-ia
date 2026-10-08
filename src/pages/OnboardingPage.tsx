import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'
import { CheckCircle2, Store, Bot, Phone, ArrowRight } from 'lucide-react'

export function OnboardingPage() {
  const { profile, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [studioData, setStudioData] = useState({
    name: '', phone: '', address: '', whatsapp_number: '', instagram: '',
  })
  const [procedures, setProcedures] = useState([{ name: '', price: '', duration: '60' }])

  const steps = [
    { icon: Store, title: 'Dados do Studio', desc: 'Conte-nos sobre seu estúdio' },
    { icon: Phone, title: 'WhatsApp', desc: 'Conecte seu WhatsApp' },
    { icon: Bot, title: 'SecretarIA', desc: 'Configure sua IA' },
  ]

  const saveStudio = async () => {
    if (!profile?.studio_id) {
      toast.error('Erro: estúdio não encontrado. Recarregue a página e tente novamente.')
      return
    }
    setLoading(true)
    try {
      const { error: updateError } = await supabase.from('studios').update({
        name: studioData.name, phone: studioData.phone, address: studioData.address,
        whatsapp_number: studioData.whatsapp_number, instagram: studioData.instagram,
        onboarding_completed: true,
      }).eq('id', profile.studio_id)

      if (updateError) {
        toast.error('Erro ao salvar dados do estúdio: ' + updateError.message)
        return
      }

      for (const proc of procedures.filter(p => p.name)) {
        const { error: procError } = await supabase.from('procedures').insert({
          studio_id: profile.studio_id,
          name: proc.name,
          price: parseFloat(proc.price) || 0,
          duration: parseInt(proc.duration) || 60,
        })
        if (procError) {
          console.error('Erro ao salvar procedimento:', procError.message)
        }
      }

      await refreshProfile()
      toast.success('Configuração concluída com sucesso!')
      navigate('/app', { replace: true })
    } catch (err) {
      toast.error('Erro inesperado: ' + (err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const addProcedure = () => setProcedures([...procedures, { name: '', price: '', duration: '60' }])

  return (
    <div className="min-h-screen bg-[var(--canvas-subtle)] flex flex-col">
      {/* Header */}
      <header className="border-b border-[var(--ink-200)] bg-[var(--canvas)] px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg gold-gradient flex items-center justify-center">
            <span className="text-sm font-serif font-semibold">S</span>
          </div>
          <span className="font-serif text-lg font-medium">SecretarIA</span>
          <span className="ml-auto text-sm text-[var(--ink-500)]">Configuração inicial</span>
        </div>
      </header>

      {/* Progress */}
      <div className="max-w-3xl mx-auto w-full px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center flex-1">
              <div className={`flex items-center gap-2 ${i <= step ? 'text-[var(--gold)]' : 'text-[var(--ink-400)]'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${i < step ? 'bg-[var(--gold)] text-[var(--ink-900)]' : i === step ? 'gold-border border' : 'border border-[var(--ink-200)]'}`}>
                  {i < step ? <CheckCircle2 className="size-4" /> : i + 1}
                </div>
                <span className="text-sm font-medium hidden sm:block">{s.title}</span>
              </div>
              {i < steps.length - 1 && <div className={`flex-1 h-px mx-2 ${i < step ? 'bg-[var(--gold)]' : 'bg-[var(--ink-200)]'}`} />}
            </div>
          ))}
        </div>

        <div className="luxury-card p-8">
          {step === 0 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-serif font-medium mb-1">Dados do Studio</h2>
                <p className="text-sm text-[var(--ink-500)]">Estas informações aparecem para seus clientes</p>
              </div>
              <div className="space-y-1.5">
                <Label>Nome do estúdio</Label>
                <Input value={studioData.name} onChange={e => setStudioData({ ...studioData, name: e.target.value })} placeholder="Studio Beauté Gold" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Telefone</Label>
                  <Input value={studioData.phone} onChange={e => setStudioData({ ...studioData, phone: e.target.value })} placeholder="(11) 99999-9999" />
                </div>
                <div className="space-y-1.5">
                  <Label>WhatsApp</Label>
                  <Input value={studioData.whatsapp_number} onChange={e => setStudioData({ ...studioData, whatsapp_number: e.target.value })} placeholder="5511999999999" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Endereço</Label>
                <Input value={studioData.address} onChange={e => setStudioData({ ...studioData, address: e.target.value })} placeholder="Rua das Flores, 123" />
              </div>
              <div className="space-y-1.5">
                <Label>Instagram</Label>
                <Input value={studioData.instagram} onChange={e => setStudioData({ ...studioData, instagram: e.target.value })} placeholder="@studio" />
              </div>

              <div className="pt-4 border-t border-[var(--ink-200)]">
                <h3 className="text-sm font-medium mb-3">Procedimentos iniciais</h3>
                {procedures.map((p, i) => (
                  <div key={i} className="grid grid-cols-3 gap-2 mb-2">
                    <Input placeholder="Nome" value={p.name} onChange={e => { const n = [...procedures]; n[i].name = e.target.value; setProcedures(n) }} />
                    <Input type="number" placeholder="Preço" value={p.price} onChange={e => { const n = [...procedures]; n[i].price = e.target.value; setProcedures(n) }} />
                    <Input type="number" placeholder="Min" value={p.duration} onChange={e => { const n = [...procedures]; n[i].duration = e.target.value; setProcedures(n) }} />
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addProcedure} className="mt-2">+ Adicionar procedimento</Button>
              </div>

              <div className="flex justify-end pt-4">
                <Button className="btn-gold gap-2" onClick={() => setStep(1)} disabled={!studioData.name}>
                  Continuar <ArrowRight className="size-4" />
                </Button>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-serif font-medium mb-1">Conectar WhatsApp</h2>
                <p className="text-sm text-[var(--ink-500)]">Conecte seu número para a SecretarIA atender automaticamente</p>
              </div>
              <div className="rounded-lg border border-dashed border-[var(--gold-200)] bg-[var(--gold-50)] p-6 text-center">
                <Phone className="size-8 mx-auto mb-3 text-[var(--gold)]" />
                <p className="text-sm font-medium mb-1">Conexão em um clique</p>
                <p className="text-xs text-[var(--ink-500)] mb-4">Você pode conectar agora ou pular e fazer depois em Configurações</p>
                <Button variant="outline" className="border-[var(--gold)] text-[var(--gold)]" onClick={() => setStep(2)}>Conectar depois</Button>
              </div>
              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={() => setStep(0)}>Voltar</Button>
                <Button className="btn-gold gap-2" onClick={() => setStep(2)}>
                  Pular e continuar <ArrowRight className="size-4" />
                </Button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-serif font-medium mb-1">Configurar SecretarIA</h2>
                <p className="text-sm text-[var(--ink-500)]">Sua IA já vem pré-configurada com respostas padrão. Você pode personalizar depois.</p>
              </div>
              <div className="rounded-lg border border-[var(--ink-200)] p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-[var(--success)]" />
                  <span className="text-sm">Saudação automática ativada</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-[var(--success)]" />
                  <span className="text-sm">Respostas de preço e agendamento</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-[var(--success)]" />
                  <span className="text-sm">Horário de funcionamento</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-[var(--success)]" />
                  <span className="text-sm">Resposta padrão (fallback)</span>
                </div>
              </div>
              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={() => setStep(1)}>Voltar</Button>
                <Button className="btn-gold gap-2" onClick={saveStudio} disabled={loading}>
                  {loading && <Spinner className="mr-2" />}
                  Finalizar e entrar <ArrowRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
