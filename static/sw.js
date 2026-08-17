const CACHE_NAME = 'oxidize-cache-v6';
const STATIC_ASSETS = [
  '/static/style.css',
  '/static/theme.js',
  '/static/ui.js',
  '/static/date-utils.js',
  '/static/app.js',
  '/static/dashboard.js',
  '/api/manifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

// Skip API calls entirely — they are volatile and proxied to Firefly III.
function isApiRequest(request) {
  return request.url.includes('/api/') && request.url.includes('/api/manifest');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Never cache API responses (except the static manifest file).
  const isStaticManifest = request.url.endsWith('/api/manifest');
  if (request.url.includes('/api/') && !isStaticManifest) return;

  const isNavigation = request.mode === 'navigate';

  if (isNavigation) {
    // Network-first for pages so updates reach users immediately,
    // falling back to cache when offline.
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) =>
            cached || caches.match('/')
          )
        )
    );
    return;
  }

  // Cache-first for static assets (JS/CSS/manifest/icons).
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && request.url.startsWith(self.location.origin)) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
