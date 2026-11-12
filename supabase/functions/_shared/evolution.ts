type Sb = { from: (table: string) => any };

export type EvolutionConfig = { apiUrl: string; apiKey: string };

// The Evolution API URL and key exist ONLY in app_secrets (service_role only).
// They are never read from or written to evolution_api_connections, so no studio
// can see or redirect them.
export async function getEvolutionConfig(supabase: Sb): Promise<EvolutionConfig | null> {
  const { data } = await supabase
    .from("app_secrets")
    .select("key, value")
    .in("key", ["evolution_api_url", "evolution_api_key"]);
  const map: Record<string, string> = {};
  for (const row of data || []) map[row.key] = String(row.value || "").trim();
  const apiUrl = (map.evolution_api_url || "").replace(/\/+$/, "");
  const apiKey = map.evolution_api_key || "";
  if (!apiUrl || !apiKey) return null;
  return { apiUrl, apiKey };
}

export function sendEvolutionText(cfg: EvolutionConfig, instanceName: string, number: string, text: string) {
  return fetch(`${cfg.apiUrl}/message/sendText/${encodeURIComponent(instanceName)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: cfg.apiKey },
    body: JSON.stringify({ number, text }),
  });
}
