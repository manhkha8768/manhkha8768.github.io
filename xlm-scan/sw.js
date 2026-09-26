/* XLM Scan — chạy offline */
const VERSION = 'xlmscan-v1.2.1';
const SHELL = [
  './', 'index.html', 'app.css', 'app.js', 'imaging.js', 'camera.js', 'annotate.js', 'exporter.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'vendor/jspdf.umd.min.js', 'vendor/jszip.min.js', 'vendor/fonts/pdf-vn.ttf', 'vendor/tesseract/tesseract.min.js', 'vendor/tesseract/worker.min.js',
   "fonts/be-vietnam-pro-latin-400-normal.woff2",  "fonts/be-vietnam-pro-latin-600-normal.woff2",  "fonts/be-vietnam-pro-latin-700-normal.woff2",  "fonts/be-vietnam-pro-latin-ext-400-normal.woff2",  "fonts/be-vietnam-pro-latin-ext-600-normal.woff2",  "fonts/be-vietnam-pro-latin-ext-700-normal.woff2",  "fonts/be-vietnam-pro-vietnamese-400-normal.woff2",  "fonts/be-vietnam-pro-vietnamese-600-normal.woff2",  "fonts/be-vietnam-pro-vietnamese-700-normal.woff2",  "fonts/jetbrains-mono-latin-500-normal.woff2",  "fonts/jetbrains-mono-vietnamese-500-normal.woff2",
];
// Bộ nhận dạng chữ (~12 MB) tải nền sau khi cài, để dùng được cả khi mất mạng
const HEAVY = [
  'vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js',
  'vendor/tesseract/core/tesseract-core-lstm.wasm.js',
  'vendor/tesseract/lang/vie.traineddata.gz',
  'vendor/tesseract/lang/eng.traineddata.gz',
];
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(SHELL);
    self.skipWaiting();
    Promise.all(HEAVY.map(u => c.add(u).catch(() => {})));
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    const hit = await c.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await c.match('index.html') : null);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    } catch (err) {
      if (req.mode === 'navigate') return c.match('index.html');
      throw err;
    }
  })());
});
