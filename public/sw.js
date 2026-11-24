// Service worker: la app abre sin conexión y el horario queda guardado.
const V = 'tren-__VERSION__';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'config.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const isData = /(schedule|history|alerts)\.json$/.test(u.pathname);
  const isShell = u.origin === location.origin;
  if (!isData && !isShell) return; // Renfe, tiempo, fuentes: directo a la red
  e.respondWith((async () => {
    const cache = await caches.open(V);
    const key = isData ? u.origin + u.pathname : e.request;
    try {
      const r = await fetch(e.request);
      if (r.ok) cache.put(key, r.clone());
      return r;
    } catch (err) {
      const hit = await cache.match(key, { ignoreSearch: true });
      if (hit) return hit;
      throw err;
    }
  })());
});
