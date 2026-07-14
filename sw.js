/* Utilities service worker — caches the app shell for offline use.
   The app makes no network requests at runtime, so a cache-first
   strategy gives full offline support and enables installability.
   Bump CACHE on every release so the old cached shell is purged. */
const CACHE = "utilities-v8";
const ASSETS = [
  "./index.html",
  "./styles.css",
  "./app.js",
  "./js/lib.js",
  "./js/merge.js",
  "./js/split.js",
  "./js/compress.js",
  "./js/images.js",
  "./js/redact.js",
  "./js/base64.js",
  "./js/csvjson.js",
  "./js/diff.js",
  "./js/exif.js",
  "./js/bgremove.js",
  "./js/sign.js",
  "./js/nav.js",
  "./manifest.webmanifest",
  "./vendor/pdf-lib.min.js",
  "./vendor/pdf.min.js",
  "./vendor/pdf.worker.min.js",
  "./vendor/Sortable.min.js",
  "./vendor/jszip.min.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // Cache same-origin successful responses for next time.
          if (res && res.ok && new URL(req.url).origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => (req.mode === "navigate" ? caches.match("./index.html") : Promise.reject()));
    })
  );
});
