/*
# Scope the "professional" role

## Problem
clients, conversations and messages only checked the studio, so a
professional saw every client of the studio (including anamnesis), every
WhatsApp conversation, and could create and delete clients.

## Fix
- Staff (owner/admin/reception): unchanged, full access to their studio.
- Professional:
  - sees and edits only the clients who have an appointment with them;
  - cannot create or delete clients;
  - no access to conversations or messages (the WhatsApp inbox is for staff).
*/

CREATE OR REPLACE FUNCTION public.user_attends_client(p_client_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.client_id = p_client_id
      AND a.studio_id = public.get_user_studio_id()
      AND a.professional_id IS NOT NULL
      AND a.professional_id = public.get_user_professional_id()
  );
$$;
REVOKE EXECUTE ON FUNCTION public.user_attends_client(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.user_attends_client(uuid) TO authenticated;

-- CLIENTS
DROP POLICY IF EXISTS "clients_select_own" ON public.clients;
DROP POLICY IF EXISTS "clients_insert_own" ON public.clients;
DROP POLICY IF EXISTS "clients_update_own" ON public.clients;
DROP POLICY IF EXISTS "clients_delete_own" ON public.clients;
CREATE POLICY "clients_select_own" ON public.clients FOR SELECT TO authenticated
  USING (studio_id = public.get_user_studio_id() AND (public.user_is_staff() OR public.user_attends_client(id)));
CREATE POLICY "clients_insert_own" ON public.clients FOR INSERT TO authenticated
  WITH CHECK (studio_id = public.get_user_studio_id() AND public.user_is_staff());
CREATE POLICY "clients_update_own" ON public.clients FOR UPDATE TO authenticated
  USING (studio_id = public.get_user_studio_id() AND (public.user_is_staff() OR public.user_attends_client(id)))
  WITH CHECK (studio_id = public.get_user_studio_id() AND (public.user_is_staff() OR public.user_attends_client(id)));
CREATE POLICY "clients_delete_own" ON public.clients FOR DELETE TO authenticated
  USING (studio_id = public.get_user_studio_id() AND public.user_is_staff());

-- CONVERSATIONS
DROP POLICY IF EXISTS "conversations_select_own" ON public.conversations;
DROP POLICY IF EXISTS "conversations_insert_own" ON public.conversations;
DROP POLICY IF EXISTS "conversations_update_own" ON public.conversations;
DROP POLICY IF EXISTS "conversations_delete_own" ON public.conversations;
CREATE POLICY "conversations_select_own" ON public.conversations FOR SELECT TO authenticated
  USING (studio_id = public.get_user_studio_id() AND public.user_is_staff());
CREATE POLICY "conversations_insert_own" ON public.conversations FOR INSERT TO authenticated
  WITH CHECK (studio_id = public.get_user_studio_id() AND public.user_is_staff());
CREATE POLICY "conversations_update_own" ON public.conversations FOR UPDATE TO authenticated
  USING (studio_id = public.get_user_studio_id() AND public.user_is_staff())
  WITH CHECK (studio_id = public.get_user_studio_id() AND public.user_is_staff());
CREATE POLICY "conversations_delete_own" ON public.conversations FOR DELETE TO authenticated
  USING (studio_id = public.get_user_studio_id() AND public.user_is_staff());

-- MESSAGES
DROP POLICY IF EXISTS "messages_select_own" ON public.messages;
DROP POLICY IF EXISTS "messages_insert_own" ON public.messages;
DROP POLICY IF EXISTS "messages_update_own" ON public.messages;
DROP POLICY IF EXISTS "messages_delete_own" ON public.messages;
CREATE POLICY "messages_select_own" ON public.messages FOR SELECT TO authenticated
  USING (public.user_is_staff() AND EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = messages.conversation_id AND c.studio_id = public.get_user_studio_id()));
CREATE POLICY "messages_insert_own" ON public.messages FOR INSERT TO authenticated
  WITH CHECK (public.user_is_staff() AND EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = messages.conversation_id AND c.studio_id = public.get_user_studio_id()));
CREATE POLICY "messages_update_own" ON public.messages FOR UPDATE TO authenticated
  USING (public.user_is_staff() AND EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = messages.conversation_id AND c.studio_id = public.get_user_studio_id()))
  WITH CHECK (public.user_is_staff() AND EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = messages.conversation_id AND c.studio_id = public.get_user_studio_id()));
CREATE POLICY "messages_delete_own" ON public.messages FOR DELETE TO authenticated
  USING (public.user_is_staff() AND EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = messages.conversation_id AND c.studio_id = public.get_user_studio_id()));
