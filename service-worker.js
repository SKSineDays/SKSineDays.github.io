/**
 * SineDay Wave - Service Worker
 * Provides offline functionality and caching
 */

const CACHE_NAME = 'sineday-v21';
const DAY_IMAGE_PATH = /^\/Day(?:[1-9]|1[0-8])\.(?:jpeg|avif)$/;
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/styles.css',
  '/assets/og-hero.png',
  '/assets/brand/sineday-wordmark.svg',
  '/assets/brand/sineday-wordmark-light.png',
  '/js/sineday-engine.js',
  '/js/wave-canvas.js',
  '/js/ui.js',
  '/js/sineducks.js',
  '/js/sineduck-intro-animation.js',
  '/assets/sineducks/SineDuck15@3x.png',
  '/site.webmanifest?v=2',
  '/apple-touch-icon.png?v=2',
  '/assets/app-icon/apple-touch-icon-180.png?v=2',
  '/assets/app-icon/apple-touch-icon-167.png?v=2',
  '/assets/app-icon/apple-touch-icon-152.png?v=2',
  '/assets/app-icon/icon-square.png',
  '/assets/app-icon/icon-rounded.png',
  '/assets/app-icon/maskable-192.png',
  '/assets/app-icon/maskable-512.png',
  '/favicon.ico?v=2',
  '/favicon-16.png?v=2',
  '/favicon-32.png?v=2',
  '/breathingicon.svg?v=2'
];

const OPTIONAL_ASSETS_TO_CACHE = [
  '/js/affiliate-ui.js',
  '/js/affiliate-application.js',
  '/affiliate.html',
  '/affiliate-terms.html',
  '/assets/affiliate/assets.json',
  '/assets/affiliate/sineday-affiliate-wordmark.svg',
  '/assets/affiliate/sineday-affiliate-square.png',
  '/assets/affiliate/sineday-affiliate-story.png',
  '/assets/affiliate/sineday-affiliate-landscape.png'
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
        return cache.addAll(ASSETS_TO_CACHE.map((asset) => new Request(asset, { cache: 'reload' })))
          .then(() => Promise.allSettled(
            OPTIONAL_ASSETS_TO_CACHE.map((asset) => cache.add(asset))
          ));
      })
      .then(() => {
        console.log('[SW] Assets cached successfully');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('[SW] Cache failed:', error);
        throw error;
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

  if (request.method !== 'GET') {
    return;
  }

  if (url.origin !== location.origin) {
    return;
  }

  // Never intercept Vercel Web Analytics / insights traffic.
  if (url.pathname.startsWith('/_vercel/')) {
    return;
  }

  // Never cache API traffic.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request, { cache: 'no-store' }).catch(() => {
        return new Response(
          JSON.stringify({ ok: false, error: 'Network error' }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      })
    );
    return;
  }

  // Fetch artwork only when viewed. Reload on a miss also refreshes legacy,
  // unversioned URLs after the old worker cache has been removed.
  if (DAY_IMAGE_PATH.test(url.pathname)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request, { cache: 'reload' });
        if (response.ok) {
          try {
            await cache.put(request, response.clone());
          } catch {
            // Storage exhaustion must not hide an available network image.
          }
        }
        return response;
      }).catch(() => new Response('Artwork unavailable', { status: 503 }))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
        const fetchPromise = fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return networkResponse;
        }).catch(() => cachedResponse);

        return cachedResponse || fetchPromise;
      }

      const accept = request.headers.get('accept') || '';

      if (accept.includes('text/html')) {
        return fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return networkResponse;
        }).catch(() => {
          return cachedResponse || new Response('Offline', {
            status: 503,
            statusText: 'Service Unavailable'
          });
        });
      }

      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
        }
        return networkResponse;
      }).catch((error) => {
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
        .then((cache) => cache.addAll(ASSETS_TO_CACHE.map((asset) => new Request(asset, { cache: 'reload' }))))
    );
  }
});
