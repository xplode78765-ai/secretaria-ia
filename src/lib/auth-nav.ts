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
  const path = window.location.pathname
  if (path === '/login' || path === '/cadastro') return false
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const params = new URLSearchParams(window.location.search)
  if (hashParams.get('type') === 'recovery' || params.get('type') === 'recovery') return true
  if (path === '/recuperar-senha' && (params.has('code') || hashParams.has('access_token'))) return true
  if ((path === '/' || path === '') && params.has('code')) return true
  return false
}

export function captureAuthRedirect() {
  if (urlLooksLikeRecovery()) markPasswordRecovery()
}

export function isPasswordRecovery() {
  captureAuthRedirect()
  try {
    return sessionStorage.getItem(RECOVERY_FLAG) === '1'
  } catch {
    return urlLooksLikeRecovery()
  }
}

export function resetPasswordErrorMessage(message: string) {
  const lower = message.toLowerCase()
  if (lower.includes('rate') || lower.includes('429')) {
    return 'O e-mail nativo do Supabase já atingiu o limite (poucos envios por hora). Não peça outro agora — abra o último e-mail que chegou. Isso some quando o Resend estiver ligado.'
  }
  if (lower.includes('redirect')) {
    return 'O Auth do Supabase ainda não aceita este domínio. Inclua https://usesecretaria.netlify.app/** nas Redirect URLs.'
  }
  return message || 'Não foi possível enviar o e-mail. Tente novamente.'
}
