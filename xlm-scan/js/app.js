/* XLM Scan – giao diện chính */
'use strict';
const App = {
  tab: 'home', q: '', folder: 'all', ws: '', kind: '', tag: '', sel: null, installEvt: null,
  docs: [], folders: [],
  async load() {
    this.docs = await DB.all('docs');
    this.docs.forEach((d) => { if (!d.tags) d.tags = []; });
    this.folders = (await DB.all('folders')).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  },
  async refresh() { await this.load(); render(); },
};
const SORTS = [['updated', 'Ngày sửa (mới nhất trước)'], ['updated_asc', 'Ngày sửa (cũ nhất trước)'], ['created', 'Ngày tạo (mới nhất trước)'],
  ['created_asc', 'Ngày tạo (cũ nhất trước)'], ['name', 'Tên (A → Z)'], ['name_desc', 'Tên (Z → A)'], ['pages', 'Số trang (nhiều nhất)']];
function sortDocs(list) {
  const k = S.sort;
  const f = {
    updated: (a, b) => b.updated - a.updated, updated_asc: (a, b) => a.updated - b.updated,
    created: (a, b) => b.created - a.created, created_asc: (a, b) => a.created - b.created,
    name: (a, b) => a.name.localeCompare(b.name, 'vi', { numeric: true }), name_desc: (a, b) => b.name.localeCompare(a.name, 'vi', { numeric: true }),
    pages: (a, b) => b.pageIds.length - a.pageIds.length,
  }[k] || ((a, b) => b.updated - a.updated);
  return list.sort(f);
}
function filterDocs() {
  const q = noAccent(App.q);
  return sortDocs(App.docs.filter((d) => {
    if (App.folder !== 'all' && (App.folder === 'none' ? d.folderId : d.folderId !== App.folder)) return false;
    if (App.ws && d.workshop !== App.ws) return false;
    if (App.kind && d.kind !== App.kind) return false;
    if (App.tag && !(d.tags || []).includes(App.tag)) return false;
    if (q) {
      const hay = noAccent([d.name, d.asset, d.workshop, d.kind, d.note, d.text, (d.tags || []).join(' ')].join(' '));
      return q.split(/\s+/).every((w) => hay.includes(w));
    }
    return true;
  }));
}
const folderName = (id) => (App.folders.find((f) => f.id === id) || {}).name || '';
const allTags = () => [...new Set(App.docs.flatMap((d) => d.tags || []))].sort((a, b) => a.localeCompare(b, 'vi'));

/* ---------- khung ---------- */
function render() {
  const app = $('#app');
  app.innerHTML = '';
  const fn = { home: viewHome, docs: viewDocs, tools: viewTools, me: viewSettings }[App.tab];
  app.append(fn());
  document.querySelectorAll('nav.tabs [data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === App.tab));
  $('.selbar') && $('.selbar').remove();
  if (App.sel && App.tab === 'docs') document.body.append(selBar());
}
function setTab(t) { App.tab = t; App.sel = null; render(); window.scrollTo(0, 0); }

function topSearch(autofocus) {
  const inp = h('input', { type: 'search', placeholder: 'Tìm tên, mã TS, thẻ, nội dung chữ…', value: App.q, enterkeyhint: 'search' });
  inp.addEventListener('input', () => {
    App.q = inp.value;
    if (App.tab === 'docs') { const l = $('#doclist'); if (l) l.replaceWith(docList(filterDocs())); }
  });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && App.tab !== 'docs') { setTab('docs'); setTimeout(() => $('.search input') && $('.search input').focus(), 50); } });
  if (autofocus) setTimeout(() => inp.focus(), 50);
  return h('label', { class: 'search' }, ic('search', 18), inp);
}
function brand() {
  return h('div', { class: 'brand' }, h('img', { src: 'icons/icon-192.png', alt: '' }), h('div', null, 'XLM Scan', h('small', null, 'Xây lắp Mỏ – TKV')));
}

/* ---------- Trang chủ ---------- */
function viewHome() {
  const recent = sortDocs([...App.docs]).slice(0, 8);
  return h('div', null,
    h('div', { class: 'topbar' }, brand()),
    h('div', { class: 'section' }, topSearch()),
    h('div', { class: 'section' },
      h('div', { class: 'hero' },
        h('button', { class: 'main', onclick: () => openCamera({}) }, ic('camera'), 'Quét tài liệu'),
        h('button', { onclick: () => openCamera({ mode: 'id', title: 'Quét CCCD 2 mặt' }) }, ic('id'), 'CCCD 2 mặt'),
        h('button', { onclick: () => importImages({}) }, ic('image'), 'Nhập ảnh'),
        h('button', { onclick: () => importPdf({}) }, ic('pdfFile'), 'Nhập PDF')),
      App.installEvt ? h('div', { class: 'install' }, ic('install'), h('div', null, h('b', null, 'Cài XLM Scan lên máy'), h('div', null, 'Mở nhanh từ màn hình chính, dùng offline')),
        h('button', { onclick: doInstall }, 'Cài đặt')) : null,
      isIOS() && !isStandalone() ? h('div', { class: 'install' }, ic('install'), h('div', null, h('b', null, 'Cài lên iPhone: '), 'bấm nút Chia sẻ ⬆ rồi chọn “Thêm vào MH chính”')) : null),
    h('div', { class: 'section' }, h('div', { class: 'tools' }, toolItems().slice(0, 8))),
    h('div', { class: 'section' },
      h('h3', null, 'Gần đây', App.docs.length ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); setTab('docs'); } }, `Xem tất cả (${App.docs.length})`) : null),
      recent.length ? h('div', { class: 'list' }, recent.map(docRow)) :
        h('div', { class: 'empty' }, ic('docs'), h('p', null, 'Chưa có tài liệu nào.', h('br'), 'Bấm nút camera để quét trang đầu tiên.'))));
}
const TOOL = (icon, color, label, fn) => h('button', { class: 'tool', onclick: fn }, h('div', { class: 'ic', style: { background: color } }, ic(icon)), label);
function toolItems() {
  return [
    TOOL('receipt', '#f2994a', 'Biên bản / Hóa đơn', () => quickKind()),
    TOOL('text', '#9b51e0', 'Nhận dạng chữ', () => ocrQuick()),
    TOOL('sign', '#2f80ed', 'Ký tên & đóng dấu', () => signQuick()),
    TOOL('qr', '#eb5757', 'Tra theo mã TS', () => findByAsset()),
    TOOL('merge', '#00a3bf', 'Gộp tài liệu', () => { setTab('docs'); App.sel = new Set(); render(); toast('Chọn các tài liệu cần gộp'); }),
    TOOL('image', '#27ae60', 'Ảnh → PDF', () => importImages({ mode: 'photo', filter: 'orig' })),
    TOOL('lock', '#56606b', 'PDF mật khẩu', () => chooseDoc('Chọn tài liệu cần đặt mật khẩu').then((d) => d && exportDialog(d))),
    TOOL('backup', '#828282', 'Sao lưu', () => backupAll()),
  ];
}
async function chooseDoc(title) {
  if (!App.docs.length) { toast('Chưa có tài liệu nào'); return null; }
  const list = sortDocs([...App.docs]).slice(0, 25);
  const id = await sheet(title, list.map((d) => ({ label: `${d.name} · ${d.pageIds.length} tr`, value: d.id, icon: 'docs' })));
  return id ? DB.get('docs', id) : null;
}
async function signQuick() {
  const d = await chooseDoc('Chọn tài liệu cần ký / đóng dấu');
  if (!d) return;
  const pages = await docPages(d);
  let i = pages.length - 1;
  if (pages.length > 1) {
    const v = await sheet('Ký trên trang nào?', pages.map((p, k) => ({ label: `Trang ${k + 1}`, value: String(k), icon: 'file' })));
    if (v == null) return; i = +v;
  }
  openEditor(d, pages[i], () => App.refresh());
}
async function quickKind() {
  const k = await sheet('Loại tài liệu cần quét', S.kinds.filter((x) => !x.startsWith('CCCD')).map((x) => ({ label: x, icon: 'docs' })));
  if (!k) return;
  const filter = /hóa đơn|phiếu|công văn|hợp đồng/i.test(k) ? 'bw' : S.defFilter;
  openCamera({ kind: k, filter, title: 'Quét: ' + k });
}
async function ocrQuick() {
  const v = await sheet('Nhận dạng chữ từ…', [{ label: 'Chụp ảnh mới', value: 'cam', icon: 'camera' }, { label: 'Chọn ảnh có sẵn', value: 'img', icon: 'image' }, { label: 'Tệp PDF (bản scan)', value: 'pdf', icon: 'pdfFile' }, { label: 'Tài liệu đã quét', value: 'doc', icon: 'docs' }]);
  const done = { onDone: (d) => openOcr(d, true) };
  if (v === 'cam') openCamera(done);
  else if (v === 'img') importImages(done);
  else if (v === 'pdf') importPdf(done);
  else if (v === 'doc') { const d = await chooseDoc('Chọn tài liệu'); if (d) openOcr(d, true); }
}
async function findByAsset() {
  const code = await formSheet('Tra tài liệu theo mã tài sản / thiết bị', [
    { name: 'v', label: 'Mã tài sản', placeholder: 'VD: TB-0123', autofocus: true, extra: (inp) => h('button', { type: 'button', onclick: async () => { const c = await scanCode(); if (c) inp.value = c; } }, ic('qr')) },
  ], 'Tìm');
  if (!code || !code.v) return;
  App.q = code.v; setTab('docs');
}

