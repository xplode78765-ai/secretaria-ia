UPDATE public.users SET role = 'owner' WHERE role = 'admin' AND coalesce(is_super_admin, false) = false;

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM public.users WHERE id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_user_professional_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT professional_id FROM public.users WHERE id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.user_is_owner()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT coalesce(public.get_user_role(), '') IN ('owner', 'admin');
$$;

CREATE OR REPLACE FUNCTION public.user_is_staff()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT coalesce(public.get_user_role(), '') IN ('owner', 'admin', 'reception');
$$;

GRANT EXECUTE ON FUNCTION public.get_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_professional_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_is_owner() TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_is_staff() TO authenticated;

-- Studios: only owners update
DROP POLICY IF EXISTS "studio_update_own" ON public.studios;
CREATE POLICY "studio_update_own" ON public.studios FOR UPDATE TO authenticated
  USING (id = public.get_user_studio_id() AND public.user_is_owner())
  WITH CHECK (id = public.get_user_studio_id() AND public.user_is_owner());

-- AI / automations / evolution: owners
DROP POLICY IF EXISTS "ai_settings_insert_own" ON public.ai_settings;
DROP POLICY IF EXISTS "ai_settings_update_own" ON public.ai_settings;
DROP POLICY IF EXISTS "ai_settings_delete_own" ON public.ai_settings;
CREATE POLICY "ai_settings_insert_own" ON public.ai_settings FOR INSERT TO authenticated
  WITH CHECK (studio_id = public.get_user_studio_id() AND public.user_is_owner());
CREATE POLICY "ai_settings_update_own" ON public.ai_settings FOR UPDATE TO authenticated
  USING (studio_id = public.get_user_studio_id() AND public.user_is_owner())
  WITH CHECK (studio_id = public.get_user_studio_id() AND public.user_is_owner());
CREATE POLICY "ai_settings_delete_own" ON public.ai_settings FOR DELETE TO authenticated
  USING (studio_id = public.get_user_studio_id() AND public.user_is_owner());

DROP POLICY IF EXISTS "automations_insert_own" ON public.automations;
DROP POLICY IF EXISTS "automations_update_own" ON public.automations;
DROP POLICY IF EXISTS "automations_delete_own" ON public.automations;
CREATE POLICY "automations_insert_own" ON public.automations FOR INSERT TO authenticated
  WITH CHECK (studio_id = public.get_user_studio_id() AND public.user_is_owner());
CREATE POLICY "automations_update_own" ON public.automations FOR UPDATE TO authenticated
  USING (studio_id = public.get_user_studio_id() AND public.user_is_owner())
  WITH CHECK (studio_id = public.get_user_studio_id() AND public.user_is_owner());
CREATE POLICY "automations_delete_own" ON public.automations FOR DELETE TO authenticated
  USING (studio_id = public.get_user_studio_id() AND public.user_is_owner());

DROP POLICY IF EXISTS "evolution_insert_own" ON public.evolution_api_connections;
DROP POLICY IF EXISTS "evolution_update_own" ON public.evolution_api_connections;
DROP POLICY IF EXISTS "evolution_delete_own" ON public.evolution_api_connections;
CREATE POLICY "evolution_insert_own" ON public.evolution_api_connections FOR INSERT TO authenticated
  WITH CHECK (studio_id = public.get_user_studio_id() AND public.user_is_owner());
CREATE POLICY "evolution_update_own" ON public.evolution_api_connections FOR UPDATE TO authenticated
  USING (studio_id = public.get_user_studio_id() AND public.user_is_owner())
  WITH CHECK (studio_id = public.get_user_studio_id() AND public.user_is_owner());
CREATE POLICY "evolution_delete_own" ON public.evolution_api_connections FOR DELETE TO authenticated
  USING (studio_id = public.get_user_studio_id() AND public.user_is_owner());

REVOKE UPDATE (evolution_api_key, evolution_api_url) ON public.evolution_api_connections FROM authenticated;

-- Payments + procedures/professionals writes: staff
DROP POLICY IF EXISTS "payments_select_own" ON public.payments;
DROP POLICY IF EXISTS "payments_insert_own" ON public.payments;
DROP POLICY IF EXISTS "payments_update_own" ON public.payments;
DROP POLICY IF EXISTS "payments_delete_own" ON public.payments;
CREATE POLICY "payments_select_own" ON public.payments FOR SELECT TO authenticated
  USING (studio_id = public.get_user_studio_id() AND public.user_is_staff());
CREATE POLICY "payments_insert_own" ON public.payments FOR INSERT TO authenticated
  WITH CHECK (studio_id = public.get_user_studio_id() AND public.user_is_staff());
CREATE POLICY "payments_update_own" ON public.payments FOR UPDATE TO authenticated
  USING (studio_id = public.get_user_studio_id() AND public.user_is_staff())
  WITH CHECK (studio_id = public.get_user_studio_id() AND public.user_is_staff());
