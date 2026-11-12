import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export const CLIENT_PHOTO_BUCKET = 'client-photos'
export const CLIENT_PHOTO_MAX_BYTES = 5 * 1024 * 1024
export const CLIENT_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']

// Returns an error code (the page shows it in the current language) or null.
export function validateClientPhoto(file: File): 'type' | 'size' | null {
  if (!CLIENT_PHOTO_TYPES.includes(file.type)) return 'type'
  if (file.size > CLIENT_PHOTO_MAX_BYTES) return 'size'
  return null
}

// photo_url stores the object path inside the private bucket. The bucket is not
// public, so the image is shown through a signed URL that expires.
export function useClientPhotoUrl(pathOrUrl: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setUrl(null)
    if (!pathOrUrl) return
    if (/^https?:\/\//.test(pathOrUrl)) { setUrl(pathOrUrl); return }
    void supabase.storage.from(CLIENT_PHOTO_BUCKET).createSignedUrl(pathOrUrl, 60 * 60).then(({ data }) => {
      if (alive) setUrl(data?.signedUrl ?? null)
    })
    return () => { alive = false }
  }, [pathOrUrl])
  return url
}
