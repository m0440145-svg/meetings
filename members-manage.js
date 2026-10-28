// إضافة الأعضاء يدويًا (بلا حساب دخول) وتعديلهم وحذفهم. الصلاحية يفرضها الخادم (is_admin) عبر دوال الترحيل 011.
(() => {
  'use strict';
  const ui = window.ehsanUI, DM = window.DM;
  if (!ui || !DM) return;
  const {toast} = ui;

  const st = document.createElement('style');
  st.textContent = `.mm-admin-only{display:none}html[data-mm-admin="1"] .mm-admin-only{display:block}.member-acts{margin-top:8px}
  .mm-add-member{display:none;margin-inline-start:auto}html[data-mm-admin="1"] .mm-add-member{display:inline-flex}`;
  document.head.append(st);

  async function db() { return ui.waitDb(); }
  async function committees() {
    const c = await db(); const {data} = await c.from('committees').select('id,name').order('name'); return data || [];
  }
  async function myAdmin() {
    try {
      const c = await db();
      const s = await c.auth.getSession();
      if (!s || !s.data || !s.data.session) { document.documentElement.dataset.mmAdmin = '0'; return false; } // بلا جلسة: لا نستدعي الخادم (يتفادى 401 في الكونسول)
      const {data} = await c.rpc('is_admin');
      document.documentElement.dataset.mmAdmin = data === true ? '1' : '0';
      return data === true;
    } catch { return false; }
  }
  const rpc = async (name, args) => { const c = await db(); const {error} = await c.rpc(name, args); if (error) throw new Error(error.message); };

  async function form(existing) {
    const cms = await committees();
    let cur = [];
    if (existing) { const c = await db(); const r = await c.from('committee_members').select('committee_id').eq('user_id', existing.id); cur = (r.data || []).map(x => x.committee_id); }
    const fields = [
      {name: 'name', label: 'الاسم الكامل', required: true, maxlength: 120, value: existing?.full_name || ''},
      {name: 'job', label: 'المسمى الوظيفي', maxlength: 120, value: existing?.job_title || ''},
      {name: 'org', label: 'الجهة', maxlength: 120, value: existing?.organization || ''},
      {name: 'phone', label: 'الجوال (للواتساب والرسائل)', value: existing?.phone || '', placeholder: '9665XXXXXXXX', help: 'أرقام فقط مع رمز الدولة'},
      {name: 'email', label: 'البريد الإلكتروني', type: 'email', value: existing?.email || ''},
      {name: 'committees', label: 'اللجان', type: 'multi', options: cms.map(c => ({value: c.id, label: c.name})), value: cur}
    ];
    if (existing) fields.push({name: 'active', label: 'عضو نشط', type: 'checkbox', value: existing.is_active !== false});
    return DM.form({
      title: existing ? 'تعديل بيانات العضو' : 'إضافة عضو يدويًا', submit: existing ? 'حفظ' : 'إضافة', wide: true,
      intro: existing ? '' : 'العضو المضاف يدويًا لا يحتاج حساب دخول، ويظهر في اللجان ويستلم الدعوات والتذكيرات على جواله وبريده.',
      fields,
      onSubmit: async v => {
        if (existing) await rpc('update_manual_member', {p_id: existing.id, p_name: v.name, p_job: v.job, p_org: v.org, p_phone: v.phone, p_email: v.email, p_active: v.active, p_committees: v.committees});
        else await rpc('add_manual_member', {p_name: v.name, p_job: v.job, p_org: v.org, p_phone: v.phone, p_email: v.email, p_committees: v.committees});
      }
    });
  }

  async function addButton() {
    const head = document.querySelector('#view-members .section-head');
    if (!head || head.querySelector('.mm-add-member')) return;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn primary mm-add-member'; b.textContent = '＋ إضافة عضو يدويًا';
    b.addEventListener('click', async () => { if (await form(null)) { toast('تمت إضافة العضو'); window.ehsanMembers?.reload(); } });
    head.append(b);
  }

  document.addEventListener('click', async e => {
    const ed = e.target.closest('[data-edit-member]'), del = e.target.closest('[data-del-member]');
    if (!ed && !del) return;
    const id = (ed || del).dataset.editMember || (ed || del).dataset.delMember;
    const m = (window.ehsanMembers?.profiles || []).find(x => x.id === id); if (!m) return;
    if (ed) { if (await form(m)) { toast('تم حفظ التعديل'); window.ehsanMembers?.reload(); } return; }
    const ok = await DM.confirm({title: 'حذف العضو', danger: true, confirmLabel: 'حذف', message: `سيُحذف «${m.full_name}» وتُزال عضويته من اللجان.`});
    if (!ok.ok) return;
    try { await rpc('delete_manual_member', {p_id: id}); toast('تم حذف العضو'); window.ehsanMembers?.reload(); }
    catch (ex) { toast(ex.message); }
  });

  (async () => { await myAdmin(); try { (await db()).auth.onAuthStateChange(() => { setTimeout(myAdmin, 0); }); } catch {} addButton(); new MutationObserver(addButton).observe(document.body, {childList: true, subtree: true}); })();
})();
