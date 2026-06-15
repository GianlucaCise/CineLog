// ─────────────────────────────────────────────────────────
//  CineLog — Service Worker
//  Cacha i file statici del frontend per avvio istantaneo.
//  Le chiamate API (/api/*) vanno sempre alla rete.
// ─────────────────────────────────────────────────────────

// ⚠️  Incrementa questo numero ogni volta che modifichi file statici
//     oppure usa lo script update-cache-version.bat per farlo automaticamente
const CACHE_VERSION = 1;
const CACHE_NAME = `cinelog-v${CACHE_VERSION}`;

// File da cachare al primo avvio
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/watchlist',
  '/saghe',
  '/statistiche',
];

// ── INSTALL: precarica tutti i file statici ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: rimuovi cache vecchie ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: strategia per tipo di richiesta ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // API calls → sempre rete, mai cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // config.js → sempre rete (contiene chiavi aggiornabili)
  if (url.pathname === '/config.js') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // File statici → Cache First, poi rete come fallback
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Cacha le nuove risorse statiche trovate in rete
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    }).catch(() => {
      // Fallback offline: serve index.html per le route SPA
      if (event.request.mode === 'navigate') {
        return caches.match('/index.html');
      }
    })
  );
});

// ── MESSAGE: forza aggiornamento cache da app ──
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
