// Service worker: guarda la app en caché para que funcione sin conexión.
const CACHE = "nfc-reader-v1";
const ASSETS = [
  "./",
  "index.html",
  "styles.css",
  "js/app.js",
  "js/ndef.js",
  "manifest.webmanifest",
  "icons/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

// Red primero y caché como respaldo, para recibir siempre la versión más nueva.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
