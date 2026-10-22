import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

export function SemStudioPage() {
  const { user, profile, loading, signOut } = useAuth()
  const navigate = useNavigate()
  if (loading) return <div className="min-h-screen flex items-center justify-center"><Spinner className="text-[var(--gold)]" /></div>
  if (!user) return <Navigate to="/login" replace />
  if (profile?.studio_id && profile.role !== 'removed') return <Navigate to="/app" replace />
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="luxury-card max-w-md p-8 space-y-4 text-center">
        <h1 className="text-2xl font-serif">Sem studio</h1>
        <p className="text-sm text-[var(--ink-500)]">
          Esta conta não está ligada a um studio. Peça um novo convite para a dona ou entre com outro e-mail.
        </p>
        <Button className="btn-gold" onClick={async () => { await signOut(); navigate('/login') }}>Sair</Button>
      </div>
    </div>
  )
}
