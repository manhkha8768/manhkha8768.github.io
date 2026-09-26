'use strict';
/* XLM Scan — camera trong app: khung bám mép giấy, tự chụp khi giữ yên, chụp liên tục
   Chế độ: 'doc' tài liệu · 'id' CCCD/thẻ 2 mặt · 'book' sách mở đôi */
const Camera = (() => {
  const MODES = [['doc', 'Tài liệu'], ['id', 'CCCD / thẻ'], ['book', 'Sách']];
  const supported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext;

  /** Mở camera. Trả về mảng trang đã chụp (có thể rỗng), hoặc null nếu không mở được camera. */
  function open({ mode = 'doc', importBlob }) {
    return new Promise(async resolve => {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
        });
      } catch (e) {
        console.warn('camera', e);
        resolve(null); return;
      }
      const track = stream.getVideoTracks()[0];
      let imageCapture = null;
      try { if ('ImageCapture' in window) imageCapture = new ImageCapture(track); } catch { /* không hỗ trợ */ }

      const pages = [];            // trang đã xử lý xong
      const pending = [];          // promise đang xử lý
      let idFront = null;          // ảnh mặt trước khi ở chế độ CCCD
      let auto = State.settings.autoCapture !== false;
      let torch = false, closed = false, busy = false;
      let quad = null, hist = [], armed = true, lostSince = 0, shotQuad = null;

      const video = el('video', { playsinline: true, muted: true, autoplay: true });
      video.muted = true; video.srcObject = stream;
      const overlay = el('canvas', { class: 'cam-overlay' });
      const hint = el('div', { class: 'cam-hint', role: 'status' });
      const flash = el('div', { class: 'cam-flash' });
      const count = el('span', { class: 'cam-count' });
      const stack = el('button', { class: 'cam-stack', type: 'button', 'aria-label': 'Xong, xem các trang đã chụp', onclick: () => done() }, count);
      const ring = el('i', { class: 'cam-ring' });
      const shutter = el('button', { class: 'cam-shutter', type: 'button', 'aria-label': 'Chụp', onclick: () => capture(false) }, ring);
      const autoBtn = el('button', { class: 'cam-pill', type: 'button', onclick: () => { auto = !auto; State.settings.autoCapture = auto; saveSettings(); drawTop(); } });
      const torchBtn = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Đèn flash', hidden: true, onclick: toggleTorch }, flashIcon());
      const modeBar = el('div', { class: 'cam-modes', role: 'tablist' });
      const galleryBtn = el('button', { class: 'cam-side', type: 'button', 'aria-label': 'Chọn ảnh từ thư viện', onclick: fromGallery }, icon('image'));
      const root = el('div', { class: 'cam', role: 'dialog', 'aria-label': 'Camera quét tài liệu' },
        video, overlay, flash,
        el('div', { class: 'cam-top' },
          el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Đóng camera', onclick: () => Layers.back() }, icon('close')),
          el('div', { style: 'flex:1' }), autoBtn, torchBtn),
        hint,
        el('div', { class: 'cam-bottom' }, modeBar, el('div', { class: 'cam-row' }, galleryBtn, shutter, stack)));
      document.body.append(root);

      const onPop = async () => {
        if (!closed && pages.length + pending.length > 0 && !root.__keep) {
          const ok = await confirmBox('Bỏ các trang vừa chụp?', `${pages.length + pending.length} trang chưa được lưu sẽ mất.`, 'Bỏ đi');
          if (!ok) { Layers.push(onPop); return; }
          cleanup(); resolve([]); return;
        }
        cleanup();
        if (root.__keep) { await Promise.all(pending); resolve(pages.filter(Boolean)); } else resolve([]);
      };
      Layers.push(onPop);

      function cleanup() { closed = true; stream.getTracks().forEach(t => t.stop()); root.remove(); }
      async function done() {
        if (!pages.length && !pending.length) { Layers.back(); return; }
        if (idFront) toast('Đã bỏ mặt trước chưa có mặt sau');
        root.__keep = true;
        Busy.show('Đang xử lý ảnh…');
        await Promise.all(pending);
        Busy.hide();
        Layers.back();
      }

      function flashIcon() { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'i'); s.setAttribute('viewBox', '0 0 24 24'); s.innerHTML = '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'; return s; }
      async function toggleTorch() {
        torch = !torch;
        try { await track.applyConstraints({ advanced: [{ torch }] }); } catch { torch = false; toast('Máy không cho bật đèn flash'); }
        torchBtn.classList.toggle('on', torch);
      }
      function drawTop() {
        autoBtn.textContent = auto ? 'Tự chụp: Bật' : 'Tự chụp: Tắt';
        autoBtn.classList.toggle('on', auto);
        modeBar.replaceChildren(...MODES.map(([k, l]) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(mode === k), onclick: () => { if (idFront && k !== 'id') idFront = null; mode = k; drawTop(); setHint(); } }, l)));
        const n = pages.length + pending.length;
        count.textContent = n ? String(n) : '';
        stack.hidden = !n;
        const last = pages[pages.length - 1];
        if (last && last.thumb) stack.style.backgroundImage = `url("${last.thumb}")`;
      }
      function setHint(t) {
        if (t) { hint.textContent = t; return; }
        hint.textContent = mode === 'id' ? (idFront ? 'Lật thẻ — chụp MẶT SAU' : 'Đặt thẻ lên nền tối — chụp MẶT TRƯỚC')
          : mode === 'book' ? 'Chụp cả 2 trang sách mở — app tự tách đôi'
          : auto ? 'Đưa tờ giấy vào khung, giữ yên máy để tự chụp' : 'Đưa tờ giấy vào khung rồi bấm chụp';
      }
      drawTop(); setHint();
      try {
        const caps = track.getCapabilities ? track.getCapabilities() : {};
        if (caps.torch) torchBtn.hidden = false;
        if (caps.focusMode && caps.focusMode.includes('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
      } catch { /* bỏ qua */ }

      /* ---------- vòng nhận khung */
      const det = Imaging.canvas(320, 240);
      const octx = overlay.getContext('2d');
      let lastDet = 0;
      function map() {
        const r = overlay.getBoundingClientRect(), vw = video.videoWidth, vh = video.videoHeight;
        const s = Math.max(r.width / vw, r.height / vh);
        return { s, ox: (r.width - vw * s) / 2, oy: (r.height - vh * s) / 2, vw, vh, r };
      }
      function loop(t) {
        if (closed) return;
        requestAnimationFrame(loop);
        if (!video.videoWidth) return;
        const m = map(), dpr = devicePixelRatio || 1;
        if (overlay.width !== Math.round(m.r.width * dpr)) { overlay.width = Math.round(m.r.width * dpr); overlay.height = Math.round(m.r.height * dpr); }
        if (t - lastDet > 130 && !busy) {
          lastDet = t;
          const sc = 320 / Math.max(m.vw, m.vh);
          det.width = Math.round(m.vw * sc); det.height = Math.round(m.vh * sc);
          const dx = Imaging.ctx2d(det); dx.drawImage(video, 0, 0, det.width, det.height);
          const q = Imaging.detectQuad(det);
          if (q) {
            quad = quad ? quad.map((p, i) => [p[0] * 0.45 + q[i][0] * 0.55, p[1] * 0.45 + q[i][1] * 0.55]) : q;
            hist.push({ t, q }); lostSince = 0;
            if (!armed && shotQuad && q.some((p, i) => Math.abs(p[0] - shotQuad[i][0]) > 0.08 || Math.abs(p[1] - shotQuad[i][1]) > 0.08)) armed = true;
          } else {
            if (!lostSince) lostSince = t;
            if (t - lostSince > 500) { quad = null; hist = []; armed = true; }
          }
          hist = hist.filter(h => t - h.t < 1300);
          checkStable(t);
        }
        // vẽ khung
        octx.setTransform(dpr, 0, 0, dpr, 0, 0);
        octx.clearRect(0, 0, m.r.width, m.r.height);
        if (mode === 'id' && !quad) {
          const w = m.r.width * 0.78, h = w * 53.98 / 85.6, x0 = (m.r.width - w) / 2, y0 = (m.r.height - h) / 2 - 30;
          octx.setLineDash([10, 8]); octx.strokeStyle = 'rgba(255,255,255,.7)'; octx.lineWidth = 2; octx.strokeRect(x0, y0, w, h); octx.setLineDash([]);
        }
        if (quad) {
          const pts = quad.map(([x, y]) => [m.ox + x * m.vw * m.s, m.oy + y * m.vh * m.s]);
          const stable = stability(t);
          octx.beginPath(); octx.moveTo(...pts[0]); pts.slice(1).forEach(p => octx.lineTo(...p)); octx.closePath();
          octx.fillStyle = stable > 0.99 ? 'rgba(46,204,113,.28)' : 'rgba(46,204,113,.14)'; octx.fill();
          octx.lineWidth = 3; octx.strokeStyle = '#2ECC71'; octx.stroke();
          if (mode === 'book') {
            const a = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2], b = [(pts[3][0] + pts[2][0]) / 2, (pts[3][1] + pts[2][1]) / 2];
            octx.setLineDash([8, 6]); octx.beginPath(); octx.moveTo(...a); octx.lineTo(...b); octx.stroke(); octx.setLineDash([]);
          }
          ring.style.setProperty('--p', auto && armed ? stable : 0);
        } else ring.style.setProperty('--p', 0);
      }
      function stability(t) {
        if (hist.length < 3) return 0;
        const first = hist[0];
        const moved = hist.some(h => h.q.some((p, i) => Math.abs(p[0] - first.q[i][0]) > 0.025 || Math.abs(p[1] - first.q[i][1]) > 0.025));
        if (moved) { hist = hist.slice(-1); return 0; }
        return Math.min(1, (t - first.t) / 1100);
      }
      function checkStable(t) {
        if (!auto || !armed || busy || closed) return;
        if (stability(t) >= 1) { armed = false; capture(true); }
      }
      requestAnimationFrame(loop);

      /* ---------- chụp */
      async function grab() {
        const vw = video.videoWidth, vh = video.videoHeight;
        if (imageCapture) {
          try {
            // luôn ưu tiên chụp ảnh tĩnh độ phân giải cao nhất của cảm biến (có lấy nét), không lấy khung hình video
            const pc = await imageCapture.getPhotoCapabilities().catch(() => null);
            const settings = {};
            if (pc && pc.imageWidth && pc.imageHeight) { settings.imageWidth = pc.imageWidth.max; settings.imageHeight = pc.imageHeight.max; }
            if (pc && pc.fillLightMode && pc.fillLightMode.includes('off') && !torch) settings.fillLightMode = 'off';
            const blob = await Promise.race([imageCapture.takePhoto(settings).catch(() => imageCapture.takePhoto()), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4500))]);
            if (blob && blob.size > 50000) return { blob, sameFrame: false };
          } catch { /* dùng khung hình video */ }
        }
        const c = Imaging.canvas(vw, vh);
        c.getContext('2d').drawImage(video, 0, 0, vw, vh);
        return { blob: await Imaging.toBlob(c, 'image/jpeg', 0.93), sameFrame: true };
      }
      async function capture(isAuto) {
        if (busy || closed || !video.videoWidth) return;
        busy = true;
        flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go');
        navigator.vibrate && navigator.vibrate(30);
        const liveQuad = quad ? quad.map(p => p.slice()) : null;
        shotQuad = liveQuad; armed = false;
        try {
          const { blob, sameFrame } = await grab();
          const hintCorners = sameFrame ? liveQuad : null;
          const m = mode;
          if (m === 'id' && !idFront) {
            idFront = importBlob(blob, hintCorners);
            setHint('Đã chụp mặt trước. Lật thẻ — chụp MẶT SAU');
          } else {
            const front = idFront; idFront = null;
            const job = (async () => {
              if (m === 'id') {
                const [a, b] = await Promise.all([front, importBlob(blob, hintCorners)]);
                return [{ ...a, kind: 'id', parts: [{ src: a.src, small: a.small, corners: a.corners, auto: a.auto }, { src: b.src, small: b.small, corners: b.corners, auto: b.auto }], thumb: a.thumb }];
              }
              const p = await importBlob(blob, hintCorners);
              if (m === 'book') { const g = uid(); return [{ ...p, key: uid(), half: 'L', group: g }, { ...p, key: uid(), half: 'R', group: g }]; }
              return [p];
            })();
            pending.push(job);
            job.then(arr => { pages.push(...arr); pending.splice(pending.indexOf(job), 1); drawTop(); })
              .catch(e => { pending.splice(pending.indexOf(job), 1); toast('Lỗi xử lý ảnh: ' + e.message); drawTop(); });
            drawTop();
            setHint(m === 'book' ? 'Đã chụp 2 trang. Lật trang tiếp theo…' : isAuto ? 'Đã tự chụp. Đưa trang tiếp theo vào khung…' : 'Đã chụp. Chụp tiếp hoặc bấm ô ảnh để xong');
            setTimeout(() => { if (!closed) setHint(); }, 2200);
          }
        } catch (e) { toast('Không chụp được: ' + e.message); }
        finally { busy = false; hist = []; }
      }
      async function fromGallery() {
        const files = await pickFiles('gallery');
        for (const f of files) {
          const job = importBlob(f, null).then(p => mode === 'book' ? (g => [{ ...p, key: uid(), half: 'L', group: g }, { ...p, key: uid(), half: 'R', group: g }])(uid()) : [p]);
          pending.push(job);
          job.then(arr => { pages.push(...arr); pending.splice(pending.indexOf(job), 1); drawTop(); });
        }
        drawTop();
      }
    });
  }
  return { open, supported };
})();
