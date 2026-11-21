// Офлайн-кэш: приложение открывается без интернета.
// Новая версия ставится кнопкой «Обновить» в настройках (её показывает version.json).
const CACHE = 'budget-v6';
const FILES = ['./', './index.html', './app.js', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png', './sql-wasm.js', './sql-wasm.wasm'];

self.addEventListener('install', e => {
  // cache:'reload' — брать файлы с сервера, а не из HTTP-кэша браузера
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.endsWith('/version.json')) return; // всегда из сети
  e.respondWith(caches.open(CACHE).then(cache =>
    cache.match(req, { ignoreSearch: true }).then(cached => {
      const fresh = fetch(req, { cache: 'no-cache' }).then(res => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => cached);
      return cached || fresh;
    })
  ));
});
