/*
# Sales readiness (plan "pronta pra venda")

1. Plans + subscription (7-day trial without card, Asaas billing, soft block)
2. studios: column-level UPDATE grants, so owners cannot change their own plan
3. AI: booking approval mode, human hand-off flag, appointment source, Pix deposit
4. Waitlist
5. LGPD: marketing opt-out per client, terms acceptance per user
6. studio_ai_stats(): numbers for the "what the AI did for you" panel
*/

-- ============================================================
-- 1. PLANS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.plans (
  id text PRIMARY KEY,
  name text NOT NULL,
  audience text NOT NULL DEFAULT '',
  price_cents int NOT NULL DEFAULT 0,
  -- GPT replies per month; NULL = unlimited. Above it, the keyword engine answers.
  ai_messages_month int,
  -- feature keys the app checks: team, finance, reports, automations, official_api
  features text[] NOT NULL DEFAULT '{}',
  sort int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.plans FROM anon, authenticated;
GRANT SELECT ON public.plans TO anon, authenticated;
DROP POLICY IF EXISTS "plans_read" ON public.plans;
CREATE POLICY "plans_read" ON public.plans FOR SELECT TO anon, authenticated USING (active);

-- EXAMPLE prices and limits: change them in the admin panel before selling.
INSERT INTO public.plans (id, name, audience, price_cents, ai_messages_month, features, sort) VALUES
  ('essencial', 'Essencial', 'Profissional sozinha', 9700, 500, ARRAY[]::text[], 1),
  ('studio', 'Studio', 'Salão com equipe', 19700, 3000, ARRAY['team', 'finance', 'reports', 'automations'], 2),
  ('pro', 'Pro', 'Clínica ou rede', 39700, NULL, ARRAY['team', 'finance', 'reports', 'automations', 'official_api'], 3)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 2. STUDIOS: subscription + product options
-- ============================================================
ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'studio' REFERENCES public.plans(id),
  ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'trialing',
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz DEFAULT (now() + interval '7 days'),
  ADD COLUMN IF NOT EXISTS past_due_since timestamptz,
  ADD COLUMN IF NOT EXISTS asaas_customer_id text,
  ADD COLUMN IF NOT EXISTS asaas_subscription_id text,
  ADD COLUMN IF NOT EXISTS whatsapp_provider text NOT NULL DEFAULT 'evolution',
  ADD COLUMN IF NOT EXISTS booking_mode text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS deposit_percent int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pix_key text NOT NULL DEFAULT '';

DO $$
BEGIN
  ALTER TABLE public.studios ADD CONSTRAINT studios_subscription_status_check
    CHECK (subscription_status IN ('trialing', 'active', 'past_due', 'paused', 'cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL; END; $$;
DO $$
BEGIN
  ALTER TABLE public.studios ADD CONSTRAINT studios_booking_mode_check CHECK (booking_mode IN ('auto', 'approval'));
EXCEPTION WHEN duplicate_object THEN NULL; END; $$;
DO $$
BEGIN
  ALTER TABLE public.studios ADD CONSTRAINT studios_deposit_percent_check CHECK (deposit_percent BETWEEN 0 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL; END; $$;
DO $$
BEGIN
  ALTER TABLE public.studios ADD CONSTRAINT studios_whatsapp_provider_check CHECK (whatsapp_provider IN ('evolution', 'cloud_api'));
EXCEPTION WHEN duplicate_object THEN NULL; END; $$;

-- Studios that already existed before this migration are not put on a 7-day clock:
-- they stay active until the platform admin decides otherwise.
UPDATE public.studios
SET subscription_status = 'active', trial_ends_at = NULL
WHERE created_at < now() - interval '1 minute' AND subscription_status = 'trialing';

-- Owners may edit their studio data, but NOT plan / subscription / provider columns.
-- (A column-level REVOKE does nothing while the table-level grant exists, so the
-- table grant is removed and only the editable columns are granted.)
REVOKE INSERT, UPDATE, DELETE ON public.studios FROM anon, authenticated;
GRANT UPDATE (
  name, email, phone, address, whatsapp_number, staff_whatsapp, instagram, slug,
  business_hours, timezone, locale, onboarding_completed,
  booking_mode, deposit_percent, pix_key, updated_at
) ON public.studios TO authenticated;

-- ============================================================
-- 3. AI: hand-off, appointment source, deposit
-- ============================================================
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS needs_human boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS needs_human_reason text NOT NULL DEFAULT '';

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS deposit_amount numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposit_paid boolean NOT NULL DEFAULT false;

UPDATE public.appointments SET source = 'ai'
WHERE source = 'manual' AND notes LIKE 'Criado pela SecretarIA%';
UPDATE public.appointments SET source = 'public'
WHERE source = 'manual' AND notes LIKE 'Criado pelo link público%';

CREATE INDEX IF NOT EXISTS idx_appointments_source ON public.appointments (studio_id, source, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_meta_type ON public.messages ((metadata->>'type'), created_at);

-- ============================================================
-- 4. WAITLIST
-- ============================================================
CREATE TABLE IF NOT EXISTS public.waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id uuid NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  procedure_id uuid REFERENCES public.procedures(id) ON DELETE SET NULL,
  procedure_name text NOT NULL DEFAULT '',
  desired_date date NOT NULL,
  status text NOT NULL DEFAULT 'waiting', -- waiting | notified | booked | removed
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_waitlist_studio_date ON public.waitlist (studio_id, desired_date, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_unique_open
  ON public.waitlist (studio_id, client_id, desired_date) WHERE status = 'waiting';

ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.waitlist FROM anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON public.waitlist TO authenticated;
DROP POLICY IF EXISTS "waitlist_select" ON public.waitlist;
DROP POLICY IF EXISTS "waitlist_update" ON public.waitlist;
DROP POLICY IF EXISTS "waitlist_delete" ON public.waitlist;
CREATE POLICY "waitlist_select" ON public.waitlist FOR SELECT TO authenticated
  USING (studio_id = public.get_user_studio_id() AND public.user_is_staff());
CREATE POLICY "waitlist_update" ON public.waitlist FOR UPDATE TO authenticated
  USING (studio_id = public.get_user_studio_id() AND public.user_is_staff())
  WITH CHECK (studio_id = public.get_user_studio_id() AND public.user_is_staff());
CREATE POLICY "waitlist_delete" ON public.waitlist FOR DELETE TO authenticated
  USING (studio_id = public.get_user_studio_id() AND public.user_is_staff());

-- ============================================================
-- 5. LGPD
-- ============================================================
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS marketing_opt_out boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS opted_out_at timestamptz;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz;

-- Records that the signed-in user accepted the terms (users has no client UPDATE grant).
CREATE OR REPLACE FUNCTION public.accept_terms()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.users SET terms_accepted_at = coalesce(terms_accepted_at, now()) WHERE id = auth.uid();
$$;
REVOKE EXECUTE ON FUNCTION public.accept_terms() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.accept_terms() TO authenticated;

-- ============================================================
-- 6. "WHAT THE AI DID FOR YOU"
-- ============================================================
CREATE OR REPLACE FUNCTION public.studio_ai_stats(p_studio uuid, p_from timestamptz, p_to timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz text;
  v_hours jsonb;
  v_configured boolean;
  v_legacy boolean; -- older format: { open, close, weekdays: [...] }
  v_replies int;
  v_after_hours int;
  v_bookings int;
  v_reminders int;
  v_kept int;
  v_rescued int;
BEGIN
  -- Signed-in callers only see their own studio; service_role (auth.uid() is null) sees any.
  IF auth.uid() IS NOT NULL AND (p_studio IS DISTINCT FROM public.get_user_studio_id() OR NOT public.user_is_staff()) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT timezone, coalesce(business_hours, '{}'::jsonb) INTO v_tz, v_hours FROM public.studios WHERE id = p_studio;
  IF v_tz IS NULL THEN RETURN '{}'::jsonb; END IF;
  v_configured := v_hours ?| ARRAY['0', '1', '2', '3', '4', '5', '6'];
  v_legacy := jsonb_typeof(v_hours -> 'weekdays') = 'array';

  WITH ai AS (
    SELECT m.created_at AT TIME ZONE v_tz AS local_at
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE c.studio_id = p_studio AND m.sender_type = 'ai'
      AND m.metadata ? 'engine'
      AND m.created_at >= p_from AND m.created_at < p_to
  ), marked AS (
    SELECT local_at,
      CASE
        WHEN v_legacy THEN
          (v_hours -> 'weekdays') @> to_jsonb(extract(dow FROM local_at)::int)
          AND local_at::time >= coalesce(v_hours ->> 'open', '09:00')::time
          AND local_at::time < coalesce(v_hours ->> 'close', '19:00')::time
        WHEN NOT v_configured THEN
          extract(dow FROM local_at) <> 0 AND local_at::time >= time '09:00' AND local_at::time < time '19:00'
        ELSE
          coalesce((v_hours -> extract(dow FROM local_at)::int::text ->> 'closed')::boolean, false) = false
          AND (v_hours -> extract(dow FROM local_at)::int::text ->> 'open') IS NOT NULL
          AND local_at::time >= (v_hours -> extract(dow FROM local_at)::int::text ->> 'open')::time
          AND local_at::time < (v_hours -> extract(dow FROM local_at)::int::text ->> 'close')::time
      END AS in_hours
    FROM ai
  )
  SELECT count(*), count(*) FILTER (WHERE NOT coalesce(in_hours, false)) INTO v_replies, v_after_hours FROM marked;

  SELECT count(*) INTO v_bookings FROM public.appointments
  WHERE studio_id = p_studio AND source = 'ai' AND status <> 'cancelled'
    AND created_at >= p_from AND created_at < p_to;

  -- Reminders sent, and how many of those appointments were kept (confirmed or done).
  WITH rem AS (
    SELECT DISTINCT (m.metadata->>'appointment_id') AS apt_id
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE c.studio_id = p_studio AND m.metadata->>'type' LIKE 'appointment_reminder%'
      AND m.status <> 'failed' AND m.created_at >= p_from AND m.created_at < p_to
  )
  SELECT count(*), count(*) FILTER (WHERE a.status IN ('confirmed', 'done'))
  INTO v_reminders, v_kept
  FROM rem LEFT JOIN public.appointments a ON a.id::text = rem.apt_id;

  -- Clients who booked again after a win-back message.
  SELECT count(DISTINCT c.client_id) INTO v_rescued
  FROM public.messages m
  JOIN public.conversations c ON c.id = m.conversation_id
  WHERE c.studio_id = p_studio AND m.metadata->>'type' LIKE 'winback%'
    AND m.status <> 'failed' AND m.created_at >= p_from AND m.created_at < p_to
    AND EXISTS (
      SELECT 1 FROM public.appointments a
      WHERE a.client_id = c.client_id AND a.studio_id = p_studio
        AND a.status <> 'cancelled' AND a.created_at > m.created_at
    );

  RETURN jsonb_build_object(
    'ai_replies', v_replies,
    'after_hours', v_after_hours,
    'ai_bookings', v_bookings,
    'reminders', v_reminders,
    'kept_after_reminder', v_kept,
    'rescued', v_rescued
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.studio_ai_stats(uuid, timestamptz, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.studio_ai_stats(uuid, timestamptz, timestamptz) TO authenticated, service_role;

-- ============================================================
-- Secrets used by billing (values are filled in by the platform admin)
-- ============================================================
INSERT INTO public.app_secrets (key, value) VALUES
  ('asaas_api_key', ''),
  ('asaas_env', 'sandbox'),
  ('asaas_webhook_token', encode(extensions.gen_random_bytes(24), 'hex')),
  ('support_whatsapp', '')
ON CONFLICT (key) DO NOTHING;
