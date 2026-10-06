/* XLM Scan – lõi: tiện ích, biểu tượng, CSDL, điều hướng, hộp thoại */
'use strict';
const APP_VERSION = '3.1.0';
const SUPPORT_PHONE = '0396228768';

/* ---------- tiện ích DOM ---------- */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(9)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
}
const $ = (s, r = document) => r.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
function fmtDate(t, withTime = true) {
  const d = new Date(t);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` + (withTime ? ` ${pad(d.getHours())}:${pad(d.getMinutes())}` : '');
}
function stamp(t = Date.now()) {
  const d = new Date(t);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}
function fmtSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
}
function noAccent(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}
function safeName(s) {
  return noAccent(s).replace(/[^a-z0-9\-_. ]+/gi, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'tai_lieu';
}
const urlCache = new WeakMap();
function blobUrl(b) {
  if (!b) return '';
  let u = urlCache.get(b);
  if (!u) { u = URL.createObjectURL(b); urlCache.set(b, u); }
  return u;
}
function blobToDataURL(b) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
}
async function dataURLToBlob(u) { return (await fetch(u)).blob(); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- biểu tượng (nét, kiểu Feather) ---------- */
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  docs: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h6"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  scan: '<path d="M3 7V4a1 1 0 0 1 1-1h3M17 3h3a1 1 0 0 1 1 1v3M21 17v3a1 1 0 0 1-1 1h-3M7 21H4a1 1 0 0 1-1-1v-3M3 12h18"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  id: '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="11" r="2"/><path d="M5 16c.6-1.4 1.7-2 3-2s2.4.6 3 2M14 10h5M14 13h4"/>',
  receipt: '<path d="M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  text: '<path d="M4 7V5h16v2M9 19h6M12 5v14"/>',
  pdf: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 17v-4h1.5a1.2 1.2 0 0 1 0 2.5H8M12.5 17v-4h1a2 2 0 0 1 0 4zM17.5 13H16v4M16 15h1.3"/>',
  merge: '<path d="M8 3v6a4 4 0 0 0 4 4h0a4 4 0 0 1 4 4v4M16 3v6a4 4 0 0 1-4 4"/><path d="m5 6 3-3 3 3M13 6l3-3 3 3"/>',
  qr: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>',
  backup: '<path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4M12 3v12M7 8l5-5 5 5"/>',
  restore: '<path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4M12 15V3M7 10l5 5 5-5"/>',
  folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  folderPlus: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10v6M9 13h6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 19h16"/>',
  more: '<circle cx="12" cy="5" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="12" cy="19" r="1.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M15 18 9 12l6-6"/>',
  next: '<path d="m9 18 6-6-6-6"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  rotate: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  rotateR: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2"/>',
  filter: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M12 3a9 9 0 0 1 0 18"/>',
  flash: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14M10 11v6M14 11v6"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  word: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 12l1.3 5 1.7-4 1.7 4 1.3-5"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  move: '<path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>',
  left: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  right: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  storage: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  install: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M12 7v7M9 11l3 3 3-3M10 18h4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  sort: '<path d="M3 6h18M6 12h12M10 18h4"/>',
  wand: '<path d="m15 4 1-2 1 2 2 1-2 1-1 2-1-2-2-1zM4 20 16 8M14 6l4 4"/>',
  select: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8 12 3 3 5-6"/>',
  flip: '<path d="M12 3v18M8 7 3 12l5 5V7zM16 7l5 5-5 5V7z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  marker: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
  eraser: '<path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L11 21z"/><path d="M22 21H7M5 11l9 9"/>',
  sign: '<path d="M3 17c3-1 4-6 6-6s-1 7 2 7 3-5 5-5 1 3 3 3"/><path d="M3 21h18"/>',
  stamp: '<path d="M5 22h14M19 15H5v-2a2 2 0 0 1 2-2h3l-1-5a3 3 0 1 1 6 0l-1 5h3a2 2 0 0 1 2 2z"/>',
  type: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
  redo: '<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 15-6.7L21 13"/>',
  print: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  excel: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 12l4 5M12 12l-4 5M14 13h3M14 16h3"/>',
  extract: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5"/><path d="M14 3v6h6v3M15 18h6M18 15l3 3-3 3"/>',
  split: '<rect x="3" y="4" width="7" height="16" rx="1"/><rect x="14" y="4" width="7" height="16" rx="1"/><path d="M12 2v20" stroke-dasharray="2 2"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  pdfFile: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M9 15h6M12 12v6"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
};
function ic(name, size) {
  const s = h('span');
  s.innerHTML = `<svg class="i" viewBox="0 0 24 24"${size ? ` style="width:${size}px;height:${size}px"` : ''}>${ICONS[name] || ''}</svg>`;
  return s.firstChild;
}

/* ---------- CSDL IndexedDB ---------- */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('xlm-scan', 3);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('docs')) d.createObjectStore('docs', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('pages')) d.createObjectStore('pages', { keyPath: 'id' }).createIndex('docId', 'docId');
        if (!d.objectStoreNames.contains('folders')) d.createObjectStore('folders', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  req(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, mode), s = t.objectStore(store);
      const r = fn(s);
      t.oncomplete = () => res(r && 'result' in r ? r.result : undefined);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('Giao dịch bị huỷ (có thể hết dung lượng)'));
    });
  },
  get(st, id) { return this.req(st, 'readonly', (s) => s.get(id)); },
  put(st, v, key) { return this.req(st, 'readwrite', (s) => (key !== undefined ? s.put(v, key) : s.put(v))); },
  del(st, id) { return this.req(st, 'readwrite', (s) => s.delete(id)); },
  all(st) { return this.req(st, 'readonly', (s) => s.getAll()); },
  pagesOf(docId) { return this.req('pages', 'readonly', (s) => s.index('docId').getAll(docId)); },
};

/* ---------- cài đặt ---------- */
const DEFAULT_SETTINGS = {
  pdfSize: 'a4', pdfMargin: 6, quality: 'high', defFilter: 'magic', autoCapture: true,
  workshops: ['Phân xưởng Đào lò 1', 'Phân xưởng Đào lò 2', 'Phân xưởng Cơ điện', 'Phân xưởng Vận tải', 'Phòng Cơ điện', 'Phòng Kế toán'],
  kinds: ['Biên bản bàn giao', 'Biên bản kiểm kê', 'Lý lịch thiết bị', 'Hóa đơn', 'Phiếu xuất/nhập kho', 'Hợp đồng', 'Công văn', 'Bản vẽ', 'CCCD / Giấy tờ', 'Khác'],
  sort: 'updated',
};
const S = { ...DEFAULT_SETTINGS };
async function loadSettings() {
  try { Object.assign(S, (await DB.get('kv', 'settings')) || {}); } catch (e) {}
}
function saveSettings() { return DB.put('kv', { ...S }, 'settings'); }

/* ---------- điều hướng (hỗ trợ nút Back Android) ---------- */
const NAV = [];
let navSilent = 0;
function pushLayer(el, onClose) {
  document.body.append(el);
  NAV.push({ el, onClose });
  history.pushState({ l: NAV.length }, '');
  return el;
}
function replaceLayer(el, onClose) {
  const top = NAV.pop();
  if (top) { try { top.onClose && top.onClose('replace'); } catch (e) {} top.el.remove(); }
  document.body.append(el);
  NAV.push({ el, onClose });
  return el;
}
function closeLayer() { if (NAV.length) history.back(); }
window.addEventListener('popstate', () => {
  const top = NAV.pop();
  if (top) { try { top.onClose && top.onClose('back'); } catch (e) {} top.el.remove(); }
});
/* đóng nhiều lớp liên tiếp */
async function closeLayers(n) {
  for (let i = 0; i < n && NAV.length; i++) {
    await new Promise((r) => { window.addEventListener('popstate', () => setTimeout(r, 0), { once: true }); history.back(); });
  }
}

/* ---------- toast / loading / sheet / form ---------- */
let toastT;
function toast(msg, ms = 2200) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = h('div', { class: 'toast' }, msg);
  document.body.append(t);
  clearTimeout(toastT);
  toastT = setTimeout(() => t.remove(), ms);
}
function loading(msg) {
  const txt = h('span', null, msg || 'Đang xử lý…');
  const bar = h('i');
  const el = h('div', { class: 'loading' }, h('div', null, h('div', { class: 'spin' }), txt, h('div', { class: 'bar hidden' }, bar)));
  document.body.append(el);
  return {
    set(m, p) { if (m) txt.textContent = m; if (p != null) { bar.parentNode.classList.remove('hidden'); bar.style.width = Math.round(p * 100) + '%'; } },
    close() { el.remove(); },
  };
}
function sheet(title, items) {
  return new Promise((resolve) => {
    let val = null;
    const mask = h('div', { class: 'mask', onclick: (e) => { if (e.target === mask) closeLayer(); } },
      h('div', { class: 'sheet' }, h('div', { class: 'grab' }), title ? h('h4', null, title) : null,
        items.filter(Boolean).map((it) => h('button', {
          class: 'it' + (it.danger ? ' d' : ''),
          onclick: () => { val = it.value ?? it.label; closeLayer(); },
        }, it.icon ? ic(it.icon) : null, h('span', null, it.label)))));
    pushLayer(mask, () => setTimeout(() => resolve(val), 0));
  });
}
function confirmBox(msg, okLabel = 'Đồng ý', danger = false) {
  return sheet(msg, [{ label: okLabel, value: true, icon: danger ? 'trash' : 'check', danger }, { label: 'Huỷ', value: false, icon: 'close' }]).then((v) => v === true);
}
/* form: fields [{name,label,type,value,options,list,extra}] */
function formSheet(title, fields, okLabel = 'Lưu') {
  return new Promise((resolve) => {
    let val = null;
    const inputs = {};
    const body = h('div', { class: 'form' }, fields.map((f) => {
      let inp;
      if (f.type === 'select') {
        inp = h('select', null, f.options.map((o) => h('option', { value: o.value ?? o, selected: (o.value ?? o) === f.value }, o.label ?? o)));
      } else if (f.type === 'checkbox') {
        const cb = h('input', { type: 'checkbox' }); cb.checked = !!f.value;
        inputs[f.name] = cb;
        return h('label', { class: 'chk' }, cb, f.label);
      } else if (f.type === 'textarea') {
        inp = h('textarea', { placeholder: f.placeholder || '' }); inp.value = f.value || '';
      } else {
        const lid = f.list ? 'dl_' + f.name : null;
        inp = h('input', { type: f.type || 'text', placeholder: f.placeholder || '', list: lid, autocomplete: 'off' });
        inp.value = f.value || '';
        if (f.list) inp = [inp, h('datalist', { id: lid }, f.list.map((o) => h('option', { value: o })))];
      }
      const main = Array.isArray(inp) ? inp[0] : inp;
      inputs[f.name] = main;
      const ctrl = f.extra ? h('div', { class: 'inline' }, inp, f.extra(main)) : inp;
      return h('label', null, f.label, ctrl);
    }), h('div', { class: 'btns' },
      h('button', { class: 'btn w', onclick: () => closeLayer() }, 'Huỷ'),
      h('button', { class: 'btn p w', onclick: () => { val = {}; for (const k in inputs) val[k] = inputs[k].type === 'checkbox' ? inputs[k].checked : inputs[k].value.trim(); closeLayer(); } }, okLabel)));
    const mask = h('div', { class: 'mask', onclick: (e) => { if (e.target === mask) closeLayer(); } },
      h('div', { class: 'sheet' }, h('div', { class: 'grab' }), h('h4', null, title), body));
    pushLayer(mask, () => setTimeout(() => resolve(val), 0));
    setTimeout(() => { const f = body.querySelector('input,textarea'); if (f && fields[0].autofocus) f.focus(); }, 250);
  });
}
async function promptText(title, value = '', placeholder = '') {
  const r = await formSheet(title, [{ name: 'v', label: '', value, placeholder, autofocus: true }]);
  return r ? r.v : null;
}
function pickFiles(accept = 'image/*', multiple = true, capture) {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept, multiple, capture, style: { display: 'none' } });
    inp.onchange = () => { resolve([...inp.files]); inp.remove(); };
    document.body.append(inp);
    inp.click();
  });
}
function downloadBlob(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
async function shareOrDownload(blob, name, title) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: title || name }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  downloadBlob(blob, name);
  toast('Đã tải xuống: ' + name);
}
