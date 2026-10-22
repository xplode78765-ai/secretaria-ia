import { normalizePhone } from "./brazil.ts";

type EvolutionConn = {
  instance_name: string;
  evolution_api_key: string;
  evolution_api_url: string;
  phone_number?: string | null;
  status?: string;
};

export async function notifyStudioStaff(
  supabase: { from: (table: string) => any },
  studioId: string,
  text: string,
  conn?: EvolutionConn | null,
): Promise<boolean> {
  const { data: studio } = await supabase
    .from("studios")
    .select("staff_whatsapp, whatsapp_number")
    .eq("id", studioId)
    .maybeSingle();

  let connection = conn ?? null;
  if (!connection) {
    const { data } = await supabase
      .from("evolution_api_connections")
      .select("instance_name, evolution_api_key, evolution_api_url, phone_number, status")
      .eq("studio_id", studioId)
      .eq("status", "connected")
      .maybeSingle();
    connection = data;
  }
  if (!connection?.evolution_api_url || !connection.evolution_api_key || !connection.instance_name) return false;

  const dest = normalizePhone(
    studio?.staff_whatsapp || connection.phone_number || studio?.whatsapp_number || "",
  );
  if (dest.length < 12) return false;

  const res = await fetch(`${connection.evolution_api_url}/message/sendText/${connection.instance_name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: connection.evolution_api_key },
    body: JSON.stringify({ number: dest, text }),
  });
  if (!res.ok) {
    console.error("[staff-alert] send failed", res.status, await res.text().catch(() => ""));
    return false;
  }
  return true;
}
