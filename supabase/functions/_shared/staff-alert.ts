import { normalizePhone } from "./brazil.ts";
import { getEvolutionConfig, sendEvolutionText } from "./evolution.ts";

type EvolutionConn = {
  instance_name: string;
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
      .select("instance_name, phone_number, status")
      .eq("studio_id", studioId)
      .eq("status", "connected")
      .maybeSingle();
    connection = data;
  }
  if (!connection?.instance_name) return false;

  const cfg = await getEvolutionConfig(supabase);
  if (!cfg) return false;

  const dest = normalizePhone(
    studio?.staff_whatsapp || connection.phone_number || studio?.whatsapp_number || "",
  );
  if (dest.length < 12) return false;

  const res = await sendEvolutionText(cfg, connection.instance_name, dest, text);
  if (!res.ok) {
    console.error("[staff-alert] send failed", res.status, await res.text().catch(() => ""));
    return false;
  }
  return true;
}
