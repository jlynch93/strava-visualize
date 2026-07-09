import { STRAVA_AUTHORIZE, getConfig, json } from "../_shared.js";

export function onRequestGet({ env, request }) {
  const config = getConfig(env, request);
  if (config.error) return json({ error: config.error }, 400);
  const authUrl = new URL(STRAVA_AUTHORIZE);
  authUrl.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    scope: "read,activity:read_all"
  }).toString();
  return Response.redirect(authUrl.toString(), 302);
}
