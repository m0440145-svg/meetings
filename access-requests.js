// طلبات الانضمام (الترحيل 035): المدير/أمين السر يراجع الحسابات الجديدة (بعد تأكيد بريدها) ويقبلها بدور ولجان يحددها، أو يرفضها.
// ميزة مضافة: إن لم يكن الترحيل مطبّقًا أو كان المستخدم غير مدير فلا يظهر شيء.
(() => {
  'use strict';
  const ui = window.ehsanUI;
  if (!ui) return;
  const {esc, toast, onOpen, session, waitDb} = ui;
  let db, me, rows = [], committees = [];
  const fDate = s => { const d = new Date(s); return isNaN(d) ? '' : d.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn'); };
  const navs = () => document.querySelectorAll('[data-view="access-requests"]');

  async function load() {
    const [r, c] = await Promise.all([db.rpc('access_requests'), db.from('committees').select('id,name').order('name')]);
    if (r.error) { toast('تعذر تحميل طلبات الانضمام'); return; }
    rows = r.data || []; committees = c.data || [];
    const pending = rows.filter(x => x.status === 'قيد الموافقة').length;
    navs().forEach(b => { b.querySelector('.ar-badge')?.remove(); if (pending) { const s = document.createElement('span'); s.className = 'ar-badge'; s.textContent = pending; s.style.cssText = 'margin-inline-start:6px;background:#cf6028;color:#fff;border-radius:999px;padding:0 7px;font-size:12px'; b.append(s); } });
    paint();
  }

  function paint() {
    document.getElementById('arList').innerHTML = rows.map(r => `<article class="card" data-id="${esc(r.user_id)}" style="display:grid;gap:6px">
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center"><strong>${esc(r.full_name || 'بلا اسم')}</strong><span class="badge ${r.status === 'قيد الموافقة' ? 'warn' : 'bad'}">${esc(r.status)}</span></div>
      <div style="font-size:12.5px;opacity:.8">${esc(r.email || '')}${r.phone ? ' · ' + esc(r.phone) : ''} · طُلب ${esc(fDate(r.requested_at))}</div>
      ${r.note ? `<div style="font-size:12.5px;opacity:.8">ملاحظة: ${esc(r.note)}</div>` : ''}
      <div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="btn primary small" data-ar-ok>قبول وتحديد الصلاحيات</button>${r.status === 'قيد الموافقة' ? '<button type="button" class="btn ghost small" data-ar-no>رفض</button>' : ''}</div></article>`).join('')
      || '<div class="card">لا طلبات انضمام معلّقة. تظهر الطلبات هنا بعد أن يؤكد صاحبها بريده الإلكتروني.</div>';
  }

  async function approve(r) {
    await window.DM.form({
      title: `قبول ${r.full_name || r.email}`, submit: 'قبول', intro: 'يحدد الدور واللجان ما يراه العضو. يمكن تعديلها لاحقًا من «الأعضاء».',
      fields: [
        {name: 'role', label: 'الدور', type: 'select', required: true, options: [{value: 'member', label: 'عضو'}, {value: 'secretary', label: 'أمين سر (صلاحيات إدارية)'}, {value: 'admin', label: 'مدير (صلاحيات إدارية كاملة)'}]},
        ...(committees.length ? [{name: 'committees', label: 'اللجان', type: 'multi', options: committees.map(c => ({value: c.id, label: c.name}))}] : []),
        {name: 'note', label: 'ملاحظة (اختياري)', type: 'textarea', rows: 2, maxlength: 500}
      ],
      onSubmit: async v => {
        const {error} = await db.rpc('access_decide', {p_user: r.user_id, p_approve: true, p_role: v.role || 'member', p_committees: v.committees || [], p_note: v.note || ''});
        if (error) throw new Error(error.message);
        toast('اعتُمد الحساب وأُشعر صاحبه'); load();
      }
    });
  }

  async function reject(r) {
    const c = await window.DM.confirm({title: 'رفض الطلب', message: `رفض طلب «${r.full_name || r.email}»؟ سيبقى محجوبًا عن البيانات.`, noteLabel: 'سبب الرفض (اختياري)', confirmLabel: 'رفض', danger: true});
    if (!c.ok) return;
    const {error} = await db.rpc('access_decide', {p_user: r.user_id, p_approve: false, p_role: 'member', p_committees: [], p_note: c.note});
    if (error) return toast(error.message || 'تعذر التنفيذ');
    toast('رُفض الطلب'); load();
  }

  function build() {
    const main = document.querySelector('.main-area'); if (!main) return false;
    if (!document.getElementById('view-access-requests')) {
      const sec = document.createElement('section'); sec.className = 'view'; sec.id = 'view-access-requests';
      sec.innerHTML = '<div class="section-head"><div><span class="eyebrow">الحوكمة</span><h2>طلبات الانضمام</h2></div><button type="button" class="btn ghost" id="arRefresh">تحديث</button></div><div style="display:grid;gap:10px" id="arList"></div>';
      main.append(sec);
    }
    return true;
  }

  async function start() {
    db = await waitDb(); if (!db) return;
    me = await session(db); if (!me) return;
    if (!me.admin) { navs().forEach(b => { b.hidden = true; }); return; }
    const probe = await db.rpc('access_requests');
    if (probe.error) { navs().forEach(b => { b.hidden = true; }); return; } // الترحيل 035 غير مطبّق
    if (!build()) return;
    document.getElementById('arRefresh').addEventListener('click', load);
    document.getElementById('arList').addEventListener('click', e => {
      const r = rows.find(x => x.user_id === e.target.closest('[data-id]')?.dataset.id); if (!r) return;
      if (e.target.closest('[data-ar-ok]')) approve(r); else if (e.target.closest('[data-ar-no]')) reject(r);
    });
    onOpen({'access-requests': load});
    await load();
  }
  start().catch(err => console.error('access-requests', err));
})();
