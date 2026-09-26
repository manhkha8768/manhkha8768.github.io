'use strict';
/* XLM Scan — quét tài liệu cho Công ty Xây lắp Mỏ – TKV
   Dữ liệu chỉ nằm trên máy (IndexedDB). */
const APP_VERSION = '1.2.1';
const SUPPORT_PHONE = '0396228768';

/* =========================================================== tiện ích */
const $ = (s, r = document) => r.querySelector(s);
function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'style') e.style.cssText = v;
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'hidden' || k === 'selected') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const fold = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
const pad = n => String(n).padStart(2, '0');
function fmtDate(ts, withTime = true) {
  const d = new Date(ts);
  const s = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  return withTime ? `${s} ${pad(d.getHours())}:${pad(d.getMinutes())}` : s;
}
function fmtBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1).replace('.', ',') + ' MB';
  return (b / 1073741824).toFixed(2).replace('.', ',') + ' GB';
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nextFrame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
function safeName(s) { return (s || 'tai-lieu').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'tai-lieu'; }
function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[data-src="${src}"]`)) return res();
    const s = el('script', { src, 'data-src': src });
    s.onload = res; s.onerror = () => { s.remove(); rej(new Error('Không tải được ' + src)); };
    document.head.append(s);
  });
}
const abs = p => new URL(p, location.href).href;

const IC = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  more: '<circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/>',
  share: '<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13"/>',
  text: '<path d="M4 7V5h16v2M9 20h6M12 5v15"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14"/>',
  rotate: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 19h16"/>',
  upload: '<path d="M12 15V3M7 8l5-5 5 5M4 19h16"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  wand: '<path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M17.8 6.2 19 5M12.2 6.2 11 5M3 21l9-9"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  left: '<path d="M15 18l-6-6 6-6"/>',
  right: '<path d="M9 18l6-6-6-6"/>',
  doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  zoom: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M11 8v6M8 11h6"/>',
  erase: '<path d="m7 21-4-4 11-11 7 7-8 8z"/><path d="M7 21h13M10 10l7 7"/>',
  book: '<path d="M12 6c-2-1.5-5-2-9-2v14c4 0 7 .5 9 2 2-1.5 5-2 9-2V4c-4 0-7 .5-9 2zM12 6v14"/>',
  idcard: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16c.5-1.5 1.7-2 3-2s2.5.5 3 2M14 10h4M14 13h3"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  sign: '<path d="M3 17c3-4 5-9 7-9s-1 9 1 9 3-4 5-4 1 3 3 3M3 21h18"/>',
  merge: '<path d="M8 3v5a4 4 0 0 0 4 4h0a4 4 0 0 1 4 4v5M16 3v5a4 4 0 0 1-4 4"/>',
  split: '<path d="M12 3v18M5 8l-3 4 3 4M19 8l3 4-3 4"/>',
  select: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m8 12 3 3 5-6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
};
const icon = (n, cls = 'i') => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', cls); s.setAttribute('viewBox', '0 0 24 24'); s.innerHTML = IC[n]; return s; };

/* =========================================================== lưu trữ (IndexedDB) */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('xlmscan', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('docs', { keyPath: 'id' });
        d.createObjectStore('pages', { keyPath: 'id' }).createIndex('docId', 'docId');
        d.createObjectStore('folders', { keyPath: 'id' });
        d.createObjectStore('assets', { keyPath: 'code' });
        d.createObjectStore('kv');
      };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  _req(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, mode);
      const r = fn(t.objectStore(store));
      t.oncomplete = () => res(r && 'result' in r ? r.result : undefined);
      t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('Giao dịch bị hủy'));
    });
  },
  get(s, k) { return this._req(s, 'readonly', o => o.get(k)); },
  all(s) { return this._req(s, 'readonly', o => o.getAll()); },
  put(s, v, k) { return this._req(s, 'readwrite', o => k === undefined ? o.put(v) : o.put(v, k)); },
  del(s, k) { return this._req(s, 'readwrite', o => o.delete(k)); },
  clear(s) { return this._req(s, 'readwrite', o => o.clear()); },
  putMany(s, arr) { return this._req(s, 'readwrite', o => { arr.forEach(v => o.put(v)); }); },
};

/* =========================================================== trạng thái */
const DEFAULT_SETTINGS = { pdfSize: 'a4', filter: 'magic', quality: 'std', ocrLang: 'vie', autoOcr: false, liveCam: true, autoCapture: true };
const FILTERS = [['magic', 'Tăng cường'], ['bw', 'Trắng đen'], ['gray', 'Xám'], ['original', 'Ảnh gốc']];
const QUALITY = { std: 2800, high: 3600 };
const State = { docs: [], folders: [], assets: [], settings: { ...DEFAULT_SETTINGS }, folder: 'all', tab: 'docs', q: '', aq: '' };

async function loadAll() {
  const [docs, folders, assets, settings] = await Promise.all([DB.all('docs'), DB.all('folders'), DB.all('assets'), DB.get('kv', 'settings')]);
  State.docs = docs.sort((a, b) => b.updatedAt - a.updatedAt);
  State.folders = folders.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'vi'));
  State.assets = assets.sort((a, b) => a.code.localeCompare(b.code, 'vi', { numeric: true }));
  State.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
}
async function saveSettings() { await DB.put('kv', State.settings, 'settings'); }
const folderName = id => State.folders.find(f => f.id === id)?.name || 'Chưa phân loại';
const assetBy = code => State.assets.find(a => a.code === code);

/* URL ảnh xem trước, giải phóng khi trang đổi */
const Urls = new Map();
function blobUrl(key, blob) {
  const cur = Urls.get(key);
  if (cur && cur.blob === blob) return cur.url;
  if (cur) URL.revokeObjectURL(cur.url);
  const url = URL.createObjectURL(blob); Urls.set(key, { blob, url }); return url;
}
function dropUrl(key) { const c = Urls.get(key); if (c) { URL.revokeObjectURL(c.url); Urls.delete(key); } }
const thumbCache = new Map();
async function thumbUrl(pageId) {
  if (thumbCache.has(pageId)) return thumbCache.get(pageId);
  const p = await DB.get('pages', pageId);
  const u = p ? blobUrl('t:' + pageId, p.thumb) : '';
  thumbCache.set(pageId, u); return u;
}
function forgetPage(id) { thumbCache.delete(id); dropUrl('t:' + id); dropUrl('i:' + id); }

/* =========================================================== lớp điều hướng (nút Back của Android) */
const Layers = {
  stack: [], waiters: [],
  push(onPop) { this.stack.push(onPop); history.pushState({ depth: this.stack.length }, ''); },
  back() { return new Promise(r => { this.waiters.push(r); history.back(); }); },
};
window.addEventListener('popstate', () => {
  const fn = Layers.stack.pop(); const w = Layers.waiters.shift();
  try { if (fn) fn(); } finally { if (w) w(); }
});

/* =========================================================== thông báo, hộp thoại */
let toastTimer;
function toast(msg, ms = 2400) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = el('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), ms);
}
function sheet({ title, sub, body, actions = [], onOpen }) {
  return new Promise(resolve => {
    let result = null;
    const box = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title || '' },
      el('div', { class: 'grip' }),
      title && el('h2', {}, title), sub && el('p', { class: 'sub' }, sub),
      body && el('div', { class: 'body' }, body),
      actions.length > 0 && el('div', { class: 'acts' }, actions.map(a => el('button', {
        class: 'btn ' + (a.kind || ''), type: 'button',
        onclick: async () => {
          const v = typeof a.value === 'function' ? await a.value() : a.value;
          if (v === undefined) return; // giữ bảng mở (lỗi kiểm tra dữ liệu)
          close(v);
        },
      }, a.label))));
    const scrim = el('div', { class: 'scrim', onclick: e => { if (e.target === scrim) close(null); } }, box);
    document.body.append(scrim);
    const close = v => { result = v; Layers.back(); };
    Layers.push(() => { scrim.remove(); resolve(result); });
    onOpen && onOpen(box, close);
    const first = box.querySelector('input,textarea'); if (first && !first.dataset.noautofocus) setTimeout(() => first.focus(), 60);
  });
}
const confirmBox = (title, sub, ok = 'Xóa', kind = 'danger') =>
  sheet({ title, sub, actions: [{ label: 'Hủy', value: false }, { label: ok, value: true, kind }] }).then(v => v === true);
async function promptBox(title, label, value = '', ok = 'Lưu') {
  const inp = el('input', { type: 'text', value, id: 'prompt-input' });
  const v = await sheet({
    title, body: el('div', { class: 'field' }, el('label', { for: 'prompt-input' }, label), inp),
    actions: [{ label: 'Hủy', value: null }, { label: ok, kind: 'primary', value: () => inp.value.trim() || undefined }],
    onOpen: (b, close) => inp.addEventListener('keydown', e => { if (e.key === 'Enter' && inp.value.trim()) close(inp.value.trim()); }),
  });
  return v;
}
function menuSheet(title, items) {
  return sheet({
    title,
    body: el('div', { class: 'menu' }, items.filter(Boolean).map(it => el('button', {
      type: 'button', class: it.danger ? 'danger' : '',
      onclick: e => { e.currentTarget.closest('.sheet').__close(it.value); },
    }, icon(it.icon), it.label))),
    onOpen: (b, close) => { b.__close = close; },
  });
}
const Busy = {
  el: null,
  show(msg) {
    this.hide();
    this.el = el('div', { class: 'busy', role: 'alert' }, el('div', { class: 'bx' },
      el('div', { class: 'spin' }), el('div', { class: 'msg' }, msg), el('div', { class: 'bar', hidden: true }, el('i'))));
    document.body.append(this.el);
  },
  update(msg, frac) {
    if (!this.el) return;
    if (msg != null) this.el.querySelector('.msg').textContent = msg;
    if (frac != null) { const b = this.el.querySelector('.bar'); b.hidden = false; b.firstChild.style.width = Math.round(frac * 100) + '%'; }
  },
  hide() { this.el?.remove(); this.el = null; },
};

/* =========================================================== tab chính */
function setTab(tab) {
  State.tab = tab;
  if (tab !== 'docs' && State.sel) { State.sel = null; renderSelBar(); }
  document.querySelectorAll('[data-tab]').forEach(s => s.hidden = s.dataset.tab !== tab);
  document.querySelectorAll('.tab[data-go]').forEach(b => b.setAttribute('aria-current', b.dataset.go === tab ? 'page' : 'false'));
  if (tab === 'docs') renderDocs(); else if (tab === 'assets') renderAssets(); else renderSettings();
  window.scrollTo(0, 0);
}
function refresh() { if (State.tab === 'docs') renderDocs(); else if (State.tab === 'assets') renderAssets(); else renderSettings(); }

/* ---------- danh sách tài liệu */
function docMatches(doc, q) {
  if (!q) return { ok: true };
  const a = assetBy(doc.assetCode);
  const meta = fold([doc.name, doc.note, doc.assetCode, a?.name, a?.unit, folderName(doc.folderId)].join(' '));
  const words = q.split(/\s+/).filter(Boolean);
  if (words.every(w => meta.includes(w))) return { ok: true };
  const text = Object.values(doc.ocr || {}).join('\n');
  const ft = fold(text);
  if (words.every(w => ft.includes(w) || meta.includes(w))) {
    const i = ft.indexOf(words[0]);
    const start = Math.max(0, i - 40);
    return { ok: true, snip: text.slice(start, i + 90).replace(/\s+/g, ' '), hit: text.slice(i, i + words[0].length) };
  }
  return { ok: false };
}
function renderFolderChips() {
  const box = $('#folder-chips'); box.replaceChildren();
  const count = id => State.docs.filter(d => id === 'all' || (d.folderId || '') === id).length;
  const chip = (id, label) => el('button', {
    class: 'chip', type: 'button', 'aria-pressed': String(State.folder === id),
    onclick: () => { State.folder = id; renderDocs(); },
  }, label, el('span', { class: 'n' }, count(id)));
  box.append(chip('all', 'Tất cả'));
  State.folders.forEach(f => box.append(chip(f.id, f.name)));
  if (State.docs.some(d => !d.folderId)) box.append(chip('', 'Chưa phân loại'));
  box.append(el('button', { class: 'chip add', type: 'button', onclick: manageFolders }, icon('folder'), 'Thư mục'));
}
async function renderDocs() {
  renderFolderChips();
  renderSelBar();
  $('#doc-total').textContent = State.docs.length ? `${State.docs.length} tài liệu` : '';
  const q = fold(State.q.trim());
  const list = $('#doc-list'); list.replaceChildren();
  const rows = [];
  for (const d of State.docs) {
    if (State.folder !== 'all' && (d.folderId || '') !== State.folder) continue;
    const m = docMatches(d, q); if (!m.ok) continue;
    rows.push([d, m]);
  }
  const empty = $('#doc-empty');
  if (!rows.length) {
    empty.hidden = false;
    empty.replaceChildren(...(State.docs.length
      ? [el('h3', {}, 'Không tìm thấy tài liệu'), el('p', {}, q ? 'Thử từ khóa khác, hoặc bấm "Nhận dạng chữ" trong tài liệu để tìm được theo nội dung.' : 'Thư mục này chưa có tài liệu.')]
      : [emptyArt(), el('h3', {}, 'Chưa có tài liệu nào'),
        el('p', {}, 'Bấm nút quét màu vàng để chụp biên bản, lý lịch thiết bị hay chứng từ. App tự tìm mép giấy, nắn phẳng và làm rõ chữ.'),
        el('button', { class: 'btn accent', onclick: () => startScan({ source: 'camera' }) }, icon('camera'), 'Quét tài liệu đầu tiên')]));
    return;
  }
  empty.hidden = true;
  for (const [d, m] of rows) {
    const a = d.assetCode ? assetBy(d.assetCode) : null;
    const th = el('div', { class: 'thumb' }, el('span', { class: 'pc' }, d.pageIds.length));
    const selMode = !!State.sel, checked = selMode && State.sel.has(d.id);
    const btn = el('button', { class: 'row' + (checked ? ' checked' : ''), type: 'button', 'aria-pressed': selMode ? String(checked) : null,
      onclick: () => { if (btn.__long) { btn.__long = false; return; } if (State.sel) toggleSel(d.id); else openDoc(d.id); } },
      selMode && el('span', { class: 'check', 'aria-hidden': 'true' }, checked ? icon('check') : null),
      th,
      el('div', { class: 'row-body' },
        el('div', { class: 'row-title' }, d.name),
        el('div', { class: 'row-meta' }, `${folderName(d.folderId)} · ${fmtDate(d.updatedAt)}`),
        d.assetCode && el('div', { class: 'tag' }, el('span', { class: 'code' }, d.assetCode), a?.name && el('span', { class: 'nm' }, a.name)),
        m.snip && snippet(m.snip, m.hit)));
    longPress(btn, () => { if (!State.sel) { State.sel = new Set(); } toggleSel(d.id); });
    const li = el('li', {}, btn);
    list.append(li);
    if (d.pageIds[0]) thumbUrl(d.pageIds[0]).then(u => { if (u) th.style.backgroundImage = `url("${u}")`; });
  }
}
function snippet(text, hit) {
  const s = el('div', { class: 'row-snip' });
  const i = hit ? text.indexOf(hit) : -1;
  if (i < 0) { s.textContent = '…' + text + '…'; return s; }
  s.append('…' + text.slice(0, i), el('mark', {}, hit), text.slice(i + hit.length) + '…');
  return s;
}
function emptyArt() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 96 96');
  s.innerHTML = '<rect x="22" y="12" width="52" height="70" rx="4" fill="var(--surface)" stroke="var(--line)" stroke-width="2"/><path d="M32 30h32M32 40h32M32 50h22M32 60h28" stroke="var(--line)" stroke-width="3" stroke-linecap="round"/><path d="M12 26V16a4 4 0 0 1 4-4h10M70 12h10a4 4 0 0 1 4 4v10M84 70v10a4 4 0 0 1-4 4H70M26 84H16a4 4 0 0 1-4-4V70" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round"/>';
  return s;
}

/* ---------- thư mục */
async function manageFolders() {
  const list = el('div', { class: 'menu' });
  const draw = () => {
    list.replaceChildren(...State.folders.map(f => el('button', {
      type: 'button', onclick: async () => {
        const act = await menuSheet(f.name, [
          { icon: 'edit', label: 'Đổi tên', value: 'rename' },
          { icon: 'trash', label: 'Xóa thư mục', value: 'delete', danger: true },
        ]);
        if (act === 'rename') {
          const n = await promptBox('Đổi tên thư mục', 'Tên thư mục', f.name);
          if (n) { f.name = n; await DB.put('folders', f); }
        } else if (act === 'delete') {
          const cnt = State.docs.filter(d => d.folderId === f.id).length;
          if (await confirmBox(`Xóa thư mục "${f.name}"?`, cnt ? `${cnt} tài liệu trong thư mục sẽ chuyển sang "Chưa phân loại". Tài liệu không bị xóa.` : 'Thư mục đang trống.')) {
            for (const d of State.docs.filter(d => d.folderId === f.id)) { d.folderId = ''; await DB.put('docs', d); }
            await DB.del('folders', f.id);
            if (State.folder === f.id) State.folder = 'all';
          }
        }
        await loadAll(); draw(); renderDocs();
      },
    }, icon('folder'), el('span', { style: 'flex:1' }, f.name), el('span', { class: 'count' }, State.docs.filter(d => d.folderId === f.id).length))));
  };
  draw();
  await sheet({
    title: 'Thư mục', sub: 'Bấm vào thư mục để đổi tên hoặc xóa.', body: list,
    actions: [{ label: 'Đóng', value: false }, { label: 'Thêm thư mục', kind: 'primary', value: async () => { await addFolder(); draw(); return undefined; } }],
  });
  renderDocs();
}
async function addFolder() {
  const n = await promptBox('Thư mục mới', 'Tên thư mục', '', 'Tạo');
  if (!n) return null;
  const f = { id: uid(), name: n, order: State.folders.length };
  await DB.put('folders', f); await loadAll(); return f.id;
}

/* =========================================================== chi tiết tài liệu */
async function openDoc(id) {
  const scr = el('div', { class: 'screen', role: 'region', 'aria-label': 'Tài liệu' });
  document.body.append(scr);
  Layers.push(() => { scr.remove(); refresh(); });
  let showOcr = false;
  const render = async () => {
    const doc = await DB.get('docs', id);
    if (!doc) { Layers.back(); return; }
    const a = doc.assetCode ? assetBy(doc.assetCode) : null;
    const hasOcr = doc.pageIds.some(p => doc.ocr?.[p]);
    scr.replaceChildren(
      el('header', { class: 'topbar' }, el('div', { class: 'wrap' },
        el('button', { class: 'icon-btn', 'aria-label': 'Quay lại', onclick: () => Layers.back() }, icon('back')),
        el('div', { class: 'h1' }, doc.name),
        el('button', { class: 'icon-btn', 'aria-label': 'Thêm thao tác', onclick: () => docMenu(doc, render) }, icon('more')))),
      el('div', { class: 'wrap', style: 'display:grid;gap:16px;padding-top:4px' },
        el('div', { class: 'card' },
          el('div', { class: 'kv' }, el('span', { class: 'k' }, 'Tài sản'),
            el('button', { class: 'v', onclick: async () => { const c = await pickAsset(doc.assetCode); if (c !== null) { doc.assetCode = c; doc.updatedAt = Date.now(); await DB.put('docs', doc); await loadAll(); render(); } } },
              doc.assetCode ? el('span', { class: 'tag' }, el('span', { class: 'code' }, doc.assetCode), el('span', { class: 'nm' }, a?.name || '')) : el('span', { class: 'placeholder' }, 'Chưa gắn — bấm để chọn'))),
          el('div', { class: 'kv' }, el('span', { class: 'k' }, 'Thư mục'), el('span', { class: 'v' }, folderName(doc.folderId))),
          el('div', { class: 'kv' }, el('span', { class: 'k' }, 'Ngày quét'), el('span', { class: 'v mono', style: 'font-size:14px' }, fmtDate(doc.createdAt))),
          doc.note && el('div', { class: 'kv' }, el('span', { class: 'k' }, 'Ghi chú'), el('span', { class: 'v', style: 'font-weight:400' }, doc.note))),
        el('div', {},
          el('div', { class: 'section-label' }, `${doc.pageIds.length} trang`),
          el('div', { class: 'pages', id: 'pg' })),
        hasOcr && el('div', {},
          el('div', { class: 'ocr-head' }, el('div', { class: 'section-label' }, 'Nội dung chữ nhận dạng'),
            el('button', { class: 'btn sm ghost', onclick: () => copyText(ocrText(doc)) }, icon('copy'), 'Sao chép')),
          el('div', { class: 'ocr-box', id: 'ocr-box' }, ocrText(doc))),
      ),
      el('div', { class: 'actionbar' }, el('div', { class: 'wrap' },
        el('button', { class: 'act primary', onclick: () => exportDoc(doc) }, icon('share'), 'Xuất file'),
        el('button', { class: 'act', onclick: async () => { await runOcr(doc); render(); } }, icon('text'), hasOcr ? 'Nhận dạng lại' : 'Nhận dạng chữ'),
        el('button', { class: 'act', onclick: () => startScan({ source: 'camera', docId: doc.id, onDone: render }) }, icon('camera'), 'Thêm trang'),
        el('button', { class: 'act', onclick: () => editDocInfo(doc).then(render) }, icon('edit'), 'Sửa thông tin'))),
    );
    const grid = scr.querySelector('#pg');
    doc.pageIds.forEach((pid, i) => {
      const img = el('div', { class: 'pimg', role: 'img', 'aria-label': `Trang ${i + 1}` });
      grid.append(el('button', { class: 'page-tile', type: 'button', onclick: () => openViewer(doc.id, i, render) }, img, `Trang ${i + 1}`));
      thumbUrl(pid).then(u => { if (u) img.style.backgroundImage = `url("${u}")`; });
    });
    grid.append(el('button', { class: 'page-tile addp', type: 'button', onclick: () => startScan({ source: 'gallery', docId: doc.id, onDone: render }) },
      el('div', { class: 'pimg' }, icon('image')), 'Thêm từ thư viện'));
  };
  await render();
  return render;
}
const ocrText = doc => doc.pageIds.map((p, i) => doc.ocr?.[p] ? (doc.pageIds.length > 1 ? `— Trang ${i + 1} —\n` : '') + doc.ocr[p].trim() : '').filter(Boolean).join('\n\n');
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast('Đã sao chép nội dung'); }
  catch { toast('Không sao chép được — hãy chọn chữ và sao chép thủ công'); }
}
async function docMenu(doc, render) {
  const v = await menuSheet(doc.name, [
    { icon: 'share', label: 'Xuất PDF / Word / ảnh', value: 'export' },
    doc.pageIds.length > 1 && { icon: 'split', label: 'Tách trang ra tài liệu mới', value: 'split' },
    { icon: 'edit', label: 'Sửa tên, thư mục, ghi chú', value: 'edit' },
    { icon: 'trash', label: 'Xóa tài liệu', value: 'delete', danger: true },
  ]);
  if (v === 'export') exportDoc(doc);
  else if (v === 'split') { await splitDoc(doc); render(); }
  else if (v === 'edit') { await editDocInfo(doc); render(); }
  else if (v === 'delete') {
    if (await confirmBox(`Xóa "${doc.name}"?`, `${doc.pageIds.length} trang ảnh sẽ bị xóa khỏi máy. Không khôi phục được.`)) {
      await deleteDoc(doc); toast('Đã xóa tài liệu'); Layers.back();
    }
  }
}
async function deleteDoc(doc) {
  for (const p of doc.pageIds) { await DB.del('pages', p); forgetPage(p); }
  await DB.del('docs', doc.id); await loadAll();
}

/* ---------- biểu mẫu thông tin tài liệu */
function docForm(init) {
  const vals = { name: init.name || '', folderId: init.folderId || '', assetCode: init.assetCode || '', note: init.note || '' };
  const name = el('input', { id: 'f-name', type: 'text', value: vals.name, 'data-noautofocus': '1' });
  const folder = el('select', { id: 'f-folder' });
  const fillFolders = () => {
    folder.replaceChildren(el('option', { value: '' }, 'Chưa phân loại'),
      ...State.folders.map(f => el('option', { value: f.id, selected: f.id === vals.folderId }, f.name)),
      el('option', { value: '__new' }, '+ Tạo thư mục mới…'));
    folder.value = vals.folderId;
  };
  fillFolders();
  folder.addEventListener('change', async () => {
    if (folder.value === '__new') { const id = await addFolder(); if (id) vals.folderId = id; fillFolders(); }
    else vals.folderId = folder.value;
  });
  const assetBtn = el('button', { type: 'button', class: 'picker', id: 'f-asset' });
  const drawAsset = () => {
    const a = assetBy(vals.assetCode);
    assetBtn.replaceChildren(vals.assetCode
      ? el('span', { class: 'tag' }, el('span', { class: 'code' }, vals.assetCode), el('span', { class: 'nm' }, a?.name || ''))
      : el('span', { class: 'ph' }, 'Chọn tài sản / thiết bị…'));
  };
  drawAsset();
  assetBtn.addEventListener('click', async () => { const c = await pickAsset(vals.assetCode); if (c !== null) { vals.assetCode = c; drawAsset(); } });
  const note = el('textarea', { id: 'f-note', placeholder: 'VD: Bàn giao cho PX Đào lò 1, có chữ ký quản đốc' }, vals.note);
  const body = [
    el('div', { class: 'field' }, el('label', { for: 'f-name' }, 'Tên tài liệu'), name),
    el('div', { class: 'field' }, el('label', { for: 'f-asset' }, 'Gắn vào tài sản'), assetBtn),
    el('div', { class: 'field' }, el('label', { for: 'f-folder' }, 'Thư mục'), folder),
    el('div', { class: 'field' }, el('label', { for: 'f-note' }, 'Ghi chú'), note),
  ];
  const read = () => ({ ...vals, name: name.value.trim() || init.name || 'Tài liệu', note: note.value.trim() });
  return { body, read };
}
async function editDocInfo(doc) {
  const f = docForm(doc);
  const v = await sheet({ title: 'Thông tin tài liệu', body: f.body, actions: [{ label: 'Hủy', value: null }, { label: 'Lưu', kind: 'primary', value: () => f.read() }] });
  if (!v) return;
  Object.assign(doc, v, { updatedAt: Date.now() });
  await DB.put('docs', doc); await loadAll(); toast('Đã lưu');
}

/* ---------- chọn tài sản */
async function pickAsset(current) {
  const q = el('input', { type: 'search', id: 'asset-q', placeholder: 'Gõ mã hoặc tên tài sản…', autocomplete: 'off' });
  const list = el('div', { class: 'pick-list', role: 'listbox' });
  let closeFn;
  const draw = () => {
    const s = fold(q.value.trim()); const raw = q.value.trim();
    const hits = State.assets.filter(a => !s || fold(`${a.code} ${a.name} ${a.unit} ${a.type}`).includes(s)).slice(0, 80);
    list.replaceChildren(...[
      ...hits.map(a => el('button', { type: 'button', role: 'option', 'aria-selected': String(a.code === current), onclick: () => closeFn(a.code) },
        el('span', { class: 'code' }, a.code), el('span', {}, a.name || '—'), el('span', { class: 'u' }, [a.unit, a.type].filter(Boolean).join(' · ') || ' '))),
      raw && !State.assets.some(a => fold(a.code) === fold(raw)) && el('button', {
        type: 'button', onclick: async () => {
          const a = { code: raw.toUpperCase(), name: '', unit: '', type: '' };
          await DB.put('assets', a); await loadAll(); closeFn(a.code);
        },
      }, el('span', { class: 'code' }, '+'), el('span', {}, `Dùng mã mới "${raw.toUpperCase()}"`), el('span', { class: 'u' }, 'Thêm vào danh sách tài sản, bổ sung tên sau')),
      !State.assets.length && !raw && el('p', { class: 'muted', style: 'margin:8px 4px' }, 'Danh sách tài sản đang trống. Gõ mã để dùng ngay, hoặc vào tab Tài sản để nhập cả danh sách từ Excel.'),
    ].filter(Boolean));
  };
  q.addEventListener('input', draw); draw();
  const v = await sheet({
    title: 'Gắn vào tài sản', body: [q, list],
    actions: current ? [{ label: 'Bỏ gắn', value: '' }, { label: 'Đóng', value: null }] : [{ label: 'Đóng', value: null }],
    onOpen: (b, c) => { closeFn = c; },
  });
  return v;
}

/* ---------- xem trang */
async function openViewer(docId, index, onChange) {
  const v = el('div', { class: 'viewer' }); document.body.append(v);
  Layers.push(() => { v.remove(); onChange && onChange(); });
  let i = index;
  const draw = async () => {
    const doc = await DB.get('docs', docId);
    if (!doc || !doc.pageIds.length) { Layers.back(); return; }
    i = Math.min(i, doc.pageIds.length - 1);
    const page = await DB.get('pages', doc.pageIds[i]);
    const img = el('img', { alt: `Trang ${i + 1}`, src: blobUrl('i:' + page.id, page.image) });
    const holder = el('div', { class: 'vimg', ondblclick: () => holder.classList.toggle('zoom') }, img);
    v.replaceChildren(
      el('div', { class: 'sc-top' },
        el('button', { class: 'icon-btn', 'aria-label': 'Đóng', onclick: () => Layers.back() }, icon('back')),
        el('div', { class: 'sc-title' }, `Trang ${i + 1} / ${doc.pageIds.length}`),
        el('button', { class: 'icon-btn', 'aria-label': 'Phóng to', onclick: () => holder.classList.toggle('zoom') }, icon('zoom'))),
      holder,
      el('div', { class: 'sc-tools', style: 'padding-bottom:12px;flex-wrap:wrap' },
        el('button', { class: 'sc-tool', disabled: i === 0, onclick: () => { i--; draw(); } }, icon('left'), 'Trước'),
        el('button', { class: 'sc-tool', onclick: () => editPage(doc, page, draw) }, icon('crop'), 'Sửa lại'),
        el('button', { class: 'sc-tool', onclick: () => Annotate.open(page, async res => {
          Object.assign(page, res); await DB.put('pages', page); forgetPage(page.id);
          doc.updatedAt = Date.now(); await DB.put('docs', doc); await loadAll(); draw();
        }) }, icon('sign'), 'Ký & ghi chú'),
        el('button', { class: 'sc-tool', onclick: () => moveMenu() }, icon('more'), 'Sắp xếp'),
        el('button', { class: 'sc-tool', onclick: async () => {
          if (!(await confirmBox(`Xóa trang ${i + 1}?`, doc.pageIds.length === 1 ? 'Đây là trang duy nhất, tài liệu sẽ bị xóa luôn.' : 'Ảnh trang này sẽ bị xóa khỏi máy.'))) return;
          if (doc.pageIds.length === 1) { await deleteDoc(doc); toast('Đã xóa tài liệu'); Layers.back(); return; }
          const pid = doc.pageIds.splice(i, 1)[0]; if (doc.ocr) delete doc.ocr[pid];
          doc.updatedAt = Date.now(); await DB.put('docs', doc); await DB.del('pages', pid); forgetPage(pid); await loadAll(); draw();
        } }, icon('trash'), 'Xóa'),
        el('button', { class: 'sc-tool', disabled: i >= doc.pageIds.length - 1, onclick: () => { i++; draw(); } }, icon('right'), 'Sau')),
    );
    async function moveMenu() {
      const act = await menuSheet(`Trang ${i + 1}`, [
        i > 0 && { icon: 'left', label: 'Chuyển lên trước 1 trang', value: -1 },
        i < doc.pageIds.length - 1 && { icon: 'right', label: 'Chuyển ra sau 1 trang', value: 1 },
        i > 0 && { icon: 'upload', label: 'Chuyển lên đầu', value: -i },
        i < doc.pageIds.length - 1 && { icon: 'download', label: 'Chuyển xuống cuối', value: doc.pageIds.length - 1 - i },
      ]);
      if (!act) return;
      const [pid] = doc.pageIds.splice(i, 1); const j = i + act; doc.pageIds.splice(j, 0, pid);
      doc.updatedAt = Date.now(); await DB.put('docs', doc); i = j; toast(`Đã chuyển thành trang ${j + 1}`); draw();
    }
  };
  await draw();
}

/* =========================================================== máy quét */
const Scan = { pages: [], cur: 0, opts: null, root: null, previewCache: new Map(), saved: false, panel: null };

function pickFiles(source) {
  return new Promise(resolve => {
    const inp = source === 'camera' ? $('#cam-input') : $('#gal-input');
    inp.value = '';
    let done = false;
    const finish = files => { if (done) return; done = true; window.removeEventListener('focus', onFocus); resolve(files); };
    const onFocus = () => setTimeout(() => { if (!inp.files?.length) finish([]); }, 1200);
    inp.onchange = () => finish([...inp.files]);
    inp.oncancel = () => finish([]);
    window.addEventListener('focus', onFocus, { once: true });
    inp.click();
  });
}
/** Đọc 1 ảnh thành 1 trang quét: ảnh gốc, ảnh nhỏ để xem trước, khung giấy tự nhận */
async function importBlob(blob, hintCorners) {
  const full = await Imaging.blobToCanvas(blob, 4096);
  const small = Imaging.scaleCanvas(full, 1100);
  let corners = Imaging.detectQuad(small);
  const auto = !!(corners || hintCorners);
  corners = corners || hintCorners || Imaging.FULL();
  return {
    key: uid(), kind: 'doc', src: await Imaging.toBlob(full, 'image/jpeg', 0.95), small: await Imaging.toBlob(small, 'image/jpeg', 0.9),
    corners, auto, rot: 0, filter: State.settings.filter, adj: null, erase: [], annots: [],
    thumb: Imaging.scaleCanvas(small, 160).toDataURL('image/jpeg', 0.6),
  };
}
async function importFiles(files) {
  const out = [];
  Busy.show(files.length > 1 ? `Đang xử lý ${files.length} ảnh…` : 'Đang xử lý ảnh…');
  try {
    for (let k = 0; k < files.length; k++) {
      Busy.update(files.length > 1 ? `Đang xử lý ảnh ${k + 1}/${files.length}…` : null, files.length > 1 ? k / files.length : null);
      await nextFrame();
      out.push(await importBlob(files[k]));
    }
  } catch (e) { toast(e.message || 'Không đọc được ảnh'); }
  finally { Busy.hide(); }
  return out;
}
/** Lấy ảnh: camera trong app (nếu được) hoặc camera/thư viện của máy */
async function acquire(source) {
  if (source === 'camera' && State.settings.liveCam !== false && Camera.supported()) {
    const pages = await Camera.open({ mode: 'doc', importBlob });
    if (pages) return { pages, live: true };
    toast('Không mở được camera trong app — chuyển sang camera của máy', 3500);
  }
  const files = await pickFiles(source);
  return { pages: files.length ? await importFiles(files) : [], live: false };
}

/** opts: { source:'camera'|'gallery', docId?, assetCode?, onDone? } */
async function startScan(opts) {
  const { pages, live } = await acquire(opts.source);
  if (!pages.length) return;
  Scan.pages = pages; Scan.cur = 0; Scan.opts = opts; Scan.previewCache.clear(); Scan.saved = false; Scan.panel = null;
  openScanner();
  if (pages.length === 1 && (!live || !pages[0].auto) && pages[0].kind === 'doc') openCrop(0);
}
function openScanner() {
  const root = el('div', { class: 'scanner', role: 'dialog', 'aria-label': 'Quét tài liệu' });
  Scan.root = root; document.body.append(root);
  const onPop = async () => {
    if (Scan.pages.length && !Scan.saved) {
      const ok = await confirmBox('Bỏ các trang vừa quét?', `${Scan.pages.length} trang chưa được lưu sẽ mất.`, 'Bỏ đi');
      if (!ok) { Layers.push(onPop); return; }
    }
    root.remove(); Scan.pages = []; Scan.saved = false; Scan.previewCache.clear(); Scan.root = null;
  };
  Layers.push(onPop);
  drawScanner();
}
async function addScanPages(source) {
  const { pages, live } = await acquire(source);
  if (!pages.length) return;
  Scan.pages.push(...pages); Scan.cur = Scan.pages.length - pages.length;
  drawScanner();
  if (pages.length === 1 && (!live || !pages[0].auto) && pages[0].kind === 'doc') openCrop(Scan.cur);
}
async function previewOf(p) {
  const sig = JSON.stringify([p.kind, p.corners, p.parts && p.parts.map(x => x.corners), p.rot, p.filter, p.half, p.adj, p.erase]);
  const c = Scan.previewCache.get(p.key);
  if (c && c.sig === sig) return c.canvas;
  let canvas;
  if (p.kind === 'id') canvas = Imaging.renderId(await Promise.all(p.parts.map(x => Imaging.blobToCanvas(x.small))), p, 1300);
  else canvas = Imaging.render(await Imaging.blobToCanvas(p.small), p, p.half ? 1800 : 1100);
  Scan.previewCache.set(p.key, { sig, canvas });
  return canvas;
}
async function updatePreview() {
  const root = Scan.root; if (!root) return;
  const stage = root.querySelector('.sc-stage'); const p = Scan.pages[Scan.cur];
  const c = await previewOf(p);
  if (Scan.pages[Scan.cur] !== p || !stage.isConnected) return;
  stage.replaceChildren(c);
  const t = root.querySelector(`.sthumb[data-key="${p.key}"]`);
  if (t) t.style.backgroundImage = `url("${c.toDataURL('image/jpeg', 0.5)}")`;
}
function splitToggle(i) {
  const p = Scan.pages[i];
  if (p.half) {
    const g = p.group, first = Scan.pages.findIndex(x => x.group === g);
    Scan.pages = Scan.pages.filter(x => x.group !== g);
    Scan.pages.splice(first, 0, { ...p, key: uid(), half: null, group: null, erase: [] });
    Scan.cur = first; toast('Đã gộp lại thành 1 trang');
  } else {
    const g = uid();
    Scan.pages.splice(i, 1, { ...p, key: uid(), half: 'L', group: g, erase: [] }, { ...p, key: uid(), half: 'R', group: g, erase: [] });
    toast('Đã tách thành 2 trang trái / phải');
  }
  drawScanner();
}
function joinIdCard(i) {
  const a = Scan.pages[i], b = Scan.pages[i + 1];
  const part = x => ({ src: x.src, small: x.small, corners: x.corners, auto: x.auto });
  Scan.pages.splice(i, 2, { ...a, key: uid(), kind: 'id', parts: [part(a), part(b)], half: null, group: null, erase: [], rot: 0 });
  toast('Đã ghép mặt trước + mặt sau vào 1 trang A4');
  drawScanner();
}
function adjustPanel(p) {
  const adj = p.adj || { b: 0, c: 0, s: 0 };
  let t;
  const slider = (key, label, min, max) => {
    const out = el('output', {}, adj[key] || 0);
    const inp = el('input', { type: 'range', min, max, step: 1, value: adj[key] || 0, id: 'adj-' + key, oninput: e => {
      adj[key] = +e.target.value; out.textContent = adj[key]; p.adj = { ...adj };
      clearTimeout(t); t = setTimeout(updatePreview, 120);
    } });
    return el('label', { class: 'adj-row', for: 'adj-' + key }, el('span', {}, label), inp, out);
  };
  return el('div', { class: 'adj-panel' },
    slider('b', 'Độ sáng', -50, 50), slider('c', 'Tương phản', -50, 50), slider('s', 'Làm nét', 0, 100),
    el('div', { class: 'adj-acts' },
      el('button', { class: 'fchip', type: 'button', onclick: () => { p.adj = null; drawScanner(); } }, 'Mặc định'),
      el('button', { class: 'fchip', type: 'button', onclick: () => { Scan.panel = null; drawScanner(); } }, 'Xong')));
}
async function drawScanner() {
  const root = Scan.root; if (!root) return;
  const p = Scan.pages[Scan.cur];
  const editing = !!Scan.opts.pageId;
  const stage = el('div', { class: 'sc-stage' }, el('div', { class: 'loading' }, 'Đang dựng trang…'));
  const strip = el('div', { class: 'sc-strip' });
  const tool = (ic, label, onclick, hidden) => hidden ? null : el('button', { class: 'sc-tool', type: 'button', onclick }, icon(ic), label);
  const next = Scan.pages[Scan.cur + 1];
  root.replaceChildren(...[
    el('div', { class: 'sc-top' },
      el('button', { class: 'icon-btn', 'aria-label': 'Hủy', onclick: () => Layers.back() }, icon('close')),
      el('div', { class: 'sc-title' }, editing ? 'Sửa trang' : `Trang ${Scan.cur + 1} / ${Scan.pages.length}` + (p.kind === 'id' ? ' · CCCD' : p.half ? (p.half === 'L' ? ' · trái' : ' · phải') : '')),
      el('button', { class: 'sc-done', onclick: finishScan }, icon('check'), editing ? 'Lưu' : Scan.opts.docId ? 'Thêm' : 'Lưu')),
    stage,
    Scan.panel === 'adj' ? adjustPanel(p) : el('div', { class: 'sc-filters', role: 'toolbar', 'aria-label': 'Bộ lọc' }, FILTERS.map(([k, label]) => el('button', {
      class: 'fchip', type: 'button', 'aria-pressed': String(p.filter === k),
      onclick: () => { p.filter = k; drawScanner(); },
    }, label))),
    el('div', { class: 'sc-tools' },
      tool('crop', 'Cắt khung', () => openCrop(Scan.cur)),
      tool('rotate', 'Xoay', () => { p.rot = ((p.rot || 0) + 1) % 4; p.erase = []; drawScanner(); }),
      tool('wand', 'Chỉnh ảnh', () => { Scan.panel = Scan.panel === 'adj' ? null : 'adj'; drawScanner(); }),
      tool('erase', 'Tẩy', () => openErase(p)),
      tool('book', p.half ? 'Gộp đôi' : 'Tách đôi', () => splitToggle(Scan.cur), editing || p.kind === 'id'),
      tool('idcard', 'Ghép CCCD', () => joinIdCard(Scan.cur), editing || p.kind === 'id' || p.half || !next || next.kind === 'id' || next.half),
      tool('layers', 'Áp tất cả', () => { const f = p.filter, a = p.adj; Scan.pages.forEach(x => { x.filter = f; x.adj = a ? { ...a } : null; }); toast('Đã áp bộ lọc & chỉnh ảnh cho mọi trang'); drawScanner(); }, Scan.pages.length < 2),
      tool('trash', 'Xóa trang', async () => {
        if (Scan.pages.length === 1) { Layers.back(); return; }
        Scan.pages.splice(Scan.cur, 1); Scan.cur = Math.max(0, Scan.cur - 1); drawScanner();
      }, editing)),
    editing ? null : strip,
  ].filter(Boolean));
  if (!editing) {
    Scan.pages.forEach((q, i) => {
      const t = el('button', { class: 'sthumb', type: 'button', 'data-key': q.key, 'aria-label': `Trang ${i + 1}`, 'aria-current': String(i === Scan.cur), onclick: () => { Scan.cur = i; drawScanner(); } }, el('span', {}, i + 1));
      if (q.thumb) t.style.backgroundImage = `url("${q.thumb}")`;
      strip.append(t);
      previewOf(q).then(c => { t.style.backgroundImage = `url("${c.toDataURL('image/jpeg', 0.5)}")`; });
    });
    strip.append(
      el('button', { class: 'sadd', type: 'button', 'aria-label': 'Chụp thêm trang', onclick: () => addScanPages('camera') }, icon('camera')),
      el('button', { class: 'sadd', type: 'button', 'aria-label': 'Thêm ảnh từ thư viện', onclick: () => addScanPages('gallery') }, icon('image')));
    requestAnimationFrame(() => strip.children[Scan.cur]?.scrollIntoView({ inline: 'center', block: 'nearest' }));
  }
  await nextFrame();
  const c = await previewOf(p);
  if (Scan.pages[Scan.cur] !== p || !stage.isConnected) return;
  stage.replaceChildren(c);
}

/* ---------- cọ tẩy vết bẩn */
async function openErase(p) {
  const base = await previewOf({ ...p, key: p.key + ':noerase', erase: [] });
  const col = Imaging.paperColor(base);
  let strokes = JSON.parse(JSON.stringify(p.erase || [])), cur = null, size = 0.03;
  const undo = [];
  const cv = el('canvas');
  const wrap = el('div', { class: 'crop-wrap' }, cv);
  const root = el('div', { class: 'scanner', style: 'z-index:45' });
  let result = null;
  document.body.append(root);
  Layers.push(() => { root.remove(); window.removeEventListener('resize', layout); if (result) { p.erase = result; drawScanner(); } });
  const sizeOut = el('output', {}, '');
  root.append(
    el('div', { class: 'sc-top' },
      el('button', { class: 'icon-btn', 'aria-label': 'Hủy', onclick: () => Layers.back() }, icon('close')),
      el('div', { class: 'sc-title' }, 'Tẩy vết bẩn'),
      el('button', { class: 'sc-done', onclick: () => { result = strokes; Layers.back(); } }, icon('check'), 'Xong')),
    wrap,
    el('div', { class: 'crop-hint' }, 'Tô lên vết bẩn, dấu tay, chữ viết thừa — app phủ bằng màu nền giấy.'),
    el('div', { class: 'adj-panel' },
      el('label', { class: 'adj-row', for: 'erase-size' }, el('span', {}, 'Cỡ cọ'),
        el('input', { type: 'range', id: 'erase-size', min: 1, max: 10, step: 0.5, value: size * 100, oninput: e => { size = e.target.value / 100; sizeOut.textContent = e.target.value; } }), sizeOut),
      el('div', { class: 'adj-acts' },
        el('button', { class: 'fchip', type: 'button', onclick: () => { if (undo.length) { strokes = undo.pop(); paint(); } } }, 'Hoàn tác'),
        el('button', { class: 'fchip', type: 'button', onclick: () => { undo.push(strokes); strokes = []; paint(); } }, 'Xóa hết nét tẩy'))));
  sizeOut.textContent = size * 100;
  const ctx = cv.getContext('2d');
  let box = { x: 0, y: 0, w: 1, h: 1 }, dpr = 1;
  function layout() {
    dpr = devicePixelRatio || 1; const r = wrap.getBoundingClientRect();
    cv.width = r.width * dpr; cv.height = r.height * dpr;
    const s = Math.min((r.width - 24) / base.width, (r.height - 24) / base.height);
    box = { w: base.width * s, h: base.height * s }; box.x = (r.width - box.w) / 2; box.y = (r.height - box.h) / 2;
    paint();
  }
  function paint() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(base, box.x, box.y, box.w, box.h);
    ctx.save(); ctx.translate(box.x, box.y); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = col; ctx.fillStyle = col;
    for (const s of strokes.concat(cur ? [cur] : [])) {
      ctx.lineWidth = s.w * box.w;
      ctx.beginPath(); s.pts.forEach(([x, y], i) => i ? ctx.lineTo(x * box.w, y * box.h) : ctx.moveTo(x * box.w, y * box.h));
      if (s.pts.length === 1) { ctx.arc(s.pts[0][0] * box.w, s.pts[0][1] * box.h, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill(); } else ctx.stroke();
    }
    ctx.restore();
  }
  const norm = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left - box.x) / box.w, (e.clientY - r.top - box.y) / box.h]; };
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); e.preventDefault(); cur = { w: size, pts: [norm(e)] }; paint(); });
  cv.addEventListener('pointermove', e => { if (cur) { cur.pts.push(norm(e)); paint(); } });
  const up = () => { if (cur) { undo.push(strokes); strokes = strokes.concat([cur]); cur = null; paint(); } };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  window.addEventListener('resize', layout);
  await nextFrame(); layout();
}

/* ---------- cắt khung */
async function openCrop(index) {
  const p = Scan.pages[index];
  const targets = p.kind === 'id' ? p.parts.map((x, i) => ({ obj: x, label: i ? 'Mặt sau' : 'Mặt trước' })) : [{ obj: p }];
  const work = targets.map(t => t.obj.corners.map(c => c.slice()));
  const imgs = await Promise.all(targets.map(t => Imaging.blobToCanvas(t.obj.small)));
  let ti = 0, img = imgs[0], corners = work[0];
  const root = el('div', { class: 'scanner', style: 'z-index:45' });
  const wrap = el('div', { class: 'crop-wrap' });
  const cv = el('canvas'); wrap.append(cv);
  let result = null;
  document.body.append(root);
  Layers.push(() => {
    root.remove(); window.removeEventListener('resize', layout);
    if (!result) return;
    targets.forEach((t, i) => { t.obj.corners = result[i]; t.obj.auto = true; });
    if (p.group) Scan.pages.forEach(x => { if (x.group === p.group) { x.corners = result[0]; x.erase = []; } });
    p.erase = [];
    drawScanner();
  });
  const hint = el('div', { class: 'crop-hint' });
  const seg = targets.length > 1 ? el('div', { class: 'sc-filters' }, targets.map((t, i) => el('button', { class: 'fchip', type: 'button', 'aria-pressed': String(i === ti), onclick: e => {
    ti = i; img = imgs[i]; corners = work[i];
    seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
    setHint(); layout();
  } }, t.label))) : null;
  const setHint = () => { hint.textContent = targets[ti].obj.auto ? 'Đã tự nhận mép giấy. Kéo góc hoặc cạnh nếu chưa khớp.' : 'Chưa nhận được mép giấy tự động. Kéo góc về đúng vị trí.'; };
  setHint();
  root.append(
    el('div', { class: 'sc-top' },
      el('button', { class: 'icon-btn', 'aria-label': 'Hủy', onclick: () => Layers.back() }, icon('close')),
      el('div', { class: 'sc-title' }, 'Kéo 4 góc vào mép giấy'),
      el('button', { class: 'sc-done', onclick: () => { result = work; Layers.back(); } }, icon('check'), 'Xong')),
    ...[seg, wrap, hint].filter(Boolean),
    el('div', { class: 'crop-bar' },
      el('button', { class: 'sc-tool', onclick: () => { const q = Imaging.detectQuad(img); if (q) { work[ti] = corners = q; toast('Đã nhận mép giấy'); } else toast('Không tìm thấy mép giấy rõ ràng'); paint(); } }, icon('wand'), 'Tự nhận'),
      el('button', { class: 'sc-tool', onclick: () => { work[ti] = corners = Imaging.FULL(); paint(); } }, icon('full'), 'Toàn ảnh')),
  );
  const ctx = cv.getContext('2d');
  let box = { x: 0, y: 0, w: 1, h: 1 }, dpr = 1, drag = null, loupe = null;
  function layout() {
    dpr = window.devicePixelRatio || 1;
    const r = wrap.getBoundingClientRect();
    cv.width = r.width * dpr; cv.height = r.height * dpr;
    const padd = 28, s = Math.min((r.width - padd * 2) / img.width, (r.height - padd * 2) / img.height);
    box = { w: img.width * s, h: img.height * s }; box.x = (r.width - box.w) / 2; box.y = (r.height - box.h) / 2;
    paint();
  }
  const toScreen = ([x, y]) => [box.x + x * box.w, box.y + y * box.h];
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#E09A10';
  function paint() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(img, box.x, box.y, box.w, box.h);
    const pts = corners.map(toScreen);
    ctx.save();
    ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h);
    ctx.moveTo(...pts[0]); pts.slice(1).forEach(q => ctx.lineTo(...q)); ctx.closePath();
    ctx.fillStyle = 'rgba(5,10,14,.55)'; ctx.fill('evenodd');
    ctx.beginPath(); ctx.moveTo(...pts[0]); pts.slice(1).forEach(q => ctx.lineTo(...q)); ctx.closePath();
    ctx.lineWidth = 2; ctx.strokeStyle = accent; ctx.stroke();
    if (p.half) {
      ctx.setLineDash([8, 6]); ctx.beginPath();
      ctx.moveTo((pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2); ctx.lineTo((pts[3][0] + pts[2][0]) / 2, (pts[3][1] + pts[2][1]) / 2);
      ctx.stroke(); ctx.setLineDash([]);
    }
    pts.forEach((q, i) => {
      const m = pts[(i + 1) % 4];
      ctx.beginPath(); ctx.arc((q[0] + m[0]) / 2, (q[1] + m[1]) / 2, 7, 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = accent; ctx.stroke();
    });
    pts.forEach(q => {
      ctx.beginPath(); ctx.arc(q[0], q[1], 12, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = accent; ctx.stroke();
    });
    ctx.restore();
    if (loupe) {
      const [lx, ly] = loupe, R = 56, Z = 2.5;
      const cx = lx < cv.width / dpr / 2 ? cv.width / dpr - R - 12 : R + 12, cy = R + 12;
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = '#000'; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
      const sx = (lx - box.x) / box.w * img.width, sy = (ly - box.y) / box.h * img.height;
      const sr = R / Z * (img.width / box.w);
      ctx.drawImage(img, sx - sr, sy - sr, sr * 2, sr * 2, cx - R, cy - R, R * 2, R * 2);
      ctx.strokeStyle = accent; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(cx - 10, cy); ctx.lineTo(cx + 10, cy); ctx.moveTo(cx, cy - 10); ctx.lineTo(cx, cy + 10); ctx.stroke();
      ctx.restore();
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
    }
  }
  const clamp01 = v => Math.min(1, Math.max(0, v));
  cv.addEventListener('pointerdown', e => {
    const r = cv.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
    const pts = corners.map(toScreen);
    let best = null, bd = 44;
    pts.forEach((q, i) => { const d = Math.hypot(q[0] - x, q[1] - y); if (d < bd) { bd = d; best = { type: 'c', i }; } });
    if (!best) pts.forEach((q, i) => {
      const m = pts[(i + 1) % 4]; const d = Math.hypot((q[0] + m[0]) / 2 - x, (q[1] + m[1]) / 2 - y);
      if (d < bd) { bd = d; best = { type: 'e', i }; }
    });
    if (!best) return;
    drag = { ...best, x, y, start: corners.map(c => c.slice()) };
    cv.setPointerCapture(e.pointerId); e.preventDefault();
  });
  cv.addEventListener('pointermove', e => {
    if (!drag) return;
    const r = cv.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
    const dx = (x - drag.x) / box.w, dy = (y - drag.y) / box.h;
    if (drag.type === 'c') {
      corners[drag.i] = [clamp01(drag.start[drag.i][0] + dx), clamp01(drag.start[drag.i][1] + dy)];
      loupe = toScreen(corners[drag.i]);
    } else {
      const a = drag.i, b = (drag.i + 1) % 4;
      corners[a] = [clamp01(drag.start[a][0] + dx), clamp01(drag.start[a][1] + dy)];
      corners[b] = [clamp01(drag.start[b][0] + dx), clamp01(drag.start[b][1] + dy)];
      loupe = null;
    }
    paint();
  });
  const end = () => { drag = null; loupe = null; paint(); };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  window.addEventListener('resize', layout);
  await nextFrame(); layout();
}

/* ---------- lưu kết quả quét */
async function renderFullPage(p, maxSide) {
  let out;
  if (p.kind === 'id') out = Imaging.renderId(await Promise.all(p.parts.map(x => Imaging.blobToCanvas(x.src))), p, maxSide * 1.2);
  else out = Imaging.render(await Imaging.blobToCanvas(p.src), p, p.half ? maxSide * 1.6 : maxSide);
  const final = p.annots && p.annots.length ? await Annotate.bake(out, p.annots) : out;
  const q = 0.92;
  return {
    image: await Imaging.toBlob(final, 'image/jpeg', q),
    base: final !== out ? await Imaging.toBlob(out, 'image/jpeg', q) : null,
    thumb: await Imaging.toBlob(Imaging.scaleCanvas(final, 280), 'image/jpeg', 0.75),
    w: final.width, h: final.height,
  };
}
function pageRecord(p, r) {
  const rec = { ...r, kind: p.kind || 'doc', rot: p.rot || 0, filter: p.filter, half: p.half || null, group: p.group || null, adj: p.adj || null, erase: p.erase || [], annots: p.annots || [], words: null };
  if (p.kind === 'id') { rec.sources = p.parts.map(x => x.src); rec.parts = p.parts.map(x => ({ corners: x.corners })); rec.source = null; }
  else { rec.source = p.src; rec.corners = p.corners; }
  return rec;
}
async function finishScan() {
  const opts = Scan.opts;
  let meta = null;
  if (!opts.docId && !opts.pageId) {
    const f = docForm({ name: `Tài liệu ${fmtDate(Date.now())}`, assetCode: opts.assetCode || '', folderId: State.folder !== 'all' ? State.folder : '' });
    meta = await sheet({ title: 'Lưu tài liệu', sub: `${Scan.pages.length} trang`, body: f.body, actions: [{ label: 'Quay lại', value: null }, { label: 'Lưu', kind: 'primary', value: () => f.read() }] });
    if (!meta) return;
  }
  const maxSide = QUALITY[State.settings.quality] || 2000;
  Busy.show('Đang lưu…');
  let docId = opts.docId;
  try {
    const now = Date.now();
    if (opts.pageId) {
      const p = Scan.pages[0];
      const r = await renderFullPage(p, maxSide);
      const old = await DB.get('pages', opts.pageId);
      await DB.put('pages', { ...old, ...pageRecord(p, r) });
      forgetPage(opts.pageId);
      const doc = await DB.get('docs', old.docId);
      if (doc.ocr) delete doc.ocr[opts.pageId];
      doc.updatedAt = now; await DB.put('docs', doc);
    } else {
      const ids = [];
      for (let k = 0; k < Scan.pages.length; k++) {
        Busy.update(`Đang lưu trang ${k + 1}/${Scan.pages.length}…`, k / Scan.pages.length);
        await nextFrame();
        const p = Scan.pages[k];
        const r = await renderFullPage(p, maxSide);
        const id = uid(); ids.push(id);
        await DB.put('pages', { id, docId: docId || '__pending', ...pageRecord(p, r), createdAt: now });
      }
      if (docId) {
        const doc = await DB.get('docs', docId);
        doc.pageIds.push(...ids); doc.updatedAt = now; await DB.put('docs', doc);
      } else {
        docId = uid();
        await DB.put('docs', { id: docId, ...meta, pageIds: ids, ocr: {}, createdAt: now, updatedAt: now });
      }
      for (const id of ids) { const pg = await DB.get('pages', id); pg.docId = docId; await DB.put('pages', pg); }
    }
    await loadAll();
  } catch (e) {
    Busy.hide(); console.error(e);
    toast(e.name === 'QuotaExceededError' ? 'Máy hết dung lượng lưu trữ. Hãy xóa bớt tài liệu cũ.' : 'Lỗi khi lưu: ' + (e.message || e));
    return;
  }
  Busy.hide();
  Scan.saved = true;
  const wasNew = !opts.docId && !opts.pageId;
  await Layers.back();
  toast(opts.pageId ? 'Đã cập nhật trang' : wasNew ? 'Đã lưu tài liệu' : 'Đã thêm trang');
  if (opts.onDone) opts.onDone();
  if (wasNew) {
    refresh();
    const rerender = await openDoc(docId);
    if (State.settings.autoOcr) { await runOcr(await DB.get('docs', docId)); rerender(); }
  }
}
async function smallOf(blob) { return Imaging.toBlob(Imaging.scaleCanvas(await Imaging.blobToCanvas(blob), 1100), 'image/jpeg', 0.9); }
async function editPage(doc, page, onDone) {
  Busy.show('Đang mở trang…');
  let sp;
  const common = { key: page.id, rot: page.rot || 0, filter: page.filter || 'magic', adj: page.adj || null, erase: page.erase || [], annots: page.annots || [], auto: true };
  try {
    if (page.kind === 'id' && page.sources) {
      const parts = await Promise.all(page.sources.map(async (s, i) => ({ src: s, small: await smallOf(s), corners: page.parts[i].corners, auto: true })));
      sp = { ...common, kind: 'id', parts, src: parts[0].src, small: parts[0].small };
    } else {
      const source = page.source || page.base || page.image;
      sp = { ...common, kind: 'doc', src: source, small: await smallOf(source), corners: page.source ? (page.corners || Imaging.FULL()) : Imaging.FULL(), half: page.source ? page.half : null };
      if (!page.source) { sp.filter = 'original'; sp.rot = 0; }
    }
  } finally { Busy.hide(); }
  Scan.pages = [sp];
  Scan.cur = 0; Scan.opts = { pageId: page.id, onDone }; Scan.previewCache.clear(); Scan.saved = false; Scan.panel = null;
  openScanner();
}

/* =========================================================== xuất file & chia sẻ */
function downloadBlob(blob, name) {
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function shareFiles(files, title) {
  if (navigator.canShare && navigator.canShare({ files })) {
    try { await navigator.share({ files, title }); return true; }
    catch (e) { if (e.name === 'AbortError') return true; }
  }
  return false;
}
/** Sau khi tạo file xong: hỏi Chia sẻ hay Tải về (bấm nút mới cho phép mở bảng chia sẻ) */
async function deliver(files, title) {
  const canShare = !!(navigator.canShare && navigator.canShare({ files }));
  const size = files.reduce((n, f) => n + f.size, 0);
  const v = await sheet({
    title: 'File đã sẵn sàng', sub: `${files.length > 1 ? files.length + ' file' : files[0].name} · ${fmtBytes(size)}`,
    actions: [{ label: 'Tải về máy', value: 'dl' }].concat(canShare ? [{ label: 'Chia sẻ (Zalo, Gmail…)', kind: 'primary', value: 'share' }] : []),
  });
  if (v === 'share') { if (!(await shareFiles(files, title))) v2(); }
  else if (v === 'dl') v2();
  async function v2() { for (const f of files) { downloadBlob(f, f.name); await sleep(300); } toast(files.length > 1 ? `Đã tải ${files.length} ảnh` : `Đã tải ${files[0].name}`); }
}
async function exportDoc(doc) {
  const s = State.settings;
  const o = { fmt: 'pdf', size: s.pdfSize, textLayer: true, password: '', compress: false, images: false };
  const pages = await Promise.all(doc.pageIds.map(id => DB.get('pages', id)));
  const hasWords = pages.every(p => p.words);
  const hasText = doc.pageIds.every(id => doc.ocr?.[id] != null);
  const box = el('div', { class: 'exp-body' });
  const seg = (key, opts) => el('div', { class: 'seg', role: 'group' }, opts.map(([v, l]) => el('button', { type: 'button', 'aria-pressed': String(o[key] === v), onclick: () => { o[key] = v; draw(); } }, l)));
  const sw = key => el('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(!!o[key]), onclick: () => { o[key] = !o[key]; draw(); } });
  const row = (t, sub, ctrl) => el('div', { class: 'set-row' }, el('div', { class: 't' }, el('b', {}, t), sub && el('span', {}, sub)), ctrl);
  const pw = el('input', { type: 'text', id: 'exp-pw', placeholder: 'Để trống nếu không cần', autocomplete: 'off', 'data-noautofocus': '1', oninput: e => { o.password = e.target.value; } });
  function draw() {
    box.replaceChildren(...[
      el('div', { class: 'exp-fmt' }, seg('fmt', [['pdf', 'PDF'], ['word', 'Word'], ['jpg', 'Ảnh JPG']])),
      o.fmt === 'pdf' && el('div', { class: 'set-group' },
        row('Khổ giấy', null, seg('size', [['a4', 'A4'], ['fit', 'Theo ảnh']])),
        row('PDF tìm kiếm được', hasWords ? 'Kèm lớp chữ ẩn: tìm, bôi đen, sao chép chữ trong PDF' : 'Sẽ nhận dạng chữ trước khi xuất (lần đầu mất vài giây/trang)', sw('textLayer')),
        row('Nén nhỏ dung lượng', 'Hợp gửi Zalo, email; ảnh kém nét hơn một chút', sw('compress')),
        el('div', { class: 'set-row' }, el('div', { class: 'field', style: 'flex:1' }, el('label', { for: 'exp-pw' }, 'Mật khẩu mở file (tùy chọn)'), pw))),
      o.fmt === 'word' && el('div', { class: 'set-group' },
        row('Kèm ảnh các trang', 'Ảnh trang gốc đặt trước phần chữ', sw('images')),
        el('div', { class: 'set-row' }, el('div', { class: 't' }, el('span', {}, hasText ? 'Chữ lấy từ kết quả nhận dạng. Font Times New Roman 13, lề trái 3 cm.' : 'Tài liệu chưa nhận dạng chữ — app sẽ nhận dạng trước khi tạo file Word.')))),
      o.fmt === 'jpg' && el('p', { class: 'muted', style: 'margin:0' }, `Xuất ${doc.pageIds.length} ảnh JPG, mỗi trang một ảnh.`),
    ].filter(Boolean));
    pw.value = o.password;
  }
  draw();
  const go = await sheet({ title: 'Xuất tài liệu', sub: `${doc.name} · ${doc.pageIds.length} trang`, body: box, actions: [{ label: 'Hủy', value: null }, { label: 'Tạo file', kind: 'primary', value: true }] });
  if (!go) return;
  try {
    if ((o.fmt === 'pdf' && o.textLayer && !hasWords) || (o.fmt === 'word' && !hasText)) {
      await runOcr(doc, true);
      doc = await DB.get('docs', doc.id);
    }
    const base = safeName(doc.name);
    let files;
    Busy.show('Đang tạo file…');
    const progress = (m, f) => Busy.update(m, f);
    if (o.fmt === 'pdf') files = [new File([await Exporter.pdf(doc, { ...o, progress })], base + '.pdf', { type: 'application/pdf' })];
    else if (o.fmt === 'word') files = [new File([await Exporter.word(doc, { images: o.images, progress })], base + '.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })];
    else {
      files = [];
      for (let k = 0; k < doc.pageIds.length; k++) {
        const p = await DB.get('pages', doc.pageIds[k]);
        files.push(new File([p.image], `${base}_trang-${k + 1}.jpg`, { type: 'image/jpeg' }));
      }
    }
    Busy.hide();
    await deliver(files, doc.name);
  } catch (e) { Busy.hide(); console.error(e); toast('Không tạo được file: ' + (e.message || e), 4000); }
}

/* =========================================================== nhận dạng chữ (OCR) */
let ocrWorker = null, ocrWorkerLang = '';
async function getOcrWorker(lang) {
  if (ocrWorker && ocrWorkerLang === lang) return ocrWorker;
  if (ocrWorker) { await ocrWorker.terminate(); ocrWorker = null; }
  await loadScript('vendor/tesseract/tesseract.min.js');
  ocrWorker = await Tesseract.createWorker(lang.split('+'), 1, {
    workerPath: abs('vendor/tesseract/worker.min.js'),
    corePath: abs('vendor/tesseract/core'),
    langPath: abs('vendor/tesseract/lang'),
    logger: m => {
      if (m.status === 'loading language traineddata' || m.status === 'loading tesseract core') Busy.update('Đang nạp bộ nhận dạng tiếng Việt…', m.progress);
      else if (m.status === 'recognizing text' && OcrProgress.set) OcrProgress.set(m.progress);
    },
  });
  ocrWorkerLang = lang;
  return ocrWorker;
}
const OcrProgress = { set: null };
async function runOcr(doc) {
  Busy.show('Đang chuẩn bị nhận dạng chữ…');
  try {
    const w = await getOcrWorker(State.settings.ocrLang);
    doc.ocr = doc.ocr || {};
    const n = doc.pageIds.length;
    for (let k = 0; k < n; k++) {
      const p = await DB.get('pages', doc.pageIds[k]);
      Busy.update(`Đang nhận dạng chữ trang ${k + 1}/${n}…`, k / n);
      OcrProgress.set = f => Busy.update(null, (k + f) / n);
      const { data } = await w.recognize(p.image, {}, { text: true, blocks: true });
      doc.ocr[p.id] = (data.text || '').replace(/[ \t]+\n/g, '\n').trim();
      // vị trí từng từ (tỉ lệ 0..1) để tạo PDF tìm kiếm được
      const words = [];
      const push = wd => { const b = wd.bbox; const t = (wd.text || '').trim(); if (t && b) words.push([t, b.x0 / p.w, b.y0 / p.h, b.x1 / p.w, b.y1 / p.h]); };
      if (data.blocks) data.blocks.forEach(bl => (bl.paragraphs || []).forEach(pa => (pa.lines || []).forEach(ln => (ln.words || []).forEach(push))));
      else (data.words || []).forEach(push);
      p.words = words; await DB.put('pages', p);
    }
    OcrProgress.set = null;
    doc.ocrAt = Date.now(); await DB.put('docs', doc); await loadAll();
    Busy.hide();
    const chars = Object.values(doc.ocr).join('').length;
    toast(chars ? `Đã nhận dạng ${chars.toLocaleString('vi-VN')} ký tự` : 'Không tìm thấy chữ trong ảnh');
  } catch (e) {
    Busy.hide(); console.error(e);
    toast('Nhận dạng chữ lỗi: ' + (e.message || e), 4000);
  }
}

/* =========================================================== chọn nhiều, gộp, tách */
function longPress(node, fn) {
  let t = null, sx = 0, sy = 0;
  node.addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY; t = setTimeout(() => { node.__long = true; navigator.vibrate && navigator.vibrate(20); fn(); }, 520); });
  const stop = () => { clearTimeout(t); t = null; };
  node.addEventListener('pointermove', e => { if (t && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) stop(); });
  node.addEventListener('pointerup', stop); node.addEventListener('pointercancel', stop);
  node.addEventListener('contextmenu', e => e.preventDefault());
}
function toggleSel(id) {
  if (!State.sel) State.sel = new Set();
  if (State.sel.has(id)) State.sel.delete(id); else State.sel.add(id);
  renderDocs();
}
function exitSel() { State.sel = null; renderDocs(); }
function renderSelBar() {
  let bar = $('#sel-bar');
  document.body.classList.toggle('selecting', !!State.sel);
  $('#sel-btn').textContent = State.sel ? 'Hủy chọn' : 'Chọn';
  if (!State.sel) { bar && bar.remove(); return; }
  if (!bar) { bar = el('div', { class: 'selbar', id: 'sel-bar' }); document.body.append(bar); }
  const n = State.sel.size;
  bar.replaceChildren(el('div', { class: 'wrap' },
    el('div', { class: 'sel-count' }, n ? `Đã chọn ${n}` : 'Chạm để chọn tài liệu'),
    el('button', { class: 'act', disabled: n < 2, onclick: mergeDocs }, icon('merge'), 'Gộp'),
    el('button', { class: 'act', disabled: !n, onclick: moveDocs }, icon('folder'), 'Thư mục'),
    el('button', { class: 'act', disabled: !n, style: 'color:var(--danger)', onclick: deleteDocs }, icon('trash'), 'Xóa')));
}
async function mergeDocs() {
  const ids = [...State.sel], docs = ids.map(id => State.docs.find(d => d.id === id)).filter(Boolean);
  const total = docs.reduce((n, d) => n + d.pageIds.length, 0);
  let keep = false;
  const name = el('input', { type: 'text', id: 'merge-name', value: docs[0].name + ' (gộp)', 'data-noautofocus': '1' });
  const sw = el('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': 'false', onclick: () => { keep = !keep; sw.setAttribute('aria-checked', String(keep)); } });
  const ok = await sheet({
    title: `Gộp ${docs.length} tài liệu`, sub: `${total} trang, theo thứ tự đã chọn: ${docs.map(d => d.name).join(' → ')}`,
    body: [el('div', { class: 'field' }, el('label', { for: 'merge-name' }, 'Tên tài liệu mới'), name),
      el('div', { class: 'set-row', style: 'padding:0' }, el('div', { class: 't' }, el('b', {}, 'Giữ lại tài liệu gốc'), el('span', {}, 'Tắt: các tài liệu gốc được gộp hẳn vào tài liệu mới')), sw)],
    actions: [{ label: 'Hủy', value: false }, { label: 'Gộp', kind: 'primary', value: true }],
  });
  if (!ok) return;
  Busy.show('Đang gộp…');
  try {
    const now = Date.now(), newId = uid(), pageIds = [], ocr = {};
    for (const d of docs) for (const pid of d.pageIds) {
      const p = await DB.get('pages', pid);
      if (keep) { const cp = { ...p, id: uid(), docId: newId }; await DB.put('pages', cp); pageIds.push(cp.id); if (d.ocr?.[pid] != null) ocr[cp.id] = d.ocr[pid]; }
      else { p.docId = newId; await DB.put('pages', p); pageIds.push(pid); if (d.ocr?.[pid] != null) ocr[pid] = d.ocr[pid]; }
    }
    await DB.put('docs', { id: newId, name: name.value.trim() || docs[0].name, folderId: docs[0].folderId || '', assetCode: docs[0].assetCode || '', note: '', pageIds, ocr, createdAt: now, updatedAt: now });
    if (!keep) for (const d of docs) await DB.del('docs', d.id);
    await loadAll();
  } finally { Busy.hide(); }
  State.sel = null; renderDocs(); toast('Đã gộp thành 1 tài liệu');
}
async function moveDocs() {
  const v = await menuSheet('Chuyển vào thư mục', [{ icon: 'folder', label: 'Chưa phân loại', value: '__none' }].concat(State.folders.map(f => ({ icon: 'folder', label: f.name, value: f.id }))));
  if (!v) return;
  for (const id of State.sel) { const d = await DB.get('docs', id); d.folderId = v === '__none' ? '' : v; await DB.put('docs', d); }
  await loadAll(); const n = State.sel.size; State.sel = null; renderDocs(); toast(`Đã chuyển ${n} tài liệu`);
}
async function deleteDocs() {
  const docs = [...State.sel].map(id => State.docs.find(d => d.id === id)).filter(Boolean);
  if (!(await confirmBox(`Xóa ${docs.length} tài liệu?`, `${docs.reduce((n, d) => n + d.pageIds.length, 0)} trang ảnh sẽ bị xóa khỏi máy. Không khôi phục được.`))) return;
  for (const d of docs) await deleteDoc(d);
  State.sel = null; renderDocs(); toast('Đã xóa');
}
async function splitDoc(doc) {
  const picked = new Set();
  const grid = el('div', { class: 'pick-pages' });
  doc.pageIds.forEach((pid, i) => {
    const img = el('div', { class: 'pimg' });
    const b = el('button', { type: 'button', class: 'pp', 'aria-pressed': 'false', onclick: () => {
      if (picked.has(pid)) picked.delete(pid); else picked.add(pid);
      b.setAttribute('aria-pressed', String(picked.has(pid)));
    } }, img, el('span', {}, `Trang ${i + 1}`));
    grid.append(b);
    thumbUrl(pid).then(u => { if (u) img.style.backgroundImage = `url("${u}")`; });
  });
  const name = el('input', { type: 'text', id: 'split-name', value: doc.name + ' (tách)', 'data-noautofocus': '1' });
  const ok = await sheet({
    title: 'Tách trang ra tài liệu mới', sub: 'Chọn các trang cần tách. Trang được chuyển sang tài liệu mới.',
    body: [grid, el('div', { class: 'field' }, el('label', { for: 'split-name' }, 'Tên tài liệu mới'), name)],
    actions: [{ label: 'Hủy', value: false }, { label: 'Tách', kind: 'primary', value: () => {
      if (!picked.size) { toast('Hãy chọn ít nhất 1 trang'); return undefined; }
      if (picked.size === doc.pageIds.length) { toast('Không thể tách hết mọi trang'); return undefined; }
      return true;
    } }],
  });
  if (!ok) return;
  const now = Date.now(), newId = uid();
  const moved = doc.pageIds.filter(p => picked.has(p)), ocr = {};
  for (const pid of moved) { const p = await DB.get('pages', pid); p.docId = newId; await DB.put('pages', p); if (doc.ocr?.[pid] != null) { ocr[pid] = doc.ocr[pid]; delete doc.ocr[pid]; } }
  doc.pageIds = doc.pageIds.filter(p => !picked.has(p)); doc.updatedAt = now; await DB.put('docs', doc);
  await DB.put('docs', { id: newId, name: name.value.trim() || doc.name, folderId: doc.folderId || '', assetCode: doc.assetCode || '', note: '', pageIds: moved, ocr, createdAt: now, updatedAt: now });
  await loadAll(); toast(`Đã tách ${moved.length} trang sang "${name.value.trim()}"`);
}

/* =========================================================== tài sản */
function renderAssets() {
  const q = fold(State.aq.trim());
  const docCount = code => State.docs.filter(d => d.assetCode === code).length;
  const list = $('#asset-list'); list.replaceChildren();
  const rows = State.assets.filter(a => !q || fold(`${a.code} ${a.name} ${a.unit} ${a.type}`).includes(q));
  const empty = $('#asset-empty');
  if (!rows.length) {
    empty.hidden = false;
    empty.replaceChildren(...(State.assets.length
      ? [el('h3', {}, 'Không có tài sản khớp'), el('p', {}, 'Thử gõ mã hoặc tên khác.')]
      : [el('h3', {}, 'Chưa có danh sách tài sản'),
        el('p', {}, 'Sao chép các cột Mã, Tên, Phân xưởng, Loại từ Excel (QLTS-XLM) rồi dán vào đây. Sau đó mỗi tài liệu quét có thể gắn với một tài sản.'),
        el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;justify-content:center' },
          el('button', { class: 'btn primary', onclick: importAssets }, icon('download'), 'Nhập danh sách'),
          el('button', { class: 'btn', onclick: () => editAsset() }, icon('plus'), 'Thêm từng cái'))]));
    return;
  }
  empty.hidden = true;
  const frag = document.createDocumentFragment();
  for (const a of rows.slice(0, 400)) {
    const n = docCount(a.code);
    frag.append(el('li', {}, el('button', { class: 'row', type: 'button', onclick: () => openAsset(a.code) },
      el('div', { class: 'row-body' },
        el('div', { class: 'tag' }, el('span', { class: 'code' }, a.code)),
        el('div', { class: 'row-title' }, a.name || 'Chưa có tên'),
        (a.unit || a.type) && el('div', { class: 'row-meta' }, [a.unit, a.type].filter(Boolean).join(' · '))),
      el('span', { class: 'count' }, n ? `${n} tài liệu` : ''))));
  }
  list.append(frag);
  if (rows.length > 400) list.append(el('li', { class: 'muted', style: 'text-align:center;padding:12px' }, `Còn ${rows.length - 400} tài sản — gõ để tìm.`));
}
async function editAsset(a) {
  const isNew = !a; a = a || { code: '', name: '', unit: '', type: '' };
  const f = (id, label, v, ph) => el('div', { class: 'field' }, el('label', { for: id }, label), el('input', { id, type: 'text', value: v, placeholder: ph }));
  const body = [
    f('a-code', 'Mã tài sản', a.code, 'VD: TSCĐ-0152'), f('a-name', 'Tên tài sản / thiết bị', a.name, 'VD: Máy khoan khí nén YT-28'),
    f('a-unit', 'Phân xưởng / đơn vị', a.unit, 'VD: PX Đào lò 1'), f('a-type', 'Loại', a.type, 'VD: TSCĐ, CCDC, Thiết bị cơ điện'),
  ];
  if (!isNew) body[0].querySelector('input').disabled = true;
  const v = await sheet({
    title: isNew ? 'Thêm tài sản' : 'Sửa tài sản', body,
    actions: [{ label: 'Hủy', value: null }, { label: 'Lưu', kind: 'primary', value: () => {
      const g = id => document.getElementById(id).value.trim();
      const code = g('a-code').toUpperCase();
      if (!code) { toast('Hãy nhập mã tài sản'); return undefined; }
      if (isNew && assetBy(code)) { toast(`Mã ${code} đã có trong danh sách`); return undefined; }
      return { code, name: g('a-name'), unit: g('a-unit'), type: g('a-type') };
    } }],
  });
  if (!v) return null;
  await DB.put('assets', v); await loadAll(); refresh(); toast('Đã lưu tài sản');
  return v.code;
}
function parseTable(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (!lines.length) return [];
  const delim = lines[0].includes('\t') ? '\t' : (lines[0].split(';').length > lines[0].split(',').length ? ';' : ',');
  const parse = line => {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === delim) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    out.push(cur.trim()); return out;
  };
  let rows = lines.map(parse);
  let map = { code: 0, name: 1, unit: 2, type: 3 };
  const head = rows[0].map(fold);
  if (head.some(h => /\bma\b|^ma |code|ten|phan xuong|don vi/.test(h))) {
    const find = re => head.findIndex(h => re.test(h));
    const m = { code: find(/^ma|code|so hieu/), name: find(/ten|name/), unit: find(/phan xuong|don vi|bo phan|unit/), type: find(/loai|nhom|type/) };
    if (m.code >= 0) map = { code: m.code, name: m.name, unit: m.unit, type: m.type };
    rows = rows.slice(1);
  }
  return rows.map(r => ({ code: (r[map.code] || '').toUpperCase(), name: map.name >= 0 ? r[map.name] || '' : '', unit: map.unit >= 0 ? r[map.unit] || '' : '', type: map.type >= 0 ? r[map.type] || '' : '' })).filter(a => a.code);
}
async function importAssets() {
  const ta = el('textarea', { id: 'imp-text', rows: 8, placeholder: 'Mã\tTên tài sản\tPhân xưởng\tLoại\nTSCĐ-0152\tMáy khoan khí nén YT-28\tPX Đào lò 1\tTSCĐ', style: 'font-family:var(--mono);font-size:13px;white-space:pre' });
  const info = el('div', { class: 'hint' }, 'Chọn các cột trong Excel → Sao chép → dán vào ô trên. Hoặc chọn file .csv. Cột theo thứ tự: Mã, Tên, Phân xưởng, Loại (có dòng tiêu đề cũng được). Mã trùng sẽ được cập nhật.');
  const fileBtn = el('button', { class: 'btn sm', type: 'button', onclick: async () => {
    const inp = $('#file-input'); inp.accept = '.csv,.txt,.tsv,text/csv,text/plain'; inp.value = '';
    inp.onchange = async () => { const f = inp.files[0]; if (f) { ta.value = await f.text(); ta.dispatchEvent(new Event('input')); } };
    inp.click();
  } }, icon('upload'), 'Chọn file CSV');
  const preview = el('div', { class: 'hint', style: 'color:var(--ink-2);font-weight:600' });
  ta.addEventListener('input', () => { const n = parseTable(ta.value).length; preview.textContent = n ? `Nhận được ${n} tài sản` : ''; });
  const v = await sheet({
    title: 'Nhập danh sách tài sản',
    body: [el('div', { class: 'field' }, el('label', { for: 'imp-text' }, 'Dán dữ liệu'), ta, info), el('div', { style: 'display:flex;align-items:center;gap:12px;flex-wrap:wrap' }, fileBtn, preview)],
    actions: [{ label: 'Hủy', value: null }, { label: 'Nhập', kind: 'primary', value: () => { const r = parseTable(ta.value); if (!r.length) { toast('Chưa đọc được dòng nào có mã'); return undefined; } return r; } }],
  });
  if (!v) return;
  await DB.putMany('assets', v); await loadAll(); refresh(); toast(`Đã nhập ${v.length} tài sản`);
}
async function openAsset(code) {
  const scr = el('div', { class: 'screen' }); document.body.append(scr);
  Layers.push(() => { scr.remove(); refresh(); });
  const render = async () => {
    await loadAll();
    const a = assetBy(code); if (!a) { Layers.back(); return; }
    const docs = State.docs.filter(d => d.assetCode === code);
    const list = el('ul', { class: 'list' });
    scr.replaceChildren(
      el('header', { class: 'topbar' }, el('div', { class: 'wrap' },
        el('button', { class: 'icon-btn', 'aria-label': 'Quay lại', onclick: () => Layers.back() }, icon('back')),
        el('div', { class: 'h1 mono' }, a.code),
        el('button', { class: 'icon-btn', 'aria-label': 'Thêm thao tác', onclick: async () => {
          const v = await menuSheet(a.code, [{ icon: 'edit', label: 'Sửa thông tin', value: 'edit' }, { icon: 'trash', label: 'Xóa khỏi danh sách', value: 'del', danger: true }]);
          if (v === 'edit') { await editAsset(a); render(); }
          else if (v === 'del' && await confirmBox(`Xóa tài sản ${a.code}?`, docs.length ? `${docs.length} tài liệu đang gắn sẽ được bỏ gắn (tài liệu vẫn giữ nguyên).` : 'Chưa có tài liệu nào gắn với tài sản này.')) {
            for (const d of docs) { d.assetCode = ''; await DB.put('docs', d); }
            await DB.del('assets', a.code); await loadAll(); toast('Đã xóa'); Layers.back();
          }
        } }, icon('more')))),
      el('div', { class: 'wrap', style: 'display:grid;gap:16px;padding-top:4px' },
        el('div', { class: 'card' },
          el('div', { class: 'kv' }, el('span', { class: 'k' }, 'Tên'), el('span', { class: 'v' }, a.name || '—')),
          el('div', { class: 'kv' }, el('span', { class: 'k' }, 'Phân xưởng'), el('span', { class: 'v' }, a.unit || '—')),
          el('div', { class: 'kv' }, el('span', { class: 'k' }, 'Loại'), el('span', { class: 'v' }, a.type || '—'))),
        el('div', {}, el('div', { class: 'section-label' }, docs.length ? `${docs.length} tài liệu đã gắn` : 'Chưa có tài liệu nào'), list)),
      el('div', { class: 'actionbar' }, el('div', { class: 'wrap', style: 'grid-template-columns:1fr 1fr' },
        el('button', { class: 'act primary', onclick: () => startScan({ source: 'camera', assetCode: code }) }, icon('camera'), 'Quét cho tài sản này'),
        el('button', { class: 'act', onclick: () => startScan({ source: 'gallery', assetCode: code }) }, icon('image'), 'Nhập ảnh cho tài sản này'))),
    );
    for (const d of docs) {
      const th = el('div', { class: 'thumb' }, el('span', { class: 'pc' }, d.pageIds.length));
      list.append(el('li', {}, el('button', { class: 'row', onclick: () => openDoc(d.id) }, th,
        el('div', { class: 'row-body' }, el('div', { class: 'row-title' }, d.name), el('div', { class: 'row-meta' }, `${folderName(d.folderId)} · ${fmtDate(d.updatedAt)}`)))));
      if (d.pageIds[0]) thumbUrl(d.pageIds[0]).then(u => { if (u) th.style.backgroundImage = `url("${u}")`; });
    }
  };
  scr.__render = render;
  await render();
}

/* =========================================================== cài đặt */
let installEvt = null;
async function renderSettings() {
  const s = State.settings;
  const seg = (key, opts) => el('div', { class: 'seg', role: 'group' }, opts.map(([v, label]) => el('button', {
    type: 'button', 'aria-pressed': String(s[key] === v), onclick: async () => { s[key] = v; await saveSettings(); renderSettings(); },
  }, label)));
  const sw = key => el('button', { class: 'switch', role: 'switch', 'aria-checked': String(!!s[key]), 'aria-label': key, onclick: async () => { s[key] = !s[key]; await saveSettings(); renderSettings(); } });
  const row = (title, sub, ctrl) => el('div', { class: 'set-row' }, el('div', { class: 't' }, el('b', {}, title), sub && el('span', {}, sub)), ctrl);
  const btnRow = (ic, title, sub, onclick, danger) => el('button', { class: 'set-row', type: 'button', onclick, style: danger ? 'color:var(--danger)' : '' }, icon(ic), el('div', { class: 't' }, el('b', {}, title), sub && el('span', {}, sub)));
  const storage = el('div', { class: 't' }, el('b', {}, 'Dung lượng đã dùng'), el('span', {}, 'Đang tính…'));
  const body = $('#settings-body');
  body.replaceChildren(
    el('div', { class: 'section-label' }, 'Quét & xuất file'),
    el('div', { class: 'set-group' },
      row('Camera trong app', 'Khung bám mép giấy, tự chụp, chụp liên tục nhiều trang', sw('liveCam')),
      row('Tự chụp khi giữ yên', 'Chụp ngay khi khung giấy đứng yên khoảng 1 giây', sw('autoCapture')),
      row('Bộ lọc mặc định', 'Áp cho ảnh mới chụp', el('select', { id: 's-filter', style: 'min-height:38px;border-radius:8px;border:1px solid var(--line);background:var(--surface);padding:0 8px', onchange: async e => { s.filter = e.target.value; await saveSettings(); } }, FILTERS.map(([k, l]) => el('option', { value: k, selected: s.filter === k }, l)))),
      row('Chất lượng ảnh', s.quality === 'high' ? 'Cạnh dài 3600 px (≈ 300 dpi khổ A4), file lớn hơn' : 'Cạnh dài 2800 px (≈ 240 dpi khổ A4), in rõ nét', seg('quality', [['std', 'Tiêu chuẩn'], ['high', 'Cao']])),
      row('Khổ trang PDF', s.pdfSize === 'a4' ? 'Mọi trang đặt vào khổ A4' : 'Mỗi trang theo kích thước ảnh', seg('pdfSize', [['a4', 'A4'], ['fit', 'Theo ảnh']]))),
    el('div', { class: 'section-label' }, 'Nhận dạng chữ'),
    el('div', { class: 'set-group' },
      row('Ngôn ngữ', 'Chạy ngay trên máy, không gửi ảnh đi đâu', seg('ocrLang', [['vie', 'Tiếng Việt'], ['vie+eng', 'Việt + Anh']])),
      row('Tự nhận dạng khi lưu', 'Tìm được tài liệu theo nội dung ngay sau khi quét', sw('autoOcr'))),
    el('div', { class: 'section-label' }, 'Dữ liệu trên máy'),
    el('div', { class: 'set-group' },
      el('div', { class: 'set-row' }, storage),
      btnRow('sign', 'Chữ ký đã lưu', 'Xem, thêm hoặc xóa chữ ký tay', () => Annotate.pickSignature()),
      btnRow('download', 'Sao lưu toàn bộ', 'Xuất 1 file .json chứa tài liệu, ảnh, thư mục, tài sản', backupAll),
      btnRow('upload', 'Khôi phục từ file sao lưu', 'Gộp vào dữ liệu hiện có, không xóa gì', restoreAll),
      btnRow('trash', 'Xóa toàn bộ dữ liệu', 'Xóa hết tài liệu, thư mục và tài sản trên máy này', wipeAll, true)),
    el('div', { class: 'section-label' }, 'Ứng dụng'),
    el('div', { class: 'set-group' },
      installEvt && btnRow('download', 'Cài lên màn hình chính', 'Mở nhanh như app, chạy được khi mất mạng', doInstall),
      !installEvt && !isStandalone() && el('div', { class: 'set-row' }, el('div', { class: 't' }, el('b', {}, 'Cài lên màn hình chính'), el('span', {}, 'Android (Chrome): menu ⋮ → "Thêm vào màn hình chính". iPhone (Safari): nút Chia sẻ → "Thêm vào MH chính".'))),
      el('div', { class: 'set-row' }, el('div', { class: 't' }, el('b', {}, 'XLM Scan ' + APP_VERSION), el('span', {}, 'Công ty Xây lắp Mỏ – TKV · Dữ liệu chỉ lưu trên máy này'))),
    ),
    el('div', { style: 'height:24px' }),
  );
  try {
    const est = await navigator.storage?.estimate?.();
    const persisted = await navigator.storage?.persisted?.();
    if (est) {
      storage.replaceChildren(el('b', {}, `Dung lượng đã dùng: ${fmtBytes(est.usage || 0)}`),
        el('span', {}, `${State.docs.length} tài liệu · ${State.docs.reduce((n, d) => n + d.pageIds.length, 0)} trang · ${persisted ? 'Được bảo vệ khỏi bị trình duyệt tự xóa' : 'Nên sao lưu định kỳ'}`),
        el('div', { class: 'meter' }, el('i', { style: `width:${Math.min(100, Math.max(1, (est.usage / est.quota) * 100)).toFixed(1)}%` })));
    }
  } catch { /* bỏ qua */ }
}
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
async function doInstall() {
  if (!installEvt) return;
  installEvt.prompt();
  await installEvt.userChoice.catch(() => null);
  installEvt = null; $('#install-banner').hidden = true; refresh();
}

/* ---------- sao lưu / khôi phục */
const b64 = blob => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); });
const unb64 = async s => (await fetch(s)).blob();
async function backupAll() {
  Busy.show('Đang gói dữ liệu sao lưu…');
  try {
    const pages = await DB.all('pages');
    const parts = ['{"app":"xlmscan","version":1,"exportedAt":' + Date.now() +
      ',"docs":' + JSON.stringify(await DB.all('docs')) + ',"folders":' + JSON.stringify(await DB.all('folders')) +
      ',"assets":' + JSON.stringify(await DB.all('assets')) + ',"pages":['];
    for (let k = 0; k < pages.length; k++) {
      Busy.update(`Đang gói trang ${k + 1}/${pages.length}…`, k / Math.max(1, pages.length));
      const p = pages[k];
      parts.push((k ? ',' : '') + JSON.stringify({ ...p, image: await b64(p.image), thumb: await b64(p.thumb), source: p.source ? await b64(p.source) : null }));
    }
    parts.push(']}');
    const blob = new Blob(parts, { type: 'application/json' });
    Busy.hide();
    const d = new Date(); const name = `xlmscan-saoluu-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`;
    const file = new File([blob], name, { type: 'application/json' });
    if (!(await shareFiles([file], 'Sao lưu XLM Scan'))) { downloadBlob(blob, name); toast(`Đã tải ${name} (${fmtBytes(blob.size)})`); }
  } catch (e) { Busy.hide(); toast('Sao lưu lỗi: ' + e.message); }
}
async function restoreAll() {
  const inp = $('#file-input'); inp.accept = '.json,application/json'; inp.value = '';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    Busy.show('Đang đọc file sao lưu…');
    try {
      const data = JSON.parse(await f.text());
      if (data.app !== 'xlmscan') throw new Error('Đây không phải file sao lưu của XLM Scan');
      await DB.putMany('folders', data.folders || []); await DB.putMany('assets', data.assets || []);
      const pages = data.pages || [];
      for (let k = 0; k < pages.length; k++) {
        Busy.update(`Đang khôi phục trang ${k + 1}/${pages.length}…`, k / Math.max(1, pages.length));
        const p = pages[k];
        await DB.put('pages', { ...p, image: await unb64(p.image), thumb: await unb64(p.thumb), source: p.source ? await unb64(p.source) : null });
      }
      await DB.putMany('docs', data.docs || []);
      await loadAll(); Busy.hide(); refresh();
      toast(`Đã khôi phục ${(data.docs || []).length} tài liệu, ${(data.assets || []).length} tài sản`);
    } catch (e) { Busy.hide(); toast('Không khôi phục được: ' + e.message, 4000); }
  };
  inp.click();
}
async function wipeAll() {
  if (!(await confirmBox('Xóa toàn bộ dữ liệu?', `${State.docs.length} tài liệu, ${State.assets.length} tài sản và mọi thư mục trên máy này sẽ bị xóa vĩnh viễn. Hãy sao lưu trước nếu cần.`, 'Xóa hết'))) return;
  for (const s of ['docs', 'pages', 'folders', 'assets']) await DB.clear(s);
  Urls.forEach(v => URL.revokeObjectURL(v.url)); Urls.clear(); thumbCache.clear();
  await loadAll(); State.folder = 'all'; toast('Đã xóa toàn bộ dữ liệu'); refresh();
}

/* ---------- hỗ trợ */
function showSupport() {
  const pretty = SUPPORT_PHONE.replace(/(\d{4})(\d{3})(\d{3})/, '$1 $2 $3');
  sheet({
    title: 'Hỗ trợ XLM Scan', sub: 'Liên hệ khi cần hướng dẫn hoặc báo lỗi app.',
    body: [
      el('div', { class: 'support-num' }, pretty),
      el('div', { class: 'support-acts' },
        el('a', { class: 'btn primary', href: 'tel:' + SUPPORT_PHONE }, 'Gọi điện'),
        el('a', { class: 'btn', href: 'https://zalo.me/' + SUPPORT_PHONE, target: '_blank', rel: 'noopener' }, 'Nhắn Zalo')),
      el('button', { class: 'btn ghost', type: 'button', onclick: () => copyText(SUPPORT_PHONE) }, icon('copy'), 'Sao chép số'),
    ],
  });
}

/* =========================================================== khởi động */
async function seedFolders() {
  const done = await DB.get('kv', 'seeded');
  if (done) return;
  const names = ['Biên bản', 'Lý lịch thiết bị', 'Hóa đơn – chứng từ', 'Hồ sơ kỹ thuật'];
  await DB.putMany('folders', names.map((name, i) => ({ id: uid() + i, name, order: i })));
  await DB.put('kv', true, 'seeded');
}
async function boot() {
  try { await DB.open(); }
  catch (e) { document.body.prepend(el('p', { style: 'padding:16px;color:var(--danger)' }, 'Trình duyệt không cho phép lưu dữ liệu (IndexedDB). Hãy tắt chế độ ẩn danh rồi mở lại.')); return; }
  await seedFolders();
  await loadAll();
  navigator.storage?.persist?.().catch(() => {});

  document.querySelectorAll('.tab[data-go]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.go)));
  $('#scan-btn').addEventListener('click', () => startScan({ source: 'camera' }));
  $('#import-btn').addEventListener('click', () => startScan({ source: 'gallery' }));
  let qt; $('#q').addEventListener('input', e => { clearTimeout(qt); qt = setTimeout(() => { State.q = e.target.value; renderDocs(); }, 120); });
  $('#aq').addEventListener('input', e => { State.aq = e.target.value; renderAssets(); });
  $('#asset-add').addEventListener('click', () => editAsset());
  $('#asset-import').addEventListener('click', importAssets);
  $('#install-btn').addEventListener('click', doInstall);
  $('#support-btn').addEventListener('click', showSupport);
  $('#sel-btn').addEventListener('click', () => { if (State.sel) exitSel(); else { State.sel = new Set(); renderDocs(); } });
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('#install-banner').hidden = false; if (State.tab === 'settings') renderSettings(); });
  window.addEventListener('appinstalled', () => { installEvt = null; $('#install-banner').hidden = true; toast('Đã cài XLM Scan'); });

  const start = location.hash.replace('#', '');
  setTab(['assets', 'settings'].includes(start) ? start : 'docs');

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // có bản mới → tự tải lại 1 lần để dùng ngay (không cần tắt hẳn app)
    let reloading = false;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading || Scan.root || document.querySelector('.cam, .scanner, .scrim')) return;
      reloading = true; location.reload();
    });
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('Đã có bản cập nhật — đóng và mở lại app để dùng', 5000); });
      });
    }).catch(() => {});
  }
}
boot();
