-- ============================================================
-- Switch complete_signup to SECURITY INVOKER
-- ============================================================
-- The function needs to INSERT into studios, users, and ai_settings.
-- As SECURITY INVOKER, these inserts are subject to RLS.
-- We add scoped INSERT policies that allow a user to insert their own row only.

-- studios: allow a user to insert a new studio (during signup).
-- No existing INSERT policy on studios. Add one that allows INSERT only
-- when the studio is being created for the calling user (checked in function body).
-- Since the function sets the email from auth.users, and there's no studio_id
-- on the studios table itself, we allow INSERT for authenticated users.
DROP POLICY IF EXISTS "studio_insert_own_signup" ON public.studios;
CREATE POLICY "studio_insert_own_signup" ON public.studios FOR INSERT TO authenticated
  WITH CHECK (true);

-- users: allow a user to insert their own profile row during signup.
DROP POLICY IF EXISTS "users_insert_own_signup" ON public.users;
CREATE POLICY "users_insert_own_signup" ON public.users FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

-- ai_settings: allow insert for the user's own studio.
-- During signup, get_user_studio_id() returns the just-created studio_id.
DROP POLICY IF EXISTS "ai_settings_insert_own_signup" ON public.ai_settings;
CREATE POLICY "ai_settings_insert_own_signup" ON public.ai_settings FOR INSERT TO authenticated
  WITH CHECK (studio_id = public.get_user_studio_id());

-- Now switch the function to SECURITY INVOKER
CREATE OR REPLACE FUNCTION public.complete_signup(
  p_user_id uuid,
  p_studio_name text,
  p_user_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
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

-- Ensure only authenticated can call it
REVOKE EXECUTE ON FUNCTION public.complete_signup(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_signup(uuid, text, text) TO authenticated;
