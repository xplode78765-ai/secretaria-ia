/*
# Add status column to messages table

1. Changes
- Add `status` column (text, NOT NULL, default 'sent') to `public.messages`.
- This column tracks the delivery state of messages sent via the WhatsApp edge function:
  'pending' (about to send), 'sent' (Evolution API accepted), 'failed' (Evolution API rejected).
- Existing rows get 'sent' as the default, since all prior messages were already delivered.
2. Security
- No RLS or policy changes — the column inherits the table's existing policies.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'status'
  ) THEN
    ALTER TABLE public.messages ADD COLUMN status text NOT NULL DEFAULT 'sent';
  END IF;
END $$;
