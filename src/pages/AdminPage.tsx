import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Shield } from 'lucide-react'
import { useT } from '@/i18n'
import { LanguageToggle } from '@/components/LanguageToggle'

// Platform admin login. After the password, a second factor (TOTP app such as
// Google Authenticator) is REQUIRED: admin-panel and mailer refuse sessions
// without it (aal2). The first time, the admin enrolls the app with a QR code.
type Step = 'password' | 'enroll' | 'verify'

export function AdminPage() {
  const tc = useT('common')
  const t = useT('auth')
  const navigate = useNavigate()
  const { signIn, signOut } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState<Step>('password')
  const [factorId, setFactorId] = useState('')
  const [qr, setQr] = useState('')
  const [secret, setSecret] = useState('')
  const [code, setCode] = useState('')

  const startSecondFactor = async () => {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (aal?.currentLevel === 'aal2') { navigate('/admin/dashboard', { replace: true }); return }
    const { data: factors, error: listError } = await supabase.auth.mfa.listFactors()
    if (listError) throw listError
    const verified = factors?.totp?.find((f) => f.status === 'verified')
    if (verified) { setFactorId(verified.id); setStep('verify'); return }
    // Remove half-finished enrollments before creating a new one.
    for (const f of factors?.all ?? []) {
      if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id })
    }
    const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'SecretarIA admin' })
    if (enrollError) throw enrollError
    setFactorId(enrolled.id)
    setQr(enrolled.totp.qr_code)
    setSecret(enrolled.totp.secret)
    setStep('enroll')
  }

  const handlePassword = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setLoading(true)
    const { error, profile } = await signIn(email, password)
    if (error || !profile) { setError(t('adminInvalid')); setLoading(false); return }
    if (!profile.is_super_admin) { setError(t('adminDenied')); await signOut(); setLoading(false); return }
    try {
      await startSecondFactor()
    } catch (err) {
      setError(t('adminMfaStartError', { error: (err as Error).message }))
    }
    setLoading(false)
  }

  const handleCode = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setLoading(true)
    const { data: challenge, error: chError } = await supabase.auth.mfa.challenge({ factorId })
    if (chError) { setError(chError.message); setLoading(false); return }
    const { error: vError } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code: code.replace(/\s/g, '') })
    setLoading(false)
    if (vError) { setError(t('adminCodeInvalid')); return }
    navigate('/admin/dashboard', { replace: true })
  }

  const field = 'h-11 bg-[var(--ink-700)] border-[var(--ink-600)] text-white'

  return (
    <div className="min-h-screen bg-[var(--ink-900)] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex justify-end mb-4"><LanguageToggle tone="dark" /></div>
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl gold-gradient mb-4 gold-shadow"><Shield className="size-6 text-[var(--ink-900)]" /></div>
          <h1 className="text-2xl font-serif font-medium text-white">{t('adminTitle')}</h1>
          <p className="text-sm text-white/40 mt-1">{t('adminSubtitle')}</p>
        </div>
        <div className="rounded-xl bg-[var(--ink-800)] border border-[var(--ink-700)] p-8">
          {step === 'password' && (
            <form onSubmit={handlePassword} className="space-y-5">
              <div className="space-y-1.5"><Label className="text-white">{tc('email')}</Label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} required className={field} /></div>
              <div className="space-y-1.5"><Label className="text-white">{tc('password')}</Label><Input type="password" value={password} onChange={e => setPassword(e.target.value)} required className={field} /></div>
              {error && <p className="text-sm text-[var(--danger)] bg-[var(--danger)]/10 rounded-lg px-3 py-2">{error}</p>}
              <Button type="submit" className="w-full h-11 btn-gold" disabled={loading}>{loading && <Spinner className="mr-2" />}{loading ? t('signingIn') : t('signIn')}</Button>
            </form>
          )}
          {step !== 'password' && (
            <form onSubmit={handleCode} className="space-y-5">
              {step === 'enroll' ? (
                <div className="space-y-3 text-center">
                  <p className="text-sm text-white">{t('adminEnrollTitle')}</p>
                  <p className="text-xs text-white/50">{t('adminEnrollText')}</p>
                  {qr && <img src={qr} alt={t('adminQrAlt')} className="mx-auto w-44 h-44 rounded-lg bg-white p-2" />}
                  {secret && <p className="text-[11px] text-white/40 break-all">{t('adminKey', { secret })}</p>}
                </div>
              ) : (
                <p className="text-sm text-white text-center">{t('adminCodeText')}</p>
              )}
              <Input inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={e => setCode(e.target.value)} placeholder="000000" required className={`${field} text-center tracking-[0.4em]`} aria-label={t('adminCodeLabel')} />
              {error && <p className="text-sm text-[var(--danger)] bg-[var(--danger)]/10 rounded-lg px-3 py-2">{error}</p>}
              <Button type="submit" className="w-full h-11 btn-gold" disabled={loading || code.replace(/\s/g, '').length < 6}>{loading && <Spinner className="mr-2" />}{t('verify')}</Button>
              <button type="button" className="w-full text-xs text-white/40 hover:text-white/60" onClick={() => { void signOut(); setStep('password'); setCode(''); setError('') }}>{tc('signOut')}</button>
            </form>
          )}
        </div>
        <div className="text-center mt-4"><Link to="/login" className="text-xs text-white/40 hover:text-white/60">{t('backToApp')}</Link></div>
      </div>
    </div>
  )
}
