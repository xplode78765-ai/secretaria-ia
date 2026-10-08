import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import type { EvolutionConnection } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Phone, PhoneOff, QrCode, CheckCircle2, AlertCircle, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'

const QR_REFRESH_INTERVAL = 25000
const QR_MAX_AGE = 60000

export function ConfiguracoesPage() {
  const { profile } = useAuth()
  const [connection, setConnection] = useState<EvolutionConnection | null>(null)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [showRetry, setShowRetry] = useState(false)
  const [countdown, setCountdown] = useState(25)
  const connectStartTime = useRef<number>(0)

  const loadConnection = useCallback(async () => {
    if (!profile?.studio_id) { setLoading(false); return }
    const { data, error } = await supabase.from('evolution_api_connections')
      .select('id, studio_id, instance_name, status, phone_number, qr_code, qr_code_updated_at, last_connected_at, error_message, created_at, updated_at')
      .eq('studio_id', profile.studio_id).maybeSingle()
    if (error) {
      console.error('[ConfiguracoesPage] loadConnection error:', error)
      setError('Não foi possível carregar o status da conexão. Tente recarregar a página.')
    }
    setConnection(data as EvolutionConnection | null)
    setLoading(false)
  }, [profile?.studio_id])

  useEffect(() => { loadConnection() }, [loadConnection])

  const callEdgeFunction = useCallback(async (action: string) => {
    return supabase.functions.invoke('evolution-manager', { body: { action } })
  }, [])

  const refreshQr = useCallback(async () => {
    setRefreshing(true)
    try {
      const { error } = await callEdgeFunction('refresh_qr')
      if (error) throw error
      await loadConnection()
    } catch {
      // silent — polling will retry
    } finally {
      setRefreshing(false)
    }
  }, [callEdgeFunction, loadConnection])

  // Poll for status updates + periodic QR refresh while connecting
  useEffect(() => {
    if (connection?.status === 'connecting' || connecting) {
      const pollInterval = setInterval(loadConnection, 3000)
      const refreshInterval = setInterval(() => { refreshQr() }, QR_REFRESH_INTERVAL)
      return () => { clearInterval(pollInterval); clearInterval(refreshInterval) }
    }
  }, [connection?.status, connecting, loadConnection, refreshQr])

  // Countdown timer for next QR refresh
  useEffect(() => {
    if (connection?.status !== 'connecting' || !connection?.qr_code) { setCountdown(25); return }
    setCountdown(25)
    const timer = setInterval(() => {
      setCountdown(prev => prev <= 1 ? 25 : prev - 1)
    }, 1000)
    return () => clearInterval(timer)
  }, [connection?.status, connection?.qr_code, connection?.qr_code_updated_at])

  // Show retry button after 15 seconds of connecting without QR code
  useEffect(() => {
    if (connecting && !connection?.qr_code) {
      connectStartTime.current = Date.now()
      const timeout = setTimeout(() => {
        if (!connection?.qr_code && connection?.status !== 'connected') {
          setShowRetry(true)
        }
      }, 15000)
      return () => clearTimeout(timeout)
    }
    setShowRetry(false)
  }, [connecting, connection?.qr_code, connection?.status])

  const connect = async () => {
    setConnecting(true); setError(''); setShowRetry(false)
    try {
      const { data, error } = await callEdgeFunction('connect')
      if (error) throw new Error(error.message || 'Falha ao conectar')
      if (data?.error) throw new Error(data.error)
      await loadConnection()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao conectar WhatsApp')
    } finally {
      setConnecting(false)
    }
  }

  const disconnect = async () => {
    setConnecting(true)
    try {
      await callEdgeFunction('disconnect')
      await loadConnection()
    } catch {
      setError('Erro ao desconectar')
    } finally {
      setConnecting(false)
    }
  }

  const isConnected = connection?.status === 'connected' || connection?.status === 'open'
  const hasError = connection?.status === 'error' || !!connection?.error_message

  const isQrExpired = (() => {
    if (!connection?.qr_code || !connection?.qr_code_updated_at) return true
    return Date.now() - new Date(connection.qr_code_updated_at).getTime() > QR_MAX_AGE
  })()

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div><h1 className="text-2xl font-serif font-medium">Configurações</h1><p className="text-sm text-[var(--ink-500)] mt-0.5">Conexão e preferências</p></div>

      {/* WhatsApp Connection */}
      <div className="luxury-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isConnected ? 'bg-[var(--success-50)]' : 'bg-[var(--ink-100)]'}`}>
            {isConnected ? <Phone className="size-5 text-[var(--success)]" /> : <PhoneOff className="size-5 text-[var(--ink-500)]" />}
          </div>
          <div><h2 className="font-serif font-medium text-lg">WhatsApp</h2><p className="text-xs text-[var(--ink-500)]">Conecte para a SecretarIA atender automaticamente</p></div>
        </div>

        {loading ? <div className="flex justify-center py-8"><Spinner className="text-[var(--gold)]" /></div> : error ? (
          <div className="rounded-lg border border-[var(--danger-100)] bg-[var(--danger-50)] p-4 flex items-start gap-3">
            <AlertCircle className="size-5 text-[var(--danger)] flex-shrink-0 mt-0.5" />
            <div className="flex-1"><p className="text-sm font-medium text-[var(--danger-700)]">Erro ao conectar</p><p className="text-xs text-[var(--danger-600)] mt-0.5">{error}</p></div>
            <Button variant="ghost" size="icon-sm" onClick={() => setError('')}><X className="size-3.5" /></Button>
          </div>
        ) : isConnected ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-[var(--success-100)] bg-[var(--success-50)] p-4 flex items-center gap-3">
              <CheckCircle2 className="size-5 text-[var(--success)]" />
              <div className="flex-1"><p className="text-sm font-medium text-[var(--success-700)]">WhatsApp conectado</p><p className="text-xs text-[var(--success-600)]">{connection?.phone_number || connection?.instance_name}</p></div>
            </div>
            <Button variant="outline" className="gap-2 text-[var(--danger)]" onClick={disconnect} disabled={connecting}><PhoneOff className="size-4" />Desconectar</Button>
          </div>
        ) : hasError ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-[var(--danger-100)] bg-[var(--danger-50)] p-4 flex items-start gap-3">
              <AlertCircle className="size-5 text-[var(--danger)] flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-[var(--danger-700)]">Erro na conexão</p>
                <p className="text-xs text-[var(--danger-600)] mt-0.5">{connection?.error_message || 'Erro desconhecido'}</p>
              </div>
            </div>
            <Button className="btn-gold gap-2" onClick={connect} disabled={connecting}>
              {connecting ? <Spinner className="size-4" /> : <RefreshCw className="size-4" />}
              Tentar novamente
            </Button>
          </div>
        ) : connection?.qr_code && !isQrExpired ? (
          <div className="space-y-4">
            <div className="text-center">
              <div className="inline-block p-4 bg-white rounded-xl border border-[var(--ink-200)]">
                <img src={connection.qr_code.startsWith('data:') || connection.qr_code.startsWith('http') ? connection.qr_code : `data:image/png;base64,${connection.qr_code}`} alt="QR Code" className="w-48 h-48" />
              </div>
              <p className="text-sm text-[var(--ink-500)] mt-3">Escaneie o QR code com seu WhatsApp</p>
              <p className="text-xs text-[var(--ink-400)] mt-1">Aguardando leitura...</p>
              <p className="text-xs text-[var(--gold)] mt-2 font-medium">Renovando em {countdown}s</p>
            </div>
            <Button variant="outline" className="w-full gap-2" onClick={loadConnection}><RefreshCw className="size-4" />Atualizar status</Button>
          </div>
        ) : connection?.qr_code && isQrExpired ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-[var(--warning-100)] bg-[var(--warning-50)] p-6 text-center">
              <QrCode className="size-10 mx-auto mb-3 text-[var(--warning)] opacity-50" />
              <p className="text-sm font-medium text-[var(--warning-700)]">O QR code expirou</p>
              <p className="text-xs text-[var(--warning-600)] mt-1 mb-4">Gere um novo código para escanear</p>
              <Button className="btn-gold gap-2" onClick={refreshQr} disabled={refreshing}>
                {refreshing ? <Spinner className="size-4" /> : <RefreshCw className="size-4" />}
                Gerar novo QR code
              </Button>
            </div>
          </div>
        ) : connecting && showRetry ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-[var(--warning-100)] bg-[var(--warning-50)] p-4 text-center">
              <p className="text-sm font-medium text-[var(--warning-700)]">A conexão está demorando mais que o esperado</p>
              <p className="text-xs text-[var(--warning-600)] mt-1">Tente novamente se o QR code não aparecer</p>
            </div>
            <Button className="btn-gold gap-2 w-full" onClick={connect} disabled={connecting}>
              {connecting ? <Spinner className="size-4" /> : <RefreshCw className="size-4" />}
              Tentar novamente
            </Button>
          </div>
        ) : connecting ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-dashed border-[var(--gold-200)] bg-[var(--gold-50)] p-6 text-center">
              <Spinner className="size-8 mx-auto mb-3 text-[var(--gold)]" />
              <p className="text-sm font-medium">Conectando à Evolution API...</p>
              <p className="text-xs text-[var(--ink-500)] mt-1">Gerando QR code, aguarde</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-dashed border-[var(--gold-200)] bg-[var(--gold-50)] p-6 text-center">
              <QrCode className="size-10 mx-auto mb-3 text-[var(--gold)]" />
              <p className="text-sm font-medium mb-1">Conectar em um clique</p>
              <p className="text-xs text-[var(--ink-500)] mb-4">O sistema cria a instância e mostra o QR code automaticamente</p>
              <Button className="btn-gold gap-2" onClick={connect} disabled={connecting}>{connecting ? <Spinner className="size-4" /> : <Phone className="size-4" />}Conectar WhatsApp</Button>
            </div>
          </div>
        )}
      </div>

      {/* Account info */}
      <div className="luxury-card p-6">
        <h2 className="font-serif font-medium text-lg mb-4">Conta</h2>
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between py-2 border-b border-[var(--ink-200)]"><Label>E-mail</Label><span className="text-[var(--ink-600)]">{profile?.email}</span></div>
          <div className="flex items-center justify-between py-2 border-b border-[var(--ink-200)]"><Label>Nome</Label><span className="text-[var(--ink-600)]">{profile?.name}</span></div>
          <div className="flex items-center justify-between py-2"><Label>Função</Label><span className="text-[var(--ink-600)] capitalize">{profile?.role}</span></div>
        </div>
      </div>
    </div>
  )
}
