import { MessageCircle } from 'lucide-react'
import { useT } from '@/i18n'

// Floating WhatsApp support button. The number comes from VITE_SUPPORT_WHATSAPP
// (digits with country code, e.g. 5511999999999). Hidden when it is not set.
export function SupportButton() {
  const t = useT('sales')
  const number = String(import.meta.env.VITE_SUPPORT_WHATSAPP || '').replace(/\D/g, '')
  if (number.length < 10) return null
  return (
    <a
      href={`https://wa.me/${number}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('support')}
      title={t('support')}
      className="fixed bottom-4 right-4 z-30 flex items-center gap-2 rounded-full gold-gradient gold-shadow px-4 py-2.5 text-sm font-medium text-[var(--ink-900)]"
    >
      <MessageCircle className="size-4" />
      <span className="hidden sm:inline">{t('support')}</span>
    </a>
  )
}
