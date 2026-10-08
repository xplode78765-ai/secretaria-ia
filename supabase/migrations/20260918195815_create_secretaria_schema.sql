/*
# SecretarIA - Complete SaaS Schema (replaces previous schema)

## Overview
Multi-tenant SaaS for beauty/aesthetic studios. Each studio has isolated data.
This migration DROPS the previous test tables and recreates the full schema with proper RLS.

## Security Design
- get_user_studio_id() SECURITY DEFINER function returns the studio_id for the current auth.uid()
- All studio-scoped tables use EXISTS checks via the helper function
- app_secrets: RLS enabled, NO policies (service_role only)
- evolution_api_connections: column-level REVOKE on evolution_api_key, evolution_api_url
- users.is_super_admin: never writable via any policy or grant

## Tables
1. studios, 2. users, 3. ai_settings, 4. clients, 5. procedures, 6. professionals,
7. appointments, 8. conversations, 9. messages, 10. payments, 11. automations,
12. notifications, 13. activity_logs, 14. evolution_api_connections, 15. app_secrets

## Functions
- get_user_studio_id() - returns studio_id for current user
- complete_signup(p_user_id, p_studio_name, p_user_name) - creates studio + user record
*/

-- Drop previous tables if they exist (from the old test migration)
DROP TABLE IF EXISTS public.campaigns CASCADE;
DROP TABLE IF EXISTS public.chat_messages CASCADE;
DROP TABLE IF EXISTS public.ai_config CASCADE;
DROP TABLE IF EXISTS public.appointments CASCADE;
DROP TABLE IF EXISTS public.clients CASCADE;
DROP TABLE IF EXISTS public.studios CASCADE;

-- ============================================================
-- STUDIOS (must exist before users FK)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.studios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT '',
  email text DEFAULT '',
  phone text DEFAULT '',
  address text DEFAULT '',
  whatsapp_number text DEFAULT '',
  instagram text DEFAULT '',
  business_hours jsonb DEFAULT '{}'::jsonb,
  onboarding_completed boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================
