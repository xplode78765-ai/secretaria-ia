INSERT INTO public.app_secrets (key, value)
VALUES
  ('openai_api_key', ''),
  ('openai_model', 'gpt-4o-mini')
ON CONFLICT (key) DO NOTHING;
