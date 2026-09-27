'use strict';
/* XLM Scan — xử lý ảnh bằng AI, chạy ngay trên máy (không gửi ảnh đi đâu)
   · Làm nét chữ ×2: ESRGAN-slim (UpscalerJS, MIT) — ~0,9 MB
   · Khử mờ rung tay: tự ước lượng vệt rung + giải chập Richardson–Lucy (không cần tải thêm)
   · Tách nền ảnh thẻ: MediaPipe Selfie Segmentation (Apache-2.0) — ~6 MB */
const Ai = (() => {
  // Thư viện & mô hình lấy từ CDN jsDelivr (gói npm chính thức), được lưu lại trên máy sau lần dùng đầu
  const CDN = 'https://cdn.jsdelivr.net/npm/';
  const U = {
    tf: CDN + '@tensorflow/tfjs@4.22.0/dist/tf.min.js',
    sr: CDN + '@upscalerjs/esrgan-slim@1.0.0/models/x2/model.json',
    mp: CDN + '@mediapipe/selfie_segmentation@0.1.1675465747/',
  };
  let T = null, sr = null, seg = null;
  async function tf() {
    if (T) return T;
    await loadScript(U.tf);
    T = window.tf;
    try { await T.setBackend('webgl'); } catch { await T.setBackend('cpu'); }
    await T.ready();
    return T;
  }
  async function srModel() { if (!sr) { await tf(); sr = await T.loadLayersModel(U.sr); } return sr; }

  /** Chạy mô hình theo từng ô vuông có chồng mép, ghép lại thành ảnh kết quả */
  async function tiled(src, run, { scale = 1, tile = 128, pad = 8, progress, label }) {
    const W = src.width, H = src.height, S = tile - 2 * pad;
    const out = Imaging.canvas(W * scale, H * scale), ox = out.getContext('2d');
    const tmp = Imaging.canvas(tile, tile), tx = Imaging.ctx2d(tmp);
    const xs = [], ys = [];
    for (let x = 0; x < W; x += S) xs.push(x);
    for (let y = 0; y < H; y += S) ys.push(y);
    const n = xs.length * ys.length; let k = 0;
    for (const y of ys) for (const x of xs) {
      const rx = Math.max(0, x - pad), ry = Math.max(0, y - pad);
      const rw = Math.min(W, x + S + pad) - rx, rh = Math.min(H, y + S + pad) - ry;
      tmp.width = rw; tmp.height = rh;
      tx.drawImage(src, rx, ry, rw, rh, 0, 0, rw, rh);
      const res = await run(tmp);                       // canvas rw*scale × rh*scale
      const iw = Math.min(S, W - x), ih = Math.min(S, H - y);
      ox.drawImage(res, (x - rx) * scale, (y - ry) * scale, iw * scale, ih * scale, x * scale, y * scale, iw * scale, ih * scale);
      k++; progress && progress(`${label}… ${Math.round(k / n * 100)}%`, k / n);
      await T.nextFrame();
    }
    return out;
  }
  async function tensorToCanvas(t) {
    const [h, w] = t.shape;
    const px = await T.browser.toPixels(t);
    const c = Imaging.canvas(w, h); c.getContext('2d').putImageData(new ImageData(px, w, h), 0, 0);
    return c;
  }

  /** AI làm nét chữ: thu nhỏ còn nửa rồi phóng ×2 bằng mô hình → nét chữ sắc, ít nhiễu */
  async function sharpen(c, maxOut, progress) {
    const m = await srModel();
    const src = Imaging.scaleCanvas(c, Math.max(64, Math.round(Math.min(maxOut || 2800, Math.max(c.width, c.height)) / 2)));
    return tiled(src, async tile => {
      const y = T.tidy(() => m.predict(T.browser.fromPixels(tile).toFloat().expandDims(0)).squeeze().clipByValue(0, 255).cast('int32'));
      const r = await tensorToCanvas(y); y.dispose(); return r;
    }, { scale: 2, tile: 128, pad: 8, progress, label: 'AI đang làm nét' });
  }

  /** Khử mờ do rung tay: tự ước lượng hướng & độ dài vệt rung rồi giải chập Richardson–Lucy trên kênh sáng.
      (Đã thử mô hình MAXIM ~86 MB nhưng quá nặng cho điện thoại nên dùng thuật toán này; có thể bật thêm AI làm nét) */
  function estimateBlur(Y, w, h) {
    const E = [];
    for (let a = 0; a < 180; a += 15) {
      const r = a * Math.PI / 180, fx = Math.cos(r) * 2, fy = Math.sin(r) * 2;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
      const w00 = (1 - ax) * (1 - ay), w10 = ax * (1 - ay), w01 = (1 - ax) * ay, w11 = ax * ay, o = y0 * w + x0;
      let s = 0, n = 0;
      for (let y = 4; y < h - 4; y += 2) for (let x = 4; x < w - 4; x += 2) {
        const i = y * w + x, k = i + o;
        s += Math.abs(w00 * Y[k] + w10 * Y[k + 1] + w01 * Y[k + w] + w11 * Y[k + w + 1] - Y[i]); n++;
      }
      E.push([a, s / n]);
    }
    E.sort((p, q) => p[1] - q[1]);
    return { angle: E[0][0], ratio: E[0][1] / E[E.length - 1][1] };
  }
  function lineTaps(angle, L) {
    const r = angle * Math.PI / 180, cx = Math.cos(r), cy = Math.sin(r), m = new Map();
    for (let k = 0; k < L; k++) {
      const t = k - (L - 1) / 2, fx = t * cx, fy = t * cy, x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
      for (const [ox, oy, wt] of [[0, 0, (1 - ax) * (1 - ay)], [1, 0, ax * (1 - ay)], [0, 1, (1 - ax) * ay], [1, 1, ax * ay]]) {
        if (wt < 1e-3) continue; const key = (x0 + ox) + ',' + (y0 + oy); m.set(key, (m.get(key) || 0) + wt);
      }
    }
    return [...m].map(([k, wt]) => { const [x, y] = k.split(',').map(Number); return [x, y, wt / L]; });
  }
  function gaussTaps(sigma) {
    const R = Math.ceil(sigma * 2.5), g = []; let sum = 0;
    for (let i = -R; i <= R; i++) { const v = Math.exp(-i * i / (2 * sigma * sigma)); g.push(v); sum += v; }
    return [g.map((v, i) => [i - R, 0, v / sum]), g.map((v, i) => [0, i - R, v / sum])];
  }
  function conv(src, w, h, passes, tmp1, tmp2) {
    let a = src;
    passes.forEach((taps, pi) => {
      const out = pi % 2 ? tmp2 : tmp1, n = taps.length;
      const DX = taps.map(t => t[0]), DY = taps.map(t => t[1]), WT = taps.map(t => t[2]);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let s = 0;
        for (let t = 0; t < n; t++) {
          let xx = x + DX[t], yy = y + DY[t];
          xx = xx < 0 ? 0 : xx >= w ? w - 1 : xx; yy = yy < 0 ? 0 : yy >= h ? h - 1 : yy;
          s += WT[t] * a[yy * w + xx];
        }
        out[y * w + x] = s;
      }
      a = out;
    });
    return a;
  }
  async function deblur(c, progress, maxSide = 1600) {
    const src = Imaging.scaleCanvas(c, maxSide), w = src.width, h = src.height;
    const out = Imaging.canvas(w, h), x = Imaging.ctx2d(out); x.drawImage(src, 0, 0);
    const id = x.getImageData(0, 0, w, h), d = id.data, N = w * h;
    const Y = new Float32Array(N);
    for (let i = 0, j = 0; i < N; i++, j += 4) Y[i] = (0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]) / 255 + 0.01;
    const { angle, ratio } = estimateBlur(Y, w, h);
    const scale = Math.max(w, h) / 1600;
    const passes = ratio < 0.75
      ? [lineTaps(angle, Math.max(3, Math.min(17, Math.round((3 + (0.8 - ratio) * 30) * scale))))]
      : gaussTaps(Math.max(0.8, 1.0 * scale));
    const u = Float32Array.from(Y), t1 = new Float32Array(N), t2 = new Float32Array(N), rb = new Float32Array(N);
    const IT = 12;
    for (let it = 0; it < IT; it++) {
      progress && progress(`Đang khử mờ rung tay… ${Math.round(it / IT * 100)}%`, it / IT);
      await new Promise(r => setTimeout(r, 0));
      const est = conv(u, w, h, passes, t1, t2);
      for (let i = 0; i < N; i++) { const q = Y[i] / Math.max(est[i], 1e-3); rb[i] = q < 0.5 ? 0.5 : q > 2 ? 2 : q; }
      const corr = conv(rb, w, h, passes, t1, t2);
      for (let i = 0; i < N; i++) { const v = u[i] * corr[i]; u[i] = v < 0.01 ? 0.01 : v > 1.01 ? 1.01 : v; }
    }
    for (let i = 0, j = 0; i < N; i++, j += 4) {
      const dv = (u[i] - Y[i]) * 255;
      d[j] += dv; d[j + 1] += dv; d[j + 2] += dv;
    }
    x.putImageData(id, 0, 0);
    out.blurInfo = { angle, ratio: +ratio.toFixed(2), taps: passes.map(p => p.length) };
    return out;
  }

  /** AI tách người khỏi phông, thay bằng nền màu */
  async function segmenter() {
    if (seg) return seg;
    await loadScript(U.mp + 'selfie_segmentation.js');
    seg = new SelfieSegmentation({ locateFile: f => U.mp + f });
    seg.setOptions({ modelSelection: 0, selfieMode: false });
    await seg.initialize();
    return seg;
  }
  const BG = { white: '#FFFFFF', blue: '#3D7FD6', gray: '#E6E8EB' };
  async function replaceBg(c, bg) {
    if (!bg || !BG[bg]) return c;
    const s = await segmenter();
    const mask = await new Promise((res, rej) => { s.onResults(r => res(r.segmentationMask)); s.send({ image: c }).catch(rej); });
    const w = c.width, h = c.height;
    const out = Imaging.canvas(w, h), x = out.getContext('2d');
    x.filter = `blur(${Math.max(1, Math.round(w / 300))}px)`; // mép tóc mềm hơn
    x.drawImage(mask, 0, 0, w, h); x.filter = 'none';
    x.globalCompositeOperation = 'source-in'; x.drawImage(c, 0, 0);
    x.globalCompositeOperation = 'destination-over'; x.fillStyle = BG[bg]; x.fillRect(0, 0, w, h);
    return out;
  }
  return { sharpen, deblur, replaceBg, BG };
})();