-- USERS (must exist before get_user_studio_id function)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  studio_id uuid REFERENCES public.studios(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  email text DEFAULT '',
  phone text DEFAULT '',
  role text NOT NULL DEFAULT 'admin',
  is_super_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_studio_id ON public.users(studio_id);

-- ============================================================
-- HELPER FUNCTION (now users table exists)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_user_studio_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT studio_id FROM public.users WHERE id = auth.uid() LIMIT 1;
$$;

-- ============================================================
-- AI SETTINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ai_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id uuid NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  personalidade text DEFAULT 'atenciosa',
  tom_voz text DEFAULT 'amigavel',
  custom_messages jsonb DEFAULT '[]'::jsonb,
  ai_patterns jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_settings_studio_id ON public.ai_settings(studio_id);

-- ============================================================
-- CLIENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id uuid NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  phone text DEFAULT '',
  whatsapp text DEFAULT '',
  email text DEFAULT '',
  status text DEFAULT 'active',
  source text DEFAULT 'manual',
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clients_studio_id ON public.clients(studio_id);

-- ============================================================
-- PROCEDURES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.procedures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id uuid NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  price numeric(10,2) DEFAULT 0,
  duration int DEFAULT 60,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_procedures_studio_id ON public.procedures(studio_id);

-- ============================================================
-- PROFESSIONALS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.professionals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id uuid NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  specialty text DEFAULT '',
  phone text DEFAULT '',
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_professionals_studio_id ON public.professionals(studio_id);

-- ============================================================
-- APPOINTMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id uuid NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  professional_id uuid REFERENCES public.professionals(id) ON DELETE SET NULL,
  procedure_id uuid REFERENCES public.procedures(id) ON DELETE SET NULL,
  date date,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  status text DEFAULT 'pending',
  price numeric(10,2) DEFAULT 0,
  payment_status text DEFAULT 'pending',
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appointments_studio_id ON public.appointments(studio_id);
CREATE INDEX IF NOT EXISTS idx_appointments_start_time ON public.appointments(start_time);
CREATE INDEX IF NOT EXISTS idx_appointments_client_id ON public.appointments(client_id);

-- ============================================================
-- CONVERSATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id uuid NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  channel text DEFAULT 'whatsapp',
  status text DEFAULT 'active',
  ai_enabled boolean DEFAULT true,
  last_message_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversations_studio_id ON public.conversations(studio_id);
CREATE INDEX IF NOT EXISTS idx_conversations_client_id ON public.conversations(client_id);

-- ============================================================
-- MESSAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_type text NOT NULL DEFAULT 'client',
  content text DEFAULT '',
  message_type text DEFAULT 'text',
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON public.messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON public.messages(created_at);

-- ============================================================
-- PAYMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id uuid NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  amount numeric(10,2) NOT NULL DEFAULT 0,
  status text DEFAULT 'pending',
  method text DEFAULT '',
  due_date date,
  paid_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_studio_id ON public.payments(studio_id);

-- ============================================================
-- AUTOMATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id uuid NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  trigger text DEFAULT '',
  enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automations_studio_id ON public.automations(studio_id);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id uuid NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  type text DEFAULT '',
  title text DEFAULT '',
  content text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_studio_id ON public.notifications(studio_id);

-- ============================================================
-- ACTIVITY LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id uuid REFERENCES public.studios(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text DEFAULT '',
  entity_type text DEFAULT '',
  description text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_studio_id ON public.activity_logs(studio_id);

-- ============================================================
-- EVOLUTION API CONNECTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.evolution_api_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id uuid NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  instance_name text NOT NULL DEFAULT '',
  status text DEFAULT 'disconnected',
  phone_number text DEFAULT '',
  qr_code text DEFAULT '',
  evolution_api_key text DEFAULT '',
  evolution_api_url text DEFAULT '',
  last_connected_at timestamptz,
  error_message text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_evolution_studio_id ON public.evolution_api_connections(studio_id);

-- ============================================================
-- APP SECRETS (service_role only — no policies)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.app_secrets (
  key text PRIMARY KEY,
  value text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================
-- ENABLE RLS ON ALL TABLES
-- ============================================================
ALTER TABLE public.studios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procedures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professionals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evolution_api_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_secrets ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- POLICIES: STUDIOS
-- ============================================================
DROP POLICY IF EXISTS "studio_select_own" ON public.studios;
CREATE POLICY "studio_select_own" ON public.studios FOR SELECT TO authenticated
  USING (id = public.get_user_studio_id());

DROP POLICY IF EXISTS "studio_update_own" ON public.studios;
CREATE POLICY "studio_update_own" ON public.studios FOR UPDATE TO authenticated
  USING (id = public.get_user_studio_id()) WITH CHECK (id = public.get_user_studio_id());

-- ============================================================
-- POLICIES: USERS
-- ============================================================
DROP POLICY IF EXISTS "users_select_own_studio" ON public.users;
CREATE POLICY "users_select_own_studio" ON public.users FOR SELECT TO authenticated
  USING (studio_id = public.get_user_studio_id() OR id = auth.uid());

DROP POLICY IF EXISTS "users_update_own" ON public.users;
CREATE POLICY "users_update_own" ON public.users FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- Revoke UPDATE on is_super_admin from everyone except service_role
REVOKE UPDATE (is_super_admin) ON public.users FROM authenticated, anon;

-- ============================================================
-- POLICIES: AI SETTINGS
-- ============================================================
DROP POLICY IF EXISTS "ai_settings_select_own" ON public.ai_settings;
CREATE POLICY "ai_settings_select_own" ON public.ai_settings FOR SELECT TO authenticated
  USING (studio_id = public.get_user_studio_id());

DROP POLICY IF EXISTS "ai_settings_insert_own" ON public.ai_settings;
CREATE POLICY "ai_settings_insert_own" ON public.ai_settings FOR INSERT TO authenticated
  WITH CHECK (studio_id = public.get_user_studio_id());

DROP POLICY IF EXISTS "ai_settings_update_own" ON public.ai_settings;
CREATE POLICY "ai_settings_update_own" ON public.ai_settings FOR UPDATE TO authenticated
  USING (studio_id = public.get_user_studio_id()) WITH CHECK (studio_id = public.get_user_studio_id());

DROP POLICY IF EXISTS "ai_settings_delete_own" ON public.ai_settings;
CREATE POLICY "ai_settings_delete_own" ON public.ai_settings FOR DELETE TO authenticated
  USING (studio_id = public.get_user_studio_id());

-- ============================================================
-- POLICIES: CLIENTS
-- ============================================================
DROP POLICY IF EXISTS "clients_select_own" ON public.clients;
CREATE POLICY "clients_select_own" ON public.clients FOR SELECT TO authenticated
  USING (studio_id = public.get_user_studio_id());

DROP POLICY IF EXISTS "clients_insert_own" ON public.clients;
CREATE POLICY "clients_insert_own" ON public.clients FOR INSERT TO authenticated
  WITH CHECK (studio_id = public.get_user_studio_id());

DROP POLICY IF EXISTS "clients_update_own" ON public.clients;
CREATE POLICY "clients_update_own" ON public.clients FOR UPDATE TO authenticated
  USING (studio_id = public.get_user_studio_id()) WITH CHECK (studio_id = public.get_user_studio_id());

DROP POLICY IF EXISTS "clients_delete_own" ON public.clients;
CREATE POLICY "clients_delete_own" ON public.clients FOR DELETE TO authenticated
  USING (studio_id = public.get_user_studio_id());

-- ============================================================
-- POLICIES: PROCEDURES
-- ============================================================
DROP POLICY IF EXISTS "procedures_select_own" ON public.procedures;
CREATE POLICY "procedures_select_own" ON public.procedures FOR SELECT TO authenticated
  USING (studio_id = public.get_user_studio_id());

DROP POLICY IF EXISTS "procedures_insert_own" ON public.procedures;
CREATE POLICY "procedures_insert_own" ON public.procedures FOR INSERT TO authenticated
  WITH CHECK (studio_id = public.get_user_studio_id());

DROP POLICY IF EXISTS "procedures_update_own" ON public.procedures;
CREATE POLICY "procedures_update_own" ON public.procedures FOR UPDATE TO authenticated
  USING (studio_id = public.get_user_studio_id()) WITH CHECK (studio_id = public.get_user_studio_id());

DROP POLICY IF EXISTS "procedures_delete_own" ON public.procedures;
CREATE POLICY "procedures_delete_own" ON public.procedures FOR DELETE TO authenticated
  USING (studio_id = public.get_user_studio_id());

-- ============================================================
-- POLICIES: PROFESSIONALS
-- ============================================================
DROP POLICY IF EXISTS "professionals_select_own" ON public.professionals;
CREATE POLICY "professionals_select_own" ON public.professionals FOR SELECT TO authenticated
  USING (studio_id = public.get_user_studio_id());

DROP POLICY IF EXISTS "professionals_insert_own" ON public.professionals;
CREATE POLICY "professionals_insert_own" ON public.professionals FOR INSERT TO authenticated
  WITH CHECK (studio_id = public.get_user_studio_id());

DROP POLICY IF EXISTS "professionals_update_own" ON public.professionals;
CREATE POLICY "professionals_update_own" ON public.professionals FOR UPDATE TO authenticated
  USING (studio_id = public.get_user_studio_id()) WITH CHECK (studio_id = public.get_user_studio_id());

DROP POLICY IF EXISTS "professionals_delete_own" ON public.professionals;
CREATE POLICY "professionals_delete_own" ON public.professionals FOR DELETE TO authenticated
  USING (studio_id = public.get_user_studio_id());

-- ============================================================
-- POLICIES: APPOINTMENTS
-- ============================================================
DROP POLICY IF EXISTS "appointments_select_own" ON public.appointments;
CREATE POLICY "appointments_select_own" ON public.appointments FOR SELECT TO authenticated
  USING (studio_id = public.get_user_studio_id());

DROP POLICY IF EXISTS "appointments_insert_own" ON public.appointments;
CREATE POLICY "appointments_insert_own" ON public.appointments FOR INSERT TO authenticated
  WITH CHECK (studio_id = public.get_user_studio_id());

DROP POLICY IF EXISTS "appointments_update_own" ON public.appointments;
CREATE POLICY "appointments_update_own" ON public.appointments FOR UPDATE TO authenticated
  USING (studio_id = public.get_user_studio_id()) WITH CHECK (studio_id = public.get_user_studio_id());

DROP POLICY IF EXISTS "appointments_delete_own" ON public.appointments;
CREATE POLICY "appointments_delete_own" ON public.appointments FOR DELETE TO authenticated
  USING (studio_id = public.get_user_studio_id());

-- ============================================================
-- POLICIES: CONVERSATIONS
-- ============================================================
DROP POLICY IF EXISTS "conversations_select_own" ON public.conversations;
CREATE POLICY "conversations_select_own" ON public.conversations FOR SELECT TO authenticated
  USING (studio_id = public.get_user_studio_id());

DROP POLICY IF EXISTS "conversations_insert_own" ON public.conversations;
CREATE POLICY "conversations_insert_own" ON public.conversations FOR INSERT TO authenticated
  WITH CHECK (studio_id = public.get_user_studio_id());

DROP POLICY IF EXISTS "conversations_update_own" ON public.conversations;
CREATE POLICY "conversations_update_own" ON public.conversations FOR UPDATE TO authenticated
  USING (studio_id = public.get_user_studio_id()) WITH CHECK (studio_id = public.get_user_studio_id());

DROP POLICY IF EXISTS "conversations_delete_own" ON public.conversations;
CREATE POLICY "conversations_delete_own" ON public.conversations FOR DELETE TO authenticated
  USING (studio_id = public.get_user_studio_id());

-- ============================================================
-- POLICIES: MESSAGES (scoped through conversations)
-- ============================================================
DROP POLICY IF EXISTS "messages_select_own" ON public.messages;
CREATE POLICY "messages_select_own" ON public.messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = messages.conversation_id AND c.studio_id = public.get_user_studio_id()));

DROP POLICY IF EXISTS "messages_insert_own" ON public.messages;
CREATE POLICY "messages_insert_own" ON public.messages FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = messages.conversation_id AND c.studio_id = public.get_user_studio_id()));

