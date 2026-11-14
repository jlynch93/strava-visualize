// Security headers for every response the Worker returns. Static assets that
// bypass the Worker get the same policy from the _headers file written by
// scripts/build-assets.js (see SECURITY_HEADERS there).
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  // Charts and dialogs set inline style attributes; no inline scripts are used.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join("; ");

export function withSecurityHeaders(response, request) {
  const headers = new Headers(response.headers);
  const https = new URL(request.url).protocol === "https:";
  headers.set("Content-Security-Policy", https ? `${CONTENT_SECURITY_POLICY}; upgrade-insecure-requests` : CONTENT_SECURITY_POLICY);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  // No Cross-Origin-Opener-Policy: Firefox swaps the browsing context group on
  // navigation when it is set, which drops emulated media in Playwright, and
  // the app opens no cross-origin windows that it would protect against.
  if (https) headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  // Redirects and bodiless responses must keep their original shape.
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export const STATIC_SECURITY_HEADERS = {
  "Content-Security-Policy": `${CONTENT_SECURITY_POLICY}; upgrade-insecure-requests`,
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains"
};
