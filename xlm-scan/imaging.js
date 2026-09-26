'use strict';
/* XLM Scan — xử lý ảnh: nhận khung giấy, nắn phẳng phối cảnh, bộ lọc tài liệu */
const Imaging = (() => {
  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    return c;
  }
  function ctx2d(c) { return c.getContext('2d', { willReadFrequently: true }); }

  /* ---------- tải ảnh (tôn trọng hướng EXIF của điện thoại) */
  function loadImage(blob) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Không đọc được ảnh')); };
      img.src = url;
    });
  }
  async function blobToCanvas(blob, maxSide = Infinity) {
    const img = await loadImage(blob);
    const w = img.naturalWidth, h = img.naturalHeight;
    const s = Math.min(1, maxSide / Math.max(w, h));
    const c = canvas(w * s, h * s);
    const x = ctx2d(c);
    x.imageSmoothingQuality = 'high';
    x.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }
  function scaleCanvas(src, maxSide) {
    const s = Math.min(1, maxSide / Math.max(src.width, src.height));
    if (s === 1) return src;
    const c = canvas(src.width * s, src.height * s);
    const x = ctx2d(c); x.imageSmoothingQuality = 'high';
    x.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }
  function toBlob(c, type = 'image/jpeg', q = 0.9) {
    return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('Không tạo được ảnh')), type, q));
  }

  /* ---------- tự nhận khung giấy */
  function boxBlur(src, w, h, r) {
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    const n = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      let acc = 0; const o = y * w;
      for (let i = -r; i <= r; i++) acc += src[o + Math.min(w - 1, Math.max(0, i))];
      for (let x = 0; x < w; x++) {
        tmp[o + x] = acc / n;
        acc += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += tmp[Math.min(h - 1, Math.max(0, i)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc / n;
        acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
    return out;
  }
  function otsu(g) {
    const hist = new Float64Array(256);
    for (let i = 0; i < g.length; i++) hist[Math.min(255, g[i] | 0)]++;
    const total = g.length; let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, t = 128;
    for (let i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue;
      const wF = total - wB; if (!wF) break;
      sumB += i * hist[i];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; t = i; }
    }
    return t;
  }
  function morph(mask, w, h, r, dilate) {
    // tách làm 2 lượt ngang/dọc cho nhanh
    const a = new Uint8Array(w * h), b = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = dilate ? 0 : 1;
      for (let i = -r; i <= r; i++) {
        const xx = x + i; if (xx < 0 || xx >= w) continue;
        const m = mask[y * w + xx];
        if (dilate ? m : !m) { v = dilate ? 1 : 0; break; }
      }
      a[y * w + x] = v;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = dilate ? 0 : 1;
      for (let i = -r; i <= r; i++) {
        const yy = y + i; if (yy < 0 || yy >= h) continue;
        const m = a[yy * w + x];
        if (dilate ? m : !m) { v = dilate ? 1 : 0; break; }
      }
      b[y * w + x] = v;
    }
    return b;
  }
  function largestComponent(mask, w, h) {
    const lab = new Int32Array(w * h); let best = 0, bestId = 0, id = 0;
    const stack = new Int32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      if (!mask[i] || lab[i]) continue;
      id++; let sp = 0, cnt = 0; stack[sp++] = i; lab[i] = id;
      while (sp) {
        const p = stack[--sp]; cnt++;
        const x = p % w, y = (p / w) | 0;
        if (x > 0 && mask[p - 1] && !lab[p - 1]) { lab[p - 1] = id; stack[sp++] = p - 1; }
        if (x < w - 1 && mask[p + 1] && !lab[p + 1]) { lab[p + 1] = id; stack[sp++] = p + 1; }
        if (y > 0 && mask[p - w] && !lab[p - w]) { lab[p - w] = id; stack[sp++] = p - w; }
        if (y < h - 1 && mask[p + w] && !lab[p + w]) { lab[p + w] = id; stack[sp++] = p + w; }
      }
      if (cnt > best) { best = cnt; bestId = id; }
    }
    return { lab, id: bestId, area: best };
  }
  function convexHull(pts) {
    pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    up.pop(); lo.pop();
    return lo.concat(up);
  }
  function polyArea(p) {
    let a = 0;
    for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; }
    return Math.abs(a) / 2;
  }
  function reduceToQuad(hull) {
    const p = hull.slice();
    const tri = (a, b, c) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
    while (p.length > 4) {
      let mi = 0, mv = Infinity;
      for (let i = 0; i < p.length; i++) {
        const v = tri(p[(i - 1 + p.length) % p.length], p[i], p[(i + 1) % p.length]);
        if (v < mv) { mv = v; mi = i; }
      }
      p.splice(mi, 1);
    }
    return p;
  }
  function orderCorners(q) {
    const cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4;
    const s = q.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
    let k = 0, mv = Infinity;
    s.forEach((p, i) => { if (p[0] + p[1] < mv) { mv = p[0] + p[1]; k = i; } });
    return s.slice(k).concat(s.slice(0, k)); // TL, TR, BR, BL
  }
  function isConvex(q) {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
      const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (!z) continue; const s = Math.sign(z);
      if (sign && s !== sign) return false; sign = s;
    }
    return true;
  }
  /** Tứ giác từ 1 mặt nạ nhị phân (thành phần lớn nhất → bao lồi → rút về 4 đỉnh) */
  function quadFromMask(mask, w, h) {
    const { lab, id, area } = largestComponent(mask, w, h);
    const total = w * h;
    if (!id || area < total * 0.12) return null;
    const pts = [];
    for (let y = 0; y < h; y++) {
      let l = -1, r = -1;
      for (let x = 0; x < w; x++) if (lab[y * w + x] === id) { if (l < 0) l = x; r = x; }
      if (l >= 0) { pts.push([l, y]); pts.push([r + 1, y]); }
    }
    if (pts.length < 8) return null;
    const hull = convexHull(pts);
    if (hull.length < 4) return null;
    const quad = orderCorners(reduceToQuad(hull));
    const qa = polyArea(quad);
    if (qa < total * 0.12 || qa > total * 0.985 || !isConvex(quad)) return null;
    if (polyArea(hull) / qa > 1.25) return null;
    return { quad, fill: area / qa };
  }
  /** Điểm cho 1 tứ giác: độ tương phản trung bình dọc 4 cạnh (mép giấy thật có tương phản mạnh và đều) */
  function edgeScore(quad, g, w, h) {
    let sum = 0, n = 0, weak = 0;
    for (let i = 0; i < 4; i++) {
      const a = quad[i], b = quad[(i + 1) % 4];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 1) continue;
      const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len; // pháp tuyến
      let es = 0, en = 0;
      for (let t = 0.08; t <= 0.92; t += 0.04) {
        const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
        const x1 = Math.round(x + nx * 3), y1 = Math.round(y + ny * 3), x2 = Math.round(x - nx * 3), y2 = Math.round(y - ny * 3);
        if (x1 < 0 || y1 < 0 || x2 < 0 || y2 < 0 || x1 >= w || x2 >= w || y1 >= h || y2 >= h) continue; // mép ảnh: bỏ qua
        es += Math.abs(g[y1 * w + x1] - g[y2 * w + x2]); en++;
      }
      if (en) { const m = es / en; sum += m; n++; if (m < 12) weak++; }
    }
    return n ? sum / n - weak * 15 : 0;
  }
  /** Trả về 4 góc [TL,TR,BR,BL] theo tỉ lệ 0..1, hoặc null nếu không chắc chắn */
  function detectQuad(src) {
    const S = 320;
    const small = scaleCanvas(src, S);
    const w = small.width, h = small.height;
    const d = ctx2d(small).getImageData(0, 0, w, h).data;
    let g = new Float32Array(w * h), sat = new Float32Array(w * h);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) {
      const r = d[j], gg = d[j + 1], b = d[j + 2];
      g[i] = 0.299 * r + 0.587 * gg + 0.114 * b;
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      sat[i] = mx ? (mx - mn) / mx : 0;
    }
    g = boxBlur(boxBlur(g, w, h, 2), w, h, 2);
    sat = boxBlur(sat, w, h, 2);
    const t = otsu(g);
    // độ bão hòa điển hình của giấy: trung vị trong vùng sáng
    const bright = []; for (let i = 0; i < g.length; i += 5) if (g[i] > t) bright.push(sat[i]);
    bright.sort((a, b) => a - b);
    const paperSat = bright.length ? bright[Math.floor(bright.length / 2)] : 0;
    const variants = [
      { thr: t, satMax: 1, open: 3 },
      { thr: t, satMax: paperSat + 0.08, open: 3 },
      { thr: t, satMax: paperSat + 0.08, open: 6 },
      { thr: t + (255 - t) * 0.25, satMax: paperSat + 0.1, open: 5 },
    ];
    let best = null;
    for (const v of variants) {
      let mask = new Uint8Array(w * h);
      for (let i = 0; i < g.length; i++) mask[i] = g[i] > v.thr && sat[i] <= v.satMax ? 1 : 0;
      mask = morph(morph(mask, w, h, v.open, false), w, h, v.open, true);   // mở: cắt cầu nối mảnh (chữ trên bàn phím, mép áo…)
      mask = morph(morph(mask, w, h, 4, true), w, h, 4, false);             // đóng: lấp chữ trên giấy
      const r = quadFromMask(mask, w, h);
      if (!r) continue;
      const score = edgeScore(r.quad, g, w, h) + r.fill * 20;
      if (!best || score > best.score) best = { ...r, score };
    }
    if (!best) return null;
    return best.quad.map(([x, y]) => [Math.min(1, Math.max(0, x / w)), Math.min(1, Math.max(0, y / h))]);
  }
  const FULL = () => [[0, 0], [1, 0], [1, 1], [0, 1]];
  const INSET = () => [[0.06, 0.06], [0.94, 0.06], [0.94, 0.94], [0.06, 0.94]];

  /* ---------- nắn phẳng phối cảnh */
  function solve(A, b) {
    const n = b.length;
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
      const v = A[c][c]; if (Math.abs(v) < 1e-12) throw new Error('Khung cắt không hợp lệ');
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = A[r][c] / v;
        for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
        b[r] -= f * b[c];
      }
    }
    return b.map((x, i) => x / A[i][i]);
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
  function outputSize(cornersPx) {
    const [tl, tr, br, bl] = cornersPx;
    return [Math.max(dist(tl, tr), dist(bl, br)), Math.max(dist(tl, bl), dist(tr, br))];
  }
  /** src: canvas; corners: tỉ lệ 0..1; maxSide: cạnh dài tối đa của kết quả */
  function warp(src, corners, maxSide) {
    const sw = src.width, sh = src.height;
    const cp = corners.map(([x, y]) => [x * sw, y * sh]);
    let [ow, oh] = outputSize(cp);
    const s = Math.min(1, maxSide / Math.max(ow, oh));
    ow = Math.max(8, Math.round(ow * s)); oh = Math.max(8, Math.round(oh * s));
    const isFull = corners.every((p, i) => Math.abs(p[0] - FULL()[i][0]) < 1e-6 && Math.abs(p[1] - FULL()[i][1]) < 1e-6);
    const out = canvas(ow, oh);
    if (isFull) { const x = ctx2d(out); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, ow, oh); return out; }
    const H = homography([[0, 0], [ow, 0], [ow, oh], [0, oh]], cp);
    const sd = ctx2d(src).getImageData(0, 0, sw, sh).data;
    const oc = ctx2d(out); const od = oc.createImageData(ow, oh); const o = od.data;
    const [a, b, c, d, e, f, g, hh] = H;
    // lấy mẫu song tuyến; khi thu nhỏ nhiều thì lấy trung bình 4 điểm để chống răng cưa
    const ss = Math.max(dist(cp[0], cp[1]) / ow, dist(cp[0], cp[3]) / oh) > 1.8;
    const offs = ss ? [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]] : [[0.5, 0.5]];
    const inv = 1 / offs.length;
    let k = 0;
    for (let y = 0; y < oh; y++) {
      for (let x = 0; x < ow; x++, k += 4) {
        let r = 0, gg = 0, bb = 0;
        for (const [dx, dy] of offs) {
          const X = x + dx, Y = y + dy;
          const den = g * X + hh * Y + 1;
          let u = (a * X + b * Y + c) / den - 0.5, v = (d * X + e * Y + f) / den - 0.5;
          if (u < 0) u = 0; else if (u > sw - 1.001) u = sw - 1.001;
          if (v < 0) v = 0; else if (v > sh - 1.001) v = sh - 1.001;
          const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0;
          const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
          const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
          r += sd[i00] * w00 + sd[i10] * w10 + sd[i01] * w01 + sd[i11] * w11;
          gg += sd[i00 + 1] * w00 + sd[i10 + 1] * w10 + sd[i01 + 1] * w01 + sd[i11 + 1] * w11;
          bb += sd[i00 + 2] * w00 + sd[i10 + 2] * w10 + sd[i01 + 2] * w01 + sd[i11 + 2] * w11;
        }
        o[k] = r * inv; o[k + 1] = gg * inv; o[k + 2] = bb * inv; o[k + 3] = 255;
      }
    }
    oc.putImageData(od, 0, 0);
    return out;
  }
  function rotate(src, quarter) {
    quarter = ((quarter % 4) + 4) % 4;
    if (!quarter) return src;
    const swap = quarter % 2 === 1;
    const c = canvas(swap ? src.height : src.width, swap ? src.width : src.height);
    const x = c.getContext('2d');
    x.translate(c.width / 2, c.height / 2); x.rotate(quarter * Math.PI / 2);
    x.drawImage(src, -src.width / 2, -src.height / 2);
    return c;
  }

  /* ---------- bộ lọc */
  // Ước lượng nền giấy theo lưới khối để khử bóng đổ và ánh sáng không đều
  function background(L, w, h) {
    const bs = Math.max(8, Math.round(Math.max(w, h) / 40));
    const gw = Math.ceil(w / bs), gh = Math.ceil(h / bs);
    let grid = new Float32Array(gw * gh);
    for (let by = 0; by < gh; by++) for (let bx = 0; bx < gw; bx++) {
      const hist = new Uint16Array(64); let n = 0;
      const y1 = Math.min(h, (by + 1) * bs), x1 = Math.min(w, (bx + 1) * bs);
      for (let y = by * bs; y < y1; y += 2) for (let x = bx * bs; x < x1; x += 2) { hist[L[y * w + x] >> 2]++; n++; }
      // phân vị 90% — sáng nhất nhưng bỏ qua điểm lóa
      let acc = 0, target = n * 0.9, v = 63;
      for (let i = 0; i < 64; i++) { acc += hist[i]; if (acc >= target) { v = i; break; } }
      grid[by * gw + bx] = v * 4 + 2;
    }
    // giãn nở rồi làm mượt để khối nhiều chữ không bị coi là nền tối
    const dil = new Float32Array(gw * gh);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      let m = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const yy = y + j, xx = x + i;
        if (yy >= 0 && yy < gh && xx >= 0 && xx < gw) m = Math.max(m, grid[yy * gw + xx]);
      }
      dil[y * gw + x] = m;
    }
    grid = boxBlur(boxBlur(dil, gw, gh, 1), gw, gh, 1);
    return { grid, gw, gh, bs };
  }
  /* làm mờ hộp nhanh trên mảng 8-bit (dùng cho làm nét) */
  function blur8(src, w, h, r) {
    const tmp = new Uint8ClampedArray(w * h), out = new Uint8ClampedArray(w * h), n = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      const o = y * w; let acc = 0;
      for (let i = -r; i <= r; i++) acc += src[o + Math.min(w - 1, Math.max(0, i))];
      for (let x = 0; x < w; x++) {
        tmp[o + x] = acc / n;
        acc += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += tmp[Math.min(h - 1, Math.max(0, i)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc / n;
        acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
    return out;
  }
  /**
   * Bộ lọc tài liệu kiểu CamScanner:
   * 1) ước lượng nền giấy theo từng vùng → chia ra để khử bóng, nền trắng đều
   * 2) tìm mức mực trong histogram → kéo chữ về đen đậm, nền ≥ ngưỡng thành trắng tinh
   * 3) làm nét (unsharp mask) theo độ phân giải ảnh
   * 4) 'magic' giữ màu mộc đỏ / chữ ký xanh và tăng độ tươi
   */
  function applyFilter(c, type) {
    if (type === 'original') return c;
    const w = c.width, h = c.height, x = ctx2d(c);
    const id = x.getImageData(0, 0, w, h), d = id.data, N = w * h;
    const L = new Uint8ClampedArray(N);
    for (let i = 0, j = 0; i < N; i++, j += 4) L[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
    // nền giấy từng điểm (nội suy lưới)
    const { grid, gw, gh, bs } = background(blur8(L, w, h, 1), w, h);
    const BG = new Uint8ClampedArray(N);
    const colX0 = new Int32Array(w), colX1 = new Int32Array(w), colF = new Float32Array(w);
    for (let xx = 0; xx < w; xx++) {
      let gx = (xx + 0.5) / bs - 0.5; if (gx < 0) gx = 0; if (gx > gw - 1) gx = gw - 1;
      colX0[xx] = Math.floor(gx); colX1[xx] = Math.min(gw - 1, colX0[xx] + 1); colF[xx] = gx - colX0[xx];
    }
    for (let y = 0; y < h; y++) {
      let gy = (y + 0.5) / bs - 0.5; if (gy < 0) gy = 0; if (gy > gh - 1) gy = gh - 1;
      const y0 = Math.floor(gy), y1 = Math.min(gh - 1, y0 + 1), fy = gy - y0, r0 = y0 * gw, r1 = y1 * gw, o = y * w;
      for (let xx = 0; xx < w; xx++) {
        const a = colX0[xx], b = colX1[xx], f = colF[xx];
        const top = grid[r0 + a] + (grid[r0 + b] - grid[r0 + a]) * f;
        const bot = grid[r1 + a] + (grid[r1 + b] - grid[r1 + a]) * f;
        BG[o + xx] = Math.max(60, top + (bot - top) * fy);
      }
    }
    // độ sáng đã chuẩn hóa theo nền (255 = đúng màu giấy)
    const Nn = new Uint8ClampedArray(N);
    for (let i = 0; i < N; i++) Nn[i] = L[i] * 255 / BG[i];
    // mức mực: phân vị 1% của các điểm tối hơn nền rõ rệt
    const hist = new Uint32Array(256);
    for (let i = 0; i < N; i += 3) hist[Nn[i]]++;
    let dark = 0; for (let i = 0; i < 200; i++) dark += hist[i];
    let ink = 60, acc = 0;
    for (let i = 0; i < 200; i++) { acc += hist[i]; if (acc >= dark * 0.04) { ink = i; break; } }
    // cân bằng trắng: màu giấy (vùng sáng) → trung tính, khử ám vàng / ám xanh của đèn
    let sr = 0, sg = 0, sb = 0, sl = 0;
    for (let i = 0, j = 0; i < N; i += 7, j += 28) if (Nn[i] > 232) { sr += d[j]; sg += d[j + 1]; sb += d[j + 2]; sl += L[i]; }
    const wr = sr ? Math.min(1.6, sl / sr) : 1, wg = sg ? Math.min(1.6, sl / sg) : 1, wb = sb ? Math.min(1.6, sl / sb) : 1;
    const white = type === 'bw' ? 200 : type === 'wb' ? 196 : 222;           // từ ngưỡng này trở lên → trắng tinh
    const black = Math.min(150, ink + 32); // từ ngưỡng này trở xuống → đen đậm
    // làm nét: bán kính theo kích thước ảnh
    const rad = Math.max(1, Math.round(Math.max(w, h) / 1400));
    const bl = blur8(blur8(Nn, w, h, rad), w, h, rad);
    const amt = type === 'bw' ? 1.6 : type === 'gray' ? 1.3 : 1.1;
    const lut = new Uint8ClampedArray(512); // tra cứu đường cong cho giá trị -128..383
    for (let v = -128; v < 384; v++) {
      let t = (v - black) / (white - black); t = t < 0 ? 0 : t > 1 ? 1 : t;
      lut[v + 128] = 255 * Math.pow(t, type === 'bw' ? 1 : 1.35);
    }
    for (let i = 0, j = 0; i < N; i++, j += 4) {
      // làm nét có ngưỡng: bỏ qua chênh lệch nhỏ (nhiễu hạt, vết nén JPEG), chỉ làm sắc mép chữ thật
      const df = Nn[i] - bl[i], sharp = Nn[i] + (df > 5 || df < -5 ? amt * (df > 0 ? df - 5 : df + 5) : 0);
      if (type === 'bw') {
        // ngưỡng mềm 2 mức xám ở mép chữ → nét trơn, không răng cưa
        const t = Math.max(black + 45, 186);
        const v = sharp < t - 12 ? 0 : sharp > t + 12 ? 255 : (sharp - (t - 12)) / 24 * 255;
        d[j] = d[j + 1] = d[j + 2] = v;
      } else if (type === 'gray') {
        const v = lut[Math.max(-128, Math.min(383, sharp | 0)) + 128];
        d[j] = d[j + 1] = d[j + 2] = v;
      } else {
        // màu: chuẩn hóa từng kênh theo nền, cùng độ nét và đường cong, tăng độ tươi
        const k = 255 / BG[i], dl = sharp - Nn[i];
        let r = d[j] * wr * k + dl, g = d[j + 1] * wg * k + dl, b = d[j + 2] * wb * k + dl;
        const m = (r + g + b) / 3, chroma = Math.max(r, g, b) - Math.min(r, g, b);
        const sat = chroma > 28 ? (type === 'wb' ? 2.0 : 1.45) : (type === 'wb' ? 1.25 : 1.0); // chỉ làm tươi vùng có màu thật (mộc, chữ ký), giữ chữ đen trung tính
        r = m + (r - m) * sat; g = m + (g - m) * sat; b = m + (b - m) * sat;
        d[j] = lut[Math.max(-128, Math.min(383, r | 0)) + 128];
        d[j + 1] = lut[Math.max(-128, Math.min(383, g | 0)) + 128];
        d[j + 2] = lut[Math.max(-128, Math.min(383, b | 0)) + 128];
      }
    }
    x.putImageData(id, 0, 0);
    return c;
  }
  /* ---------- chỉnh sáng / tương phản / làm nét */
  function adjust(c, adj) {
    if (!adj) return c;
    const b = +adj.b || 0, k = +adj.c || 0, s = +adj.s || 0;
    if (!b && !k && !s) return c;
    const w = c.width, h = c.height, x = ctx2d(c);
    const id = x.getImageData(0, 0, w, h), d = id.data;
    if (s > 0) {
      // làm nét kiểu unsharp mask: điểm ảnh + hệ số × (điểm ảnh − trung bình 3×3)
      const src = new Uint8ClampedArray(d), amt = s / 100 * 1.6, row = w * 4;
      for (let y = 1; y < h - 1; y++) for (let xx = 1; xx < w - 1; xx++) {
        const i = (y * w + xx) * 4;
        for (let ch = 0; ch < 3; ch++) {
          const j = i + ch;
          const m = (src[j - row - 4] + src[j - row] + src[j - row + 4] + src[j - 4] + src[j] + src[j + 4] + src[j + row - 4] + src[j + row] + src[j + row + 4]) / 9;
          d[j] = src[j] + amt * (src[j] - m);
        }
      }
    }
    if (b || k) {
      const C = k * 2.55, f = (259 * (C + 255)) / (255 * (259 - C)), B = b * 2.2;
      const lut = new Uint8ClampedArray(256);
      for (let i = 0; i < 256; i++) lut[i] = f * (i - 128) + 128 + B;
      for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
    }
    x.putImageData(id, 0, 0);
    return c;
  }
  /* ---------- màu nền giấy (để cọ tẩy tô trùng màu) */
  function paperColor(c) {
    const s = scaleCanvas(c, 96), d = ctx2d(s).getImageData(0, 0, s.width, s.height).data;
    const px = [];
    for (let i = 0; i < d.length; i += 4) px.push([d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11, d[i], d[i + 1], d[i + 2]]);
    px.sort((a, b) => b[0] - a[0]);
    const top = px.slice(Math.floor(px.length * 0.05), Math.floor(px.length * 0.3));
    const avg = k => Math.round(top.reduce((t, p) => t + p[k], 0) / Math.max(1, top.length));
    return `rgb(${avg(1)},${avg(2)},${avg(3)})`;
  }
  /* ---------- nét tẩy: tọa độ 0..1 theo ảnh kết quả, độ dày theo tỉ lệ chiều rộng */
  function applyErase(c, strokes) {
    if (!strokes || !strokes.length) return c;
    const x = c.getContext('2d'), col = paperColor(c);
    x.save(); x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = col; x.fillStyle = col;
    for (const s of strokes) {
      const lw = Math.max(1, s.w * c.width);
      x.lineWidth = lw;
      const p = s.pts;
      if (p.length === 1) { x.beginPath(); x.arc(p[0][0] * c.width, p[0][1] * c.height, lw / 2, 0, Math.PI * 2); x.fill(); continue; }
      x.beginPath(); x.moveTo(p[0][0] * c.width, p[0][1] * c.height);
      for (let i = 1; i < p.length; i++) x.lineTo(p[i][0] * c.width, p[i][1] * c.height);
      x.stroke();
    }
    x.restore();
    return c;
  }
  function half(c, side) {
    if (!side) return c;
    const w = Math.floor(c.width / 2);
    const o = canvas(side === 'R' ? c.width - w : w, c.height);
    o.getContext('2d').drawImage(c, side === 'R' ? w : 0, 0, o.width, c.height, 0, 0, o.width, c.height);
    return o;
  }
  function finish(c, page) {
    c = applyFilter(c, page.filter || 'magic');
    c = adjust(c, page.adj);
    return applyErase(c, page.erase);
  }
  /** Dựng ảnh trang hoàn chỉnh từ ảnh gốc + thông số chỉnh */
  function render(src, page, maxSide) {
    let c = warp(src, page.corners, maxSide);
    c = rotate(c, page.rot || 0);
    c = half(c, page.half);
    return finish(c, page);
  }
  /** Khổ giấy tờ đặt lên A4 theo kích thước thật (mm) */
  const CARD = { id: [85.6, 53.98], passport: [125, 88] };
  /** CCCD / thẻ / hộ chiếu: nắn từng mặt về đúng tỉ lệ rồi đặt lên trang A4 đúng kích thước thật */
  function renderId(srcs, page, maxSide) {
    const H = Math.round(maxSide), W = Math.round(H / 1.41421);
    const [mw, mh] = CARD[page.spec] || CARD.id;
    const cw = Math.round(W * mw / 210), ch = Math.round(cw * mh / mw);
    const out = canvas(W, H), x = out.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
    const gap = Math.round(H * 0.05), top = Math.round(H * 0.1);
    srcs.forEach((src, i) => {
      const part = page.parts[i]; if (!src || !part) return;
      let c = warp(src, part.corners, Math.max(cw, ch) * 1.2);
      if (c.height > c.width) c = rotate(c, 1);
      c = rotate(c, (part.rot || 0) * 2);
      x.imageSmoothingQuality = 'high';
      const px = Math.round((W - cw) / 2), py = top + i * (ch + gap);
      x.drawImage(c, px, py, cw, ch);
      x.strokeStyle = 'rgba(0,0,0,.18)'; x.lineWidth = Math.max(1, W / 800); x.strokeRect(px, py, cw, ch);
    });
    return finish(rotate(out, page.rot || 0), page);
  }
  /** Ảnh thẻ: cắt đúng tỉ lệ rồi xếp nhiều ảnh lên tờ 10 × 15 cm để in (có đường cắt) */
  const PHOTO = { '2x3': [20, 30], '3x4': [30, 40], '4x6': [40, 60] };
  function renderPhoto(src, page, maxSide) {
    const [pw, ph] = PHOTO[page.photoSize] || PHOTO['3x4'];
    const SW = 150, SH = 100; // tờ 15 × 10 cm nằm ngang
    const dpmm = Math.min(12, maxSide / SW);
    const W = Math.round(SW * dpmm), H = Math.round(SH * dpmm);
    let c = warp(src, page.corners, Math.max(pw, ph) * dpmm * 1.3);
    c = rotate(c, page.rot || 0);
    c = finish(c, page);
    const out = canvas(W, H), x = out.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
    const gap = 2 * dpmm, cols = Math.max(1, Math.floor((SW - 4) / (pw + 2))), rows = Math.max(1, Math.floor((SH - 4) / (ph + 2)));
    const ox = (W - (cols * pw * dpmm + (cols - 1) * gap)) / 2, oy = (H - (rows * ph * dpmm + (rows - 1) * gap)) / 2;
    // cắt giữa ảnh theo đúng tỉ lệ ảnh thẻ
    const ar = pw / ph; let sw = c.width, sh = c.height, sx = 0, sy = 0;
    if (sw / sh > ar) { sw = sh * ar; sx = (c.width - sw) / 2; } else { sh = sw / ar; sy = (c.height - sh) / 2; }
    x.imageSmoothingQuality = 'high';
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
      const px = ox + k * (pw * dpmm + gap), py = oy + r * (ph * dpmm + gap);
      x.drawImage(c, sx, sy, sw, sh, px, py, pw * dpmm, ph * dpmm);
      x.strokeStyle = 'rgba(0,0,0,.25)'; x.lineWidth = 1; x.strokeRect(px - 0.5, py - 0.5, pw * dpmm + 1, ph * dpmm + 1);
    }
    return out;
  }
  /** Dựng trang theo loại: tài liệu, thẻ/hộ chiếu, ảnh thẻ */
  function renderAny(srcs, page, maxSide) {
    if (page.kind === 'id') return renderId(srcs, page, maxSide);
    if (page.kind === 'photo') return renderPhoto(srcs[0], page, maxSide);
    return render(srcs[0], page, maxSide);
  }
  /** Đóng dấu mờ chéo trang */
  function watermark(c, text, opacity = 0.16) {
    if (!text) return c;
    const x = c.getContext('2d'), W = c.width, H = c.height;
    const fs = Math.max(14, Math.round(Math.min(W, H) / 14));
    x.save(); x.globalAlpha = opacity; x.fillStyle = '#C62828';
    x.font = `700 ${fs}px "Be Vietnam Pro", Arial, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.translate(W / 2, H / 2); x.rotate(-Math.atan2(H, W));
    const diag = Math.hypot(W, H), step = fs * 4.2;
    const unit = text + '        ', line = unit.repeat(Math.ceil(diag / Math.max(1, x.measureText(unit).width)) + 1);
    for (let y = -diag / 2, r = 0; y < diag / 2; y += step, r++) x.fillText(line, r % 2 ? fs * 2 : 0, y);
    x.restore();
    return c;
  }

  return { renderPhoto, renderAny, watermark, CARD, PHOTO, canvas, ctx2d, loadImage, blobToCanvas, scaleCanvas, toBlob, detectQuad, warp, rotate, applyFilter, adjust, applyErase, paperColor, render, renderId, FULL, INSET };
})();
