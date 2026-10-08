import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Shield } from 'lucide-react'

export function AdminPage() {
  const navigate = useNavigate()
  const { signIn, signOut } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setLoading(true)
    const { error, profile } = await signIn(email, password)
    if (error || !profile) { setError('Credenciais inválidas.'); setLoading(false); return }
    if (!profile.is_super_admin) { setError('Acesso negado. Apenas administradores da plataforma.'); await signOut(); setLoading(false); return }
    navigate('/admin/dashboard', { replace: true })
  }

  return (
    <div className="min-h-screen bg-[var(--ink-900)] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl gold-gradient mb-4 gold-shadow"><Shield className="size-6 text-[var(--ink-900)]" /></div>
          <h1 className="text-2xl font-serif font-medium text-white">Painel Administrativo</h1>
          <p className="text-sm text-white/40 mt-1">SecretarIA — Acesso restrito</p>
        </div>
        <div className="rounded-xl bg-[var(--ink-800)] border border-[var(--ink-700)] p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5"><Label className="text-white">E-mail</Label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} required className="h-11 bg-[var(--ink-700)] border-[var(--ink-600)] text-white" /></div>
            <div className="space-y-1.5"><Label className="text-white">Senha</Label><Input type="password" value={password} onChange={e => setPassword(e.target.value)} required className="h-11 bg-[var(--ink-700)] border-[var(--ink-600)] text-white" /></div>
            {error && <p className="text-sm text-[var(--danger)] bg-[var(--danger)]/10 rounded-lg px-3 py-2">{error}</p>}
            <Button type="submit" className="w-full h-11 btn-gold" disabled={loading}>{loading && <Spinner className="mr-2" />}{loading ? 'Entrando...' : 'Entrar'}</Button>
          </form>
        </div>
        <div className="text-center mt-4"><Link to="/login" className="text-xs text-white/40 hover:text-white/60">Voltar ao app</Link></div>
      </div>
    </div>
  )
}
