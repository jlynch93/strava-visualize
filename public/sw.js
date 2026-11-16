/* Runlore service worker: keeps the app shell available so the installed app
   opens instantly and still opens offline. It never touches account data:
   /api, /auth and /webhooks always go straight to the network. */
const CACHE = "runlore-shell-v1";
const MAX_ENTRIES = 80;
const FINGERPRINTED = /\.[a-f\d]{12}\.(?:js|css)$/;
const STATIC = /\.(?:js|css|svg|png|webmanifest)$/;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});

async function store(request, response) {
  if (!response || response.status !== 200 || response.type !== "basic") return;
  const cache = await caches.open(CACHE);
  await cache.put(request, response.clone());
  // Old fingerprinted files from earlier deploys fall off the end.
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) await cache.delete(key);
}

async function networkFirst(request, fallbackKey) {
  try {
    const response = await fetch(request);
    await store(fallbackKey || request, response);
    return response;
  } catch (error) {
    const cached = await caches.match(fallbackKey || request);
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  await store(request, response);
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (/^\/(?:api|auth|webhooks)\//.test(url.pathname)) return;
  // The dashboard is one page: any in-app navigation falls back to the saved shell.
  if (request.mode === "navigate") {
    if (url.pathname === "/" || url.pathname === "/index.html") event.respondWith(networkFirst(request, "/"));
    return;
  }
  if (!STATIC.test(url.pathname) || url.pathname === "/sw.js") return;
  event.respondWith(FINGERPRINTED.test(url.pathname) ? cacheFirst(request) : networkFirst(request));
});
