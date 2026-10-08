-- Lock the "role" field so users cannot change their own role
DROP POLICY IF EXISTS "users_update_own" ON public.users;
CREATE POLICY "users_update_own" ON public.users FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND studio_id = (SELECT u.studio_id FROM public.users u WHERE u.id = auth.uid())
    AND role = (SELECT u.role FROM public.users u WHERE u.id = auth.uid())
  );
