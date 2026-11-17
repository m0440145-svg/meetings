// صلاحيات العضو من صفحة «الأعضاء» (الترحيل 040) — للمدير/أمين السر: الدور واللجان (وصفة العضو) والشاشات المتاحة.
// يضيف زر «الصلاحيات» لبطاقة كل عضو له حساب دخول. ميزة مضافة: إن لم يكن الترحيل مطبّقًا لا يظهر الزر.
(() => {
  'use strict';
  const ui = window.ehsanUI;
  if (!ui) return;
  const {esc, toast, session, waitDb} = ui;
  let db, me, ready = false, has043 = false;
  // الشاشات «الأساسية» للعضو العادي (الباقي يُتاح بالاختيار)
  const BASIC = ['home', 'notifications', 'notify-prefs', 'meetings', 'members', 'committees', 'minutes', 'votes', 'board-packs', 'dm-mine', 'tasks', 'conflicts', 'vdr', 'files', 'about', 'volunteer', 'schedule'];
  const ADMIN_ONLY = new Set(['exec-dashboard', 'access-requests', 'general-assembly', 'ai-assist', 'branding', 'delivery-health', 'risk-audit']);

  function catalog() {
    const seen = new Map();
    document.querySelectorAll('[data-view]').forEach(b => { const v = b.dataset.view; if (!v || ADMIN_ONLY.has(v) || seen.has(v)) return; const t = b.textContent.replace(/[＋▣◉✦⚖☑⚠☷§▥✧⇄✍]/g, '').replace(/\s+/g, ' ').replace(/\d+$/, '').trim(); if (t) seen.set(v, t); });
    return [...seen.entries()].map(([v, t]) => ({v, t}));
  }

  async function open(userId, name) {
    const [g, c] = await Promise.all([db.rpc('member_access_get', {p_user: userId}), db.from('committees').select('id,name,type').order('name')]);
    if (g.error) return toast(g.error.message || 'تعذر تحميل الصلاحيات');
    const cur = g.data, comms = c.data || [], mine = new Map((cur.committees || []).map(x => [x.id, x.role]));
    const cat = catalog(), all = cur.views === null || cur.views === undefined, sel = new Set(cur.views || BASIC);
    let prof = {}, phone = '';
    if (has043) {
      const [pf, ct] = await Promise.all([db.from('profiles').select('full_name,job_title,organization,approval_status,approval_note,is_manual').eq('id', userId).single(), db.rpc('profile_contacts')]);
      prof = pf.data || {}; phone = (ct.data || []).find(x => x.id === userId)?.phone || '';
    }
    const dlg = document.createElement('dialog'); dlg.style.cssText = 'border:0;border-radius:18px;padding:0;width:min(94vw,720px);max-height:92vh;background:var(--card,#fff);color:inherit';
    const row = x => `<label style="display:flex;gap:8px;align-items:center;padding:3px 0"><input type="checkbox" data-view-cb value="${esc(x.v)}" ${sel.has(x.v) ? 'checked' : ''}> ${esc(x.t)}</label>`;
    dlg.innerHTML = `<div style="padding:16px 20px;display:grid;gap:12px;max-height:88vh;overflow:auto">
      <div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">صلاحيات ${esc(name)}</h3><button type="button" class="btn ghost small" data-x>✕</button></div>
      ${has043 ? `<fieldset style="border:1px solid var(--line,#eadfd8);border-radius:12px;padding:10px 12px"><legend>البيانات الأساسية</legend>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px">
          <label>الاسم<input data-pf="name" value="${esc(prof.full_name || '')}" maxlength="200" style="width:100%"></label>
          <label>المسمى الوظيفي<input data-pf="job" value="${esc(prof.job_title || '')}" maxlength="200" style="width:100%"></label>
          <label>الجهة<input data-pf="org" value="${esc(prof.organization || '')}" maxlength="200" style="width:100%"></label>
          <label>الجوال<input data-pf="phone" value="${esc(phone)}" maxlength="20" style="width:100%" inputmode="tel"></label></div>
        <div style="margin-top:8px"><button type="button" class="btn small primary" data-saveprof>حفظ البيانات</button></div></fieldset>
      <fieldset style="border:1px solid var(--line,#eadfd8);border-radius:12px;padding:10px 12px"><legend>حالة الحساب</legend>
        <div>الحالة الحالية: <b>${esc(prof.approval_status || 'معتمد')}</b>${prof.approval_status === 'موقوف' && prof.approval_note ? ` — السبب: ${esc(prof.approval_note)}` : ''}</div>
        ${prof.is_manual ? '<div class="ga-note" style="font-size:12.5px;opacity:.75">عضو مضاف يدويًا بلا حساب دخول: يُعدَّل من «تعديل» في بطاقته.</div>'
          : userId === me.uid ? '<div class="ga-note" style="font-size:12.5px;opacity:.75">لا يمكنك إيقاف حسابك بنفسك.</div>'
          : prof.approval_status === 'موقوف' ? '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px"><input data-note placeholder="ملاحظة (اختياري)" style="flex:1;min-width:180px"><button type="button" class="btn small primary" data-reactivate>إعادة تفعيل الحساب</button></div>'
          : prof.approval_status === 'معتمد' ? '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px"><input data-reason placeholder="سبب الإيقاف (إلزامي)" maxlength="300" style="flex:1;min-width:180px"><button type="button" class="btn small ghost" data-suspend>إيقاف الحساب</button></div><div class="ga-note" style="font-size:12.5px;opacity:.75">الموقوف يُحجب فورًا عن كل البيانات ويرى شاشة «حسابك موقوف»، ويبقى أثره في الأصوات والحضور والتوقيعات.</div>' : ''}</fieldset>` : ''}
      <fieldset style="border:1px solid var(--line,#eadfd8);border-radius:12px;padding:10px 12px"><legend>الدور</legend>
        <select data-role style="width:100%"><option value="member">عضو (يرى لجانه فقط)</option><option value="secretary">أمين سر (صلاحيات إدارية)</option><option value="admin">مدير (صلاحيات إدارية كاملة)</option></select></fieldset>
      <fieldset style="border:1px solid var(--line,#eadfd8);border-radius:12px;padding:10px 12px"><legend>اللجان والمجلس: ما يطّلع عليه من اجتماعات ومحاضر وقرارات</legend>
        ${comms.map(x => `<div style="display:flex;gap:8px;align-items:center;padding:3px 0;flex-wrap:wrap"><label style="flex:1;min-width:160px;display:flex;gap:8px;align-items:center"><input type="checkbox" data-c="${esc(x.id)}" ${mine.has(x.id) ? 'checked' : ''}> ${esc(x.name)}</label><select data-cr="${esc(x.id)}"><option value="member" ${mine.get(x.id) !== 'رئيس اللجنة' ? 'selected' : ''}>عضو</option><option value="رئيس اللجنة" ${mine.get(x.id) === 'رئيس اللجنة' ? 'selected' : ''}>رئيس اللجنة (يُنشئ اجتماعاتها)</option></select></div>`).join('') || '<div>لا لجان.</div>'}</fieldset>
      <fieldset style="border:1px solid var(--line,#eadfd8);border-radius:12px;padding:10px 12px"><legend>الشاشات الظاهرة له في القائمة</legend>
        <label style="display:flex;gap:8px;align-items:center;font-weight:700"><input type="checkbox" data-allviews ${all ? 'checked' : ''}> كل الشاشات (بدون تقييد)</label>
        <div data-views style="display:${all ? 'none' : 'grid'};grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:2px 12px;margin-top:6px">${cat.map(row).join('')}</div>
        <div class="ga-note" style="font-size:12.5px;opacity:.75;margin-top:6px">تقييد الشاشات يخفيها من القائمة. ما يراه العضو من بيانات يحدده انتماؤه للجان، وتحميه قاعدة البيانات.</div></fieldset>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn ghost" data-x>إلغاء</button><button type="button" class="btn primary" data-save>حفظ الصلاحيات</button></div></div>`;
    dlg.querySelector('[data-role]').value = cur.role === 'admin' || cur.role === 'secretary' ? cur.role : 'member';
    dlg.addEventListener('close', () => dlg.remove());
    dlg.addEventListener('click', e => { if (e.target.closest('[data-x]')) dlg.close(); });
    const done = (msg) => { toast(msg); dlg.close(); window.ehsanMembers?.reload?.(); };
    dlg.querySelector('[data-saveprof]')?.addEventListener('click', async e => {
      const g = k => dlg.querySelector(`[data-pf="${k}"]`).value; e.target.disabled = true;
      const {error} = await db.rpc('member_profile_update', {p_user: userId, p_name: g('name'), p_job: g('job'), p_org: g('org'), p_phone: g('phone')});
      e.target.disabled = false; if (error) return toast(error.message || 'تعذر الحفظ'); done('حُفظت بيانات العضو');
    });
    dlg.querySelector('[data-suspend]')?.addEventListener('click', async e => {
      const reason = dlg.querySelector('[data-reason]').value.trim(); if (reason.length < 3) return toast('اكتب سبب الإيقاف');
      if (!(await window.ehsanConfirm?.(`إيقاف حساب «${name}»؟ سيُحجب فورًا عن كل البيانات.`))) return; e.target.disabled = true;
      const {error} = await db.rpc('member_suspend', {p_user: userId, p_reason: reason}); e.target.disabled = false;
      if (error) return toast(error.message || 'تعذر الإيقاف'); done('أُوقف الحساب');
    });
    dlg.querySelector('[data-reactivate]')?.addEventListener('click', async e => {
      e.target.disabled = true; const {error} = await db.rpc('member_reactivate', {p_user: userId, p_note: dlg.querySelector('[data-note]')?.value || ''}); e.target.disabled = false;
      if (error) return toast(error.message || 'تعذر إعادة التفعيل'); done('أُعيد تفعيل الحساب');
    });
    dlg.querySelector('[data-allviews]').addEventListener('change', e => { dlg.querySelector('[data-views]').style.display = e.target.checked ? 'none' : 'grid'; });
    dlg.querySelector('[data-save]').addEventListener('click', async () => {
      const committees = [...dlg.querySelectorAll('[data-c]:checked')].map(i => ({id: i.dataset.c, role: dlg.querySelector(`[data-cr="${i.dataset.c}"]`).value}));
      const views = dlg.querySelector('[data-allviews]').checked ? null : [...new Set(['home', ...[...dlg.querySelectorAll('[data-view-cb]:checked')].map(i => i.value)])];
      const btn = dlg.querySelector('[data-save]'); btn.disabled = true;
      const {error} = await db.rpc('member_access_set', {p_user: userId, p_role: dlg.querySelector('[data-role]').value, p_committees: committees, p_views: views});
      btn.disabled = false;
      if (error) return toast(error.message || 'تعذر الحفظ');
      toast('حُفظت صلاحيات العضو'); dlg.close(); window.ehsanMembers?.reload?.();
    });
    document.body.append(dlg); dlg.showModal();
  }

  async function init() {
    db = await waitDb(); if (!db) return;
    me = await session(db); if (!me?.admin) return;
    const probe = await db.rpc('member_access_get', {p_user: me.uid});
    if (probe.error) return; // الترحيل 040 غير مطبّق
    // الترحيل 043 (تعديل البيانات والإيقاف): إيقاف النفس يُرفض قبل أي تغيير، فنعرف وجود الدالة دون أثر
    const p43 = await db.rpc('member_suspend', {p_user: me.uid, p_reason: 'probe'});
    has043 = !!p43.error && !/Could not find the function|PGRST202/i.test(p43.error.message + (p43.error.code || ''));
    ready = true;
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-access-member]'); if (!b) return;
      open(b.dataset.accessMember, b.dataset.name || 'العضو');
    });
  }
  window.ehsanMemberAccess = {isReady: () => ready};
  init().catch(err => console.error('member-access', err));
})();
