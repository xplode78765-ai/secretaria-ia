-- ============================================================
-- Fix SECURITY DEFINER function exposure
-- ============================================================

-- 1. get_user_studio_id: Switch to SECURITY INVOKER
--    This function only reads the caller's own row from users (id = auth.uid()),
--    which is already allowed by the users_select_own_studio RLS policy.
--    No privilege escalation is possible as INVOKER.
CREATE OR REPLACE FUNCTION public.get_user_studio_id()
RETURNS uuid
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
  SELECT studio_id FROM public.users WHERE id = auth.uid() LIMIT 1;
$$;

-- 2. complete_signup: Keep SECURITY DEFINER (needs to INSERT into studios, users,
--    ai_settings which have no INSERT policies for the caller's RLS context).
--    But revoke EXECUTE from anon (already done) and restrict to authenticated only.
--    The function has an internal auth.uid() check that prevents impersonation.
-- Re-affirm grants: only authenticated can call it, not anon.
REVOKE EXECUTE ON FUNCTION public.complete_signup(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.complete_signup(uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_signup(uuid, text, text) TO authenticated;
