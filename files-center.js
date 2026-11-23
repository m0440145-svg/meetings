// مركز المرفقات (الترحيل 021): يعرض مرفقات الاجتماعات الحقيقية التي يحق للمستخدم رؤيتها، ويسجّل قراءة كل ملف عند فتحه،
// ويعرض للمدير وأمين السر نسبة القراءة وأسماء القرّاء، مع رفع ملفات لاجتماع. يعتمد على جدول attachments ومخزن meeting-files الموجودين.
// يستبدل الواجهة المحلية التجريبية فقط إن كان الترحيل مطبّقًا؛ وإلا تبقى كما هي.
(() => {
  'use strict';
  const ui = window.ehsanUI;
  if (!ui) return;
  const {esc, toast, onOpen, session, waitDb} = ui;
  let db, me, files = [], mine = new Set(), stats = new Map(), meetings = [];
  const fDate = s => { const d = new Date(s); return isNaN(d) ? '' : d.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn'); };
  const size = b => !b ? '' : b < 1024 * 1024 ? Math.max(1, Math.round(b / 1024)) + ' ك.ب' : (b / 1024 / 1024).toFixed(1) + ' م.ب';

  const CSS = `
.fc-bar{display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:12px}
.fc-bar label{margin:0;flex:1 1 220px}
.fc-list{display:grid;gap:10px}
.fc-row{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center}
.fc-name{font-weight:700;word-break:break-word}
.fc-meta{display:flex;flex-wrap:wrap;gap:8px;font-size:12.5px;color:var(--muted,#6b5f59)}
.fc-acts{display:flex;gap:6px;flex-wrap:wrap}
.fc-bar2{background:var(--line,#eadfd8);border-radius:999px;height:8px;overflow:hidden;width:120px;display:inline-block;vertical-align:middle}
.fc-bar2 i{display:block;height:100%;background:linear-gradient(90deg,#cf6028,#f18927)}
.fc-names{font-size:12.5px;color:var(--muted,#6b5f59);margin-top:4px}
@media(max-width:560px){.fc-row{grid-template-columns:1fr}}`;

  function paint() {
    const q = document.getElementById('fcQ').value.trim().toLowerCase(), mt = document.getElementById('fcMeeting').value;
    const list = files.filter(f => (!mt || f.meeting_id === mt) && (!q || (f.file_name || '').toLowerCase().includes(q) || (f.meetings?.title || '').toLowerCase().includes(q)));
    document.getElementById('fcList').innerHTML = list.map(f => {
      const s = stats.get(f.id), pct = s && s.audience ? Math.min(100, Math.round(s.readers / s.audience * 100)) : 0;
      const read = mine.has(f.id);
      return `<article class="card fc-row" data-id="${esc(f.id)}"><div><div class="fc-name">${esc(f.file_name)}</div>
        <div class="fc-meta"><span>${esc(f.meetings?.title || 'اجتماع')}</span><span>${esc(fDate(f.created_at))}</span><span>${esc(size(f.size_bytes))}</span><span class="badge ${read ? 'good' : 'warn'}">${read ? 'قرأته' : 'لم تقرأه بعد'}</span></div>
        ${s ? `<div class="fc-meta" style="margin-top:4px"><span>القراءة: ${s.readers}${s.audience ? ' من ' + s.audience : ''}</span>${s.audience ? `<span class="fc-bar2" aria-hidden="true"><i style="width:${pct}%"></i></span><span>${pct}%</span>` : ''}</div>${s.reader_names?.length ? `<div class="fc-names">قرأه: ${esc(s.reader_names.join('، '))}</div>` : ''}` : ''}</div>
        <div class="fc-acts"><button type="button" class="btn primary small" data-fc-open>فتح</button></div></article>`;
    }).join('') || '<div class="card">لا مرفقات مطابقة.</div>';
  }

  async function load() {
    const [f, r] = await Promise.all([
      db.from('attachments').select('id,meeting_id,file_name,storage_path,mime_type,size_bytes,created_at,meetings(title)').order('created_at', {ascending: false}).limit(500),
      db.from('attachment_reads').select('attachment_id').eq('user_id', me.uid)
    ]);
    if (f.error) { toast('تعذر تحميل المرفقات'); return; }
    files = f.data || []; mine = new Set((r.data || []).map(x => x.attachment_id));
    stats = new Map();
    if (me.admin) { const s = await db.rpc('attachment_read_stats'); (s.data || []).forEach(x => stats.set(x.attachment_id, x)); }
    const ids = [...new Set(files.map(x => x.meeting_id))];
    const sel = document.getElementById('fcMeeting'), keep = sel.value;
    sel.innerHTML = '<option value="">كل الاجتماعات</option>' + ids.map(id => `<option value="${esc(id)}">${esc(files.find(x => x.meeting_id === id)?.meetings?.title || 'اجتماع')}</option>`).join('');
    if (ids.includes(keep)) sel.value = keep;
    paint();
  }

  async function open(id) {
    const f = files.find(x => x.id === id); if (!f) return;
    const w = window.open('', '_blank'); // يُفتح فورًا ضمن نقرة المستخدم حتى لا يحجبه المتصفح
    const {data, error} = await db.storage.from('meeting-files').createSignedUrl(f.storage_path, 120);
    if (error || !data?.signedUrl) { if (w) w.close(); return toast('تعذر فتح الملف'); }
    if (w) { w.opener = null; w.location = data.signedUrl; } else window.open(data.signedUrl, '_blank', 'noopener');
    const r = await db.rpc('attachment_mark_read', {p_attachment: id});
    if (!r.error && !mine.has(id)) { mine.add(id); if (me.admin) await load(); else paint(); }
  }

  async function upload() {
    if (!window.DM?.form) return toast('النموذج غير جاهز بعد، أعد المحاولة');
    const {data} = await db.from('meetings').select('id,title,gregorian_date').order('gregorian_date', {ascending: false}).limit(150);
    meetings = data || [];
    if (!meetings.length) return toast('لا اجتماعات لإرفاق الملفات بها');
    await window.DM.form({
      title: 'رفع مرفقات لاجتماع', submit: 'رفع',
      fields: [
        {name: 'meeting', label: 'الاجتماع', type: 'select', required: true, options: meetings.map(m => ({value: m.id, label: `${m.title}${m.gregorian_date ? ' — ' + m.gregorian_date : ''}`}))},
        {name: 'files', label: 'الملفات', type: 'file', multiple: true, required: true, help: 'يمكن اختيار أكثر من ملف'}
      ],
      onSubmit: async v => {
        const failed = [];
        for (const file of v.files) {
          const ext = (file.name.match(/\.[A-Za-z0-9]{1,8}$/) || [''])[0];
          const path = `${v.meeting}/${crypto.randomUUID()}${ext}`;
          const up = await db.storage.from('meeting-files').upload(path, file);
          const rec = up.error ? up : await db.from('attachments').insert({meeting_id: v.meeting, file_name: file.name, storage_path: path, mime_type: file.type, size_bytes: file.size, uploaded_by: me.uid});
          if (rec.error) failed.push(`${file.name} (${rec.error.message})`);
        }
        if (failed.length) throw new Error('تعذر رفع: ' + failed.join('، '));
        toast('تم رفع الملفات');
        await load();
      }
    });
  }

  function build() {
    const sec = document.getElementById('view-files'); if (!sec) return false;
    const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
    sec.innerHTML = `<div class="section-head"><div><span class="eyebrow">مركز المرفقات</span><h2>الملفات وتتبع القراءة</h2></div>${me.admin ? '<button type="button" class="btn primary" id="fcUpload">＋ رفع ملفات</button>' : ''}</div>
      <div class="fc-bar"><label>بحث<input id="fcQ" type="search" placeholder="اسم الملف أو الاجتماع" maxlength="100" /></label><label>الاجتماع<select id="fcMeeting"></select></label></div>
      <div class="fc-list" id="fcList"></div>
      <p class="muted" style="font-size:12.5px">تُسجَّل قراءتك عند فتح الملف${me.admin ? '؛ ونسبة القراءة تُحسب من المدعوين للاجتماع، وإلا من أعضاء لجنته' : ''}.</p>`;
    return true;
  }

  async function start() {
    db = await waitDb(); if (!db) return;
    me = await session(db); if (!me) return;
    const probe = await db.from('attachment_reads').select('attachment_id').limit(1);
    if (probe.error) return; // الترحيل 021 غير مطبّق: تبقى الواجهة القديمة كما هي
    if (!build()) return;
    document.getElementById('fcQ').addEventListener('input', paint);
    document.getElementById('fcMeeting').addEventListener('change', paint);
    document.getElementById('fcList').addEventListener('click', e => { const row = e.target.closest('.fc-row'); if (row && e.target.closest('[data-fc-open]')) open(row.dataset.id); });
    document.getElementById('fcUpload')?.addEventListener('click', upload);
    onOpen({files: load});
    document.documentElement.dataset.serverViews = ((document.documentElement.dataset.serverViews || '') + ' files').trim();
    await load();
  }
  start().catch(err => console.error('files-center', err));
})();
