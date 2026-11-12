import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { postAuthPath } from '@/lib/auth-nav'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { useT } from '@/i18n'
import { LanguageToggle } from '@/components/LanguageToggle'

export function LoginPage() {
  const tc = useT('common')
  const t = useT('auth')
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const passwordUpdated = Boolean((location.state as { passwordUpdated?: boolean } | null)?.passwordUpdated)
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
      setError(t('loginError'))
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
        <div className="flex justify-end mb-4"><LanguageToggle /></div>
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl gold-gradient mb-4 gold-shadow">
            <span className="text-xl font-serif font-semibold">S</span>
          </div>
          <h1 className="text-3xl font-serif font-medium tracking-tight">
            Secretar<span className="gold-gradient-text">IA</span>
          </h1>
          <p className="text-xs text-[var(--ink-500)] mt-1 tracking-[0.15em] uppercase">{tc('tagline')}</p>
        </div>

        <div className="luxury-card p-8">
          <div className="mb-6">
            <h2 className="text-xl font-serif font-medium">{t('loginTitle')}</h2>
            <p className="text-sm text-[var(--ink-500)] mt-1">{t('loginSubtitle')}</p>
            {passwordUpdated && (
              <p className="text-sm text-[var(--success)] bg-[var(--success-50)] border border-[var(--success-100)] rounded-lg px-3 py-2 mt-3">
                {t('passwordUpdated')}
              </p>
            )}
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sm">{tc('email')}</Label>
              <Input id="email" type="email" placeholder={tc('emailPlaceholder')} value={email} onChange={e => setEmail(e.target.value)} required className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-sm">{tc('password')}</Label>
              <Input id="password" type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required className="h-11" />
            </div>

            {error && <p className="text-sm text-[var(--danger)] bg-[var(--danger-50)] border border-[var(--danger-100)] rounded-lg px-3 py-2">{error}</p>}

            <Button type="submit" className="w-full h-11 btn-gold" disabled={loading}>
              {loading && <Spinner className="mr-2" />}
              {loading ? t('signingIn') : t('signIn')}
            </Button>
          </form>

          <div className="mt-5 text-right">
            <Link to="/recuperar-senha" className="text-xs text-[var(--ink-500)] hover:text-[var(--gold)]">{t('forgot')}</Link>
          </div>

          <div className="mt-4 pt-4 border-t border-[var(--ink-200)] text-center">
            <p className="text-sm text-[var(--ink-500)]">
              {t('noAccount')}{' '}
              <Link to="/cadastro" className="font-medium text-[var(--gold)]">{t('createNow')}</Link>
            </p>
          </div>
        </div>

        <p className="text-center text-xs text-[var(--ink-400)] mt-6">{tc('rights')}</p>
      </div>
    </div>
  )
}
