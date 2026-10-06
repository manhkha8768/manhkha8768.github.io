/* XLM Scan – quy trình quét: camera → cắt góc → bộ lọc → lưu */
'use strict';
const FILTERS = [['orig', 'Gốc'], ['magic', 'Nâng cao'], ['noshadow', 'Không bóng'], ['bright', 'Làm sáng'], ['gray', 'Thang xám'], ['bw', 'Đen trắng'], ['eco', 'Tiết kiệm mực'], ['nohand', 'Xoá bút màu']];
const ID_ASPECT = 85.6 / 54;
const maxSideFor = () => (S.quality === 'high' ? 2400 : S.quality === 'med' ? 1800 : 1400);

async function makeItem(blob, mode, opts, hintQuad) {
  const norm = await IP.normalizeOriginal(blob, 2600);
  let quad = null;
  if (mode !== 'photo') {
    const bmp = await IP.load(norm.blob);
    quad = IP.detect(bmp, 480);
    if (bmp.close) bmp.close();
  }
  if (!quad && hintQuad) quad = hintQuad(norm.w, norm.h);
  if (!quad) quad = IP.fullQuad(norm.w, norm.h);
  return {
    orig: norm.blob, w: norm.w, h: norm.h, quad,
    filter: mode === 'photo' ? 'orig' : opts.filter || S.defFilter, rot: 0,
    aspect: mode === 'id' ? ID_ASPECT : null,
  };
}

