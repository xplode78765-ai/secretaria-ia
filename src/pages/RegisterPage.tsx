import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'
import { useT } from '@/i18n'
import { LanguageToggle } from '@/components/LanguageToggle'

export function RegisterPage() {
  const tc = useT('common')
  const t = useT('auth')
  const { signUp } = useAuth()
  const navigate = useNavigate()
  const [studioName, setStudioName] = useState('')
  const [userName, setUserName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const ts = useT('sales')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!accepted) {
      setError(ts('mustAccept'))
      return
    }
    if (password.length < 8) {
      setError(tc('passwordMin8'))
      return
    }
    setLoading(true)
    const { error, needsEmailConfirmation } = await signUp(email, password, studioName, userName)
    if (error) {
      const msg = error.includes('already') ? t('emailTaken') : error
      setError(msg)
      toast.error(msg)
      setLoading(false)
    } else if (needsEmailConfirmation) {
      toast.success(t('createdConfirm'))
      setError(t('confirmSent'))
      setLoading(false)
    } else {
      toast.success(t('createdOk'))
      navigate('/onboarding', { replace: true })
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
            <h2 className="text-xl font-serif font-medium">{t('registerTitle')}</h2>
            <p className="text-sm text-[var(--ink-500)] mt-1">{t('registerSubtitle')}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label className="text-sm">{t('studioName')}</Label>
              <Input type="text" placeholder={t('studioNamePh')} value={studioName} onChange={e => setStudioName(e.target.value)} required className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">{t('yourName')}</Label>
              <Input type="text" placeholder={t('yourNamePh')} value={userName} onChange={e => setUserName(e.target.value)} required className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">{tc('email')}</Label>
              <Input type="email" placeholder={tc('emailPlaceholder')} value={email} onChange={e => setEmail(e.target.value)} required className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">{tc('password')}</Label>
              <Input type="password" placeholder={tc('min8')} value={password} onChange={e => setPassword(e.target.value)} required className="h-11" />
            </div>

            <label className="flex items-start gap-2 text-xs text-[var(--ink-600)]">
              <input type="checkbox" className="mt-0.5" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
              <span>
                {ts('acceptTerms')}{' '}
                <Link to="/termos" target="_blank" className="text-[var(--gold)] underline">{ts('terms')}</Link>{' '}
                {ts('and')}{' '}
                <Link to="/privacidade" target="_blank" className="text-[var(--gold)] underline">{ts('privacy')}</Link>.
              </span>
            </label>

            {error && <p className="text-sm text-[var(--danger)] bg-[var(--danger-50)] border border-[var(--danger-100)] rounded-lg px-3 py-2">{error}</p>}

            <Button type="submit" className="w-full h-11 btn-gold" disabled={loading}>
              {loading && <Spinner className="mr-2" />}
              {loading ? t('creating') : t('createFree')}
            </Button>
          </form>

          <div className="mt-4 pt-4 border-t border-[var(--ink-200)] text-center">
            <p className="text-sm text-[var(--ink-500)]">
              {t('haveAccount')}{' '}
              <Link to="/login" className="font-medium text-[var(--gold)]">{t('signIn')}</Link>
            </p>
          </div>
        </div>

        <p className="text-center text-xs text-[var(--ink-400)] mt-6">{tc('rights')}</p>
      </div>
    </div>
  )
}
