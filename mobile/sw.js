const CACHE = "siren-mobile-v20";
const SHELL = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "driver.js",
  "citizen.js",
  "mqtt-client.js",
  "data/route.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  // `reload`: skip the browser HTTP cache, which the CDN tells to keep files for hours.
  const fresh = SHELL.map((url) => new Request(url, { cache: "reload" }));
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(fresh)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

// Network-first for the app shell so edits during development show up on the next load; falls back to
// cache only when the network is unreachable (venue WiFi drops). /api and MQTT/CDN requests bypass this worker.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.includes("/api/")) return;
  event.respondWith(
    // `no-cache`: revalidate with the server instead of trusting the HTTP cache (see install). Navigations cannot take
    // a RequestInit (TypeError), and HTML is already served no-cache.
    (event.request.mode === "navigate" ? fetch(event.request) : fetch(event.request, { cache: "no-cache" }))
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true })),
  );
});
