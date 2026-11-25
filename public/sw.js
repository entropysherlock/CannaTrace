/* Leaf2Sale service worker: keeps the offline register openable with no internet. It never touches the API. */
const CACHE = "ct-offline-v1";
const OFFLINE_PAGE = "/pos/offline";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Built files never change under the same name: serve from the saved copy first.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
            return res;
          }),
      ),
    );
    return;
  }

  // The offline register page: newest copy when online (saved whether the register fetched it in the background or
  // the person opened it), the saved copy when not. Any other register page opened with no internet shows the
  // offline register instead of a browser error.
  const isOfflinePage = url.pathname === OFFLINE_PAGE;
  const isRegisterNav = req.mode === "navigate" && (url.pathname === "/pos" || url.pathname.startsWith("/pos/"));
  if (isOfflinePage || isRegisterNav) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && isOfflinePage) caches.open(CACHE).then((c) => c.put(OFFLINE_PAGE, res.clone()));
          return res;
        })
        .catch(() => caches.match(OFFLINE_PAGE).then((hit) => hit || Response.error())),
    );
  }
});
