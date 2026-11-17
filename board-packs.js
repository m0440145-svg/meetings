// حزم المجلس (الترحيل 028): حزمة مرتبة لكل اجتماع تجمع مرفقاته ووثائق غرفة البيانات، يعدّها المدير وأمين السر وتُنشر فيُشعَر أعضاء الاجتماع.
// الحزمة تنظّم ولا تمنح صلاحية: فتح كل عنصر يبقى بصلاحياته الأصلية (المرفقات بسياسات attachments، والوثائق السرية بـ vdr_can_view). يُسجَّل فتح المرفق قراءةً.
// ميزة مضافة: إن لم يكن الترحيل مطبّقًا لا يظهر شيء.
(() => {
  'use strict';
  const ui = window.ehsanUI;
  if (!ui) return;
  const {esc, toast, onOpen, session, waitDb} = ui;
  let db, me, packs = [];
  const fDate = s => { const d = new Date(s); return isNaN(d) ? '' : d.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn'); };
  const size = b => !b ? '' : b < 1024 * 1024 ? Math.max(1, Math.round(b / 1024)) + ' ك.ب' : (b / 1024 / 1024).toFixed(1) + ' م.ب';

  const CSS = `
.bp-list{display:grid;gap:10px}
.bp-row{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center}
.bp-meta{display:flex;flex-wrap:wrap;gap:8px;font-size:12.5px;color:var(--muted,#6b5f59);align-items:center}
.bp-acts{display:flex;gap:6px;flex-wrap:wrap}
.bp-dlg{border:0;border-radius:18px;padding:0;width:min(94vw,760px);max-height:92vh;color:var(--ink,#3a332f);background:var(--card,#fff);box-shadow:0 25px 80px rgba(0,0,0,.35)}
.bp-dlg::backdrop{background:rgba(35,28,24,.5)}
.bp-body{padding:16px 20px;display:grid;gap:12px;max-height:88vh;overflow:auto}
.bp-head{display:flex;justify-content:space-between;align-items:center;gap:10px}.bp-head h3{margin:0}
.bp-x{border:1px solid var(--line,#eadfd8);background:transparent;color:inherit;border-radius:9px;width:34px;height:34px;cursor:pointer}
.bp-item{border:1px solid var(--line,#eadfd8);border-radius:12px;padding:10px 12px;display:grid;grid-template-columns:34px 1fr auto;gap:10px;align-items:center}
.bp-no{width:30px;height:30px;border-radius:50%;background:var(--primary,#cf6028);color:#fff;display:grid;place-items:center;font-weight:800;font-size:14px}
.bp-name{font-weight:700;word-break:break-word}
.bp-sec{display:grid;gap:8px}.bp-sec-h{margin:10px 0 0;font-size:15px;border-inline-start:4px solid var(--primary,#cf6028);padding-inline-start:8px}.bp-item select{max-width:100%}
@media(max-width:560px){.bp-row{grid-template-columns:1fr}.bp-item{grid-template-columns:34px 1fr}.bp-item .bp-acts{grid-column:1/-1}}`;

  async function load() {
    const {data, error} = await db.from('board_packs').select('*,meetings(title,gregorian_date)').order('created_at', {ascending: false}).limit(200);
    if (error) { toast('تعذر تحميل حزم المجلس'); return; }
    packs = data || []; paint();
  }

  function paint() {
    document.getElementById('bpList').innerHTML = packs.map(p => `<article class="card bp-row" data-id="${esc(p.id)}"><div>
        <strong>${esc(p.title)}</strong>
        <div class="bp-meta"><span class="badge ${p.status === 'منشورة' ? 'good' : 'warn'}">${esc(p.status)}</span><span>${esc(p.meetings?.title || 'اجتماع')}${p.meetings?.gregorian_date ? ' — ' + esc(p.meetings.gregorian_date) : ''}</span>${p.published_at ? `<span>نُشرت ${esc(fDate(p.published_at))}</span>` : ''}</div>
        ${p.notes ? `<div class="bp-meta" style="margin-top:4px">${esc(p.notes)}</div>` : ''}</div>
      <div class="bp-acts"><button type="button" class="btn primary small" data-bp-open>فتح الحزمة</button>${me.admin ? `<button type="button" class="btn ghost small" data-bp-pub>${p.status === 'منشورة' ? 'سحب النشر' : 'نشر'}</button><button type="button" class="btn ghost small" data-bp-del>حذف</button>` : ''}</div></article>`).join('')
      || `<div class="card">${me.admin ? 'لا حزم بعد. اضغط «حزمة جديدة».' : 'لا حزم منشورة لاجتماعاتك بعد.'}</div>`;
  }

  function dialog(html) {
    const dlg = document.createElement('dialog'); dlg.className = 'bp-dlg'; dlg.innerHTML = `<div class="bp-body">${html}</div>`;
    dlg.addEventListener('close', () => dlg.remove());
    dlg.addEventListener('click', e => { if (e.target.closest('[data-x]')) dlg.close(); });
    document.body.append(dlg); dlg.showModal(); return dlg;
  }

  async function openAttachment(a) {
    const w = window.open('', '_blank');
    const {data, error} = await db.storage.from('meeting-files').createSignedUrl(a.storage_path, 120);
    if (error || !data?.signedUrl) { if (w) w.close(); return toast('تعذر فتح الملف'); }
    if (w) { w.opener = null; w.location = data.signedUrl; } else window.open(data.signedUrl, '_blank', 'noopener');
    db.rpc('attachment_mark_read', {p_attachment: a.id}).then(() => {}, () => {}); // تسجيل القراءة إن كان الترحيل 021 مطبّقًا
  }

  async function openPack(id) {
    const [{data: p}, {data: items, error}] = await Promise.all([
      db.from('board_packs').select('*,meetings(title,gregorian_date)').eq('id', id).single(),
      db.from('board_pack_items').select('*,attachments(id,file_name,size_bytes,storage_path),vdr_documents(id,title,confidentiality)').eq('pack_id', id).order('position')
    ]);
    if (error || !p) return toast('تعذر فتح الحزمة');
    const rows = items || [];
    const [ag, rd, st] = await Promise.all([
      db.from('agenda_items').select('id,item_order,title').eq('meeting_id', p.meeting_id).order('item_order'),
      db.from('attachment_reads').select('attachment_id').eq('user_id', me.uid),
      me.admin ? db.rpc('attachment_read_stats') : Promise.resolve({data: []})
    ]);
    const agenda = ag.data || [], mine = new Set((rd.data || []).map(x => x.attachment_id)), stats = new Map((st.data || []).map(x => [x.attachment_id, x]));
    // التجميع: بنود جدول الأعمال بترتيبها، ثم «عناصر عامة» لما لا بند له؛ داخل كل مجموعة بترتيب position
    const groups = [...agenda.map(a => ({key: a.id, title: `${a.item_order}. ${a.title}`, items: []})), {key: '', title: 'عناصر عامة (غير مرتبطة ببند)', items: []}];
    const byKey = new Map(groups.map(g => [g.key, g]));
    rows.forEach(r => (byKey.get(r.agenda_item_id || '') || byKey.get('')).items.push(r));
    groups.forEach(g => g.items.sort((a, b) => (a.position || 0) - (b.position || 0)));
    const visible = groups.filter(g => g.items.length || (me.admin && g.key));
    let no = 0;
    const itemHtml = (it, g, i) => {
      const a = it.attachments, v = it.vdr_documents; no += 1;
      const label = a ? esc(a.file_name) : v ? `${esc(v.title)} <span class="badge warn">${esc(v.confidentiality)}</span>` : '<em>عنصر غير متاح لك</em>';
      const rs = a ? stats.get(a.id) : null;
      const meta = a ? esc(size(a.size_bytes)) : v ? 'وثيقة سرية: تُعرض داخل المنصة' : 'لا تملك صلاحية الاطلاع عليه';
      const read = a ? `<span class="badge ${mine.has(a.id) ? 'good' : 'warn'}">${mine.has(a.id) ? 'قرأته' : 'لم تقرأه'}</span>${rs ? `<span>القراءة: ${rs.readers}${rs.audience ? ' من ' + rs.audience : ''}</span>` : ''}` : '';
      const sel = me.admin ? `<label class="bp-meta">البند <select data-bp-ag="${esc(it.id)}"><option value="">عام</option>${agenda.map(x => `<option value="${esc(x.id)}" ${x.id === it.agenda_item_id ? 'selected' : ''}>${esc(x.item_order + '. ' + x.title)}</option>`).join('')}</select></label>` : '';
      return `<div class="bp-item" data-item="${esc(it.id)}"><span class="bp-no">${no}</span><div><div class="bp-name">${label}</div><div class="bp-meta"><span>${meta}</span>${read}${it.note ? `<span>${esc(it.note)}</span>` : ''}</div>${sel}</div>
        <div class="bp-acts">${a || v ? `<button type="button" class="btn primary small" data-bp-it="${esc(it.id)}">${a ? 'فتح' : 'عرض'}</button>` : ''}${me.admin ? `<button type="button" class="btn ghost small" data-bp-up="${esc(it.id)}" ${i === 0 ? 'disabled' : ''} aria-label="أعلى">▲</button><button type="button" class="btn ghost small" data-bp-down="${esc(it.id)}" ${i === g.items.length - 1 ? 'disabled' : ''} aria-label="أسفل">▼</button><button type="button" class="btn ghost small" data-bp-rm="${esc(it.id)}">إزالة</button>` : ''}</div></div>`;
    };
    const html = () => { no = 0; return `<div class="bp-head"><h3>${esc(p.title)}</h3><button type="button" class="bp-x" data-x aria-label="إغلاق">✕</button></div>
      <div class="bp-meta"><span>${esc(p.meetings?.title || '')}${p.meetings?.gregorian_date ? ' — ' + esc(p.meetings.gregorian_date) : ''}</span><span class="badge ${p.status === 'منشورة' ? 'good' : 'warn'}">${esc(p.status)}</span><button type="button" class="btn ghost small" data-bp-ics>إضافة الاجتماع إلى التقويم</button></div>
      ${p.notes ? `<p>${esc(p.notes)}</p>` : ''}
      ${me.admin ? '<div class="bp-acts"><button type="button" class="btn primary small" data-bp-add>＋ إضافة عناصر</button></div>' : ''}
      ${visible.map(g => `<section class="bp-sec"><h4 class="bp-sec-h">${esc(g.title)} <small class="bp-meta">(${g.items.length})</small></h4>${g.items.map((it, i) => itemHtml(it, g, i)).join('') || '<div class="bp-meta">لا عناصر تحت هذا البند.</div>'}</section>`).join('') || '<div class="card">الحزمة فارغة.</div>'}`; };
    const dlg = dialog(html());
    dlg.addEventListener('change', async e => {
      const s = e.target.closest('[data-bp-ag]'); if (!s) return;
      const r = await db.from('board_pack_items').update({agenda_item_id: s.value || null}).eq('id', s.dataset.bpAg);
      if (r.error) return toast(r.error.message || 'تعذر تغيير البند');
      dlg.close(); return openPack(id);
    });
    dlg.addEventListener('click', async e => {
      const it = e.target.closest('[data-bp-it]'), up = e.target.closest('[data-bp-up]'), dn = e.target.closest('[data-bp-down]'), rm = e.target.closest('[data-bp-rm]');
      if (it) { const x = rows.find(r => r.id === it.dataset.bpIt); if (x?.attachments) openAttachment(x.attachments); else if (x?.vdr_documents) { if (window.ehsanVdr) window.ehsanVdr.view(x.vdr_documents.id); else toast('غرفة البيانات غير جاهزة'); } return; }
      if (e.target.closest('[data-bp-ics]')) { const {data: m} = await db.from('meetings').select('*,committees(name)').eq('id', p.meeting_id).single(); if (m && window.ehsanIcs) window.ehsanIcs.download(m, agenda); else toast('تعذر تجهيز ملف التقويم'); return; }
      if (e.target.closest('[data-bp-add]')) { dlg.close(); await addItems(p, rows); return openPack(id); }
      if (up || dn) {
        const id2 = (up || dn).dataset.bpUp || (up || dn).dataset.bpDown, g = groups.find(x => x.items.some(r => r.id === id2));
        const i = g ? g.items.findIndex(r => r.id === id2) : -1, j = up ? i - 1 : i + 1;
        if (i < 0 || j < 0 || j >= g.items.length) return;
        const [a, b] = [g.items[i], g.items[j]];
        // الموضعان قد يتساويان في بيانات قديمة: نُسند موضعين مختلفين دائمًا
        const pa = a.position === b.position ? b.position + (up ? -1 : 1) : b.position;
        const r1 = await db.from('board_pack_items').update({position: pa}).eq('id', a.id);
        const r2 = await db.from('board_pack_items').update({position: a.position === b.position ? a.position : a.position}).eq('id', b.id);
        if (r1.error || r2.error) return toast('تعذر تغيير الترتيب');
        dlg.close(); return openPack(id);
      }
      if (rm) { if (!await window.ehsanConfirm('إزالة العنصر من الحزمة؟ لا يُحذف الملف نفسه.')) return; const r = await db.from('board_pack_items').delete().eq('id', rm.dataset.bpRm); if (r.error) return toast('تعذر الإزالة'); dlg.close(); return openPack(id); }
    });
  }

  async function addItems(p, rows) {
    if (!window.DM?.form) return toast('النموذج غير جاهز بعد، أعد المحاولة');
    const [at, vd] = await Promise.all([db.from('attachments').select('id,file_name,size_bytes').eq('meeting_id', p.meeting_id).order('created_at'), db.from('vdr_documents').select('id,title,confidentiality').order('created_at', {ascending: false})]);
    const haveA = new Set(rows.map(r => r.attachment_id).filter(Boolean)), haveV = new Set(rows.map(r => r.vdr_doc_id).filter(Boolean));
    const aOpts = (at.data || []).filter(x => !haveA.has(x.id)).map(x => ({value: x.id, label: `${x.file_name} (${size(x.size_bytes)})`}));
    const vOpts = (vd.data || []).filter(x => !haveV.has(x.id)).map(x => ({value: x.id, label: `${x.title} — ${x.confidentiality}`}));
    if (!aOpts.length && !vOpts.length) return toast('لا عناصر جديدة لإضافتها: ارفع مرفقات للاجتماع أو مستندات لغرفة البيانات أولًا');
    await window.DM.form({
      title: 'إضافة عناصر إلى الحزمة', submit: 'إضافة', wide: true,
      intro: 'الحزمة تنظّم العرض فقط؛ لا تمنح أحدًا صلاحية على ملف لا يراه أصلًا. الوثائق السرية يراها من لديه صلاحيتها فقط.',
      fields: [
        ...(aOpts.length ? [{name: 'att', label: 'مرفقات الاجتماع', type: 'multi', options: aOpts}] : []),
        ...(vOpts.length ? [{name: 'vdr', label: 'وثائق غرفة البيانات', type: 'multi', options: vOpts}] : [])
      ],
      onSubmit: async v => {
        let pos = rows.reduce((m, r) => Math.max(m, r.position || 0), 0);
        const ins = [...(v.att || []).map(id => ({pack_id: p.id, position: ++pos, attachment_id: id})), ...(v.vdr || []).map(id => ({pack_id: p.id, position: ++pos, vdr_doc_id: id}))];
        if (!ins.length) throw new Error('اختر عنصرًا واحدًا على الأقل');
        const r = await db.from('board_pack_items').insert(ins); if (r.error) throw new Error(r.error.message);
        toast('أُضيفت العناصر');
      }
    });
  }

  async function createPack() {
    if (!window.DM?.form) return toast('النموذج غير جاهز بعد، أعد المحاولة');
    const {data} = await db.from('meetings').select('id,title,gregorian_date').order('gregorian_date', {ascending: false}).limit(150);
    if (!data?.length) return toast('لا اجتماعات لإنشاء حزمة لها');
    await window.DM.form({
      title: 'حزمة مجلس جديدة', submit: 'إنشاء', wide: true,
      fields: [
        {name: 'meeting', label: 'الاجتماع', type: 'select', required: true, options: data.map(m => ({value: m.id, label: `${m.title} — ${m.gregorian_date}`}))},
        {name: 'title', label: 'عنوان الحزمة', required: true, maxlength: 200, value: 'حزمة الاجتماع'},
        {name: 'notes', label: 'ملاحظات للأعضاء (اختياري)', type: 'textarea', rows: 2, maxlength: 2000}
      ],
      onSubmit: async v => {
        const r = await db.from('board_packs').insert({meeting_id: v.meeting, title: v.title, notes: v.notes || ''}).select('id').single();
        if (r.error) throw new Error(r.error.message);
        toast('أُنشئت الحزمة؛ أضف عناصرها ثم انشرها'); await load(); openPack(r.data.id);
      }
    });
  }

  async function publish(p) {
    const on = p.status !== 'منشورة';
    if (on && !await window.ehsanConfirm(`نشر «${p.title}»؟ يُشعَر أعضاء لجنة الاجتماع والمدعوون.`)) return;
    const {error} = await db.rpc('board_pack_publish', {p_pack: p.id, p_publish: on});
    if (error) return toast(error.message || 'تعذر التنفيذ');
    toast(on ? 'نُشرت الحزمة وأُشعر الأعضاء' : 'سُحب النشر'); await load();
  }

  function build() {
    const main = document.querySelector('.main-area'); if (!main) return false;
    if (!document.getElementById('view-board-packs')) {
      const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
      const sec = document.createElement('section'); sec.className = 'view'; sec.id = 'view-board-packs';
      sec.innerHTML = `<div class="section-head"><div><span class="eyebrow">اجتماعات المجلس</span><h2>حزم المجلس</h2></div>${me.admin ? '<button type="button" class="btn primary" id="bpNew">＋ حزمة جديدة</button>' : ''}</div><div class="bp-list" id="bpList"></div>`;
      main.append(sec);
    }
    return true;
  }

  async function start() {
    db = await waitDb(); if (!db) return;
    me = await session(db); if (!me) return;
    const probe = await db.from('board_packs').select('id').limit(1);
    if (probe.error) { document.querySelectorAll('[data-view="board-packs"]').forEach(b => { b.hidden = true; }); return; } // الترحيل 028 غير مطبّق
    if (!build()) return;
    document.getElementById('bpNew')?.addEventListener('click', createPack);
    document.getElementById('bpList').addEventListener('click', async e => {
      const row = e.target.closest('.bp-row'); if (!row) return;
      const p = packs.find(x => x.id === row.dataset.id); if (!p) return;
      if (e.target.closest('[data-bp-open]')) openPack(p.id);
      else if (e.target.closest('[data-bp-pub]')) publish(p);
      else if (e.target.closest('[data-bp-del]')) { if (await window.ehsanConfirm(`حذف الحزمة «${p.title}»؟ لا تُحذف الملفات نفسها.`)) db.from('board_packs').delete().eq('id', p.id).then(r => { if (r.error) toast('تعذر الحذف'); else { toast('حُذفت الحزمة'); load(); } }); }
    });
    onOpen({'board-packs': load});
    await load();
  }
  start().catch(err => console.error('board-packs', err));
})();
