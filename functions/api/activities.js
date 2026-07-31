import { STRAVA_API, getAccessToken, json } from "../_shared.js";

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const { accessToken, setCookies } = await getAccessToken(env, request);
  const after = url.searchParams.get("after");
  const before = url.searchParams.get("before");
  const requestedPerPage = Number(url.searchParams.get("per_page") || 100);
  const requestedPages = Number(url.searchParams.get("pages") || 6);
  const perPage = Number.isFinite(requestedPerPage) ? Math.max(1, Math.min(requestedPerPage, 200)) : 100;
  const maxPages = Number.isFinite(requestedPages) ? Math.max(1, Math.min(requestedPages, 12)) : 6;
  const activities = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    if (after) params.set("after", after);
    if (before) params.set("before", before);
    const response = await fetch(`${STRAVA_API}/athlete/activities?${params}`, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(30_000)
    });
    const batch = await response.json();
    if (!response.ok) return json(batch, response.status);
    if (!Array.isArray(batch)) return json({ error: "Strava returned an invalid activity list." }, 502);
    activities.push(...batch);
    if (batch.length < perPage) break;
  }
  const headers = new Headers();
  setCookies.forEach((value) => headers.append("set-cookie", value));
  return json({ activities }, 200, headers);
}
