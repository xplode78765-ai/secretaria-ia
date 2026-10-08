-- Generate runtime secrets when still blank, add missing app_secret keys,
-- and make complete_signup idempotent so a confirmed login can finish signup.

INSERT INTO public.app_secrets (key, value)
VALUES
  ('webhook_secret', encode(gen_random_bytes(32), 'hex')),
  ('cron_secret', encode(gen_random_bytes(32), 'hex')),
  ('evolution_api_key', ''),
  ('evolution_api_url', ''),
  ('allowed_origin', '')
ON CONFLICT (key) DO NOTHING;

UPDATE public.app_secrets
SET value = encode(gen_random_bytes(32), 'hex'), updated_at = now()
WHERE key IN ('webhook_secret', 'cron_secret')
  AND (value IS NULL OR length(trim(value)) = 0);

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

  INSERT INTO public.users (id, studio_id, name, email, role, is_super_admin)
  VALUES (p_user_id, v_studio_id, coalesce(nullif(trim(p_user_name), ''), 'Admin'), v_email, 'admin', false);

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
  );

  RETURN v_studio_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_signup(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_signup(uuid, text, text) TO authenticated;
