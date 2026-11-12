// Minimal Asaas client (https://docs.asaas.com). The API key lives only in
// app_secrets (asaas_api_key); asaas_env is "sandbox" or "production".
type Sb = { from: (table: string) => any };

export type AsaasConfig = { baseUrl: string; apiKey: string };

export async function getAsaasConfig(supabase: Sb): Promise<AsaasConfig | null> {
  const { data } = await supabase.from("app_secrets").select("key, value").in("key", ["asaas_api_key", "asaas_env"]);
  const map: Record<string, string> = {};
  for (const row of data || []) map[row.key] = String(row.value || "").trim();
  if (!map.asaas_api_key) return null;
  const baseUrl = map.asaas_env === "production" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3";
  return { baseUrl, apiKey: map.asaas_api_key };
}

export async function asaas<T = Record<string, unknown>>(
  cfg: AsaasConfig, method: string, path: string, body?: unknown,
): Promise<{ ok: boolean; status: number; data: T; error: string }> {
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", access_token: cfg.apiKey, "User-Agent": "secretaria-ia" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  const error = res.ok ? "" : String(data?.errors?.[0]?.description || data?.message || res.statusText);
  return { ok: res.ok, status: res.status, data: data as T, error };
}

/** YYYY-MM-DD in São Paulo (Asaas due dates are Brazilian calendar days). */
export function asaasDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
