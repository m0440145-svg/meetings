(() => {
  // يعيد ترتيب الشريط الجانبي في قوائم منسدلة مرتبة. الأزرار الموجودة تُنقل كما هي (فتبقى معالجاتها تعمل)،
  // والصفحات الجديدة تُنشأ أزرارها هنا وتُفعَّل عبر nav-fix.js (التنقل بـ data-view).
  const nav = document.getElementById('sideNav');
  if (!nav || nav.querySelector('.nav-folder')) return;

  // تنسيق القوائم يُحقن من هذا الملف نفسه، فلا يظهر الشريط بلا تنسيق إذا كان styles.css قديمًا في كاش المتصفح.
  // المحدِّدات تبدأ بـ #sidebar لتتغلب على قواعد القوالب القديمة أيًا كان ترتيب التحميل.
  if (!document.getElementById('nav-groups-style')) {
    const st = document.createElement('style');
    st.id = 'nav-groups-style';
    st.textContent = `
#sidebar{width:300px;background:#fffdfa;color:#3a332f;border-inline-start:1px solid #eadfd8;box-shadow:-8px 0 24px rgba(68,46,31,.05);overflow-y:auto;overscroll-behavior:contain}
.app-shell .main-area{margin-right:300px}
@media(max-width:1100px){#sidebar{width:270px}.app-shell .main-area{margin-right:270px}}
@media(max-width:820px){#sidebar{width:300px;max-width:88vw}.app-shell .main-area{margin-right:0}}
#sidebar [hidden]{display:none!important}
#sidebar .brand-box{border-bottom:1px solid #eadfd8;padding-bottom:16px}
#sidebar .brand-box strong{color:#3a332f}
#sidebar .brand-box small{color:#9a8e87}
#sidebar .logo{background:#fff;border:1px solid #eadfd8}
#sidebar .side-nav{display:grid;gap:6px;margin-top:14px}
#sidebar .nav-item{display:flex;align-items:center;gap:10px;width:100%;border:0;color:#4a403b;background:transparent;padding:9px 12px;border-radius:12px;font:inherit;font-size:14px;font-weight:600;text-align:right;cursor:pointer}
#sidebar .nav-item .ni{width:22px;flex:none;text-align:center;font-style:normal;color:#a6806d}
#sidebar .nav-item:hover{background:#fdf6f0;color:#3a332f}
#sidebar .nav-item.active{background:#fdeadc;color:var(--primary,#cf6028);font-weight:800;box-shadow:inset -3px 0 0 var(--primary,#cf6028)}
#sidebar .nav-item.active .ni{color:var(--primary,#cf6028)}
#sidebar .nav-cta{justify-content:center;gap:8px;padding:12px;border-radius:14px;background:linear-gradient(135deg,var(--primary,#cf6028),var(--accent,#f18927));color:#fff;font-weight:800;box-shadow:0 8px 18px rgba(207,96,40,.25);margin-bottom:6px}
#sidebar .nav-cta .ni,#sidebar .nav-cta:hover,#sidebar .nav-cta.active,#sidebar .nav-cta.active .ni{color:#fff}
#sidebar .nav-cta:hover,#sidebar .nav-cta.active{background:linear-gradient(135deg,var(--primary,#cf6028),var(--accent,#f18927));filter:brightness(1.05);box-shadow:0 8px 18px rgba(207,96,40,.3)}
#sidebar .nav-home{padding:11px 12px;font-size:15px}
#sidebar .nav-folder{display:grid;gap:2px;border-top:1px solid #f3ebe5;padding-top:6px;margin-top:2px}
#sidebar .nav-folder-toggle{display:grid;grid-template-columns:40px 1fr 18px;gap:12px;align-items:center;width:100%;border:0;background:transparent;color:#3a332f;padding:9px 10px;border-radius:16px;text-align:right;cursor:pointer;font:inherit}
#sidebar .nav-folder-toggle:hover{background:#fdf6f0}
#sidebar .nav-folder.has-active>.nav-folder-toggle{background:#fdf1e8}
#sidebar .nf-icon{width:40px;height:40px;border-radius:14px;display:grid;place-items:center;background:#fbeee4;color:var(--primary,#cf6028);font-style:normal;font-size:18px}
#sidebar .nav-folder.has-active .nf-icon{background:linear-gradient(135deg,var(--primary,#cf6028),var(--accent,#f18927));color:#fff}
#sidebar .nf-text{display:grid;gap:1px;min-width:0}
#sidebar .nf-text strong{font-size:14.5px;font-weight:800;color:#3a332f}
#sidebar .nf-text small{font-size:12px;color:#9a8e87;font-weight:400}
#sidebar .nav-folder-toggle .chev{font-style:normal;color:#a6806d;font-size:18px;text-align:center;transition:transform .2s;transform:rotate(90deg)}
#sidebar .nav-folder-toggle[aria-expanded=true] .chev{transform:rotate(-90deg)}
#sidebar .nav-folder-toggle .nf-badge{position:static;grid-column:2;justify-self:start;margin:0}
#sidebar .nav-sub{display:grid;gap:2px;margin:2px 22px 8px 6px;padding:2px 10px 2px 0;border-inline-start:2px solid #f1e3d9}
#sidebar .nav-sub .nav-item{padding:8px 10px;font-size:13.5px;font-weight:600}
#sidebar .side-foot{color:#9a8e87;border-top:1px solid #eadfd8}
`;
    document.head.appendChild(st);
  }

  // الأزرار الحالية قبل إعادة البناء
  const existing = new Map([...nav.querySelectorAll('.nav-item[data-view]')].map(b => [b.dataset.view, b]));

  // نضع الأيقونة في <i> لا <span>، لأن nav-fix.js يقرأ عنوان الصفحة من أول <span> داخل الزر
  function item(view, label, icon) {
    const b = existing.get(view) || Object.assign(document.createElement('button'), {className: 'nav-item'});
    b.dataset.view = view;
    const i = document.createElement('i'); i.className = 'ni'; i.textContent = icon; i.setAttribute('aria-hidden', 'true');
    const s = document.createElement('span'); s.textContent = label;
    b.replaceChildren(i, s);
    return b;
  }

  function setOpen(wrap, open) {
    wrap.querySelector('.nav-sub').hidden = !open;
    wrap.querySelector('.nav-folder-toggle').setAttribute('aria-expanded', String(open));
  }

  function folder(id, title, subtitle, icon, items) {
    const wrap = document.createElement('div');
    wrap.className = 'nav-folder'; wrap.dataset.folder = id;
    const toggle = document.createElement('button');
    toggle.type = 'button'; toggle.className = 'nav-folder-toggle';
    toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', 'navsub-' + id);
    const tile = document.createElement('i'); tile.className = 'nf-icon'; tile.textContent = icon; tile.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span'); text.className = 'nf-text';
    const t = document.createElement('strong'); t.textContent = title;
    const sub = document.createElement('small'); sub.textContent = subtitle;
    text.append(t, sub);
    const chev = document.createElement('i'); chev.className = 'chev'; chev.textContent = '‹'; chev.setAttribute('aria-hidden', 'true');
    toggle.append(tile, text, chev);
    const list = document.createElement('div');
    list.className = 'nav-sub'; list.id = 'navsub-' + id; list.hidden = true;
    items.forEach(([view, label, ic]) => list.append(item(view, label, ic)));
    wrap.append(toggle, list);
    toggle.addEventListener('click', () => setOpen(wrap, list.hidden));
    return wrap;
  }

  // زر الإجراء الرئيسي أعلى القائمة
  const cta = item('new-meeting', 'اجتماع جديد', '＋');
  cta.classList.add('nav-cta');
  const home = item('home', 'الصفحة الرئيسية', '⌂');
  home.classList.add('nav-home');
  // الصفحة الرئيسية العامة: لا تقابل صفحة داخلية، فيعالجها landing.js (للمسجّل) عبر data-site-home
  home.dataset.view = 'site-home'; home.dataset.siteHome = '1';

  const folders = [
    folder('mine', 'مساحة العضو', 'الحساب والتواصل', '☺', [
      ['notifications', 'الإشعارات', '◌'],
      ['mail', 'المراسلات', '✉'],
      ['__summary', 'ملخصي', '▣'],
      ['volunteer', 'الساعات التطوعية', '♡'],
      ['notify-prefs', 'تفضيلات التنبيه', '⚑']
    ]),
    folder('meetings', 'إدارة الاجتماعات', 'التخطيط والانعقاد', '◫', [
      ['dashboard', 'لوحة المعلومات', '▣'],
      ['meetings', 'الاجتماعات', '◫'],
      ['scheduler', 'جدولة الاجتماعات', '▦'],
      ['cycle', 'مركز دورة الاجتماع', '⟳'],
      ['live', 'أثناء الاجتماع', '◉'],
      ['crisis', 'الأزمات والطوارئ', '⚠'],
      ['hospitality', 'طلب ضيافة أثناء الاجتماع', '☕'],
      ['prep', 'مركز التحضير', '⌁'],
      ['schedule', 'استطلاع المواعيد', '◷']
    ]),
    folder('decisions', 'قرارات المجلس واللجان', 'من الصدور إلى الإقفال', '◔', [
      ['dm-dashboard', 'لوحة القرارات', '▣'],
      ['dm-all', 'كل القرارات', '☰'],
      ['dm-board', 'قرارات مجلس الإدارة', '⚖'],
      ['dm-committees', 'قرارات اللجان', '◉'],
      ['dm-recs', 'توصيات اللجان', '✧'],
      ['dm-mine', 'قرارات مكلّف بتنفيذها', '☑'],
      ['tasks', 'المهام والتكليفات', '▤'],
      ['dm-overdue', 'القرارات المتأخرة', '⚠'],
      ['dm-verify', 'طلبات اعتماد الإنجاز', '✔'],
      ['dm-closed', 'المكتملة والمقفلة', '▦'],
      ['dm-previous', 'متابعة قرارات الاجتماعات السابقة', '⟲'],
      ['dm-reports', 'تقارير الإنجاز', '▥'],
      ['dm-kpis', 'مؤشرات الأداء', '▲'],
      ['dm-settings', 'الإعدادات والصلاحيات', '⚙']
    ]),
    folder('governance', 'الحوكمة والتوثيق', 'اللجان والاعتمادات', '⚖', [
      ['committees', 'اللجان', '◉'],
      ['members', 'الأعضاء', '♙'],
      ['elections', 'الترشيحات والانتخابات', '☑'],
      ['votes', 'التصويت والنصاب', '✓'],
      ['minutes', 'محاضر الاجتماعات', '▤'],
      ['circulars', 'قرارات بالتمرير', '⇄'],
      ['signatures', 'التوقيعات', '✍'],
      ['regulations', 'مرجع الأنظمة', '§']
    ]),
    folder('development', 'الذكاء والتطوير', 'الأفكار والتحسين', '✦', [
      ['ai', 'الذكاء والحوكمة', '✦'],
      ['ideas', 'الأفكار والأثر', '✧'],
      ['halls', 'القاعات والامتثال', '⌂'],
      ['maturity', 'المؤسسي المتقدم', '▲']
    ]),
    folder('archive', 'الأرشفة والقياس', 'الذاكرة والتقارير', '▣', [
      ['reports', 'التقارير والقياس', '▥'],
      ['archive', 'الأرشفة والذاكرة', '▦'],
      ['files', 'مركز المرفقات والقراءة', '▱']
    ]),
    folder('platform', 'إدارة المنصة', 'المحتوى والإعدادات', '⚙', [
      ['branding', 'بيانات المنصة', '✎'],
      ['about', 'عن المنصة', 'ⓘ'],
      ['vdr', 'غرفة البيانات الآمنة', '▣'],
      ['security', 'الحوكمة والأمن', '⚿'],
      ['settings', 'الإعدادات والتكاملات', '⚙']
    ])
  ];

  // "ملخصي" يفتح صفحة الملخص الداخلية القديمة (view-home)
  folders.forEach(f => { const b = f.querySelector('.nav-item[data-view="__summary"]'); if (b) b.dataset.view = 'home'; });

  // أي زر لم نصنّفه (إضافات مستقبلية) يبقى في أسفل القائمة بدل أن يضيع
  const placed = new Set(['new-meeting', 'home']);
  folders.forEach(f => f.querySelectorAll('.nav-item[data-view]').forEach(b => placed.add(b.dataset.view)));
  const leftovers = [...existing.entries()].filter(([v]) => !placed.has(v)).map(([, b]) => b);

  nav.replaceChildren(cta, home, ...folders, ...leftovers);

  // عدّاد الإشعارات غير المقروءة على عنوان "مساحة العضو"
  const badge = document.getElementById('notifBadge');
  const mine = nav.querySelector('[data-folder="mine"] .nav-folder-toggle');
  if (badge && mine) {
    const copy = document.createElement('span');
    copy.className = 'badge nf-badge'; copy.hidden = true;
    mine.insertBefore(copy, mine.querySelector('.chev'));
    const update = () => { const n = parseInt(badge.textContent, 10) || 0; copy.textContent = n; copy.hidden = !n; };
    new MutationObserver(update).observe(badge, {childList: true, characterData: true, subtree: true});
    update();
  }

  // يفتح القائمة التي فيها الصفحة الحالية ويميّزها
  function sync() {
    nav.querySelectorAll('.nav-folder').forEach(f => {
      const active = !!f.querySelector('.nav-item.active');
      f.classList.toggle('has-active', active);
      if (active) setOpen(f, true);
    });
  }
  document.addEventListener('click', e => { if (e.target.closest('[data-view],[data-view-jump]')) setTimeout(sync, 0); }, true);
  new MutationObserver(sync).observe(nav, {attributes: true, attributeFilter: ['class'], subtree: true});
  // الأزرار أُنشئت بعد تفعيل الصفحة من الرابط (مثل #cycle)، فنطابق التمييز مع الصفحة المعروضة الآن
  const cur = document.querySelector('.view.active')?.id.replace(/^view-/, '');
  nav.querySelectorAll('.nav-item[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === cur));
  sync();
})();
