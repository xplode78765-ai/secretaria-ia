import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { es as esLocale, ptBR } from 'date-fns/locale'
import type { Locale } from 'date-fns'
import { dictionaries, type Dictionaries, type Lang } from './dictionaries'

export type { Lang } from './dictionaries'

// Interface language (PT / ES). The choice is a per-viewer preference kept in
// this browser; first visit follows the browser language.
const STORAGE_KEY = 'secretaria.lang'

function detectLang(): Lang {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved === 'pt' || saved === 'es') return saved
  } catch { /* storage blocked: fall through */ }
  const nav = (typeof navigator !== 'undefined' && (navigator.languages?.[0] || navigator.language)) || 'pt'
  return nav.toLowerCase().startsWith('es') ? 'es' : 'pt'
}

type Ctx = {
  lang: Lang
  setLang: (l: Lang) => void
  /** date-fns locale for the current language */
  dateLocale: Locale
  /** BCP-47 tag for Intl / toLocaleString */
  intlLocale: string
}

const I18nContext = createContext<Ctx | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang)

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    try { window.localStorage.setItem(STORAGE_KEY, l) } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang === 'es' ? 'es' : 'pt-BR'
  }, [lang])

  const value = useMemo<Ctx>(() => ({
    lang,
    setLang,
    dateLocale: lang === 'es' ? esLocale : ptBR,
    intlLocale: lang === 'es' ? 'es' : 'pt-BR',
  }), [lang, setLang])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): Ctx {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}

type Vars = Record<string, string | number>

function interpolate(text: string, vars?: Vars) {
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
}

/** Translation outside React (e.g. helpers that receive the language). */
export function translate<N extends keyof Dictionaries['pt']>(lang: Lang, ns: N, key: keyof Dictionaries['pt'][N] & string, vars?: Vars): string {
  const table = dictionaries[lang][ns] as Record<string, string>
  const fallback = dictionaries.pt[ns] as Record<string, string>
  return interpolate(table[key] ?? fallback[key] ?? key, vars)
}

/** const t = useT('agenda'); t('title'); t('greeting', { name }) */
export function useT<N extends keyof Dictionaries['pt']>(ns: N) {
  const { lang } = useI18n()
  return useCallback(
    (key: keyof Dictionaries['pt'][N] & string, vars?: Vars) => translate(lang, ns, key, vars),
    [lang, ns],
  )
}
