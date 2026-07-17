const CACHE_NAME = 'microtone-v2';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/js/cluster-synth-processor.js',
  '/icon-192x192.png',
  '/icon-512x512.png',
  '/manifest.json'
];

// Install: Precache all static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => console.error('[SW] Precache failed:', err))
  );
});

// Activate: Clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: Cache-first strategy for static assets, network-first for others
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests and cross-origin
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // Cache-first for static assets
  const isStaticAsset = PRECACHE_ASSETS.some((path) => url.pathname.endsWith(path));

  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseToCache));
          return response;
        });
      })
    );
  } else {
    // Network-first for dynamic content
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
  }
});
