// الجمعية العمومية (الترحيل 037): سجل العضوية، حضور الاجتماع، توكيل التصويت، تقرير النصاب بالنسبة، وإعدادات اللائحة. للمدير/أمين السر.
// لا يغيّر التصويت القائم ولا نصابه بالعدد. إن لم يكن الترحيل مطبّقًا أو لم يكن المستخدم مديرًا فلا يظهر شيء.
(() => {
  'use strict';
  const ui = window.ehsanUI;
  if (!ui) return;
  const {esc, toast, onOpen, session, waitDb} = ui;
  let db, me, tab = 'members', members = [], settings = {}, meetings = [], meetingId = '', att = [], proxies = [], quorum = null;
  const nm = id => members.find(m => m.id === id)?.full_name || '—';
  const navs = () => document.querySelectorAll('[data-view="general-assembly"]');
  const num = v => v === null || v === undefined || v === '' ? null : Number(v);

  async function loadBase() {
    const [m, s, mt] = await Promise.all([db.from('ga_members').select('*').order('full_name').limit(5000), db.from('ga_settings').select('*').eq('id', 1).maybeSingle(), db.from('meetings').select('id,title,gregorian_date').order('gregorian_date', {ascending: false}).limit(200)]);
    if (m.error) { toast('تعذر تحميل بيانات الجمعية العمومية'); return; }
    members = m.data || []; settings = s.data || {}; meetings = mt.data || []; if (!meetingId && meetings[0]) meetingId = meetings[0].id;
    await loadMeeting(); paint();
  }
  async function loadMeeting() {
    att = []; proxies = []; quorum = null; if (!meetingId) return;
    const [a, p, q] = await Promise.all([db.from('ga_attendance').select('*').eq('meeting_id', meetingId), db.from('ga_proxies').select('*').eq('meeting_id', meetingId).order('created_at'), db.rpc('ga_quorum', {p_meeting: meetingId})]);
    att = a.data || []; proxies = p.data || []; quorum = q.error ? null : q.data;
  }

  function tMembers() {
    return `<div class="ga-bar"><button type="button" class="btn primary small" data-act="m-new">＋ عضو</button><button type="button" class="btn ghost small" data-act="m-bulk">لصق قائمة أعضاء</button><span class="ga-note">${members.length} عضوًا، المؤهلون ${members.filter(m => m.eligible).length}</span></div>
      <div class="ga-list">${members.map(m => `<article class="card" data-id="${esc(m.id)}"><div class="ga-row"><strong>${esc(m.member_no ? m.member_no + ' — ' : '')}${esc(m.full_name)}</strong><span class="badge ${m.eligible ? 'good' : 'warn'}">${m.eligible ? 'مؤهل' : 'غير مؤهل'}</span></div><div class="ga-meta"><span>${esc(m.member_type)}</span>${m.joined_on ? `<span>منذ ${esc(m.joined_on)}</span>` : ''}${m.notes ? `<span>${esc(m.notes)}</span>` : ''}</div><div class="ga-acts"><button type="button" class="btn ghost small" data-act="m-edit">تعديل</button><button type="button" class="btn ghost small" data-act="m-del">حذف</button></div></article>`).join('') || '<div class="card">لا أعضاء في السجل بعد.</div>'}</div>`;
  }

  function tMeeting() {
    const sel = `<select id="gaMeet">${meetings.map(m => `<option value="${esc(m.id)}" ${m.id === meetingId ? 'selected' : ''}>${esc(m.title)} — ${esc(m.gregorian_date)}</option>`).join('')}</select>`;
    const q = quorum, pc = x => x === null || x === undefined ? 'غير محددة في الإعدادات' : x + '%';
    const present = new Set(att.map(a => a.member_id)), act = proxies.filter(p => p.status === 'معتمد');
    return `<div class="ga-bar">${sel}</div>
      ${q ? `<div class="card ga-q"><div><b>${q.represented}</b> ممثَّلون من <b>${q.eligible}</b> مؤهلًا = <b>${q.percent}%</b><br><span class="ga-note">حاضرون ${q.present} + بالوكالة ${q.by_proxy} (يُحتسب التوكيل إذا كان وكيله حاضرًا)</span></div>
        <div>النصاب: ${pc(q.quorum_percent)} ${q.quorum_met === null ? '' : `<span class="badge ${q.quorum_met ? 'good' : 'bad'}">${q.quorum_met ? 'مكتمل' : 'غير مكتمل'}</span>`}<br>النصاب الثاني: ${pc(q.second_quorum_percent)} ${q.second_quorum_met === null ? '' : `<span class="badge ${q.second_quorum_met ? 'good' : 'bad'}">${q.second_quorum_met ? 'مكتمل' : 'غير مكتمل'}</span>`}</div></div>` : ''}
      <h3>الحضور (${att.length})</h3><div class="ga-list">${members.filter(m => m.eligible).map(m => { const p = present.has(m.id), gp = act.find(x => x.grantor_id === m.id); return `<div class="card ga-row" data-mid="${esc(m.id)}"><span>${esc(m.full_name)}${gp ? ` <span class="ga-note">(موكِّل لـ ${esc(nm(gp.holder_id))})</span>` : ''}</span>${gp ? '<span class="badge warn">بالوكالة</span>' : `<button type="button" class="btn ${p ? 'primary' : 'ghost'} small" data-act="att-toggle">${p ? 'حاضر ✓' : 'تسجيل الحضور'}</button>`}</div>`; }).join('') || '<div class="card">لا أعضاء مؤهلون.</div>'}</div>
      <h3>التوكيلات (${act.length})</h3><div class="ga-bar"><button type="button" class="btn primary small" data-act="px-new">＋ توكيل</button></div>
      <div class="ga-list">${proxies.map(p => `<div class="card ga-row" data-pid="${esc(p.id)}"><span>${esc(nm(p.grantor_id))} ← وكيله ${esc(nm(p.holder_id))}${p.document_ref ? ` <span class="ga-note">(${esc(p.document_ref)})</span>` : ''}</span><span>${p.status === 'معتمد' ? '<button type="button" class="btn ghost small" data-act="px-cancel">إلغاء</button>' : '<span class="badge bad">ملغى</span>'}</span></div>`).join('') || '<div class="card">لا توكيلات.</div>'}</div>`;
  }

  function tSettings() {
    const f = (k, l) => `<label>${l}<input type="number" min="0" step="any" data-k="${k}" value="${settings[k] ?? ''}" placeholder="غير محدد"></label>`;
    return `<div class="card" style="display:grid;gap:10px"><p class="ga-note" style="margin:0">أدخل القيم من لائحة الجمعية المعتمدة. تُترك فارغة إن لم تُحدَّد، فلا يُطبَّق شرط لا قيمة له. لا أرقام افتراضية.</p>
      ${f('max_proxies', 'الحد الأقصى للتوكيلات للوكيل الواحد')}${f('quorum_percent', 'نسبة النصاب الأول (%)')}${f('second_quorum_percent', 'نسبة النصاب الثاني (%)')}${f('notice_days', 'مدة إشعار الدعوة (أيام)')}
      <div><button type="button" class="btn primary" data-act="set-save">حفظ الإعدادات</button></div></div>`;
  }

  function paint() {
    document.querySelectorAll('#gaTabs [data-tab]').forEach(b => b.classList.toggle('primary', b.dataset.tab === tab));
    document.getElementById('gaBody').innerHTML = tab === 'members' ? tMembers() : tab === 'meeting' ? tMeeting() : tSettings();
  }

  const run = async (p, msg, reloadMeeting) => { const r = await p; if (r.error) { toast(r.error.message || 'تعذر التنفيذ'); return false; } if (msg) toast(msg); if (reloadMeeting) { await loadMeeting(); paint(); } else await loadBase(); return true; };

  async function memberForm(m) {
    await window.DM.form({title: m ? 'تعديل عضو' : 'عضو جديد', submit: 'حفظ', fields: [
      {name: 'member_no', label: 'رقم العضوية', maxlength: 40, value: m?.member_no || ''}, {name: 'full_name', label: 'الاسم', required: true, maxlength: 200, value: m?.full_name || ''},
      {name: 'member_type', label: 'نوع العضوية', maxlength: 60, value: m?.member_type || 'عامل'}, {name: 'joined_on', label: 'تاريخ الانضمام', type: 'date', value: m?.joined_on || ''},
      {name: 'eligible', label: 'مؤهل للحضور والتصويت', type: 'checkbox', value: m ? m.eligible : true}, {name: 'notes', label: 'ملاحظات', type: 'textarea', rows: 2, maxlength: 1000, value: m?.notes || ''}],
      onSubmit: async v => { const body = {member_no: v.member_no || null, full_name: v.full_name, member_type: v.member_type || 'عامل', joined_on: v.joined_on || null, eligible: !!v.eligible, notes: v.notes || ''}; const r = m ? await db.from('ga_members').update(body).eq('id', m.id) : await db.from('ga_members').insert(body); if (r.error) throw new Error(r.error.message); toast('حُفظ العضو'); await loadBase(); }});
  }
  async function bulkForm() {
    await window.DM.form({title: 'لصق قائمة أعضاء', submit: 'إضافة', intro: 'سطر لكل عضو: «رقم العضوية، الاسم» أو الاسم وحده. كلهم يُضافون مؤهلين ويمكن تعديل ذلك لاحقًا.', fields: [{name: 'txt', label: 'القائمة', type: 'textarea', rows: 10, required: true}],
      onSubmit: async v => { const rows = v.txt.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const p = l.split(/[,،\t]/).map(x => x.trim()); return p.length > 1 ? {member_no: p[0] || null, full_name: p.slice(1).join(' ')} : {full_name: p[0]}; }).filter(r => r.full_name.length >= 2);
        if (!rows.length) throw new Error('لا أسطر صالحة'); const r = await db.from('ga_members').insert(rows); if (r.error) throw new Error(r.error.message); toast(`أُضيف ${rows.length} عضو`); await loadBase(); }});
  }
  async function proxyForm() {
    const opts = members.filter(m => m.eligible).map(m => ({value: m.id, label: m.full_name}));
    await window.DM.form({title: 'تسجيل توكيل', submit: 'تسجيل', intro: 'تُطبَّق قواعد الأهلية والحد الأقصى المُدخل في الإعدادات ومنع التوكيل المتسلسل.', fields: [
      {name: 'g', label: 'الموكِّل', type: 'select', required: true, options: opts}, {name: 'h', label: 'الوكيل', type: 'select', required: true, options: opts}, {name: 'ref', label: 'مرجع وثيقة التوكيل', maxlength: 300}],
      onSubmit: async v => { const {error} = await db.rpc('ga_proxy_register', {p_meeting: meetingId, p_grantor: v.g, p_holder: v.h, p_ref: v.ref || ''}); if (error) throw new Error(error.message); toast('سُجّل التوكيل'); await loadMeeting(); paint(); }});
  }

  async function click(e) {
    const act = e.target.closest('[data-act]')?.dataset.act; if (!act) return;
    const mid = e.target.closest('[data-id]')?.dataset.id, m = members.find(x => x.id === mid);
    if (act === 'm-new') return memberForm(); if (act === 'm-edit') return memberForm(m); if (act === 'm-bulk') return bulkForm();
    if (act === 'm-del') { if (window.confirm(`حذف «${m.full_name}»؟ تُحذف حضوره وتوكيلاته أيضًا.`)) run(db.from('ga_members').delete().eq('id', m.id), 'تم الحذف'); return; }
    if (act === 'px-new') return proxyForm();
    if (act === 'px-cancel') { const id = e.target.closest('[data-pid]').dataset.pid; if (window.confirm('إلغاء التوكيل؟')) run(db.rpc('ga_proxy_cancel', {p_id: id}), 'أُلغي التوكيل', true); return; }
    if (act === 'att-toggle') { const id = e.target.closest('[data-mid]').dataset.mid, on = att.some(a => a.member_id === id);
      return run(on ? db.from('ga_attendance').delete().eq('meeting_id', meetingId).eq('member_id', id) : db.from('ga_attendance').insert({meeting_id: meetingId, member_id: id}), '', true); }
    if (act === 'set-save') { const body = {updated_by: me.uid, updated_at: new Date().toISOString()}; document.querySelectorAll('#gaBody [data-k]').forEach(i => { body[i.dataset.k] = num(i.value); });
      if (await run(db.from('ga_settings').update(body).eq('id', 1), 'حُفظت الإعدادات')) { tab = 'settings'; paint(); } }
  }

  const CSS = `.ga-bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:8px 0}.ga-note{font-size:12.5px;opacity:.75}.ga-list{display:grid;gap:8px;margin-top:8px}
.ga-row{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center}.ga-meta{display:flex;gap:10px;flex-wrap:wrap;font-size:12.5px;opacity:.85}.ga-acts{display:flex;gap:6px;margin-top:6px}
.ga-q{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media(max-width:560px){.ga-q{grid-template-columns:1fr}}`;

  function build() {
    const main = document.querySelector('.main-area'); if (!main) return false;
    if (!document.getElementById('view-general-assembly')) {
      const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
      const sec = document.createElement('section'); sec.className = 'view'; sec.id = 'view-general-assembly';
      sec.innerHTML = '<div class="section-head"><div><span class="eyebrow">الحوكمة</span><h2>الجمعية العمومية والتوكيلات</h2></div></div><div class="ga-bar" id="gaTabs"><button type="button" class="btn small" data-tab="members">سجل العضوية</button><button type="button" class="btn small" data-tab="meeting">الحضور والتوكيل والنصاب</button><button type="button" class="btn small" data-tab="settings">إعدادات اللائحة</button></div><div id="gaBody"></div>';
      main.append(sec);
    }
    return true;
  }

  async function start() {
    db = await waitDb(); if (!db) return;
    me = await session(db); if (!me) return;
    if (!me.admin) { navs().forEach(b => { b.hidden = true; }); return; }
    const probe = await db.from('ga_settings').select('id').limit(1);
    if (probe.error) { navs().forEach(b => { b.hidden = true; }); return; }
    if (!build()) return;
    document.getElementById('gaTabs').addEventListener('click', async e => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; if (tab === 'meeting') await loadMeeting(); paint(); } });
    const body = document.getElementById('gaBody'); body.addEventListener('click', click);
    body.addEventListener('change', async e => { if (e.target.id === 'gaMeet') { meetingId = e.target.value; await loadMeeting(); paint(); } });
    onOpen({'general-assembly': loadBase});
    await loadBase();
  }
  start().catch(err => console.error('general-assembly', err));
})();
