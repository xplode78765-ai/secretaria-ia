import { supabase } from '@/lib/supabase'

// Calls an Edge Function and always returns the JSON body, also on 4xx/5xx
// (supabase-js hides the body of error responses inside error.context).
export async function callEdge<T = Record<string, unknown>>(
  name: string, body: Record<string, unknown>,
): Promise<{ ok: boolean; data: T & { error?: string; code?: string } }> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (!error) return { ok: !(data as { error?: string })?.error, data }
  const ctx = (error as { context?: Response }).context
  let parsed: unknown = null
  if (ctx && typeof ctx.json === 'function') parsed = await ctx.clone().json().catch(() => null)
  return { ok: false, data: (parsed || { error: error.message }) as T & { error?: string; code?: string } }
}
