import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import type { EvolutionConnection } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Phone, PhoneOff, QrCode, CheckCircle2, AlertCircle, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useT } from '@/i18n'

const QR_REFRESH_INTERVAL = 25000
const QR_MAX_AGE = 60000

// WhatsApp connection (QR code through Evolution). onConnected fires once when the
// number becomes connected.
export function WhatsAppConnect({ onConnected }: { onConnected?: () => void } = {}) {
  const t = useT('settings')
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
      setError(t('loadError'))
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
      if (error) throw new Error(error.message || t('connectFailed'))
      if (data?.error) throw new Error(data.error)
      await loadConnection()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('connectError'))
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
      setError(t('disconnectError'))
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

  const notified = useRef(false)
  useEffect(() => {
    if (isConnected && !notified.current) { notified.current = true; onConnected?.() }
  }, [isConnected, onConnected])

  return (
    <div className="luxury-card p-6">
      <div className="flex items-center gap-2 mb-4">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isConnected ? 'bg-[var(--success-50)]' : 'bg-[var(--ink-100)]'}`}>
          {isConnected ? <Phone className="size-5 text-[var(--success)]" /> : <PhoneOff className="size-5 text-[var(--ink-500)]" />}
        </div>
        <div><h2 className="font-serif font-medium text-lg">{t('waTitle')}</h2><p className="text-xs text-[var(--ink-500)]">{t('waSubtitle')}</p></div>
      </div>

      {loading ? <div className="flex justify-center py-8"><Spinner className="text-[var(--gold)]" /></div> : error ? (
        <div className="rounded-lg border border-[var(--danger-100)] bg-[var(--danger-50)] p-4 flex items-start gap-3">
          <AlertCircle className="size-5 text-[var(--danger)] flex-shrink-0 mt-0.5" />
          <div className="flex-1"><p className="text-sm font-medium text-[var(--danger-700)]">{t('errorTitle')}</p><p className="text-xs text-[var(--danger-600)] mt-0.5">{error}</p></div>
          <Button variant="ghost" size="icon-sm" onClick={() => setError('')}><X className="size-3.5" /></Button>
        </div>
      ) : isConnected ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-[var(--success-100)] bg-[var(--success-50)] p-4 flex items-center gap-3">
            <CheckCircle2 className="size-5 text-[var(--success)]" />
            <div className="flex-1"><p className="text-sm font-medium text-[var(--success-700)]">{t('connected')}</p><p className="text-xs text-[var(--success-600)]">{connection?.phone_number || connection?.instance_name}</p></div>
          </div>
          <Button variant="outline" className="gap-2 text-[var(--danger)]" onClick={disconnect} disabled={connecting}><PhoneOff className="size-4" />{t('disconnect')}</Button>
        </div>
      ) : hasError ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-[var(--danger-100)] bg-[var(--danger-50)] p-4 flex items-start gap-3">
            <AlertCircle className="size-5 text-[var(--danger)] flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-[var(--danger-700)]">{t('connError')}</p>
              <p className="text-xs text-[var(--danger-600)] mt-0.5">{connection?.error_message || t('unknownError')}</p>
            </div>
          </div>
          <Button className="btn-gold gap-2" onClick={connect} disabled={connecting}>
            {connecting ? <Spinner className="size-4" /> : <RefreshCw className="size-4" />}
            {t('retry')}
          </Button>
        </div>
      ) : connection?.qr_code && !isQrExpired ? (
        <div className="space-y-4">
          <div className="text-center">
            <div className="inline-block p-4 bg-white rounded-xl border border-[var(--ink-200)]">
              <img src={connection.qr_code.startsWith('data:') || connection.qr_code.startsWith('http') ? connection.qr_code : `data:image/png;base64,${connection.qr_code}`} alt="QR code" className="w-48 h-48" />
            </div>
            <p className="text-sm text-[var(--ink-500)] mt-3">{t('scan')}</p>
            <p className="text-xs text-[var(--ink-400)] mt-1">{t('waiting')}</p>
            <p className="text-xs text-[var(--gold)] mt-2 font-medium">{t('renewIn', { seconds: countdown })}</p>
          </div>
          <Button variant="outline" className="w-full gap-2" onClick={loadConnection}><RefreshCw className="size-4" />{t('refreshStatus')}</Button>
        </div>
      ) : connection?.qr_code && isQrExpired ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-[var(--warning-100)] bg-[var(--warning-50)] p-6 text-center">
            <QrCode className="size-10 mx-auto mb-3 text-[var(--warning)] opacity-50" />
            <p className="text-sm font-medium text-[var(--warning-700)]">{t('qrExpired')}</p>
            <p className="text-xs text-[var(--warning-600)] mt-1 mb-4">{t('qrExpiredHint')}</p>
            <Button className="btn-gold gap-2" onClick={refreshQr} disabled={refreshing}>
              {refreshing ? <Spinner className="size-4" /> : <RefreshCw className="size-4" />}
              {t('newQr')}
            </Button>
          </div>
        </div>
      ) : connecting && showRetry ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-[var(--warning-100)] bg-[var(--warning-50)] p-4 text-center">
            <p className="text-sm font-medium text-[var(--warning-700)]">{t('slow')}</p>
            <p className="text-xs text-[var(--warning-600)] mt-1">{t('slowHint')}</p>
          </div>
          <Button className="btn-gold gap-2 w-full" onClick={connect} disabled={connecting}>
            {connecting ? <Spinner className="size-4" /> : <RefreshCw className="size-4" />}
            {t('retry')}
          </Button>
        </div>
      ) : connecting ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-dashed border-[var(--gold-200)] bg-[var(--gold-50)] p-6 text-center">
            <Spinner className="size-8 mx-auto mb-3 text-[var(--gold)]" />
            <p className="text-sm font-medium">{t('connecting')}</p>
            <p className="text-xs text-[var(--ink-500)] mt-1">{t('generating')}</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border border-dashed border-[var(--gold-200)] bg-[var(--gold-50)] p-6 text-center">
            <QrCode className="size-10 mx-auto mb-3 text-[var(--gold)]" />
            <p className="text-sm font-medium mb-1">{t('oneClick')}</p>
            <p className="text-xs text-[var(--ink-500)] mb-4">{t('oneClickHint')}</p>
            <Button className="btn-gold gap-2" onClick={connect} disabled={connecting}>{connecting ? <Spinner className="size-4" /> : <Phone className="size-4" />}{t('connect')}</Button>
          </div>
        </div>
      )}
    </div>
  )
}
