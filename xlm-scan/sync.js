'use strict';
/* XLM Scan — tài khoản, đồng bộ nhiều máy và chia sẻ bằng link (Supabase)
   Dữ liệu vẫn nằm trên máy; khi đăng nhập, tài liệu được sao lên kho riêng của tài khoản và kéo về các máy khác. */
const Sync = (() => {
  // Địa chỉ dự án & khóa công khai (anon) — khóa này được thiết kế để nằm trong app, quyền do RLS kiểm soát
  const DEFAULT_CFG = { url: 'https://gymmsslffbgvhvpgvwsk.supabase.co', anon: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5bW1zc2xmZmJndmh2cGd2d3NrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczOTg3NzIsImV4cCI6MjEwMjk3NDc3Mn0.xWTHLyiiu9g79FyMHPlndjuQF_fkg94tHDeUS8NQWZw' };
  const BUCKET = 'xlmscan';
  let client = null, running = null, timer = null;

  async function cfg() { return { ...DEFAULT_CFG, ...((await DB.get('kv', 'syncCfg')) || {}) }; }
  async function sb() {
    if (client) return client;
    const c = await cfg();
    if (!c.url || !c.anon) return null;
    await loadScript('vendor/supabase.js');
    client = supabase.createClient(c.url, c.anon, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'xlmscan-auth' } });
    return client;
  }
  async function user() { const c = await sb(); if (!c) return null; const { data } = await c.auth.getSession(); return data.session?.user || null; }
  async function state() { return (await DB.get('kv', 'syncState')) || { docs: {}, pages: {}, meta: {}, at: 0, tomb: [] }; }
  async function saveState(s) { await DB.put('kv', s, 'syncState'); }

  const BLOBS = ['image', 'thumb', 'base', 'source'];
  const stripPage = p => { const m = { ...p }; BLOBS.forEach(k => delete m[k]); delete m.sources; m.has = BLOBS.filter(k => p[k]); m.nsrc = (p.sources || []).length; return m; };
  const path = (uid, pid, k) => `${uid}/p/${pid}/${k}.jpg`;

  async function up(c, uid, pid, k, blob) {
    const { error } = await c.storage.from(BUCKET).upload(path(uid, pid, k), blob, { upsert: true, contentType: blob.type || 'image/jpeg', cacheControl: '31536000' });
    if (error) throw new Error('Tải ảnh lên lỗi: ' + error.message);
  }
  async function down(c, uid, pid, k) {
    const { data, error } = await c.storage.from(BUCKET).download(path(uid, pid, k));
    if (error) throw new Error('Tải ảnh về lỗi: ' + error.message);
    return data;
  }

  /** Đồng bộ 2 chiều. Trả về { pushed, pulled } */
  async function run({ quiet = false } = {}) {
    if (running) return running;
    running = (async () => {
      const c = await sb(); const u = await user();
      if (!c || !u) throw new Error('Chưa đăng nhập tài khoản đồng bộ');
      if (!navigator.onLine) throw new Error('Không có mạng');
      const uid = u.id, st = await state();
      const withSource = !!State.settings.syncSource;
      let pushed = 0, pulled = 0;
      const prog = (m, f) => !quiet && Busy.update(m, f);
      if (!quiet) Busy.show('Đang đồng bộ…');
      try {
        /* ---- 1. xóa hẳn trên máy chủ các tài liệu đã xóa vĩnh viễn ở máy này */
        for (const t of st.tomb.splice(0)) {
          await c.from('xlmscan_pages').delete().eq('doc_id', t.id);
          // giữ dấu "đã xóa hẳn" để các máy khác cũng xóa
          const tmt = Date.now();
          await c.from('xlmscan_docs').upsert({ id: t.id, owner: uid, data: { id: t.id, purged: true }, mt: tmt });
          st.docs[t.id] = tmt;
          const files = (t.pages || []).flatMap(pid => BLOBS.concat(['s0', 's1']).map(k => path(uid, pid, k)));
          if (files.length) await c.storage.from(BUCKET).remove(files);
        }
        /* ---- 2. kéo về: tài liệu thay đổi từ lần trước */
        prog('Đang kiểm tra máy chủ…');
        const { data: rdocs, error: e1 } = await c.from('xlmscan_docs').select('id,data,mt').gt('mt', st.at || 0).order('mt').limit(1000);
        if (e1) throw new Error(e1.message);
        for (let i = 0; i < rdocs.length; i++) {
          const r = rdocs[i];
          const local = await DB.get('docs', r.id);
          if (r.data.purged) {
            if (local) { for (const pid of local.pageIds) { await DB.del('pages', pid, true); forgetPage(pid); } await DB.del('docs', r.id, true); }
            st.docs[r.id] = r.mt; continue;
          }
          if (local && (local.mt || 0) >= r.mt) continue;
          prog(`Đang tải về "${r.data.name}"…`, i / Math.max(1, rdocs.length));
          const { data: rpages, error: e2 } = await c.from('xlmscan_pages').select('id,meta,mt').eq('doc_id', r.id);
          if (e2) throw new Error(e2.message);
          for (const rp of rpages) {
            const lp = await DB.get('pages', rp.id);
            if (lp && (lp.mt || 0) >= rp.mt) continue;
            const pg = { ...rp.meta };
            for (const k of rp.meta.has || []) pg[k] = await down(c, uid, rp.id, k);
            if (rp.meta.nsrc) { pg.sources = []; for (let s = 0; s < rp.meta.nsrc; s++) pg.sources.push(await down(c, uid, rp.id, 's' + s)); }
            if (!pg.source && !pg.sources) pg.source = pg.image; // chỉ có ảnh kết quả: dùng làm gốc để sửa tiếp
            delete pg.has; delete pg.nsrc; pg.mt = rp.mt;
            await DB.put('pages', pg, undefined, true); forgetPage(pg.id);
            st.pages[pg.id] = rp.mt;
          }
          await DB.put('docs', { ...r.data, mt: r.mt }, undefined, true);
          st.docs[r.id] = r.mt; pulled++;
        }
        /* ---- 3. đẩy lên: tài liệu sửa ở máy này */
        const docs = await DB.all('docs');
        const changed = docs.filter(d => (d.mt || d.updatedAt || 0) > (st.docs[d.id] || 0));
        for (let i = 0; i < changed.length; i++) {
          const d = changed[i];
          prog(`Đang tải lên "${d.name}"…`, i / Math.max(1, changed.length));
          for (const pid of d.pageIds) {
            const p = await DB.get('pages', pid);
            if (!p) continue;
            const pmt = p.mt || p.createdAt || 1;
            if (pmt <= (st.pages[pid] || 0)) continue;
            for (const k of ['image', 'thumb', 'base']) if (p[k]) await up(c, uid, pid, k, p[k]);
            if (withSource && p.source && p.source !== p.image) await up(c, uid, pid, 'source', p.source);
            if (withSource && p.sources) for (let s = 0; s < p.sources.length; s++) await up(c, uid, pid, 's' + s, p.sources[s]);
            const meta = stripPage(p);
            if (!withSource) { meta.has = meta.has.filter(k => k !== 'source'); meta.nsrc = 0; }
            const { error } = await c.from('xlmscan_pages').upsert({ id: pid, owner: uid, doc_id: d.id, meta, mt: pmt });
            if (error) throw new Error(error.message);
            st.pages[pid] = pmt;
          }
          const mt = d.mt || d.updatedAt;
          const { error } = await c.from('xlmscan_docs').upsert({ id: d.id, owner: uid, data: d, mt });
          if (error) throw new Error(error.message);
          st.docs[d.id] = mt; pushed++;
        }
        /* ---- 4. thư mục, danh sách tài sản, chữ ký */
        for (const [key, get, set] of [
          ['folders', () => DB.all('folders'), async v => { await DB.clear('folders'); await DB.putMany('folders', v); }],
          ['assets', () => DB.all('assets'), async v => { await DB.putMany('assets', v); }],
        ]) {
          const localMt = (await DB.get('kv', 'mt:' + key)) || 0;
          const { data: rm } = await c.from('xlmscan_meta').select('value,mt').eq('key', key).maybeSingle();
          if (rm && rm.mt > localMt) { await set(rm.value); await DB.put('kv', rm.mt, 'mt:' + key); }
          else if (localMt > (st.meta[key] || 0) || !rm) {
            const mt = localMt || Date.now();
            await c.from('xlmscan_meta').upsert({ owner: uid, key, value: await get(), mt });
            await DB.put('kv', mt, 'mt:' + key);
          }
          st.meta[key] = Math.max(localMt, rm?.mt || 0);
        }
        st.at = Math.max(st.at || 0, ...rdocs.map(r => r.mt), ...Object.values(st.docs));
        st.last = Date.now();
        await saveState(st);
        await loadAll();
        return { pushed, pulled };
      } finally { if (!quiet) Busy.hide(); }
    })();
    try { return await running; } finally { running = null; }
  }
  /** Hẹn đồng bộ tự động sau khi có thay đổi */
  function schedule(ms = 8000) {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!State.settings.autoSync || !navigator.onLine) return;
      try { const u = await user(); if (!u) return; const r = await run({ quiet: true }); if (r.pulled) refresh(); } catch (e) { console.warn('sync', e); }
    }, ms);
  }
  async function tombstone(doc) {
    const st = await state();
    if (st.docs[doc.id]) { st.tomb.push({ id: doc.id, pages: doc.pageIds.slice() }); delete st.docs[doc.id]; doc.pageIds.forEach(p => delete st.pages[p]); await saveState(st); schedule(); }
  }

  /* ---------- tài khoản */
  async function accountSheet() {
    const c = await sb();
    if (!c) { await configSheet(); return; }
    const u = await user();
    if (u) {
      const st = await state();
      const v = await menuSheet(`Tài khoản: ${u.email}`, [
        { icon: 'sync', label: `Đồng bộ ngay${st.last ? ' · lần trước ' + fmtDate(st.last) : ''}`, value: 'sync' },
        { icon: 'sync', label: State.settings.autoSync ? 'Tắt tự động đồng bộ' : 'Bật tự động đồng bộ', value: 'auto' },
        { icon: 'image', label: State.settings.syncSource ? 'Không đồng bộ ảnh gốc (nhẹ hơn)' : 'Đồng bộ cả ảnh gốc (sửa lại được ở máy khác)', value: 'src' },
        { icon: 'back', label: 'Đăng xuất', value: 'out', danger: true },
      ]);
      if (v === 'sync') await syncNow();
      else if (v === 'auto') { State.settings.autoSync = !State.settings.autoSync; await saveSettings(); toast(State.settings.autoSync ? 'Đã bật tự động đồng bộ' : 'Đã tắt tự động đồng bộ'); }
      else if (v === 'src') { State.settings.syncSource = !State.settings.syncSource; await saveSettings(); }
      else if (v === 'out' && await confirmBox('Đăng xuất tài khoản đồng bộ?', 'Tài liệu trên máy này vẫn giữ nguyên. Máy này sẽ ngừng đồng bộ.', 'Đăng xuất', 'primary')) { await c.auth.signOut(); toast('Đã đăng xuất'); }
      refresh(); return;
    }
    const email = el('input', { type: 'email', id: 'sb-email', autocomplete: 'username', placeholder: 'ten@congty.vn' });
    const pw = el('input', { type: 'password', id: 'sb-pw', autocomplete: 'current-password', placeholder: 'Ít nhất 6 ký tự' });
    const v = await sheet({
      title: 'Đăng nhập để đồng bộ', sub: 'Dùng cùng tài khoản trên điện thoại và máy tính để thấy chung tài liệu.',
      body: [el('div', { class: 'field' }, el('label', { for: 'sb-email' }, 'Email'), email), el('div', { class: 'field' }, el('label', { for: 'sb-pw' }, 'Mật khẩu'), pw)],
      actions: [{ label: 'Tạo tài khoản', value: 'up' }, { label: 'Đăng nhập', kind: 'primary', value: 'in' }],
    });
    if (!v) return;
    const e = email.value.trim(), p = pw.value;
    if (!e || p.length < 6) { toast('Nhập email và mật khẩu (ít nhất 6 ký tự)'); return; }
    Busy.show(v === 'up' ? 'Đang tạo tài khoản…' : 'Đang đăng nhập…');
    const r = v === 'up' ? await c.auth.signUp({ email: e, password: p }) : await c.auth.signInWithPassword({ email: e, password: p });
    Busy.hide();
    if (r.error) { toast((v === 'up' ? 'Không tạo được tài khoản: ' : 'Đăng nhập lỗi: ') + viErr(r.error.message), 5000); return; }
    if (v === 'up' && !r.data.session) { toast('Đã tạo tài khoản. Mở email xác nhận rồi đăng nhập lại.', 6000); return; }
    State.settings.autoSync = true; await saveSettings();
    toast('Đã đăng nhập'); await syncNow(); refresh();
  }
  const viErr = m => /Invalid login/i.test(m) ? 'sai email hoặc mật khẩu' : /already registered/i.test(m) ? 'email này đã có tài khoản' : /Email not confirmed/i.test(m) ? 'email chưa được xác nhận' : m;
  async function syncNow() {
    try { const r = await run(); toast(`Đã đồng bộ: gửi lên ${r.pushed}, tải về ${r.pulled} tài liệu`); refresh(); }
    catch (e) { toast('Đồng bộ lỗi: ' + e.message, 5000); }
  }
  /** Nhập địa chỉ máy chủ (chỉ quản trị viên cần làm) */
  async function configSheet() {
    const c = await cfg();
    const url = el('input', { type: 'url', id: 'sb-url', value: c.url, placeholder: 'https://xxxx.supabase.co' });
    const key = el('textarea', { id: 'sb-anon', rows: 3, placeholder: 'eyJhbGciOi…', style: 'font-family:var(--mono);font-size:12px' }, c.anon);
    const v = await sheet({
      title: 'Máy chủ đồng bộ', sub: 'Địa chỉ dự án Supabase và khóa công khai (anon). Quản trị viên nhập một lần.',
      body: [el('div', { class: 'field' }, el('label', { for: 'sb-url' }, 'Project URL'), url), el('div', { class: 'field' }, el('label', { for: 'sb-anon' }, 'Khóa anon public'), key)],
      actions: [{ label: 'Hủy', value: null }, { label: 'Lưu', kind: 'primary', value: () => ({ url: url.value.trim().replace(/\/$/, ''), anon: key.value.trim() }) }],
    });
    if (!v) return;
    await DB.put('kv', v, 'syncCfg'); client = null; toast('Đã lưu máy chủ đồng bộ');
  }

  /* ---------- chia sẻ bằng link */
  async function shareLink(doc) {
    const c = await sb(); const u = await user();
    if (!c || !u) { toast('Đăng nhập tài khoản đồng bộ để tạo link chia sẻ'); await accountSheet(); if (!(await user())) return; }
    const days = await menuSheet('Link có hiệu lực trong', [[1, '1 ngày'], [7, '7 ngày'], [30, '30 ngày']].map(([d, l]) => ({ icon: 'clock', label: l, value: String(d) })));
    if (!days) return;
    Busy.show('Đang tạo PDF…');
    try {
      const cl = await sb(), uu = await user();
      const pdf = await Exporter.pdf(doc, { size: State.settings.pdfSize, compress: true, textLayer: true, progress: (m, f) => Busy.update(m, f) });
      Busy.update('Đang tải lên…', null);
      const token = uid() + uid();
      const p = `${uu.id}/share/${token}/${fold(safeName(doc.name)).replace(/[^\w.\- ]/g, '-').replace(/\s+/g, '-').slice(0, 60) || 'tai-lieu'}.pdf`;
      const { error } = await cl.storage.from(BUCKET).upload(p, pdf, { contentType: 'application/pdf', upsert: false });
      if (error) throw new Error(error.message);
      const { data, error: e2 } = await cl.storage.from(BUCKET).createSignedUrl(p, +days * 86400, { download: false });
      if (e2) throw new Error(e2.message);
      Busy.hide();
      const link = data.signedUrl;
      const box = el('div', { class: 'code-result' }, link);
      const v = await sheet({
        title: 'Link chia sẻ đã sẵn sàng', sub: `Ai có link đều mở được file PDF trong ${days} ngày. Không cần cài app.`, body: box,
        actions: [{ label: 'Sao chép link', value: 'copy' }].concat(navigator.share ? [{ label: 'Gửi (Zalo, Gmail…)', kind: 'primary', value: 'share' }] : []),
      });
      if (v === 'copy') copyText(link);
      else if (v === 'share') navigator.share({ title: doc.name, text: doc.name, url: link }).catch(() => {});
    } catch (e) { Busy.hide(); toast('Không tạo được link: ' + e.message, 5000); }
  }

  async function atBoot() {
    const u = await user().catch(() => null);
    if (u && State.settings.autoSync) schedule(1500);
    window.addEventListener('online', () => schedule(2000));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(3000); });
  }
  return { run, schedule, tombstone, accountSheet, configSheet, shareLink, user, atBoot, cfg };
})();
