import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, PieChart, Pie, Cell } from 'recharts'
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent } from '@/components/ui/chart'
import { Spinner } from '@/components/ui/spinner'
import { TrendingUp, Users, CalendarDays, DollarSign } from 'lucide-react'

export function RelatoriosPage() {
  const [loading, setLoading] = useState(true)
  const [monthlyData, setMonthlyData] = useState<{ month: string; revenue: number; appointments: number }[]>([])
  const [statusData, setStatusData] = useState<{ name: string; value: number; fill: string }[]>([])
  const [summary, setSummary] = useState({ totalRevenue: 0, totalApts: 0, totalClients: 0, avgTicket: 0 })

  useEffect(() => { loadReport() }, [])

  const loadReport = async () => {
    const months = Array.from({ length: 6 }, (_, i) => subMonths(new Date(), i))
    const monthly: { month: string; revenue: number; appointments: number }[] = []
    for (const m of months) {
      const start = startOfMonth(m).toISOString()
      const end = endOfMonth(m).toISOString()
      const { data: apts } = await supabase.from('appointments').select('price, status').gte('start_time', start).lte('start_time', end)
      const doneApts = (apts ?? []).filter(a => a.status === 'done')
      const revenue = doneApts.reduce((acc, a) => acc + (a.price ?? 0), 0)
      monthly.push({ month: format(m, 'MMM', { locale: ptBR }), revenue, appointments: doneApts.length })
    }
    monthly.reverse()
    setMonthlyData(monthly)

    const { data: allApts } = await supabase.from('appointments').select('status')
    const statusCount: Record<string, number> = {}
    for (const a of allApts ?? []) statusCount[a.status] = (statusCount[a.status] ?? 0) + 1
    const colors: Record<string, string> = { pending: '#D97706', confirmed: '#16A34A', done: '#3B82F6', cancelled: '#DC2626' }
    const labels: Record<string, string> = { pending: 'Pendente', confirmed: 'Confirmado', done: 'Realizado', cancelled: 'Cancelado' }
    setStatusData(Object.entries(statusCount).map(([k, v]) => ({ name: labels[k] ?? k, value: v, fill: colors[k] ?? '#888' })))

    const { count: clientCount } = await supabase.from('clients').select('id', { count: 'exact', head: true })
    const totalRev = monthly.reduce((acc, m) => acc + m.revenue, 0)
    const doneCount = monthly.reduce((acc, m) => acc + m.appointments, 0)
    setSummary({ totalRevenue: totalRev, totalApts: doneCount, totalClients: clientCount ?? 0, avgTicket: doneCount > 0 ? totalRev / doneCount : 0 })
    setLoading(false)
  }

  const chartConfig = { revenue: { label: 'Faturamento', color: '#D4AF37' }, appointments: { label: 'Agendamentos', color: '#C5A059' } }

  if (loading) return <div className="flex justify-center p-12"><Spinner className="text-[var(--gold)]" /></div>

  const cards = [
    { title: 'Faturamento Total', value: `R$ ${summary.totalRevenue.toFixed(2)}`, icon: DollarSign, gold: true },
    { title: 'Agendamentos', value: summary.totalApts, icon: CalendarDays },
    { title: 'Clientes', value: summary.totalClients, icon: Users },
    { title: 'Ticket Médio', value: `R$ ${summary.avgTicket.toFixed(2)}`, icon: TrendingUp },
  ]

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div><h1 className="text-2xl font-serif font-medium">Relatórios</h1><p className="text-sm text-[var(--ink-500)] mt-0.5">Análise dos últimos 6 meses</p></div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {cards.map((c, i) => (
          <div key={i} className="luxury-card p-5">
            <div className="flex items-center justify-between mb-3"><p className="text-sm text-[var(--ink-500)] font-medium">{c.title}</p><div className={`p-2 rounded-lg ${c.gold ? 'gold-gradient' : 'bg-[var(--ink-100)]'}`}><c.icon className={`size-4 ${c.gold ? 'text-[var(--ink-900)]' : 'text-[var(--ink-500)]'}`} /></div></div>
            <p className={`text-2xl font-serif font-medium ${c.gold ? 'gold-gradient-text' : ''}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="luxury-card p-6">
          <h2 className="font-serif font-medium text-lg mb-4">Faturamento Mensal</h2>
          <ChartContainer config={chartConfig} className="min-h-[250px] w-full">
            <BarChart data={monthlyData} accessibilityLayer>
              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#E8E8E8" />
              <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#888888' }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#888888' }} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[4, 4, 0, 0]} name="Faturamento" />
            </BarChart>
          </ChartContainer>
        </div>

        <div className="luxury-card p-6">
          <h2 className="font-serif font-medium text-lg mb-4">Status dos Agendamentos</h2>
          {statusData.length > 0 ? (
            <ChartContainer config={{}} className="min-h-[250px] w-full">
              <PieChart>
                <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                  {statusData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Pie>
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
              </PieChart>
            </ChartContainer>
          ) : <p className="text-sm text-[var(--ink-500)] text-center py-12">Sem dados</p>}
        </div>
      </div>
    </div>
  )
}