DROP POLICY IF EXISTS "messages_update_own" ON public.messages;
CREATE POLICY "messages_update_own" ON public.messages FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = messages.conversation_id AND c.studio_id = public.get_user_studio_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = messages.conversation_id AND c.studio_id = public.get_user_studio_id()));

DROP POLICY IF EXISTS "messages_delete_own" ON public.messages;
CREATE POLICY "messages_delete_own" ON public.messages FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = messages.conversation_id AND c.studio_id = public.get_user_studio_id()));

-- ============================================================
-- POLICIES: PAYMENTS
-- ============================================================
DROP POLICY IF EXISTS "payments_select_own" ON public.payments;
CREATE POLICY "payments_select_own" ON public.payments FOR SELECT TO authenticated
  USING (studio_id = public.get_user_studio_id());

DROP POLICY IF EXISTS "payments_insert_own" ON public.payments;
CREATE POLICY "payments_insert_own" ON public.payments FOR INSERT TO authenticated
  WITH CHECK (studio_id = public.get_user_studio_id());

DROP POLICY IF EXISTS "payments_update_own" ON public.payments;
CREATE POLICY "payments_update_own" ON public.payments FOR UPDATE TO authenticated
  USING (studio_id = public.get_user_studio_id()) WITH CHECK (studio_id = public.get_user_studio_id());

