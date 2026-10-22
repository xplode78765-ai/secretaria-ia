import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Notification } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'

export function NotificationBell() {
  const { profile } = useAuth()
  const [items, setItems] = useState<Notification[]>([])
  const unread = items.filter((n) => !n.read_at).length

  const load = async () => {
    if (!profile?.studio_id) return
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('studio_id', profile.studio_id)
      .order('created_at', { ascending: false })
      .limit(20)
    setItems((data ?? []) as Notification[])
  }

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 30000)
    return () => clearInterval(t)
  }, [profile?.studio_id])

  const markAll = async () => {
    const ids = items.filter((n) => !n.read_at).map((n) => n.id)
    if (ids.length === 0) return
    const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids)
    if (!error) void load()
  }

  const markOne = async (id: string) => {
    const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id)
    if (!error) void load()
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" className="relative">
          <Bell className="size-4" />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full gold-gradient text-[10px] font-bold flex items-center justify-center">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--ink-200)]">
          <p className="text-sm font-medium">Notificações</p>
          {unread > 0 && (
            <button type="button" className="text-xs text-[var(--gold)]" onClick={() => void markAll()}>
              Marcar lidas
            </button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {items.length === 0 ? (
            <p className="text-sm text-[var(--ink-500)] text-center py-8">Nenhuma notificação</p>
          ) : items.map((n) => (
            <div key={n.id} className={`px-3 py-2 border-b border-[var(--ink-100)] cursor-pointer ${n.read_at ? '' : 'bg-[var(--gold-50)]/40'}`} onClick={() => { if (!n.read_at) void markOne(n.id) }}>
              <p className="text-sm font-medium">{n.title}</p>
              <p className="text-xs text-[var(--ink-500)] line-clamp-2">{n.content}</p>
              <p className="text-[10px] text-[var(--ink-400)] mt-1">
                {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: ptBR })}
              </p>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
