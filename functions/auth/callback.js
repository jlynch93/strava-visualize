import { exchangeToken, getConfig, json, tokenCookies } from "../_shared.js";

export async function onRequestGet({ env, request }) {
  const config = getConfig(env, request);
  if (config.error) return json({ error: config.error }, 400);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) return json({ error: "Missing Strava authorization code." }, 400);
  const token = await exchangeToken({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: "authorization_code"
  });
  const headers = new Headers({ location: "/?connected=1" });
  tokenCookies(token).forEach((value) => headers.append("set-cookie", value));
  return new Response(null, { status: 302, headers });
}
