ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS staff_whatsapp text NOT NULL DEFAULT '';
