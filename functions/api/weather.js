const WEATHER_HOURLY = [
  "temperature_2m",
  "apparent_temperature",
  "relative_humidity_2m",
  "precipitation",
  "weather_code",
  "wind_speed_10m",
  "wind_gusts_10m",
  "is_day"
].join(",");

function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers }
  });
}

function weatherRequest(url) {
  const latitude = Number(url.searchParams.get("lat"));
  const longitude = Number(url.searchParams.get("lng"));
  const date = String(url.searchParams.get("date") || "");
  const hour = Math.min(23, Math.max(0, Number(url.searchParams.get("hour") || 0)));
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new Error("A valid latitude is required.");
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new Error("A valid longitude is required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("A valid run date is required.");
  const requested = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(requested.valueOf())) throw new Error("The run date is not valid.");
  const ageDays = Math.floor((Date.now() - requested.valueOf()) / 86400000);
  const endpoint = ageDays <= 5
    ? "https://api.open-meteo.com/v1/forecast"
    : requested >= new Date("2022-01-01T00:00:00Z")
      ? "https://historical-forecast-api.open-meteo.com/v1/forecast"
      : "https://archive-api.open-meteo.com/v1/archive";
  const params = new URLSearchParams({
    latitude: latitude.toFixed(5),
    longitude: longitude.toFixed(5),
    start_date: date,
    end_date: date,
    hourly: WEATHER_HOURLY,
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    timezone: "auto"
  });
  return {
    endpoint: `${endpoint}?${params}`,
    date,
    hour: Math.round(hour),
    sourceType: ageDays <= 5 ? "forecast" : requested >= new Date("2022-01-01T00:00:00Z") ? "historical forecast" : "historical reanalysis"
  };
}

function normalizeWeather(data, request) {
  const hourly = data?.hourly || {};
  const target = `${request.date}T${String(request.hour).padStart(2, "0")}:00`;
  let index = Array.isArray(hourly.time) ? hourly.time.indexOf(target) : -1;
  if (index < 0 && Array.isArray(hourly.time)) {
    index = hourly.time.findIndex((time) => String(time).startsWith(`${request.date}T${String(request.hour).padStart(2, "0")}`));
  }
  if (index < 0) throw new Error("Weather data is unavailable for this run time.");
  const valueAt = (key) => {
    const raw = hourly[key]?.[index];
    if (raw === null || raw === undefined || raw === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };
  return {
    observedAt: hourly.time[index],
    timezone: data.timezone || "local time",
    source: "Open-Meteo",
    sourceType: request.sourceType,
    temperatureF: valueAt("temperature_2m"),
    feelsLikeF: valueAt("apparent_temperature"),
    humidityPercent: valueAt("relative_humidity_2m"),
    precipitationInches: valueAt("precipitation"),
    weatherCode: valueAt("weather_code"),
    windSpeedMph: valueAt("wind_speed_10m"),
    windGustMph: valueAt("wind_gusts_10m"),
    isDay: valueAt("is_day") === 1
  };
}

export async function onRequestGet({ request }) {
  try {
    const weatherRequestConfig = weatherRequest(new URL(request.url));
    const response = await fetch(weatherRequestConfig.endpoint, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    const data = await response.json();
    if (!response.ok) return json({ error: data.reason || data.error || `Weather provider returned HTTP ${response.status}.` }, 502);
    return json(
      { weather: normalizeWeather(data, weatherRequestConfig) },
      200,
      { "cache-control": "public, max-age=86400" }
    );
  } catch (error) {
    return json({ error: error.message || "Weather data is unavailable." }, 400);
  }
}
