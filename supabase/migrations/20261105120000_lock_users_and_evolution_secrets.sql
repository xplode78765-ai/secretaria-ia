/*
# Lock down users and evolution_api_connections

## Problem
Column-level REVOKEs do nothing when the role still holds the table-level
privilege. The initial schema ran `GRANT SELECT ON ALL TABLES` and
`GRANT INSERT, UPDATE, DELETE ON public.users, public.evolution_api_connections ...`
AFTER the column REVOKEs, so:

1. Any signed-in user could run
   `update users set is_super_admin = true where id = auth.uid()`
   (users_update_own never checked is_super_admin) and get the platform admin panel.
2. Any signed-in user could `select evolution_api_key, evolution_api_url`
   from their studio's row. evolution-manager copied the GLOBAL Evolution key
   into every row, so this exposed the master key of the whole platform.
3. Studio owners could UPDATE evolution_api_url, and evolution-manager prefers
   the row's URL, so the master key and webhook_secret would be sent to any
   server the owner chose.

## Fix
- users: the browser only reads this table. Every write goes through
  complete_signup (SECURITY DEFINER) or Edge Functions (service_role).
  Remove every write privilege from anon/authenticated and drop the update policy.
- evolution_api_connections: the browser only reads non-secret columns.
  Grant SELECT on exactly those columns and nothing else.
- Wipe the per-row key/url copies. Edge Functions now read both values only
  from app_secrets (service_role only).

## Deploy order
Deploy the updated Edge Functions BEFORE applying this migration. Old functions
read the key/url from the rows that this migration blanks.
*/

-- ============================================================
-- USERS
-- ============================================================
REVOKE ALL ON public.users FROM anon, authenticated;
GRANT SELECT ON public.users TO authenticated;

-- With no UPDATE grant this policy is unreachable. Dropping it means that, even
-- if UPDATE is granted again by mistake, RLS denies every update by default.
DROP POLICY IF EXISTS "users_update_own" ON public.users;

-- ============================================================
-- EVOLUTION API CONNECTIONS
-- ============================================================
REVOKE ALL ON public.evolution_api_connections FROM anon, authenticated;
GRANT SELECT (
  id, studio_id, instance_name, status, phone_number, qr_code,
  qr_code_updated_at, last_connected_at, error_message, created_at, updated_at
) ON public.evolution_api_connections TO authenticated;

-- Writes only happen from Edge Functions (service_role). Drop the client write policies.
DROP POLICY IF EXISTS "evolution_insert_own" ON public.evolution_api_connections;
DROP POLICY IF EXISTS "evolution_update_own" ON public.evolution_api_connections;
DROP POLICY IF EXISTS "evolution_delete_own" ON public.evolution_api_connections;

-- Remove the copies of the global key/url stored on each studio row.
UPDATE public.evolution_api_connections
SET evolution_api_key = '', evolution_api_url = ''
WHERE coalesce(evolution_api_key, '') <> '' OR coalesce(evolution_api_url, '') <> '';
