import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { postAuthPath } from '@/lib/auth-nav'
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
import { Spinner } from '@/components/ui/spinner'

function FullPageSpinner() {
  return <div className="flex items-center justify-center min-h-screen"><Spinner className="size-6 text-[var(--gold)]" /></div>
}

function GuestRoute({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth()
  if (loading) return <FullPageSpinner />
  if (user && profile) return <Navigate to={postAuthPath(profile)} replace />
  return <>{children}</>
}

function ProtectedRoute({ children, allowOnboarding = false }: { children: React.ReactNode; allowOnboarding?: boolean }) {
  const { user, profile, loading } = useAuth()
  if (loading) return <FullPageSpinner />
  if (!user) return <Navigate to="/login" replace />
  if (!profile) return <Navigate to="/login" replace />
  if (profile.is_super_admin && allowOnboarding) return <Navigate to="/admin/dashboard" replace />
  if (!profile.is_super_admin && !profile.onboarding_completed && !allowOnboarding) {
    return <Navigate to="/onboarding" replace />
  }
  if (allowOnboarding && profile.onboarding_completed) {
    return <Navigate to="/app" replace />
  }
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
          <Route index element={<DashboardPage />} />
          <Route path="agenda" element={<AgendaPage />} />
          <Route path="conversas" element={<ConversasPage />} />
          <Route path="clientes" element={<ClientesPage />} />
          <Route path="clientes/:id" element={<ClienteDetailPage />} />
          <Route path="procedimentos" element={<ProcedimentosPage />} />
          <Route path="profissionais" element={<ProfissionaisPage />} />
          <Route path="secretaria-ia" element={<SecretariaIAPage />} />
          <Route path="automacoes" element={<AutomacoesPage />} />
          <Route path="financeiro" element={<FinanceiroPage />} />
          <Route path="relatorios" element={<RelatoriosPage />} />
          <Route path="studio" element={<StudioPage />} />
          <Route path="configuracoes" element={<ConfiguracoesPage />} />
        </Route>
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/dashboard" element={<AdminRoute><AdminDashboardPage /></AdminRoute>} />
        <Route path="/" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
