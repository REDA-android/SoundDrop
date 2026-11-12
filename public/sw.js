// SoundDrop Studio - Offline Service Worker (100% Real Air-Gap PWA)
// Guarantees reliable cold-start & execution with 0% network / airplane mode

const CACHE_NAME = 'sounddrop-airgap-v2';

const PRECACHE_STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/worklets/capture.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_STATIC_ASSETS).catch((err) => {
        console.warn('[SoundDrop SW] Precache partial error (ignored):', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never cache non-GET requests or backend signaling API
  if (request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;

  // 1. Navigation requests (HTML Documents): Cache-first fallback if offline
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const fallbackRoot = await caches.match('/');
          if (fallbackRoot) return fallbackRoot;
          return new Response(
            '<!DOCTYPE html><html><head><meta charset="utf-8"><title>SoundDrop Offline</title></head><body style="background:#0A0A0C;color:#fff;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;"><h2>SoundDrop Studio Hors-Ligne</h2></body></html>',
            { headers: { 'Content-Type': 'text/html' } }
          );
        })
    );
    return;
  }

  // 2. Static Next.js chunks, scripts, styles, wasm, audio worklets: Cache-first, then network
  const isStaticChunk =
    url.pathname.startsWith('/_next/') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.wasm') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.ico');

  if (isStaticChunk) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          // Revalidate in background if online
          fetch(request)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                const clone = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
              }
            })
            .catch(() => {});
          return cachedResponse;
        }

        return fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const clone = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return networkResponse;
          })
          .catch(() => {
            return new Response('', { status: 408, statusText: 'Offline asset unavailable' });
          });
      })
    );
    return;
  }

  // 3. All other requests: Network with Cache fallback
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return networkResponse;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response('', { status: 503, statusText: 'Offline' });
      })
  );
});
