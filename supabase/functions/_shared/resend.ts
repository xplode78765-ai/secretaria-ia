type SendArgs = {
  apiKey: string;
  from: string;
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
};

export async function sendResendEmail(opts: SendArgs): Promise<{ ok: boolean; error?: string; id?: string }> {
  const to = (Array.isArray(opts.to) ? opts.to : [opts.to]).map((e) => e.trim()).filter(Boolean);
  if (!opts.apiKey || !opts.from || to.length === 0) {
    return { ok: false, error: "Resend não configurado (api key, from ou destinatário)." };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: opts.from,
      to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text || opts.html.replace(/<[^>]+>/g, " "),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: String(body?.message || body?.error || res.statusText) };
  }
  return { ok: true, id: body?.id };
}

export function wrapEmail(title: string, inner: string) {
  return `<!doctype html><html><body style="margin:0;background:#f6f3ee;font-family:Georgia,serif;color:#2b241c;">
  <div style="max-width:560px;margin:24px auto;background:#fff;border-radius:16px;padding:28px;border:1px solid #eadfcf;">
    <p style="margin:0 0 8px;letter-spacing:.12em;font-size:11px;color:#b08d57;">SECRETARIA</p>
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:500;">${title}</h1>
    <div style="font-size:15px;line-height:1.55;color:#4a4036;">${inner}</div>
    <p style="margin:28px 0 0;font-size:12px;color:#8a7d70;">Enviado pela SecretarIA. Se não esperava este e-mail, pode ignorar.</p>
  </div></body></html>`;
}
