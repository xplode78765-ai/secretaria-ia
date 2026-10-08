import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Conversation, Message, Client } from '@/lib/supabase'
import { format } from 'date-fns'
import { Send, MessageSquare, Bot, Search, AlertCircle, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

export function ConversasPage() {
  const [conversations, setConversations] = useState<(Conversation & { clients: Pick<Client, 'name' | 'phone'> | null })[]>([])
  const [selectedConv, setSelectedConv] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [msgLoading, setMsgLoading] = useState(true)
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  const [sending, setSending] = useState(false)
  const [mobileShowChat, setMobileShowChat] = useState(false)
  const msgEndRef = useRef<HTMLDivElement>(null)
  const selectedConvRef = useRef<string | null>(null)
  selectedConvRef.current = selectedConv

  const loadConversations = useCallback(async () => {
    const { data } = await supabase.from('conversations').select('*, clients(name, phone)').order('last_message_at', { ascending: false })
    setConversations((data ?? []) as (Conversation & { clients: Pick<Client, 'name' | 'phone'> | null })[])
    if (data && data.length > 0 && !selectedConvRef.current) setSelectedConv(data[0].id)
    setLoading(false)
  }, [])

  const loadMessages = useCallback(async (convId: string) => {
    const { data } = await supabase.from('messages').select('*').eq('conversation_id', convId).order('created_at')
    setMessages((data ?? []) as Message[])
    setMsgLoading(false)
  }, [])

  useEffect(() => { loadConversations() }, [loadConversations])

  useEffect(() => {
    const interval = setInterval(() => { loadConversations() }, 5000)
    return () => clearInterval(interval)
  }, [loadConversations])

  useEffect(() => {
    if (!selectedConv) return
    setMsgLoading(true)
    loadMessages(selectedConv)
    const interval = setInterval(() => { loadMessages(selectedConv) }, 5000)
    return () => clearInterval(interval)
  }, [selectedConv, loadMessages])

  useEffect(() => { msgEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const sendMessage = async () => {
    if (!input.trim() || !selectedConv) return
    setSending(true)
    const content = input.trim()
    setInput('')
    const { error } = await supabase.functions.invoke('whatsapp-send', {
      body: { conversation_id: selectedConv, content },
    })
    if (error) {
      toast.error('Erro ao enviar mensagem: ' + error.message)
      setSending(false)
      return
    }
    setSending(false)
    loadMessages(selectedConv)
    loadConversations()
  }

  const filtered = conversations.filter(c => {
    if (!search) return true
    const name = c.clients?.name ?? ''
    return name.toLowerCase().includes(search.toLowerCase()) || (c.clients?.phone ?? '').includes(search)
  })

  return (
    <div className="flex h-[calc(100vh-3.5rem)] md:h-screen">
      {/* Conversation list */}
      <div className={cn("w-full md:w-80 border-r border-[var(--ink-200)] flex-col bg-[var(--canvas)]", mobileShowChat ? "hidden md:flex" : "flex")}>
        <div className="p-4 border-b border-[var(--ink-200)]">
          <h1 className="text-xl font-serif font-medium mb-3">Conversas</h1>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-[var(--ink-400)]" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar..." className="h-8 pl-8 text-sm" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? <div className="flex justify-center p-8"><Spinner className="text-[var(--gold)]" /></div> : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center px-4">
              <MessageSquare className="size-8 text-[var(--ink-300)] mb-2" />
              <p className="text-sm text-[var(--ink-500)]">Nenhuma conversa ainda</p>
              <p className="text-xs text-[var(--ink-400)] mt-1">Conecte o WhatsApp para começar</p>
            </div>
          ) : filtered.map(conv => (
            <div key={conv.id} onClick={() => { setSelectedConv(conv.id); setMobileShowChat(true) }} className={cn("flex items-center gap-3 p-3 cursor-pointer border-b border-[var(--ink-200)] hover:bg-[var(--ink-100)] transition-colors", selectedConv === conv.id && 'bg-[var(--gold-50)]')}>
              <div className="w-10 h-10 rounded-full bg-[var(--ink-100)] flex items-center justify-center text-sm font-medium flex-shrink-0">{(conv.clients?.name ?? '?').slice(0, 1).toUpperCase()}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{conv.clients?.name ?? 'Desconhecido'}</p>
                <p className="text-xs text-[var(--ink-500)] truncate">{conv.clients?.phone ?? ''}</p>
              </div>
              {conv.ai_enabled && <Bot className="size-3.5 text-[var(--gold)] flex-shrink-0" />}
            </div>
          ))}
        </div>
      </div>

      {/* Chat area */}
      <div className={cn("flex-1 flex-col", mobileShowChat ? "flex" : "hidden md:flex")}>
        {selectedConv ? (
          <>
            <div className="p-4 border-b border-[var(--ink-200)] flex items-center gap-3">
              <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={() => setMobileShowChat(false)}><ArrowLeft className="size-4" /></Button>
              <div className="w-10 h-10 rounded-full bg-[var(--ink-100)] flex items-center justify-center text-sm font-medium">{(conversations.find(c => c.id === selectedConv)?.clients?.name ?? '?').slice(0, 1).toUpperCase()}</div>
              <div>
                <p className="text-sm font-medium">{conversations.find(c => c.id === selectedConv)?.clients?.name ?? 'Conversa'}</p>
                <p className="text-xs text-[var(--ink-500)]">{conversations.find(c => c.id === selectedConv)?.clients?.phone ?? ''}</p>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[var(--canvas-subtle)]">
              {msgLoading ? <div className="flex justify-center p-8"><Spinner className="text-[var(--gold)]" /></div> : messages.map(msg => (
                <div key={msg.id} className={`flex ${msg.sender_type === 'client' ? 'justify-start' : 'justify-end'}`}>
                  {msg.sender_type === 'ai' && <div className="w-7 h-7 rounded-full gold-gradient flex items-center justify-center mr-2 flex-shrink-0 self-end"><Bot className="size-3.5" /></div>}
                  <div className={cn("max-w-[70%] px-4 py-2.5 text-sm", msg.sender_type === 'client' ? 'chat-ai' : 'chat-user')}>
                    {msg.content}
                    <div className="text-[10px] mt-1 flex items-center gap-1 opacity-50">{format(new Date(msg.created_at), 'HH:mm')}</div>
                    {msg.status === 'failed' && (
                      <div className="text-[10px] mt-0.5 flex items-center gap-1 text-red-500 font-medium">
                        <AlertCircle className="size-3" /> Falha ao enviar
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={msgEndRef} />
            </div>
            <div className="p-4 border-t border-[var(--ink-200)] flex gap-2">
              <Input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendMessage()} placeholder="Digite uma mensagem..." />
              <Button onClick={sendMessage} className="btn-gold" disabled={sending || !input.trim()}><Send className="size-4" /></Button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <MessageSquare className="size-12 text-[var(--ink-300)] mb-3" />
            <p className="text-sm font-medium text-[var(--ink-500)]">Selecione uma conversa</p>
          </div>
        )}
      </div>
    </div>
  )
}