/* ---------- Tài liệu ---------- */
function docClick(d) {
  if (App.sel && App.tab === 'docs') { App.sel.has(d.id) ? App.sel.delete(d.id) : App.sel.add(d.id); render(); } else openDoc(d.id);
}
function docRow(d) {
  const n = d.pageIds.length;
  const sel = App.sel && App.tab === 'docs';
  const on = sel && App.sel.has(d.id);
  return h('div', { class: 'doc' + (on ? ' sel' : ''), onclick: () => docClick(d) },
    sel ? h('div', { class: 'ck' }, on ? ic('check', 14) : null) : null,
    h('div', { class: 'th', style: { backgroundImage: d.cover ? `url(${blobUrl(d.cover)})` : '' } }, h('span', { class: 'n' }, n)),
    h('div', { class: 'meta' },
      h('div', { class: 'name' }, d.name),
      h('div', { class: 'sub' }, fmtDate(d.updated), ' · ', n, ' trang', d.folderId ? ' · 📁 ' + folderName(d.folderId) : ''),
      h('div', { class: 'chips' },
        d.asset ? h('span', { class: 'chip o' }, 'TS: ' + d.asset) : null,
        d.workshop ? h('span', { class: 'chip' }, d.workshop) : null,
        d.kind ? h('span', { class: 'chip g' }, d.kind) : null,
        (d.tags || []).map((t) => h('span', { class: 'chip g' }, '#' + t)),
        d.text ? h('span', { class: 'chip g' }, 'Có chữ') : null)),
    sel ? null : h('button', { class: 'more', onclick: (e) => { e.stopPropagation(); docMenu(d); } }, ic('more')));
}
function docCard(d) {
  const on = App.sel && App.sel.has(d.id);
  return h('button', { class: 'gdoc' + (on ? ' sel' : ''), onclick: () => docClick(d) },
    h('div', { class: 'im', style: { backgroundImage: d.cover ? `url(${blobUrl(d.cover)})` : '' } }),
    h('div', { class: 'name' }, d.name),
    h('div', { class: 'sub' }, fmtDate(d.updated, false), ' · ', d.pageIds.length, ' tr', d.asset ? ' · TS ' + d.asset : ''));
}
function docList(list) {
  const grid = S.view === 'grid';
  return h('div', { class: 'section', id: 'doclist' },
    list.length ? h('div', { class: grid ? 'grid2' : 'list' }, list.map(grid ? docCard : docRow)) :
      h('div', { class: 'empty' }, ic('search'), h('p', null, App.q ? 'Không tìm thấy tài liệu phù hợp' : 'Thư mục trống')));
}
function viewDocs() {
  const list = filterDocs();
  const fchip = (id, label, icon) => h('button', { class: 'fchip' + (App.folder === id ? ' on' : ''), onclick: () => { if (App.folder === id && id !== 'all' && id !== 'none') folderMenu(id); else { App.folder = id; render(); } } }, icon ? ic(icon, 16) : null, label);
  const usedWs = [...new Set([...S.workshops, ...App.docs.map((d) => d.workshop).filter(Boolean)])];
  const tags = allTags();
  return h('div', null,
    h('div', { class: 'topbar' }, App.sel ? h('button', { class: 'ib', onclick: () => { App.sel = null; render(); } }, ic('close')) : null,
      App.sel ? h('div', { style: { fontWeight: 600, flex: 1 } }, `Đã chọn ${App.sel.size}`) : topSearch(),
      App.sel ? h('button', { class: 'link', onclick: () => { list.forEach((d) => App.sel.add(d.id)); render(); } }, 'Chọn hết') :
        h('button', { class: 'ib', onclick: () => { App.sel = new Set(); render(); }, title: 'Chọn nhiều' }, ic('select'))),
    h('div', { class: 'folders' },
      fchip('all', `Tất cả (${App.docs.length})`),
      App.folders.map((f) => fchip(f.id, `${f.name} (${App.docs.filter((d) => d.folderId === f.id).length})`, 'folder')),
      fchip('none', 'Chưa phân loại'),
      h('button', { class: 'fchip', onclick: newFolder }, ic('folderPlus', 16), 'Thư mục')),
    h('div', { class: 'filterrow' },
      h('select', { onchange: (e) => { App.ws = e.target.value; render(); } }, h('option', { value: '' }, 'Mọi phân xưởng'), usedWs.map((w) => h('option', { value: w, selected: App.ws === w }, w))),
      h('select', { onchange: (e) => { App.kind = e.target.value; render(); } }, h('option', { value: '' }, 'Mọi loại'), S.kinds.map((w) => h('option', { value: w, selected: App.kind === w }, w))),
      tags.length ? h('select', { onchange: (e) => { App.tag = e.target.value; render(); } }, h('option', { value: '' }, 'Mọi thẻ'), tags.map((w) => h('option', { value: w, selected: App.tag === w }, '#' + w))) : null),
    h('div', { class: 'filterrow' },
      h('span', { style: { flex: 1, fontSize: '13px', color: 'var(--muted)' } }, `${list.length} tài liệu`),
      h('button', { onclick: sortMenu }, ic('sort', 16), ' ', (SORTS.find((s) => s[0] === S.sort) || SORTS[0])[1].split(' (')[0]),
      h('button', { onclick: () => { S.view = S.view === 'grid' ? 'list' : 'grid'; saveSettings(); render(); }, title: 'Đổi kiểu xem' }, ic(S.view === 'grid' ? 'list' : 'grid', 16))),
    docList(list));
}
async function sortMenu() {
  const v = await sheet('Sắp xếp theo', SORTS.map(([value, label]) => ({ value, label: (S.sort === value ? '✓ ' : '') + label })));
  if (v) { S.sort = v; saveSettings(); render(); }
}
async function newFolder() {
  const n = await promptText('Tên thư mục mới', '', 'VD: Hồ sơ máy khoan, Biên bản 2026…');
  if (!n) return;
  const f = { id: uid(), name: n, created: Date.now() };
  await DB.put('folders', f);
  App.folder = f.id;
  await App.refresh();
}
async function folderMenu(id) {
  const f = App.folders.find((x) => x.id === id);
  const v = await sheet('Thư mục: ' + f.name, [{ label: 'Đổi tên', value: 'ren', icon: 'edit' }, { label: 'Xoá thư mục (giữ tài liệu)', value: 'del', icon: 'trash', danger: true }]);
  if (v === 'ren') { const n = await promptText('Đổi tên thư mục', f.name); if (n) { f.name = n; await DB.put('folders', f); App.refresh(); } }
  if (v === 'del') {
    for (const d of App.docs.filter((d) => d.folderId === id)) { d.folderId = null; await DB.put('docs', d); }
    await DB.del('folders', id); App.folder = 'all'; App.refresh();
  }
}
function selBar() {
  const docs = () => App.docs.filter((d) => App.sel.has(d.id));
  const need = (n) => { if (App.sel.size < n) { toast(n > 1 ? 'Chọn ít nhất 2 tài liệu' : 'Chưa chọn tài liệu'); return false; } return true; };
  return h('div', { class: 'selbar' },
    h('button', { class: 'act', onclick: async () => {
      if (!need(2)) return;
      const ds = sortDocs(docs()).reverse();
      if (!(await confirmBox(`Gộp ${ds.length} tài liệu thành 1 (vào “${ds[0].name}”)?`, 'Gộp'))) return;
      const d = await mergeDocs(ds); await refreshCover(d);
      App.sel = null; await App.refresh(); toast('Đã gộp'); openDoc(d.id);
    } }, ic('merge'), 'Gộp'),
    h('button', { class: 'act', onclick: async () => { if (!need(1)) return; await moveDocs(docs()); } }, ic('folder'), 'Chuyển'),
    h('button', { class: 'act', onclick: async () => { if (!need(1)) return; await tagDocs(docs()); } }, ic('tag'), 'Gắn thẻ'),
    h('button', { class: 'act', onclick: async () => { if (!need(1)) return; for (const d of docs()) await exportPdf(d, false); } }, ic('download'), 'Tải PDF'),
    h('button', { class: 'act', style: { color: 'var(--danger)' }, onclick: async () => {
      if (!need(1)) return;
      if (!(await confirmBox(`Xoá vĩnh viễn ${App.sel.size} tài liệu?`, 'Xoá', true))) return;
      for (const d of docs()) await deleteDoc(d);
      App.sel = null; App.refresh(); toast('Đã xoá');
    } }, ic('trash'), 'Xoá'));
}
const parseTags = (s) => [...new Set(String(s || '').split(/[,;#]/).map((t) => t.trim()).filter(Boolean))];
async function tagDocs(docs) {
  const r = await formSheet('Gắn thẻ cho ' + docs.length + ' tài liệu', [{ name: 't', label: 'Thẻ (cách nhau bằng dấu phẩy)', value: '', list: allTags(), placeholder: 'VD: kiểm kê 2026, máy khoan' }], 'Gắn');
  if (!r || !r.t) return;
  for (const d of docs) { d.tags = [...new Set([...(d.tags || []), ...parseTags(r.t)])]; await DB.put('docs', d); }
  App.sel = null; await App.refresh(); toast('Đã gắn thẻ');
}
async function moveDocs(docs) {
  const v = await sheet('Chuyển đến thư mục', [{ label: '(Chưa phân loại)', value: '__none', icon: 'docs' }, ...App.folders.map((f) => ({ label: f.name, value: f.id, icon: 'folder' })), { label: 'Thư mục mới…', value: '__new', icon: 'folderPlus' }]);
  if (!v) return;
  let fid = v === '__none' ? null : v;
  if (v === '__new') {
    const n = await promptText('Tên thư mục mới'); if (!n) return;
    const f = { id: uid(), name: n, created: Date.now() }; await DB.put('folders', f); fid = f.id;
  }
  for (const d of docs) { d.folderId = fid; await DB.put('docs', d); }
  App.sel = null; await App.refresh(); toast('Đã chuyển');
}
async function docMenu(d) {
  const v = await sheet(d.name, [
    { label: 'Chia sẻ PDF', value: 'share', icon: 'share' },
    { label: 'Xuất PDF (mật khẩu, lớp chữ, hình mờ…)', value: 'pdf', icon: 'pdf' },
    { label: 'In', value: 'print', icon: 'print' },
    { label: 'Sửa thông tin / gắn tài sản / thẻ', value: 'info', icon: 'tag' },
    { label: 'Chuyển thư mục', value: 'move', icon: 'folder' },
    { label: 'Xoá', value: 'del', icon: 'trash', danger: true },
  ]);
  if (v === 'share') exportPdf(d, true);
  if (v === 'pdf') exportDialog(d);
  if (v === 'print') printDoc(d);
  if (v === 'info') { if (await editInfo(d)) App.refresh(); }
  if (v === 'move') moveDocs([d]);
  if (v === 'del' && (await confirmBox(`Xoá “${d.name}”?`, 'Xoá', true))) { await deleteDoc(d); App.refresh(); toast('Đã xoá'); }
}
async function editInfo(d) {
  const r = await formSheet('Thông tin tài liệu', [
    { name: 'name', label: 'Tên tài liệu', value: d.name },
    { name: 'asset', label: 'Mã tài sản / thiết bị', value: d.asset, placeholder: 'Nhập hoặc quét mã QR',
      extra: (inp) => h('button', { type: 'button', onclick: async () => { const c = await scanCode(); if (c) inp.value = c; } }, ic('qr')) },
    { name: 'workshop', label: 'Phân xưởng / đơn vị', value: d.workshop, list: S.workshops },
    { name: 'kind', label: 'Loại tài liệu', type: 'select', value: d.kind, options: [{ value: '', label: '— Chọn —' }, ...S.kinds] },
    { name: 'tags', label: 'Thẻ (cách nhau bằng dấu phẩy)', value: (d.tags || []).join(', '), list: allTags() },
    { name: 'folderId', label: 'Thư mục', type: 'select', value: d.folderId || '', options: [{ value: '', label: '(Chưa phân loại)' }, ...App.folders.map((f) => ({ value: f.id, label: f.name }))] },
    { name: 'note', label: 'Ghi chú', type: 'textarea', value: d.note },
  ]);
  if (!r) return false;
  Object.assign(d, { name: r.name || d.name, asset: r.asset, workshop: r.workshop, kind: r.kind, tags: parseTags(r.tags), folderId: r.folderId || null, note: r.note, updated: Date.now() });
  await DB.put('docs', d);
  if (r.workshop && !S.workshops.includes(r.workshop)) { S.workshops.push(r.workshop); saveSettings(); }
  return true;
}

/* ---------- Chi tiết tài liệu ---------- */
async function openDoc(id) {
  let doc = await DB.get('docs', id);
  if (!doc) return;
  let manage = false, psel = new Set();
  const title = h('div', { class: 't' });
  const body = h('div', { class: 'sbody' });
  const bar = h('div', { class: 'actbar' });
  const screen = h('div', { class: 'screen' },
    h('div', { class: 'sbar' }, h('button', { class: 'ib', onclick: () => closeLayer() }, ic('back')), title,
      h('button', { class: 'ib', onclick: () => editInfo(doc).then((ok) => ok && reload()) }, ic('edit')),
      h('button', { class: 'ib', onclick: more }, ic('more'))),
    body, bar);
  pushLayer(screen, () => App.refresh());

  function paintBar() {
    bar.innerHTML = '';
    if (!manage) {
      bar.append(
        h('button', { class: 'act', onclick: addPages }, ic('plus'), 'Thêm trang'),
        h('button', { class: 'act', onclick: () => exportPdf(doc, true) }, ic('share'), 'Chia sẻ'),
        h('button', { class: 'act', onclick: () => exportDialog(doc) }, ic('pdf'), 'Xuất PDF'),
        h('button', { class: 'act', onclick: () => openOcr(doc) }, ic('text'), 'Lấy chữ'),
        h('button', { class: 'act', onclick: () => { manage = true; psel = new Set(); reload(); } }, ic('layers'), 'Quản lý trang'));
      return;
    }
    const need = () => { if (!psel.size) { toast('Chạm để chọn trang trước'); return false; } return true; };
    bar.append(
      h('button', { class: 'act', onclick: () => { psel = psel.size === doc.pageIds.length ? new Set() : new Set(doc.pageIds); reload(); } }, ic('select'), psel.size === doc.pageIds.length ? 'Bỏ chọn' : 'Chọn hết'),
      h('button', { class: 'act', onclick: async () => { if (!need()) return; await rotatePages([...psel], 90); reload(); } }, ic('rotateR'), 'Xoay'),
      h('button', { class: 'act', onclick: async () => {
        if (!need()) return; const nd = await pagesToNewDoc(doc, [...psel], false); toast(`Đã trích ${psel.size} trang sang “${nd.name}”`); psel = new Set(); reload();
      } }, ic('extract'), 'Trích xuất'),
      h('button', { class: 'act', onclick: async () => {
        if (!need()) return; if (psel.size === doc.pageIds.length) return toast('Không thể tách toàn bộ trang');
        const nd = await pagesToNewDoc(doc, [...psel], true); toast(`Đã tách ${nd.pageIds.length} trang thành “${nd.name}”`); psel = new Set(); reload();
      } }, ic('split'), 'Tách ra'),
      h('button', { class: 'act', style: { color: 'var(--danger)' }, onclick: async () => {
        if (!need()) return;
        if (psel.size === doc.pageIds.length) return toast('Muốn xoá hết hãy xoá cả tài liệu');
        if (!(await confirmBox(`Xoá ${psel.size} trang?`, 'Xoá', true))) return;
        for (const pid of psel) await DB.del('pages', pid);
        doc.pageIds = doc.pageIds.filter((x) => !psel.has(x)); await refreshCover(doc); psel = new Set(); reload();
      } }, ic('trash'), 'Xoá'),
      h('button', { class: 'act on', onclick: () => { manage = false; reload(); } }, ic('check'), 'Xong'));
  }
  async function rotatePages(ids, d) {
    const L = loading('Đang xoay…');
    for (const pid of ids) {
      const p = await DB.get('pages', pid);
      p.rot = ((p.rot || 0) + d) % 360;
      const c = await IP.render(p, maxSideFor());
      p.out = await IP.toBlob(c, 'image/jpeg', S.quality === 'high' ? 0.86 : 0.78);
      p.thumb = await IP.toBlob(IP.scaleCanvas(c, 360), 'image/jpeg', 0.72);
      p.w = c.width; p.h = c.height;
      await DB.put('pages', p);
    }
    await refreshCover(doc);
    L.close();
  }
  async function reload() {
    doc = await DB.get('docs', id);
    if (!doc) return closeLayer();
    title.textContent = manage ? `Quản lý trang (${psel.size} đã chọn)` : doc.name;
    const pages = await docPages(doc);
    body.innerHTML = '';
    if (!manage) {
      const R = (k, v) => (v ? h('div', { class: 'r' }, h('span', null, k), h('span', null, v)) : null);
      body.append(h('div', { class: 'infobox' },
        R('Mã tài sản', doc.asset), R('Phân xưởng', doc.workshop), R('Loại', doc.kind), R('Thẻ', (doc.tags || []).map((t) => '#' + t).join(' ')),
        R('Thư mục', folderName(doc.folderId)), R('Ghi chú', doc.note), R('Ngày tạo', fmtDate(doc.created)),
        !doc.asset ? h('button', { class: 'link', style: { padding: '6px 0' }, onclick: () => editInfo(doc).then((ok) => ok && reload()) }, '+ Gắn mã tài sản / phân xưởng / thẻ') : null));
      if (doc.type === 'id') body.append(h('div', { class: 'note' }, 'Chế độ CCCD: khi xuất PDF/in, 2 mặt thẻ được đặt trên cùng 1 trang A4 đúng kích thước thật (85,6 × 54 mm).'));
    } else body.append(h('div', { class: 'note' }, 'Chạm để chọn trang. Giữ và kéo một trang để đổi thứ tự.'));
    const grid = h('div', { class: 'pages' + (manage ? ' manage' : '') });
    grid.append(...pages.map((p, i) => {
      const on = psel.has(p.id);
      const el = h('div', { class: 'pg' + (on ? ' sel' : ''), 'data-id': p.id },
        h('div', { class: 'im', style: { backgroundImage: `url(${blobUrl(p.thumb)})` } }),
        manage ? h('span', { class: 'ckp' }, on ? ic('check', 12) : null) : null,
        p.text ? h('span', { class: 'tx' }, 'Aa') : null,
        h('div', { class: 'no' }, i + 1));
      if (!manage) el.addEventListener('click', () => openViewer(doc, i, reload));
      else bindDragSort(el, p.id, grid);
      return el;
    }));
    body.append(grid);
    paintBar();
  }
  /* chạm = chọn, giữ ~0,35s rồi kéo = đổi thứ tự */
  function bindDragSort(el, pid, grid) {
    el.addEventListener('pointerdown', (e) => {
      const sx = e.clientX, sy = e.clientY;
      let ghost = null, timer = null, target = null, moved = false;
      el.setPointerCapture(e.pointerId);
      timer = setTimeout(() => {
        const r = el.getBoundingClientRect();
        ghost = el.cloneNode(true); ghost.classList.add('ghost');
        Object.assign(ghost.style, { width: r.width + 'px', left: r.left + 'px', top: r.top + 'px' });
        ghost._dx = sx - r.left; ghost._dy = sy - r.top;
        document.body.append(ghost); el.classList.add('drag');
        if (navigator.vibrate) navigator.vibrate(20);
      }, 350);
      const mv = (ev) => {
        if (!ghost) { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 10) { clearTimeout(timer); moved = true; } return; }
        ghost.style.left = ev.clientX - ghost._dx + 'px'; ghost.style.top = ev.clientY - ghost._dy + 'px';
        ghost.style.display = 'none';
        const under = document.elementFromPoint(ev.clientX, ev.clientY);
        ghost.style.display = '';
        const t = under && under.closest('.pg[data-id]');
        grid.querySelectorAll('.drop').forEach((x) => x.classList.remove('drop'));
        target = t && t !== el ? t : null;
        if (target) target.classList.add('drop');
        const sb = body.getBoundingClientRect();
        if (ev.clientY < sb.top + 50) body.scrollTop -= 12; else if (ev.clientY > sb.bottom - 50) body.scrollTop += 12;
      };
      const up = async () => {
        clearTimeout(timer);
        el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
        if (ghost) {
          ghost.remove(); el.classList.remove('drag');
          if (target) {
            const from = doc.pageIds.indexOf(pid), to = doc.pageIds.indexOf(target.dataset.id);
            doc.pageIds.splice(from, 1); doc.pageIds.splice(to, 0, pid);
            await refreshCover(doc); reload();
          }
        } else if (!moved) { psel.has(pid) ? psel.delete(pid) : psel.add(pid); reload(); }
      };
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    });
  }
  async function addPages() {
    const v = await sheet('Thêm trang', [{ label: 'Chụp bằng camera', value: 'cam', icon: 'camera' }, { label: 'Chọn ảnh có sẵn', value: 'img', icon: 'image' }, { label: 'Từ tệp PDF', value: 'pdf', icon: 'pdfFile' }]);
    const opts = { docId: doc.id, mode: doc.type === 'id' ? 'id' : 'doc', onDone: () => reload() };
    if (v === 'cam') openCamera(opts); else if (v === 'img') importImages(opts); else if (v === 'pdf') importPdf(opts);
  }
  async function more() {
    const v = await sheet(doc.name, [
      { label: 'Đổi tên', value: 'ren', icon: 'edit' },
      { label: 'In', value: 'print', icon: 'print' },
      { label: 'Xuất ảnh JPG', value: 'jpg', icon: 'image' },
      { label: 'Xuất Word / Excel (từ chữ nhận dạng)', value: 'word', icon: 'word' },
      { label: 'Ký tên & đóng dấu', value: 'sign', icon: 'sign' },
      { label: 'Nhân bản tài liệu', value: 'dup', icon: 'copy' },
      { label: 'Chi tiết', value: 'info', icon: 'info' },
      { label: 'Chuyển thư mục', value: 'move', icon: 'folder' },
      { label: 'Xoá tài liệu', value: 'del', icon: 'trash', danger: true },
    ]);
    if (v === 'ren') { const n = await promptText('Tên tài liệu', doc.name); if (n) { doc.name = n; doc.updated = Date.now(); await DB.put('docs', doc); reload(); } }
    if (v === 'print') printDoc(doc);
    if (v === 'jpg') exportImages(doc);
    if (v === 'word') openOcr(doc);
    if (v === 'sign') { const pages = await docPages(doc); openEditor(doc, pages[pages.length - 1], reload); }
    if (v === 'dup') { const nd = await pagesToNewDoc(doc, doc.pageIds, false); nd.name = doc.name + ' (bản sao)'; await DB.put('docs', nd); toast('Đã nhân bản'); }
    if (v === 'info') {
      const sz = await docSize(doc);
      const pages = await docPages(doc);
      await sheet('Chi tiết tài liệu', [
        { label: 'Số trang: ' + doc.pageIds.length },
        { label: 'Dung lượng trên máy: ' + fmtSize(sz) },
        { label: 'Đã nhận dạng chữ: ' + pages.filter((p) => p.text).length + '/' + pages.length + ' trang' },
        { label: 'Ngày tạo: ' + fmtDate(doc.created) },
        { label: 'Sửa lần cuối: ' + fmtDate(doc.updated) },
      ]);
    }
    if (v === 'move') { await moveDocs([doc]); reload(); }
    if (v === 'del' && (await confirmBox(`Xoá “${doc.name}”?`, 'Xoá', true))) { await deleteDoc(doc); closeLayer(); toast('Đã xoá'); }
  }
  reload();
}

/* ---------- Xem trang ---------- */
async function openViewer(doc, start, onChange) {
  let idx = start, pages = await docPages(doc);
  const img = h('img', { alt: '', class: 'pz' });
  const view = h('div', { class: 'viewer' }, img);
  const title = h('div', { class: 't' });
  const screen = h('div', { class: 'screen dark' },
    h('div', { class: 'sbar' }, h('button', { class: 'ib', onclick: () => closeLayer() }, ic('back')), title,
      h('button', { class: 'ib', onclick: () => go(idx - 1) }, ic('back')), h('button', { class: 'ib', onclick: () => go(idx + 1) }, ic('next'))),
    view,
    h('div', { class: 'actbar' },
      h('button', { class: 'act', onclick: edit }, ic('crop'), 'Cắt & lọc'),
      h('button', { class: 'act', onclick: () => openEditor(doc, pages[idx], refresh) }, ic('pen'), 'Biên tập'),
      h('button', { class: 'act', onclick: () => rotate(90) }, ic('rotateR'), 'Xoay'),
      h('button', { class: 'act', onclick: ocrOne }, ic('text'), 'Lấy chữ'),
      h('button', { class: 'act', onclick: insertAfter }, ic('plus'), 'Chèn sau'),
      h('button', { class: 'act', style: { color: '#ff8a8d' }, onclick: del }, ic('trash'), 'Xoá')));
  pushLayer(screen, () => onChange && onChange());

  /* phóng to bằng 2 ngón / chạm đúp, vuốt ngang để chuyển trang */
  let z = { s: 1, x: 0, y: 0 }, base = null;
  function fitImg() {
    const vw = view.clientWidth, vh = view.clientHeight, iw = img.naturalWidth, ih = img.naturalHeight;
    if (!iw) return;
    const s = Math.min(vw / iw, vh / ih);
    base = { s, w: iw * s, h: ih * s };
    img.style.width = base.w + 'px'; img.style.height = base.h + 'px';
    z = { s: 1, x: (vw - base.w) / 2, y: (vh - base.h) / 2 };
    apply();
  }
  function clampZ() {
    const vw = view.clientWidth, vh = view.clientHeight, w = base.w * z.s, hh = base.h * z.s;
    z.x = w <= vw ? (vw - w) / 2 : Math.min(0, Math.max(vw - w, z.x));
    z.y = hh <= vh ? (vh - hh) / 2 : Math.min(0, Math.max(vh - hh, z.y));
  }
  function apply() { img.style.transform = `translate(${z.x}px,${z.y}px) scale(${z.s})`; }
  Object.assign(view.style, { position: 'relative', display: 'block', touchAction: 'none' });
  Object.assign(img.style, { position: 'absolute', left: '0', top: '0' });
  img.onload = fitImg;
  const pts = new Map();
  let g0 = null, swipe = null, lastTap = 0;
  view.addEventListener('pointerdown', (e) => {
    view.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      g0 = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: z.s, x: z.x, y: z.y, cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2 };
      swipe = null;
    } else {
      const now = Date.now();
      if (now - lastTap < 300) { // chạm đúp
        const r = view.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
        if (z.s > 1.05) fitImg(); else { const k = 2.5; z.x = px - (px - z.x) * k; z.y = py - (py - z.y) * k; z.s = k; clampZ(); apply(); }
        lastTap = 0; return;
      }
      lastTap = now;
      swipe = { x: e.clientX, y: e.clientY, zx: z.x, zy: z.y };
    }
  });
  view.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2 && g0) {
      const [a, b] = [...pts.values()], r = view.getBoundingClientRect();
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]), k = Math.max(1, Math.min(6, (g0.s * d) / g0.d));
      const cx = g0.cx - r.left, cy = g0.cy - r.top;
      z.x = cx - ((cx - g0.x) * k) / g0.s; z.y = cy - ((cy - g0.y) * k) / g0.s; z.s = k;
      clampZ(); apply();
    } else if (swipe && z.s > 1.05) {
      z.x = swipe.zx + e.clientX - swipe.x; z.y = swipe.zy + e.clientY - swipe.y; clampZ(); apply();
    }
  });
  const end = (e) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) g0 = null;
    if (swipe && pts.size === 0 && z.s <= 1.05) {
      const dx = e.clientX - swipe.x;
      if (Math.abs(dx) > 60 && Math.abs(e.clientY - swipe.y) < 80) go(idx + (dx < 0 ? 1 : -1));
    }
    if (pts.size === 0) swipe = null;
  };
  view.addEventListener('pointerup', end); view.addEventListener('pointercancel', end);

  function go(i) {
    if (i < 0 || i >= pages.length) return;
    idx = i; title.textContent = `Trang ${idx + 1}/${pages.length}`;
    img.src = blobUrl(pages[idx].out);
  }
  async function refresh() { doc = await DB.get('docs', doc.id); pages = await docPages(doc); go(Math.min(idx, pages.length - 1)); }
  async function rotate(d) {
    const p = pages[idx];
    const L = loading('Đang xoay…');
    p.rot = ((p.rot || 0) + d) % 360;
    const c = await IP.render(p, maxSideFor());
    p.out = await IP.toBlob(c, 'image/jpeg', S.quality === 'high' ? 0.86 : 0.78);
    p.thumb = await IP.toBlob(IP.scaleCanvas(c, 360), 'image/jpeg', 0.72);
    p.w = c.width; p.h = c.height;
    await DB.put('pages', p);
    if (idx === 0) await refreshCover(doc);
    L.close(); go(idx);
  }
  async function insertAfter() {
    const v = await sheet(`Chèn trang sau trang ${idx + 1}`, [{ label: 'Chụp bằng camera', value: 'cam', icon: 'camera' }, { label: 'Chọn ảnh có sẵn', value: 'img', icon: 'image' }]);
    const opts = { docId: doc.id, insertAt: idx + 1, mode: doc.type === 'id' ? 'id' : 'doc', onDone: refresh };
    if (v === 'cam') openCamera(opts); else if (v === 'img') importImages(opts);
  }
  async function del() {
    if (!(await confirmBox('Xoá trang này?', 'Xoá trang', true))) return;
    const p = pages[idx];
    await DB.del('pages', p.id);
    doc.pageIds = doc.pageIds.filter((x) => x !== p.id);
    pages.splice(idx, 1);
    await refreshCover(doc);
    if (!pages.length) { closeLayer(); return; }
    go(Math.min(idx, pages.length - 1));
  }
  function edit() {
    const p = pages[idx];
    const item = { pageId: p.id, orig: p.orig, quad: p.quad.map((x) => [...x]), filter: p.filter, rot: p.rot, flip: p.flip, adj: p.adj, ann: p.ann, aspect: p.aspect, text: p.text };
    cropScreen([item], { docId: doc.id, editPage: true, mode: doc.type === 'id' ? 'id' : 'doc', onDone: refresh });
  }
  async function ocrOne() {
    const t = await ocrDoc(doc, [pages[idx]]);
    if (t != null) { doc = await DB.get('docs', doc.id); openOcr(doc, false, pages[idx].text); }
  }
  go(idx);
}