CREATE POLICY "payments_delete_own" ON public.payments FOR DELETE TO authenticated
  USING (studio_id = public.get_user_studio_id() AND public.user_is_staff());

DROP POLICY IF EXISTS "procedures_insert_own" ON public.procedures;
DROP POLICY IF EXISTS "procedures_update_own" ON public.procedures;
DROP POLICY IF EXISTS "procedures_delete_own" ON public.procedures;
CREATE POLICY "procedures_insert_own" ON public.procedures FOR INSERT TO authenticated
  WITH CHECK (studio_id = public.get_user_studio_id() AND public.user_is_staff());
CREATE POLICY "procedures_update_own" ON public.procedures FOR UPDATE TO authenticated
  USING (studio_id = public.get_user_studio_id() AND public.user_is_staff())
  WITH CHECK (studio_id = public.get_user_studio_id() AND public.user_is_staff());
CREATE POLICY "procedures_delete_own" ON public.procedures FOR DELETE TO authenticated
  USING (studio_id = public.get_user_studio_id() AND public.user_is_staff());

DROP POLICY IF EXISTS "professionals_insert_own" ON public.professionals;
DROP POLICY IF EXISTS "professionals_update_own" ON public.professionals;
DROP POLICY IF EXISTS "professionals_delete_own" ON public.professionals;
CREATE POLICY "professionals_insert_own" ON public.professionals FOR INSERT TO authenticated
  WITH CHECK (studio_id = public.get_user_studio_id() AND public.user_is_staff());
CREATE POLICY "professionals_update_own" ON public.professionals FOR UPDATE TO authenticated
  USING (studio_id = public.get_user_studio_id() AND public.user_is_staff())
  WITH CHECK (studio_id = public.get_user_studio_id() AND public.user_is_staff());
CREATE POLICY "professionals_delete_own" ON public.professionals FOR DELETE TO authenticated
  USING (studio_id = public.get_user_studio_id() AND public.user_is_staff());

-- Appointments: professionals only see their own rows
DROP POLICY IF EXISTS "appointments_select_own" ON public.appointments;
DROP POLICY IF EXISTS "appointments_insert_own" ON public.appointments;
DROP POLICY IF EXISTS "appointments_update_own" ON public.appointments;
DROP POLICY IF EXISTS "appointments_delete_own" ON public.appointments;
CREATE POLICY "appointments_select_own" ON public.appointments FOR SELECT TO authenticated
  USING (
    studio_id = public.get_user_studio_id()
    AND (
      public.user_is_staff()
      OR professional_id IS NULL
      OR professional_id = public.get_user_professional_id()
    )
  );
CREATE POLICY "appointments_insert_own" ON public.appointments FOR INSERT TO authenticated
  WITH CHECK (
    studio_id = public.get_user_studio_id()
    AND (
      public.user_is_staff()
      OR professional_id = public.get_user_professional_id()
    )
  );
CREATE POLICY "appointments_update_own" ON public.appointments FOR UPDATE TO authenticated
  USING (
    studio_id = public.get_user_studio_id()
    AND (public.user_is_staff() OR professional_id = public.get_user_professional_id())
  )
  WITH CHECK (
    studio_id = public.get_user_studio_id()
    AND (public.user_is_staff() OR professional_id = public.get_user_professional_id())
  );
CREATE POLICY "appointments_delete_own" ON public.appointments FOR DELETE TO authenticated
  USING (studio_id = public.get_user_studio_id() AND public.user_is_staff());

-- Storage: first folder must be studio id
DROP POLICY IF EXISTS "client_photos_insert" ON storage.objects;
CREATE POLICY "client_photos_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'client-photos'
    AND split_part(name, '/', 1) = public.get_user_studio_id()::text
  );

DROP POLICY IF EXISTS "client_photos_update" ON storage.objects;
CREATE POLICY "client_photos_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'client-photos'
    AND split_part(name, '/', 1) = public.get_user_studio_id()::text
  )
  WITH CHECK (
    bucket_id = 'client-photos'
    AND split_part(name, '/', 1) = public.get_user_studio_id()::text
  );

