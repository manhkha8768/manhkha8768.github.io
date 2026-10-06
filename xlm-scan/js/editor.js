/* XLM Scan – biên tập trang: bút, tô sáng, tẩy, chữ, chữ ký, con dấu */
'use strict';
const ED_COLORS = ['#111111', '#1a4fd6', '#d0202a', '#0b8a3e', '#ffffff', '#f5c400'];
const STAMPS = ['ĐÃ KIỂM TRA', 'BẢN SAO', 'ĐÃ BÀN GIAO', 'ĐÃ THANH TOÁN', 'ĐÃ DUYỆT', 'HỦY', 'KHẨN'];

async function openEditor(doc, page, onSaved) {
  const L = loading('Đang mở trang…');
  const base = await IP.render(page, 1800, { noAnn: true });
  L.close();
  let ann = JSON.parse(JSON.stringify(page.ann || []));
  const undoS = [], redoS = [];
  let tool = 'pen', color = '#1a4fd6', hlColor = '#f5c400', size = 5, sel = null, fit = null, raf = 0, dirty = false;
  const cv = IP.canvas(base.width, base.height), g = cv.getContext('2d');
  const selBox = h('div', { class: 'ed-sel hidden' });
  const rs = h('div', { class: 'rs' }), rm = h('button', { class: 'rm', onclick: (e) => { e.stopPropagation(); delSel(); } }, '×');
  selBox.append(rs, rm);
  const stage = h('div', { class: 'ed-stage' }, cv, selBox);
  const swatches = h('div', { style: { display: 'flex', gap: '8px' } });
  const range = h('input', { type: 'range', min: 1, max: 20, value: size, oninput: (e) => { size = +e.target.value; } });
  const opts = h('div', { class: 'ed-opts' }, swatches, range);
  const toolsEl = h('div', { class: 'ed-tools' });
  const bUndo = h('button', { class: 'ib', onclick: undo }, ic('undo'));
  const bRedo = h('button', { class: 'ib', onclick: redo }, ic('redo'));
  const screen = h('div', { class: 'screen dark' },
    h('div', { class: 'sbar' }, h('button', { class: 'ib', onclick: () => closeLayer() }, ic('close')), h('div', { class: 't' }, 'Biên tập trang'),
      bUndo, bRedo, h('button', { class: 'btn p', style: { height: '38px' }, onclick: save }, ic('check', 18), ' Lưu')),
    stage, opts, toolsEl);
  pushLayer(screen, () => window.removeEventListener('resize', layout));
  window.addEventListener('resize', layout);

  const TOOLS = [['move', 'hand', 'Chọn'], ['pen', 'pen', 'Bút'], ['hl', 'marker', 'Tô sáng'], ['erase', 'eraser', 'Tẩy trắng'],
    ['text', 'type', 'Chữ'], ['sign', 'sign', 'Chữ ký'], ['stamp', 'stamp', 'Con dấu']];
  function paintTools() {
    toolsEl.innerHTML = '';
    TOOLS.forEach(([t, i, l]) => toolsEl.append(h('button', { class: 'act' + (tool === t ? ' on' : ''), onclick: () => pickTool(t) }, ic(i), l)));
    swatches.innerHTML = '';
    const cur = tool === 'hl' ? hlColor : color;
    (tool === 'hl' ? ['#f5c400', '#5ee36b', '#5ec8ff', '#ff8ad8'] : ED_COLORS).forEach((c) => swatches.append(h('button', {
      class: 'sw' + (c === cur ? ' on' : ''), style: { background: c },
      onclick: () => { if (tool === 'hl') hlColor = c; else color = c; if (sel && 'color' in sel) { snap(); sel.color = c; redraw(); } paintTools(); },
    })));
    opts.classList.toggle('hidden', tool === 'sign');
    range.classList.toggle('hidden', !['pen', 'hl', 'erase'].includes(tool));
    swatches.classList.toggle('hidden', tool === 'erase');
    bUndo.disabled = !undoS.length; bRedo.disabled = !redoS.length;
  }
  async function pickTool(t) {
    if (t === 'sign') {
      const src = await pickSignature();
      if (!src) return;
      const im = await IP.loadSrc(src);
      const w = 0.32, hh = (w * cv.width * im.height) / im.width / cv.height;
      snap();
      sel = { t: 'img', src, x: 0.5 - w / 2, y: 0.62, w, h: hh };
      ann.push(sel); tool = 'move'; paintTools(); redraw();
      toast('Kéo chữ ký đến vị trí cần ký, kéo chấm xanh để đổi cỡ');
      return;
    }
    if (t === 'stamp') {
      const v = await sheet('Chọn con dấu', [...STAMPS.map((s) => ({ label: s, icon: 'stamp' })), { label: 'Dấu kèm ngày hôm nay…', value: '__date', icon: 'stamp' }, { label: 'Tự nhập nội dung…', value: '__custom', icon: 'edit' }]);
      if (!v) return;
      let text = v;
      if (v === '__date') { const k = await sheet('Nội dung dấu', STAMPS.map((s) => ({ label: s }))); if (!k) return; text = k + '\n' + fmtDate(Date.now(), false); }
      if (v === '__custom') { const r = await formSheet('Nội dung con dấu', [{ name: 'v', label: 'Mỗi dòng một hàng chữ', type: 'textarea', value: '' }]); if (!r || !r.v) return; text = r.v; }
      snap();
      sel = { t: 'stamp', text, x: 0.5, y: 0.3, size: 0.045, color: '#d0202a', rot: -8 };
      ann.push(sel); tool = 'move'; paintTools(); redraw();
      return;
    }
    if (t === 'text') {
      const r = await formSheet('Thêm chữ', [{ name: 'v', label: 'Nội dung (có thể nhiều dòng)', type: 'textarea', value: '' },
        { name: 'b', label: 'Chữ đậm', type: 'checkbox', value: false }], 'Thêm');
      if (!r || !r.v) return;
      snap();
      sel = { t: 'text', text: r.v, bold: r.b, x: 0.1, y: 0.1, size: 0.032, color: color === '#ffffff' ? '#111111' : color };
      ann.push(sel); tool = 'move'; paintTools(); redraw();
      toast('Kéo chữ đến vị trí mong muốn');
      return;
    }
    tool = t; if (t !== 'move') sel = null;
    paintTools(); placeSel();
  }
  function layout() {
    const sw = stage.clientWidth, sh = stage.clientHeight;
    const s = Math.min((sw - 24) / cv.width, (sh - 24) / cv.height);
    fit = { s, ox: (sw - cv.width * s) / 2, oy: (sh - cv.height * s) / 2, dw: cv.width * s, dh: cv.height * s };
    Object.assign(cv.style, { left: fit.ox + 'px', top: fit.oy + 'px', width: fit.dw + 'px', height: fit.dh + 'px' });
    placeSel();
  }
  async function redraw() {
    g.drawImage(base, 0, 0);
    await IP.drawAnn(cv, ann);
    placeSel();
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; redraw(); }); }
  function placeSel() {
    if (!sel || tool !== 'move' || !fit) { selBox.classList.add('hidden'); return; }
    const b = IP.annBox(g, sel, cv.width, cv.height);
    if (!b) { selBox.classList.add('hidden'); return; }
    selBox.classList.remove('hidden');
    Object.assign(selBox.style, { left: fit.ox + b.x * fit.dw - 4 + 'px', top: fit.oy + b.y * fit.dh - 4 + 'px', width: b.w * fit.dw + 8 + 'px', height: b.h * fit.dh + 8 + 'px' });
  }
  function snap() { undoS.push(JSON.stringify(ann)); if (undoS.length > 60) undoS.shift(); redoS.length = 0; dirty = true; bUndo.disabled = false; bRedo.disabled = true; }
  function undo() { if (!undoS.length) return; redoS.push(JSON.stringify(ann)); ann = JSON.parse(undoS.pop()); sel = null; paintTools(); redraw(); }
  function redo() { if (!redoS.length) return; undoS.push(JSON.stringify(ann)); ann = JSON.parse(redoS.pop()); sel = null; paintTools(); redraw(); }
  function delSel() { if (!sel) return; snap(); ann = ann.filter((a) => a !== sel); sel = null; redraw(); }
  const norm = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  function hit(p) {
    for (let i = ann.length - 1; i >= 0; i--) {
      const b = IP.annBox(g, ann[i], cv.width, cv.height);
      if (b && p[0] >= b.x - 0.02 && p[0] <= b.x + b.w + 0.02 && p[1] >= b.y - 0.02 && p[1] <= b.y + b.h + 0.02) return ann[i];
    }
    return null;
  }

  stage.addEventListener('pointerdown', (e) => {
    if (e.target === rs || e.target === rm) return;
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    const p0 = norm(e);
    let mv, up;
    if (tool === 'pen' || tool === 'hl' || tool === 'erase') {
      snap();
      const w = (size / 1000) * (tool === 'pen' ? 1 : tool === 'hl' ? 4 : 5);
      const st = { t: tool, color: tool === 'hl' ? hlColor : color, w, pts: [p0] };
      ann.push(st); schedule();
      mv = (ev) => { st.pts.push(norm(ev)); schedule(); };
    } else if (tool === 'move') {
      sel = hit(p0); placeSel();
      if (!sel) return;
      snap();
      let last = p0;
      mv = (ev) => {
        const p = norm(ev), dx = p[0] - last[0], dy = p[1] - last[1]; last = p;
        sel.x += dx; sel.y += dy; schedule();
      };
    } else return;
    up = () => { stage.removeEventListener('pointermove', mv); stage.removeEventListener('pointerup', up); stage.removeEventListener('pointercancel', up); };
    stage.addEventListener('pointermove', mv); stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
  });
  rs.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!sel) return;
    rs.setPointerCapture(e.pointerId);
    snap();
    const b0 = IP.annBox(g, sel, cv.width, cv.height), p0 = norm(e);
    const s0 = { size: sel.size, w: sel.w, h: sel.h };
    const mv = (ev) => {
      const p = norm(ev);
      const k = Math.max(0.15, (b0.w + (p[0] - p0[0]) * (sel.t === 'stamp' ? 2 : 1)) / b0.w);
      if (sel.t === 'img') { sel.w = s0.w * k; sel.h = s0.h * k; } else sel.size = s0.size * k;
      schedule();
    };
    const up = () => { rs.removeEventListener('pointermove', mv); rs.removeEventListener('pointerup', up); };
    rs.addEventListener('pointermove', mv); rs.addEventListener('pointerup', up);
  });

  async function save() {
    const L2 = loading('Đang lưu trang…');
    try {
      page.ann = ann;
      const c = await IP.render(page, maxSideFor());
      page.out = await IP.toBlob(c, 'image/jpeg', S.quality === 'high' ? 0.86 : 0.78);
      page.thumb = await IP.toBlob(IP.scaleCanvas(c, 360), 'image/jpeg', 0.72);
      page.w = c.width; page.h = c.height;
      await DB.put('pages', page);
      if (doc.pageIds[0] === page.id) await refreshCover(doc); else { doc.updated = Date.now(); await DB.put('docs', doc); }
      L2.close(); dirty = false;
      closeLayer(); toast('Đã lưu chỉnh sửa');
      onSaved && onSaved();
    } catch (e) { L2.close(); toast('Lỗi lưu: ' + e.message); }
  }
  paintTools();
  requestAnimationFrame(() => { layout(); redraw(); });
}

