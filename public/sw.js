const CACHE = 'ortak-kasa-v1'
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))))
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) return
  event.respondWith(fetch(event.request).then(response => {
    const clone = response.clone()
    caches.open(CACHE).then(cache => cache.put(event.request, clone))
    return response
  }).catch(() => caches.match(event.request)))
})
