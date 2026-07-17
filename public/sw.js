// Service worker mínimo para que la app sea instalable (PWA).
// Estrategia conservadora para no servir versiones viejas tras un deploy:
// - Navegaciones (HTML): SIEMPRE red primero; el caché solo es respaldo offline.
// - /assets/ de Vite (nombres con hash, inmutables): caché primero.
// Al cambiar CACHE se limpia todo el caché anterior.
const CACHE = 'malla-v1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', e => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin) return // Supabase y fuentes: siempre red

  if (url.pathname.startsWith('/assets/')) {
    // inmutables: caché primero
    e.respondWith(
      caches.open(CACHE).then(c =>
        c.match(req).then(hit => hit || fetch(req).then(res => {
          if (res.ok) c.put(req, res.clone())
          return res
        }))
      )
    )
  } else {
    // HTML e íconos: red primero, caché como respaldo offline
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(req, res.clone()))
        return res
      }).catch(() =>
        caches.match(req).then(hit => hit || caches.match('/'))
      )
    )
  }
})
