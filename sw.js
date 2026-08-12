const CACHE_NAME = 'init-intra-v42';
const CDN_CACHE_NAME = 'init-intra-cdn-v42';
const MAX_CDN_ENTRIES = 40;

const STATIC_ASSETS = [
  '/',
  'index.html',
  'css/styles.css',
  'js/supabase-config.js',
  'js/db.js',
  'js/storage.js',
  'js/auth.js',
  'js/ui.js',
  'js/clients.js',
  'js/pendencias.js',
  'js/operadores.js',
  'js/calendar.js',
  'js/visitas.js',
  'js/notifications.js',
  'js/templates.js',
  'js/global-search.js',
  'js/app.js',
  'js/timer.js',
  'js/sw-register.js',
  'manifest.json',
  'icon.svg'
];

const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdn.jsdelivr.net/npm/dexie@3.2.4/dist/dexie.min.js',
  'https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js',
  'https://cdn.jsdelivr.net/npm/fullcalendar@6.1.17/index.global.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    Promise.allSettled([
      caches.open(CACHE_NAME).then((cache) => {
        return Promise.allSettled(
          STATIC_ASSETS.map((url) =>
            fetch(url, { cache: 'no-store' }).then((response) => {
              if (response.ok) return cache.put(url, response);
            }).catch(() => {})
          )
        );
      }),
      caches.open(CDN_CACHE_NAME).then((cache) => {
        return Promise.allSettled(
          CDN_ASSETS.map((url) =>
            fetch(url, { cache: 'no-store' }).then((response) => {
              if (response.ok) return cache.put(url, response);
            }).catch(() => {})
          )
        );
      })
    ])
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== CDN_CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

function purgeOldestCDNEntries() {
  caches.open(CDN_CACHE_NAME).then((cache) => {
    cache.keys().then((keys) => {
      if (keys.length > MAX_CDN_ENTRIES) {
        const toDelete = keys.slice(0, keys.length - MAX_CDN_ENTRIES);
        toDelete.forEach((key) => cache.delete(key));
      }
    });
  });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return networkResponse;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('index.html')))
    );
    return;
  }

  const isSameOrigin = url.origin === self.location.origin;

  if (isSameOrigin) {
    event.respondWith(
      fetch(request).then((networkResponse) => {
        if (networkResponse.ok) {
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return networkResponse;
      }).catch(() => {
        return caches.match(request);
      })
    );
  } else {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        const fetchPromise = fetch(request).then((networkResponse) => {
          if (networkResponse.ok) {
            const copy = networkResponse.clone();
            caches.open(CDN_CACHE_NAME).then((cache) => {
              cache.put(request, copy);
              purgeOldestCDNEntries();
            });
          }
          return networkResponse;
        }).catch(() => cachedResponse);

        return cachedResponse || fetchPromise;
      })
    );
  }
});
