"use strict";
/**
 * Travel Planner service worker — offline viewing.
 *
 *  - App pages + /css /js /vendor: network first (so deploys arrive straight away),
 *    falling back to the saved copy when there's no signal. Every /trip/<id> page
 *    shares one saved shell (the trip itself comes from the API).
 *  - Trip data (GET /api/trips, /api/trips/:id, /api/me): network first, saved on
 *    every successful load; offline the saved copy is returned with an
 *    X-From-Cache header carrying when it was saved.
 *  - Attachments (GET /api/trips/:id/files/:fid): cache first — a file id never
 *    changes content.
 *  - Map tiles (Esri / Carto): cache first, capped in number.
 *  - Writes (POST/PUT/DELETE) always go to the network; offline they fail and the
 *    page shows "you're offline".
 *
 * Slow-signal guard: a network attempt that takes longer than NET_TIMEOUT_MS
 * falls back to the saved copy when there is one.
 */
const VERSION = "v1";
const SHELL = "gr-shell-" + VERSION;
const DATA = "gr-data"; // trip JSON + attachments (kept across SW versions)
const TILES = "gr-tiles";
const MAX_TILES = 6000;
const NET_TIMEOUT_MS = 6000;

const PRECACHE = [
  "/", "/present", "/manifest.webmanifest",
  "/css/styles.css",
  "/js/offline.js", "/js/auth.js", "/js/list.js", "/js/route.js", "/js/map.js", "/js/kml.js",
  "/js/forms.js", "/js/calendar.js", "/js/gantt.js", "/js/trip.js", "/js/present.js",
  "/vendor/leaflet.js", "/vendor/leaflet.css", "/vendor/airports.json",
  "/vendor/images/layers.png", "/vendor/images/layers-2x.png",
  "/vendor/images/marker-icon.png", "/vendor/images/marker-icon-2x.png", "/vendor/images/marker-shadow.png",
  "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png", "/icons/apple-touch-icon.png",
];
const TILE_HOSTS = ["server.arcgisonline.com", "basemaps.cartocdn.com"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL).then((c) =>
      Promise.all(PRECACHE.map((u) => c.add(new Request(u, { cache: "reload" })).catch(() => {})))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("gr-shell-") && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (e) => {
  if (e.data === "clear-data") e.waitUntil(Promise.all([caches.delete(DATA), caches.delete(TILES)]));
});

// fetch with a timeout; rejects on network error or timeout
function netFetch(req, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    fetch(req).then((r) => { clearTimeout(t); resolve(r); }, (err) => { clearTimeout(t); reject(err); });
  });
}

function shellKey(url) {
  if (url.pathname.startsWith("/trip/")) return "/trip/__shell";
  if (url.pathname === "/present") return "/present";
  return url.pathname;
}

async function networkFirst(req, cacheName, key, mark) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(key, { ignoreSearch: cacheName === SHELL });
  try {
    const res = await netFetch(req, cached ? NET_TIMEOUT_MS : 30000);
    if (res.ok) cache.put(key, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    if (!cached) throw err;
    if (!mark) return cached;
    // tell the page this is a saved copy, and from when
    const h = new Headers(cached.headers);
    h.set("X-From-Cache", cached.headers.get("date") || "unknown");
    return new Response(await cached.blob(), { status: cached.status, statusText: cached.statusText, headers: h });
  }
}

async function cacheFirst(req, cacheName, key) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(key, res.clone()).catch(() => {});
  return res;
}

let tilePuts = 0;
async function tile(req) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  // ask for a CORS response so the browser stores the real image size, not a padded opaque one
  let res;
  try { res = await fetch(req.url, { mode: "cors", credentials: "omit" }); }
  catch (e) { res = await fetch(req); }
  if (res.ok || res.type === "opaque") {
    await cache.put(req.url, res.clone()).catch(() => {});
    if (++tilePuts % 200 === 0) trimTiles(cache);
  }
  return res;
}
async function trimTiles(cache) {
  const keys = await cache.keys();
  const extra = keys.length - MAX_TILES;
  for (let i = 0; i < extra; i++) await cache.delete(keys[i]); // oldest first
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return; // writes go straight to the network
  const url = new URL(req.url);

  if (TILE_HOSTS.includes(url.hostname)) return e.respondWith(tile(req));
  if (url.origin !== self.location.origin) return;

  const p = url.pathname;
  if (/^\/api\/trips\/[^/]+\/files\/[^/]+$/.test(p)) return e.respondWith(cacheFirst(req, DATA, p));
  if (p === "/api/me" || p === "/api/trips" || /^\/api\/trips\/[^/]+$/.test(p))
    return e.respondWith(networkFirst(req, DATA, p, true));
  if (p.startsWith("/api/") || p.startsWith("/auth/") || p === "/sw.js") return; // e.g. print.pdf — online only

  if (req.mode === "navigate" || p.startsWith("/css/") || p.startsWith("/js/") || p.startsWith("/vendor/") ||
      p.startsWith("/icons/") || p === "/manifest.webmanifest")
    return e.respondWith(networkFirst(req, SHELL, shellKey(url), false));
});
