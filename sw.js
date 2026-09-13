// Service worker — an offline fallback, and nothing more.
//
// WHAT WAS WRONG BEFORE (and must not come back):
// The first version was cache-first with no cleanup:
//
//     caches.match(request).then(res => res || fetch(request))
//
// It cached index.html on the visitor's first ever load and then served that
// copy forever. Every deploy after that — new photo, new copy, new prices —
// reached new visitors only. Anyone who had been to the site before kept
// seeing the version from the day they first arrived, with no way to know.
// caches.match() also searches EVERY cache the origin has, so simply renaming
// the cache doesn't help; the old one still wins. It has to be deleted.
//
// WHAT IT DOES NOW:
//   page loads  -> network first; the fresh page always wins. The response is
//                  copied into the cache purely so there's something to show
//                  if the visitor is offline.
//   everything  -> not intercepted at all. Images, scripts and fonts go
//   else           straight to the browser's normal HTTP cache, which already
//                  knows how to revalidate them.
//
// On activate, every cache that isn't the current CACHE is deleted, and the
// new worker takes over open tabs immediately rather than waiting for them
// all to close.
//
// Bump the number in CACHE if the stored shape ever changes. You do NOT need
// to bump it for ordinary content changes — network-first already handles
// those.

const CACHE = 'standardnj-v2';
const OFFLINE_URLS = ['index.html', 'manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(OFFLINE_URLS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only page loads. Anything else is left alone on purpose — see above.
  if (request.method !== 'GET' || request.mode !== 'navigate') return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE)
          .then((cache) => cache.put('index.html', copy))
          .catch(() => {});
        return response;
      })
      .catch(() => caches.match('index.html'))
  );
});
