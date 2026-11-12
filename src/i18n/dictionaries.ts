import common from './texts/common'
import layout from './texts/layout'
import auth from './texts/auth'
import dashboard from './texts/dashboard'
import booking from './texts/booking'
import onboarding from './texts/onboarding'
import agenda from './texts/agenda'
import clients from './texts/clients'
import conversations from './texts/conversations'
import catalog from './texts/catalog'
import reports from './texts/reports'
import finance from './texts/finance'
import studio from './texts/studio'
import settings from './texts/settings'
import sales from './texts/sales'

// One entry per screen/area. To add a language: add it to Lang and to each
// texts/*.ts file (defineTexts enforces identical keys).
const all = { common, layout, auth, dashboard, booking, onboarding, agenda, clients, conversations, catalog, reports, finance, studio, settings, sales }

type All = typeof all
export type Lang = 'pt' | 'es'
export type Dictionaries = { [L in Lang]: { [N in keyof All]: All[N]['pt'] } }

function build(lang: Lang) {
  const out = {} as { [N in keyof All]: All[N]['pt'] }
  for (const ns of Object.keys(all) as (keyof All)[]) {
    (out as Record<string, unknown>)[ns] = all[ns][lang]
  }
  return out
}

export const dictionaries: Dictionaries = { pt: build('pt'), es: build('es') }