/* ================= CAMERA ================= */
async function openCamera(opts = {}) {
  let mode = opts.mode || 'doc';
  const items = [];
  let stream = null, track = null, timer = null, closed = false, busy = false, stable = 0, lastQ = null, cool = 0, torch = false;
  let autoOn = S.autoCapture && mode !== 'photo';

  const video = h('video', { playsinline: true, muted: true, autoplay: true });
  video.muted = true;
  const ov = h('canvas', { class: 'ov' });
  const hint = h('div', { class: 'hint' }, 'Đang mở camera…');
  const idframe = h('div', { class: 'idframe hidden' });
  const fx = h('div', { class: 'flashfx' });
  const cam = h('div', { class: 'cam' }, video, ov, idframe, fx, hint);
  const countB = h('b', null, '0');
  const stackEl = h('button', { class: 'stack', onclick: () => finish() }, countB);
  const shutter = h('button', { class: 'shutter', onclick: () => capture() }, h('i'));
  const autoBtn = h('button', { class: 'toggle', onclick: () => { autoOn = !autoOn; S.autoCapture = autoOn ? 1 : 0; saveSettings(); paintTop(); } }, 'Tự chụp');
  const torchBtn = h('button', { class: 'ib hidden', onclick: toggleTorch }, ic('flash'));
  const modeBtns = [['doc', 'Tài liệu'], ['id', 'CCCD 2 mặt'], ['photo', 'Ảnh thường']].map(([m, l]) =>
    h('button', { 'data-m': m, onclick: () => setMode(m) }, l));
  const screen = h('div', { class: 'screen dark' },
    h('div', { class: 'sbar' }, h('button', { class: 'ib', onclick: () => closeLayer() }, ic('close')),
      h('div', { class: 't' }, opts.title || 'Quét tài liệu'), autoBtn, torchBtn),
    cam,
    h('div', { class: 'modes' }, modeBtns),
    h('div', { class: 'camctl' },
      h('button', { class: 'camside', onclick: fromGallery, title: 'Chọn ảnh' }, ic('image')),
      shutter, stackEl));
  pushLayer(screen, (why) => { closed = true; stop(); });

  function paintTop() {
    autoBtn.classList.toggle('on', autoOn);
    autoBtn.classList.toggle('hidden', mode === 'photo');
    shutter.classList.toggle('auto', autoOn && mode !== 'photo');
    modeBtns.forEach((b) => b.classList.toggle('on', b.dataset.m === mode));
    idframe.classList.toggle('hidden', mode !== 'id');
    if (mode === 'id') hint.textContent = items.length === 0 ? 'Mặt TRƯỚC thẻ – đặt vừa khung' : 'Mặt SAU thẻ – đặt vừa khung';
    else if (stream) hint.textContent = mode === 'photo' ? 'Chụp ảnh nguyên bản' : (autoOn ? 'Giữ yên máy để tự chụp' : 'Căn tài liệu trong khung hình');
  }
  function setMode(m) {
    if (m === mode) return;
    if (items.length) { toast('Hãy hoàn tất lượt quét hiện tại trước khi đổi chế độ'); return; }
    mode = m;
    if (m === 'photo') autoOn = false; else autoOn = S.autoCapture;
    paintTop();
  }
  function stop() {
    clearInterval(timer);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  async function toggleTorch() {
    if (!track) return;
    torch = !torch;
    try { await track.applyConstraints({ advanced: [{ torch }] }); torchBtn.style.color = torch ? '#ffd23f' : ''; } catch (e) { toast('Không bật được đèn'); }
  }
  function updateStack() {
    countB.textContent = items.length;
    const last = items[items.length - 1];
    stackEl.style.backgroundImage = last ? `url(${blobUrl(last.orig)})` : '';
  }
  /* toạ độ khung CCCD trong ảnh video */
  function idQuad(vw, vh) {
    const r = idframe.getBoundingClientRect(), c = cam.getBoundingClientRect();
    const s = Math.max(c.width / vw, c.height / vh), ox = (c.width - vw * s) / 2, oy = (c.height - vh * s) / 2;
    const x0 = (r.left - c.left - ox) / s, y0 = (r.top - c.top - oy) / s, x1 = (r.right - c.left - ox) / s, y1 = (r.bottom - c.top - oy) / s;
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  }
  const small = IP.canvas(10, 10);
  const sctx = small.getContext('2d', { willReadFrequently: true });
  function tick() {
    const vw = video.videoWidth, vh = video.videoHeight;
    const cw = cam.clientWidth, ch = cam.clientHeight, dpr = window.devicePixelRatio || 1;
    if (ov.width !== Math.round(cw * dpr)) { ov.width = Math.round(cw * dpr); ov.height = Math.round(ch * dpr); }
    const g = ov.getContext('2d');
    g.clearRect(0, 0, ov.width, ov.height);
    if (!vw || mode === 'photo' || busy) return;
    const sc = 320 / Math.max(vw, vh);
    small.width = Math.round(vw * sc); small.height = Math.round(vh * sc);
    sctx.drawImage(video, 0, 0, small.width, small.height);
    let q = IP.detectInData(sctx.getImageData(0, 0, small.width, small.height));
    if (!q) { stable = 0; lastQ = null; if (autoOn && mode !== 'id') hint.textContent = 'Không thấy mép giấy – đặt giấy trên nền tối'; return; }
    q = q.map((p) => [p[0] / sc, p[1] / sc]);
    const s = Math.max(cw / vw, ch / vh), ox = (cw - vw * s) / 2, oy = (ch - vh * s) / 2;
    g.save(); g.scale(dpr, dpr);
    g.beginPath();
    q.forEach((p, i) => (i ? g.lineTo : g.moveTo).call(g, p[0] * s + ox, p[1] * s + oy));
    g.closePath();
    g.fillStyle = 'rgba(18,160,124,.18)'; g.fill();
    g.lineWidth = 3; g.strokeStyle = '#19d3a2'; g.stroke();
    g.restore();
    if (lastQ) {
      const mv = Math.max(...q.map((p, i) => Math.hypot(p[0] - lastQ[i][0], p[1] - lastQ[i][1]))) / Math.max(vw, vh);
      stable = mv < 0.02 ? stable + 1 : 0;
    }
    lastQ = q;
    if (autoOn && Date.now() > cool) {
      if (stable >= 1) hint.textContent = 'Giữ yên… ' + '●'.repeat(Math.min(5, stable));
      if (stable >= 5) { stable = 0; capture(); }
    }
  }
  async function capture() {
    if (busy) return;
    if (!stream || !video.videoWidth) { return fromSystemCamera(); }
    busy = true; cool = Date.now() + 2500;
    fx.style.opacity = '0.8'; setTimeout(() => (fx.style.opacity = '0'), 120);
    if (navigator.vibrate) navigator.vibrate(30);
    try {
      const vw = video.videoWidth, vh = video.videoHeight;
      const c = IP.canvas(vw, vh);
      c.getContext('2d').drawImage(video, 0, 0);
      const blob = await IP.toBlob(c, 'image/jpeg', 0.93);
      const hq = mode === 'id' ? idQuad(vw, vh) : null;
      const sc2 = Math.min(1, 2600 / Math.max(vw, vh));
      const it = await makeItem(blob, mode, opts, hq ? () => hq.map((p) => [Math.max(0, p[0] * sc2), Math.max(0, p[1] * sc2)]) : null);
      if (closed) return;
      items.push(it);
      updateStack(); paintTop();
      if (mode === 'id' && items.length >= 2) finish();
    } catch (e) { toast('Lỗi chụp: ' + e.message); }
    busy = false;
  }
  async function addFiles(files) {
    if (!files.length) return;
    const L = loading('Đang nhập ảnh…');
    for (let i = 0; i < files.length; i++) {
      L.set(`Đang nhập ảnh ${i + 1}/${files.length}…`, i / files.length);
      try { items.push(await makeItem(files[i], mode, opts)); } catch (e) { toast('Không đọc được ảnh ' + files[i].name); }
    }
    L.close(); updateStack(); paintTop();
  }
  async function fromGallery() {
    await addFiles(await pickFiles('image/*', mode !== 'id'));
    if (items.length && (mode !== 'id' || items.length >= 2)) finish();
  }
  async function fromSystemCamera() {
    await addFiles(await pickFiles('image/*', false, 'environment'));
    if (mode === 'id' && items.length >= 2) finish();
  }
  function finish() {
    if (!items.length) { toast('Chưa có ảnh nào'); return; }
    stop();
    cropScreen(items, { ...opts, mode }, 0, true);
  }

  paintTop(); updateStack();
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('nocam');
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
    });
    if (closed) { stop(); return; }
    video.srcObject = stream;
    track = stream.getVideoTracks()[0];
    try { const cap = track.getCapabilities && track.getCapabilities(); if (cap && cap.torch) torchBtn.classList.remove('hidden'); } catch (e) {}
    try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (e) {}
    await video.play().catch(() => {});
    paintTop();
    timer = setInterval(tick, 300);
  } catch (e) {
    hint.textContent = 'Không mở được camera trong app';
    cam.append(h('div', { style: { position: 'absolute', inset: '0', display: 'grid', placeItems: 'center', padding: '24px', textAlign: 'center' } },
      h('div', null,
        h('p', { style: { color: '#ccc', fontSize: '14px' } }, 'Trình duyệt chưa cho phép camera (cần mở bằng https và cấp quyền Camera). Bạn vẫn có thể chụp bằng camera của máy:'),
        h('button', { class: 'btn p', onclick: fromSystemCamera }, ic('camera'), 'Chụp bằng camera máy'),
        h('div', { style: { height: '10px' } }),
        h('button', { class: 'btn', onclick: fromGallery }, ic('image'), 'Chọn ảnh có sẵn'))));
  }
}

