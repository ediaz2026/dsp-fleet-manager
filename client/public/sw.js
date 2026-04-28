// Cache version — changes every time this file changes (Vite hashes JS/CSS
// but the SW itself is served from /sw.js and cached by the browser).
// Changing this constant forces the browser to install a new SW, which
// deletes old caches and claims all clients.
const CACHE_VERSION = '20260428a';
const CACHE_NAME = `dsp-fleet-${CACHE_VERSION}`;

// Install — skip waiting so new SW activates immediately
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Activate — delete ALL old caches, claim clients, notify them to reload
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names.filter(n => n !== CACHE_NAME).map(n => {
          console.log('[SW] Deleting old cache:', n);
          return caches.delete(n);
        })
      ))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => {
        clients.forEach(c => c.postMessage({ type: 'SW_UPDATED', version: CACHE_VERSION }));
      })
  );
});

// Push notification received
self.addEventListener('push', (event) => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    event.waitUntil(self.registration.showNotification(data.title || 'Last Mile DSP', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: [200, 100, 200],
      data: data.data || {},
      tag: data.data?.tag || 'default',
    }));
  } catch (e) { console.error('[SW] push parse error', e); }
});

// Notification click — open or focus the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes(self.location.origin) && 'focus' in c) {
          c.focus();
          if ('navigate' in c) c.navigate(url);
          return;
        }
      }
      return clients.openWindow(url);
    })
  );
});

// Fetch strategy:
//   HTML / navigation → network-first (never serve stale HTML)
//   API calls → network only (never cache)
//   Static assets (JS/CSS/images) → cache-first with network update
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API — always network, never cache
  if (url.pathname.startsWith('/api')) return;

  // HTML navigation — network first, fall back to cache only if offline
  if (event.request.mode === 'navigate' || event.request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request).then(c => c || caches.match('/')))
    );
    return;
  }

  // Static assets — cache first, background update
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        const networkFetch = fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => cached);

        return cached || networkFetch;
      })
    );
  }
});
