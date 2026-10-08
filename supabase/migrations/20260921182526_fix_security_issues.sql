-- Fix 1: Revoke EXECUTE on complete_signup from anon
-- The function already checks auth.uid() = p_user_id internally, so it's safe
-- to restrict to authenticated only. anon should never call signup completion.
REVOKE EXECUTE ON FUNCTION public.complete_signup(p_user_id uuid, p_studio_name text, p_user_name text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.complete_signup(p_user_id uuid, p_studio_name text, p_user_name text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_signup(p_user_id uuid, p_studio_name text, p_user_name text) TO authenticated;

-- Fix 2: Revoke EXECUTE on get_user_studio_id from anon
-- This function reads the caller's studio_id using auth.uid().
-- anon has no auth.uid() so it should never call this.
REVOKE EXECUTE ON FUNCTION public.get_user_studio_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_studio_id() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_studio_id() TO authenticated;

-- Fix 3: app_secrets — RLS is enabled but no policies exist.
-- app_secrets is only accessed by edge functions using the service_role key,
-- which bypasses RLS. No browser/client should ever read this table.
-- Revoke all table privileges from anon and authenticated, and add deny-by-default policies.
REVOKE ALL ON public.app_secrets FROM anon;
REVOKE ALL ON public.app_secrets FROM authenticated;

-- Deny-by-default policies (no rows visible to anon or authenticated via API)
CREATE POLICY "app_secrets_deny_all_select" ON public.app_secrets
  FOR SELECT TO anon, authenticated
  USING (false);

CREATE POLICY "app_secrets_deny_all_insert" ON public.app_secrets
  FOR INSERT TO anon, authenticated
  WITH CHECK (false);

CREATE POLICY "app_secrets_deny_all_update" ON public.app_secrets
  FOR UPDATE TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "app_secrets_deny_all_delete" ON public.app_secrets
  FOR DELETE TO anon, authenticated
  USING (false);
