import { STRAVA_API, getAccessToken, json } from "../../_shared.js";

export async function onRequestGet({ env, request, params }) {
  const activityId = String(params?.id || "");
  if (!/^\d+$/.test(activityId)) return json({ error: "A valid Strava activity ID is required." }, 400);
  const { accessToken, setCookies } = await getAccessToken(env, request);
  const response = await fetch(`${STRAVA_API}/activities/${activityId}`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000)
  });
  const activity = await response.json();
  if (!response.ok) return json(activity, response.status);
  if (!activity || typeof activity !== "object" || Array.isArray(activity)) {
    return json({ error: "Strava returned an invalid activity detail." }, 502);
  }
  const headers = new Headers();
  setCookies.forEach((value) => headers.append("set-cookie", value));
  return json({ activity }, 200, headers);
}
