import type { UserProfile } from '@/lib/supabase'

const RECOVERY_FLAG = 'secretaria_password_recovery'

export function postAuthPath(profile: UserProfile | null): string {
  if (!profile) return '/onboarding'
  if (profile.is_super_admin) return '/admin/dashboard'
  if (!profile.studio_id || profile.role === 'removed') return '/sem-studio'
  if (!profile.onboarding_completed) return '/onboarding'
  return '/app'
}

export function markPasswordRecovery() {
  try {
    sessionStorage.setItem(RECOVERY_FLAG, '1')
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearPasswordRecovery() {
  try {
    sessionStorage.removeItem(RECOVERY_FLAG)
  } catch {
    /* ignore */
  }
}

export function urlLooksLikeRecovery() {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const params = new URLSearchParams(window.location.search)
  return hashParams.get('type') === 'recovery' || params.get('type') === 'recovery'
}

export function isPasswordRecovery() {
  if (urlLooksLikeRecovery()) {
    markPasswordRecovery()
    return true
  }
  try {
    return sessionStorage.getItem(RECOVERY_FLAG) === '1'
  } catch {
    return false
  }
}
