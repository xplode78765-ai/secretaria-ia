export type AppRole = 'owner' | 'admin' | 'reception' | 'professional' | 'removed'

export const ROUTE_ROLES: Record<string, AppRole[]> = {
  '/app': ['owner', 'admin', 'reception', 'professional'],
  '/app/agenda': ['owner', 'admin', 'reception', 'professional'],
  '/app/conversas': ['owner', 'admin', 'reception'],
  '/app/clientes': ['owner', 'admin', 'reception', 'professional'],
  '/app/procedimentos': ['owner', 'admin', 'reception'],
  '/app/profissionais': ['owner', 'admin', 'reception'],
  '/app/secretaria-ia': ['owner', 'admin'],
  '/app/automacoes': ['owner', 'admin'],
  '/app/financeiro': ['owner', 'admin', 'reception'],
  '/app/relatorios': ['owner', 'admin'],
  '/app/studio': ['owner', 'admin'],
  '/app/equipe': ['owner', 'admin'],
  '/app/configuracoes': ['owner', 'admin'],
}

// Screens that depend on a plan feature (plans.features). Essencial has none of them.
export const ROUTE_FEATURES: Record<string, string> = {
  '/app/equipe': 'team',
  '/app/profissionais': 'team',
  '/app/financeiro': 'finance',
  '/app/relatorios': 'reports',
  '/app/automacoes': 'automations',
}

export function normalizeRole(role?: string | null): AppRole {
  if (role === 'admin' || role === 'owner') return role
  if (role === 'reception' || role === 'professional' || role === 'removed') return role
  return 'reception'
}

export function isStaffRole(role?: string | null) {
  const r = normalizeRole(role)
  return r === 'owner' || r === 'admin' || r === 'reception'
}

export function canAccessPath(role: string | null | undefined, pathname: string, features?: string[] | null) {
  const r = normalizeRole(role)
  if (r === 'removed') return false
  const key = pathname.startsWith('/app/clientes/') ? '/app/clientes' : pathname.replace(/\/$/, '') || '/app'
  const allowed = ROUTE_ROLES[key] || ROUTE_ROLES['/app']
  if (!allowed.includes(r)) return false
  // features === undefined/null means "plan unknown": do not hide anything.
  const needed = ROUTE_FEATURES[key]
  return !needed || !features || features.includes(needed)
}
