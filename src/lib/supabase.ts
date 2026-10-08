import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type Studio = {
  id: string
  name: string
  email: string
  phone: string
  address: string
  whatsapp_number: string
  instagram: string
  business_hours: Record<string, unknown>
  onboarding_completed: boolean
  created_at: string
  updated_at: string
}

export type UserProfile = {
  id: string
  studio_id: string | null
  name: string
  email: string
  phone: string
  role: string
  is_super_admin: boolean
  onboarding_completed: boolean
  created_at: string
  updated_at: string
}

export type CustomMessage = {
  id: string
  trigger: string
  label: string
  message: string
  enabled: boolean
}

export type AIPattern = {
  id: string
  trigger: string
  label: string
  keywords: string[]
  response: string
  enabled: boolean
}

export type AISettings = {
  id: string
  studio_id: string
  personalidade: string
  tom_voz: string
  custom_messages: CustomMessage[]
  ai_patterns: AIPattern[]
  created_at: string
  updated_at: string
}

export type Client = {
  id: string
  studio_id: string
  name: string
  phone: string
  whatsapp: string
  email: string
  status: string
  source: string
  notes: string
  created_at: string
}

export type Procedure = {
  id: string
  studio_id: string
  name: string
  price: number
  duration: number
  active: boolean
  created_at: string
}

export type Professional = {
  id: string
  studio_id: string
  name: string
  specialty: string
  phone: string
  active: boolean
  created_at: string
}

export type Appointment = {
  id: string
  studio_id: string
  client_id: string | null
  professional_id: string | null
  procedure_id: string | null
  date: string | null
  title: string
  start_time: string
  end_time: string
  status: string
  price: number
  payment_status: string
  notes: string
  created_at: string
}

export type Conversation = {
  id: string
  studio_id: string
  client_id: string | null
  channel: string
  status: string
  ai_enabled: boolean
  last_message_at: string | null
  created_at: string
}

export type Message = {
  id: string
  conversation_id: string
  sender_type: string
  content: string
  message_type: string
  metadata: Record<string, unknown>
  status: string
  created_at: string
}

export type Payment = {
  id: string
  studio_id: string
  client_id: string | null
  amount: number
  status: string
  method: string
  due_date: string | null
  paid_at: string | null
  created_at: string
}

export type Automation = {
  id: string
  studio_id: string
  name: string
  trigger: string
  enabled: boolean
  created_at: string
}

export type EvolutionConnection = {
  id: string
  studio_id: string
  instance_name: string
  status: string
  phone_number: string
  qr_code: string
  qr_code_updated_at: string | null
  last_connected_at: string | null
  error_message: string
  created_at: string
  updated_at: string
}

export type Notification = {
  id: string
  studio_id: string
  client_id: string | null
  type: string
  title: string
  content: string
  created_at: string
}

export type ActivityLog = {
  id: string
  studio_id: string | null
  user_id: string | null
  action: string
  entity_type: string
  description: string
  created_at: string
}
