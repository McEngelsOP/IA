// Replaced at build time with a content-derived version and the offline module graph.
const CACHE = '__LYRA_CACHE__'
const PRELOAD = __LYRA_PRELOAD__
self.addEventListener('install', event => {
 event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRELOAD)).then(() => self.skipWaiting()))
})
self.addEventListener('activate', event => {
 event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('lyra-') && k !== CACHE || k === 'malla-v1').map(k => caches.delete(k)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', event => {
 const req = event.request, url = new URL(req.url)
 // Never cache authenticated responses, RPCs, API handlers, tokens, or external content.
 if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return
 if (req.mode === 'navigate') {
  event.respondWith(fetch(req).catch(async () => {
   const cache = await caches.open(CACHE)
   return await cache.match('/offline.html') || new Response('Abre Lyra con conexión para preparar la consulta offline.', { status: 503, headers: { 'Content-Type': 'text/plain;charset=utf-8' } })
  }))
 } else if (url.pathname.startsWith('/assets/') || ['/offline.html','/icon-192.png','/manifest.webmanifest'].includes(url.pathname)) {
  event.respondWith(caches.open(CACHE).then(async cache => {
   // Immutable same-origin files do not vary by the module request Origin header.
   const hit = await cache.match(req, { ignoreVary: true })
   if (hit) return hit
   const response = await fetch(req)
   if (response.ok) await cache.put(req, response.clone())
   return response
  }))
 }
})
self.addEventListener('notificationclick', event => {
 event.notification.close()
 event.waitUntil(self.clients.matchAll({ type: 'window' }).then(list => {
  const client = list.find(c => new URL(c.url).origin === self.location.origin)
  return client ? client.focus() : self.clients.openWindow('/pagina.html')
 }))
})
