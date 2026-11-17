// المخاطر والتدقيق الداخلي والالتزامات (الترحيل 036): ثلاث وحدات مستقلة في شاشة واحدة بتبويبات. الكتابة للمدير/أمين السر، ويقرأ المالك عناصره.
// ميزة مضافة: إن لم يكن الترحيل مطبّقًا لا يظهر شيء.
(() => {
  'use strict';
  const ui = window.ehsanUI;
  if (!ui) return;
  const {esc, toast, onOpen, session, waitDb} = ui;
  let db, me, tab = 'risks', people = [];
  const D = {risks: [], actions: [], tasks: [], findings: [], obs: []};
  const nameOf = id => people.find(p => p.id === id)?.full_name || '';
  const today = () => new Date().toISOString().slice(0, 10);
  const lvl = s => s >= 15 ? ['عالية', 'bad'] : s >= 8 ? ['متوسطة', 'warn'] : ['منخفضة', 'good'];
  const ownerField = v => ({name: 'owner_id', label: 'المسؤول', type: 'select', options: [{value: '', label: '— غير محدد —'}, ...people.map(p => ({value: p.id, label: p.full_name || 'عضو'}))], value: v || ''});
  const clean = o => { const r = {}; for (const k in o) r[k] = o[k] === '' ? null : o[k]; return r; };

  async function load() {
    const q = t => db.from(t).select('*').limit(2000);
    const [r, a, t, f, o, p] = await Promise.all([q('risks'), q('risk_actions'), q('audit_tasks'), q('audit_findings'), q('obligations'), db.from('profiles').select('id,full_name').order('full_name').limit(500)]);
    if (r.error) { toast('تعذر تحميل البيانات'); return; }
    D.risks = r.data || []; D.actions = a.data || []; D.tasks = t.data || []; D.findings = f.data || []; D.obs = o.data || []; people = p.data || [];
    paint();
  }

  const add = (label, fn) => me.admin ? `<button type="button" class="btn primary small" data-act="${fn}">${label}</button>` : '';

  function heat() {
    const open = D.risks.filter(r => r.status !== 'مغلق'); let h = '<table class="ra-heat"><tr><th></th>' + [1, 2, 3, 4, 5].map(i => `<th>أثر ${i}</th>`).join('') + '</tr>';
    for (let l = 5; l >= 1; l--) { h += `<tr><th>احتمال ${l}</th>`; for (let i = 1; i <= 5; i++) { const n = open.filter(r => r.likelihood === l && r.impact === i).length, s = l * i; h += `<td class="ra-${lvl(s)[1]}">${n || ''}</td>`; } h += '</tr>'; }
    return h + '</table>';
  }

  function paintRisks() {
    const rs = [...D.risks].sort((a, b) => b.score - a.score);
    return `<div class="ra-bar">${add('＋ خطر جديد', 'risk-new')}<span class="ra-note">مقياس الاحتمال والأثر من 1 إلى 5، والدرجة = احتمال × أثر (15 فأكثر عالية، 8 إلى 14 متوسطة).</span></div>${heat()}
      <div class="ra-list">${rs.map(r => { const [lb, cls] = lvl(r.score), acts = D.actions.filter(a => a.risk_id === r.id), openA = acts.filter(a => a.status === 'مفتوح').length, late = r.review_due && r.review_due < today() && r.status !== 'مغلق';
        return `<article class="card" data-kind="risk" data-id="${esc(r.id)}"><div class="ra-row"><strong>${esc(r.code)} — ${esc(r.title)}</strong><span class="badge ${cls}">${lb} (${r.score})</span></div>
        <div class="ra-meta"><span>${esc(r.category)}</span><span>${esc(r.status)}</span><span>المسؤول: ${esc(nameOf(r.owner_id) || '—')}</span><span>إجراءات: ${acts.length - openA}/${acts.length}</span>${r.review_due ? `<span class="${late ? 'ra-late' : ''}">مراجعة ${esc(r.review_due)}${late ? ' (متأخرة)' : ''}</span>` : ''}</div>
        ${r.description ? `<div>${esc(r.description)}</div>` : ''}<div class="ra-acts"><button type="button" class="btn ghost small" data-act="risk-open">الإجراءات</button>${me.admin ? '<button type="button" class="btn ghost small" data-act="risk-edit">تعديل</button><button type="button" class="btn ghost small" data-act="risk-del">حذف</button>' : ''}</div></article>`; }).join('') || '<div class="card">لا مخاطر مسجلة.</div>'}</div>`;
  }

  function paintAudit() {
    const ts = [...D.tasks].sort((a, b) => (b.plan_year - a.plan_year) || String(a.planned_date || '').localeCompare(String(b.planned_date || '')));
    return `<div class="ra-bar">${add('＋ مهمة تدقيق', 'task-new')}</div><div class="ra-list">${ts.map(t => { const fs = D.findings.filter(f => f.task_id === t.id), op = fs.filter(f => f.status !== 'مغلقة').length;
      return `<article class="card" data-kind="task" data-id="${esc(t.id)}"><div class="ra-row"><strong>${esc(t.title)}</strong><span class="badge ${t.status === 'مكتمل' ? 'good' : 'warn'}">${esc(t.status)}</span></div>
      <div class="ra-meta"><span>خطة ${esc(t.plan_year)}</span>${t.planned_date ? `<span>${esc(t.planned_date)}</span>` : ''}<span>المدقق: ${esc(nameOf(t.lead_id) || '—')}</span><span>ملاحظات مفتوحة: ${op}/${fs.length}</span></div>
      ${t.scope ? `<div>${esc(t.scope)}</div>` : ''}<div class="ra-acts"><button type="button" class="btn ghost small" data-act="task-open">الملاحظات والتوصيات</button>${me.admin ? '<button type="button" class="btn ghost small" data-act="task-edit">تعديل</button><button type="button" class="btn ghost small" data-act="task-del">حذف</button>' : ''}</div></article>`; }).join('') || '<div class="card">لا مهام تدقيق.</div>'}</div>`;
  }

  function paintObs() {
    const os = [...D.obs].sort((a, b) => String(a.next_due || '9999').localeCompare(String(b.next_due || '9999')));
    return `<div class="ra-bar">${add('＋ التزام جديد', 'ob-new')}</div><div class="ra-list">${os.map(o => { const late = o.next_due && o.next_due < today() && o.status === 'ساري';
      return `<article class="card" data-kind="ob" data-id="${esc(o.id)}"><div class="ra-row"><strong>${esc(o.title)}</strong><span class="badge ${late ? 'bad' : o.status === 'ساري' ? 'good' : 'warn'}">${late ? 'متأخر' : esc(o.status)}</span></div>
      <div class="ra-meta"><span>${esc(o.frequency)}</span>${o.source ? `<span>المصدر: ${esc(o.source)}</span>` : ''}<span>المسؤول: ${esc(nameOf(o.owner_id) || '—')}</span><span>الموعد القادم: ${esc(o.next_due || '—')}</span><span>آخر إنجاز: ${esc(o.last_done || '—')}</span></div>
      <div class="ra-acts">${me.admin || o.owner_id === me.uid ? '<button type="button" class="btn primary small" data-act="ob-done">تسجيل الإنجاز</button>' : ''}<button type="button" class="btn ghost small" data-act="ob-log">السجل</button>${me.admin ? '<button type="button" class="btn ghost small" data-act="ob-edit">تعديل</button><button type="button" class="btn ghost small" data-act="ob-del">حذف</button>' : ''}</div></article>`; }).join('') || '<div class="card">لا التزامات مسجلة.</div>'}</div>`;
  }

  function paint() {
    document.querySelectorAll('#raTabs [data-tab]').forEach(b => b.classList.toggle('primary', b.dataset.tab === tab));
    document.getElementById('raBody').innerHTML = tab === 'risks' ? paintRisks() : tab === 'audit' ? paintAudit() : paintObs();
  }

  const save = (table, id, body) => id ? db.from(table).update(body).eq('id', id) : db.from(table).insert(body);
  const done = async (p, msg) => { const r = await p; if (r.error) throw new Error(r.error.message); toast(msg); await load(); };

  async function riskForm(r) {
    await window.DM.form({title: r ? 'تعديل خطر' : 'خطر جديد', submit: 'حفظ', wide: true, fields: [
      {name: 'title', label: 'عنوان الخطر', required: true, maxlength: 200, value: r?.title || ''},
      {name: 'description', label: 'الوصف', type: 'textarea', rows: 3, maxlength: 3000, value: r?.description || ''},
      {name: 'category', label: 'التصنيف', maxlength: 60, value: r?.category || 'عام'},
      {name: 'likelihood', label: 'الاحتمال (1-5)', type: 'number', min: 1, max: 5, required: true, value: r?.likelihood ?? 3},
      {name: 'impact', label: 'الأثر (1-5)', type: 'number', min: 1, max: 5, required: true, value: r?.impact ?? 3},
      ownerField(r?.owner_id),
      {name: 'status', label: 'الحالة', type: 'select', options: ['مفتوح', 'قيد المعالجة', 'مقبول', 'مغلق'].map(v => ({value: v, label: v})), value: r?.status || 'مفتوح'},
      {name: 'review_due', label: 'موعد المراجعة', type: 'date', value: r?.review_due || ''}],
      onSubmit: v => done(save('risks', r?.id, clean(v)), 'حُفظ الخطر')});
  }
  async function taskForm(t) {
    await window.DM.form({title: t ? 'تعديل مهمة' : 'مهمة تدقيق', submit: 'حفظ', wide: true, fields: [
      {name: 'title', label: 'عنوان المهمة', required: true, maxlength: 200, value: t?.title || ''},
      {name: 'scope', label: 'النطاق', type: 'textarea', rows: 3, maxlength: 2000, value: t?.scope || ''},
      {name: 'plan_year', label: 'سنة الخطة', type: 'number', min: 2000, max: 2100, required: true, value: t?.plan_year ?? new Date().getFullYear()},
      {...ownerField(t?.lead_id), name: 'lead_id', label: 'المدقق'},
      {name: 'planned_date', label: 'التاريخ المخطط', type: 'date', value: t?.planned_date || ''},
      {name: 'status', label: 'الحالة', type: 'select', options: ['مخطط', 'قيد التنفيذ', 'مكتمل', 'مؤجل'].map(v => ({value: v, label: v})), value: t?.status || 'مخطط'}],
      onSubmit: v => done(save('audit_tasks', t?.id, clean(v)), 'حُفظت المهمة')});
  }
  async function obForm(o) {
    await window.DM.form({title: o ? 'تعديل التزام' : 'التزام جديد', submit: 'حفظ', wide: true, fields: [
      {name: 'title', label: 'الالتزام', required: true, maxlength: 200, value: o?.title || ''},
      {name: 'source', label: 'المصدر (لائحة/نظام/عقد)', maxlength: 300, value: o?.source || ''},
      {name: 'frequency', label: 'الدورية', type: 'select', options: ['شهري', 'ربع سنوي', 'نصف سنوي', 'سنوي', 'عند الحاجة'].map(v => ({value: v, label: v})), value: o?.frequency || 'سنوي'},
      ownerField(o?.owner_id),
      {name: 'next_due', label: 'الموعد القادم', type: 'date', value: o?.next_due || ''},
      {name: 'status', label: 'الحالة', type: 'select', options: ['ساري', 'موقوف'].map(v => ({value: v, label: v})), value: o?.status || 'ساري'}],
      onSubmit: v => done(save('obligations', o?.id, clean(v)), 'حُفظ الالتزام')});
  }

  function dialog(title, html) {
    const dlg = document.createElement('dialog'); dlg.style.cssText = 'border:0;border-radius:18px;padding:0;width:min(94vw,720px);max-height:92vh;background:var(--card,#fff);color:inherit';
    dlg.innerHTML = `<div style="padding:16px 20px;display:grid;gap:10px;max-height:88vh;overflow:auto"><div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">${esc(title)}</h3><button type="button" class="btn ghost small" data-x>✕</button></div><div data-body>${html}</div></div>`;
    dlg.addEventListener('close', () => dlg.remove()); dlg.addEventListener('click', e => { if (e.target.closest('[data-x]')) dlg.close(); });
    document.body.append(dlg); dlg.showModal(); return dlg;
  }

  async function riskActions(r) {
    const render = () => { const acts = D.actions.filter(a => a.risk_id === r.id);
      return (acts.map(a => `<div class="card" data-aid="${esc(a.id)}" style="display:grid;gap:4px"><div>${esc(a.action)}</div><div class="ra-meta"><span>${esc(nameOf(a.owner_id) || '—')}</span>${a.due_date ? `<span>${esc(a.due_date)}</span>` : ''}<span class="badge ${a.status === 'منجز' ? 'good' : 'warn'}">${esc(a.status)}</span></div>${me.admin ? `<div class="ra-acts"><button type="button" class="btn ghost small" data-tg>${a.status === 'منجز' ? 'إعادة فتح' : 'تم الإنجاز'}</button><button type="button" class="btn ghost small" data-rm>حذف</button></div>` : ''}</div>`).join('') || '<div>لا إجراءات.</div>') + (me.admin ? '<button type="button" class="btn primary small" data-new>＋ إجراء معالجة</button>' : ''); };
    const dlg = dialog(`إجراءات ${r.code}`, render());
    const rerender = async () => { await load(); r = D.risks.find(x => x.id === r.id) || r; dlg.querySelector('[data-body]').innerHTML = render(); };
    dlg.addEventListener('click', async e => {
      const aid = e.target.closest('[data-aid]')?.dataset.aid, a = D.actions.find(x => x.id === aid);
      if (e.target.closest('[data-tg]') && a) { const {error} = await db.from('risk_actions').update({status: a.status === 'منجز' ? 'مفتوح' : 'منجز'}).eq('id', aid); if (error) return toast('تعذر التنفيذ'); rerender(); }
      else if (e.target.closest('[data-rm]') && a && window.confirm('حذف الإجراء؟')) { const {error} = await db.from('risk_actions').delete().eq('id', aid); if (error) return toast('تعذر الحذف'); rerender(); }
      else if (e.target.closest('[data-new]')) await window.DM.form({title: 'إجراء معالجة', submit: 'إضافة', fields: [{name: 'action', label: 'الإجراء', type: 'textarea', required: true, minlength: 3, maxlength: 1000}, ownerField(''), {name: 'due_date', label: 'الموعد', type: 'date'}],
        onSubmit: async v => { const {error} = await db.from('risk_actions').insert({risk_id: r.id, ...clean(v)}); if (error) throw new Error(error.message); toast('أُضيف الإجراء'); await rerender(); }});
    });
  }

  async function taskFindings(t) {
    const render = () => { const fs = D.findings.filter(f => f.task_id === t.id);
      return (fs.map(f => `<div class="card" data-fid="${esc(f.id)}" style="display:grid;gap:4px"><div>${esc(f.finding)}</div>${f.recommendation ? `<div><b>التوصية:</b> ${esc(f.recommendation)}</div>` : ''}<div class="ra-meta"><span class="badge ${f.severity === 'عالية' ? 'bad' : f.severity === 'متوسطة' ? 'warn' : 'good'}">${esc(f.severity)}</span><span>${esc(nameOf(f.owner_id) || '—')}</span>${f.due_date ? `<span>${esc(f.due_date)}</span>` : ''}<span>${esc(f.status)}</span></div>${me.admin ? `<div class="ra-acts"><select data-st>${['مفتوحة', 'قيد المعالجة', 'مغلقة'].map(s => `<option ${s === f.status ? 'selected' : ''}>${s}</option>`).join('')}</select><button type="button" class="btn ghost small" data-rm>حذف</button></div>` : ''}</div>`).join('') || '<div>لا ملاحظات.</div>') + (me.admin ? '<button type="button" class="btn primary small" data-new>＋ ملاحظة وتوصية</button>' : ''); };
    const dlg = dialog(t.title, render());
    const rerender = async () => { await load(); dlg.querySelector('[data-body]').innerHTML = render(); };
    dlg.addEventListener('change', async e => { const s = e.target.closest('[data-st]'); if (!s) return; const fid = s.closest('[data-fid]').dataset.fid; const {error} = await db.from('audit_findings').update({status: s.value}).eq('id', fid); if (error) return toast('تعذر التنفيذ'); rerender(); });
    dlg.addEventListener('click', async e => {
      const fid = e.target.closest('[data-fid]')?.dataset.fid;
      if (e.target.closest('[data-rm]') && fid && window.confirm('حذف الملاحظة؟')) { const {error} = await db.from('audit_findings').delete().eq('id', fid); if (error) return toast('تعذر الحذف'); rerender(); }
      else if (e.target.closest('[data-new]')) await window.DM.form({title: 'ملاحظة تدقيق', submit: 'إضافة', wide: true, fields: [{name: 'finding', label: 'الملاحظة', type: 'textarea', required: true, minlength: 3, maxlength: 3000}, {name: 'severity', label: 'الخطورة', type: 'select', options: ['منخفضة', 'متوسطة', 'عالية'].map(v => ({value: v, label: v})), value: 'متوسطة'}, {name: 'recommendation', label: 'التوصية', type: 'textarea', maxlength: 3000}, ownerField(''), {name: 'due_date', label: 'الموعد', type: 'date'}],
        onSubmit: async v => { const {error} = await db.from('audit_findings').insert({task_id: t.id, ...clean(v)}); if (error) throw new Error(error.message); toast('أُضيفت الملاحظة'); await rerender(); }});
    });
  }

  async function obDone(o) {
    await window.DM.form({title: `تسجيل إنجاز: ${o.title}`, submit: 'تسجيل', fields: [{name: 'date', label: 'تاريخ الإنجاز', type: 'date', required: true, value: today()}, {name: 'note', label: 'ملاحظة/دليل', type: 'textarea', rows: 2, maxlength: 1000}],
      onSubmit: async v => { const {data, error} = await db.rpc('obligation_mark_done', {p_id: o.id, p_note: v.note || '', p_date: v.date}); if (error) throw new Error(error.message); toast(data ? `سُجّل الإنجاز، الموعد القادم ${data}` : 'سُجّل الإنجاز'); await load(); }});
  }
  async function obLog(o) {
    const {data} = await db.from('obligation_log').select('done_on,note,created_at').eq('obligation_id', o.id).order('done_on', {ascending: false}).limit(100);
    dialog(`سجل: ${o.title}`, (data || []).map(l => `<div class="card"><b>${esc(l.done_on)}</b>${l.note ? ' — ' + esc(l.note) : ''}</div>`).join('') || '<div>لا سجل إنجاز بعد.</div>');
  }

  const del = (table, label, id) => { if (window.confirm(`حذف ${label}؟ لا يمكن التراجع.`)) db.from(table).delete().eq('id', id).then(r => { if (r.error) toast('تعذر الحذف'); else { toast('تم الحذف'); load(); } }); };

  const CSS = `.ra-bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:8px 0}.ra-note{font-size:12.5px;opacity:.75}
.ra-list{display:grid;gap:10px;margin-top:10px}.ra-row{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center}
.ra-meta{display:flex;flex-wrap:wrap;gap:10px;font-size:12.5px;opacity:.85}.ra-acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.ra-late{color:#b64242;font-weight:700}
.ra-heat{border-collapse:collapse;margin:6px 0;font-size:13px}.ra-heat th{padding:4px 8px;font-weight:600}.ra-heat td{width:54px;height:36px;text-align:center;border:2px solid var(--card,#fff);font-weight:800}
.ra-good{background:#d9eee2}.ra-warn{background:#f6e6b8}.ra-bad{background:#f2c4c0}`;

  function build() {
    const main = document.querySelector('.main-area'); if (!main) return false;
    if (!document.getElementById('view-risk-audit')) {
      const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
      const sec = document.createElement('section'); sec.className = 'view'; sec.id = 'view-risk-audit';
      sec.innerHTML = '<div class="section-head"><div><span class="eyebrow">الحوكمة</span><h2>المخاطر والتدقيق والالتزامات</h2></div></div><div class="ra-bar" id="raTabs"><button type="button" class="btn small" data-tab="risks">سجل المخاطر</button><button type="button" class="btn small" data-tab="audit">التدقيق الداخلي</button><button type="button" class="btn small" data-tab="obs">الالتزامات</button></div><div id="raBody"></div>';
      main.append(sec);
    }
    return true;
  }

  async function start() {
    db = await waitDb(); if (!db) return;
    me = await session(db); if (!me) return;
    const probe = await db.from('risks').select('id').limit(1);
    if (probe.error) { document.querySelectorAll('[data-view="risk-audit"]').forEach(b => { b.hidden = true; }); return; }
    if (!build()) return;
    document.getElementById('raTabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; paint(); } });
    document.getElementById('raBody').addEventListener('click', e => {
      const act = e.target.closest('[data-act]')?.dataset.act; if (!act) return;
      const card = e.target.closest('[data-id]'), id = card?.dataset.id;
      const r = D.risks.find(x => x.id === id), t = D.tasks.find(x => x.id === id), o = D.obs.find(x => x.id === id);
      ({'risk-new': () => riskForm(), 'risk-edit': () => riskForm(r), 'risk-open': () => riskActions(r), 'risk-del': () => del('risks', 'الخطر وإجراءاته', id),
        'task-new': () => taskForm(), 'task-edit': () => taskForm(t), 'task-open': () => taskFindings(t), 'task-del': () => del('audit_tasks', 'المهمة وملاحظاتها', id),
        'ob-new': () => obForm(), 'ob-edit': () => obForm(o), 'ob-done': () => obDone(o), 'ob-log': () => obLog(o), 'ob-del': () => del('obligations', 'الالتزام وسجله', id)})[act]?.();
    });
    onOpen({'risk-audit': load});
    await load();
  }
  start().catch(err => console.error('risk-audit', err));
})();
