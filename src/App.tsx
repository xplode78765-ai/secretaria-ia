import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { isPasswordRecovery, postAuthPath } from '@/lib/auth-nav'
import { AppLayout } from '@/components/AppLayout'
import { LoginPage } from '@/pages/LoginPage'
import { RegisterPage } from '@/pages/RegisterPage'
import { RecoverPasswordPage } from '@/pages/RecoverPasswordPage'
import { OnboardingPage } from '@/pages/OnboardingPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { AgendaPage } from '@/pages/AgendaPage'
import { ConversasPage } from '@/pages/ConversasPage'
import { ClientesPage } from '@/pages/ClientesPage'
import { ClienteDetailPage } from '@/pages/ClienteDetailPage'
import { ProcedimentosPage } from '@/pages/ProcedimentosPage'
import { ProfissionaisPage } from '@/pages/ProfissionaisPage'
import { SecretariaIAPage } from '@/pages/SecretariaIAPage'
import { AutomacoesPage } from '@/pages/AutomacoesPage'
import { FinanceiroPage } from '@/pages/FinanceiroPage'
import { RelatoriosPage } from '@/pages/RelatoriosPage'
import { StudioPage } from '@/pages/StudioPage'
import { ConfiguracoesPage } from '@/pages/ConfiguracoesPage'
import { AdminPage } from '@/pages/AdminPage'
import { AdminDashboardPage } from '@/pages/AdminDashboardPage'
import { EquipePage } from '@/pages/EquipePage'
import { AgendarPage } from '@/pages/AgendarPage'
import { SemStudioPage } from '@/pages/SemStudioPage'
import { Spinner } from '@/components/ui/spinner'
import { canAccessPath } from '@/lib/roles'

function FullPageSpinner() {
  return <div className="flex items-center justify-center min-h-screen"><Spinner className="size-6 text-[var(--gold)]" /></div>
}

function RootRedirect() {
  if (isPasswordRecovery()) {
    return <Navigate to={{ pathname: '/recuperar-senha', search: window.location.search, hash: window.location.hash }} replace />
  }
  return <Navigate to="/login" replace />
}

function GuestRoute({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth()
  if (isPasswordRecovery()) {
    return <Navigate to={{ pathname: '/recuperar-senha', search: window.location.search, hash: window.location.hash }} replace />
  }
  if (loading) return <FullPageSpinner />
  if (user && profile) return <Navigate to={postAuthPath(profile)} replace />
  return <>{children}</>
}

function ProtectedRoute({ children, allowOnboarding = false }: { children: React.ReactNode; allowOnboarding?: boolean }) {
  const { user, profile, loading } = useAuth()
  if (isPasswordRecovery()) {
    return <Navigate to={{ pathname: '/recuperar-senha', search: window.location.search, hash: window.location.hash }} replace />
  }
  if (loading) return <FullPageSpinner />
  if (!user) return <Navigate to="/login" replace />
  if (!profile) return <Navigate to="/login" replace />
  if (profile.is_super_admin && allowOnboarding) return <Navigate to="/admin/dashboard" replace />
  if (!profile.is_super_admin && (!profile.studio_id || profile.role === 'removed') && !allowOnboarding) {
    return <Navigate to="/sem-studio" replace />
  }
  if (!profile.is_super_admin && profile.studio_id && !profile.onboarding_completed && !allowOnboarding) {
    return <Navigate to="/onboarding" replace />
  }
  if (allowOnboarding && (profile.onboarding_completed || !profile.studio_id)) {
    return <Navigate to={profile.studio_id ? '/app' : '/sem-studio'} replace />
  }
  return <>{children}</>
}

function RoleRoute({ children, path }: { children: React.ReactNode; path: string }) {
  const { profile } = useAuth()
  if (!canAccessPath(profile?.role, path)) return <Navigate to="/app" replace />
  return <>{children}</>
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth()
  if (loading) return <FullPageSpinner />
  if (!user) return <Navigate to="/admin" replace />
  if (!profile?.is_super_admin) return <Navigate to="/admin" replace />
  return <>{children}</>
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<GuestRoute><LoginPage /></GuestRoute>} />
        <Route path="/cadastro" element={<GuestRoute><RegisterPage /></GuestRoute>} />
        <Route path="/recuperar-senha" element={<RecoverPasswordPage />} />
        <Route path="/onboarding" element={<ProtectedRoute allowOnboarding><OnboardingPage /></ProtectedRoute>} />
        <Route path="/app" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
          <Route index element={<RoleRoute path="/app"><DashboardPage /></RoleRoute>} />
          <Route path="agenda" element={<RoleRoute path="/app/agenda"><AgendaPage /></RoleRoute>} />
          <Route path="conversas" element={<RoleRoute path="/app/conversas"><ConversasPage /></RoleRoute>} />
          <Route path="clientes" element={<RoleRoute path="/app/clientes"><ClientesPage /></RoleRoute>} />
          <Route path="clientes/:id" element={<RoleRoute path="/app/clientes"><ClienteDetailPage /></RoleRoute>} />
          <Route path="procedimentos" element={<RoleRoute path="/app/procedimentos"><ProcedimentosPage /></RoleRoute>} />
          <Route path="profissionais" element={<RoleRoute path="/app/profissionais"><ProfissionaisPage /></RoleRoute>} />
          <Route path="secretaria-ia" element={<RoleRoute path="/app/secretaria-ia"><SecretariaIAPage /></RoleRoute>} />
          <Route path="automacoes" element={<RoleRoute path="/app/automacoes"><AutomacoesPage /></RoleRoute>} />
          <Route path="financeiro" element={<RoleRoute path="/app/financeiro"><FinanceiroPage /></RoleRoute>} />
          <Route path="relatorios" element={<RoleRoute path="/app/relatorios"><RelatoriosPage /></RoleRoute>} />
          <Route path="studio" element={<RoleRoute path="/app/studio"><StudioPage /></RoleRoute>} />
          <Route path="equipe" element={<RoleRoute path="/app/equipe"><EquipePage /></RoleRoute>} />
          <Route path="configuracoes" element={<RoleRoute path="/app/configuracoes"><ConfiguracoesPage /></RoleRoute>} />
        </Route>
        <Route path="/agendar/:slug" element={<AgendarPage />} />
        <Route path="/sem-studio" element={<SemStudioPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/dashboard" element={<AdminRoute><AdminDashboardPage /></AdminRoute>} />
        <Route path="/" element={<RootRedirect />} />
        <Route path="*" element={<RootRedirect />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
