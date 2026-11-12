/*
# Birthday lookup

appointment-reminders searched birthdays with `.like('birthday', '%-MM-DD')`,
but birthday is a DATE column and Postgres has no LIKE for dates: the query
failed and no birthday message was ever sent. This function matches month/day
against "today" in EACH studio's timezone (studios.timezone, added in
20261105140000). Only the Edge Function (service_role) may call it.
*/

CREATE OR REPLACE FUNCTION public.birthday_clients_today()
RETURNS TABLE (id uuid, studio_id uuid, name text, phone text, whatsapp text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH local_today AS (
    SELECT s.id AS studio_id, (now() AT TIME ZONE s.timezone)::date AS d
    FROM public.studios s
  )
  SELECT c.id, c.studio_id, c.name, c.phone, c.whatsapp
  FROM public.clients c
  JOIN local_today t ON t.studio_id = c.studio_id
  WHERE c.birthday IS NOT NULL
    AND coalesce(c.status, 'active') <> 'inactive'
    AND (
      (extract(month FROM c.birthday) = extract(month FROM t.d) AND extract(day FROM c.birthday) = extract(day FROM t.d))
      -- Born on Feb 29: greeted on Feb 28 when the year is not a leap year.
      OR (
        extract(month FROM c.birthday) = 2 AND extract(day FROM c.birthday) = 29
        AND extract(month FROM t.d) = 2 AND extract(day FROM t.d) = 28
        AND extract(day FROM (date_trunc('year', t.d) + interval '59 days')::date) <> 29
      )
    );
$$;

REVOKE EXECUTE ON FUNCTION public.birthday_clients_today() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.birthday_clients_today() TO service_role;