/* nhập ảnh trực tiếp (không mở camera) */
async function importImages(opts = {}) {
  const files = await pickFiles('image/*', true);
  if (!files.length) return;
  const mode = opts.mode || 'doc', items = [];
  const L = loading('Đang nhập ảnh…');
  for (let i = 0; i < files.length; i++) {
    L.set(`Đang nhận diện ${i + 1}/${files.length}…`, i / files.length);
    try { items.push(await makeItem(files[i], mode, opts)); } catch (e) {}
  }
  L.close();
  if (!items.length) return toast('Không đọc được ảnh');
  cropScreen(items, { ...opts, mode }, 0, false);
}

/* ================= CẮT GÓC ================= */
function cropScreen(items, opts, start = 0, replace = false) {
  let idx = start, bmp = null, fit = null, loadTok = 0;
  const stage = h('div', { class: 'stage' });
  const cv = h('canvas', { class: 'img' });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'poly');
  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  poly.setAttribute('fill', 'rgba(18,160,124,.15)'); poly.setAttribute('stroke', '#19d3a2'); poly.setAttribute('stroke-width', '2.5');
  svg.append(poly);
  const loupe = h('canvas', { class: 'loupe hidden', width: 240, height: 240 });
  const handles = [0, 1, 2, 3].map((i) => h('div', { class: 'handle' }, h('i')));
  const mids = [0, 1, 2, 3].map((i) => h('div', { class: 'handle mid' }, h('i')));
  stage.append(cv, svg, ...handles, ...mids, loupe);
  const title = h('div', { class: 't' });
  const strip = h('div', { class: 'strip' });
  const screen = h('div', { class: 'screen dark' },
    h('div', { class: 'sbar' }, h('button', { class: 'ib', onclick: () => closeLayer() }, ic('back')), title,
      h('button', { class: 'btn p', style: { height: '38px' }, onclick: next }, 'Tiếp ', ic('next', 18))),
    stage, strip,
    h('div', { class: 'actbar' },
      h('button', { class: 'act', onclick: auto }, ic('wand'), 'Tự động'),
      h('button', { class: 'act', onclick: full }, ic('scan'), 'Toàn ảnh'),
      h('button', { class: 'act', onclick: () => { cur().rot = ((cur().rot || 0) + 90) % 360; toast('Đã xoay 90° (áp dụng ở bước sau)'); } }, ic('rotateR'), 'Xoay'),
      opts.editPage ? null : h('button', { class: 'act', onclick: removeCur }, ic('trash'), 'Xoá')));
  (replace ? replaceLayer : pushLayer)(screen, () => window.removeEventListener('resize', layout));
  window.addEventListener('resize', layout);
  const cur = () => items[idx];

  function renderStrip() {
    strip.innerHTML = '';
    strip.classList.toggle('hidden', items.length < 2);
    items.forEach((it, i) => strip.append(h('button', {
      class: 's' + (i === idx ? ' on' : ''), style: { backgroundImage: `url(${blobUrl(it.orig)})` }, onclick: () => go(i),
    }, h('span', null, i + 1))));
  }
  async function go(i) {
    idx = i; const tok = ++loadTok;
    title.textContent = items.length > 1 ? `Cắt trang ${idx + 1}/${items.length}` : 'Cắt và chỉnh góc';
    renderStrip();
    const b = await IP.load(cur().orig);
    if (tok !== loadTok) return;
    if (bmp && bmp.close) bmp.close();
    bmp = b; layout();
  }
  function layout() {
    if (!bmp) return;
    const sw = stage.clientWidth, sh = stage.clientHeight, iw = IP.W(bmp), ih = IP.H(bmp);
    const s = Math.min((sw - 40) / iw, (sh - 40) / ih);
    fit = { s, ox: (sw - iw * s) / 2, oy: (sh - ih * s) / 2, iw, ih };
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(iw * s * dpr); cv.height = Math.round(ih * s * dpr);
    Object.assign(cv.style, { left: fit.ox + 'px', top: fit.oy + 'px', width: iw * s + 'px', height: ih * s + 'px' });
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    paint();
  }
  function paint() {
    if (!fit) return;
    const q = cur().quad, P = q.map((p) => [p[0] * fit.s + fit.ox, p[1] * fit.s + fit.oy]);
    poly.setAttribute('points', P.map((p) => p.join(',')).join(' '));
    P.forEach((p, i) => { handles[i].style.left = p[0] + 'px'; handles[i].style.top = p[1] + 'px'; });
    mids.forEach((m, i) => {
      const a = P[i], b = P[(i + 1) % 4];
      m.style.left = (a[0] + b[0]) / 2 + 'px'; m.style.top = (a[1] + b[1]) / 2 + 'px';
      const ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
      m.firstChild.style.transform = `rotate(${ang}deg)`;
    });
  }
  function drawLoupe(x, y) {
    const g = loupe.getContext('2d'), z = 60 / fit.s; // vùng nguồn ~ 60px màn hình -> phóng 2x
    g.fillStyle = '#000'; g.fillRect(0, 0, 240, 240);
    g.drawImage(bmp, x - z, y - z, z * 2, z * 2, 0, 0, 240, 240);
    g.strokeStyle = '#19d3a2'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(120, 95); g.lineTo(120, 145); g.moveTo(95, 120); g.lineTo(145, 120); g.stroke();
    const sr = stage.getBoundingClientRect();
    const px = x * fit.s + fit.ox;
    loupe.style.left = px < sr.width / 2 ? 'auto' : '10px';
    loupe.style.right = px < sr.width / 2 ? '10px' : 'auto';
  }
  function bindDrag(el, onMove) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); el.setPointerCapture(e.pointerId);
      const sr = stage.getBoundingClientRect();
      let last = [(e.clientX - sr.left - fit.ox) / fit.s, (e.clientY - sr.top - fit.oy) / fit.s];
      const mv = (ev) => {
        const p = [(ev.clientX - sr.left - fit.ox) / fit.s, (ev.clientY - sr.top - fit.oy) / fit.s];
        const pt = onMove(p, [p[0] - last[0], p[1] - last[1]]);
        last = p; paint();
        loupe.classList.remove('hidden'); drawLoupe(pt[0], pt[1]);
      };
      const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); loupe.classList.add('hidden'); };
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    });
  }
  const clamp = (p) => [Math.max(0, Math.min(fit.iw, p[0])), Math.max(0, Math.min(fit.ih, p[1]))];
  handles.forEach((hd, i) => bindDrag(hd, (p) => { cur().quad[i] = clamp(p); return cur().quad[i]; }));
  mids.forEach((m, i) => bindDrag(m, (p, d) => {
    const q = cur().quad, a = q[i], b = q[(i + 1) % 4];
    q[i] = clamp([a[0] + d[0], a[1] + d[1]]); q[(i + 1) % 4] = clamp([b[0] + d[0], b[1] + d[1]]);
    return [(q[i][0] + q[(i + 1) % 4][0]) / 2, (q[i][1] + q[(i + 1) % 4][1]) / 2];
  }));
  function auto() {
    const q = IP.detect(bmp, 480);
    if (q) { cur().quad = q; paint(); toast('Đã nhận diện mép giấy'); }
    else toast('Không nhận diện được – hãy kéo các góc bằng tay');
  }
  function full() { cur().quad = IP.fullQuad(fit.iw, fit.ih); paint(); }
  function removeCur() {
    if (items.length === 1) { closeLayer(); return; }
    items.splice(idx, 1);
    go(Math.min(idx, items.length - 1));
  }
  function next() {
    if (IP.quadArea(cur().quad) < 100) return toast('Vùng cắt quá nhỏ');
    filterScreen(items, opts, opts.mode === 'id' ? 0 : idx);
  }
  requestAnimationFrame(() => go(idx));
}

