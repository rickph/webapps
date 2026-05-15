// Hoopstats Pilipinas — Service Worker
// Minimal version: only caches static assets, never routes

const CACHE = 'hoopstats-v2';

// Only cache truly static files — no HTML routes
const STATIC = [
  '/css/main.css',
  '/js/admin.js',
  '/js/public.js',
  '/js/livescore.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/manifest.json',
];

// Install — cache static assets one by one, skip failures
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      // Add each file individually — don't fail if one is missing
      return Promise.allSettled(
        STATIC.map(function(url) {
          return cache.add(url).catch(function(err) {
            console.warn('SW: Could not cache ' + url, err);
          });
        })
      );
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

// Activate — remove old caches
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// Fetch — network first for HTML, cache first for static assets
self.addEventListener('fetch', function(e) {
  var url = e.request.url;

  // Skip non-GET and cross-origin requests
  if (e.request.method !== 'GET') return;
  if (!url.startsWith(self.location.origin)) return;

  // For static assets: cache first
  if (url.includes('/css/') || url.includes('/js/') || url.includes('/icons/')) {
    e.respondWith(
      caches.match(e.request).then(function(cached) {
        return cached || fetch(e.request).then(function(res) {
          if (res.ok) {
            var clone = res.clone();
            caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
          }
          return res;
        });
      })
    );
    return;
  }

  // For everything else (HTML pages): network only — no caching
  // This prevents auth pages from being cached incorrectly
});
