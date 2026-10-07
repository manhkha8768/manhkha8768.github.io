/* XLM Scan – lõi xử lý ảnh thuần (chạy được cả ở trang và Web Worker)
   - Nhận diện tài liệu: Canny + Hough + chấm điểm cạnh, kết hợp phân vùng sáng
   - Nắn phối cảnh (homography, nội suy song tuyến)
   - Khử bóng/chuẩn hoá nền (đóng hình thái học + chia nền)
   - Bộ lọc: Nâng cao, Không bóng, Bảng trắng, Xám, Đen trắng (Sauvola), Tiết kiệm mực, Xoá bút màu
   - Làm nét (unsharp), tự làm thẳng dòng chữ (projection profile), đo độ nét (Laplacian) */
'use strict';
const IPC = (() => {
  const OPT = { hiMin: 15, hiP: 0.8, hiK: 0.5, loK: 0.4, blur: 1, close: 2 };
  const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

  /* ---------------- tiện ích mảng ---------------- */
  function gray(d, n) {
    const g = new Float32Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
    return g;
  }
  function boxBlur(src, w, h, r) {
    if (r < 1) return Float32Array.from(src);
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h), d = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      const o = y * w; let acc = 0;
      for (let x = -r; x <= r; x++) acc += src[o + (x < 0 ? 0 : x >= w ? w - 1 : x)];
      for (let x = 0; x < w; x++) {
        tmp[o + x] = acc / d;
        const xa = x + r + 1, xs = x - r;
        acc += src[o + (xa >= w ? w - 1 : xa)] - src[o + (xs < 0 ? 0 : xs)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[(y < 0 ? 0 : y >= h ? h - 1 : y) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc / d;
        const ya = y + r + 1, ys = y - r;
        acc += tmp[(ya >= h ? h - 1 : ya) * w + x] - tmp[(ys < 0 ? 0 : ys) * w + x];
      }
    }
    return out;
  }
  const gauss = (src, w, h, r) => boxBlur(boxBlur(boxBlur(src, w, h, r), w, h, r), w, h, r);
  /* lọc max/min tách được (hình thái học) */
  function morph(src, w, h, r, isMax) {
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    const pick = isMax ? Math.max : Math.min;
    for (let y = 0; y < h; y++) {
      const o = y * w;
      for (let x = 0; x < w; x++) {
        let v = src[o + x];
        for (let k = Math.max(0, x - r), e = Math.min(w - 1, x + r); k <= e; k++) v = pick(v, src[o + k]);
        tmp[o + x] = v;
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        let v = tmp[y * w + x];
        for (let k = Math.max(0, y - r), e = Math.min(h - 1, y + r); k <= e; k++) v = pick(v, tmp[k * w + x]);
        out[y * w + x] = v;
      }
    }
    return out;
  }
  function percentile(g, p, step = 1) {
    const hist = new Uint32Array(256); let n = 0;
    for (let i = 0; i < g.length; i += step) { hist[clamp255(g[i] | 0)]++; n++; }
    let acc = 0, target = n * p;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= target) return i; }
    return 255;
  }
  function otsu(g) {
    const hist = new Array(256).fill(0);
    for (let i = 0; i < g.length; i++) hist[clamp255(g[i] | 0)]++;
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

  /* ---------------- hình học ---------------- */
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
      if (Math.abs(z) < 1e-9) return false;
      if (sign && Math.sign(z) !== sign) return false;
      sign = Math.sign(z);
    }
    return true;
  }
  /* sắp xếp 4 điểm thành [tl,tr,br,bl] */
  function orderQuad(pts) {
    const c = [pts.reduce((s, p) => s + p[0], 0) / 4, pts.reduce((s, p) => s + p[1], 0) / 4];
    const s = pts.slice().sort((a, b) => Math.atan2(a[1] - c[1], a[0] - c[0]) - Math.atan2(b[1] - c[1], b[0] - c[0]));
    // s theo chiều kim đồng hồ bắt đầu từ góc trái-trên (góc âm lớn nhất)
    let k = 0, best = Infinity;
    s.forEach((p, i) => { const v = p[0] + p[1]; if (v < best) { best = v; k = i; } });
    return [s[k], s[(k + 1) % 4], s[(k + 2) % 4], s[(k + 3) % 4]];
  }
  function minAngleOK(q) {
    for (let i = 0; i < 4; i++) {
      const a = q[(i + 3) % 4], b = q[i], c = q[(i + 1) % 4];
      const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
      const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2) + 1e-9);
      const ang = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
      if (ang < 45 || ang > 135) return false;
    }
    return true;
  }

  /* ---------------- Canny ---------------- */
  function canny(g, w, h) {
    const n = w * h, mag = new Float32Array(n), dir = new Uint8Array(n);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1] + g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1];
      const gy = -g[i - w - 1] - 2 * g[i - w] - g[i - w + 1] + g[i + w - 1] + 2 * g[i + w] + g[i + w + 1];
      mag[i] = Math.hypot(gx, gy);
      let a = Math.atan2(gy, gx) * 180 / Math.PI; if (a < 0) a += 180;
      dir[i] = a < 22.5 || a >= 157.5 ? 0 : a < 67.5 ? 1 : a < 112.5 ? 2 : 3;
    }
    const nms = new Float32Array(n);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, m = mag[i];
      if (!m) continue;
      let a, b;
      switch (dir[i]) {
        case 0: a = mag[i - 1]; b = mag[i + 1]; break;
        case 1: a = mag[i - w - 1]; b = mag[i + w + 1]; break;
        case 2: a = mag[i - w]; b = mag[i + w]; break;
        default: a = mag[i - w + 1]; b = mag[i + w - 1];
      }
      if (m >= a && m >= b) nms[i] = m;
    }
    // ngưỡng tự động theo phân vị độ lớn gradient
    const sample = [];
    for (let i = 0; i < n; i += 7) if (nms[i] > 0) sample.push(nms[i]);
    sample.sort((a, b) => a - b);
    const hi = Math.max(OPT.hiMin, sample.length ? sample[Math.floor(sample.length * OPT.hiP)] * OPT.hiK : 80), lo = hi * OPT.loK;
    const e = new Uint8Array(n), st = new Int32Array(n);
    let sp = 0;
    for (let i = 0; i < n; i++) if (nms[i] >= hi) { e[i] = 1; st[sp++] = i; }
    while (sp) {
      const i = st[--sp];
      for (const o of [-w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1]) {
        const j = i + o;
        if (j > 0 && j < n && !e[j] && nms[j] >= lo) { e[j] = 1; st[sp++] = j; }
      }
    }
    return e;
  }

  /* ---------------- Hough ---------------- */
  const NT = 180, COS = new Float32Array(NT), SIN = new Float32Array(NT);
  for (let t = 0; t < NT; t++) { COS[t] = Math.cos((t * Math.PI) / NT); SIN[t] = Math.sin((t * Math.PI) / NT); }
  function hough(e, w, h, maxLines = 40) {
    const R = Math.ceil(Math.hypot(w, h)), NR = 2 * R + 1, acc = new Uint16Array(NT * NR);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!e[y * w + x]) continue;
      for (let t = 0; t < NT; t++) acc[t * NR + Math.round(x * COS[t] + y * SIN[t]) + R]++;
    }
    const minV = Math.max(20, Math.min(w, h) * 0.12), cands = [];
    for (let t = 0; t < NT; t++) for (let r = 0; r < NR; r++) {
      const v = acc[t * NR + r];
      if (v < minV) continue;
      let isMax = true;
      for (let dt = -3; dt <= 3 && isMax; dt++) for (let dr = -6; dr <= 6; dr++) {
        if (!dt && !dr) continue;
        const tt = (t + dt + NT) % NT, rr = dt + t < 0 || dt + t >= NT ? NR - 1 - (r + dr) : r + dr;
        if (rr < 0 || rr >= NR) continue;
        if (acc[tt * NR + rr] > v) { isMax = false; break; }
      }
      if (isMax) cands.push({ t, rho: r - R, v });
    }
    cands.sort((a, b) => b.v - a.v);
    return cands.slice(0, maxLines);
  }
  function intersect(l1, l2) {
    const a1 = COS[l1.t], b1 = SIN[l1.t], a2 = COS[l2.t], b2 = SIN[l2.t];
    const det = a1 * b2 - a2 * b1;
    if (Math.abs(det) < 1e-6) return null;
    return [(l1.rho * b2 - l2.rho * b1) / det, (a1 * l2.rho - a2 * l1.rho) / det];
  }
  /* tỉ lệ điểm trên cạnh trùng với biên (đã nới 1px) */
  function sideSupport(ed, w, h, a, b) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), N = Math.max(12, Math.min(80, L | 0));
    let hit = 0, tot = 0;
    for (let k = 1; k < N; k++) {
      const x = Math.round(a[0] + ((b[0] - a[0]) * k) / N), y = Math.round(a[1] + ((b[1] - a[1]) * k) / N);
      if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) { tot += 1; hit += 0.55; continue; } // cạnh nằm ở mép khung ảnh
      tot++;
      if (ed[y * w + x]) hit++;
    }
    return hit / tot;
  }
  function scoreQuad(ed, w, h, q) {
    if (!isConvex(q) || !minAngleOK(q)) return -1;
    const area = quadArea(q) / (w * h);
    if (area < 0.12 || area > 1.02) return -1;
    let s = 0, mn = 1;
    for (let i = 0; i < 4; i++) { const v = sideSupport(ed, w, h, q[i], q[(i + 1) % 4]); s += v; mn = Math.min(mn, v); }
    return (s / 4) * 0.7 + mn * 0.3 + area * 0.25;
  }
  /* phương án phân vùng giấy sáng (dự phòng khi cạnh yếu) */
  function segmentQuad(d, w, h) {
    const n = w * h, g = new Float32Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const r = d[j], gg = d[j + 1], b = d[j + 2], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      g[i] = 0.299 * r + 0.587 * gg + 0.114 * b - 0.35 * (mx - mn);
    }
    const bl = boxBlur(g, w, h, 2);
    const t = otsu(bl);
    let m = new Uint8Array(n);
    for (let i = 0; i < n; i++) m[i] = bl[i] > t ? 1 : 0;
    for (let k = 0; k < 2; k++) {
      const m2 = new Uint8Array(n);
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; m2[i] = m[i] & m[i - 1] & m[i + 1] & m[i - w] & m[i + w]; }
      m = m2;
    }
    const lab = new Int32Array(n), st = new Int32Array(n);
    let best = null, label = 0;
    for (let s0 = 0; s0 < n; s0++) {
      if (!m[s0] || lab[s0]) continue;
      label++; let sp = 0; st[sp++] = s0; lab[s0] = label;
      let size = 0, a = Infinity, b = -Infinity, c = -Infinity, dd = Infinity, sx = 0, sy = 0;
      const P = [0, 0, 0, 0];
      while (sp) {
        const i = st[--sp], x = i % w, y = (i / w) | 0;
        size++; sx += x; sy += y;
        const s1 = x + y, s2 = x - y;
        if (s1 < a) { a = s1; P[0] = i; } if (s2 > c) { c = s2; P[1] = i; }
        if (s1 > b) { b = s1; P[2] = i; } if (s2 < dd) { dd = s2; P[3] = i; }
        if (x > 0 && m[i - 1] && !lab[i - 1]) { lab[i - 1] = label; st[sp++] = i - 1; }
        if (x < w - 1 && m[i + 1] && !lab[i + 1]) { lab[i + 1] = label; st[sp++] = i + 1; }
        if (y > 0 && m[i - w] && !lab[i - w]) { lab[i - w] = label; st[sp++] = i - w; }
        if (y < h - 1 && m[i + w] && !lab[i + w]) { lab[i + w] = label; st[sp++] = i + w; }
      }
      const dist = Math.hypot(sx / size - w / 2, sy / size - h / 2) / Math.hypot(w / 2, h / 2);
      const sc = size * (1.2 - dist);
      if (!best || sc > best.sc) best = { sc, size, P };
    }
    if (!best || best.size < n * 0.08) return null;
    const q = best.P.map((i) => [i % w, (i / w) | 0]);
    const cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4;
    for (const p of q) { const dx = p[0] - cx, dy = p[1] - cy, L = Math.hypot(dx, dy) || 1; p[0] += (dx / L) * 2.5; p[1] += (dy / L) * 2.5; }
    return q;
  }
  /* tinh chỉnh từng cạnh: dịch song song ±3px để khớp biên nhất */
  function refineQuad(ed, w, h, q) {
    q = q.map((p) => p.slice());
    for (let iter = 0; iter < 2; iter++) for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4];
      const nx = -(b[1] - a[1]), ny = b[0] - a[0], L = Math.hypot(nx, ny) || 1;
      let bestS = sideSupport(ed, w, h, a, b), bestD = 0;
      for (let dd = -3; dd <= 3; dd++) {
        if (!dd) continue;
        const s = sideSupport(ed, w, h, [a[0] + (nx / L) * dd, a[1] + (ny / L) * dd], [b[0] + (nx / L) * dd, b[1] + (ny / L) * dd]);
        if (s > bestS + 0.02) { bestS = s; bestD = dd; }
      }
      if (bestD) { a[0] += (nx / L) * bestD; a[1] += (ny / L) * bestD; b[0] += (nx / L) * bestD; b[1] += (ny / L) * bestD; }
    }
    return q;
  }
  /* Nhận diện tài liệu trên ảnh nhỏ (~400–520px). Trả về {quad, score} hoặc null */
  function detect(d, w, h) {
    const n = w * h, T0 = Date.now(), TT = (m) => OPT.debug && console.log(m, Date.now() - T0);
    let g = gray(d, n);
    // đóng hình thái học: xoá chữ tối bên trong giấy, giữ biên tờ giấy
    if (OPT.close) g = morph(morph(g, w, h, OPT.close, true), w, h, OPT.close, false);
    g = gauss(g, w, h, OPT.blur);
    const e = canny(g, w, h);
    // biên nới 1px để chấm điểm
    const ed = new Uint8Array(n);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (e[i] | e[i - 1] | e[i + 1] | e[i - w] | e[i + w] | e[i - w - 1] | e[i - w + 1] | e[i + w - 1] | e[i + w + 1]) ed[i] = 1;
    }
    TT('canny');
    const lines = hough(e, w, h, 48);
    TT('hough');
    const H = [], V = [];
    for (const l of lines) {
      const deg = (l.t * 180) / NT;
      if (deg > 50 && deg < 130) H.push(l); else if (deg < 40 || deg > 140) V.push(l);
    }
    // thêm 4 đường mép khung ảnh (khi giấy tràn khung)
    H.push({ t: 90, rho: 1, v: 0, border: 1 }, { t: 90, rho: h - 2, v: 0, border: 1 });
    V.push({ t: 0, rho: 1, v: 0, border: 1 }, { t: 0, rho: w - 2, v: 0, border: 1 });
    const Hs = H.slice(0, 14), Vs = V.slice(0, 14);
    if (!Hs.find((l) => l.border)) Hs.push(...H.filter((l) => l.border));
    if (!Vs.find((l) => l.border)) Vs.push(...V.filter((l) => l.border));
    let best = null;
    const nH = Hs.length, nV = Vs.length;
    // giao điểm H×V tính một lần
    const X = [];
    for (let i = 0; i < nH; i++) { X[i] = []; for (let k = 0; k < nV; k++) X[i][k] = intersect(Hs[i], Vs[k]); }
    const inside = (p) => p && p[0] > -w * 0.04 && p[1] > -h * 0.04 && p[0] < w * 1.04 && p[1] < h * 1.04;
    const cl = (p) => [Math.max(0, Math.min(w - 1, p[0])), Math.max(0, Math.min(h - 1, p[1]))];
    const cache = new Map();
    const sup = (key, a, b) => { let v = cache.get(key); if (v === undefined) { v = sideSupport(ed, w, h, a, b); cache.set(key, v); } return v; };
    const minA = 0.12 * w * h;
    for (let i = 0; i < nH; i++) for (let j = i + 1; j < nH; j++) {
      for (let k = 0; k < nV; k++) {
        const p1 = X[i][k], p2 = X[j][k];
        if (!inside(p1) || !inside(p2)) continue;
        for (let l = k + 1; l < nV; l++) {
          if (Hs[i].border && Hs[j].border && Vs[k].border && Vs[l].border) continue;
          const p3 = X[i][l], p4 = X[j][l];
          if (!inside(p3) || !inside(p4)) continue;
          // xác định trên/dưới, trái/phải
          const topI = (p1[1] + p3[1]) <= (p2[1] + p4[1]);
          const lk = (p1[0] + p2[0]) <= (p3[0] + p4[0]);
          const T = topI ? i : j, B = topI ? j : i, Lf = lk ? k : l, Rt = lk ? l : k;
          const q = [cl(X[T][Lf]), cl(X[T][Rt]), cl(X[B][Rt]), cl(X[B][Lf])];
          if (quadArea(q) < minA || !isConvex(q) || !minAngleOK(q)) continue;
          const st = sup('h' + T + '_' + Lf + '_' + Rt, q[0], q[1]), sr = sup('v' + Rt + '_' + T + '_' + B, q[1], q[2]);
          const sb = sup('h' + B + '_' + Lf + '_' + Rt, q[3], q[2]), sl = sup('v' + Lf + '_' + T + '_' + B, q[0], q[3]);
          const mn = Math.min(st, sr, sb, sl);
          if (mn < 0.25) continue;
          const sc = ((st + sr + sb + sl) / 4) * 0.7 + mn * 0.3 + (quadArea(q) / (w * h)) * 0.25;
          if (!best || sc > best.score) best = { quad: q, score: sc };
        }
      }
    }
    TT('enum');
    const sq = segmentQuad(d, w, h);
    TT('seg');
    if (sq) {
      const q = orderQuad(sq), s = scoreQuad(ed, w, h, q);
      if (s > 0 && (!best || s > best.score - 0.05)) best = { quad: q, score: Math.max(s, best ? best.score : 0) };
    }
    if (!best || best.score < 0.72) return null;
    best.quad = refineQuad(ed, w, h, best.quad);
    return best;
  }
  /* độ nét: phương sai Laplacian trên ảnh xám nhỏ */
  function sharpness(d, w, h) {
    const g = gray(d, w * h);
    let s = 0, s2 = 0, n = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, v = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
      s += v; s2 += v * v; n++;
    }
    const m = s / n;
    return s2 / n - m * m;
  }

  /* ---------------- nắn phối cảnh ---------------- */
  function solve(A, b) {
    const n = b.length;
    for (let i = 0; i < n; i++) {
      let p = i;
      for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k;
      [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
      for (let k = i + 1; k < n; k++) { const f = A[k][i] / A[i][i]; for (let j = i; j < n; j++) A[k][j] -= f * A[i][j]; b[k] -= f * b[i]; }
    }
    const x = new Array(n);
    for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j]; x[i] = s / A[i][i]; }
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
  /* kích thước đầu ra: ước lượng tỉ lệ thật từ hình chiếu (bù phối cảnh) */
  function outSize(q, maxSide, aspect) {
    let ow = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2, oh = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
    const mw = Math.max(dist(q[0], q[1]), dist(q[3], q[2])), mh = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
    const k = Math.max(mw / ow, mh / oh); ow *= k; oh *= k;
    if (aspect) { if (ow >= oh) oh = ow / aspect; else ow = oh / aspect; }
    // bắt dính khổ A4 nếu gần đúng (±6%)
    if (!aspect) {
      const r = Math.max(ow, oh) / Math.min(ow, oh);
      if (Math.abs(r - 1.4142) / 1.4142 < 0.06) { if (ow > oh) oh = ow / 1.4142; else ow = oh / 1.4142; }
    }
    const s = Math.min(1, maxSide / Math.max(ow, oh));
    return [Math.max(1, Math.round(ow * s)), Math.max(1, Math.round(oh * s))];
  }
  function warp(sd, sw, sh, q, ow, oh) {
    const o = new Uint8ClampedArray(ow * oh * 4);
    const [a, b, c, d, e, f, g, hh] = homography([[0, 0], [ow, 0], [ow, oh], [0, oh]], q);
    let k = 0;
    for (let y = 0; y < oh; y++) {
      const yy = y + 0.5;
      for (let x = 0; x < ow; x++, k += 4) {
        const xx = x + 0.5, den = g * xx + hh * yy + 1;
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
    return o;
  }
  /* xoay góc nhỏ quanh tâm, nền trắng */
  function rotateSmall(d, w, h, deg) {
    const o = new Uint8ClampedArray(w * h * 4), r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
    const cx = w / 2, cy = h / 2;
    let k = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++, k += 4) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const u = c * dx + s * dy + cx - 0.5, v = -s * dx + c * dy + cy - 0.5;
      if (u < 0 || v < 0 || u > w - 1.001 || v > h - 1.001) { o[k] = o[k + 1] = o[k + 2] = o[k + 3] = 255; continue; }
      const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0, i = (y0 * w + x0) * 4, j = i + w * 4;
      for (let ch = 0; ch < 3; ch++) o[k + ch] = (d[i + ch] * (1 - fx) + d[i + 4 + ch] * fx) * (1 - fy) + (d[j + ch] * (1 - fx) + d[j + 4 + ch] * fx) * fy;
      o[k + 3] = 255;
    }
    return o;
  }
  /* góc nghiêng dòng chữ (độ) bằng projection profile */
  function skewAngle(d, w, h) {
    const sc = Math.min(1, 700 / Math.max(w, h)), sw = Math.max(1, (w * sc) | 0), sh = Math.max(1, (h * sc) | 0);
    const pts = [];
    const g = gray(d, w * h);
    // lấy mẫu điểm tối (chữ)
    const thr = Math.min(150, percentile(g, 0.08, 3) + 25);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      const v = g[((y / sc) | 0) * w + ((x / sc) | 0)];
      if (v < thr) pts.push(x, y);
    }
    if (pts.length < 400 || pts.length > sw * sh * 0.4) return 0;
    const score = (deg) => {
      const r = (deg * Math.PI) / 180, s = Math.sin(r), c = Math.cos(r), H = new Float32Array(sh * 2 + sw);
      for (let i = 0; i < pts.length; i += 2) { const yy = (-pts[i] * s + pts[i + 1] * c + sw) | 0; H[yy]++; }
      let e = 0; for (let i = 1; i < H.length; i++) { const dd = H[i] - H[i - 1]; e += dd * dd; }
      return e;
    };
    let best = 0, bs = score(0);
    for (let a = -6; a <= 6; a += 0.5) { const s = score(a); if (s > bs) { bs = s; best = a; } }
    for (let a = best - 0.5; a <= best + 0.5; a += 0.1) { const s = score(a); if (s > bs) { bs = s; best = a; } }
    return Math.abs(best) < 0.5 || Math.abs(best) > 5.9 ? 0 : Math.round(best * 10) / 10;
  }

  /* ---------------- khử bóng / chuẩn hoá nền ---------------- */
  function backgroundModel(d, w, h) {
    const f = Math.max(4, Math.round(Math.max(w, h) / 180));
    const bw = Math.ceil(w / f), bh = Math.ceil(h / f), N = bw * bh;
    const ch = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
    // lấy điểm sáng nhất mỗi ô (màu giấy, bỏ qua chữ)
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      const y1 = Math.min(h, (by + 1) * f), x1 = Math.min(w, (bx + 1) * f);
      let mr = 0, mg = 0, mb = 0;
      for (let y = by * f; y < y1; y += 2) for (let x = bx * f; x < x1; x += 2) {
        const i = (y * w + x) * 4;
        if (d[i] + d[i + 1] + d[i + 2] > mr + mg + mb) { mr = d[i]; mg = d[i + 1]; mb = d[i + 2]; }
      }
      const j = by * bw + bx; ch[0][j] = mr; ch[1][j] = mg; ch[2][j] = mb;
    }
    // đóng hình thái học (xoá nét chữ còn sót) rồi làm mượt
    const rad = 2;
    const out = ch.map((c) => gauss(morph(morph(c, bw, bh, rad, true), bw, bh, rad, false), bw, bh, 2));
    return { f, bw, bh, c: out };
  }
  function normalize(d, w, h) {
    const bg = backgroundModel(d, w, h), { f, bw, bh } = bg, [R, G, B] = bg.c;
    for (let y = 0; y < h; y++) {
      let v = y / f - 0.5; if (v < 0) v = 0; if (v > bh - 1.001) v = Math.max(0, bh - 1.001);
      const y0 = v | 0, fy = v - y0, y1 = Math.min(bh - 1, y0 + 1);
      for (let x = 0; x < w; x++) {
        let u = x / f - 0.5; if (u < 0) u = 0; if (u > bw - 1.001) u = Math.max(0, bw - 1.001);
        const x0 = u | 0, fx = u - x0, x1 = Math.min(bw - 1, x0 + 1);
        const a = y0 * bw + x0, b = y0 * bw + x1, c = y1 * bw + x0, e = y1 * bw + x1;
        const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
        const i = (y * w + x) * 4;
        const br = Math.max(50, R[a] * w00 + R[b] * w10 + R[c] * w01 + R[e] * w11);
        const bgc = Math.max(50, G[a] * w00 + G[b] * w10 + G[c] * w01 + G[e] * w11);
        const bb = Math.max(50, B[a] * w00 + B[b] * w10 + B[c] * w01 + B[e] * w11);
        d[i] = clamp255((d[i] * 255) / br); d[i + 1] = clamp255((d[i + 1] * 255) / bgc); d[i + 2] = clamp255((d[i + 2] * 255) / bb);
      }
    }
  }
  /* kéo giãn mức đen/trắng theo phân vị + gamma */
  function levels(d, n, loP, hiP, gamma) {
    const L = new Float32Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) L[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
    const lo = Math.min(percentile(L, loP, 5), 90), hi = Math.max(lo + 60, percentile(L, hiP, 5));
    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) { const t = Math.max(0, Math.min(1, (i - lo) / (hi - lo))); lut[i] = 255 * Math.pow(t, gamma); }
    for (let j = 0; j < n * 4; j += 4) { d[j] = lut[d[j]]; d[j + 1] = lut[d[j + 1]]; d[j + 2] = lut[d[j + 2]]; }
  }
  function saturate(d, n, s) {
    for (let j = 0; j < n * 4; j += 4) {
      const l = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
      d[j] = clamp255(l + (d[j] - l) * s); d[j + 1] = clamp255(l + (d[j + 1] - l) * s); d[j + 2] = clamp255(l + (d[j + 2] - l) * s);
    }
  }
  /* làm nét theo độ sáng (unsharp mask) */
  function unsharp(d, w, h, amount, r) {
    const n = w * h, L = gray(d, n), B = boxBlur(boxBlur(L, w, h, r), w, h, r);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const dd = (L[i] - B[i]) * amount;
      if (dd > -2 && dd < 2) continue;
      d[j] = clamp255(d[j] + dd); d[j + 1] = clamp255(d[j + 1] + dd); d[j + 2] = clamp255(d[j + 2] + dd);
    }
  }
  /* nhị phân Sauvola + khử nhiễu chấm */
  function sauvola(g, w, h, k = 0.25, ink = 0) {
    const W1 = w + 1, I = new Float64Array(W1 * (h + 1)), I2 = new Float64Array(W1 * (h + 1));
    for (let y = 0; y < h; y++) {
      let s = 0, s2 = 0;
      for (let x = 0; x < w; x++) {
        const v = g[y * w + x]; s += v; s2 += v * v;
        I[(y + 1) * W1 + x + 1] = I[y * W1 + x + 1] + s; I2[(y + 1) * W1 + x + 1] = I2[y * W1 + x + 1] + s2;
      }
    }
    const r = Math.max(7, Math.round(Math.min(w, h) / 50)), out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), cnt = (y1 - y0) * (x1 - x0);
        const sum = I[y1 * W1 + x1] - I[y0 * W1 + x1] - I[y1 * W1 + x0] + I[y0 * W1 + x0];
        const sum2 = I2[y1 * W1 + x1] - I2[y0 * W1 + x1] - I2[y1 * W1 + x0] + I2[y0 * W1 + x0];
        const m = sum / cnt, sd = Math.sqrt(Math.max(0, sum2 / cnt - m * m));
        const t = m * (1 + k * (sd / 128 - 1));
        const v = g[y * w + x];
        out[y * w + x] = v < t && v < 225 ? 1 : 0; // 1 = mực
      }
    }
    // khử chấm đơn lẻ
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!out[i]) continue;
      const nb = out[i - 1] + out[i + 1] + out[i - w] + out[i + w] + out[i - w - 1] + out[i - w + 1] + out[i + w - 1] + out[i + w + 1];
      if (nb === 0) out[i] = 0;
    }
    return out;
  }

  /* ---------------- bộ lọc tổng ---------------- */
  function filter(d, w, h, name) {
    const n = w * h;
    if (!name || name === 'orig') return;
    if (name === 'bright') {
      for (let j = 0; j < n * 4; j += 4) for (let c = 0; c < 3; c++) d[j + c] = clamp255((d[j + c] - 128) * 1.22 + 150);
      unsharp(d, w, h, 0.5, 1);
      return;
    }
    normalize(d, w, h);
    const big = Math.max(w, h) > 1200, ur = big ? 2 : 1;
    switch (name) {
      case 'magic':
        levels(d, n, 0.004, 0.6, 1.35); saturate(d, n, 1.3); unsharp(d, w, h, 0.7, ur); break;
      case 'noshadow':
        levels(d, n, 0.002, 0.7, 1.1); unsharp(d, w, h, 0.4, ur); break;
      case 'wb':
        levels(d, n, 0.01, 0.5, 1.5); saturate(d, n, 1.7); unsharp(d, w, h, 0.6, ur); break;
      case 'gray': {
        const g = gray(d, n);
        for (let i = 0, j = 0; i < n; i++, j += 4) d[j] = d[j + 1] = d[j + 2] = g[i];
        levels(d, n, 0.004, 0.6, 1.4); unsharp(d, w, h, 0.7, ur); break;
      }
      case 'bw': case 'eco': {
        const g = gray(d, n), b = sauvola(g, w, h, 0.22), ink = name === 'eco' ? 110 : 0;
        for (let i = 0, j = 0; i < n; i++, j += 4) d[j] = d[j + 1] = d[j + 2] = b[i] ? ink : 255;
        break;
      }
      case 'nohand': {
        for (let j = 0; j < n * 4; j += 4) {
          const r = d[j], g = d[j + 1], b = d[j + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
          const sat = mx ? (mx - mn) / mx : 0;
          // nét bút màu (xanh, đỏ, tím…) có độ bão hoà cao -> xoá
          const v = sat > 0.28 && mx - mn > 32 ? 255 : 0.299 * r + 0.587 * g + 0.114 * b;
          d[j] = d[j + 1] = d[j + 2] = v;
        }
        levels(d, n, 0.004, 0.6, 1.4); unsharp(d, w, h, 0.6, ur); break;
      }
      default: break;
    }
  }
  function adjust(d, n, adj) {
    if (!adj || (!adj.b && !adj.c)) return;
    const k = 1 + adj.c / 60, off = adj.b * 1.6, lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) lut[i] = (i - 128) * k + 128 + off;
    for (let j = 0; j < n * 4; j += 4) { d[j] = lut[d[j]]; d[j + 1] = lut[d[j + 1]]; d[j + 2] = lut[d[j + 2]]; }
  }
  function crop(d, w, h, x0, x1) {
    const nw = x1 - x0, o = new Uint8ClampedArray(nw * h * 4);
    for (let y = 0; y < h; y++) o.set(d.subarray((y * w + x0) * 4, (y * w + x1) * 4), y * nw * 4);
    return o;
  }
  /* toàn bộ chuỗi xử lý một trang */
  function process(p) {
    let { sd, sw, sh, quad, maxSide, aspect, filterName, adj, half, deskew } = p;
    const full = Math.abs(quad[0][0]) < 1 && Math.abs(quad[0][1]) < 1 && Math.abs(quad[2][0] - sw) < 1.5 && Math.abs(quad[2][1] - sh) < 1.5 && Math.abs(quad[1][0] - sw) < 1.5 && Math.abs(quad[3][1] - sh) < 1.5;
    let [ow, oh] = full ? (() => { const s = Math.min(1, maxSide / Math.max(sw, sh)); return [Math.round(sw * s), Math.round(sh * s)]; })() : outSize(quad, maxSide, aspect);
    let d = full && ow === sw ? new Uint8ClampedArray(sd) : warp(sd, sw, sh, full ? [[0, 0], [sw, 0], [sw, sh], [0, sh]] : quad, ow, oh);
    if (half === 'L' || half === 'R') {
      const m = ow >> 1;
      d = half === 'L' ? crop(d, ow, oh, 0, m) : crop(d, ow, oh, m, ow);
      ow = half === 'L' ? m : ow - m;
    }
    let angle = 0;
    if (deskew === 'auto') angle = skewAngle(d, ow, oh);
    else if (typeof deskew === 'number') angle = deskew;
    if (angle) d = rotateSmall(d, ow, oh, angle);
    filter(d, ow, oh, filterName);
    // làm sạch viền: xoá dải nền bàn còn sót ở mép trang sau khi cắt
    if (!full && filterName && filterName !== 'orig' && filterName !== 'bright') {
      const m = Math.max(2, Math.round(Math.min(ow, oh) * 0.006));
      for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
        if (y >= m && y < oh - m && x === m) x = ow - m;
        const i = (y * ow + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255;
      }
    }
    adjust(d, ow * oh, adj);
    return { d, w: ow, h: oh, angle };
  }
  return { OPT, detect, sharpness, process, filter, adjust, warp, outSize, quadArea, isConvex, skewAngle, orderQuad };
})();
if (typeof self !== 'undefined' && typeof window === 'undefined') {
  /* chế độ Web Worker */
  self.onmessage = (ev) => {
    const { id, op, args } = ev.data;
    try {
      if (op === 'process') {
        const r = IPC.process({ ...args, sd: new Uint8ClampedArray(args.sd) });
        self.postMessage({ id, ok: true, res: { d: r.d.buffer, w: r.w, h: r.h, angle: r.angle } }, [r.d.buffer]);
      } else if (op === 'detect') {
        const r = IPC.detect(new Uint8ClampedArray(args.d), args.w, args.h);
        self.postMessage({ id, ok: true, res: r });
      }
    } catch (e) { self.postMessage({ id, ok: false, err: String(e && e.message || e) }); }
  };
}
