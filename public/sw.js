// HoopStats Pilipinas Service Worker v31
const CACHE = 'hoopstats-v31';

// Clear ALL old caches on install
self.addEventListener('install', function(e) {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.map(function(key) {
          // Delete ALL caches to force fresh load
          return caches.delete(key);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// Network only for HTML, cache for static assets
self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;
  var url = e.request.url;
  if (!url.startsWith(self.location.origin)) return;

  // Static assets: cache with version
  if (url.includes('/css/') || url.includes('/icons/')) {
    e.respondWith(
      caches.open(CACHE).then(function(c) {
        return c.match(e.request).then(function(cached) {
          return cached || fetch(e.request).then(function(res) {
            if (res.ok) c.put(e.request, res.clone());
            return res;
          });
        });
      })
    );
    return;
  }

  // JS files: ALWAYS network (never cache) to ensure fresh code
  if (url.includes('/js/')) return;

  // HTML pages: always network
});
