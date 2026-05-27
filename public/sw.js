/* ═══════════════════════════════════════════════════════
   $WATT PROTOCOL — Service Worker
   Strategy:
     - App shell → cache-first (served instantly offline)
     - API calls → network-first (never serve stale data)
     - CDN assets → stale-while-revalidate
   ═══════════════════════════════════════════════════════ */

const CACHE_VERSION = 'watt-v5';
const STATIC_CACHE  = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// App shell — pre-cached on install
const APP_SHELL = [
  '/',
  '/how-it-works.html',
  '/token.html',
  '/community.html',
  '/whitepaper.html',
  '/about.html',
  '/privacy.html',
  '/terms.html',
  '/404.html',
  '/leaderboard.html',
  '/shared.css',
  '/shared.js',
  '/icons.js',
  '/vendor/lucide.min.js',
  '/manifest.json',
  '/favicon.svg',
];

// ── Install: pre-cache app shell ────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()) // activate immediately
  );
});

// ── Activate: purge old caches ──────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith('watt-') && k !== STATIC_CACHE && k !== RUNTIME_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim()) // take control of all open tabs
  );
});

// Allow the page to trigger immediate activation for updates.
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── Fetch: routing logic ────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Skip non-GET and non-http(s) requests (e.g. chrome-extension://)
  if (request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;
  if (url.origin !== location.origin) {
    // CDN assets (Chart.js, QRCode, fonts): stale-while-revalidate
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // 2. API routes: network-first, fall through to offline page on failure
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/unsubscribe')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // 3. HTML navigations: network-first so UI updates show up immediately
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(networkFirstPage(request));
    return;
  }

  // 3. App shell & static assets: cache-first
  event.respondWith(cacheFirst(request));
});

// ── Strategy: network-first for HTML pages ─────────────────────────────────
async function networkFirstPage(request) {
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      try { cache.put(request, response.clone()); } catch {}
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    const fallback = await caches.match('/404.html');
    return fallback || new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

// ── Strategy: cache-first ───────────────────────────────────────────────────
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      try { cache.put(request, response.clone()); } catch { /* ignore uncacheable */ }
    }
    return response;
  } catch {
    // Offline fallback: return cached 404 page for navigation requests
    if (request.mode === 'navigate') {
      const fallback = await caches.match('/404.html');
      if (fallback) return fallback;
    }
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

// ── Strategy: network-first ─────────────────────────────────────────────────
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response(JSON.stringify({ error: 'Offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ── Strategy: stale-while-revalidate ───────────────────────────────────────
async function staleWhileRevalidate(request) {
  // Guard: only cache http(s) requests — chrome-extension:// etc. will throw
  if (!request.url.startsWith('http')) {
    return fetch(request).catch(() => new Response('', { status: 503 }));
  }

  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);

  const networkFetch = fetch(request).then(response => {
    if (response.ok) {
      try { cache.put(request, response.clone()); } catch { /* ignore uncacheable URLs */ }
    }
    return response;
  }).catch(() => null);

  return cached || await networkFetch || new Response('', { status: 503 });
}
