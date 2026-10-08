import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { Appointment, Client } from '@/lib/supabase'
import { format, startOfDay, endOfDay } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { CalendarDays, Users, TrendingUp, Bot, ChevronRight, MessageSquare } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'

type AptWithClient = Appointment & { clients: Pick<Client, 'name'> | null }

export function DashboardPage() {
  const [todayApts, setTodayApts] = useState<AptWithClient[]>([])
  const [totalClients, setTotalClients] = useState(0)
  const [monthRevenue, setMonthRevenue] = useState(0)
  const [activeConvs, setActiveConvs] = useState(0)
  const [loading, setLoading] = useState(true)
  const today = new Date()

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    const startOfToday = startOfDay(today).toISOString()
    const endOfToday = endOfDay(today).toISOString()
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString()

    const [aptsRes, clientsRes, monthRes, convsRes] = await Promise.all([
      supabase.from('appointments').select('*, clients(name)').gte('start_time', startOfToday).lte('start_time', endOfToday).order('start_time'),
      supabase.from('clients').select('id', { count: 'exact', head: true }),
      supabase.from('appointments').select('price').gte('start_time', startOfMonth).eq('status', 'done'),
      supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    ])

    const apts = (aptsRes.data ?? []) as AptWithClient[]
    setTodayApts(apts)
    setTotalClients(clientsRes.count ?? 0)
    setMonthRevenue((monthRes.data ?? []).reduce((acc, a) => acc + (a.price ?? 0), 0))
    setActiveConvs(convsRes.count ?? 0)
    setLoading(false)
  }

  const statusBadge: Record<string, string> = {
    pending: 'bg-[var(--warning-50)] text-[var(--warning-700)] border-[var(--warning-100)]',
    confirmed: 'bg-[var(--success-50)] text-[var(--success-700)] border-[var(--success-100)]',
    done: 'bg-blue-50 text-blue-700 border-blue-100',
    cancelled: 'bg-[var(--danger-50)] text-[var(--danger-700)] border-[var(--danger-100)]',
  }

  const cards = [
    { title: 'Agendamentos Hoje', value: todayApts.length, icon: CalendarDays, desc: `${todayApts.filter(a => a.status === 'confirmed').length} confirmados`, gold: true },
    { title: 'Total de Clientes', value: totalClients, icon: Users, desc: 'na sua base' },
    { title: 'Faturamento do Mês', value: `R$ ${monthRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, icon: TrendingUp, desc: 'procedimentos realizados' },
    { title: 'Conversas Ativas', value: activeConvs, icon: MessageSquare, desc: 'no WhatsApp' },
  ]

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-medium">Olá! 👋</h1>
          <p className="text-sm text-[var(--ink-500)] mt-0.5">{format(today, "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR })}</p>
        </div>
        <Link to="/app/agenda">
          <Button className="btn-gold gap-2"><CalendarDays className="size-4" />Nova consulta</Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {cards.map((c, i) => (
          <div key={i} className={`luxury-card p-5 ${c.gold ? 'relative overflow-hidden' : ''}`}>
            {c.gold && <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'repeating-linear-gradient(45deg, #D4AF37 0px, #D4AF37 1px, transparent 1px, transparent  8px)' }} />}
            <div className="relative">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-[var(--ink-500)] font-medium">{c.title}</p>
                <div className={`p-2 rounded-lg ${c.gold ? 'gold-gradient' : 'bg-[var(--ink-100)]'}`}>
                  <c.icon className={`size-4 ${c.gold ? 'text-[var(--ink-900)]' : 'text-[var(--ink-500)]'}`} />
                </div>
              </div>
              {loading ? <Skeleton className="h-8 w-24 mb-1" /> : <p className={`text-2xl font-serif font-medium ${c.gold ? 'gold-gradient-text' : ''}`}>{c.value}</p>}
              <p className="text-xs text-[var(--ink-500)] mt-1">{c.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 luxury-card">
          <div className="px-6 py-4 border-b border-[var(--ink-200)] flex items-center justify-between">
            <div>
              <h2 className="font-serif font-medium text-lg">Agenda de Hoje</h2>
              <p className="text-xs text-[var(--ink-500)] mt-0.5">{format(today, "dd 'de' MMMM", { locale: ptBR })}</p>
            </div>
            <Link to="/app/agenda"><Button variant="ghost" size="sm" className="text-xs gap-1">Ver tudo <ChevronRight className="size-3" /></Button></Link>
          </div>
          <div className="p-4 space-y-2 max-h-80 overflow-y-auto">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-lg border border-[var(--ink-200)]">
                  <Skeleton className="w-12 h-10 rounded" />
                  <div className="flex-1 space-y-1.5"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-24" /></div>
                </div>
              ))
            ) : todayApts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="w-12 h-12 rounded-2xl gold-gradient flex items-center justify-center mb-3 opacity-40"><CalendarDays className="size-5" /></div>
                <p className="text-sm font-medium text-[var(--ink-500)]">Nenhum agendamento hoje</p>
                <p className="text-xs text-[var(--ink-500)] mt-1">Aproveite para relaxar</p>
              </div>
            ) : (
              todayApts.map(apt => (
                <div key={apt.id} className="flex items-center gap-3 p-3 rounded-lg border border-[var(--ink-200)] hover:border-[var(--gold-200)] hover:bg-[var(--gold-50)]/30 transition-all">
                  <div className="text-center min-w-[3rem] bg-[var(--ink-100)] rounded-lg py-1.5">
                    <p className="text-xs font-bold leading-none">{format(new Date(apt.start_time), 'HH:mm')}</p>
                    <p className="text-[10px] text-[var(--ink-500)] mt-0.5">{format(new Date(apt.end_time), 'HH:mm')}</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{apt.title}</p>
                    <p className="text-xs text-[var(--ink-500)]">{apt.clients?.name ?? 'Cliente'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {apt.price > 0 && <span className="text-xs font-medium text-[var(--success-700)]">R$ {apt.price.toFixed(2)}</span>}
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusBadge[apt.status] ?? ''}`}>{apt.status}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="luxury-card">
          <div className="px-6 py-4 border-b border-[var(--ink-200)]"><h2 className="font-serif font-medium text-lg">Atalhos</h2></div>
          <div className="p-4 space-y-2">
            {[
              { to: '/app/agenda', icon: CalendarDays, label: 'Novo Agendamento', desc: 'Adicionar à agenda' },
              { to: '/app/clientes', icon: Users, label: 'Novo Cliente', desc: 'Cadastrar cliente' },
              { to: '/app/secretaria-ia', icon: Bot, label: 'Configurar IA', desc: 'Personalizar respostas' },
              { to: '/app/conversas', icon: MessageSquare, label: 'Ver Conversas', desc: 'WhatsApp ativo' },
            ].map(({ to, icon: Icon, label, desc }) => (
              <Link key={to} to={to}>
                <div className="flex items-center gap-3 p-3 rounded-lg border border-[var(--ink-200)] hover:border-[var(--gold-200)] hover:bg-[var(--gold-50)]/30 transition-all group cursor-pointer">
                  <div className="w-9 h-9 rounded-lg gold-gradient flex items-center justify-center flex-shrink-0 gold-shadow"><Icon className="size-4 text-[var(--ink-900)]" /></div>
                  <div className="flex-1 min-w-0"><p className="text-sm font-medium">{label}</p><p className="text-xs text-[var(--ink-500)]">{desc}</p></div>
                  <ChevronRight className="size-4 text-[var(--ink-500)] group-hover:translate-x-0.5 transition-transform" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl overflow-hidden relative" style={{ background: 'linear-gradient(135deg, #111111 0%, #2A2A2A 100%)' }}>
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 80% 50%, #D4AF37, transparent 60%)' }} />
        <div className="relative px-6 py-6 flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 rounded gold-gradient flex items-center justify-center"><Bot className="size-3.5" /></div>
              <span className="text-xs font-medium tracking-[0.15em] uppercase" style={{ color: '#E4C982' }}>SecretarIA</span>
            </div>
            <h3 className="text-lg font-serif font-medium text-white mb-1">Sua IA está trabalhando 24h</h3>
            <p className="text-sm text-white/50">Respondendo clientes, agendando e organizando seu studio enquanto você descansa.</p>
          </div>
          <Link to="/app/secretaria-ia" className="flex-shrink-0"><Button className="btn-gold whitespace-nowrap">Configurar IA</Button></Link>
        </div>
      </div>
    </div>
  )
}
