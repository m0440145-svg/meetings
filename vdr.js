// غرفة البيانات الآمنة (الترحيل 023): مستندات سرّية في مخزن خاص بصلاحية لكل مستند، تُعرض داخل المنصة بعلامة مائية باسم المطّلع، ويُسجَّل كل اطلاع.
// العرض: رابط مؤقت (60 ثانية) يُحمَّل في الذاكرة ويُعرض كـ blob، فلا يظهر رابط الملف للمستخدم. العلامة المائية رادعة وليست مانعًا تقنيًا للحفظ أو التصوير.
// يستبدل الواجهة المحلية التجريبية فقط إن كان الترحيل مطبّقًا؛ وإلا تبقى كما هي.
(() => {
  'use strict';
  const ui = window.ehsanUI;
  if (!ui) return;
  const {esc, toast, onOpen, session, waitDb} = ui;
  let db, me, docs = [], committees = [], profiles = [];
  const fDate = s => { const d = new Date(s); return isNaN(d) ? '' : d.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn'); };
  const fDT = s => { const d = new Date(s); return isNaN(d) ? '' : d.toLocaleString('ar-SA-u-ca-gregory-nu-latn', {dateStyle: 'medium', timeStyle: 'short'}); };
  const size = b => !b ? '' : b < 1024 * 1024 ? Math.max(1, Math.round(b / 1024)) + ' ك.ب' : (b / 1024 / 1024).toFixed(1) + ' م.ب';
  const ACTIONS = {view: 'اطلاع', upload: 'رفع', grant: 'منح صلاحية', revoke: 'سحب صلاحية', delete: 'حذف'};
  const MIMES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

  const CSS = `
.vd-list{display:grid;gap:10px}
.vd-row{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center}
.vd-name{font-weight:700}
.vd-meta{display:flex;flex-wrap:wrap;gap:8px;font-size:12.5px;color:var(--muted,#6b5f59)}
.vd-acts{display:flex;gap:6px;flex-wrap:wrap}
.vd-top{background:#3a1f14;color:#ffd9bf;border-radius:12px;padding:9px 14px;margin:0 0 14px;font-size:13.5px;line-height:1.7}
.vd-view{border:0;border-radius:14px;padding:0;width:min(96vw,1000px);height:min(92vh,900px);background:#2b211c;color:#fff}
.vd-view::backdrop{background:rgba(20,14,10,.75)}
.vd-vhead{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 12px;font-size:13.5px}
.vd-stage{position:relative;height:calc(100% - 46px);background:#fff;overflow:hidden;user-select:none}
.vd-stage iframe,.vd-stage img{width:100%;height:100%;border:0;object-fit:contain;display:block}
.vd-wm{position:absolute;inset:-20%;pointer-events:none;display:grid;grid-template-columns:repeat(3,1fr);grid-auto-rows:120px;transform:rotate(-24deg);opacity:.18;z-index:2}
.vd-wm span{color:#a8461a;font-weight:800;font-size:18px;white-space:nowrap;align-self:center;justify-self:center}
.vd-log{margin:0;padding-inline-start:18px;font-size:13px;max-height:50vh;overflow:auto}
@media(max-width:560px){.vd-row{grid-template-columns:1fr}}`;

  function paint() {
    document.getElementById('vdList').innerHTML = docs.map(d => {
      const cm = committees.find(c => c.id === d.committee_id);
      const expired = d.expires_at && new Date(d.expires_at) <= new Date();
      return `<article class="card vd-row" data-id="${esc(d.id)}"><div><div class="vd-name">${esc(d.title)}</div>
        <div class="vd-meta"><span class="badge ${d.confidentiality === 'سري للغاية' ? '' : 'warn'}">${esc(d.confidentiality)}</span><span>${esc(cm ? cm.name : 'بالأسماء فقط')}</span><span>${esc(fDate(d.created_at))}</span><span>${esc(size(d.size_bytes))}</span>${d.expires_at ? `<span>${expired ? 'منتهي' : 'ينتهي'}: ${esc(fDate(d.expires_at))}</span>` : ''}</div>
        ${d.description ? `<div class="vd-meta" style="margin-top:4px">${esc(d.description)}</div>` : ''}</div>
        <div class="vd-acts"><button type="button" class="btn primary small" data-vd-open>عرض</button>${me.admin ? `<button type="button" class="btn ghost small" data-vd-access>الصلاحيات</button><button type="button" class="btn ghost small" data-vd-dl aria-pressed="${d.allow_download ? 'true' : 'false'}">التنزيل: ${d.allow_download ? 'مسموح' : 'ممنوع'}</button><button type="button" class="btn ghost small" data-vd-log>سجل الوصول</button><button type="button" class="btn ghost small" data-vd-del>حذف</button>` : ''}</div></article>`;
    }).join('') || `<div class="card">${me.admin ? 'لا مستندات بعد. اضغط «رفع مستند سري».' : 'لا مستندات متاحة لك في غرفة البيانات.'}</div>`;
  }

  async function load() {
    const q = [db.from('vdr_documents').select('*').order('created_at', {ascending: false}), db.from('committees').select('id,name').order('name')];
    if (me.admin) q.push(db.from('profiles').select('id,full_name').order('full_name'));
    const [d, c, p] = await Promise.all(q);
    if (d.error) { toast('تعذر تحميل غرفة البيانات'); return; }
    docs = d.data || []; committees = c.data || []; profiles = p?.data || [];
    paint();
  }

  async function view(id) {
    const {data: o, error} = await db.rpc('vdr_open', {p_doc: id});
    if (error) return toast(error.message || 'تعذر فتح المستند');
    const d = {title: docs.find(x => x.id === id)?.title || o.file_name || 'مستند'};
    const s = await db.storage.from('vdr-files').createSignedUrl(o.path, 60);
    if (s.error || !s.data?.signedUrl) return toast('تعذر تحميل المستند');
    let url;
    try { const r = await fetch(s.data.signedUrl); if (!r.ok) throw new Error(); url = URL.createObjectURL(new Blob([await r.blob()], {type: o.mime})); }
    catch { return toast('تعذر تحميل المستند'); }
    const dlg = document.createElement('dialog'); dlg.className = 'vd-view'; dlg.setAttribute('aria-label', d.title);
    const marks = Array.from({length: 36}, () => `<span>${esc(o.watermark)}</span>`).join('');
    dlg.innerHTML = `<div class="vd-vhead"><strong>${esc(d.title)}</strong><span>${esc(o.watermark)}</span>${o.allow_download ? '<button type="button" class="btn ghost small" data-dl>تنزيل</button>' : ''}<button type="button" class="btn ghost small" data-x>إغلاق</button></div>
      <div class="vd-stage">${o.mime === 'application/pdf' ? `<iframe title="${esc(d.title)}" src="${url}#toolbar=0&navpanes=0"></iframe>` : `<img alt="${esc(d.title)}" src="${url}" />`}<div class="vd-wm" aria-hidden="true">${marks}</div></div>`;
    const done = () => { URL.revokeObjectURL(url); dlg.remove(); };
    dlg.addEventListener('close', done);
    dlg.addEventListener('contextmenu', e => e.preventDefault());
    dlg.querySelector('[data-x]').addEventListener('click', () => dlg.close());
    dlg.querySelector('[data-dl]')?.addEventListener('click', async () => { // تنزيل مسموح من المدير لهذا المستند: يُسجَّل في سجل الوصول
      const p = await db.rpc('vdr_download', {p_doc: id});
      if (p.error) return toast(p.error.message || 'التنزيل غير مسموح');
      const ext = (p.data.match(/\.[A-Za-z0-9]{1,8}$/) || [''])[0];
      const s2 = await db.storage.from('vdr-files').createSignedUrl(p.data, 60, {download: d.title + ext});
      if (s2.error || !s2.data?.signedUrl) return toast('تعذر تجهيز التنزيل');
      const a = document.createElement('a'); a.href = s2.data.signedUrl; a.rel = 'noopener'; document.body.append(a); a.click(); a.remove();
    });
    document.body.append(dlg); dlg.showModal();
  }

  async function upload() {
    if (!window.DM?.form) return toast('النموذج غير جاهز بعد، أعد المحاولة');
    const opt = (v, l) => ({value: v, label: l});
    await window.DM.form({
      title: 'رفع مستند سري', submit: 'رفع', wide: true,
      intro: 'يطّلع عليه المدير وأمين السر، وأعضاء الجهة المختارة، ومن تمنحه بالاسم. يُقبل PDF والصور فقط (حتى 25 م.ب)، ويُعرض داخل المنصة بعلامة مائية.',
      fields: [
        {name: 'title', label: 'عنوان المستند', required: true, maxlength: 200},
        {name: 'description', label: 'وصف مختصر', type: 'textarea', rows: 2, maxlength: 2000},
        {name: 'conf', label: 'درجة السرية', type: 'select', options: [opt('سري', 'سري'), opt('سري للغاية', 'سري للغاية')]},
        {name: 'committee', label: 'الجهة المخوّلة', type: 'select', options: [opt('', 'لا جهة (بالأسماء فقط)'), ...committees.map(c => opt(c.id, c.name))]},
        {name: 'people', label: 'أشخاص مخوّلون بالاسم', type: 'multi', options: profiles.map(p => opt(p.id, p.full_name || '—'))},
        {name: 'expires', label: 'تاريخ انتهاء الاطلاع (اختياري)', type: 'date'},
        {name: 'file', label: 'الملف', type: 'file', required: true}
      ],
      onSubmit: async v => {
        const f = v.file;
        if (!f) throw new Error('اختر ملفًا');
        if (!MIMES.includes(f.type)) throw new Error('يُقبل PDF أو صورة (PNG / JPEG / WebP) فقط');
        if (f.size > 26214400) throw new Error('حجم الملف أكبر من 25 م.ب');
        const id = crypto.randomUUID(), ext = (f.name.match(/\.[A-Za-z0-9]{1,8}$/) || [''])[0];
        const path = `${id}/${crypto.randomUUID()}${ext}`;
        const up = await db.storage.from('vdr-files').upload(path, f, {contentType: f.type});
        if (up.error) throw new Error('تعذر رفع الملف: ' + up.error.message);
        const ins = await db.from('vdr_documents').insert({id, title: v.title, description: v.description || '', confidentiality: v.conf, committee_id: v.committee || null,
          storage_path: path, mime_type: f.type, size_bytes: f.size, expires_at: v.expires ? new Date(v.expires + 'T23:59:59').toISOString() : null});
        if (ins.error) { await db.storage.from('vdr-files').remove([path]); throw new Error('تعذر حفظ المستند: ' + ins.error.message); }
        if (v.people?.length) await db.from('vdr_access').insert(v.people.map(u => ({doc_id: id, user_id: u})));
        await db.rpc('vdr_log', {p_doc: id, p_action: 'upload'});
        toast('تم رفع المستند');
        await load();
      }
    });
  }

  async function toggleDownload(id) {
    const d = docs.find(x => x.id === id); if (!d) return;
    const next = !d.allow_download;
    if (next && !window.confirm(`السماح بتنزيل «${d.title}»؟ يستطيع كل من يحق له الاطلاع حفظ نسخة منه خارج المنصة، ويُسجَّل كل تنزيل.`)) return;
    const {error} = await db.rpc('vdr_set_download', {p_doc: id, p_allow: next});
    if (error) return toast(error.message || 'تعذر تغيير الإعداد (الترحيل 028 مطلوب)');
    toast(next ? 'سُمح بالتنزيل لهذا المستند' : 'مُنع التنزيل لهذا المستند'); await load();
  }

  async function access(id) {
    const d = docs.find(x => x.id === id); if (!d) return;
    const {data} = await db.from('vdr_access').select('user_id').eq('doc_id', id);
    const cur = (data || []).map(x => x.user_id);
    await window.DM.form({
      title: 'صلاحيات: ' + d.title, submit: 'حفظ',
      intro: 'المدير وأمين السر يطّلعون دائمًا، وأعضاء الجهة المخوّلة كذلك. هنا تمنح أشخاصًا إضافيين بالاسم أو تسحبهم.',
      fields: [{name: 'people', label: 'أشخاص مخوّلون بالاسم', type: 'multi', value: cur, options: profiles.map(p => ({value: p.id, label: p.full_name || '—'}))}],
      onSubmit: async v => {
        const next = new Set(v.people || []), add = [...next].filter(u => !cur.includes(u)), del = cur.filter(u => !next.has(u));
        if (add.length) { const r = await db.from('vdr_access').insert(add.map(u => ({doc_id: id, user_id: u}))); if (r.error) throw new Error(r.error.message); await db.rpc('vdr_log', {p_doc: id, p_action: 'grant'}); }
        if (del.length) { const r = await db.from('vdr_access').delete().eq('doc_id', id).in('user_id', del); if (r.error) throw new Error(r.error.message); await db.rpc('vdr_log', {p_doc: id, p_action: 'revoke'}); }
        toast('تم تحديث الصلاحيات');
      }
    });
  }

  async function log(id) {
    const d = docs.find(x => x.id === id); if (!d) return;
    const {data, error} = await db.from('vdr_access_log').select('action,created_at,user_id').eq('doc_id', id).order('created_at', {ascending: false}).limit(100);
    if (error) return toast('تعذر تحميل السجل');
    const name = u => profiles.find(p => p.id === u)?.full_name || '—';
    const dlg = document.createElement('dialog'); dlg.className = 'dm-dialog'; dlg.setAttribute('aria-label', 'سجل الوصول');
    dlg.innerHTML = `<div class="dm-dlg-head"><h3>سجل الوصول: ${esc(d.title)}</h3><button type="button" class="dm-x" aria-label="إغلاق" data-x>✕</button></div>
      ${(data || []).length ? `<ol class="vd-log">${data.map(x => `<li>${esc(fDT(x.created_at))} — ${esc(name(x.user_id))} — ${esc(ACTIONS[x.action] || x.action)}</li>`).join('')}</ol>` : '<p>لا سجل بعد.</p>'}`;
    dlg.addEventListener('close', () => dlg.remove());
    dlg.querySelector('[data-x]').addEventListener('click', () => dlg.close());
    document.body.append(dlg); dlg.showModal();
  }

  async function remove(id) {
    const d = docs.find(x => x.id === id); if (!d) return;
    if (!window.confirm(`حذف «${d.title}» نهائيًا من غرفة البيانات؟ يبقى أثره في سجل الوصول.`)) return;
    await db.rpc('vdr_log', {p_doc: id, p_action: 'delete'});
    const r = await db.storage.from('vdr-files').remove([d.storage_path]);
    if (r.error) return toast('تعذر حذف الملف: ' + r.error.message);
    const del = await db.from('vdr_documents').delete().eq('id', id);
    if (del.error) return toast('تعذر حذف المستند: ' + del.error.message);
    toast('تم الحذف'); await load();
  }

  function build() {
    const sec = document.getElementById('view-vdr'); if (!sec) return false;
    const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
    sec.innerHTML = `<div class="section-head"><div><span class="eyebrow">VDR</span><h2>غرفة البيانات الآمنة</h2></div>${me.admin ? '<button type="button" class="btn primary" id="vdUpload">＋ رفع مستند سري</button>' : ''}</div>
      <div class="vd-top" role="note">مستندات سرّية تُعرض داخل المنصة فقط بعلامة مائية باسمك ووقت الاطلاع، ويُسجَّل كل اطلاع. لا تشاركها ولا تصوّرها.</div>
      <div class="vd-list" id="vdList"></div>`;
    return true;
  }

  async function start() {
    db = await waitDb(); if (!db) return;
    me = await session(db); if (!me) return;
    const probe = await db.from('vdr_documents').select('id').limit(1);
    if (probe.error) return; // الترحيل 023 غير مطبّق: تبقى الواجهة القديمة كما هي
    if (!build()) return;
    document.getElementById('vdUpload')?.addEventListener('click', upload);
    document.getElementById('vdList').addEventListener('click', e => {
      const row = e.target.closest('.vd-row'); if (!row) return;
      const id = row.dataset.id;
      if (e.target.closest('[data-vd-open]')) view(id);
      else if (e.target.closest('[data-vd-access]')) access(id);
      else if (e.target.closest('[data-vd-dl]')) toggleDownload(id);
      else if (e.target.closest('[data-vd-log]')) log(id);
      else if (e.target.closest('[data-vd-del]')) remove(id);
    });
    onOpen({vdr: load});
    document.documentElement.dataset.serverViews = ((document.documentElement.dataset.serverViews || '') + ' vdr').trim();
    await load();
  }
  window.ehsanVdr = {view}; // تستخدمه «حزم المجلس» لفتح وثيقة سرية بالعارض نفسه
  start().catch(err => console.error('vdr', err));
})();