/* ---------- Nhận dạng chữ ---------- */
async function openOcr(doc, autoRun, presetText) {
  doc = await DB.get('docs', doc.id);
  const ta = h('textarea', { spellcheck: false, placeholder: 'Chưa có chữ. Bấm “Nhận dạng” để trích chữ từ ảnh (hỗ trợ tiếng Việt).' });
  ta.value = presetText != null ? presetText : doc.text || '';
  const info = h('div', { style: { fontSize: '12px', color: 'var(--muted)' } }, 'Bạn có thể sửa trực tiếp nội dung rồi Lưu / Xuất Word.');
  const screen = h('div', { class: 'screen' },
    h('div', { class: 'sbar' }, h('button', { class: 'ib', onclick: () => closeLayer() }, ic('back')), h('div', { class: 't' }, 'Chữ: ' + doc.name),
      h('button', { class: 'btn p', style: { height: '36px' }, onclick: run }, ic('wand', 18), ' Nhận dạng')),
    h('div', { class: 'ocrbox' }, info, ta),
    h('div', { class: 'actbar' },
      h('button', { class: 'act', onclick: async () => { try { await navigator.clipboard.writeText(ta.value); toast('Đã sao chép'); } catch (e) { ta.select(); document.execCommand('copy'); toast('Đã sao chép'); } } }, ic('copy'), 'Sao chép'),
      h('button', { class: 'act', onclick: save }, ic('check'), 'Lưu'),
      h('button', { class: 'act', onclick: () => shareOrDownload(wordBlob(doc.name, ta.value, [doc.kind, doc.asset && 'Mã TS: ' + doc.asset, doc.workshop].filter(Boolean).join(' · ')), safeName(doc.name) + '.doc', doc.name) }, ic('word'), 'Word'),
      h('button', { class: 'act', onclick: () => shareOrDownload(csvBlob(ta.value), safeName(doc.name) + '.csv', doc.name) }, ic('excel'), 'Excel'),
      h('button', { class: 'act', onclick: () => shareOrDownload(new Blob(['﻿' + ta.value], { type: 'text/plain' }), safeName(doc.name) + '.txt', doc.name) }, ic('file'), 'TXT')));
  pushLayer(screen);
  async function run() {
    const t = await ocrDoc(doc);
    if (t != null) { ta.value = t; doc = await DB.get('docs', doc.id); toast(t ? 'Đã nhận dạng xong' : 'Không tìm thấy chữ'); }
  }
  async function save() {
    doc.text = ta.value; doc.updated = Date.now();
    await DB.put('docs', doc); toast('Đã lưu nội dung chữ');
  }
  if (autoRun && !ta.value) run();
}

