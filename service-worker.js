/**
 * SineDay Wave - Service Worker
 * Provides offline functionality and caching
 */

const CACHE_NAME = 'sineday-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/styles.css',
  '/js/sineday-engine.js',
  '/js/wave-canvas.js',
  '/js/ui.js',
  '/manifest.json',
  // Day images
  '/Day1.jpeg',
  '/Day2.jpeg',
  '/Day3.jpeg',
  '/Day4.jpeg',
  '/Day5.jpeg',
  '/Day6.jpeg',
  '/Day7.jpeg',
  '/Day8.jpeg',
  '/Day9.jpeg',
  '/Day10.jpeg',
  '/Day11.jpeg',
  '/Day12.jpeg',
  '/Day13.jpeg',
  '/Day14.jpeg',
  '/Day15.jpeg',
  '/Day16.jpeg',
  '/Day17.jpeg',
  '/Day18.jpeg'
];

/**
 * Install event - cache assets
 */
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching assets');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => {
        console.log('[SW] Assets cached successfully');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('[SW] Cache failed:', error);
      })
  );
});

/**
 * Activate event - clean up old caches
 */
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');

  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('[SW] Service worker activated');
        return self.clients.claim();
      })
  );
});

/**
 * Fetch event - serve from cache, fallback to network
 * Strategy: Cache-first for assets, network-first for HTML
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip cross-origin requests
  if (url.origin !== location.origin) {
    return;
  }

  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        // HTML: Network-first (with cache fallback)
        if (request.headers.get('accept').includes('text/html')) {
          return fetch(request)
            .then((networkResponse) => {
              // Update cache
              if (networkResponse && networkResponse.status === 200) {
                const responseClone = networkResponse.clone();
                caches.open(CACHE_NAME)
                  .then((cache) => cache.put(request, responseClone));
              }
              return networkResponse;
            })
            .catch(() => {
              // Network failed, use cache
              return cachedResponse || new Response('Offline', {
                status: 503,
                statusText: 'Service Unavailable'
              });
            });
        }

        // Assets: Cache-first (with network fallback)
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(request)
          .then((networkResponse) => {
            // Cache successful responses
            if (networkResponse && networkResponse.status === 200) {
              const responseClone = networkResponse.clone();
              caches.open(CACHE_NAME)
                .then((cache) => cache.put(request, responseClone));
            }
            return networkResponse;
          })
          .catch((error) => {
            console.error('[SW] Fetch failed:', error);
            return new Response('Network error', {
              status: 408,
              statusText: 'Request Timeout'
            });
          });
      })
  );
});

/**
 * Message event - allow cache updates from app
 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'CACHE_UPDATE') {
    event.waitUntil(
      caches.open(CACHE_NAME)
        .then((cache) => cache.addAll(ASSETS_TO_CACHE))
    );
  }
});
