import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useT } from '@/i18n'
import { LanguageToggle } from '@/components/LanguageToggle'

export function SemStudioPage() {
  const tc = useT('common')
  const t = useT('auth')
  const { user, profile, loading, signOut } = useAuth()
  const navigate = useNavigate()
  if (loading) return <div className="min-h-screen flex items-center justify-center"><Spinner className="text-[var(--gold)]" /></div>
  if (!user) return <Navigate to="/login" replace />
  if (profile?.studio_id && profile.role !== 'removed') return <Navigate to="/app" replace />
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="luxury-card max-w-md p-8 space-y-4 text-center">
        <div className="flex justify-end"><LanguageToggle /></div>
        <h1 className="text-2xl font-serif">{t('noStudioTitle')}</h1>
        <p className="text-sm text-[var(--ink-500)]">
          {t('noStudioText')}
        </p>
        <Button className="btn-gold" onClick={async () => { await signOut(); navigate('/login') }}>{tc('signOut')}</Button>
      </div>
    </div>
  )
}
