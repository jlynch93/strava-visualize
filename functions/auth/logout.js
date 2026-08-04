import { clearAuthCookies } from "../_shared.js";

export function onRequestGet() {
  const headers = new Headers({ location: "/?disconnected=1" });
  clearAuthCookies().forEach((value) => headers.append("set-cookie", value));
  return new Response(null, { status: 302, headers });
}