/* ================= BỘ LỌC ================= */
function filterScreen(items, opts, start = 0) {
  let idx = start, tok = 0;
  const img = h('img', { alt: '' });
  const busy = h('div', { class: 'busy hidden' }, h('div', { class: 'spin' }));
  const prev = h('div', { class: 'preview' }, img, busy);
  const chips = h('div', { class: 'fchips' });
  const pageLbl = h('span', { style: { minWidth: '44px', textAlign: 'center', fontSize: '13px' } });
  const navL = h('button', { class: 'ib', onclick: () => go(idx - 1) }, ic('back'));
  const navR = h('button', { class: 'ib', onclick: () => go(idx + 1) }, ic('next'));
  const sB = h('input', { type: 'range', min: -50, max: 50, value: 0 });
  const sC = h('input', { type: 'range', min: -50, max: 50, value: 0 });
  const adjRow = h('div', { class: 'adjrow hidden' },
    h('label', null, 'Độ sáng', sB), h('label', null, 'Tương phản', sC),
    h('button', { class: 'link', onclick: () => { sB.value = sC.value = 0; onAdj(); } }, 'Mặc định'));
  const onAdj = () => { cur().adj = { b: +sB.value, c: +sC.value }; clearTimeout(onAdj.t); onAdj.t = setTimeout(show, 120); };
  sB.oninput = sC.oninput = onAdj;
  const screen = h('div', { class: 'screen dark' },
    h('div', { class: 'sbar' }, h('button', { class: 'ib', onclick: () => cropScreen(items, opts, idx, true) }, ic('back')),
      h('div', { class: 't' }, 'Bộ lọc & chỉnh ảnh'),
      items.length > 1 ? h('div', { style: { display: 'flex', alignItems: 'center' } }, navL, pageLbl, navR) : null,
      h('button', { class: 'btn p', style: { height: '38px' }, onclick: save }, ic('check', 18), ' Lưu')),
    prev, adjRow, chips,
    h('div', { class: 'actbar' },
      h('button', { class: 'act', onclick: () => rot(-90) }, ic('rotate'), 'Xoay trái'),
      h('button', { class: 'act', onclick: () => rot(90) }, ic('rotateR'), 'Xoay phải'),
      h('button', { class: 'act', onclick: () => { cur().flip = !cur().flip; show(); } }, ic('flip'), 'Lật'),
      h('button', { class: 'act', onclick: () => adjRow.classList.toggle('hidden') }, ic('sun'), 'Sáng/TP'),
      h('button', { class: 'act', onclick: () => cropScreen(items, opts, idx, true) }, ic('crop'), 'Cắt lại'),
      items.length > 1 ? h('button', { class: 'act', onclick: applyAll }, ic('copy'), 'Áp tất cả') : null));
  replaceLayer(screen);
  const cur = () => items[idx];

  async function thumbs() {
    const it = cur(), my = idx;
    chips.innerHTML = '';
    const btns = FILTERS.map(([f, l]) => {
      const pv = h('div', { class: 'pv' });
      const b = h('button', { class: f === it.filter ? 'on' : '', onclick: () => { it.filter = f; chips.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); show(); } }, pv, l);
      chips.append(b);
      return [f, pv];
    });
    if (!it._pv) {
      it._pv = {};
      const b = await IP.load(it.orig);
      const base = IP.warp(b, it.quad, { maxSide: 220, aspect: it.aspect });
      if (b.close) b.close();
      for (const [f] of FILTERS) {
        const c = IP.canvas(base.width, base.height); c.getContext('2d').drawImage(base, 0, 0);
        IP.applyFilter(c, f);
        it._pv[f] = c.toDataURL('image/jpeg', 0.7);
      }
    }
    if (my !== idx) return;
    btns.forEach(([f, pv]) => { pv.style.backgroundImage = `url(${it._pv[f]})`; pv.style.transform = it.rot ? `rotate(${it.rot}deg)` : ''; });
  }
  async function show() {
    const t = ++tok, it = cur();
    busy.classList.remove('hidden');
    await sleep(16);
    const c = await IP.render(it, 1400);
    if (t !== tok) return;
    img.src = c.toDataURL('image/jpeg', 0.85);
    busy.classList.add('hidden');
  }
  function go(i) {
    if (i < 0 || i >= items.length) return;
    idx = i; pageLbl.textContent = `${idx + 1}/${items.length}`;
    navL.disabled = idx === 0; navR.disabled = idx === items.length - 1;
    const a = cur().adj || { b: 0, c: 0 }; sB.value = a.b; sC.value = a.c;
    thumbs(); show();
  }
  function rot(d) { cur().rot = (((cur().rot || 0) + d) % 360 + 360) % 360; if (cur().ann && cur().ann.length) toast('Lưu ý: nét vẽ/chữ đã thêm giữ vị trí cũ'); thumbs(); show(); }
  function applyAll() {
    const c = cur();
    items.forEach((it) => { it.filter = c.filter; it.adj = c.adj ? { ...c.adj } : null; });
    toast(`Đã áp dụng “${FILTERS.find((f) => f[0] === c.filter)[1]}” cho ${items.length} trang`);
  }
  async function save() {
    const ok = await saveItems(items, opts);
    if (ok) {
      await closeLayers(1);
      finishSave(ok, opts);
    }
  }
  go(idx);
}

