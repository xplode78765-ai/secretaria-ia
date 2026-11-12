/*
# Client photos: private bucket

## Problem
The client-photos bucket was public (`public = true`) and its read policy was
`TO public`, so anyone with the link could open a client's photo. There was no
delete policy and no limit on file type or size.

## Fix
- Bucket becomes private, limited to 5 MB images.
- Read/write/delete only for signed-in members of the studio that owns the
  folder (the first folder of the path is the studio id).
- clients.photo_url now stores the object PATH (e.g. "<studio>/<client>-123").
  The app shows it through a temporary signed URL. Old public URLs become paths.
*/

UPDATE storage.buckets
SET public = false,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
WHERE id = 'client-photos';

DROP POLICY IF EXISTS "client_photos_select" ON storage.objects;
CREATE POLICY "client_photos_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'client-photos'
    AND split_part(name, '/', 1) = public.get_user_studio_id()::text
  );

DROP POLICY IF EXISTS "client_photos_delete" ON storage.objects;
CREATE POLICY "client_photos_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'client-photos'
    AND split_part(name, '/', 1) = public.get_user_studio_id()::text
  );

UPDATE public.clients
SET photo_url = regexp_replace(photo_url, '^.*/storage/v1/object/(public|sign)/client-photos/', '')
WHERE photo_url LIKE '%/storage/v1/object/%/client-photos/%';

UPDATE public.clients
SET photo_url = split_part(photo_url, '?', 1)
WHERE photo_url LIKE '%?%' AND photo_url NOT LIKE 'http%';
