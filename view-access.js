// يطبّق قائمة الشاشات المسموحة للعضو (profiles.allowed_views، الترحيل 040): يخفي ما لم يُسمح به. للواجهة فقط؛ حماية البيانات في قاعدة البيانات.
// null أو عمود غير موجود أو المدير: لا يُخفى شيء.
(() => {
  'use strict';
  const ui = window.ehsanUI;
  if (!ui) return;
  async function start() {
    const db = await ui.waitDb(); if (!db) return;
    const me = await ui.session(db); if (!me || me.admin) return;
    const r = await db.from('profiles').select('allowed_views').eq('id', me.uid).maybeSingle();
    const v = r.data?.allowed_views;
    if (r.error || !Array.isArray(v)) return;
    const allowed = new Set([...v, 'home']);
    const all = [...new Set([...document.querySelectorAll('[data-view]')].map(b => b.dataset.view))];
    const hide = all.filter(x => x && !allowed.has(x));
    if (!hide.length) return;
    const st = document.createElement('style'); st.id = 'viewAccessStyle';
    st.textContent = hide.map(x => `[data-view="${x.replace(/"/g, '')}"]`).join(',') + '{display:none!important}';
    document.head.append(st);
    const cur = (location.hash || '').replace('#', '');
    if (cur && !allowed.has(cur)) { history.replaceState(null, '', location.pathname + location.search); document.querySelector('[data-view="home"]')?.click(); }
  }
  start().catch(err => console.error('view-access', err));
})();
