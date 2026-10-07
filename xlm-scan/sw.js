/* XLM Scan service worker – chạy offline */
const VER = 'xlm-scan-v3.2.0';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'css/app.css', 'js/core.js', 'js/ipcore.js', 'js/imgproc.js', 'js/services.js', 'js/scan.js', 'js/editor.js', 'js/app.js',
  'lib/jspdf.umd.min.js', 'lib/tesseract.min.js', 'lib/worker.min.js', 'lib/pdf-lib.min.js', 'lib/pdf.min.js', 'lib/pdf.worker.min.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VER).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VER && k !== 'xlm-cdn').map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // thư viện OCR từ CDN: lưu lại để dùng offline
  if (/cdn\.jsdelivr\.net|tessdata\.projectnaptha\.com|unpkg\.com/.test(url.host)) {
    e.respondWith(caches.open('xlm-cdn').then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  // trang chính: ưu tiên mạng để nhận bản mới, mất mạng thì dùng bộ nhớ đệm
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => { caches.open(VER).then((c) => c.put('index.html', res.clone())); return res; })
      .catch(() => caches.match('index.html')));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => {
    const net = fetch(req).then((res) => { if (res.ok) caches.open(VER).then((c) => c.put(req, res.clone())); return res; }).catch(() => hit);
    return hit || net;
  }));
});
