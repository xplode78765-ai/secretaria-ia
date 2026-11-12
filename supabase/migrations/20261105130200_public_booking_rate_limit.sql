/*
# Rate limit for the public booking link

public-booking used to rate-limit with `notes LIKE '%(<ip>)%'`, where the IP came
from a header the caller controls. This table records every attempt and is only
reachable from Edge Functions (service_role).
*/

CREATE TABLE IF NOT EXISTS public.public_booking_attempts (
  id bigserial PRIMARY KEY,
  studio_id uuid REFERENCES public.studios(id) ON DELETE CASCADE,
  ip text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pba_studio_time ON public.public_booking_attempts (studio_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pba_ip_time ON public.public_booking_attempts (ip, created_at);
CREATE INDEX IF NOT EXISTS idx_pba_phone_time ON public.public_booking_attempts (phone, created_at);

ALTER TABLE public.public_booking_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.public_booking_attempts FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.public_booking_attempts_id_seq FROM anon, authenticated;

-- Welcome e-mail: one per user (mailer checks this flag).
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS welcome_email_sent_at timestamptz;
-- Existing accounts already went through signup: do not let them trigger it again.
UPDATE public.users SET welcome_email_sent_at = coalesce(created_at, now()) WHERE welcome_email_sent_at IS NULL;
