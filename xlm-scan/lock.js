'use strict';
/* XLM Scan — khóa app và khóa tài liệu bằng mã PIN / vân tay (khóa trên máy, không gửi đi đâu) */
const Lock = (() => {
  let unlockedAt = 0, hiddenAt = 0, showing = null;
  const openedDocs = new Set();
  const enc = s => new TextEncoder().encode(s);
  const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  const b64 = b => btoa(String.fromCharCode(...new Uint8Array(b)));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function hash(pin, salt) {
    const key = await crypto.subtle.importKey('raw', enc(pin), 'PBKDF2', false, ['deriveBits']);
    return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc(salt), iterations: 120000, hash: 'SHA-256' }, key, 256));
  }
  async function cfg() { return (await DB.get('kv', 'lock')) || null; }
  async function saveCfg(c) { await DB.put('kv', c, 'lock'); }
  const bioSupported = async () => !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.().catch(() => false));

  /* ---------- bàn phím số */
  function pad({ title, sub, onDigits, bio, onBio, onCancel, len = 6 }) {
    let val = '';
    const dots = el('div', { class: 'pin-dots', 'aria-live': 'polite' });
    const msg = el('div', { class: 'pin-msg' }, sub || '');
    const draw = () => dots.replaceChildren(...Array.from({ length: len }, (_, i) => el('i', { class: i < val.length ? 'on' : '' })));
    draw();
    const press = async k => {
      if (k === 'del') val = val.slice(0, -1);
      else if (val.length < len) val += k;
      draw();
      if (val.length === len) { const v = val; val = ''; setTimeout(draw, 150); const r = await onDigits(v); if (typeof r === 'string') { msg.textContent = r; dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake'); } }
    };
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', bio ? 'bio' : '', '0', 'del'];
    const root = el('div', { class: 'pin', role: 'dialog', 'aria-label': title },
      el('div', { class: 'pin-top' }, onCancel ? el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Hủy', onclick: onCancel }, icon('close')) : el('span')),
      el('div', { class: 'pin-body' },
        el('div', { class: 'pin-logo' }, icon('lock')),
        el('h2', {}, title), msg, dots,
        el('div', { class: 'pin-keys' }, keys.map(k => k === '' ? el('span') : el('button', {
          type: 'button', class: 'pin-key' + (k === 'del' || k === 'bio' ? ' fn' : ''), 'aria-label': k === 'del' ? 'Xóa' : k === 'bio' ? 'Dùng vân tay' : k,
          onclick: () => k === 'bio' ? onBio() : press(k),
        }, k === 'del' ? icon('back') : k === 'bio' ? icon('finger') : k)))));
    const onKey = e => { if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('del'); };
    window.addEventListener('keydown', onKey);
    root.__off = () => window.removeEventListener('keydown', onKey);
    document.body.append(root);
    return { root, msg };
  }
  async function bioCheck(c) {
    try {
      const cred = await navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), allowCredentials: [{ type: 'public-key', id: unb64(c.bio) }], userVerification: 'required', timeout: 60000 } });
      return !!cred;
    } catch { return false; }
  }
  /** Hiện màn hình khóa. Trả về true khi mở khóa, false khi hủy */
  function prompt(title, { cancelable = false } = {}) {
    return new Promise(async resolve => {
      const c = await cfg();
      if (!c) { resolve(true); return; }
      let done = false;
      const finish = ok => { if (done) return; done = true; p.root.__off(); p.root.remove(); if (ok) unlockedAt = Date.now(); resolve(ok); };
      let tries = 0;
      const p = pad({
        title, sub: 'Nhập mã PIN', len: c.len || 6, bio: !!c.bio,
        onBio: async () => { if (await bioCheck(c)) finish(true); else p.msg.textContent = 'Không xác thực được vân tay. Nhập mã PIN.'; },
        onDigits: async v => { if (await hash(v, c.salt) === c.hash) { finish(true); return; } tries++; return tries >= 5 ? 'Sai mã PIN nhiều lần — đợi 30 giây' : 'Sai mã PIN, thử lại'; },
        onCancel: cancelable ? () => finish(false) : null,
      });
      if (c.bio) setTimeout(async () => { if (!done && await bioCheck(c)) finish(true); }, 300);
    });
  }
  /** Tạo / đổi mã PIN */
  function setup(lockApp = true) {
    return new Promise(resolve => {
      let first = null;
      const p = pad({
        title: 'Tạo mã PIN', sub: 'Nhập mã PIN 6 số', len: 6,
        onCancel: () => { p.root.__off(); p.root.remove(); resolve(false); },
        onDigits: async v => {
          if (!first) { first = v; p.msg.textContent = 'Nhập lại mã PIN để xác nhận'; return; }
          if (v !== first) { first = null; return 'Hai lần nhập không khớp. Nhập lại mã PIN mới'; }
          const old = await cfg() || {};
          const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
          await saveCfg({ ...old, salt, hash: await hash(v, salt), len: 6, lockApp: old.lockApp ?? lockApp, delay: old.delay ?? 60 });
          p.root.__off(); p.root.remove(); unlockedAt = Date.now(); resolve(true);
        },
      });
    });
  }
  async function enrollBio() {
    if (!(await bioSupported())) { toast('Máy này không hỗ trợ mở khóa bằng vân tay trong trình duyệt'); return false; }
    try {
      const cred = await navigator.credentials.create({ publicKey: {
        rp: { name: 'XLM Scan', id: location.hostname }, user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'xlmscan', displayName: 'XLM Scan' },
        challenge: crypto.getRandomValues(new Uint8Array(32)), pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' }, timeout: 60000,
      } });
      const c = await cfg(); c.bio = b64(cred.rawId); await saveCfg(c); toast('Đã bật mở khóa bằng vân tay'); return true;
    } catch (e) { toast('Chưa bật được vân tay: ' + (e.message || e)); return false; }
  }
  /** Mở tài liệu bị khóa: hỏi PIN một lần mỗi phiên */
  async function openDocGate(doc) {
    if (!doc.locked || openedDocs.has(doc.id)) return true;
    const ok = await prompt(`Mở "${doc.name}"`, { cancelable: true });
    if (ok) openedDocs.add(doc.id);
    return ok;
  }
  /** Khóa lại khi app bị ẩn lâu hơn thời gian cài đặt */
  function watch() {
    document.addEventListener('visibilitychange', async () => {
      if (document.hidden) { hiddenAt = Date.now(); return; }
      const c = await cfg();
      if (!c || !c.lockApp || showing) return;
      if (hiddenAt && Date.now() - hiddenAt > (c.delay ?? 60) * 1000) { openedDocs.clear(); showing = prompt('XLM Scan đã khóa'); await showing; showing = null; }
    });
  }
  async function atBoot() {
    watch();
    const c = await cfg();
    if (c && c.lockApp) { showing = prompt('XLM Scan đã khóa'); await showing; showing = null; }
  }
  /** Bảng cài đặt khóa */
  async function settings() {
    let c = await cfg();
    if (!c) {
      if (!(await setup())) return;
      c = await cfg();
      if (await bioSupported() && await confirmBox('Dùng vân tay để mở khóa?', 'Mở XLM Scan nhanh bằng vân tay hoặc khuôn mặt. Mã PIN vẫn dùng được khi cần.', 'Bật vân tay', 'primary')) await enrollBio();
      toast('Đã bật khóa XLM Scan'); return;
    }
    if (!(await prompt('Xác nhận mã PIN hiện tại', { cancelable: true }))) return;
    const bio = await bioSupported();
    const v = await menuSheet('Khóa ứng dụng', [
      { icon: 'lock', label: c.lockApp ? 'Tắt khóa khi mở app' : 'Bật khóa khi mở app', value: 'toggle' },
      { icon: 'clock', label: `Tự khóa sau khi rời app: ${c.delay >= 60 ? c.delay / 60 + ' phút' : c.delay === 0 ? 'ngay' : c.delay + ' giây'}`, value: 'delay' },
      bio && { icon: 'finger', label: c.bio ? 'Tắt mở khóa bằng vân tay' : 'Bật mở khóa bằng vân tay', value: 'bio' },
      { icon: 'edit', label: 'Đổi mã PIN', value: 'change' },
      { icon: 'trash', label: 'Bỏ mã PIN (mở khóa mọi tài liệu)', value: 'remove', danger: true },
    ]);
    if (v === 'toggle') { c.lockApp = !c.lockApp; await saveCfg(c); toast(c.lockApp ? 'Đã bật khóa khi mở app' : 'Đã tắt khóa khi mở app'); }
    else if (v === 'delay') {
      const d = await menuSheet('Tự khóa sau', [[0, 'Ngay khi rời app'], [60, '1 phút'], [300, '5 phút'], [900, '15 phút']].map(([s, l]) => ({ icon: 'clock', label: l, value: String(s) })));
      if (d != null) { c.delay = +d; await saveCfg(c); }
    }
    else if (v === 'bio') { if (c.bio) { delete c.bio; await saveCfg(c); toast('Đã tắt vân tay'); } else await enrollBio(); }
    else if (v === 'change') { if (await setup()) toast('Đã đổi mã PIN'); }
    else if (v === 'remove') {
      if (await confirmBox('Bỏ mã PIN?', 'App và mọi tài liệu đang khóa sẽ mở tự do.', 'Bỏ mã PIN')) {
        await DB.del('kv', 'lock');
        for (const d of State.docs.filter(d => d.locked)) { d.locked = false; await DB.put('docs', d); }
        await loadAll(); toast('Đã bỏ mã PIN'); refresh();
      }
    }
  }
  async function toggleDocLock(doc) {
    let c = await cfg();
    if (!c) { toast('Tạo mã PIN để khóa tài liệu'); if (!(await setup(false))) return false; }
    if (doc.locked && !(await prompt('Xác nhận mã PIN', { cancelable: true }))) return false;
    doc.locked = !doc.locked; doc.updatedAt = Date.now();
    await DB.put('docs', doc); await loadAll();
    if (doc.locked) openedDocs.add(doc.id);
    toast(doc.locked ? 'Đã khóa tài liệu — cần mã PIN để mở' : 'Đã mở khóa tài liệu');
    return true;
  }
  return { atBoot, prompt, setup, settings, openDocGate, toggleDocLock, cfg };
})();
