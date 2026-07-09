import { getConfig, json, parseCookies } from "../_shared.js";

export function onRequestGet({ env, request }) {
  const config = getConfig(env, request);
  const cookies = parseCookies(request);
  return json({
    configured: !config.error,
    connected: Boolean(cookies.sv_refresh),
    redirectUri: config.redirectUri,
    error: config.error || null
  });
}
