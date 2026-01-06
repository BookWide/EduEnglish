/* BookWide Talk Offline SW
   - caches talk_A.html + teacher videos
   - NOTE: video caching may be limited by browser storage/quota.
*/
const CACHE_NAME = 'bw-talk-v1';
const PRECACHE_URLS = [
  './talk_A.html',
  './talk_A_offline_ready.html',
  './', 
  "https://jeajrwpmrgczimmrflxo.supabase.co/storage/v1/object/public/assets/avatars/Lychee.mp4", "https://jeajrwpmrgczimmrflxo.supabase.co/storage/v1/object/public/assets/avatars/mermaid.mp4", "https://jeajrwpmrgczimmrflxo.supabase.co/storage/v1/object/public/assets/avatars/Pineapple.mp4"
].filter(Boolean);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Precache core files
    await cache.addAll(['./talk_A.html','./']); // safe minimal
    // Try cache teacher videos (best-effort)
    for (const url of ["https://jeajrwpmrgczimmrflxo.supabase.co/storage/v1/object/public/assets/avatars/Lychee.mp4", "https://jeajrwpmrgczimmrflxo.supabase.co/storage/v1/object/public/assets/avatars/mermaid.mp4", "https://jeajrwpmrgczimmrflxo.supabase.co/storage/v1/object/public/assets/avatars/Pineapple.mp4"]) {
      try {
        const res = await fetch(new Request(url, { mode: 'no-cors' }));
        await cache.put(url, res);
      } catch (e) {
        // ignore
      }
    }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k === CACHE_NAME) ? null : caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Navigation: cache-first so offline opens
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match('./talk_A.html') || await cache.match(req);
      if (cached) return cached;
      try {
        const fresh = await fetch(req);
        cache.put(req, fresh.clone()).catch(()=>{});
        return fresh;
      } catch (e) {
        return cached || new Response('Offline', {status: 503, headers:{'Content-Type':'text/plain'}});
      }
    })());
    return;
  }

  // Other requests: cache-first fallback to network
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req) || await cache.match(req.url);
    if (cached) return cached;
    try {
      const fresh = await fetch(req);
      // cache same-origin only (avoid quota blowups)
      if (new URL(req.url).origin === self.location.origin) {
        cache.put(req, fresh.clone()).catch(()=>{});
      }
      return fresh;
    } catch (e) {
      return cached || new Response('', {status: 504});
    }
  })());
});
