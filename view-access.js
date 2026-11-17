// يطبّق قائمة الشاشات المسموحة للعضو العادي. للواجهة فقط؛ حماية البيانات في قاعدة البيانات (RLS وعضوية اللجان).
// المدير وأمين السر: لا يُخفى شيء. العضو العادي: إن حدّد المدير له شاشات (profiles.allowed_views، الترحيل 040) فهي وحدها، وإلا تُطبَّق القائمة الأساسية الافتراضية أدناه.
// الأقسام التي تفرغ كل عناصرها تُخفى. القائمة الأساسية تُوسَّع من «الصلاحيات» في صفحة الأعضاء.
(() => {
  'use strict';
  const ui = window.ehsanUI;
  if (!ui) return;
  const DEFAULT_MEMBER = ['home', 'site-home', 'notifications', 'mail', '__summary', 'volunteer', 'notify-prefs', 'meetings', 'schedule', 'dm-mine', 'tasks',
    'members', 'committees', 'elections', 'votes', 'surveys', 'minutes', 'board-packs', 'conflicts', 'reg-assist', 'circulars', 'signatures', 'regulations', 'vdr', 'files', 'about', 'ideas'];
  async function start() {
    const db = await ui.waitDb(); if (!db) return;
    const me = await ui.session(db); if (!me || me.admin) return;
    const r = await db.from('profiles').select('allowed_views').eq('id', me.uid).maybeSingle();
    const custom = !r.error && Array.isArray(r.data?.allowed_views) ? r.data.allowed_views : null;
    const allowed = new Set([...(custom || DEFAULT_MEMBER), 'home', 'site-home']);
    const all = [...new Set([...document.querySelectorAll('[data-view]')].map(b => b.dataset.view))];
    const hide = new Set(all.filter(x => x && !allowed.has(x)));
    if (!hide.size) return;
    const st = document.createElement('style'); st.id = 'viewAccessStyle';
    st.textContent = [...hide].map(x => `[data-view="${x.replace(/"/g, '')}"]`).join(',') + '{display:none!important}';
    document.head.append(st);
    // أخفِ الأقسام الفارغة
    const sweep = () => document.querySelectorAll('#sidebar .nav-folder').forEach(f => {
      const items = [...f.querySelectorAll('[data-view]')];
      if (items.length && items.every(i => hide.has(i.dataset.view))) f.style.display = 'none';
    });
    sweep(); setTimeout(sweep, 1500); setTimeout(sweep, 4000);
    const cur = (location.hash || '').replace('#', '');
    if (cur && hide.has(cur)) { history.replaceState(null, '', location.pathname + location.search); document.querySelector('[data-view="home"]')?.click(); }
  }
  start().catch(err => console.error('view-access', err));
})();
