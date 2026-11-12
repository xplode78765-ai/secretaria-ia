/*
# Per-studio timezone

Everything used to run on São Paulo time. Studios in Manaus, Cuiabá, Rio Branco,
Noronha, etc. got reminders, AI slots and agenda times shifted by 1–2 hours.

- studios.timezone: IANA name, default America/Sao_Paulo (existing studios keep
  exactly the behaviour they had). Validated against pg_timezone_names.
- birthday_clients_today() (next migration) matches birthdays against "today" in EACH studio's
  timezone.
*/

ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Sao_Paulo';

CREATE OR REPLACE FUNCTION public.studios_validate_timezone()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.timezone IS NULL OR length(trim(NEW.timezone)) = 0 THEN
    NEW.timezone := 'America/Sao_Paulo';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'Fuso horário inválido: %', NEW.timezone USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_studios_timezone ON public.studios;
CREATE TRIGGER trg_studios_timezone
  BEFORE INSERT OR UPDATE OF timezone ON public.studios
  FOR EACH ROW EXECUTE FUNCTION public.studios_validate_timezone();
