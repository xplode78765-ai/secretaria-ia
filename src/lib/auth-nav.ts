import type { UserProfile } from '@/lib/supabase'

export function postAuthPath(profile: UserProfile | null): string {
  if (!profile) return '/onboarding'
  if (profile.is_super_admin) return '/admin/dashboard'
  if (!profile.onboarding_completed) return '/onboarding'
  return '/app'
}
