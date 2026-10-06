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
  function boxBlur(src, w, h, r) {
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h), d = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      let acc = 0; const o = y * w;
      for (let x = -r; x <= r; x++) acc += src[o + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[o + x] = acc / d;
        acc += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc / d;
        acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
    return out;
  }
  function otsu(g) {
    const hist = new Array(256).fill(0);
    for (let i = 0; i < g.length; i++) hist[g[i] | 0]++;
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sB = 0, wB = 0, best = 0, t = 128;
    for (let i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue;
      const wF = g.length - wB; if (!wF) break;
      sB += i * hist[i];
      const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; t = i; }
    }
    return t;
  }
  function quadArea(q) {
    let a = 0;
    for (let i = 0; i < 4; i++) { const p = q[i], n = q[(i + 1) % 4]; a += p[0] * n[1] - n[0] * p[1]; }
    return Math.abs(a) / 2;
  }
  function isConvex(q) {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
      const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (z !== 0) { if (sign && Math.sign(z) !== sign) return false; sign = Math.sign(z); }
    }
    return true;
  }
  /* imageData -> 4 góc [tl,tr,br,bl] (toạ độ của imageData) hoặc null */
  function detectInData(id) {
    const { width: w, height: h, data } = id, n = w * h;
    const g = new Float32Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      // giấy: sáng và ít màu
      const r = data[j], gg = data[j + 1], b = data[j + 2];
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      g[i] = 0.299 * r + 0.587 * gg + 0.114 * b - 0.35 * (mx - mn);
    }
    const bl = boxBlur(g, w, h, 2);
    for (let i = 0; i < n; i++) bl[i] = Math.max(0, Math.min(255, bl[i]));
    const t = otsu(bl);
    let m = new Uint8Array(n);
    for (let i = 0; i < n; i++) m[i] = bl[i] > t ? 1 : 0;
    // co (erode) 2 lần để cắt các vùng dính
    for (let k = 0; k < 2; k++) {
      const m2 = new Uint8Array(n);
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        m2[i] = m[i] & m[i - 1] & m[i + 1] & m[i - w] & m[i + w];
      }
      m = m2;
    }
    // thành phần liên thông lớn nhất (ưu tiên gần tâm)
    const lab = new Int32Array(n), stack = new Int32Array(n);
    let best = null, label = 0;
    const cx = w / 2, cy = h / 2;
    for (let s = 0; s < n; s++) {
      if (!m[s] || lab[s]) continue;
      label++;
      let sp = 0; stack[sp++] = s; lab[s] = label;
      let size = 0, a = Infinity, b = -Infinity, c = -Infinity, d = Infinity, sx = 0, sy = 0;
      const P = { tl: 0, br: 0, tr: 0, bl: 0 };
      while (sp) {
        const i = stack[--sp], x = i % w, y = (i / w) | 0;
        size++; sx += x; sy += y;
        const s1 = x + y, s2 = x - y;
        if (s1 < a) { a = s1; P.tl = i; } if (s1 > b) { b = s1; P.br = i; }
        if (s2 > c) { c = s2; P.tr = i; } if (s2 < d) { d = s2; P.bl = i; }
        if (x > 0 && m[i - 1] && !lab[i - 1]) { lab[i - 1] = label; stack[sp++] = i - 1; }
        if (x < w - 1 && m[i + 1] && !lab[i + 1]) { lab[i + 1] = label; stack[sp++] = i + 1; }
        if (y > 0 && m[i - w] && !lab[i - w]) { lab[i - w] = label; stack[sp++] = i - w; }
        if (y < h - 1 && m[i + w] && !lab[i + w]) { lab[i + w] = label; stack[sp++] = i + w; }
      }
      const dist = Math.hypot(sx / size - cx, sy / size - cy) / Math.hypot(cx, cy);
      const score = size * (1.2 - dist);
      if (!best || score > best.score) best = { score, size, P };
    }
    if (!best || best.size < n * 0.08) return null;
    const pt = (i) => [i % w, (i / w) | 0];
    const q = [pt(best.P.tl), pt(best.P.tr), pt(best.P.br), pt(best.P.bl)];
    // nở lại phần đã co
    const ccx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, ccy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
    for (const p of q) {
      const dx = p[0] - ccx, dy = p[1] - ccy, L = Math.hypot(dx, dy) || 1;
      p[0] = Math.max(0, Math.min(w - 1, p[0] + (dx / L) * 2.5));
      p[1] = Math.max(0, Math.min(h - 1, p[1] + (dy / L) * 2.5));
    }
    const area = quadArea(q);
    if (area < n * 0.1 || area > n * 0.985 || !isConvex(q)) return null;
    return q;
  }
  function detect(src, maxSide = 360) {
    const { id, scale } = sample(src, maxSide);
    const q = detectInData(id);
    return q ? q.map((p) => [p[0] / scale, p[1] / scale]) : null;
  }
  function fullQuad(w, h, inset = 0) {
    const ix = w * inset, iy = h * inset;
    return [[ix, iy], [w - ix, iy], [w - ix, h - iy], [ix, h - iy]];
  }

  /* ---------- Nắn phối cảnh ---------- */
  function solve(A, b) {
    const n = b.length;
    for (let i = 0; i < n; i++) {
      let p = i;
      for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k;
      [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
      for (let k = i + 1; k < n; k++) {
        const f = A[k][i] / A[i][i];
        for (let j = i; j < n; j++) A[k][j] -= f * A[i][j];
        b[k] -= f * b[i];
      }
    }
    const x = new Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let s = b[i];
      for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j];
      x[i] = s / A[i][i];
    }
    return x;
  }
  function homography(from, to) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = from[i], [u, v] = to[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    return solve(A, b);
  }
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  function outSize(q, maxSide, aspect) {
    let ow = Math.max(dist(q[0], q[1]), dist(q[3], q[2]));
    let oh = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
    if (aspect) { // aspect = w/h (thẻ CCCD)
      if (ow >= oh) oh = ow / aspect; else ow = oh / aspect;
    }
    const s = Math.min(1, maxSide / Math.max(ow, oh));
    return [Math.round(ow * s), Math.round(oh * s)];
  }
  function warp(src, q, opt = {}) {
    const sw = W(src), sh = H(src);
    const [ow, oh] = outSize(q, opt.maxSide || 2400, opt.aspect);
    const isFull = Math.abs(q[0][0]) < 1 && Math.abs(q[0][1]) < 1 && Math.abs(q[2][0] - sw) < 1.5 && Math.abs(q[2][1] - sh) < 1.5 &&
      Math.abs(q[1][0] - sw) < 1.5 && Math.abs(q[3][1] - sh) < 1.5;
    const out = canvas(ow, oh);
    const octx = out.getContext('2d', { willReadFrequently: true });
    if (isFull) { octx.drawImage(src, 0, 0, ow, oh); return out; }
    const sc = canvas(sw, sh);
    const sctx = sc.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(src, 0, 0);
    const sd = sctx.getImageData(0, 0, sw, sh).data;
    const od = octx.createImageData(ow, oh), o = od.data;
    const Hm = homography([[0, 0], [ow, 0], [ow, oh], [0, oh]], q);
    const [a, b, c, d, e, f, g, h] = Hm;
    let k = 0;
    for (let y = 0; y < oh; y++) {
      const yy = y + 0.5;
      for (let x = 0; x < ow; x++, k += 4) {
        const xx = x + 0.5, den = g * xx + h * yy + 1;
        let u = (a * xx + b * yy + c) / den - 0.5, v = (d * xx + e * yy + f) / den - 0.5;
        if (u < 0) u = 0; else if (u > sw - 1.001) u = sw - 1.001;
        if (v < 0) v = 0; else if (v > sh - 1.001) v = sh - 1.001;
        const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0;
        const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
        const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
        o[k] = sd[i00] * w00 + sd[i10] * w10 + sd[i01] * w01 + sd[i11] * w11;
        o[k + 1] = sd[i00 + 1] * w00 + sd[i10 + 1] * w10 + sd[i01 + 1] * w01 + sd[i11 + 1] * w11;
        o[k + 2] = sd[i00 + 2] * w00 + sd[i10 + 2] * w10 + sd[i01 + 2] * w01 + sd[i11 + 2] * w11;
        o[k + 3] = 255;
      }
    }
    octx.putImageData(od, 0, 0);
    return out;
  }

  /* ---------- Bộ lọc ---------- */
  function background(d, w, h) {
    // ước lượng màu nền giấy (max-pooling theo khối + làm mượt)
    const f = Math.max(8, Math.round(Math.max(w, h) / 120));
    const bw = Math.ceil(w / f), bh = Math.ceil(h / f), N = bw * bh;
    const R = new Float32Array(N), G = new Float32Array(N), B = new Float32Array(N);
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      let mr = 0, mg = 0, mb = 0, ml = -1;
      const y1 = Math.min(h, (by + 1) * f), x1 = Math.min(w, (bx + 1) * f);
      for (let y = by * f; y < y1; y += 2) for (let x = bx * f; x < x1; x += 2) {
        const i = (y * w + x) * 4, l = d[i] + d[i + 1] * 2 + d[i + 2];
        if (l > ml) { ml = l; mr = d[i]; mg = d[i + 1]; mb = d[i + 2]; }
      }
      const j = by * bw + bx; R[j] = mr; G[j] = mg; B[j] = mb;
    }
    const r = 2;
    return { bw, bh, f, R: boxBlur(boxBlur(R, bw, bh, r), bw, bh, r), G: boxBlur(boxBlur(G, bw, bh, r), bw, bh, r), B: boxBlur(boxBlur(B, bw, bh, r), bw, bh, r) };
  }
  function bgAt(bg, arr, x, y) {
    let u = x / bg.f - 0.5, v = y / bg.f - 0.5;
    if (u < 0) u = 0; if (v < 0) v = 0;
    if (u > bg.bw - 1.001) u = Math.max(0, bg.bw - 1.001);
    if (v > bg.bh - 1.001) v = Math.max(0, bg.bh - 1.001);
    const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0;
    const x1 = Math.min(bg.bw - 1, x0 + 1), y1 = Math.min(bg.bh - 1, y0 + 1);
    return arr[y0 * bg.bw + x0] * (1 - fx) * (1 - fy) + arr[y0 * bg.bw + x1] * fx * (1 - fy) +
      arr[y1 * bg.bw + x0] * (1 - fx) * fy + arr[y1 * bg.bw + x1] * fx * fy;
  }
  const curve = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) curve[i] = 255 * Math.pow(i / 255, 1.55);
  function applyFilter(cv, filter) {
    if (!filter || filter === 'orig') return cv;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const w = cv.width, h = cv.height, id = ctx.getImageData(0, 0, w, h), d = id.data;
    if (filter === 'bright') {
      for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = Math.min(255, (d[i + c] - 128) * 1.25 + 128 + 28);
      ctx.putImageData(id, 0, 0); return cv;
    }
    const bg = background(d, w, h);
    // chuẩn hoá nền -> trắng
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const br = Math.max(60, bgAt(bg, bg.R, x, y)), bgc = Math.max(60, bgAt(bg, bg.G, x, y)), bb = Math.max(60, bgAt(bg, bg.B, x, y));
      d[i] = Math.min(255, (d[i] * 255) / br);
      d[i + 1] = Math.min(255, (d[i + 1] * 255) / bgc);
      d[i + 2] = Math.min(255, (d[i + 2] * 255) / bb);
    }
    if (filter === 'noshadow') {
      for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = Math.min(255, Math.max(0, (d[i + c] - 255) * 1.12 + 255));
    } else if (filter === 'nohand') {
      // xoá nét bút màu (xanh/đỏ/tím), giữ chữ in đen
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        let l;
        if (mx - mn > 38 && mx > 60) l = 255;
        else l = curve[(0.299 * r + 0.587 * g + 0.114 * b) | 0];
        d[i] = d[i + 1] = d[i + 2] = l;
      }
    } else if (filter === 'magic') {
      for (let i = 0; i < d.length; i += 4) {
        let r = curve[d[i]], g = curve[d[i + 1]], b = curve[d[i + 2]];
        const l = 0.299 * r + 0.587 * g + 0.114 * b, s = 1.25;
        d[i] = l + (r - l) * s; d[i + 1] = l + (g - l) * s; d[i + 2] = l + (b - l) * s;
      }
    } else if (filter === 'gray') {
      for (let i = 0; i < d.length; i += 4) {
        const l = curve[(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0];
        d[i] = d[i + 1] = d[i + 2] = l;
      }
    } else if (filter === 'bw' || filter === 'eco') {
      const n = w * h, g = new Float32Array(n), ink = filter === 'eco' ? 105 : 0;
      for (let i = 0; i < n; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
      const r = Math.max(6, Math.round(Math.min(w, h) / 45));
      const mean = boxBlur(g, w, h, r);
      for (let i = 0; i < n; i++) {
        const v = g[i] < mean[i] * 0.86 || g[i] < 85 ? ink : 255;
        d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
      }
    }
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
  function adjust(cv, adj) {
    if (!adj || (!adj.b && !adj.c)) return cv;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const id = ctx.getImageData(0, 0, cv.width, cv.height), d = id.data;
    const k = 1 + adj.c / 60, off = adj.b * 1.6, lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) lut[i] = (i - 128) * k + 128 + off;
    for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
    ctx.putImageData(id, 0, 0);
    return cv;
  }
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
  /* render 1 trang: ảnh gốc + góc + lọc + chỉnh sáng + xoay + lật + chú thích */
  async function render(item, maxSide = 2400, opt = {}) {
    const b = await load(item.orig);
    const q = item.quad || fullQuad(W(b), H(b));
    let cv = warp(b, q, { maxSide, aspect: item.aspect });
    if (b.close) b.close();
    applyFilter(cv, item.filter);
    adjust(cv, item.adj);
    if (item.rot) cv = rotate(cv, item.rot);
    if (item.flip) cv = flipH(cv);
    if (!opt.noAnn) await drawAnn(cv, item.ann);
    return cv;
  }
  return { load, canvas, toBlob, normalizeOriginal, detect, detectInData, fullQuad, warp, applyFilter, adjust, rotate, flipH, scaleCanvas, render, drawAnn, annBox, watermark, loadSrc, W, H, quadArea };
})();
