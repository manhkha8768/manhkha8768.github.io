/* XLM Scan – PDF, OCR, xuất Word/TXT, sao lưu, thao tác tài liệu */
'use strict';
function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = h('script', { src }); s.onload = res; s.onerror = () => rej(new Error('Không tải được ' + src));
    document.head.append(s);
  });
}
async function docPages(doc) {
  const all = await DB.pagesOf(doc.id), map = new Map(all.map((p) => [p.id, p]));
  return doc.pageIds.map((id) => map.get(id)).filter(Boolean);
}

/* ---------- PDF ---------- */
/* ảnh trang dùng khi xuất (có thể nén nhỏ / thêm hình mờ) */
async function exportImage(p, o = {}) {
  if (!o.compress && !o.watermark) return { blob: p.out, w: p.w, h: p.h };
  const b = await IP.load(p.out);
  let c = IP.canvas(IP.W(b), IP.H(b)); c.getContext('2d').drawImage(b, 0, 0);
  if (b.close) b.close();
  if (o.compress) c = IP.scaleCanvas(c, 1500);
  IP.watermark(c, o.watermark);
  return { blob: await IP.toBlob(c, 'image/jpeg', o.compress ? 0.62 : 0.85), w: c.width, h: c.height };
}
async function buildPdf(doc, pages, progress, o = {}) {
  if (!window.jspdf) await loadScript('lib/jspdf.umd.min.js');
  const { jsPDF } = window.jspdf;
  pages = pages || (await docPages(doc));
  if (!pages.length) throw new Error('Tài liệu chưa có trang nào');
  const size = o.size || S.pdfSize;
  let pdf = null;
  const add = (or, f) => {
    if (!pdf) {
      const cfg = { orientation: or, unit: 'mm', format: f, compress: true };
      if (o.password) cfg.encryption = { userPassword: o.password, ownerPassword: o.password + '#xlm', userPermissions: ['print', 'copy'] };
      pdf = new jsPDF(cfg);
    } else pdf.addPage(f, or);
  };
  const imgs = new Map();
  const prep = async (p) => { if (!imgs.has(p.id)) imgs.set(p.id, await exportImage(p, o)); return imgs.get(p.id); };
  const bytes = async (p) => new Uint8Array(await (await prep(p)).blob.arrayBuffer());
  if (doc.type === 'id') {
    // CCCD: 2 mặt trên 1 trang A4, đúng kích thước thật 85,6 × 54 mm
    for (let i = 0; i < pages.length; i += 2) {
      add('p', 'a4');
      const pair = pages.slice(i, i + 2);
      let y = 30;
      for (const p of pair) {
        const land = p.w >= p.h, w = land ? 85.6 : 54, hh = land ? 54 : 85.6;
        pdf.addImage(await bytes(p), 'JPEG', (210 - w) / 2, y, w, hh, undefined, 'FAST');
        y += hh + 16;
      }
      progress && progress((i + 2) / pages.length);
    }
  } else {
    const m = Number(S.pdfMargin) || 0;
    for (let i = 0; i < pages.length; i++) {
      const p0 = pages[i], im = await prep(p0), p = { ...p0, w: im.w, h: im.h }, land = p.w > p.h;
      if (size === 'fit') {
        const mmW = (p.w / 200) * 25.4, mmH = (p.h / 200) * 25.4; // 200 dpi
        add(land ? 'l' : 'p', [mmW, mmH]);
        pdf.addImage(await bytes(p), 'JPEG', 0, 0, mmW, mmH, undefined, 'FAST');
      } else {
        add(land ? 'l' : 'p', 'a4');
        const PW = land ? 297 : 210, PH = land ? 210 : 297;
        const s = Math.min((PW - 2 * m) / p.w, (PH - 2 * m) / p.h), w = p.w * s, hh = p.h * s;
        pdf.addImage(await bytes(p), 'JPEG', (PW - w) / 2, (PH - hh) / 2, w, hh, undefined, 'FAST');
      }
      progress && progress((i + 1) / pages.length);
    }
  }
  pdf.setProperties({ title: doc.name, creator: 'XLM Scan', subject: [doc.kind, doc.asset, doc.workshop].filter(Boolean).join(' | ') });
  return pdf.output('blob');
}
/* PDF có lớp chữ (tìm kiếm / bôi đen được) – dùng Tesseract + pdf-lib */
async function buildSearchablePdf(doc, L, o = {}) {
  await loadScript('lib/pdf-lib.min.js');
  const pages = await docPages(doc);
  const w = await getOcr(L);
  const out = await PDFLib.PDFDocument.create();
  out.setTitle(doc.name); out.setCreator('XLM Scan');
  const m = (Number(S.pdfMargin) || 0) * 2.8346;
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    ocrLog = (ev) => { if (ev.status === 'recognizing text') L.set(`Tạo lớp chữ trang ${i + 1}/${pages.length}…`, (i + ev.progress) / pages.length); };
    L.set(`Tạo lớp chữ trang ${i + 1}/${pages.length}…`, i / pages.length);
    const im = await exportImage(p, o);
    const r = await w.recognize(im.blob, { pdfTitle: doc.name }, { pdf: true, text: true });
    if (!p.text) { p.text = cleanText(r.data.text); await DB.put('pages', p); }
    const [ep] = await out.embedPdf(r.data.pdf);
    const land = im.w > im.h;
    let PW, PH, dw, dh;
    if ((o.size || S.pdfSize) === 'fit') { PW = (im.w / 200) * 72; PH = (im.h / 200) * 72; dw = PW; dh = PH; }
    else { PW = land ? 841.89 : 595.28; PH = land ? 595.28 : 841.89; const s = Math.min((PW - 2 * m) / im.w, (PH - 2 * m) / im.h); dw = im.w * s; dh = im.h * s; }
    const pg = out.addPage([PW, PH]);
    pg.drawPage(ep, { x: (PW - dw) / 2, y: (PH - dh) / 2, width: dw, height: dh });
  }
  ocrLog = null;
  if (!doc.text) { doc.text = pages.map((p) => p.text || '').join('\n\n'); await DB.put('docs', doc); }
  return new Blob([await out.save()], { type: 'application/pdf' });
}
/* hộp thoại xuất PDF đầy đủ tuỳ chọn */
async function exportDialog(doc) {
  const r = await formSheet('Xuất PDF', [
    { name: 'name', label: 'Tên tệp', value: doc.name },
    { name: 'size', label: 'Khổ trang', type: 'select', value: S.pdfSize, options: [{ value: 'a4', label: 'A4' }, { value: 'fit', label: 'Theo kích thước ảnh' }] },
    { name: 'compress', label: 'Nén nhỏ dung lượng (gửi Zalo/email)', type: 'checkbox', value: false },
    { name: 'ocr', label: 'Có lớp chữ – tìm kiếm & sao chép được chữ trong PDF', type: 'checkbox', value: false },
    { name: 'watermark', label: 'Hình mờ (để trống nếu không cần)', value: '', list: ['BẢN SAO', 'CHỈ DÙNG NỘI BỘ', 'XÂY LẮP MỎ – TKV'] },
    { name: 'password', label: 'Mật khẩu mở PDF (để trống nếu không cần)', type: 'password', value: '' },
    { name: 'act', label: 'Sau khi tạo', type: 'select', value: 'share', options: [{ value: 'share', label: 'Chia sẻ (Zalo, email…)' }, { value: 'save', label: 'Tải về máy' }] },
  ], 'Tạo PDF');
  if (!r) return;
  if (r.ocr && r.password) toast('PDF có mật khẩu sẽ không kèm lớp chữ', 3000);
  const o = { size: r.size, compress: r.compress, watermark: r.watermark, password: r.password };
  const L = loading('Đang tạo PDF…');
  try {
    const blob = r.ocr && !r.password && doc.type !== 'id' ? await buildSearchablePdf(doc, L, o) : await buildPdf(doc, null, (p) => L.set(null, p), o);
    L.close();
    const name = safeName(r.name || doc.name) + '.pdf';
    if (r.act === 'share') await shareOrDownload(blob, name, doc.name); else { downloadBlob(blob, name); toast('Đã tải PDF (' + fmtSize(blob.size) + ')'); }
  } catch (e) { L.close(); toast('Lỗi tạo PDF: ' + e.message, 4000); }
}
/* in trực tiếp */
async function printDoc(doc) {
  const pages = await docPages(doc);
  const L = loading('Đang chuẩn bị in…');
  const urls = [];
  for (const p of pages) urls.push(await blobToDataURL(p.out));
  L.close();
  const fr = h('iframe', { style: { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' } });
  document.body.append(fr);
  const isId = doc.type === 'id';
  const body = isId
    ? `<div class="pg id">${urls.map((u) => `<img src="${u}">`).join('')}</div>`
    : urls.map((u) => `<div class="pg"><img src="${u}"></div>`).join('');
  fr.contentDocument.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.name)}</title><style>
@page{size:A4;margin:${Number(S.pdfMargin) || 0}mm}body{margin:0}
.pg{page-break-after:always;height:calc(297mm - ${2 * (Number(S.pdfMargin) || 0)}mm - 1mm);display:flex;align-items:center;justify-content:center}
.pg img{max-width:100%;max-height:100%}
.pg.id{flex-direction:column;justify-content:flex-start;gap:16mm;padding-top:24mm}.pg.id img{width:85.6mm}
</style></head><body>${body}</body></html>`);
  fr.contentDocument.close();
  setTimeout(() => { fr.contentWindow.focus(); fr.contentWindow.print(); setTimeout(() => fr.remove(), 60000); }, 500);
}
/* chữ nhận dạng -> bảng CSV mở bằng Excel */
function csvBlob(text) {
  const rows = String(text || '').split('\n').filter((l) => l.trim()).map((l) => l.trim().split(/\t|\s{2,}|\s\|\s|\|/).map((c) => c.trim()));
  const q = (c) => (/[",;\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c);
  return new Blob(['\ufeff' + rows.map((r) => r.map(q).join(',')).join('\r\n')], { type: 'text/csv' });
}
/* tách/trích trang sang tài liệu mới */
async function pagesToNewDoc(doc, pageIds, move) {
  const now = Date.now();
  const nd = { ...doc, id: uid(), name: doc.name + (move ? ' (tách)' : ' (trích)'), created: now, updated: now, pageIds: [], text: '', cover: null, tags: [...(doc.tags || [])] };
  for (const pid of doc.pageIds.filter((id) => pageIds.includes(id))) {
    const p = await DB.get('pages', pid);
    if (!p) continue;
    const np = move ? p : { ...p, id: uid() };
    np.docId = nd.id;
    await DB.put('pages', np);
    nd.pageIds.push(np.id);
  }
  if (move) { doc.pageIds = doc.pageIds.filter((id) => !pageIds.includes(id)); await refreshCover(doc); }
  await DB.put('docs', nd);
  await refreshCover(nd);
  return nd;
}
async function docSize(doc) {
  let n = 0;
  for (const p of await DB.pagesOf(doc.id)) n += (p.out ? p.out.size : 0) + (p.orig ? p.orig.size : 0) + (p.thumb ? p.thumb.size : 0);
  return n;
}
async function exportPdf(doc, share = true) {
  const L = loading('Đang tạo PDF…');
  try {
    const blob = await buildPdf(doc, null, (p) => L.set(null, p));
    L.close();
    const name = safeName(doc.name) + '.pdf';
    if (share) await shareOrDownload(blob, name, doc.name); else { downloadBlob(blob, name); toast('Đã tải PDF (' + fmtSize(blob.size) + ')'); }
  } catch (e) { L.close(); toast('Lỗi tạo PDF: ' + e.message, 3500); }
}
async function exportImages(doc) {
  const pages = await docPages(doc);
  const files = pages.map((p, i) => new File([p.out], `${safeName(doc.name)}_${i + 1}.jpg`, { type: 'image/jpeg' }));
  if (navigator.canShare && navigator.canShare({ files })) {
    try { await navigator.share({ files, title: doc.name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  for (const f of files) { downloadBlob(f, f.name); await sleep(300); }
}

/* ---------- OCR (Tesseract, tiếng Việt) ---------- */
let ocrWorker = null, ocrLog = null;
async function getOcr(L) {
  if (ocrWorker) return ocrWorker;
  L && L.set('Đang tải bộ nhận dạng tiếng Việt (lần đầu ~10 MB)…');
  await loadScript('lib/tesseract.min.js');
  ocrWorker = await Tesseract.createWorker(['vie', 'eng'], 1, {
    workerPath: new URL('lib/worker.min.js', location.href).href,
    corePath: new URL('lib/ocr/core', location.href).href,
    langPath: new URL('lib/ocr/lang', location.href).href,
    workerBlobURL: false,
    logger: (m) => ocrLog && ocrLog(m),
  });
  return ocrWorker;
}
function cleanText(t) {
  return String(t || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
async function ocrPages(pages, L) {
  const w = await getOcr(L);
  await DB.put('kv', true, 'ocrReady');
  const out = [];
  for (let i = 0; i < pages.length; i++) {
    ocrLog = (m) => { if (m.status === 'recognizing text') L && L.set(`Nhận dạng trang ${i + 1}/${pages.length}…`, (i + m.progress) / pages.length); };
    L && L.set(`Nhận dạng trang ${i + 1}/${pages.length}…`, i / pages.length);
    const r = await w.recognize(pages[i].out);
    const text = cleanText(r.data.text);
    pages[i].text = text;
    await DB.put('pages', pages[i]);
    out.push(text);
  }
  ocrLog = null;
  return out;
}
async function ocrDoc(doc, onlyPages) {
  const L = loading('Chuẩn bị nhận dạng chữ…');
  try {
    const all = await docPages(doc);
    const pages = onlyPages || all;
    await ocrPages(pages, L);
    doc.text = all.map((p) => p.text || '').join('\n\n');
    doc.updated = Date.now();
    await DB.put('docs', doc);
    L.close();
    return doc.text;
  } catch (e) {
    L.close();
    toast('Lỗi OCR: ' + e.message, 4000);
    return null;
  }
}
function wordBlob(title, text, meta) {
  const paras = String(text || '').split(/\n/).map((l) => `<p style="margin:0 0 4pt">${esc(l) || '&nbsp;'}</p>`).join('');
  const head = meta ? `<p style="color:#666;font-size:10pt">${esc(meta)}</p>` : '';
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${esc(title)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>@page{size:21cm 29.7cm;margin:2cm 2cm 2cm 3cm}body{font-family:"Times New Roman",serif;font-size:13pt;line-height:1.4}</style></head>
<body><h2 style="font-size:14pt">${esc(title)}</h2>${head}${paras}</body></html>`;
  return new Blob(['﻿', html], { type: 'application/msword' });
}

/* ---------- thao tác tài liệu ---------- */
async function deleteDoc(doc) {
  for (const id of doc.pageIds) await DB.del('pages', id);
  const strays = await DB.pagesOf(doc.id);
  for (const p of strays) await DB.del('pages', p.id);
  await DB.del('docs', doc.id);
}
async function mergeDocs(docs) {
  const [first, ...rest] = docs;
  for (const d of rest) {
    for (const pid of d.pageIds) {
      const p = await DB.get('pages', pid);
      if (p) { p.docId = first.id; await DB.put('pages', p); first.pageIds.push(pid); }
    }
    first.text = [first.text, d.text].filter(Boolean).join('\n\n');
    await DB.del('docs', d.id);
  }
  if (first.type === 'id' && rest.some((d) => d.type !== 'id')) first.type = 'doc';
  first.updated = Date.now();
  await DB.put('docs', first);
  return first;
}
async function refreshCover(doc) {
  const p = doc.pageIds.length ? await DB.get('pages', doc.pageIds[0]) : null;
  doc.cover = p ? p.thumb : null;
  doc.updated = Date.now();
  await DB.put('docs', doc);
}

/* ---------- đọc mã QR / mã vạch tài sản ---------- */
async function scanCode() {
  if (!('BarcodeDetector' in window)) { toast('Trình duyệt này chưa hỗ trợ đọc mã QR – hãy nhập mã bằng tay', 3500); return null; }
  const [f] = await pickFiles('image/*', false, 'environment');
  if (!f) return null;
  try {
    const bmp = await IP.load(f);
    const det = new BarcodeDetector();
    const r = await det.detect(bmp);
    if (!r.length) { toast('Không tìm thấy mã QR/mã vạch trong ảnh'); return null; }
    let v = r[0].rawValue.trim();
    // nếu là đường link, lấy tham số mã/tham số cuối
    try { const u = new URL(v); v = u.searchParams.get('code') || u.searchParams.get('ma') || u.searchParams.get('id') || decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || v); } catch (e) {}
    return v;
  } catch (e) { toast('Lỗi đọc mã: ' + e.message); return null; }
}

