import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { postAuthPath } from '@/lib/auth-nav'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'

export function LoginPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error, profile: nextProfile } = await signIn(email, password)
    if (error) {
      setError('E-mail ou senha incorretos.')
      setLoading(false)
    } else {
      navigate(postAuthPath(nextProfile), { replace: true })
    }
  }

  return (
    <div className="min-h-screen bg-[var(--canvas)] flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full opacity-[0.04]" style={{ background: 'radial-gradient(circle, #D4AF37, transparent)' }} />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full opacity-[0.04]" style={{ background: 'radial-gradient(circle, #D4AF37, transparent)' }} />
      </div>

      <div className="w-full max-w-md relative">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl gold-gradient mb-4 gold-shadow">
            <span className="text-xl font-serif font-semibold">S</span>
          </div>
          <h1 className="text-3xl font-serif font-medium tracking-tight">
            Secretar<span className="gold-gradient-text">IA</span>
          </h1>
          <p className="text-xs text-[var(--ink-500)] mt-1 tracking-[0.15em] uppercase">Estética &amp; Beleza</p>
        </div>

        <div className="luxury-card p-8">
          <div className="mb-6">
            <h2 className="text-xl font-serif font-medium">Acesse sua conta</h2>
            <p className="text-sm text-[var(--ink-500)] mt-1">Bem-vinda de volta ao seu studio</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sm">E-mail</Label>
              <Input id="email" type="email" placeholder="seu@email.com" value={email} onChange={e => setEmail(e.target.value)} required className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-sm">Senha</Label>
              <Input id="password" type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required className="h-11" />
            </div>

            {error && <p className="text-sm text-[var(--danger)] bg-[var(--danger-50)] border border-[var(--danger-100)] rounded-lg px-3 py-2">{error}</p>}

            <Button type="submit" className="w-full h-11 btn-gold" disabled={loading}>
              {loading && <Spinner className="mr-2" />}
              {loading ? 'Entrando...' : 'Entrar'}
            </Button>
          </form>

          <div className="mt-5 text-right">
            <Link to="/recuperar-senha" className="text-xs text-[var(--ink-500)] hover:text-[var(--gold)]">Esqueceu a senha?</Link>
          </div>

          <div className="mt-4 pt-4 border-t border-[var(--ink-200)] text-center">
            <p className="text-sm text-[var(--ink-500)]">
              Não tem conta?{' '}
              <Link to="/cadastro" className="font-medium text-[var(--gold)]">Criar agora</Link>
            </p>
          </div>
        </div>

        <p className="text-center text-xs text-[var(--ink-400)] mt-6">© 2026 SecretarIA. Todos os direitos reservados.</p>
      </div>
    </div>
  )
}
