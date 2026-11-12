/*
# Per-studio language for client-facing messages

studios.locale = 'pt' | 'es'. Chooses the language of everything the studio's
CLIENTS and STAFF receive from the system: WhatsApp AI replies (GPT and rule
engine), reminders, birthday / win-back messages, staff alerts and digests,
in-app notifications and the welcome e-mail.

(The app interface language is a separate, per-person choice kept in the browser.)
Existing studios stay in Portuguese.
*/

ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'pt';

DO $$
BEGIN
  ALTER TABLE public.studios ADD CONSTRAINT studios_locale_check CHECK (locale IN ('pt', 'es'));
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
