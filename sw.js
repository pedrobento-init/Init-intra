const CACHE_NAME = 'init-intra-v50';
const CDN_CACHE_NAME = 'init-intra-cdn-v50';
const MAX_CDN_ENTRIES = 40;

const STATIC_ASSETS = [
  '/',
  'index.html',
  'css/styles.css',
  'js/schema.js',
  'js/error-log.js',
  'js/actions.js',
  'js/supabase-config.js',
  'js/db.js',
  'js/storage.js',
  'js/storage-anexos.js',
  'js/storage-pendencias.js',
  'js/storage-visitas.js',
  'js/storage-operadores.js',
  'js/outbox.js',
  'js/sync-manager.js',
  'js/equipamentos.js',
  'js/app-events.js',
  'js/auth.js',
  'js/ui.js',
  'js/clients.js',
  'js/clients-ficha.js',
  'js/clients-abas.js',
  'js/clients-form.js',
  'js/pendencias.js',
  'js/pendencias-quadro.js',
  'js/pendencias-acoes.js',
  'js/pendencias-detalhe.js',
  'js/pendencias-comando.js',
  'js/operadores.js',
  'js/notifications.js',
  'js/calendar.js',
  'js/visitas.js',
  'js/visit-photos.js',
  'js/ia-relatorio.js',
  'js/templates.js',
  'js/global-search.js',
  'js/timer.js',
  'js/time-entries.js',
  'js/metrics.js',
  'js/reunioes.js',
  'js/milvus-atendimentos.js',
  'js/milvus-chamado.js',
  'js/checklist.js',
  'js/client-secrets.js',
  'js/roteiro.js',
  'js/fila.js',
  'js/prazos.js',
  'js/vencimentos.js',
  'js/conhecimento.js',
  'js/agenda-feed.js',
  'js/relatorio-cliente.js',
  'js/milvus-status.js',
  'js/pendentes.js',
  'js/milvus-clients-import.js',
  'js/milvus-devices.js',
  'js/milvus-tickets.js',
  'js/milvus-token-backfill.js',
  'js/app.js',
  'js/sw-register.js',
  'manifest.json',
  'icon.svg',
  'icon-192.png',
  'logo-initnet.svg'
];

const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.113.0/dist/umd/supabase.min.js',
  'https://cdn.jsdelivr.net/npm/dexie@3.2.4/dist/dexie.min.js',
  'https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js',
  'https://cdn.jsdelivr.net/npm/fullcalendar@6.1.17/index.global.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/motion@13.1.1/dist/motion.js',
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

  // Respostas autenticadas (Supabase REST/Storage/Functions) ficam FORA do
  // Cache Storage: a chave de cache é só a URL e ignora o Authorization, então
  // um GET do usuário A poderia ser servido para o usuário B (ou para uma
  // sessão já encerrada) quando a rede cai. O app não depende disso — o
  // offline-first roda por IndexedDB/outbox.
  if (request.headers.has('apikey') || request.headers.has('authorization')) return;

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
