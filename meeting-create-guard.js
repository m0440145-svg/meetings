// يخفي أزرار «اجتماع جديد» عمّن لا يملك صلاحية الإنشاء (الترحيل 039): المدير/أمين السر أو رئيس لجنة. الحماية الفعلية في قاعدة البيانات؛ هذا للواجهة فقط.
// إن تعذّر التحقق (خطأ شبكة) لا يُخفى شيء.
(() => {
  'use strict';
  const ui = window.ehsanUI;
  if (!ui) return;
  const CHAIR = ['رئيس اللجنة', 'رئيس', 'chair'];
  async function start() {
    const db = await ui.waitDb(); if (!db) return;
    const me = await ui.session(db); if (!me || me.admin) return;
    const r = await db.from('committee_members').select('committee_role').eq('user_id', me.uid);
    if (r.error) return;
    if ((r.data || []).some(x => CHAIR.includes(x.committee_role))) return;
    const st = document.createElement('style'); st.id = 'noCreateMeeting'; st.textContent = '[data-view="new-meeting"]{display:none!important}';
    document.head.append(st);
  }
  start().catch(err => console.error('meeting-create-guard', err));
})();
