import { json } from "../_shared.js";
import services from "../../shared/services.cjs";
const { weatherRequest, normalizeWeather } = services;

export async function onRequestGet({ request }) {
  let config;
  try {
    config = weatherRequest(new URL(request.url));
  } catch (error) {
    return json({ error: error.message || "Weather request is not valid." }, 400);
  }
  try {
    const response = await fetch(config.endpoint, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(20_000)
    });
    const data = await response.json();
    if (!response.ok) return json({ error: data.reason || data.error || `Weather provider returned HTTP ${response.status}.` }, 502);
    return json({ weather: normalizeWeather(data, config) }, 200, { "cache-control": "private, max-age=86400" });
  } catch (error) {
    return json({ error: error.message || "Weather data is unavailable." }, 502);
  }
}
