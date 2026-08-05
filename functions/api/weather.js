import { json } from "../_shared.js";

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

function weatherRequest(url) {
  const latitudeValue = url.searchParams.get("lat");
  const longitudeValue = url.searchParams.get("lng");
  const hourValue = url.searchParams.get("hour");
  const latitude = Number(latitudeValue);
  const longitude = Number(longitudeValue);
  const date = String(url.searchParams.get("date") || "");
  const hour = Number(hourValue);
  if (latitudeValue === null || latitudeValue === "" || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new Error("A valid run-start latitude is required.");
  if (longitudeValue === null || longitudeValue === "" || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new Error("A valid run-start longitude is required.");
  if (hourValue === null || hourValue === "" || !Number.isFinite(hour) || hour < 0 || hour > 23) throw new Error("A valid run-start hour is required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("A valid run date is required.");
  const requested = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(requested.valueOf()) || requested.toISOString().slice(0, 10) !== date) throw new Error("The run date is not valid.");
  const ageDays = Math.floor((Date.now() - requested.valueOf()) / 86400000);
  const endpoint = ageDays <= 5
    ? "https://api.open-meteo.com/v1/forecast"
    : requested >= new Date("2022-01-01T00:00:00Z")
      ? "https://historical-forecast-api.open-meteo.com/v1/forecast"
      : "https://archive-api.open-meteo.com/v1/archive";
  const params = new URLSearchParams({
    latitude: latitude.toFixed(2),
    longitude: longitude.toFixed(2),
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
    const value = Number(hourly[key]?.[index]);
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
