import type { AIPattern, CustomMessage } from '@/lib/supabase'

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

export type MatchResult = {
  matched: boolean
  pattern: AIPattern | null
  response: string
  trigger: string
}

function matchesKeyword(normalizedMessage: string, keyword: string): boolean {
  const needle = normalizeText(keyword)
  if (!needle) return false
  if (needle.includes(' ')) return normalizedMessage.includes(needle)
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|\\s)${escaped}(?:$|\\s|[?!.,;:])`).test(normalizedMessage)
}

export function matchPattern(
  message: string,
  patterns: AIPattern[],
  customMessages: CustomMessage[]
): MatchResult {
  const normalized = normalizeText(message)

  for (const pattern of patterns) {
    if (!pattern.enabled) continue
    for (const keyword of pattern.keywords) {
      if (matchesKeyword(normalized, keyword)) {
        return { matched: true, pattern, response: pattern.response, trigger: pattern.trigger }
      }
    }
  }

  const fallback = customMessages.find(m => m.trigger === 'fallback' && m.enabled)
  const fallbackResponse = fallback?.message ?? 'Obrigada pela mensagem! Nossa equipe vai responder em breve.'

  return { matched: false, pattern: null, response: fallbackResponse, trigger: 'fallback' }
}

export const DEFAULT_CUSTOM_MESSAGES: CustomMessage[] = [
  { id: 'greeting', trigger: 'greeting', label: 'Saudação', message: 'Olá! Bem-vinda ao nosso studio. Como posso ajudá-la hoje?', enabled: true },
  { id: 'pricing', trigger: 'pricing', label: 'Preços', message: 'Nossos procedimentos têm valores a partir de R$ 80. Qual tratamento você tem interesse?', enabled: true },
  { id: 'scheduling', trigger: 'scheduling', label: 'Agendamento', message: 'Perfeito! Me informe seu nome completo e a data/horário de preferência. Nossa equipe confirma o horário na agenda.', enabled: true },
  { id: 'address', trigger: 'address', label: 'Endereço', message: 'Estamos localizados na Rua das Flores, 123. Te esperamos!', enabled: true },
  { id: 'procedures', trigger: 'procedures', label: 'Procedimentos', message: 'Oferecemos botox, preenchimento, design de sobrancelhas e mais. Qual te interessa?', enabled: true },
  { id: 'hours', trigger: 'hours', label: 'Horários', message: 'Funcionamos de segunda a sábado, das 9h às 19h.', enabled: true },
  { id: 'thanks', trigger: 'thanks', label: 'Agradecimento', message: 'Muito obrigada pelo contato! Ficamos felizes em atendê-la.', enabled: true },
  { id: 'goodbye', trigger: 'goodbye', label: 'Despedida', message: 'Até logo! Qualquer coisa, é só chamar por aqui.', enabled: true },
  { id: 'confirm', trigger: 'confirm', label: 'Confirmação', message: 'Anotei seu pedido. Nossa equipe confirma o horário na agenda e te responde aqui.', enabled: true },
  { id: 'cancel', trigger: 'cancel', label: 'Cancelamento', message: 'Entendi. Vou encaminhar o pedido de cancelamento para a equipe confirmar.', enabled: true },
  { id: 'fallback', trigger: 'fallback', label: 'Resposta padrão', message: 'Obrigada pela mensagem! Nossa equipe vai responder em breve.', enabled: true },
]

export const DEFAULT_AI_PATTERNS: AIPattern[] = [
  { id: 'p1', trigger: 'pricing', label: 'Preço / Valor', keywords: ['quanto custa', 'qual o valor', 'preco', 'preço', 'quanto sai', 'quanto fica'], response: 'Nossos procedimentos têm valores a partir de R$ 80. Qual tratamento você tem interesse?', enabled: true },
  { id: 'p2', trigger: 'scheduling', label: 'Agendar', keywords: ['agendar', 'marcar', 'marcar horario', 'marcar horário', 'reservar', 'agendamento'], response: 'Perfeito! Me informe seu nome completo e a data/horário de preferência. Nossa equipe confirma o horário na agenda.', enabled: true },
  { id: 'p3', trigger: 'hours', label: 'Horários', keywords: ['horario', 'horário', 'funcionamento', 'que horas', 'aberto', 'abrem', 'fecham'], response: 'Funcionamos de segunda a sábado, das 9h às 19h.', enabled: true },
  { id: 'p4', trigger: 'address', label: 'Endereço', keywords: ['endereco', 'endereço', 'onde fica', 'onde é', 'localização', 'localizacao'], response: 'Estamos localizados na Rua das Flores, 123. Te esperamos!', enabled: true },
  { id: 'p5', trigger: 'procedures', label: 'Procedimentos', keywords: ['procedimento', 'servico', 'serviço', 'tratamento', 'fazem o que', 'o que voces fazem'], response: 'Oferecemos botox, preenchimento, design de sobrancelhas e mais. Qual te interessa?', enabled: true },
]

// Spanish defaults, for studios whose client language (studios.locale) is "es".
export const DEFAULT_CUSTOM_MESSAGES_ES: CustomMessage[] = [
  { id: 'greeting', trigger: 'greeting', label: 'Saludo', message: '¡Hola! Bienvenida a nuestro estudio. ¿En qué te puedo ayudar hoy?', enabled: true },
  { id: 'pricing', trigger: 'pricing', label: 'Precios', message: 'Nuestros procedimientos tienen precios desde R$ 80. ¿Qué tratamiento te interesa?', enabled: true },
  { id: 'scheduling', trigger: 'scheduling', label: 'Reservas', message: '¡Perfecto! Dime tu nombre completo y la fecha/hora que prefieres. Nuestro equipo confirma el turno en la agenda.', enabled: true },
  { id: 'address', trigger: 'address', label: 'Dirección', message: 'Estamos en Calle de las Flores, 123. ¡Te esperamos!', enabled: true },
  { id: 'procedures', trigger: 'procedures', label: 'Procedimientos', message: 'Ofrecemos bótox, rellenos, diseño de cejas y más. ¿Cuál te interesa?', enabled: true },
  { id: 'hours', trigger: 'hours', label: 'Horarios', message: 'Atendemos de lunes a sábado, de 9 a 19 h.', enabled: true },
  { id: 'thanks', trigger: 'thanks', label: 'Agradecimiento', message: '¡Muchas gracias por escribirnos! Nos encanta atenderte.', enabled: true },
  { id: 'goodbye', trigger: 'goodbye', label: 'Despedida', message: '¡Hasta luego! Cualquier cosa, escríbenos por aquí.', enabled: true },
  { id: 'confirm', trigger: 'confirm', label: 'Confirmación', message: 'Anoté tu pedido. Nuestro equipo confirma el turno en la agenda y te responde aquí.', enabled: true },
  { id: 'cancel', trigger: 'cancel', label: 'Cancelación', message: 'Entendido. Paso tu pedido de cancelación al equipo para que lo confirme.', enabled: true },
  { id: 'fallback', trigger: 'fallback', label: 'Respuesta estándar', message: '¡Gracias por tu mensaje! Nuestro equipo te responderá pronto.', enabled: true },
]

export const DEFAULT_AI_PATTERNS_ES: AIPattern[] = [
  { id: 'p1', trigger: 'pricing', label: 'Precio', keywords: ['cuanto cuesta', 'cuánto cuesta', 'precio', 'cuanto sale', 'cuánto sale', 'valor'], response: 'Nuestros procedimientos tienen precios desde R$ 80. ¿Qué tratamiento te interesa?', enabled: true },
  { id: 'p2', trigger: 'scheduling', label: 'Reservar', keywords: ['reservar', 'agendar', 'turno', 'una cita', 'sacar turno', 'pedir turno'], response: '¡Perfecto! Dime tu nombre completo y la fecha/hora que prefieres. Nuestro equipo confirma el turno en la agenda.', enabled: true },
  { id: 'p3', trigger: 'hours', label: 'Horarios', keywords: ['horario', 'a que hora', 'a qué hora', 'abren', 'cierran', 'abierto'], response: 'Atendemos de lunes a sábado, de 9 a 19 h.', enabled: true },
  { id: 'p4', trigger: 'address', label: 'Dirección', keywords: ['direccion', 'dirección', 'donde queda', 'dónde queda', 'donde estan', 'dónde están', 'ubicacion', 'ubicación'], response: 'Estamos en Calle de las Flores, 123. ¡Te esperamos!', enabled: true },
  { id: 'p5', trigger: 'procedures', label: 'Procedimientos', keywords: ['procedimiento', 'servicio', 'tratamiento', 'que hacen', 'qué hacen'], response: 'Ofrecemos bótox, rellenos, diseño de cejas y más. ¿Cuál te interesa?', enabled: true },
]

export function defaultAiTemplates(locale: 'pt' | 'es') {
  return locale === 'es'
    ? { custom_messages: DEFAULT_CUSTOM_MESSAGES_ES, ai_patterns: DEFAULT_AI_PATTERNS_ES }
    : { custom_messages: DEFAULT_CUSTOM_MESSAGES, ai_patterns: DEFAULT_AI_PATTERNS }
}
