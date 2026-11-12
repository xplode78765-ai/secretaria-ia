/*
# Schedule appointment-reminders every hour

Nothing in the project called the appointment-reminders function, so reminders,
birthdays, win-back messages and the staff digests (07h / 20h) only ran if someone
had set up a scheduler by hand.

This migration:
- adds the `supabase_url` key to app_secrets (fill it with https://<project>.supabase.co);
- creates public.invoke_appointment_reminders(), which POSTs to the function with
  the X-Cron-Secret header (read from app_secrets, never hard-coded);
- schedules it every hour at minute 5 with pg_cron.

If pg_cron / pg_net are not available (local dev), the job is skipped with a NOTICE.
If you already created a cron job for this in the dashboard, delete it to avoid
running twice (duplicate sends are blocked, but it wastes calls).
*/

INSERT INTO public.app_secrets (key, value)
VALUES ('supabase_url', '')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.invoke_appointment_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_secret text;
BEGIN
  SELECT rtrim(value, '/') INTO v_url FROM public.app_secrets WHERE key = 'supabase_url';
  SELECT value INTO v_secret FROM public.app_secrets WHERE key = 'cron_secret';
  IF coalesce(v_url, '') = '' OR coalesce(v_secret, '') = '' THEN
    RAISE NOTICE 'invoke_appointment_reminders: supabase_url or cron_secret missing in app_secrets';
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := v_url || '/functions/v1/appointment-reminders',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Cron-Secret', v_secret),
    timeout_milliseconds := 120000
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.invoke_appointment_reminders() FROM public, anon, authenticated;

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'appointment-reminders-hourly';
  PERFORM cron.schedule('appointment-reminders-hourly', '5 * * * *', 'select public.invoke_appointment_reminders()');
EXCEPTION WHEN others THEN
  RAISE NOTICE 'pg_cron/pg_net not available, reminders job not scheduled: %', SQLERRM;
END;
$$;
