'use strict';
/* XLM Scan — công cụ: mã QR/mã vạch, bảng biểu → Excel, nhập PDF, in, dịch văn bản */

/* =========================================================== mã QR & mã vạch */
const Codes = (() => {
  let detector = null;
  const FORMAT_VI = { qr_code: 'Mã QR', ean_13: 'Mã vạch EAN-13', ean_8: 'Mã vạch EAN-8', code_128: 'Mã vạch Code 128', code_39: 'Mã vạch Code 39', upc_a: 'Mã vạch UPC-A', upc_e: 'Mã vạch UPC-E', itf: 'Mã vạch ITF', data_matrix: 'Data Matrix', pdf417: 'PDF417', aztec: 'Aztec', codabar: 'Codabar' };
  /** source: canvas / video / ảnh. Trả về [{text, format}] */
  async function detect(source) {
    if ('BarcodeDetector' in window) {
      try {
        if (!detector) {
          const f = await BarcodeDetector.getSupportedFormats();
          detector = new BarcodeDetector({ formats: f.length ? f : ['qr_code'] });
        }
        const r = await detector.detect(source);
        if (r.length) return r.map(x => ({ text: x.rawValue, format: x.format }));
        if (source instanceof HTMLVideoElement) return [];
      } catch { /* dùng jsQR */ }
    }
    await loadScript('vendor/jsQR.js');
    let c = source;
    if (!(source instanceof HTMLCanvasElement)) {
      const w = source.videoWidth || source.naturalWidth || source.width, h = source.videoHeight || source.naturalHeight || source.height;
      const s = Math.min(1, 900 / Math.max(w, h));
      c = Imaging.canvas(w * s, h * s); c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
    } else c = Imaging.scaleCanvas(source, 1200);
    const d = Imaging.ctx2d(c).getImageData(0, 0, c.width, c.height);
    const q = jsQR(d.data, c.width, c.height, { inversionAttempts: 'attemptBoth' });
    return q ? [{ text: q.data, format: 'qr_code' }] : [];
  }
  function kind(t) {
    if (/^https?:\/\//i.test(t)) return ['link', 'Liên kết'];
    if (/^WIFI:/i.test(t)) return ['wifi', 'Wi-Fi'];
    if (/^(tel:)?\+?\d[\d\s.-]{7,}$/i.test(t)) return ['tel', 'Số điện thoại'];
    if (/^BEGIN:VCARD/i.test(t)) return ['vcard', 'Danh thiếp'];
    if (/^\d{12}\|/.test(t)) return ['cccd', 'Mã QR CCCD'];
    return ['text', 'Văn bản'];
  }
  async function history() { return (await DB.get('kv', 'codes')) || []; }
  async function save(item) {
    const h = await history();
    const i = { id: uid(), at: Date.now(), ...item };
    h.unshift(i); await DB.put('kv', h.slice(0, 300), 'codes');
    return i;
  }
  function pretty(item) {
    const [k] = kind(item.text);
    if (k === 'wifi') {
      const g = n => (item.text.match(new RegExp(n + ':([^;]*)')) || [])[1] || '';
      return `Tên mạng: ${g('S')}\nMật khẩu: ${g('P')}\nBảo mật: ${g('T')}`;
    }
    if (k === 'cccd') {
      const p = item.text.split('|');
      const d = s => s && s.length === 8 ? `${s.slice(0, 2)}/${s.slice(2, 4)}/${s.slice(4)}` : s;
      return `Số CCCD: ${p[0]}\nSố CMND cũ: ${p[1] || '—'}\nHọ tên: ${p[2]}\nNgày sinh: ${d(p[3])}\nGiới tính: ${p[4]}\nNơi thường trú: ${p[5]}\nNgày cấp: ${d(p[6])}`;
    }
    return item.text;
  }
  async function showResult(item) {
    const [k, label] = kind(item.text);
    const box = el('div', { class: 'code-result', 'aria-label': 'Nội dung mã' }, pretty(item));
    const acts = [{ label: 'Sao chép', value: 'copy' }];
    if (k === 'link') acts.push({ label: 'Mở liên kết', kind: 'primary', value: 'open' });
    else acts.push({ label: 'Đóng', kind: 'primary', value: null });
    const v = await sheet({ title: label, sub: `${FORMAT_VI[item.format] || item.format} · ${fmtDate(item.at || Date.now())}`, body: box, actions: acts });
    if (v === 'copy') copyText(item.text);
    else if (v === 'open') window.open(item.text, '_blank', 'noopener');
  }
  async function openHistory() {
    const list = el('div', { class: 'menu' });
    const draw = async () => {
      const h = await history();
      list.replaceChildren(...(h.length ? h.map(it => el('button', { type: 'button', onclick: () => showResult(it) },
        icon('qr'), el('span', { style: 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, it.text),
        el('span', { class: 'count' }, fmtDate(it.at, false)))) : [el('p', { class: 'muted', style: 'margin:8px 0' }, 'Chưa quét mã nào.')]));
    };
    await draw();
    const v = await sheet({ title: 'Lịch sử quét mã', body: list, actions: [{ label: 'Xóa lịch sử', value: 'clear' }, { label: 'Đóng', kind: 'primary', value: null }] });
    if (v === 'clear' && await confirmBox('Xóa lịch sử quét mã?', 'Toàn bộ mã đã quét sẽ bị xóa.')) { await DB.put('kv', [], 'codes'); toast('Đã xóa lịch sử'); }
  }
  /** Quét mã từ ảnh trong thư viện */
  async function fromImage() {
    const files = await pickFiles('gallery'); if (!files.length) return;
    const img = await Imaging.blobToCanvas(files[0], 1600);
    const r = await detect(img);
    if (!r.length) { toast('Không tìm thấy mã QR / mã vạch trong ảnh'); return; }
    showResult(await save(r[0]));
  }
  return { detect, save, showResult, openHistory, fromImage, kind };
})();

/* =========================================================== bảng biểu → Excel */
const Tables = (() => {
  /** Tìm đường kẻ ngang/dọc của bảng trong ảnh. Trả về vị trí (0..1) */
  function gridLines(c) {
    const s = Imaging.scaleCanvas(c, 1400), w = s.width, h = s.height;
    const d = Imaging.ctx2d(s).getImageData(0, 0, w, h).data;
    const dark = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < w * h; i++, j += 4) dark[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8 < 150 ? 1 : 0;
    const runs = (len, get) => { let best = 0, cur = 0, total = 0; for (let k = 0; k < len; k++) { if (get(k)) { cur++; } else { if (cur > best) best = cur; if (cur > len * 0.04) total += cur; cur = 0; } } if (cur > len * 0.04) total += cur; return total; };
    const rows = [], cols = [];
    for (let y = 0; y < h; y++) if (runs(w, x => dark[y * w + x] || (y > 0 && dark[(y - 1) * w + x])) > w * 0.35) rows.push(y);
    for (let x = 0; x < w; x++) if (runs(h, y => dark[y * w + x] || (x > 0 && dark[y * w + x - 1])) > h * 0.2) cols.push(x);
    const group = (arr, n) => { const out = []; let st = null, pv = null; for (const v of arr) { if (pv === null || v - pv > 3) { if (st !== null) out.push((st + pv) / 2 / n); st = v; } pv = v; } if (st !== null) out.push((st + pv) / 2 / n); return out; };
    return { rows: group(rows, h), cols: group(cols, w) };
  }
  /** words: [[text,x0,y0,x1,y1]] (0..1) → mảng 2 chiều chuỗi */
  function fromWords(words, lines) {
    if (!words || !words.length) return [];
    const W = words.map(([t, x0, y0, x1, y1]) => ({ t, x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, h: y1 - y0 }));
    if (lines && lines.rows.length >= 2 && lines.cols.length >= 2) {
      const R = lines.rows, C = lines.cols;
      const cells = Array.from({ length: R.length - 1 }, () => Array.from({ length: C.length - 1 }, () => []));
      const find = (arr, v) => { for (let i = 0; i < arr.length - 1; i++) if (v >= arr[i] && v < arr[i + 1]) return i; return -1; };
      for (const w of W) {
        const r = find(R, w.cy), c = find(C, w.cx);
        if (r >= 0 && c >= 0) cells[r][c].push(w);
      }
      // trong mỗi ô: gom theo dòng (dung sai nửa chiều cao chữ) rồi xếp trái → phải
      const cellText = ws => {
        const lines = [];
        for (const w of ws.slice().sort((a, b) => a.cy - b.cy)) {
          const ln = lines.find(l => Math.abs(l.cy - w.cy) < Math.max(l.h, w.h) * 0.6);
          if (ln) ln.ws.push(w); else lines.push({ cy: w.cy, h: w.h, ws: [w] });
        }
        return lines.map(l => l.ws.sort((a, b) => a.x0 - b.x0).map(w => w.t).join(' ')).join(' ');
      };
      return cells.map(row => row.map(cellText)).filter(row => row.some(Boolean));
    }
    // không có đường kẻ: gom theo dòng, tách ô theo khoảng trống lớn, căn cột theo vị trí bắt đầu
    const hs = W.map(w => w.h).sort((a, b) => a - b), mh = hs[hs.length >> 1] || 0.01;
    W.sort((a, b) => a.cy - b.cy);
    const rows = [];
    for (const w of W) {
      const r = rows.find(r => Math.abs(r.cy - w.cy) < mh * 0.6);
      if (r) { r.ws.push(w); r.cy = (r.cy * (r.ws.length - 1) + w.cy) / r.ws.length; } else rows.push({ cy: w.cy, ws: [w] });
    }
    rows.sort((a, b) => a.cy - b.cy);
    const cellsRows = rows.map(r => {
      r.ws.sort((a, b) => a.x0 - b.x0);
      const cells = []; let cur = null;
      for (const w of r.ws) {
        if (cur && w.x0 - cur.x1 < mh * 1.4) { cur.t += ' ' + w.t; cur.x1 = w.x1; }
        else { cur = { t: w.t, x0: w.x0, x1: w.x1 }; cells.push(cur); }
      }
      return cells;
    });
    const anchors = [];
    for (const cells of cellsRows) for (const c of cells) {
      const a = anchors.find(a => Math.abs(a - c.x0) < 0.035);
      if (a === undefined) anchors.push(c.x0);
    }
    anchors.sort((a, b) => a - b);
    return cellsRows.map(cells => {
      const row = Array(anchors.length).fill('');
      for (const c of cells) {
        let bi = 0, bd = 9;
        anchors.forEach((a, i) => { const dd = Math.abs(a - c.x0); if (dd < bd) { bd = dd; bi = i; } });
        row[bi] = row[bi] ? row[bi] + ' ' + c.t : c.t;
      }
      return row;
    });
  }
  async function fromPage(p) {
    const c = await Imaging.blobToCanvas(p.base || p.image, 1600);
    return fromWords(p.words, gridLines(c));
  }
  const colName = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  /** sheets: [{name, rows}] → Blob .xlsx */
  async function xlsx(sheets) {
    await loadScript('vendor/jszip.min.js');
    const z = new JSZip();
    const ws = sheets.map((sh, si) => {
      const widths = [];
      const rows = sh.rows.map((row, ri) => `<row r="${ri + 1}">` + row.map((v, ci) => {
        widths[ci] = Math.max(widths[ci] || 8, Math.min(60, String(v).length + 2));
        const ref = colName(ci) + (ri + 1);
        if (v === '' || v == null) return '';
        if (/^-?\d{1,15}$/.test(v) && !/^0\d/.test(v)) return `<c r="${ref}" s="${ri === 0 ? 1 : 0}"><v>${v}</v></c>`;
        return `<c r="${ref}" t="inlineStr" s="${ri === 0 ? 1 : 0}"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
      }).join('') + '</row>').join('');
      const cols = widths.length ? '<cols>' + widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>' : '';
      z.file(`xl/worksheets/sheet${si + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rows}</sheetData></worksheet>`);
      return sh.name;
    });
    z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${ws.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
    z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    z.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${ws.map((n, i) => `<sheet name="${esc(n).slice(0, 31)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
    z.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${ws.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${ws.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
    z.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="12"/><name val="Times New Roman"/></font><font><b/><sz val="12"/><name val="Times New Roman"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="2"><border/><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/></border></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0" borderId="1" applyBorder="1"><alignment wrapText="1" vertical="top"/></xf><xf fontId="1" borderId="1" applyFont="1" applyBorder="1"><alignment wrapText="1" vertical="center" horizontal="center"/></xf></cellXfs></styleSheet>');
    return z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  async function docToXlsx(doc, progress) {
    const sheets = [];
    for (let k = 0; k < doc.pageIds.length; k++) {
      progress && progress(`Đang dựng bảng trang ${k + 1}/${doc.pageIds.length}…`, k / doc.pageIds.length);
      const p = await DB.get('pages', doc.pageIds[k]);
      const rows = await fromPage(p);
      sheets.push({ name: `Trang ${k + 1}`, rows: rows.length ? rows : [[doc.ocr?.[p.id] || '']] });
    }
    return xlsx(sheets);
  }
  /** Xóa đường kẻ dài (khung bảng, gạch chân) để bộ đọc chữ không bị rối. Trả về canvas mới cùng kích thước */
  function stripLines(src) {
    const w = src.width, h = src.height;
    const c = Imaging.canvas(w, h), x = Imaging.ctx2d(c); x.drawImage(src, 0, 0);
    const id = x.getImageData(0, 0, w, h), d = id.data;
    const dark = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < w * h; i++, j += 4) dark[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8 < 140 ? 1 : 0;
    const kill = new Uint8Array(w * h);
    const minH = Math.max(40, w * 0.07), minV = Math.max(40, h * 0.05);
    for (let y = 0; y < h; y++) { let st = -1; for (let xx = 0; xx <= w; xx++) { const on = xx < w && dark[y * w + xx]; if (on && st < 0) st = xx; else if (!on && st >= 0) { if (xx - st >= minH) for (let k = st; k < xx; k++) kill[y * w + k] = 1; st = -1; } } }
    for (let xx = 0; xx < w; xx++) { let st = -1; for (let y = 0; y <= h; y++) { const on = y < h && dark[y * w + xx]; if (on && st < 0) st = y; else if (!on && st >= 0) { if (y - st >= minV) for (let k = st; k < y; k++) kill[k * w + xx] = 1; st = -1; } } }
    let n = 0;
    for (let i = 0, j = 0; i < w * h; i++, j += 4) if (kill[i]) { d[j] = d[j + 1] = d[j + 2] = 255; n++; }
    if (!n) return src;
    x.putImageData(id, 0, 0);
    return c;
  }
  return { fromWords, fromPage, gridLines, xlsx, docToXlsx, stripLines };
})();

/* =========================================================== nhập PDF có sẵn */
const PdfImport = (() => {
  async function lib() {
    await loadScript('vendor/pdfjs/pdf.min.js');
    pdfjsLib.GlobalWorkerOptions.workerSrc = abs('vendor/pdfjs/pdf.worker.min.js');
    return pdfjsLib;
  }
  /** Mở file PDF → tài liệu mới (mỗi trang PDF thành 1 trang ảnh; chữ có sẵn trong PDF được giữ làm nội dung tìm kiếm) */
  async function importFile(file, opts = {}) {
    const L = await lib();
    let pdf, password;
    for (;;) {
      try { pdf = await L.getDocument({ data: new Uint8Array(await file.arrayBuffer()), password }).promise; break; }
      catch (e) {
        if (e && e.name === 'PasswordException') {
          password = await promptBox(e.code === 2 ? 'Sai mật khẩu, nhập lại' : 'PDF có mật khẩu', 'Mật khẩu mở file', '', 'Mở');
          if (!password) return null;
        } else throw e;
      }
    }
    const n = pdf.numPages, now = Date.now(), docId = uid(), ids = [], ocr = {};
    const maxSide = QUALITY[State.settings.quality] || 2000;
    Busy.show(`Đang mở PDF (${n} trang)…`);
    try {
      for (let i = 1; i <= n; i++) {
        Busy.update(`Đang đọc trang ${i}/${n}…`, (i - 1) / n);
        const page = await pdf.getPage(i);
        const v1 = page.getViewport({ scale: 1 });
        const sc = Math.min(3, maxSide / Math.max(v1.width, v1.height));
        const vp = page.getViewport({ scale: sc });
        const c = Imaging.canvas(vp.width, vp.height), x = c.getContext('2d');
        x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: x, viewport: vp }).promise;
        // chữ có sẵn trong PDF → nội dung + vị trí từng cụm chữ
        const tc = await page.getTextContent();
        const words = []; let text = '', lastY = null;
        for (const it of tc.items) {
          if (!it.str) { if (it.hasEOL) text += '\n'; continue; }
          const [a, b, cc, d, e, f] = L.Util.transform(vp.transform, it.transform);
          const fh = Math.hypot(cc, d), w = it.width * sc;
          const x0 = e, y1 = f, y0 = f - fh;
          if (it.str.trim()) words.push([it.str.trim(), x0 / c.width, y0 / c.height, (x0 + w) / c.width, y1 / c.height]);
          if (lastY !== null && Math.abs(lastY - y1) > fh * 0.6 && !text.endsWith('\n')) text += '\n';
          text += it.str + (it.hasEOL ? '\n' : '');
          lastY = y1;
        }
        const image = await Imaging.toBlob(c, 'image/jpeg', 0.88);
        const thumb = await Imaging.toBlob(Imaging.scaleCanvas(c, 280), 'image/jpeg', 0.75);
        const id = uid(); ids.push(id);
        await DB.put('pages', { id, docId, kind: 'doc', image, thumb, w: c.width, h: c.height, source: image, corners: Imaging.FULL(), rot: 0, filter: 'original', adj: null, erase: [], annots: [], words: words.length ? words : null, createdAt: now });
        if (text.trim()) ocr[id] = text.trim();
        page.cleanup();
      }
      const name = opts.name || file.name.replace(/\.pdf$/i, '');
      await DB.put('docs', { id: docId, name, folderId: State.folder !== 'all' ? State.folder : '', assetCode: opts.assetCode || '', note: '', tags: [], pageIds: ids, ocr, createdAt: now, updatedAt: now });
      await loadAll();
    } finally { Busy.hide(); }
    return docId;
  }
  async function pickAndImport(opts) {
    const inp = $('#file-input'); inp.accept = 'application/pdf,.pdf'; inp.multiple = false; inp.value = '';
    return new Promise(res => {
      inp.onchange = async () => {
        const f = inp.files[0]; if (!f) return res(null);
        try { const id = await importFile(f, opts); if (id) { toast('Đã nhập PDF'); refresh(); await openDoc(id); } res(id); }
        catch (e) { Busy.hide(); toast('Không mở được PDF: ' + (e.message || e), 4000); res(null); }
      };
      inp.click();
    });
  }
  return { importFile, pickAndImport };
})();

/* =========================================================== in trực tiếp */
async function printDoc(doc, pageIds) {
  const ids = pageIds || doc.pageIds;
  const frame = el('iframe', { style: 'position:fixed;right:0;bottom:0;width:0;height:0;border:0', 'aria-hidden': 'true' });
  document.body.append(frame);
  const d = frame.contentDocument;
  d.open(); d.write('<!doctype html><html><head><title>' + doc.name.replace(/</g, '') + '</title><style>@page{size:A4;margin:0}html,body{margin:0}.p{width:210mm;height:297mm;display:flex;align-items:center;justify-content:center;page-break-after:always;overflow:hidden}.p img{max-width:100%;max-height:100%}</style></head><body></body></html>'); d.close();
  const urls = [];
  for (const id of ids) {
    const p = await DB.get('pages', id);
    const u = URL.createObjectURL(p.image); urls.push(u);
    const box = d.createElement('div'); box.className = 'p';
    const img = d.createElement('img'); img.src = u; box.append(img); d.body.append(box);
  }
  await Promise.all([...d.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
  frame.contentWindow.focus(); frame.contentWindow.print();
  setTimeout(() => { urls.forEach(u => URL.revokeObjectURL(u)); frame.remove(); }, 60000);
}

/* =========================================================== dịch văn bản */
const Translate = (() => {
  const LANGS = [['vi', 'Tiếng Việt'], ['en', 'Tiếng Anh'], ['zh', 'Tiếng Trung'], ['ja', 'Tiếng Nhật'], ['ko', 'Tiếng Hàn'], ['ru', 'Tiếng Nga'], ['fr', 'Tiếng Pháp'], ['de', 'Tiếng Đức'], ['lo', 'Tiếng Lào'], ['km', 'Tiếng Khmer']];
  function chunks(text, max = 450) {
    const out = []; let cur = '';
    for (const part of text.split(/(?<=[.!?;:\n])/)) {
      if ((cur + part).length > max && cur) { out.push(cur); cur = ''; }
      if (part.length > max) { for (let i = 0; i < part.length; i += max) out.push(part.slice(i, i + max)); } else cur += part;
    }
    if (cur.trim()) out.push(cur);
    return out;
  }
  /** Dịch: ưu tiên bộ dịch có sẵn trong Chrome (chạy trên máy), không có thì dùng dịch vụ MyMemory */
  async function run(text, from, to, progress) {
    if ('Translator' in self) {
      try {
        const av = await Translator.availability({ sourceLanguage: from, targetLanguage: to });
        if (av && av !== 'unavailable') {
          const t = await Translator.create({ sourceLanguage: from, targetLanguage: to, monitor(m) { m.addEventListener('downloadprogress', e => progress && progress('Đang tải bộ dịch…', e.loaded)); } });
          const parts = chunks(text, 2000), out = [];
          for (let i = 0; i < parts.length; i++) { progress && progress(`Đang dịch… ${i + 1}/${parts.length}`, i / parts.length); out.push(await t.translate(parts[i])); }
          return { text: out.join(''), engine: 'Chrome (trên máy)' };
        }
      } catch { /* dùng dịch vụ trực tuyến */ }
    }
    if (!navigator.onLine) throw new Error('Cần kết nối mạng để dịch');
    const parts = chunks(text), out = [];
    for (let i = 0; i < parts.length; i++) {
      progress && progress(`Đang dịch… ${i + 1}/${parts.length}`, i / parts.length);
      const p = parts[i];
      if (!p.trim()) { out.push(p); continue; }
      const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(p)}&langpair=${from}|${to}`);
      const j = await r.json();
      if (j.responseStatus && j.responseStatus !== 200) throw new Error(j.responseDetails || 'Dịch vụ dịch từ chối yêu cầu');
      const lead = p.match(/^\s*/)[0], tail = p.match(/\s*$/)[0];
      out.push(lead + (j.responseData?.translatedText || '').trim() + tail);
    }
    return { text: out.join(''), engine: 'MyMemory (trực tuyến)' };
  }
  /** Màn hình dịch */
  async function open(text, title = 'Dịch văn bản') {
    let from = 'vi', to = State.settings.trTo || 'en';
    const sel = (id, val, on) => el('select', { id, onchange: e => on(e.target.value) }, LANGS.map(([k, l]) => el('option', { value: k, selected: k === val }, l)));
    const src = el('textarea', { id: 'tr-src', class: 'tr-box', 'data-noautofocus': '1' }, text);
    const dst = el('textarea', { id: 'tr-dst', class: 'tr-box', readonly: true, placeholder: 'Bản dịch sẽ hiện ở đây' });
    const info = el('div', { class: 'hint' });
    const go = async () => {
      if (!src.value.trim()) { toast('Chưa có nội dung để dịch'); return; }
      Busy.show('Đang dịch…');
      try { const r = await run(src.value, from, to, (m, f) => Busy.update(m, f)); dst.value = r.text; info.textContent = `Dịch bằng ${r.engine}. Bản dịch máy — hãy đọc lại trước khi dùng.`; }
      catch (e) { toast('Không dịch được: ' + e.message, 4000); }
      finally { Busy.hide(); }
    };
    await sheet({
      title,
      body: [
        el('div', { class: 'tr-langs' }, sel('tr-from', from, v => { from = v; }), el('span', { 'aria-hidden': 'true' }, '→'), sel('tr-to', to, v => { to = v; State.settings.trTo = v; saveSettings(); })),
        src, el('button', { class: 'btn primary', type: 'button', onclick: go }, icon('translate'), 'Dịch'), dst, info,
        el('div', { class: 'hint' }, 'Nếu Chrome trên máy có sẵn bộ dịch, văn bản được dịch ngay trên máy. Nếu không, văn bản được gửi tới dịch vụ dịch MyMemory (miễn phí, giới hạn lượng chữ mỗi ngày).'),
      ],
      actions: [{ label: 'Sao chép bản dịch', value: () => { copyText(dst.value); return undefined; } }, { label: 'Đóng', kind: 'primary', value: true }],
    });
  }
  return { run, open, LANGS };
})();
