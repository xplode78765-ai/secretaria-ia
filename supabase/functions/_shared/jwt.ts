// Reads the "aal" (authenticator assurance level) claim of a Supabase access token.
// Call ONLY after the token was validated with auth.getUser(token).
// "aal2" means the user passed a second factor (TOTP) in this session.
export function tokenAal(token: string): string {
  try {
    const part = token.split(".")[1] || "";
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
    return String(JSON.parse(json)?.aal || "aal1");
  } catch {
    return "aal1";
  }
}

export const MFA_REQUIRED_ERROR = "mfa_required";
