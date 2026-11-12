// Origin check shared by every Edge Function.
//
// - allowed_origin (app_secrets, comma-separated) configured: ONLY those origins
//   are allowed (plus localhost when cors_allow_localhost = "true").
// - allowed_origin empty (not configured yet): legacy behaviour so a running app
//   does not break — *.netlify.app, *.bolt.new/.bolt.host, *.stackblitz.io and
//   localhost — with a warning in the logs. Configure allowed_origin to close it.

export const DEFAULT_ORIGIN = "https://secretaria.app";

const LEGACY_SUFFIXES = [".bolt.new", ".bolt.host", ".stackblitz.io", ".netlify.app"];
let warned = false;

export function originAllowed(origin: string, configured: string[], allowLocalhost: boolean): boolean {
  if (!origin) return false;
  let host = "";
  try {
    host = new URL(origin).hostname;
  } catch {
    return false;
  }
  const isLocal = host === "localhost" || host === "127.0.0.1";
  if (configured.length > 0) {
    if (configured.includes("*")) return true;
    if (configured.includes(origin) || origin === DEFAULT_ORIGIN) return true;
    return isLocal && allowLocalhost;
  }
  if (!warned) {
    warned = true;
    console.warn("[cors] app_secrets.allowed_origin is empty: accepting legacy preview domains. Set it to your app URL.");
  }
  if (origin === DEFAULT_ORIGIN || isLocal) return true;
  return LEGACY_SUFFIXES.some((s) => host.endsWith(s));
}