/* lưu danh sách trang vào tài liệu (mới hoặc có sẵn) */
async function saveItems(items, opts, L0) {
  const L = L0 || loading('Đang lưu…');
  try {
    const now = Date.now();
    let doc = opts.docId ? await DB.get('docs', opts.docId) : null;
    const isNew = !doc;
    if (isNew) {
      const isId = opts.mode === 'id';
      doc = {
        id: uid(), name: opts.name || (isId ? 'CCCD ' : opts.kind ? opts.kind + ' ' : 'Tài liệu ') + fmtDate(now),
        folderId: opts.folderId || (App.folder && !['all', 'none'].includes(App.folder) ? App.folder : null),
        type: isId ? 'id' : 'doc', created: now, updated: now, pageIds: [], tags: [],
        asset: opts.asset || '', workshop: opts.workshop || '', kind: isId ? 'CCCD / Giấy tờ' : opts.kind || '', note: '', text: '',
      };
    }
    const ms = maxSideFor(), q = S.quality === 'high' ? 0.86 : 0.78;
    for (let i = 0; i < items.length; i++) {
      L.set(`Đang xử lý trang ${i + 1}/${items.length}…`, i / items.length);
      await sleep(10);
      const it = items[i];
      const c = await IP.render(it, ms);
      const page = {
        id: it.pageId || uid(), docId: doc.id, orig: it.orig, quad: it.quad, filter: it.filter, rot: it.rot || 0,
        flip: !!it.flip, adj: it.adj || null, ann: it.ann || [], aspect: it.aspect || null,
        out: await IP.toBlob(c, 'image/jpeg', q), thumb: await IP.toBlob(IP.scaleCanvas(c, 360), 'image/jpeg', 0.72),
        w: c.width, h: c.height, text: it.text || '',
      };
      await DB.put('pages', page);
      if (!doc.pageIds.includes(page.id)) {
        if (opts.insertAt != null) doc.pageIds.splice(opts.insertAt + i, 0, page.id); else doc.pageIds.push(page.id);
      }
    }
    const first = await DB.get('pages', doc.pageIds[0]);
    doc.cover = first ? first.thumb : null;
    doc.updated = Date.now();
    await DB.put('docs', doc);
    L.close();
    return { doc, isNew };
  } catch (e) {
    L.close();
    toast('Lỗi khi lưu: ' + (e && e.message ? e.message : e), 4000);
    return null;
  }
}
function finishSave({ doc, isNew }, opts) {
  App.refresh();
  if (opts.onDone) opts.onDone(doc);
  else if (isNew) openDoc(doc.id, true);
  toast(isNew ? 'Đã lưu tài liệu' : 'Đã cập nhật');
}

