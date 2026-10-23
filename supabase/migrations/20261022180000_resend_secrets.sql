INSERT INTO public.app_secrets (key, value)
VALUES
  ('resend_api_key', ''),
  ('resend_from', '')
ON CONFLICT (key) DO NOTHING;
