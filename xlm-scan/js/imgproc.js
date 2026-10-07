/* XLM Scan – xử lý ảnh: nhận diện mép giấy, nắn phối cảnh, bộ lọc */
'use strict';
const IP = (() => {
  async function load(blob) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch (e) {}
      try { return await createImageBitmap(blob); } catch (e) {}
    }
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(blob);
      const im = new Image();
      im.onload = () => { res(im); };
      im.onerror = rej;
      im.src = url;
    });
  }
  const W = (b) => b.width || b.naturalWidth || b.videoWidth;
  const H = (b) => b.height || b.naturalHeight || b.videoHeight;

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    return c;
  }
  function toBlob(c, type = 'image/jpeg', q = 0.88) {
    return new Promise((res) => c.toBlob(res, type, q));
  }
  /* thu nhỏ ảnh gốc để tiết kiệm bộ nhớ */
  async function normalizeOriginal(blob, maxSide = 2600) {
    const b = await load(blob);
    const w = W(b), h = H(b), s = Math.min(1, maxSide / Math.max(w, h));
    const c = canvas(w * s, h * s);
    c.getContext('2d').drawImage(b, 0, 0, c.width, c.height);
    if (b.close) b.close();
    return { blob: await toBlob(c, 'image/jpeg', 0.92), w: c.width, h: c.height };
  }
  function sample(src, maxSide) {
    const w = W(src), h = H(src), s = Math.min(1, maxSide / Math.max(w, h));
    const c = canvas(w * s, h * s);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return { id: ctx.getImageData(0, 0, c.width, c.height), scale: s };
  }

  /* ---------- Nhận diện tài liệu ---------- */

  /* ---------- nhận diện tài liệu (lõi IPC: Canny + Hough + phân vùng) ---------- */
  function detectInData(id) {
    const r = IPC.detect(id.data, id.width, id.height);
    return r ? r.quad : null;
  }
  function detect(src, maxSide = 480) {
    const { id, scale } = sample(src, maxSide);
    const q = detectInData(id);
    return q ? q.map((p) => [p[0] / scale, p[1] / scale]) : null;
  }
  /* độ nét (phương sai Laplacian) trên ảnh thu nhỏ ~480px */
  function sharpness(src) {
    const { id } = sample(src, 480);
    return IPC.sharpness(id.data, id.width, id.height);
  }
  function fullQuad(w, h, inset = 0) {
    const ix = w * inset, iy = h * inset;
    return [[ix, iy], [w - ix, iy], [w - ix, h - iy], [ix, h - iy]];
  }
  const quadArea = (q) => IPC.quadArea(q);

  /* ---------- Web Worker: xử lý nặng không làm đơ giao diện ---------- */
  let WK = null, wid = 0;
  const pend = new Map();
  function worker() {
    if (WK === false) return null;
    if (!WK) {
      try {
        WK = new Worker('js/ipcore.js');
        WK.onmessage = (e) => { const p = pend.get(e.data.id); if (!p) return; pend.delete(e.data.id); e.data.ok ? p.res(e.data.res) : p.rej(new Error(e.data.err)); };
        WK.onerror = () => { WK = false; pend.forEach((p) => p.rej(new Error('worker'))); pend.clear(); };
      } catch (e) { WK = false; }
    }
    return WK || null;
  }
  function call(op, args, transfer) {
    const w = worker();
    if (!w) return Promise.reject(new Error('noworker'));
    return new Promise((res, rej) => { const id = ++wid; pend.set(id, { res, rej }); w.postMessage({ id, op, args }, transfer || []); });
  }
  /* nhận diện chạy nền (dùng cho camera trực tiếp) */
  async function detectAsync(id) {
    try { const r = await call('detect', { d: id.data.buffer, w: id.width, h: id.height }, [id.data.buffer]); return r ? r.quad : null; }
    catch (e) { return null; }
  }

  /* ---------- nắn phối cảnh nhanh (cho ảnh xem trước nhỏ) ---------- */
  function warp(src, q, opt = {}) {
    const sw = W(src), sh = H(src);
    const sc = canvas(sw, sh), sctx = sc.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(src, 0, 0);
    const r = IPC.process({ sd: sctx.getImageData(0, 0, sw, sh).data, sw, sh, quad: q, maxSide: opt.maxSide || 2400, aspect: opt.aspect, half: opt.half, filterName: 'orig' });
    return dataToCanvas(r.d, r.w, r.h);
  }
  function dataToCanvas(d, w, h) {
    const c = canvas(w, h);
    c.getContext('2d').putImageData(new ImageData(d instanceof Uint8ClampedArray ? d : new Uint8ClampedArray(d), w, h), 0, 0);
    return c;
  }
  function applyFilter(cv, filter) {
    if (!filter || filter === 'orig') return cv;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const id = ctx.getImageData(0, 0, cv.width, cv.height);
    IPC.filter(id.data, cv.width, cv.height, filter);
    ctx.putImageData(id, 0, 0);
    return cv;
  }
  function adjust(cv, adj) {
    if (!adj || (!adj.b && !adj.c)) return cv;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const id = ctx.getImageData(0, 0, cv.width, cv.height);
    IPC.adjust(id.data, cv.width * cv.height, adj);
    ctx.putImageData(id, 0, 0);
    return cv;
  }
  function rotate(cv, deg) {
    deg = ((deg % 360) + 360) % 360;
    if (!deg) return cv;
    const sw = deg % 180 !== 0;
    const c = canvas(sw ? cv.height : cv.width, sw ? cv.width : cv.height);
    const ctx = c.getContext('2d');
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((deg * Math.PI) / 180);
    ctx.drawImage(cv, -cv.width / 2, -cv.height / 2);
    return c;
  }
  function scaleCanvas(cv, maxSide) {
    const s = Math.min(1, maxSide / Math.max(cv.width, cv.height));
    if (s >= 1) return cv;
    const c = canvas(cv.width * s, cv.height * s);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cv, 0, 0, c.width, c.height);
    return c;
  }
  /* độ sáng / tương phản: b,c trong khoảng -50..50 */
  function flipH(cv) {
    const c = canvas(cv.width, cv.height), g = c.getContext('2d');
    g.translate(c.width, 0); g.scale(-1, 1); g.drawImage(cv, 0, 0);
    return c;
  }

  /* ---------- lớp chú thích (bút, chữ, chữ ký, con dấu) – toạ độ chuẩn hoá 0..1 ---------- */
  const imgCache = new Map();
  function loadSrc(src) {
    if (imgCache.has(src)) return imgCache.get(src);
    const p = new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
    imgCache.set(src, p);
    return p;
  }
  function stampMetrics(ctx, a, Wd) {
    const fs = a.size * Wd;
    ctx.font = `700 ${fs}px "Times New Roman", serif`;
    const lines = String(a.text).split('\n');
    const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
    return { fs, lines, w: tw + fs * 1.2, h: lines.length * fs * 1.35 + fs * 0.5 };
  }
  function textMetrics(ctx, a, Wd) {
    const fs = a.size * Wd;
    ctx.font = `${a.bold ? '700 ' : ''}${fs}px Arial, "Noto Sans", sans-serif`;
    const lines = String(a.text).split('\n');
    return { fs, lines, w: Math.max(...lines.map((l) => ctx.measureText(l).width)), h: lines.length * fs * 1.25 };
  }
  /* khung bao của đối tượng (toạ độ chuẩn hoá) */
  function annBox(ctx, a, Wd, Hd) {
    if (a.t === 'text') { const m = textMetrics(ctx, a, Wd); return { x: a.x, y: a.y, w: m.w / Wd, h: m.h / Hd }; }
    if (a.t === 'stamp') { const m = stampMetrics(ctx, a, Wd); return { x: a.x - m.w / Wd / 2, y: a.y - m.h / Hd / 2, w: m.w / Wd, h: m.h / Hd }; }
    if (a.t === 'img') return { x: a.x, y: a.y, w: a.w, h: a.h };
    return null;
  }
  async function drawAnn(cv, ann, skip) {
    if (!ann || !ann.length) return cv;
    const g = cv.getContext('2d'), Wd = cv.width, Hd = cv.height;
    for (const a of ann) {
      if (a === skip) continue;
      g.save();
      if (a.t === 'pen' || a.t === 'hl' || a.t === 'erase') {
        g.lineCap = a.t === 'hl' ? 'square' : 'round'; g.lineJoin = 'round';
        g.strokeStyle = a.t === 'erase' ? '#fff' : a.color;
        g.lineWidth = a.w * Wd;
        if (a.t === 'hl') { g.globalAlpha = 0.38; g.globalCompositeOperation = 'multiply'; }
        g.beginPath();
        a.pts.forEach((p, i) => (i ? g.lineTo(p[0] * Wd, p[1] * Hd) : g.moveTo(p[0] * Wd, p[1] * Hd)));
        if (a.pts.length === 1) g.lineTo(a.pts[0][0] * Wd + 0.1, a.pts[0][1] * Hd);
        g.stroke();
      } else if (a.t === 'text') {
        const m = textMetrics(g, a, Wd);
        g.fillStyle = a.color; g.textBaseline = 'top';
        m.lines.forEach((l, i) => g.fillText(l, a.x * Wd, a.y * Hd + i * m.fs * 1.25));
      } else if (a.t === 'stamp') {
        const m = stampMetrics(g, a, Wd);
        g.translate(a.x * Wd, a.y * Hd); g.rotate(((a.rot ?? -8) * Math.PI) / 180);
        g.strokeStyle = g.fillStyle = a.color || '#d0202a'; g.globalAlpha = 0.85;
        g.lineWidth = Math.max(2, m.fs * 0.09);
        g.strokeRect(-m.w / 2, -m.h / 2, m.w, m.h);
        g.textAlign = 'center'; g.textBaseline = 'middle';
        m.lines.forEach((l, i) => g.fillText(l, 0, (i - (m.lines.length - 1) / 2) * m.fs * 1.35));
      } else if (a.t === 'img') {
        const im = await loadSrc(a.src);
        if (im) g.drawImage(im, a.x * Wd, a.y * Hd, a.w * Wd, a.h * Hd);
      }
      g.restore();
    }
    return cv;
  }
  /* hình mờ chéo trang */
  function watermark(cv, text) {
    if (!text) return cv;
    const g = cv.getContext('2d'), W0 = cv.width, H0 = cv.height;
    const fs = Math.min(W0, H0) / 12;
    g.save();
    g.translate(W0 / 2, H0 / 2); g.rotate(-Math.atan2(H0, W0));
    g.font = `700 ${fs}px Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(200,30,40,.16)';
    for (let k = -2; k <= 2; k++) g.fillText(text, 0, k * fs * 3.2);
    g.restore();
    return cv;
  }
  /* render 1 trang: ảnh gốc → nắn → (tách nửa) → làm thẳng chữ → lọc → chỉnh sáng → xoay → lật → chú thích */
  async function render(item, maxSide = 2400, opt = {}) {
    const b = await load(item.orig);
    const sw = W(b), sh = H(b);
    const sc = canvas(sw, sh), sctx = sc.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(b, 0, 0);
    if (b.close) b.close();
    const sd = sctx.getImageData(0, 0, sw, sh).data;
    sc.width = sc.height = 1;
    const docLike = item.filter && item.filter !== 'orig' && !item.aspect;
    const deskew = typeof item.deskew === 'number' ? item.deskew : (S.autoDeskew && docLike ? 'auto' : 0);
    const args = { sw, sh, quad: item.quad || fullQuad(sw, sh), maxSide, aspect: item.aspect, filterName: item.filter, adj: item.adj, half: item.half, deskew };
    let r;
    try {
      const o = await call('process', { ...args, sd: sd.buffer }, [sd.buffer]);
      r = { d: new Uint8ClampedArray(o.d), w: o.w, h: o.h, angle: o.angle };
    } catch (e) {
      r = IPC.process({ ...args, sd: sd.buffer.byteLength ? sd : (await (async () => { const b2 = await load(item.orig); const c2 = canvas(sw, sh); c2.getContext('2d').drawImage(b2, 0, 0); return c2.getContext('2d').getImageData(0, 0, sw, sh).data; })()) });
    }
    if (deskew === 'auto') item.deskew = r.angle || 0;
    let cv = dataToCanvas(r.d, r.w, r.h);
    if (item.rot) cv = rotate(cv, item.rot);
    if (item.flip) cv = flipH(cv);
    if (!opt.noAnn) await drawAnn(cv, item.ann);
    return cv;
  }
  return { load, canvas, toBlob, normalizeOriginal, detect, detectInData, detectAsync, sharpness, fullQuad, warp, applyFilter, adjust, rotate, flipH, scaleCanvas, render, drawAnn, annBox, watermark, loadSrc, W, H, quadArea };
})();
