import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import {
  LayoutDashboard, Bot, CalendarDays, Users, Scissors,
  Stethoscope, Zap, DollarSign, BarChart3, Store, Settings,
  LogOut, ChevronLeft, ChevronRight, Menu, MessageSquare,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/app', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/app/agenda', icon: CalendarDays, label: 'Agenda' },
  { to: '/app/conversas', icon: MessageSquare, label: 'Conversas' },
  { to: '/app/clientes', icon: Users, label: 'Clientes' },
  { to: '/app/procedimentos', icon: Scissors, label: 'Procedimentos' },
  { to: '/app/profissionais', icon: Stethoscope, label: 'Profissionais' },
  { to: '/app/secretaria-ia', icon: Bot, label: 'SecretarIA' },
  { to: '/app/automacoes', icon: Zap, label: 'Automações' },
  { to: '/app/financeiro', icon: DollarSign, label: 'Financeiro' },
  { to: '/app/relatorios', icon: BarChart3, label: 'Relatórios' },
  { to: '/app/studio', icon: Store, label: 'Studio' },
  { to: '/app/configuracoes', icon: Settings, label: 'Configurações' },
]

export function AppLayout() {
  const { user, profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const initials = (profile?.name || user?.email || 'S').slice(0, 2).toUpperCase()

  return (
    <div className="flex min-h-screen bg-[var(--canvas)]">
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-[var(--ink-900)]/20 backdrop-blur-sm md:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 flex flex-col border-r border-[var(--ink-200)] bg-[var(--canvas)] transition-all duration-300",
        collapsed ? "w-16" : "w-60",
        "md:relative md:translate-x-0",
        mobileOpen ? "translate-x-0 w-60" : "-translate-x-full md:translate-x-0"
      )}>
        <div className="flex items-center gap-3 px-4 py-5 border-b border-[var(--ink-200)]">
          <div className="flex-shrink-0 w-8 h-8 rounded-lg gold-gradient flex items-center justify-center gold-shadow">
            <span className="text-sm font-serif font-semibold">S</span>
          </div>
          {!collapsed && (
            <div className="overflow-hidden">
              <p className="text-sm font-serif font-medium leading-tight truncate">SecretarIA</p>
              <p className="text-[10px] text-[var(--ink-500)] tracking-[0.15em] uppercase">Estética &amp; Beleza</p>
            </div>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {navItems.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) => cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150",
                isActive
                  ? "bg-[var(--gold-50)] text-[var(--ink-900)] gold-border"
                  : "text-[var(--ink-600)] hover:bg-[var(--ink-100)] hover:text-[var(--ink-900)]",
                collapsed && "justify-center px-2"
              )}
              title={collapsed ? label : undefined}
            >
              {({ isActive }) => (
                <>
                  <Icon className={cn("size-4 flex-shrink-0", isActive && "text-[var(--gold)]")} />
                  {!collapsed && <span className="truncate">{label}</span>}
                  {isActive && !collapsed && <div className="ml-auto w-1.5 h-1.5 rounded-full gold-gradient" />}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <Separator className="bg-[var(--ink-200)] mx-2 w-auto" />

        <div className="p-3">
          <div className={cn("flex items-center gap-3 px-2 py-2 rounded-lg", collapsed && "justify-center")}>
            <Avatar className="size-7 flex-shrink-0">
              <AvatarFallback className="text-xs gold-gradient text-[var(--ink-900)] font-semibold">{initials}</AvatarFallback>
            </Avatar>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{profile?.name || user?.email}</p>
              </div>
            )}
            {!collapsed && (
              <Button variant="ghost" size="icon-sm" onClick={handleSignOut} title="Sair" className="flex-shrink-0">
                <LogOut className="size-3.5" />
              </Button>
            )}
          </div>
          {collapsed && (
            <Button variant="ghost" size="icon-sm" onClick={handleSignOut} className="w-full mt-1" title="Sair">
              <LogOut className="size-3.5" />
            </Button>
          )}
        </div>

        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-20 hidden md:flex items-center justify-center w-6 h-6 rounded-full bg-[var(--canvas)] border border-[var(--ink-200)] text-[var(--ink-500)] hover:text-[var(--ink-900)] transition-colors shadow-sm"
        >
          {collapsed ? <ChevronRight className="size-3" /> : <ChevronLeft className="size-3" />}
        </button>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-[var(--ink-200)] bg-[var(--canvas)]">
          <Button variant="ghost" size="icon-sm" onClick={() => setMobileOpen(true)}>
            <Menu className="size-4" />
          </Button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded gold-gradient flex items-center justify-center">
              <span className="text-xs font-serif font-semibold">S</span>
            </div>
            <span className="text-sm font-serif font-medium">SecretarIA</span>
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
