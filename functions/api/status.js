import services from "../../shared/services.cjs";
import { getConfig, json, parseCookies } from "../_shared.js";

export function onRequestGet({ env, request }) {
  const config = getConfig(env, request);
  const cookies = parseCookies(request);
  return json({
    configured: !config.error,
    connected: Boolean(cookies.sv_refresh),
    redirectUri: config.redirectUri,
    analysisService: new URL(env.OLLAMA_BASE_URL || services.DEFAULT_OLLAMA_URL).origin,
    analysisModel: env.OLLAMA_MODEL || services.DEFAULT_OLLAMA_MODEL,
    error: config.error || null
  });
}
