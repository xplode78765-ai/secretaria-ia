import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { CheckCircle2 } from 'lucide-react'

export function RecoverPasswordPage() {
  const { resetPassword } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [isRecovery, setIsRecovery] = useState(false)
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    const hash = window.location.hash
    const search = window.location.search
    if (hash.includes('type=recovery') || hash.includes('PASSWORD_RECOVERY') || search.includes('type=recovery')) {
      setIsRecovery(true)
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setIsRecovery(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await resetPassword(email)
    if (error) {
      setError('Não foi possível enviar o e-mail. Verifique o endereço.')
      setLoading(false)
    } else {
      setSent(true)
      setLoading(false)
    }
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (newPassword.length < 6) {
      setError('A senha deve ter no mínimo 6 caracteres.')
      return
    }
    setUpdating(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) {
      setError('Não foi possível atualizar a senha. Tente novamente.')
      setUpdating(false)
    } else {
      navigate('/app')
    }
  }

  return (
    <div className="min-h-screen bg-[var(--canvas)] flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full opacity-[0.04]" style={{ background: 'radial-gradient(circle, #D4AF37, transparent)' }} />
      </div>

      <div className="w-full max-w-md relative">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl gold-gradient mb-4 gold-shadow">
            <span className="text-xl font-serif font-semibold">S</span>
          </div>
          <h1 className="text-3xl font-serif font-medium tracking-tight">
            Secretar<span className="gold-gradient-text">IA</span>
          </h1>
        </div>

        <div className="luxury-card p-8">
          {isRecovery ? (
            <>
              <div className="mb-6">
                <h2 className="text-xl font-serif font-medium">Nova senha</h2>
                <p className="text-sm text-[var(--ink-500)] mt-1">Defina sua nova senha de acesso</p>
              </div>
              <form onSubmit={handleUpdate} className="space-y-5">
                <div className="space-y-1.5">
                  <Label className="text-sm">Nova senha</Label>
                  <Input type="password" placeholder="Mínimo 6 caracteres" value={newPassword} onChange={e => setNewPassword(e.target.value)} required className="h-11" />
                </div>
                {error && <p className="text-sm text-[var(--danger)] bg-[var(--danger-50)] border border-[var(--danger-100)] rounded-lg px-3 py-2">{error}</p>}
                <Button type="submit" className="w-full h-11 btn-gold" disabled={updating}>
                  {updating && <Spinner className="mr-2" />}
                  {updating ? 'Atualizando...' : 'Atualizar senha'}
                </Button>
              </form>
            </>
          ) : sent ? (
            <div className="text-center py-4">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[var(--success-50)] border border-[var(--success-100)] mb-4">
                <CheckCircle2 className="size-6 text-[var(--success)]" />
              </div>
              <h2 className="text-xl font-serif font-medium mb-2">E-mail enviado</h2>
              <p className="text-sm text-[var(--ink-500)] mb-6">Verifique sua caixa de entrada e siga o link para redefinir sua senha.</p>
              <Link to="/login">
                <Button variant="outline" className="w-full">Voltar para o login</Button>
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <h2 className="text-xl font-serif font-medium">Recuperar senha</h2>
                <p className="text-sm text-[var(--ink-500)] mt-1">Enviaremos um link de recuperação para seu e-mail</p>
              </div>
              <form onSubmit={handleRequest} className="space-y-5">
                <div className="space-y-1.5">
                  <Label className="text-sm">E-mail</Label>
                  <Input type="email" placeholder="seu@email.com" value={email} onChange={e => setEmail(e.target.value)} required className="h-11" />
                </div>
                {error && <p className="text-sm text-[var(--danger)] bg-[var(--danger-50)] border border-[var(--danger-100)] rounded-lg px-3 py-2">{error}</p>}
                <Button type="submit" className="w-full h-11 btn-gold" disabled={loading}>
                  {loading && <Spinner className="mr-2" />}
                  {loading ? 'Enviando...' : 'Enviar link de recuperação'}
                </Button>
              </form>
              <div className="mt-4 pt-4 border-t border-[var(--ink-200)] text-center">
                <Link to="/login" className="text-sm text-[var(--ink-500)] hover:text-[var(--gold)]">Voltar para o login</Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
