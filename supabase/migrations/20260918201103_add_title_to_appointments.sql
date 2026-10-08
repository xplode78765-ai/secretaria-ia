/*
# Add title column to appointments

The appointments table needs a title column for the procedure name display.
*/

ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS title text DEFAULT '';
