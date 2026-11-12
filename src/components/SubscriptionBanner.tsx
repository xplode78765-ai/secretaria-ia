import { Link } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

// Strip under the header: trial countdown, missing payment, paused AI.
export function SubscriptionBanner() {
  const { profile } = useAuth()
  const t = useT('sales')
  if (!profile?.studio_id || profile.is_super_admin) return null
  const status = profile.subscription_status

  let text = ''
  let tone: 'info' | 'warn' | 'danger' = 'info'
  if (status === 'trialing' && profile.trial_ends_at) {
    const days = Math.ceil((new Date(profile.trial_ends_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    text = days <= 1 ? t('bannerTrialLast') : t('bannerTrial', { days })
    tone = days <= 2 ? 'warn' : 'info'
  } else if (status === 'past_due') {
    text = t('bannerPastDue'); tone = 'warn'
  } else if (status === 'paused') {
    text = t('bannerPaused'); tone = 'danger'
  } else if (status === 'cancelled') {
    text = t('bannerCancelled'); tone = 'danger'
  }
  if (!text) return null

  const isOwner = profile.role === 'owner' || profile.role === 'admin'
  return (
    <div
      role="status"
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-xs border-b',
        tone === 'info' && 'bg-[var(--gold-50)] border-[var(--gold-200)] text-[var(--ink-700)]',
        tone === 'warn' && 'bg-[var(--warning-50)] border-[var(--warning-100)] text-[var(--warning-700)]',
        tone === 'danger' && 'bg-[var(--danger-50)] border-[var(--danger-100)] text-[var(--danger-700)]',
      )}
    >
      <span className="font-medium">{text}</span>
      {isOwner && <Link to="/app/configuracoes" className="underline underline-offset-2">{t('bannerCta')}</Link>}
    </div>
  )
}
