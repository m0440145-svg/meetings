// تعارض المصالح (الترحيل 032): العضو يعلن تعارضه على اجتماع أو بند، فيُمنع من التصويت عليه تلقائيًا في cast_vote؛ المدير/أمين السر يسجّل نيابةً أو يرفع المنع بسبب مكتوب.
// ميزة مضافة: إن لم يكن الترحيل مطبّقًا لا يظهر شيء.
(() => {
  'use strict';
  const ui = window.ehsanUI;
  if (!ui) return;
  const {esc, toast, onOpen, session, waitDb} = ui;
  let db, me, rows = [];
  const fDate = s => { const d = new Date(s); return isNaN(d) ? '' : d.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn'); };

  async function load() {
    const {data, error} = await db.from('conflict_declarations')
      .select('*,meetings(title,gregorian_date),agenda_items(title,item_order)').order('created_at', {ascending: false}).limit(300);
    if (error) { toast('تعذر تحميل إعلانات التعارض'); return; }
    rows = data || [];
    const ids = [...new Set(rows.map(r => r.user_id))];
    const pr = ids.length ? await db.from('profiles').select('id,full_name').in('id', ids) : {data: []};
    const nm = new Map((pr.data || []).map(p => [p.id, p.full_name]));
    rows.forEach(r => { r._name = nm.get(r.user_id) || 'عضو'; });
    paint();
  }

  function paint() {
    document.getElementById('cfList').innerHTML = rows.map(r => `<article class="card" data-id="${esc(r.id)}" style="display:grid;gap:6px">
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center"><strong>${esc(r._name)}</strong>
        <span class="badge ${r.status === 'نشط' ? 'warn' : 'good'}">${r.status === 'نشط' ? 'ممنوع من التصويت' : 'رُفع المنع'}</span></div>
      <div style="font-size:12.5px;opacity:.8">${esc(r.meetings?.title || 'اجتماع')}${r.meetings?.gregorian_date ? ' — ' + esc(r.meetings.gregorian_date) : ''} · ${r.agenda_items ? 'البند ' + esc(r.agenda_items.item_order) + ': ' + esc(r.agenda_items.title) : 'الاجتماع كله'} · ${esc(fDate(r.created_at))}</div>
      <div>${esc(r.description)}</div>
      ${r.status === 'مرفوع' ? `<div style="font-size:12.5px;opacity:.8">سبب الرفع: ${esc(r.resolution_note || '')}</div>` : ''}
      ${me.admin && r.status === 'نشط' ? '<div><button type="button" class="btn ghost small" data-cf-res>رفع المنع</button></div>' : ''}</article>`).join('')
      || '<div class="card">لا إعلانات تعارض مصالح.</div>';
  }

  async function declare() {
    const {data: ms} = await db.from('meetings').select('id,title,gregorian_date').order('gregorian_date', {ascending: false}).limit(100);
    if (!ms?.length) return toast('لا اجتماعات');
    await window.DM.form({
      title: 'إعلان تعارض مصالح (1/2)', submit: 'التالي',
      fields: [{name: 'meeting', label: 'الاجتماع', type: 'select', required: true, options: ms.map(m => ({value: m.id, label: `${m.title} — ${m.gregorian_date}`}))}],
      onSubmit: async v => { setTimeout(() => step2(v.meeting), 50); }
    });
  }

  async function step2(meetingId) {
    const {data: ag} = await db.from('agenda_items').select('id,title,item_order').eq('meeting_id', meetingId).order('item_order');
    let members = [];
    if (me.admin) {
      const m = await db.from('meetings').select('committee_id').eq('id', meetingId).single();
      const cm = m.data?.committee_id ? await db.from('committee_members').select('user_id').eq('committee_id', m.data.committee_id) : {data: []};
      const ids = (cm.data || []).map(x => x.user_id);
      const pr = ids.length ? await db.from('profiles').select('id,full_name').in('id', ids) : {data: []};
      members = (pr.data || []).map(p => ({value: p.id, label: p.full_name || 'عضو'}));
    }
    await window.DM.form({
      title: 'إعلان تعارض مصالح (2/2)', submit: 'تسجيل الإعلان',
      intro: 'بمجرد التسجيل يُمنع العضو من التصويت على النطاق المحدد، ولا يرفع المنع إلا المدير أو أمين السر بسبب مكتوب.',
      fields: [
        ...(me.admin ? [{name: 'user', label: 'العضو (اتركه فارغًا لتسجيله على نفسك)', type: 'select', options: [{value: '', label: '— أنا —'}, ...members]}] : []),
        {name: 'agenda', label: 'النطاق', type: 'select', options: [{value: '', label: 'الاجتماع كله'}, ...(ag || []).map(a => ({value: a.id, label: `البند ${a.item_order}: ${a.title}`}))]},
        {name: 'description', label: 'وصف التعارض', type: 'textarea', required: true, minlength: 3, maxlength: 2000, rows: 3}
      ],
      onSubmit: async v => {
        const {error} = await db.rpc('conflict_declare', {p_meeting: meetingId, p_agenda: v.agenda || null, p_description: v.description, p_user: v.user || null});
        if (error) throw new Error(error.message);
        toast('سُجّل إعلان التعارض'); load();
      }
    });
  }

  async function resolve(r) {
    const c = await window.DM.confirm({title: 'رفع المنع', message: `رفع منع التصويت عن «${r._name}»؟`, noteLabel: 'سبب الرفع', noteRequired: true, confirmLabel: 'رفع المنع'});
    if (!c.ok) return;
    const {error} = await db.rpc('conflict_resolve', {p_id: r.id, p_note: c.note});
    if (error) return toast(error.message || 'تعذر التنفيذ');
    toast('رُفع المنع'); load();
  }

  function build() {
    const main = document.querySelector('.main-area'); if (!main) return false;
    if (!document.getElementById('view-conflicts')) {
      const sec = document.createElement('section'); sec.className = 'view'; sec.id = 'view-conflicts';
      sec.innerHTML = '<div class="section-head"><div><span class="eyebrow">الحوكمة</span><h2>تعارض المصالح</h2></div><button type="button" class="btn primary" id="cfNew">＋ إعلان تعارض</button></div><div style="display:grid;gap:10px" id="cfList"></div>';
      main.append(sec);
    }
    return true;
  }

  async function start() {
    db = await waitDb(); if (!db) return;
    me = await session(db); if (!me) return;
    const probe = await db.from('conflict_declarations').select('id').limit(1);
    if (probe.error) { document.querySelectorAll('[data-view="conflicts"]').forEach(b => { b.hidden = true; }); return; }
    if (!build()) return;
    document.getElementById('cfNew').addEventListener('click', declare);
    document.getElementById('cfList').addEventListener('click', e => {
      if (!e.target.closest('[data-cf-res]')) return;
      const r = rows.find(x => x.id === e.target.closest('[data-id]')?.dataset.id); if (r) resolve(r);
    });
    onOpen({conflicts: load});
    await load();
  }
  start().catch(err => console.error('conflicts', err));
})();
