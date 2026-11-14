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
