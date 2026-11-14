export function json(payload, status = 200, headers = {}) {
  const responseHeaders = headers instanceof Headers ? headers : new Headers(headers);
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  if (!responseHeaders.has("cache-control")) responseHeaders.set("cache-control", "private, no-store");
  return new Response(JSON.stringify(payload), { status, headers: responseHeaders });
}

export function redirect(location, cookies = []) {
  const headers = new Headers({ location, "cache-control": "no-store" });
  cookies.forEach((value) => headers.append("set-cookie", value));
  return new Response(null, { status: 302, headers });
}

export function appError(message, status) {
  return Object.assign(new Error(message), { status });
}

export function parseCookies(request) {
  const raw = request.headers.get("cookie") || "";
  return raw.split(";").reduce((cookies, part) => {
    const [key, ...value] = part.trim().split("=");
    if (key) {
      try {
        cookies[key] = decodeURIComponent(value.join("="));
      } catch {
        cookies[key] = value.join("=");
      }
    }
    return cookies;
  }, {});
}

export function cookie(name, value, maxAge, request) {
  // Browsers drop Secure cookies on plain-http localhost in some versions, so
  // only set Secure when the request itself arrived over https.
  const secure = !request || new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly${secure}; SameSite=Lax`;
}

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$|\.(localhost|test)$/i;

// OAuth callback for a provider: an explicit override (e.g.
// STRAVA_REDIRECT_URI), else APP_BASE_URL or the request origin plus `path`.
// Anything other than a local development host is forced to https, so a stray
// http:// setting can't send sign-in codes or cookies over plain HTTP.
export function callbackUrl(env, request, path, override) {
  const origin = String(env.APP_BASE_URL || new URL(request.url).origin).trim().replace(/\/+$/, "");
  const url = new URL(String(override || "").trim() || `${origin}${path}`);
  if (url.protocol === "http:" && !LOCAL_HOST.test(url.hostname)) url.protocol = "https:";
  return url.toString();
}

export async function fetchJson(url, options = {}, label = "The provider") {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), ...options });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw appError(`${label} returned an unreadable response.`, 502);
  }
  return { response, data };
}
