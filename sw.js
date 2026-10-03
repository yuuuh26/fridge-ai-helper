const CACHE_NAME = 'fridge-ai-helper-shell-v17';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css?v=17',
  './app.js?v=17',
  './db.js?v=17',
  './backup.js?v=17',
  './backup-reminder.js?v=17',
  './fridges.js?v=17',
  './utils.js?v=17',
  './js/cloud.mjs',
  './js/cloud-store.mjs',
  './js/snapshot.mjs',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('fridge-ai-helper-shell-') && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url=new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/v1/')) return;
  if(!APP_SHELL.some(path=>new URL(path,self.location).pathname===url.pathname))return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then(response => response || caches.match('./index.html')))
  );
});
