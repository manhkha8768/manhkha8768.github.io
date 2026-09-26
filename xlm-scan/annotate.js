'use strict';
/* XLM Scan — chữ ký tay và ghi chú lên trang
   Đối tượng ghi chú lưu dạng vector, tọa độ 0..1 theo trang:
   { type:'sig', sid, x, y, w, h } · { type:'text', text, x, y, size, color } · { type:'ink', color, width, alpha, pts:[[x,y]] } */
const Annotate = (() => {
  const COLORS = [['#111418', 'Đen'], ['#1747B5', 'Xanh'], ['#C62828', 'Đỏ']];
  const FONT = '"Be Vietnam Pro", system-ui, Arial, sans-serif';

  /* ---------- kho chữ ký (lưu trong máy) */
  async function listSigs() { return (await DB.get('kv', 'signatures')) || []; }
  async function saveSigs(list) { await DB.put('kv', list, 'signatures'); }
  const sigCache = new Map();
  async function sigImage(sid) {
    if (sigCache.has(sid)) return sigCache.get(sid);
    const s = (await listSigs()).find(x => x.id === sid);
    if (!s) return null;
    const img = await Imaging.loadImage(s.blob);
    sigCache.set(sid, img); return img;
  }

  /** Vẽ các ghi chú lên canvas (kích thước bất kỳ) */
  async function draw(ctx, annots, W, H, opts = {}) {
    await document.fonts?.load?.(`600 32px ${FONT}`).catch(() => {});
    for (const a of annots) {
      if (a.type === 'ink') {
        ctx.save(); ctx.globalAlpha = a.alpha || 1; ctx.strokeStyle = a.color; ctx.lineWidth = Math.max(1, a.width * W);
        ctx.lineCap = a.alpha < 1 ? 'butt' : 'round'; ctx.lineJoin = 'round';
        if (a.alpha < 1) ctx.globalCompositeOperation = 'multiply';
        ctx.beginPath();
        a.pts.forEach(([x, y], i) => i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H));
        ctx.stroke(); ctx.restore();
      } else if (a.type === 'text') {
        ctx.save(); ctx.fillStyle = a.color; ctx.textBaseline = 'top';
        const fs = a.size * W; ctx.font = `600 ${fs}px ${FONT}`;
        a.text.split('\n').forEach((ln, i) => ctx.fillText(ln, a.x * W, a.y * H + i * fs * 1.25));
        ctx.restore();
      } else if (a.type === 'sig') {
        const img = await sigImage(a.sid);
        if (img) ctx.drawImage(img, a.x * W, a.y * H, a.w * W, a.h * H);
      }
      if (opts.selected === a) {
        const b = bounds(a, ctx, W, H);
        ctx.save(); ctx.setLineDash([6, 4]); ctx.strokeStyle = '#E09A10'; ctx.lineWidth = 2;
        ctx.strokeRect(b.x * W - 4, b.y * H - 4, b.w * W + 8, b.h * H + 8); ctx.setLineDash([]);
        if (a.type !== 'ink') { ctx.fillStyle = '#E09A10'; ctx.beginPath(); ctx.arc((b.x + b.w) * W + 4, (b.y + b.h) * H + 4, 11, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
      }
    }
  }
  function bounds(a, ctx, W, H) {
    if (a.type === 'sig') return { x: a.x, y: a.y, w: a.w, h: a.h };
    if (a.type === 'text') {
      const fs = a.size * W; ctx.save(); ctx.font = `600 ${fs}px ${FONT}`;
      const lines = a.text.split('\n'); const tw = Math.max(...lines.map(l => ctx.measureText(l).width)); ctx.restore();
      return { x: a.x, y: a.y, w: tw / W, h: lines.length * fs * 1.25 / H };
    }
    const xs = a.pts.map(p => p[0]), ys = a.pts.map(p => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }

  /** Ghép ghi chú vào ảnh nền, trả về canvas mới */
  async function bake(baseCanvas, annots) {
    if (!annots || !annots.length) return baseCanvas;
    const c = Imaging.canvas(baseCanvas.width, baseCanvas.height), x = c.getContext('2d');
    x.drawImage(baseCanvas, 0, 0);
    await draw(x, annots, c.width, c.height);
    return c;
  }

  /* ---------- bảng ký tên */
  function signaturePad() {
    return new Promise(resolve => {
      const cv = el('canvas', { class: 'sig-pad' });
      let color = '#111418', strokes = [], cur = null;
      const sw = el('div', { class: 'swatches' }, COLORS.slice(0, 2).map(([c, l]) => el('button', { type: 'button', 'aria-label': l, style: `--c:${c}`, 'aria-pressed': String(c === color), onclick: e => { color = c; sw.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === e.currentTarget))); } })));
      const ctx = cv.getContext('2d');
      const paint = () => {
        const r = cv.getBoundingClientRect(), d = devicePixelRatio || 1;
        if (cv.width !== Math.round(r.width * d)) { cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d); }
        ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, r.width, r.height);
        ctx.strokeStyle = '#C9D2DA'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(20, r.height * 0.72); ctx.lineTo(r.width - 20, r.height * 0.72); ctx.stroke();
        for (const s of strokes) drawStroke(ctx, s);
      };
      const drawStroke = (c, s) => {
        c.strokeStyle = s.color; c.lineCap = 'round'; c.lineJoin = 'round';
        for (let i = 1; i < s.pts.length; i++) {
          const [x0, y0, w0] = s.pts[i - 1], [x1, y1, w1] = s.pts[i];
          c.lineWidth = (w0 + w1) / 2; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
        }
        if (s.pts.length === 1) { const [x, y, w] = s.pts[0]; c.fillStyle = s.color; c.beginPath(); c.arc(x, y, w / 2, 0, Math.PI * 2); c.fill(); }
      };
      const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
      let last = null;
      cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); const p = pos(e); cur = { color, pts: [[...p, 3]] }; strokes.push(cur); last = { p, t: e.timeStamp }; paint(); e.preventDefault(); });
      cv.addEventListener('pointermove', e => {
        if (!cur) return; const p = pos(e);
        const v = Math.hypot(p[0] - last.p[0], p[1] - last.p[1]) / Math.max(1, e.timeStamp - last.t);
        const w = e.pressure && e.pointerType === 'pen' ? 1.5 + e.pressure * 4 : Math.max(1.6, Math.min(4.2, 4.4 - v * 1.6));
        cur.pts.push([...p, w]); last = { p, t: e.timeStamp }; paint();
      });
      const up = () => { cur = null; };
      cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
      setTimeout(paint, 60);
      sheet({
        title: 'Ký tên', sub: 'Ký bằng ngón tay hoặc bút cảm ứng. Chữ ký lưu trên máy để dùng lại.',
        body: [cv, el('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:10px' }, sw,
          el('button', { class: 'btn sm', type: 'button', onclick: () => { strokes = []; paint(); } }, 'Ký lại'))],
        actions: [{ label: 'Hủy', value: null }, { label: 'Lưu chữ ký', kind: 'primary', value: async () => {
          if (!strokes.length) { toast('Hãy ký vào khung'); return undefined; }
          // cắt sát nét ký, nền trong suốt, độ phân giải x3
          const all = strokes.flatMap(s => s.pts);
          const pad = 8, x0 = Math.min(...all.map(p => p[0])) - pad, y0 = Math.min(...all.map(p => p[1])) - pad;
          const x1 = Math.max(...all.map(p => p[0])) + pad, y1 = Math.max(...all.map(p => p[1])) + pad;
          const S = 3, out = Imaging.canvas((x1 - x0) * S, (y1 - y0) * S), oc = out.getContext('2d');
          oc.setTransform(S, 0, 0, S, -x0 * S, -y0 * S);
          strokes.forEach(s => drawStroke(oc, s));
          const blob = await Imaging.toBlob(out, 'image/png');
          const list = await listSigs(); const sig = { id: uid(), blob, w: out.width, h: out.height, createdAt: Date.now() };
          list.unshift(sig); await saveSigs(list.slice(0, 6));
          return sig;
        } }],
      }).then(resolve);
    });
  }
  async function pickSignature() {
    const list = await listSigs();
    if (!list.length) return signaturePad();
    const grid = el('div', { class: 'sig-grid' });
    let closeFn;
    for (const s of list) {
      const url = URL.createObjectURL(s.blob);
      grid.append(el('div', { class: 'sig-item' },
        el('button', { type: 'button', class: 'sig-use', onclick: () => closeFn(s) }, el('img', { src: url, alt: 'Chữ ký' })),
        el('button', { type: 'button', class: 'sig-del', 'aria-label': 'Xóa chữ ký', onclick: async e => {
          const l = (await listSigs()).filter(x => x.id !== s.id); await saveSigs(l); sigCache.delete(s.id); e.currentTarget.parentElement.remove();
        } }, icon('close'))));
    }
    const v = await sheet({
      title: 'Chọn chữ ký', body: grid, onOpen: (b, c) => { closeFn = c; },
      actions: [{ label: 'Đóng', value: null }, { label: 'Ký mới', kind: 'primary', value: 'new' }],
    });
    if (v === 'new') return signaturePad();
    return v;
  }

  /* ---------- trình ghi chú */
  async function open(pageRec, onSave) {
    const baseBlob = pageRec.base || pageRec.image;
    const baseImg = await Imaging.loadImage(baseBlob);
    const W = baseImg.naturalWidth, H = baseImg.naturalHeight;
    let annots = JSON.parse(JSON.stringify(pageRec.annots || []));
    const undo = [];
    let tool = 'move', color = COLORS[0][0], sel = null, drag = null, ink = null;
    const snapshot = () => { undo.push(JSON.stringify(annots)); if (undo.length > 40) undo.shift(); };

    const cv = el('canvas', { class: 'ann-canvas' });
    const wrap = el('div', { class: 'ann-wrap' }, cv);
    const toolBtn = (k, ic, label) => el('button', { class: 'ann-tool', type: 'button', 'data-tool': k, onclick: () => { tool = k; sel = null; drawBar(); paint(); } }, icon(ic), label);
    const bar = el('div', { class: 'ann-bar' });
    const colorBar = el('div', { class: 'swatches' });
    const root = el('div', { class: 'scanner', style: 'z-index:46' },
      el('div', { class: 'sc-top' },
        el('button', { class: 'icon-btn', 'aria-label': 'Hủy', onclick: () => Layers.back() }, icon('close')),
        el('div', { class: 'sc-title' }, 'Ký & ghi chú'),
        el('button', { class: 'sc-done', onclick: save }, icon('check'), 'Lưu')),
      wrap,
      el('div', { class: 'ann-sub' }, colorBar,
        el('button', { class: 'sc-tool', type: 'button', onclick: () => { if (undo.length) { annots = JSON.parse(undo.pop()); sel = null; paint(); } } }, icon('rotate'), 'Hoàn tác'),
        el('button', { class: 'sc-tool', type: 'button', onclick: () => { if (sel) { snapshot(); annots = annots.filter(a => a !== sel); sel = null; paint(); } else toast('Chạm vào một mục để chọn rồi xóa'); } }, icon('trash'), 'Xóa mục')),
      bar);
    document.body.append(root);
    let saved = false;
    Layers.push(() => { root.remove(); window.removeEventListener('resize', layout); });

    function drawBar() {
      bar.replaceChildren(
        el('button', { class: 'ann-tool', type: 'button', onclick: addSig }, icon('edit'), 'Chữ ký'),
        el('button', { class: 'ann-tool', type: 'button', onclick: () => addText() }, icon('text'), 'Chữ'),
        el('button', { class: 'ann-tool', type: 'button', onclick: () => addText(fmtDate(Date.now(), false)) }, icon('doc'), 'Ngày'),
        toolBtn('pen', 'edit', 'Bút'), toolBtn('hl', 'wand', 'Tô sáng'), toolBtn('move', 'full', 'Di chuyển'));
      bar.querySelectorAll('[data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
      colorBar.replaceChildren(...COLORS.concat([['#FFD400', 'Vàng']]).map(([c, l]) => el('button', { type: 'button', style: `--c:${c}`, 'aria-label': l, 'aria-pressed': String(c === color), onclick: () => {
        color = c; if (sel && sel.type !== 'sig') { snapshot(); sel.color = c; } drawBar(); paint();
      } })));
    }
    let box = { x: 0, y: 0, w: 1, h: 1 }, dpr = 1;
    function layout() {
      dpr = devicePixelRatio || 1; const r = wrap.getBoundingClientRect();
      cv.width = r.width * dpr; cv.height = r.height * dpr;
      const s = Math.min((r.width - 24) / W, (r.height - 24) / H);
      box = { w: W * s, h: H * s }; box.x = (r.width - box.w) / 2; box.y = (r.height - box.h) / 2;
      paint();
    }
    let painting = false, again = false;
    async function paint() {
      if (painting) { again = true; return; }
      painting = true;
      const x = cv.getContext('2d');
      x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, cv.width, cv.height);
      x.drawImage(baseImg, box.x, box.y, box.w, box.h);
      x.save(); x.translate(box.x, box.y); x.beginPath(); x.rect(0, 0, box.w, box.h); x.clip();
      await draw(x, ink ? annots.concat([ink]) : annots, box.w, box.h, { selected: sel });
      x.restore();
      painting = false;
      if (again) { again = false; paint(); }
    }
    const norm = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left - box.x) / box.w, (e.clientY - r.top - box.y) / box.h]; };
    function hit(p) {
      const x = cv.getContext('2d');
      for (let i = annots.length - 1; i >= 0; i--) {
        const a = annots[i], b = bounds(a, x, box.w, box.h), m = 14 / box.w;
        if (p[0] >= b.x - m && p[0] <= b.x + b.w + m && p[1] >= b.y - m * box.w / box.h && p[1] <= b.y + b.h + m * box.w / box.h) return a;
      }
      return null;
    }
    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId); e.preventDefault();
      const p = norm(e);
      if (tool === 'pen' || tool === 'hl') {
        ink = { type: 'ink', color: tool === 'hl' ? (color === '#111418' ? '#FFD400' : color) : color, width: tool === 'hl' ? 0.022 : 0.0035, alpha: tool === 'hl' ? 0.35 : 1, pts: [p] };
        paint(); return;
      }
      if (sel && sel.type !== 'ink') {
        const x = cv.getContext('2d'), b = bounds(sel, x, box.w, box.h);
        const hx = (b.x + b.w) * box.w + 4, hy = (b.y + b.h) * box.h + 4;
        const r = cv.getBoundingClientRect(), px = e.clientX - r.left - box.x, py = e.clientY - r.top - box.y;
        if (Math.hypot(px - hx, py - hy) < 26) { snapshot(); drag = { mode: 'resize', start: p, a: { ...sel }, b }; return; }
      }
      sel = hit(p);
      if (sel) { snapshot(); drag = { mode: 'move', start: p, a: JSON.parse(JSON.stringify(sel)) }; }
      paint();
    });
    cv.addEventListener('pointermove', e => {
      const p = norm(e);
      if (ink) { ink.pts.push(p); paint(); return; }
      if (!drag || !sel) return;
      const dx = p[0] - drag.start[0], dy = p[1] - drag.start[1];
      if (drag.mode === 'move') {
        if (sel.type === 'ink') sel.pts = drag.a.pts.map(([x, y]) => [x + dx, y + dy]);
        else { sel.x = drag.a.x + dx; sel.y = drag.a.y + dy; }
      } else {
        const f = Math.max(0.2, (drag.b.w + dx) / drag.b.w);
        if (sel.type === 'sig') { sel.w = drag.a.w * f; sel.h = drag.a.h * f; }
        else if (sel.type === 'text') sel.size = Math.max(0.008, drag.a.size * f);
      }
      paint();
    });
    const up = () => {
      if (ink) { if (ink.pts.length > 1 || tool === 'pen') { snapshot(); annots.push(ink); } ink = null; paint(); }
      drag = null;
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);

    async function addSig() {
      const s = await pickSignature(); if (!s) return;
      snapshot();
      const w = 0.3, h = w * (s.h / s.w) * (W / H);
      const a = { type: 'sig', sid: s.id, x: 0.6 - w / 2, y: 0.75 - h / 2, w, h };
      annots.push(a); sel = a; tool = 'move'; drawBar(); paint();
      toast('Kéo chữ ký đến vị trí cần ký, kéo chấm vàng để phóng to/thu nhỏ', 3500);
    }
    async function addText(preset) {
      const t = preset || await promptBox('Thêm chữ', 'Nội dung', '', 'Thêm');
      if (!t) return;
      snapshot();
      const a = { type: 'text', text: t, x: 0.1, y: 0.1, size: 0.032, color: color === '#FFD400' ? '#111418' : color };
      annots.push(a); sel = a; tool = 'move'; drawBar(); paint();
    }
    async function save() {
      if (saved) return; saved = true;
      Busy.show('Đang lưu…');
      try {
        const base = Imaging.canvas(W, H); base.getContext('2d').drawImage(baseImg, 0, 0);
        const out = await bake(base, annots);
        await onSave({ annots, image: await Imaging.toBlob(out, 'image/jpeg', 0.88), base: baseBlob, thumb: await Imaging.toBlob(Imaging.scaleCanvas(out, 280), 'image/jpeg', 0.75) });
      } finally { Busy.hide(); }
      await Layers.back();
      toast('Đã lưu chữ ký & ghi chú');
    }
    window.addEventListener('resize', layout);
    drawBar();
    await nextFrame(); layout();
  }
  return { open, bake, draw, pickSignature, signaturePad };
})();