/* ---------- sao lưu / khôi phục ---------- */
async function backupAll() {
  const L = loading('Đang tạo bản sao lưu…');
  try {
    const [docs, folders, pages] = [await DB.all('docs'), await DB.all('folders'), await DB.all('pages')];
    const parts = ['{"app":"xlm-scan","v":1,"date":', String(Date.now()), ',"settings":', JSON.stringify(S), ',"folders":', JSON.stringify(folders), ',"docs":['];
    for (let i = 0; i < docs.length; i++) {
      const d = { ...docs[i], cover: docs[i].cover ? await blobToDataURL(docs[i].cover) : null };
      parts.push((i ? ',' : '') + JSON.stringify(d));
    }
    parts.push('],"pages":[');
    for (let i = 0; i < pages.length; i++) {
      L.set(`Đang đóng gói trang ${i + 1}/${pages.length}…`, i / pages.length);
      const p = pages[i];
      const o = { ...p, orig: await blobToDataURL(p.orig), out: await blobToDataURL(p.out), thumb: await blobToDataURL(p.thumb) };
      parts.push((i ? ',' : '') + JSON.stringify(o));
    }
    parts.push(']}');
    const blob = new Blob(parts, { type: 'application/json' });
    L.close();
    await shareOrDownload(blob, `XLMScan_saoluu_${stamp()}.json`, 'Sao lưu XLM Scan');
    await DB.put('kv', Date.now(), 'lastBackup');
  } catch (e) { L.close(); toast('Lỗi sao lưu: ' + e.message, 4000); }
}
async function restoreAll() {
  const [f] = await pickFiles('.json,application/json', false);
  if (!f) return;
  const L = loading('Đang khôi phục…');
  try {
    const data = JSON.parse(await f.text());
    if (data.app !== 'xlm-scan') throw new Error('Không phải tệp sao lưu XLM Scan');
    for (const fo of data.folders || []) await DB.put('folders', fo);
    const pages = data.pages || [];
    for (let i = 0; i < pages.length; i++) {
      L.set(`Khôi phục trang ${i + 1}/${pages.length}…`, i / pages.length);
      const p = pages[i];
      p.orig = await dataURLToBlob(p.orig); p.out = await dataURLToBlob(p.out); p.thumb = await dataURLToBlob(p.thumb);
      await DB.put('pages', p);
    }
    for (const d of data.docs || []) { if (d.cover) d.cover = await dataURLToBlob(d.cover); await DB.put('docs', d); }
    L.close();
    toast(`Đã khôi phục ${(data.docs || []).length} tài liệu`);
    App.refresh();
  } catch (e) { L.close(); toast('Lỗi khôi phục: ' + e.message, 4000); }
}
