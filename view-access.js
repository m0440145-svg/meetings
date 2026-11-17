// يطبّق قائمة الشاشات المسموحة للعضو العادي. للواجهة فقط؛ حماية البيانات في قاعدة البيانات (RLS وعضوية اللجان).
// المدير وأمين السر: لا يُخفى شيء. العضو العادي: إن حدّد المدير له شاشات (profiles.allowed_views، الترحيل 040) فهي وحدها، وإلا تُطبَّق القائمة الأساسية الافتراضية أدناه.
// رئيس اللجنة يُتاح له «اجتماع جديد» أيضًا. الأقسام وبطاقات الصفحة الرئيسية التي لا يبقى فيها ما يصل إليه تُخفى. القائمة الأساسية تُوسَّع من «الصلاحيات» في صفحة الأعضاء.
(() => {
  'use strict';
  const ui = window.ehsanUI;
  if (!ui) return;
  const DEFAULT_MEMBER = ['home', 'site-home', 'notifications', 'mail', '__summary', 'volunteer', 'notify-prefs', 'meetings', 'schedule', 'dm-mine', 'tasks',
    'members', 'committees', 'elections', 'votes', 'surveys', 'minutes', 'board-packs', 'conflicts', 'reg-assist', 'circulars', 'signatures', 'regulations', 'vdr', 'files', 'about', 'ideas'];
  const CHAIR = ['رئيس اللجنة', 'رئيس', 'chair'];
  async function start() {
    const db = await ui.waitDb(); if (!db) return;
    const me = await ui.session(db); if (!me || me.admin) return;
    const [r, cm] = await Promise.all([db.from('profiles').select('allowed_views').eq('id', me.uid).maybeSingle(), db.from('committee_members').select('committee_role').eq('user_id', me.uid)]);
    const custom = !r.error && Array.isArray(r.data?.allowed_views) ? r.data.allowed_views : null;
    const allowed = new Set([...(custom || DEFAULT_MEMBER), 'home', 'site-home']);
    if (!cm.error && (cm.data || []).some(x => CHAIR.includes(x.committee_role))) allowed.add('new-meeting'); // رئيس اللجنة يُنشئ اجتماعات لجنته
    const all = [...new Set([...document.querySelectorAll('[data-view],[data-view-jump]')].map(b => b.dataset.view || b.dataset.viewJump))];
    const hide = new Set(all.filter(x => x && !allowed.has(x)));
    if (!hide.size) return;
    const esc = x => x.replace(/"/g, '');
    const st = document.createElement('style'); st.id = 'viewAccessStyle';
    st.textContent = [...hide].map(x => `[data-view="${esc(x)}"],[data-view-jump="${esc(x)}"]`).join(',') + '{display:none!important}';
    document.head.append(st);
    const sweep = () => {
      // أخفِ الأقسام الفارغة في القائمة
      document.querySelectorAll('#sidebar .nav-folder').forEach(f => {
        const items = [...f.querySelectorAll('[data-view]')];
        if (items.length && items.every(i => hide.has(i.dataset.view))) f.style.display = 'none';
      });
      // أخفِ بطاقات الصفحة الرئيسية التي كل أزرارها تقود لشاشات غير متاحة
      document.querySelectorAll('#view-home [data-view-jump]').forEach(b => {
        if (!hide.has(b.dataset.viewJump)) return;
        const box = b.closest('article,.card,.feature-card,.quick-card');
        if (!box || box.dataset.vaChecked) return;
        const live = [...box.querySelectorAll('button,a')].some(x => !(x.dataset.viewJump && hide.has(x.dataset.viewJump)) && getComputedStyle(x).display !== 'none');
        if (!live) { box.dataset.vaChecked = '1'; box.style.display = 'none'; }
      });
    };
    sweep(); setTimeout(sweep, 1500); setTimeout(sweep, 4000);
    const cur = (location.hash || '').replace('#', '');
    if (cur && hide.has(cur)) { history.replaceState(null, '', location.pathname + location.search); document.querySelector('[data-view="home"]')?.click(); }
  }
  start().catch(err => console.error('view-access', err));
})();