-- Dedup conversations then unique
DELETE FROM public.conversations a
  USING public.conversations b
  WHERE a.studio_id = b.studio_id
    AND a.client_id IS NOT NULL
    AND a.client_id = b.client_id
    AND a.created_at > b.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_studio_client
  ON public.conversations (studio_id, client_id)
  WHERE client_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_evolution_id
  ON public.messages (conversation_id, (metadata->>'evolution_message_id'))
  WHERE coalesce(metadata->>'evolution_message_id', '') <> '';

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS overlap_key uuid
  GENERATED ALWAYS AS (coalesce(professional_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED;

DO $$
BEGIN
  ALTER TABLE public.appointments
    ADD CONSTRAINT appointments_no_overlap
    EXCLUDE USING gist (
      studio_id WITH =,
      overlap_key WITH =,
      tstzrange(start_time, end_time, '[)') WITH &&
    )
    WHERE (status IS DISTINCT FROM 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN others THEN
    RAISE NOTICE 'appointments_no_overlap not created: %', SQLERRM;
END;
$$;

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
  v_existing uuid;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: caller does not match p_user_id';
  END IF;

  SELECT studio_id INTO v_existing FROM public.users WHERE id = p_user_id;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = p_user_id;
  IF v_email IS NULL THEN
    v_email := coalesce(auth.jwt() ->> 'email', '');
  END IF;
  IF v_email IS NULL OR length(v_email) = 0 THEN
    RAISE EXCEPTION 'User not found in auth.users';
  END IF;

  INSERT INTO public.studios (name, email, onboarding_completed)
  VALUES (coalesce(nullif(trim(p_studio_name), ''), 'Meu Studio'), v_email, false)
  RETURNING id INTO v_studio_id;

  IF EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id) THEN
    UPDATE public.users
    SET studio_id = v_studio_id,
        name = coalesce(nullif(trim(p_user_name), ''), name, 'Dona'),
        email = v_email,
        role = 'owner',
        is_super_admin = false
    WHERE id = p_user_id;
  ELSE
    INSERT INTO public.users (id, studio_id, name, email, role, is_super_admin)
    VALUES (p_user_id, v_studio_id, coalesce(nullif(trim(p_user_name), ''), 'Dona'), v_email, 'owner', false);
  END IF;

  INSERT INTO public.ai_settings (studio_id, custom_messages, ai_patterns)
  VALUES (
    v_studio_id,
    '[
      {"id":"greeting","trigger":"greeting","label":"Saudação","message":"Olá! Bem-vinda ao nosso studio. Como posso ajudá-la hoje?","enabled":true},
      {"id":"pricing","trigger":"pricing","label":"Preços","message":"Nossos procedimentos têm valores a partir de R$ 80. Qual tratamento você tem interesse?","enabled":true},
      {"id":"scheduling","trigger":"scheduling","label":"Agendamento","message":"Perfeito! Me informe seu nome completo e a data/horário de preferência. Nossa equipe confirma o horário na agenda.","enabled":true},
      {"id":"address","trigger":"address","label":"Endereço","message":"Estamos localizados na Rua das Flores, 123. Te esperamos!","enabled":true},
      {"id":"procedures","trigger":"procedures","label":"Procedimentos","message":"Oferecemos botox, preenchimento, design de sobrancelhas e mais. Qual te interessa?","enabled":true},
      {"id":"hours","trigger":"hours","label":"Horários","message":"Funcionamos de segunda a sábado, das 9h às 19h.","enabled":true},
      {"id":"thanks","trigger":"thanks","label":"Agradecimento","message":"Muito obrigada pelo contato! Ficamos felizes em atendê-la.","enabled":true},
      {"id":"goodbye","trigger":"goodbye","label":"Despedida","message":"Até logo! Qualquer coisa, é só chamar por aqui.","enabled":true},
      {"id":"confirm","trigger":"confirm","label":"Confirmação","message":"Anotei seu pedido. Nossa equipe confirma o horário na agenda e te responde aqui.","enabled":true},
      {"id":"cancel","trigger":"cancel","label":"Cancelamento","message":"Entendi. Vou encaminhar o pedido de cancelamento para a equipe confirmar.","enabled":true},
      {"id":"fallback","trigger":"fallback","label":"Resposta padrão","message":"Obrigada pela mensagem! Nossa equipe vai responder em breve.","enabled":true}
    ]'::jsonb,
    '[
      {"id":"p1","trigger":"pricing","label":"Preço / Valor","keywords":["quanto custa","qual o valor","preco","preço","quanto sai","quanto fica"],"response":"Nossos procedimentos têm valores a partir de R$ 80. Qual tratamento você tem interesse?","enabled":true},
      {"id":"p2","trigger":"scheduling","label":"Agendar","keywords":["agendar","marcar","marcar horario","marcar horário","reservar","agendamento"],"response":"Perfeito! Me informe seu nome completo e a data/horário de preferência. Nossa equipe confirma o horário na agenda.","enabled":true},
      {"id":"p3","trigger":"hours","label":"Horários","keywords":["horario","horário","funcionamento","que horas","aberto","abrem","fecham"],"response":"Funcionamos de segunda a sábado, das 9h às 19h.","enabled":true},
      {"id":"p4","trigger":"address","label":"Endereço","keywords":["endereco","endereço","onde fica","onde é","localização","localizacao"],"response":"Estamos localizados na Rua das Flores, 123. Te esperamos!","enabled":true},
      {"id":"p5","trigger":"procedures","label":"Procedimentos","keywords":["procedimento","servico","serviço","tratamento","fazem o que","o que voces fazem"],"response":"Oferecemos botox, preenchimento, design de sobrancelhas e mais. Qual te interessa?","enabled":true}
    ]'::jsonb
  )
  ON CONFLICT (studio_id) DO NOTHING;

  RETURN v_studio_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_signup(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_signup(uuid, text, text) TO authenticated;
