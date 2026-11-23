// يُخفي أزرار الإدارة عمّن لا يملك صلاحيتها: «اجتماع جديد» وإرسال الدعوات وإدارة الاجتماع وإنشاء التصويت وإضافة المهام للمدير/أمين السر أو رئيس لجنة؛
// و«لجنة جديدة» للمدير/أمين السر فقط. للواجهة فقط؛ الحماية الفعلية في قاعدة البيانات (الترحيل 039 وما قبله). إن تعذّر التحقق (خطأ شبكة) لا يُخفى شيء.
(() => {
  'use strict';
  const ui = window.ehsanUI;
  if (!ui) return;
  const CHAIR = ['رئيس اللجنة', 'رئيس', 'chair'];
  const CREATE = '[data-view="new-meeting"],[data-view-jump="new-meeting"],#sendInvitations,[data-manage-meeting],#voteForm,#dfAdd';
  const ADMIN = '#addCommitteeBtn';
  const css = (id, sel) => { if (document.getElementById(id)) return; const st = document.createElement('style'); st.id = id; st.textContent = sel + '{display:none!important}'; document.head.append(st); };
  async function start() {
    const db = await ui.waitDb(); if (!db) return;
    const me = await ui.session(db); if (!me || me.admin) return;
    const r = await db.from('committee_members').select('committee_role').eq('user_id', me.uid);
    if (r.error) return;
    css('noAdminButtons', ADMIN);
    if ((r.data || []).some(x => CHAIR.includes(x.committee_role))) return;
    css('noCreateMeeting', CREATE);
  }
  start().catch(err => console.error('meeting-create-guard', err));
})();
