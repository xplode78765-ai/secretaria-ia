export type AppRole = 'owner' | 'admin' | 'reception' | 'professional' | 'removed'

export const ROUTE_ROLES: Record<string, AppRole[]> = {
  '/app': ['owner', 'admin', 'reception', 'professional'],
  '/app/agenda': ['owner', 'admin', 'reception', 'professional'],
  '/app/conversas': ['owner', 'admin', 'reception', 'professional'],
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

export function normalizeRole(role?: string | null): AppRole {
  if (role === 'admin' || role === 'owner') return role
  if (role === 'reception' || role === 'professional' || role === 'removed') return role
  return 'reception'
}

export function canAccessPath(role: string | null | undefined, pathname: string) {
  const r = normalizeRole(role)
  if (r === 'removed') return false
  const key = pathname.startsWith('/app/clientes/') ? '/app/clientes' : pathname.replace(/\/$/, '') || '/app'
  const allowed = ROUTE_ROLES[key] || ROUTE_ROLES['/app']
  return allowed.includes(r)
}