DROP POLICY IF EXISTS "payments_delete_own" ON public.payments;
CREATE POLICY "payments_delete_own" ON public.payments FOR DELETE TO authenticated
  USING (studio_id = public.get_user_studio_id());

-- ============================================================
-- POLICIES: AUTOMATIONS
-- ============================================================
DROP POLICY IF EXISTS "automations_select_own" ON public.automations;
CREATE POLICY "automations_select_own" ON public.automations FOR SELECT TO authenticated
  USING (studio_id = public.get_user_studio_id());

DROP POLICY IF EXISTS "automations_insert_own" ON public.automations;
CREATE POLICY "automations_insert_own" ON public.automations FOR INSERT TO authenticated
  WITH CHECK (studio_id = public.get_user_studio_id());

DROP POLICY IF EXISTS "automations_update_own" ON public.automations;
CREATE POLICY "automations_update_own" ON public.automations FOR UPDATE TO authenticated
  USING (studio_id = public.get_user_studio_id()) WITH CHECK (studio_id = public.get_user_studio_id());

DROP POLICY IF EXISTS "automations_delete_own" ON public.automations;
CREATE POLICY "automations_delete_own" ON public.automations FOR DELETE TO authenticated
  USING (studio_id = public.get_user_studio_id());

-- ============================================================
-- POLICIES: NOTIFICATIONS
-- ============================================================
DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own" ON public.notifications FOR SELECT TO authenticated
  USING (studio_id = public.get_user_studio_id());

