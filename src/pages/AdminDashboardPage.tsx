import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useNavigate } from 'react-router-dom'
import { Shield, Building2, Users, DollarSign, CalendarDays, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

type OverviewData = {
  totalStudios: number
  totalClients: number
  totalRevenue: number
  totalAppointments: number
  studios: { id: string; name: string; email: string; created_at: string; client_count: number; revenue: number }[]
}

export function AdminDashboardPage() {
  const navigate = useNavigate()
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    try {
      const { data: json, error } = await supabase.functions.invoke('admin-panel', {
        body: { action: 'overview' },
      })
      if (error) throw new Error(error.message)
      if (json?.error) throw new Error(json.error)
      const studios = (json.studios ?? []).map((s: { id: string; name: string; email: string; created_at: string; client_count?: number; revenue?: number }) => ({
        id: s.id,
        name: s.name,
        email: s.email,
        created_at: s.created_at,
        client_count: s.client_count ?? 0,
        revenue: s.revenue ?? 0,
      }))
      setData({
        totalStudios: json.totalStudios ?? 0,
        totalClients: json.totalClients ?? 0,
        totalRevenue: json.totalRevenue ?? 0,
        totalAppointments: json.totalAppointments ?? 0,
        studios,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  const handleSignOut = async () => { await supabase.auth.signOut(); navigate('/admin') }

  if (loading) return <div className="flex justify-center p-12"><Spinner className="text-[var(--gold)]" /></div>
  if (error) return <div className="flex justify-center p-12 text-red-500 text-sm">{error}</div>

  const cards = [
    { title: 'Estúdios', value: data?.totalStudios ?? 0, icon: Building2 },
    { title: 'Clientes', value: data?.totalClients ?? 0, icon: Users },
    { title: 'Faturamento', value: `R$ ${(data?.totalRevenue ?? 0).toFixed(2)}`, icon: DollarSign },
    { title: 'Agendamentos', value: data?.totalAppointments ?? 0, icon: CalendarDays },
  ]

  return (
    <div className="min-h-screen bg-[var(--canvas-subtle)]">
      <header className="bg-[var(--ink-900)] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg gold-gradient flex items-center justify-center"><Shield className="size-4 text-[var(--ink-900)]" /></div>
          <div><h1 className="text-sm font-serif font-medium text-white">Painel Administrativo</h1><p className="text-xs text-white/40">SecretarIA Platform</p></div>
        </div>
        <Button variant="ghost" size="sm" className="text-white/60 hover:text-white" onClick={handleSignOut}><LogOut className="size-4" />Sair</Button>
      </header>

      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {cards.map((c, i) => (
            <div key={i} className="luxury-card p-5">
              <div className="flex items-center justify-between mb-3"><p className="text-sm text-[var(--ink-500)] font-medium">{c.title}</p><div className="p-2 rounded-lg gold-gradient"><c.icon className="size-4 text-[var(--ink-900)]" /></div></div>
              <p className="text-2xl font-serif font-medium gold-gradient-text">{c.value}</p>
            </div>
          ))}
        </div>

        <div className="luxury-card overflow-hidden">
          <div className="px-6 py-4 border-b border-[var(--ink-200)]"><h2 className="font-serif font-medium text-lg">Estúdios Cadastrados</h2></div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-[var(--ink-200)] bg-[var(--ink-100)]">
                <th className="text-left text-xs font-medium text-[var(--ink-500)] px-6 py-3">Estúdio</th>
                <th className="text-left text-xs font-medium text-[var(--ink-500)] px-6 py-3">E-mail</th>
                <th className="text-right text-xs font-medium text-[var(--ink-500)] px-6 py-3">Clientes</th>
                <th className="text-right text-xs font-medium text-[var(--ink-500)] px-6 py-3">Faturamento</th>
              </tr></thead>
              <tbody>
                {data?.studios.map(s => (
                  <tr key={s.id} className="border-b border-[var(--ink-200)] hover:bg-[var(--ink-100)]/50">
                    <td className="px-6 py-3 text-sm font-medium">{s.name}</td>
                    <td className="px-6 py-3 text-sm text-[var(--ink-500)]">{s.email}</td>
                    <td className="px-6 py-3 text-sm text-right">{s.client_count}</td>
                    <td className="px-6 py-3 text-sm text-right font-medium">R$ {s.revenue.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