/* nhập tệp PDF: mỗi trang thành 1 ảnh */
async function importPdf(opts = {}) {
  const [f] = await pickFiles('application/pdf,.pdf', false);
  if (!f) return;
  const L = loading('Đang mở PDF…');
  try {
    await loadScript('lib/pdf.min.js');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
    const items = [];
    const n = Math.min(pdf.numPages, 300);
    for (let i = 1; i <= n; i++) {
      L.set(`Đang đọc trang ${i}/${n}…`, (i - 1) / n / 2);
      const pg = await pdf.getPage(i);
      const v0 = pg.getViewport({ scale: 1 });
      const sc = Math.min(2600 / Math.max(v0.width, v0.height), 3);
      const vp = pg.getViewport({ scale: sc });
      const c = IP.canvas(vp.width, vp.height), g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      await pg.render({ canvasContext: g, viewport: vp }).promise;
      items.push({ orig: await IP.toBlob(c, 'image/jpeg', 0.9), w: c.width, h: c.height, quad: IP.fullQuad(c.width, c.height), filter: 'orig', rot: 0 });
      pg.cleanup();
    }
    L.set('Đang lưu…', 0.5);
    const name = opts.docId ? undefined : f.name.replace(/\.pdf$/i, '');
    const res = await saveItems(items, { ...opts, name }, { set: (m, p) => L.set(m, p != null ? 0.5 + p / 2 : null), close: () => {} });
    L.close();
    if (res) finishSave(res, opts);
    if (pdf.numPages > n) toast('Chỉ nhập 300 trang đầu', 3500);
  } catch (e) { L.close(); toast('Không mở được PDF: ' + e.message, 4000); }
}