/* ---------- Công cụ ---------- */
function viewTools() {
  const grp = (t, items) => [h('div', { class: 'section' }, h('h3', null, t)), h('div', { class: 'section' }, h('div', { class: 'tools' }, items))];
  return h('div', null,
    h('div', { class: 'topbar' }, h('div', { class: 'brand' }, 'Công cụ')),
    grp('Quét', [
      TOOL('camera', '#12a07c', 'Quét tài liệu', () => openCamera({})),
      TOOL('id', '#2f80ed', 'CCCD 2 mặt', () => openCamera({ mode: 'id', title: 'Quét CCCD 2 mặt' })),
      TOOL('receipt', '#f2994a', 'Biên bản / Hóa đơn', () => quickKind()),
      TOOL('image', '#6fcf97', 'Ảnh nguyên bản', () => openCamera({ mode: 'photo', title: 'Chụp ảnh' })),
    ]),
    grp('Chuyển đổi', [
      TOOL('text', '#9b51e0', 'Ảnh → Chữ (OCR)', () => ocrQuick()),
      TOOL('word', '#2b579a', 'Sang Word', () => chooseDoc('Chọn tài liệu xuất Word').then((d) => d && openOcr(d, true))),
      TOOL('excel', '#217346', 'Sang Excel', () => chooseDoc('Chọn tài liệu xuất Excel').then((d) => d && openOcr(d, true))),
      TOOL('image', '#27ae60', 'Ảnh → PDF', () => importImages({ mode: 'photo', filter: 'orig' })),
      TOOL('pdfFile', '#d0202a', 'PDF → Ảnh', () => importPdf({ onDone: (d) => exportImages(d) })),
      TOOL('search', '#00a3bf', 'PDF có lớp chữ', () => chooseDoc('Chọn tài liệu').then((d) => d && exportDialog(d))),
    ]),
    grp('Sắp xếp & biên tập', [
      TOOL('merge', '#00a3bf', 'Gộp tài liệu', () => { setTab('docs'); App.sel = new Set(); render(); toast('Chọn các tài liệu cần gộp'); }),
      TOOL('layers', '#f2994a', 'Trích / tách trang', () => chooseDoc('Chọn tài liệu').then((d) => d && openDoc(d.id))),
      TOOL('sign', '#2f80ed', 'Ký tên & đóng dấu', () => signQuick()),
      TOOL('lock', '#56606b', 'PDF mật khẩu', () => chooseDoc('Chọn tài liệu').then((d) => d && exportDialog(d))),
      TOOL('print', '#828282', 'In tài liệu', () => chooseDoc('Chọn tài liệu cần in').then((d) => d && printDoc(d))),
      TOOL('qr', '#eb5757', 'Tra theo mã TS', () => findByAsset()),
    ]),
    grp('Dữ liệu', [
      TOOL('backup', '#56606b', 'Sao lưu', backupAll),
      TOOL('restore', '#56606b', 'Khôi phục', restoreAll),
      TOOL('folderPlus', '#f2c94c', 'Thư mục mới', () => { setTab('docs'); newFolder(); }),
      TOOL('settings', '#828282', 'Cài đặt', () => setTab('me')),
    ]),
    h('div', { class: 'section' }, h('h3', null, 'Mẹo quét đẹp'),
      h('div', { class: 'card', style: { margin: 0, padding: '12px 14px', fontSize: '13px', lineHeight: 1.6 } },
        '• Đặt giấy trên nền tối, đủ sáng. Bóng tay/bóng đèn: dùng bộ lọc “Không bóng”.', h('br'),
        '• Bật “Tự chụp”: giữ yên máy ~1,5 giây là app tự chụp.', h('br'),
        '• Biên bản có chữ ký/dấu đỏ: “Nâng cao”. Hóa đơn, công văn: “Đen trắng” hoặc “Tiết kiệm mực”.', h('br'),
        '• Mẫu in sẵn bị viết bút bi xanh: “Xoá bút màu” để lấy lại mẫu trắng.', h('br'),
        '• Gắn mã tài sản + thẻ để tra cứu nhanh. Dữ liệu chỉ nằm trên máy – nên Sao lưu định kỳ.')));
}

