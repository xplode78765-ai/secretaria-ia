import { useI18n, type Lang } from '@/i18n'
import { cn } from '@/lib/utils'

const OPTIONS: { value: Lang; label: string; title: string }[] = [
  { value: 'pt', label: 'PT', title: 'Português' },
  { value: 'es', label: 'ES', title: 'Español' },
]

// Two-button switch: PT | ES. Used in the app header and on public pages.
export function LanguageToggle({ className, tone = 'light' }: { className?: string; tone?: 'light' | 'dark' }) {
  const { lang, setLang } = useI18n()
  return (
    <div
      role="group"
      aria-label="Idioma / Idioma"
      className={cn(
        'inline-flex items-center rounded-lg border p-0.5 text-xs font-medium',
        tone === 'dark' ? 'border-[var(--ink-600)] bg-[var(--ink-800)]' : 'border-[var(--ink-200)] bg-[var(--canvas)]',
        className,
      )}
    >
      {OPTIONS.map((o) => {
        const active = lang === o.value
        return (
          <button
            key={o.value}
            type="button"
            title={o.title}
            aria-pressed={active}
            onClick={() => setLang(o.value)}
            className={cn(
              'px-2 py-1 rounded-md transition-colors',
              active
                ? 'gold-gradient text-[var(--ink-900)]'
                : tone === 'dark' ? 'text-white/60 hover:text-white' : 'text-[var(--ink-500)] hover:text-[var(--ink-900)]',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
