import { useAuth } from '@/contexts/AuthContext'
import { Label } from '@/components/ui/label'
import { useT } from '@/i18n'
import { WhatsAppConnect } from '@/components/WhatsAppConnect'
import { MyPlanCard } from '@/components/MyPlanCard'
import { OfficialApiCard } from '@/components/OfficialApiCard'

export function ConfiguracoesPage() {
  const tc = useT('common')
  const t = useT('settings')
  const { profile } = useAuth()

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div><h1 className="text-2xl font-serif font-medium">{t('title')}</h1><p className="text-sm text-[var(--ink-500)] mt-0.5">{t('subtitle')}</p></div>

      <MyPlanCard />
      <WhatsAppConnect />
      <OfficialApiCard />

      {/* Account info */}
      <div className="luxury-card p-6">
        <h2 className="font-serif font-medium text-lg mb-4">{t('account')}</h2>
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between py-2 border-b border-[var(--ink-200)]"><Label>{tc('email')}</Label><span className="text-[var(--ink-600)]">{profile?.email}</span></div>
          <div className="flex items-center justify-between py-2 border-b border-[var(--ink-200)]"><Label>{tc('name')}</Label><span className="text-[var(--ink-600)]">{profile?.name}</span></div>
          <div className="flex items-center justify-between py-2"><Label>{t('role')}</Label><span className="text-[var(--ink-600)] capitalize">{profile?.role}</span></div>
        </div>
      </div>
    </div>
  )
}