/* ---------- Cài đặt ---------- */
function viewSettings() {
  const sel = (key, opts, after) => {
    const s = h('select', { onchange: () => { S[key] = isNaN(opts[0][0]) ? s.value : Number(s.value); saveSettings(); after && after(); } },
      opts.map(([v, l]) => h('option', { value: v, selected: String(S[key]) === String(v) }, l)));
    return s;
  };
  const usage = h('span', { class: 'v' }, '…');
  const lastB = h('span', { class: 'v' }, '');
  (async () => {
    try { const e = await navigator.storage.estimate(); usage.textContent = `${fmtSize(e.usage || 0)} / ${fmtSize(e.quota || 0)}`; } catch (e) { usage.textContent = '—'; }
    const t = await DB.get('kv', 'lastBackup'); lastB.textContent = t ? fmtDate(t) : 'Chưa sao lưu';
  })();
  const pages = App.docs.reduce((a, d) => a + d.pageIds.length, 0);
  return h('div', null,
    h('div', { class: 'topbar' }, brand()),
    h('div', { class: 'section' }, h('h3', null, 'Quét & xuất file')),
    h('div', { class: 'card' },
      h('div', { class: 'it' }, ic('filter'), 'Bộ lọc mặc định', sel('defFilter', FILTERS)),
      h('div', { class: 'it' }, ic('image'), 'Chất lượng ảnh', sel('quality', [['high', 'Cao (in ấn)'], ['med', 'Vừa'], ['low', 'Nhẹ (gửi Zalo)']])),
      h('div', { class: 'it' }, ic('pdf'), 'Khổ trang PDF', sel('pdfSize', [['a4', 'A4'], ['fit', 'Theo ảnh']])),
      h('div', { class: 'it' }, ic('crop'), 'Lề PDF (A4)', sel('pdfMargin', [[0, '0 mm'], [6, '6 mm'], [12, '12 mm']])),
      h('div', { class: 'it' }, ic('camera'), 'Tự chụp khi giữ yên', sel('autoCapture', [[1, 'Bật'], [0, 'Tắt']]))),
    h('div', { class: 'section' }, h('h3', null, 'Danh mục')),
    h('div', { class: 'card' },
      h('button', { class: 'it', onclick: () => editList('workshops', 'Danh sách phân xưởng / đơn vị') }, ic('grid'), 'Phân xưởng / đơn vị', h('span', { class: 'v' }, S.workshops.length)),
      h('button', { class: 'it', onclick: () => editList('kinds', 'Loại tài liệu') }, ic('tag'), 'Loại tài liệu', h('span', { class: 'v' }, S.kinds.length))),
    h('div', { class: 'section' }, h('h3', null, 'Dữ liệu trên máy')),
    h('div', { class: 'card' },
      h('div', { class: 'it' }, ic('storage'), 'Dung lượng', usage),
      h('div', { class: 'it' }, ic('docs'), 'Tài liệu', h('span', { class: 'v' }, `${App.docs.length} tài liệu · ${pages} trang`)),
      h('button', { class: 'it', onclick: backupAll }, ic('backup'), 'Sao lưu (xuất tệp .json)', lastB),
      h('button', { class: 'it', onclick: restoreAll }, ic('restore'), 'Khôi phục từ tệp sao lưu'),
      h('button', { class: 'it', onclick: async () => { const L = loading('Đang tải dữ liệu OCR…'); try { await getOcr(L); await DB.put('kv', true, 'ocrReady'); toast('Đã sẵn sàng OCR offline'); } catch (e) { toast('Lỗi: ' + e.message); } L.close(); } }, ic('text'), 'Tải trước dữ liệu OCR (dùng offline)'),
      h('button', { class: 'it', onclick: async () => { const ok = navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; toast(ok ? 'Đã bật lưu trữ bền vững' : 'Trình duyệt chưa cho phép – hãy cài app lên màn hình chính'); } }, ic('lock'), 'Giữ dữ liệu không bị xoá tự động')),
    h('div', { class: 'section' }, h('h3', null, 'Ứng dụng')),
    h('div', { class: 'card' },
      App.installEvt ? h('button', { class: 'it', onclick: doInstall }, ic('install'), 'Cài đặt lên màn hình chính') : null,
      h('a', { class: 'it', href: 'tel:' + SUPPORT_PHONE, style: { color: 'inherit', textDecoration: 'none' } }, ic('phone'), 'Hỗ trợ kỹ thuật', h('span', { class: 'v' }, SUPPORT_PHONE)),
      h('a', { class: 'it', href: 'https://zalo.me/' + SUPPORT_PHONE, target: '_blank', style: { color: 'inherit', textDecoration: 'none' } }, ic('share'), 'Nhắn Zalo hỗ trợ', h('span', { class: 'v' }, 'Zalo')),
      h('div', { class: 'it' }, ic('info'), 'Phiên bản', h('span', { class: 'v' }, 'XLM Scan ' + APP_VERSION))));
}
async function editList(key, title) {
  const r = await formSheet(title, [{ name: 'v', label: 'Mỗi dòng một mục', type: 'textarea', value: S[key].join('\n') }]);
  if (!r) return;
  S[key] = r.v.split('\n').map((x) => x.trim()).filter(Boolean);
  await saveSettings(); render();
}