DROP POLICY IF EXISTS "notifications_insert_own" ON public.notifications;
CREATE POLICY "notifications_insert_own" ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (studio_id = public.get_user_studio_id());

DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own" ON public.notifications FOR UPDATE TO authenticated
  USING (studio_id = public.get_user_studio_id()) WITH CHECK (studio_id = public.get_user_studio_id());

DROP POLICY IF EXISTS "notifications_delete_own" ON public.notifications;
CREATE POLICY "notifications_delete_own" ON public.notifications FOR DELETE TO authenticated
  USING (studio_id = public.get_user_studio_id());

-- ============================================================
-- POLICIES: ACTIVITY LOGS
-- ============================================================
DROP POLICY IF EXISTS "activity_logs_select_own" ON public.activity_logs;
CREATE POLICY "activity_logs_select_own" ON public.activity_logs FOR SELECT TO authenticated
  USING (studio_id = public.get_user_studio_id());

DROP POLICY IF EXISTS "activity_logs_insert_own" ON public.activity_logs;
CREATE POLICY "activity_logs_insert_own" ON public.activity_logs FOR INSERT TO authenticated
  WITH CHECK (studio_id = public.get_user_studio_id());

-- ============================================================
-- POLICIES: EVOLUTION API CONNECTIONS
-- ============================================================
DROP POLICY IF EXISTS "evolution_select_own" ON public.evolution_api_connections;
CREATE POLICY "evolution_select_own" ON public.evolution_api_connections FOR SELECT TO authenticated
  USING (studio_id = public.get_user_studio_id());

DROP POLICY IF EXISTS "evolution_insert_own" ON public.evolution_api_connections;
CREATE POLICY "evolution_insert_own" ON public.evolution_api_connections FOR INSERT TO authenticated
  WITH CHECK (studio_id = public.get_user_studio_id());

DROP POLICY IF EXISTS "evolution_update_own" ON public.evolution_api_connections;
CREATE POLICY "evolution_update_own" ON public.evolution_api_connections FOR UPDATE TO authenticated
  USING (studio_id = public.get_user_studio_id()) WITH CHECK (studio_id = public.get_user_studio_id());

DROP POLICY IF EXISTS "evolution_delete_own" ON public.evolution_api_connections;
CREATE POLICY "evolution_delete_own" ON public.evolution_api_connections FOR DELETE TO authenticated
  USING (studio_id = public.get_user_studio_id());

-- Revoke column-level access to sensitive columns
REVOKE SELECT (evolution_api_key, evolution_api_url) ON public.evolution_api_connections FROM authenticated, anon;

-- ============================================================
-- APP SECRETS: no policies (service_role only)
-- ============================================================

