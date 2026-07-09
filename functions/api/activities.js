import { STRAVA_API, getAccessToken, json } from "../_shared.js";

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const { accessToken, setCookies } = await getAccessToken(env, request);
  const after = url.searchParams.get("after");
  const before = url.searchParams.get("before");
  const perPage = Math.min(Number(url.searchParams.get("per_page") || 100), 200);
  const maxPages = Math.min(Number(url.searchParams.get("pages") || 6), 12);
  const activities = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    if (after) params.set("after", after);
    if (before) params.set("before", before);
    const response = await fetch(`${STRAVA_API}/athlete/activities?${params}`, {
      headers: { authorization: `Bearer ${accessToken}` }
    });
    const batch = await response.json();
    if (!response.ok) return json(batch, response.status);
    activities.push(...batch);
    if (!Array.isArray(batch) || batch.length < perPage) break;
  }
  const headers = new Headers();
  setCookies.forEach((value) => headers.append("set-cookie", value));
  return json({ activities }, 200, headers);
}