/* ---------- chữ ký tay: vẽ, lưu, dùng lại ---------- */
async function pickSignature() {
  let sigs = (await DB.get('kv', 'signatures')) || [];
  return new Promise((resolve) => {
    let val = null, inkColor = '#0b2e8a', strokes = 0;
    const pad = h('canvas', { class: 'sigpad' });
    const list = h('div', { class: 'siglist' });
    function paintList() {
      list.innerHTML = '';
      if (!sigs.length) list.append(h('div', { style: { color: 'var(--muted)', fontSize: '13px' } }, 'Chưa có chữ ký đã lưu.'));
      sigs.forEach((s, i) => list.append(h('button', { onclick: () => { val = s; closeLayer(); } }, h('img', { src: s, alt: '' }),
        h('i', { onclick: async (e) => { e.stopPropagation(); sigs.splice(i, 1); await DB.put('kv', sigs, 'signatures'); paintList(); } }, '×'))));
    }
    const colorBtns = ['#111111', '#0b2e8a', '#d0202a'].map((c) => h('button', { class: 'sw', style: { width: '26px', height: '26px', borderRadius: '50%', background: c, border: '2px solid #ddd' }, onclick: () => { inkColor = c; } }));
    const body = h('div', { class: 'form' },
      h('div', { style: { fontSize: '13px', color: 'var(--muted)' } }, 'Chữ ký đã lưu (bấm để dùng):'), list,
      h('div', { style: { fontSize: '13px', color: 'var(--muted)', marginTop: '6px', display: 'flex', alignItems: 'center', gap: '8px' } }, 'Ký mới vào khung dưới:', h('span', { style: { flex: 1 } }), colorBtns),
      pad,
      h('div', { class: 'btns' },
        h('button', { class: 'btn w', onclick: clear }, 'Xoá khung'),
        h('button', { class: 'btn p w', onclick: useNew }, 'Lưu & dùng')));
    const mask = h('div', { class: 'mask', onclick: (e) => { if (e.target === mask) closeLayer(); } },
      h('div', { class: 'sheet' }, h('div', { class: 'grab' }), h('h4', null, 'Chữ ký'), body));
    pushLayer(mask, () => setTimeout(() => resolve(val), 0));
    paintList();
    const ctx = pad.getContext('2d');
    requestAnimationFrame(() => { const dpr = window.devicePixelRatio || 1; pad.width = pad.clientWidth * dpr; pad.height = pad.clientHeight * dpr; });
    function clear() { ctx.clearRect(0, 0, pad.width, pad.height); strokes = 0; }
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault(); pad.setPointerCapture(e.pointerId);
      const r = pad.getBoundingClientRect(), k = pad.width / r.width;
      let last = [(e.clientX - r.left) * k, (e.clientY - r.top) * k];
      ctx.strokeStyle = inkColor; ctx.lineCap = ctx.lineJoin = 'round';
      strokes++;
      const mv = (ev) => {
        const p = [(ev.clientX - r.left) * k, (ev.clientY - r.top) * k];
        const d = Math.hypot(p[0] - last[0], p[1] - last[1]);
        ctx.lineWidth = Math.max(1.6 * k, Math.min(3.6 * k, 3.6 * k - d * 0.08));
        ctx.beginPath(); ctx.moveTo(last[0], last[1]);
        ctx.quadraticCurveTo(last[0], last[1], (last[0] + p[0]) / 2, (last[1] + p[1]) / 2);
        ctx.lineTo(p[0], p[1]); ctx.stroke();
        last = p;
      };
      const up = () => { pad.removeEventListener('pointermove', mv); pad.removeEventListener('pointerup', up); };
      pad.addEventListener('pointermove', mv); pad.addEventListener('pointerup', up);
    });
    async function useNew() {
      if (!strokes) return toast('Hãy ký vào khung trước');
      const d = ctx.getImageData(0, 0, pad.width, pad.height).data;
      let x0 = pad.width, y0 = pad.height, x1 = 0, y1 = 0;
      for (let y = 0; y < pad.height; y++) for (let x = 0; x < pad.width; x++) if (d[(y * pad.width + x) * 4 + 3] > 20) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      if (x1 <= x0) return toast('Chữ ký trống');
      const m = 6, c = IP.canvas(x1 - x0 + 2 * m, y1 - y0 + 2 * m);
      c.getContext('2d').drawImage(pad, x0 - m, y0 - m, c.width, c.height, 0, 0, c.width, c.height);
      val = c.toDataURL('image/png');
      sigs = [val, ...sigs].slice(0, 6);
      await DB.put('kv', sigs, 'signatures');
      closeLayer();
    }
  });
}
