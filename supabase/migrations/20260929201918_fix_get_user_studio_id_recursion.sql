/*
# Fix get_user_studio_id infinite recursion

## Problem
The function `get_user_studio_id()` is a plain SQL function that runs as the caller
(INVOKER). It does `SELECT studio_id FROM public.users WHERE id = auth.uid()`.
That SELECT is governed by the RLS policy `users_select_own_studio`, whose
predicate calls `get_user_studio_id()` — creating infinite recursion that
exceeds PostgreSQL's stack depth limit and returns HTTP 500 for every query
that touches any table whose policy depends on this function.

## Fix
Recreate `get_user_studio_id()` as SECURITY DEFINER so it runs as the
`postgres` owner and bypasses RLS. The function is read-only (single SELECT
returning a uuid), so making it SECURITY DEFINER is safe: it only exposes
the caller's own studio_id, which they are already authorized to see.

## Tables affected
- No table schema changes.
- All tables with policies that reference `get_user_studio_id()` will now
  work correctly: `users`, `studios`, `ai_settings`, `clients`,
  `appointments`, `conversations`, `procedures`, `professionals`,
  `evolution_api_connections`, `payments`, `automations`, `notifications`,
  `activity_logs`, `messages`.
*/

CREATE OR REPLACE FUNCTION public.get_user_studio_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT studio_id FROM public.users WHERE id = auth.uid() LIMIT 1;
$function$;

-- Grant execute to authenticated so RLS policies can call it
GRANT EXECUTE ON FUNCTION public.get_user_studio_id() TO authenticated;
