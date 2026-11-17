// ElectroSchool – offline mezipaměť webové verze. Verze se doplní při sestavení.
const CACHE = 'electroschool-20261117132238';
const FILES = ['./', 'index.html', 'style.css', 'core.js', 'symbols.js', 'real.js', 'calc.js', 'ui.js', 'examples.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// nejdřív síť (aby se po vydání nové verze hned načetla), bez sítě mezipaměť
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