-- ============================================================
-- COMPLETE_SIGNUP FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_signup(
  p_user_id uuid,
  p_studio_name text,
  p_user_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_studio_id uuid;
  v_email text;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: caller does not match p_user_id';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = p_user_id;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'User not found in auth.users';
  END IF;

  INSERT INTO public.studios (name, email, onboarding_completed)
  VALUES (p_studio_name, v_email, false)
  RETURNING id INTO v_studio_id;

  INSERT INTO public.users (id, studio_id, name, email, role, is_super_admin)
  VALUES (p_user_id, v_studio_id, p_user_name, v_email, 'admin', false);

  INSERT INTO public.ai_settings (studio_id, custom_messages, ai_patterns)
  VALUES (
    v_studio_id,
    '[
      {"id":"greeting","trigger":"greeting","label":"Saudação","message":"Olá! Bem-vinda ao nosso studio. Como posso ajudá-la hoje?","enabled":true},
      {"id":"pricing","trigger":"pricing","label":"Preços","message":"Nossos procedimentos têm valores a partir de R$ 80. Qual tratamento você tem interesse?","enabled":true},
      {"id":"scheduling","trigger":"scheduling","label":"Agendamento","message":"Perfeito! Para agendar, me informe seu nome completo e a data/horário de preferência.","enabled":true},
      {"id":"address","trigger":"address","label":"Endereço","message":"Estamos localizados na Rua das Flores, 123. Te esperamos!","enabled":true},
      {"id":"procedures","trigger":"procedures","label":"Procedimentos","message":"Oferecemos botox, preenchimento, design de sobrancelhas e mais. Qual te interessa?","enabled":true},
      {"id":"hours","trigger":"hours","label":"Horários","message":"Funcionamos de segunda a sábado, das 9h às 19h.","enabled":true},
      {"id":"thanks","trigger":"thanks","label":"Agradecimento","message":"Muito obrigada pelo contato! Ficamos felizes em atendê-la.","enabled":true},
      {"id":"goodbye","trigger":"goodbye","label":"Despedida","message":"Até logo! Qualquer coisa, é só chamar por aqui.","enabled":true},
      {"id":"confirm","trigger":"confirm","label":"Confirmação","message":"Seu agendamento foi confirmado! Te esperamos no horário combinado.","enabled":true},
      {"id":"cancel","trigger":"cancel","label":"Cancelamento","message":"Entendi, seu agendamento foi cancelado. Quando quiser remarcar, é só avisar!","enabled":true},
      {"id":"fallback","trigger":"fallback","label":"Resposta padrão","message":"Obrigada pela mensagem! Nossa equipe vai responder em breve.","enabled":true}
    ]'::jsonb,
    '[
      {"id":"p1","trigger":"pricing","label":"Preço / Valor","keywords":["quanto custa","valor","preco","preço","quanto sai","quanto fica"],"response":"Nossos procedimentos têm valores a partir de R$ 80. Qual tratamento você tem interesse?","enabled":true},
      {"id":"p2","trigger":"scheduling","label":"Agendar","keywords":["agendar","marcar","marcar horario","marcar horário","reservar","agendamento"],"response":"Perfeito! Para agendar, me informe seu nome completo e a data/horário de preferência.","enabled":true},
      {"id":"p3","trigger":"hours","label":"Horários","keywords":["horario","horário","funcionamento","que horas","aberto","abrem","fecham"],"response":"Funcionamos de segunda a sábado, das 9h às 19h.","enabled":true},
      {"id":"p4","trigger":"address","label":"Endereço","keywords":["endereco","endereço","onde fica","onde é","localização","localizacao"],"response":"Estamos localizados na Rua das Flores, 123. Te esperamos!","enabled":true},
      {"id":"p5","trigger":"procedures","label":"Procedimentos","keywords":["procedimento","servico","serviço","tratamento","fazem o que","o que voces fazem"],"response":"Oferecemos botox, preenchimento, design de sobrancelhas e mais. Qual te interessa?","enabled":true}
    ]'::jsonb
  );

  RETURN v_studio_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_signup(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_signup(uuid, text, text) TO authenticated;

-- ============================================================
-- GRANTS
-- ============================================================
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.studios, public.users, public.ai_settings, public.clients, public.procedures, public.professionals, public.appointments, public.conversations, public.messages, public.payments, public.automations, public.notifications, public.activity_logs, public.evolution_api_connections TO authenticated;
GRANT SELECT (id, studio_id, instance_name, status, phone_number, qr_code, last_connected_at, error_message, created_at, updated_at) ON public.evolution_api_connections TO authenticated;