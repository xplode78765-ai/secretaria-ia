ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS birthday date,
  ADD COLUMN IF NOT EXISTS anamnesis text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS photo_url text NOT NULL DEFAULT '';

ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS slug text;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS ai_state jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.professionals
  ADD COLUMN IF NOT EXISTS commission_percent numeric(5,2) NOT NULL DEFAULT 0;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS professional_id uuid REFERENCES public.professionals(id) ON DELETE SET NULL;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS professional_id uuid REFERENCES public.professionals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS commission_amount numeric(10,2) NOT NULL DEFAULT 0;

UPDATE public.studios
SET slug = trim(both '-' from lower(regexp_replace(coalesce(name, 'studio'), '[^a-zA-Z0-9]+', '-', 'g')))
           || '-' || substr(replace(id::text, '-', ''), 1, 8)
WHERE slug IS NULL OR length(trim(slug)) = 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_studios_slug ON public.studios (slug);

CREATE OR REPLACE FUNCTION public.studios_set_slug()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.slug IS NULL OR length(trim(NEW.slug)) = 0 THEN
    NEW.slug := trim(both '-' from lower(regexp_replace(coalesce(NEW.name, 'studio'), '[^a-zA-Z0-9]+', '-', 'g')))
      || '-' || substr(replace(NEW.id::text, '-', ''), 1, 8);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_studios_slug ON public.studios;
CREATE TRIGGER trg_studios_slug
  BEFORE INSERT OR UPDATE OF name, slug ON public.studios
  FOR EACH ROW EXECUTE FUNCTION public.studios_set_slug();

INSERT INTO storage.buckets (id, name, public)
VALUES ('client-photos', 'client-photos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "client_photos_select" ON storage.objects;
CREATE POLICY "client_photos_select" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'client-photos');

DROP POLICY IF EXISTS "client_photos_insert" ON storage.objects;
CREATE POLICY "client_photos_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'client-photos');

DROP POLICY IF EXISTS "client_photos_update" ON storage.objects;
CREATE POLICY "client_photos_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'client-photos')
  WITH CHECK (bucket_id = 'client-photos');
