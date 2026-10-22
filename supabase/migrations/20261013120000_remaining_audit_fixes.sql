DROP POLICY IF EXISTS "users_update_own" ON public.users;
CREATE POLICY "users_update_own" ON public.users FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND studio_id IS NOT DISTINCT FROM (SELECT u.studio_id FROM public.users u WHERE u.id = auth.uid())
    AND role = (SELECT u.role FROM public.users u WHERE u.id = auth.uid())
    AND professional_id IS NOT DISTINCT FROM (SELECT u.professional_id FROM public.users u WHERE u.id = auth.uid())
  );

REVOKE UPDATE (professional_id) ON public.users FROM authenticated;

DROP POLICY IF EXISTS "appointments_select_own" ON public.appointments;
CREATE POLICY "appointments_select_own" ON public.appointments FOR SELECT TO authenticated
  USING (
    studio_id = public.get_user_studio_id()
    AND (
      public.user_is_staff()
      OR professional_id = public.get_user_professional_id()
    )
  );

DO $$
BEGIN
  ALTER TABLE public.appointments
    ADD CONSTRAINT appointments_no_overlap
    EXCLUDE USING gist (
      studio_id WITH =,
      overlap_key WITH =,
      tstzrange(start_time, end_time, '[)') WITH &&
    )
    WHERE (status IS DISTINCT FROM 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END;
$$;