/* ---------- cài đặt PWA ---------- */
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); App.installEvt = e; if (App.tab === 'home' || App.tab === 'me') render(); });
window.addEventListener('appinstalled', () => { App.installEvt = null; toast('Đã cài XLM Scan'); render(); });
async function doInstall() {
  if (!App.installEvt) return;
  App.installEvt.prompt();
  await App.installEvt.userChoice.catch(() => {});
  App.installEvt = null; render();
}

/* ---------- khởi động ---------- */
(async function boot() {
  document.body.append(
    h('div', { class: 'support' }, 'Hỗ trợ: ', h('a', { href: 'tel:' + SUPPORT_PHONE }, '☎ ' + SUPPORT_PHONE), '·', h('a', { class: 'z', href: 'https://zalo.me/' + SUPPORT_PHONE, target: '_blank' }, 'Zalo')),
    h('nav', { class: 'tabs' },
      h('button', { 'data-t': 'home', onclick: () => setTab('home') }, ic('home'), 'Trang chủ'),
      h('button', { 'data-t': 'docs', onclick: () => setTab('docs') }, ic('docs'), 'Tài liệu'),
      h('button', { class: 'fab', onclick: () => openCamera({}), 'aria-label': 'Quét' }, ic('camera')),
      h('button', { 'data-t': 'tools', onclick: () => setTab('tools') }, ic('grid'), 'Công cụ'),
      h('button', { 'data-t': 'me', onclick: () => setTab('me') }, ic('settings'), 'Cài đặt')));
  try {
    await DB.open();
    await loadSettings();
    S.autoCapture = S.autoCapture ? 1 : 0;
    await App.load();
  } catch (e) {
    $('#app').innerHTML = '<div class="empty"><p>Không mở được bộ nhớ trên máy (IndexedDB). Hãy tắt chế độ ẩn danh và thử lại.</p></div>';
    return;
  }
  render();
  const p = new URLSearchParams(location.search).get('a');
  if (p === 'scan') openCamera({});
  if (p === 'id') openCamera({ mode: 'id', title: 'Quét CCCD 2 mặt' });
  if (p) history.replaceState(null, '', location.pathname);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw && nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('Đã có bản cập nhật – mở lại app để dùng bản mới', 4000);
        });
      });
    }).catch(() => {});
  }
})();
