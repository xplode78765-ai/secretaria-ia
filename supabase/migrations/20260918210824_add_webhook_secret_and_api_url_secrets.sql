/*
# Add webhook_secret and evolution_api_url placeholder rows to app_secrets

## Changes
- Inserts a `webhook_secret` row in `app_secrets` with a blank placeholder value.
  The real secret must be generated and set manually via the Supabase SQL editor.
- Inserts an `evolution_api_url` row in `app_secrets` with a blank placeholder value.
  The real URL must be set manually via the Supabase SQL editor.
- These rows are only accessible via service_role (RLS enabled, no policies).

## Notes
- No real secret values are committed in this migration.
- The evolution-manager edge function reads `webhook_secret` for the X-Webhook-Secret header
  and `evolution_api_url` for the base URL of the Evolution API.
- The whatsapp-webhook edge function validates `X-Webhook-Secret` against `webhook_secret`.
*/

INSERT INTO public.app_secrets (key, value)
VALUES ('webhook_secret', '')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.app_secrets (key, value)
VALUES ('evolution_api_url', '')
ON CONFLICT (key) DO NOTHING;
