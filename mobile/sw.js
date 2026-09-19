const CACHE = "siren-mobile-v1";
const SHELL = ["./", "index.html", "style.css", "app.js", "driver.js", "citizen.js", "mqtt-client.js", "data/route.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

// Cache-first for the app shell; network passthrough for /api and MQTT/CDN requests never touch this worker.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.includes("/api/")) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
