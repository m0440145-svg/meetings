(() => {
  // شاشات وحدة القرارات: الهيكل والتوجيه، لوحة المعلومات، القوائم (الكل/المجلس/اللجان/التوصيات/قراراتي/المتأخرة/طلبات الاعتماد/المقفلة)، متابعة قرارات الاجتماع السابق.
  const DM = window.DM, {esc, toast, empty, failed, onOpen} = DM.ui;
  DM.screens = {}; DM.preset = {}; DM.state = {};
  DM.register = (name, fn) => { DM.screens[name] = fn; };
  const $sec = name => document.getElementById('view-dm-' + name);

  DM.ensureSections = () => {
    const main = document.querySelector('.main-area');
    Object.keys(DM.screens).concat('detail').forEach(n => {
      if ($sec(n) || !main) return;
      const s = document.createElement('section'); s.className = 'view dm-scope'; s.id = 'view-dm-' + n; main.append(s);
    });
  };

  // تشغيل شاشة (من القائمة أو من داخل وحدة أخرى)
  DM.render = async (name, preset) => {
    const el = $sec(name); if (!el) return;
    if (preset) DM.preset[name] = preset;
    el.classList.add('dm-scope'); el.setAttribute('aria-busy', 'true');
    try {
      await DM.ready;
      if (!DM.me.uid) { el.innerHTML = '<div class="dm-banner">سجّل الدخول لاستخدام إدارة القرارات.</div>'; return; }
      await DM.loadRefs();
      await DM.screens[name](el, DM.preset[name] || {});
    } catch (e) {
      console.error('dm', name, e);
      el.innerHTML = `<div class="dm-banner" role="alert"><strong>تعذر عرض الشاشة:</strong> ${esc(e.message)}<br><small>إن كانت وحدة القرارات جديدة فتأكد من تنفيذ الترحيلين 007 و008 في Supabase.</small></div>`;
    } finally { el.removeAttribute('aria-busy'); }
  };
  DM.show = (name, preset) => { if (preset !== undefined) DM.preset[name] = preset; window.ehsanActivateView?.('dm-' + name); return DM.render(name); };

  const head = (title, sub, actions = '') => `<div class="dm-head"><div><span class="eyebrow">القرارات ومتابعة التنفيذ</span><h2>${esc(title)}</h2>${sub ? `<p class="dm-sub">${esc(sub)}</p>` : ''}</div><div class="dm-acts-top dm-noprint">${actions}<button class="dm-btn sm ghost dm-theme" type="button" aria-label="تبديل الوضع الفاتح والداكن">◐ الوضع</button></div></div>`;
  DM.head = head;
  const bindTheme = el => el.querySelector('.dm-theme')?.addEventListener('click', () => DM.setTheme(document.documentElement.dataset.dmTheme === 'dark' ? 'light' : 'dark'));
  DM.bindCommon = bindTheme;
  const noRoleBanner = () => DM.hasAnyRole() ? '' : '<div class="dm-banner">لا تملك دورًا في وحدة القرارات؛ يظهر لك فقط ما كُلِّفت بتنفيذه أو ما أتيح لك الاطلاع عليه. يمنح المدير الأدوار من «الإعدادات والصلاحيات».</div>';
  DM.noRoleBanner = noRoleBanner;
  const unitOpts = () => '<option value="">كل الإدارات</option>' + DM.refs.units.map(u => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('');
  const comOpts = () => '<option value="">كل الجهات</option>' + DM.refs.committees.map(u => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('');
  const userOpts = () => '<option value="">كل المسؤولين</option>' + DM.refs.profiles.map(u => `<option value="${esc(u.id)}">${esc(u.full_name || 'مستخدم')}</option>`).join('');
  DM.opts = {unit: unitOpts, committee: comOpts, user: userOpts};

  // ───────────── لوحة المعلومات ─────────────
  DM.register('dashboard', async (el, preset) => {
    const F = DM.state.dash ||= {committee_id: '', unit_id: '', owner_id: '', priority: '', status: '', year: '', from: '', to: '', body_kind: ''};
    Object.assign(F, preset || {}); DM.preset.dashboard = {};
    const years = [...new Set(DM.refs.meetings.map(m => String(m.gregorian_date || '').slice(0, 4)).filter(Boolean).concat(String(new Date().getFullYear())))].sort().reverse();
    el.innerHTML = head('لوحة القرارات', 'مؤشرات مباشرة من بيانات القرارات المصرَّح لك بالاطلاع عليها', DM.can('create') ? '<button class="dm-btn primary sm dm-new" type="button">＋ قرار جديد</button>' : '') + noRoleBanner() + `
      <form class="dm-filters dm-noprint" id="dmDashF">
        <label>الجهة<select name="committee_id">${comOpts()}</select></label><label>الإدارة<select name="unit_id">${unitOpts()}</select></label>
        <label>المسؤول<select name="owner_id">${userOpts()}</select></label><label>السنة<select name="year"><option value="">كل السنوات</option>${years.map(y => `<option>${y}</option>`).join('')}</select></label>
        <label>الأولوية<select name="priority"><option value="">الكل</option>${Object.entries(DM.PRIORITY).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <label>الحالة<select name="status"><option value="">الكل</option>${Object.entries(DM.STATUS).filter(([k]) => !['draft', 'pending_approval', 'cancelled'].includes(k)).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('')}</select></label>
        <label>النوع<select name="body_kind"><option value="">الكل</option><option value="board">مجلس إدارة</option><option value="committee">لجان</option></select></label>
        <label>من<input type="date" name="from"></label><label>إلى<input type="date" name="to"></label>
        <button class="dm-btn sm ghost" type="button" id="dmDashReset">مسح</button></form>
      <div id="dmDashBody" aria-live="polite"><div class="dm-nodata">جارٍ التحميل…</div></div>`;
    bindTheme(el); el.querySelector('.dm-new')?.addEventListener('click', () => DM.openForm?.());
    const form = el.querySelector('#dmDashF');
    Object.entries(F).forEach(([k, v]) => { if (form.elements[k]) form.elements[k].value = v; });
    const run = async () => {
      Object.keys(F).forEach(k => { F[k] = form.elements[k]?.value || ''; });
      const body = el.querySelector('#dmDashBody');
      const clean = Object.fromEntries(Object.entries(F).filter(([, v]) => v));
      const K = await DM.rpc('dm_kpis', {p: clean});
      const c = K.cards, r = K.rates;
      const card = (cls, label, val, sub, go) => `<button type="button" class="dm-kpi ${cls}" data-go='${esc(JSON.stringify(go || {}))}'><span>${esc(label)}</span><strong>${val}</strong><small>${esc(sub || '')}</small></button>`;
      const pct = v => v === null || v === undefined ? '—' : DM.num(v) + '%';
      body.innerHTML = `<div class="dm-cards">
        ${card('', 'إجمالي القرارات', DM.num(c.total), 'المعتمدة غير الملغاة', {})}
        ${card('', 'المعتمدة', DM.num(c.approved), 'مؤهلة للتنفيذ والقياس', {})}
        ${card('', 'قيد التنفيذ', DM.num(c.in_execution), `${DM.num(c.pending_assignment)} بانتظار الإسناد`, {statusGroup: 'active'})}
        ${card('good', 'المنجزة', DM.num(c.completed), 'مكتملة ومقفلة', {statusGroup: 'completed'})}
        ${card('good', 'المقفلة', DM.num(c.closed), 'اعتُمد إقفالها', {status: 'closed'})}
        ${card(c.overdue ? 'bad' : 'good', 'المتأخرة', DM.num(c.overdue), c.overdue ? 'تحتاج متابعة' : 'لا تأخير', {overdue: true})}
        ${card(c.pending_verification ? 'warn' : '', 'بانتظار اعتماد الإنجاز', DM.num(c.pending_verification), 'لدى المتحقق', {status: 'pending_verification'})}
        ${card(c.high_priority_open ? 'warn' : '', 'عالية الأولوية المفتوحة', DM.num(c.high_priority_open), 'عالية وحرجة', {prioHigh: true})}
        ${card('', 'نسبة الإنجاز الإجمالية', pct(c.overall_progress), 'متوسط التقدم', {})}
        ${card(r.ontime_rate !== null && r.ontime_rate < 70 ? 'warn' : 'good', 'الالتزام بالمواعيد', pct(r.ontime_rate), `بالموعد ${K.policy.measure_against === 'original' ? 'الأصلي' : 'المعتمد'}`, {})}</div>
        <div class="dm-grid c2">
          <section class="dm-card"><h3>توزيع القرارات حسب الحالة</h3>${DM.charts.donut(Object.entries(K.by_status).map(([k, v]) => ({label: DM.STATUS[k]?.[0] || k, value: v})), {title: 'توزيع القرارات حسب الحالة'})}</section>
          <section class="dm-card"><h3>القرارات حسب الأولوية</h3>${DM.charts.bars(['critical', 'high', 'medium', 'low'].map(p => ({label: DM.PRIORITY[p], value: K.by_priority[p] || 0})), {title: 'القرارات حسب الأولوية'})}</section>
          <section class="dm-card"><h3>القرارات حسب المجلس أو اللجنة</h3>${DM.charts.bars(K.by_committee.map(x => ({label: x.name, value: x.total, sub: `منجز ${x.completed} · متأخر ${x.overdue}`})), {title: 'القرارات حسب الجهة'})}</section>
          <section class="dm-card"><h3>الإنجاز حسب الإدارة التنفيذية</h3>${DM.charts.bars(K.by_unit.map(x => ({label: x.name, value: x.avg_progress ?? 0, max: 100, sub: `${x.total} قرارًا · منجز ${x.completed} · متأخر ${x.overdue}`})), {unit: '%', title: 'متوسط الإنجاز حسب الإدارة'})}</section>
          <section class="dm-card"><h3>المنجز والمتأخر شهريًا (حسب شهر الاستحقاق)</h3>${DM.charts.grouped(K.monthly, [{key: 'completed_on_time', label: 'أُنجز في موعده', color: '#2d7a5a'}, {key: 'completed_late', label: 'أُنجز متأخرًا', color: '#c4a02a'}, {key: 'open_overdue', label: 'متأخر مفتوح', color: '#b3261e'}], {title: 'مقارنة المنجز والمتأخر شهريًا'})}</section>
          <section class="dm-card"><h3>اتجاه الإنجاز (القرارات المنجزة شهريًا)</h3>${DM.charts.line(K.monthly.map(m => ({label: m.month, value: m.completed_in_month})), {title: 'اتجاه الإنجاز عبر الزمن'})}</section>
        </div>
        <section class="dm-card" style="margin-top:14px"><h3>مؤشرات المدد</h3><div class="dm-info-grid"><div><span>متوسط مدة التنفيذ</span><b>${r.avg_exec_days === null ? '—' : DM.num(r.avg_exec_days) + ' يوم'}</b></div>
          <div><span>متوسط مدة الإقفال (من الإسناد)</span><b>${r.avg_close_days === null ? '—' : DM.num(r.avg_close_days) + ' يوم'}</b></div>
          <div><span>معدل الإقفال</span><b>${pct(r.closure_rate)}</b></div><div><span>نسبة المتأخرة من المستحقة المفتوحة</span><b>${pct(r.overdue_rate)}</b></div></div></section>`;
      body.querySelectorAll('.dm-kpi').forEach(b => b.addEventListener('click', () => DM.show('all', JSON.parse(b.dataset.go || '{}'))));
    };
    const safe = () => run().catch(e => { el.querySelector('#dmDashBody').innerHTML = `<div class="dm-banner" role="alert">${esc(e.message)}</div>`; });
    form.addEventListener('change', safe); form.addEventListener('submit', e => e.preventDefault());
    el.querySelector('#dmDashReset').addEventListener('click', () => { Object.keys(F).forEach(k => { F[k] = ''; if (form.elements[k]) form.elements[k].value = ''; }); safe(); });
    await safe();
  });

  // ───────────── القوائم ─────────────
  const TABLE_COLS = {
    ref: {h: 'الرقم', get: d => d.ref_no, cell: d => `<td class="ref">${esc(d.ref_no)}</td>`},
    title: {h: 'العنوان', get: d => d.title, cell: d => `<td><strong>${esc(d.title)}</strong>${d.meeting_no ? `<br><small>الاجتماع ${esc(d.meeting_no)}</small>` : ''}</td>`},
    body: {h: 'الجهة', get: d => DM.nameOf.committee(d.committee_id), cell: d => `<td>${esc(DM.BODY[d.body_kind] || '')}<br><small>${esc(DM.nameOf.committee(d.committee_id))}</small></td>`},
    type: {h: 'النوع', get: d => d.record_type, cell: d => `<td>${esc(DM.RECORD[d.record_type] || '')}<br><small>${esc(DM.CATEGORY[d.category] || '')}</small></td>`},
    owner: {h: 'المسؤول / الإدارة', get: d => DM.nameOf.user(d.owner_id), cell: d => `<td>${esc(d.owner_id ? DM.nameOf.user(d.owner_id) : '—')}<br><small>${esc(d.responsible_unit_id ? DM.nameOf.unit(d.responsible_unit_id) : '')}</small></td>`},
    due: {h: 'الاستحقاق', get: d => d.due_date || '9999', cell: d => { const x = DM.dueText(d.status, d.due_date); return `<td><span class="${x.cls === 'late' ? 'dm-late' : x.cls === 'soon' ? 'dm-soon' : ''}">${esc(x.text)}</span>${d.extension_count ? `<br><small>مُدّد ${d.extension_count}×</small>` : ''}</td>`; }},
    progress: {h: 'الإنجاز', get: d => d.progress_pct, cell: d => `<td>${DM.bar(d.progress_pct, ['completed', 'closed'].includes(d.status))}</td>`},
    status: {h: 'الحالة', get: d => DM.STATUS[d.status]?.[0] || d.status, cell: d => `<td>${DM.badge(d.status)} ${DM.lateBadge(d)}</td>`},
    priority: {h: 'الأولوية', get: d => ({critical: 0, high: 1, medium: 2, low: 3})[d.priority], cell: d => `<td>${DM.prio(d.priority)}</td>`},
    created: {h: 'التسجيل', get: d => d.created_at, cell: d => `<td>${esc(DM.date(String(d.created_at).slice(0, 10)))}</td>`},
    daysLate: {h: 'أيام التأخر', get: d => (d.due_date ? DM.daysLate(d.due_date) : 0), cell: d => `<td><span class="dm-late">${DM.daysLate(d.due_date)}</span></td>`},
    completedAt: {h: 'تاريخ الإنجاز', get: d => d.completed_at || '', cell: d => `<td>${esc(DM.date(d.completed_at ? String(d.completed_at).slice(0, 10) : ''))}</td>`},
    closedAt: {h: 'تاريخ الإقفال', get: d => d.closed_at || '', cell: d => `<td>${esc(DM.date(d.closed_at ? String(d.closed_at).slice(0, 10) : ''))}</td>`}
  };
  const matchGroup = (d, g) => g === 'active' ? DM.ACTIVE.includes(d.status) : g === 'completed' ? ['completed', 'closed'].includes(d.status) : true;

  async function renderList(el, cfg, preset) {
    const S = DM.state['list_' + cfg.id] ||= {q: '', committee: '', status: '', priority: '', unit: '', owner: '', category: '', overdue: false, statusGroup: '', prioHigh: false, page: 0, sort: cfg.sort || {key: 'created', dir: -1}};
    if (preset && Object.keys(preset).length) { Object.assign(S, {q: '', committee: '', status: '', priority: '', unit: '', owner: '', category: '', overdue: false, statusGroup: '', prioHigh: false, page: 0}, preset); DM.preset[cfg.screen] = {}; }
    const canNew = cfg.newBtn !== false && DM.can('create');
    el.innerHTML = head(cfg.title, cfg.sub, canNew ? '<button class="dm-btn primary sm dm-new" type="button">＋ ' + (cfg.newLabel || 'قرار جديد') + '</button>' : '') + noRoleBanner() + `
      <form class="dm-filters dm-noprint"><label>بحث<input type="search" name="q" placeholder="رقم أو عنوان أو مسؤول" value="${esc(S.q)}"></label>
        <label>الجهة<select name="committee">${comOpts()}</select></label><label>الإدارة<select name="unit">${unitOpts()}</select></label><label>المسؤول<select name="owner">${userOpts()}</select></label>
        ${cfg.noStatus ? '' : `<label>الحالة<select name="status"><option value="">الكل</option>${Object.entries(DM.STATUS).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('')}</select></label>`}
        <label>الأولوية<select name="priority"><option value="">الكل</option>${Object.entries(DM.PRIORITY).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <label>التصنيف<select name="category"><option value="">الكل</option>${Object.entries(DM.CATEGORY).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <label class="dm-chk"><input type="checkbox" name="overdue"> المتأخرة فقط</label></form>
      <div class="dm-table-wrap"><table class="dm-table"><thead><tr></tr></thead><tbody></tbody></table></div><div class="dm-pager dm-noprint"></div>`;
    bindTheme(el); el.querySelector('.dm-new')?.addEventListener('click', () => DM.openForm?.(cfg.formPreset));
    const form = el.querySelector('form');
    ['committee', 'unit', 'owner', 'status', 'priority', 'category'].forEach(k => { if (form.elements[k]) form.elements[k].value = S[k]; }); form.elements.overdue.checked = S.overdue;
    let all = await DM.loadDecisions(); let extra = {};
    all = all.filter(cfg.base);
    if (cfg.extras) extra = await cfg.extras(all);
    const draw = () => {
      const q = S.q.trim().toLowerCase();
      let rows = all.filter(d => (!S.committee || d.committee_id === S.committee) && (!S.unit || d.responsible_unit_id === S.unit) && (!S.owner || d.owner_id === S.owner) && (!S.status || d.status === S.status)
        && (!S.priority || d.priority === S.priority) && (!S.category || d.category === S.category) && (!S.overdue || DM.isOverdue(d.status, d.due_date)) && matchGroup(d, S.statusGroup) && (!S.prioHigh || ['high', 'critical'].includes(d.priority))
        && (!q || `${d.ref_no} ${d.title} ${DM.nameOf.user(d.owner_id)} ${DM.nameOf.unit(d.responsible_unit_id)}`.toLowerCase().includes(q)));
      const cols = cfg.cols.map(c => typeof c === 'string' ? {key: c, ...TABLE_COLS[c]} : c);
      const sc = cols.find(c => c.key === S.sort.key) || cols[0];
      rows.sort((a, b) => { const x = sc.get(a, extra), y = sc.get(b, extra); return (x > y ? 1 : x < y ? -1 : 0) * S.sort.dir; });
      const PS = 25, pages = Math.max(1, Math.ceil(rows.length / PS)); S.page = Math.min(S.page, pages - 1);
      el.querySelector('thead tr').innerHTML = cols.map(c => `<th scope="col" data-k="${esc(c.key)}" aria-sort="${S.sort.key === c.key ? (S.sort.dir > 0 ? 'ascending' : 'descending') : 'none'}" tabindex="0">${esc(c.h)}${S.sort.key === c.key ? (S.sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
      el.querySelector('tbody').innerHTML = rows.slice(S.page * PS, S.page * PS + PS).map(d => `<tr data-id="${esc(d.id)}" tabindex="0">${cols.map(c => c.cell(d, extra)).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="dm-nodata">${esc(cfg.empty || 'لا توجد قرارات مطابقة')}</td></tr>`;
      el.querySelector('.dm-pager').innerHTML = `<span>${DM.num(rows.length)} قرارًا</span> ${pages > 1 ? `<button class="dm-btn sm ghost" data-p="-1" ${S.page === 0 ? 'disabled' : ''}>السابق</button> <span>${S.page + 1} / ${pages}</span> <button class="dm-btn sm ghost" data-p="1" ${S.page >= pages - 1 ? 'disabled' : ''}>التالي</button>` : ''}`;
      if (cfg.after) cfg.after(el, rows, extra);
    };
    form.addEventListener('input', e => { const t = e.target; S[t.name] = t.type === 'checkbox' ? t.checked : t.value; if (t.name !== 'q') S.statusGroup = S.statusGroup; S.page = 0; draw(); });
    form.addEventListener('submit', e => e.preventDefault());
    el.addEventListener('click', e => {
      const th = e.target.closest('th[data-k]'); if (th && el.contains(th)) { S.sort = {key: th.dataset.k, dir: S.sort.key === th.dataset.k ? -S.sort.dir : 1}; draw(); return; }
      const pg = e.target.closest('[data-p]'); if (pg) { S.page += Number(pg.dataset.p); draw(); return; }
      const tr = e.target.closest('tbody tr[data-id]'); if (tr) DM.openDetail?.(tr.dataset.id);
    });
    el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('tbody tr[data-id]')) DM.openDetail?.(e.target.dataset.id); });
    draw();
  }

  // أسباب التأخر والتصعيد للشاشة المتأخرة
  async function overdueExtras(rows) {
    const ids = rows.map(d => d.id); const out = {blocker: {}, corrective: {}, ext: {}, esc: {}};
    if (!ids.length) return out;
    const [ups, exts, evs] = await Promise.all([
      DM.sel('decision_updates', q => q.in('decision_id', ids).in('kind', ['blocker', 'corrective']).order('created_at', {ascending: true})),
      DM.sel('decision_extensions', q => q.in('decision_id', ids).eq('status', 'pending')),
      DM.sel('decision_events', q => q.in('decision_id', ids).eq('event_type', 'escalation').order('id', {ascending: true}))
    ]);
    ups.forEach(u => { (u.kind === 'blocker' ? out.blocker : out.corrective)[u.decision_id] = u.body; });
    exts.forEach(x => { out.ext[x.decision_id] = x.requested_due; });
    evs.forEach(e => { out.esc[e.decision_id] = e.payload?.level || 'unit_head'; });
    return out;
  }
  const ESC = {unit_head: 'رئيس الإدارة', upper: 'الجهة الأعلى', report: 'تقرير خاص'};

  const LISTS = {
    all: {title: 'كل القرارات', sub: 'جميع القرارات المصرَّح لك بالاطلاع عليها', base: () => true, cols: ['ref', 'title', 'body', 'owner', 'due', 'progress', 'status', 'priority']},
    board: {title: 'قرارات مجلس الإدارة', sub: 'القرارات والتكليفات الصادرة عن مجلس الإدارة', base: d => d.body_kind === 'board' && d.record_type !== 'recommendation', cols: ['ref', 'title', 'owner', 'due', 'progress', 'status', 'priority'], formPreset: {body_kind: 'board'}},
    committees: {title: 'قرارات اللجان', sub: 'القرارات الصادرة عن اللجان المنبثقة', base: d => d.body_kind === 'committee' && d.record_type !== 'recommendation', cols: ['ref', 'title', 'body', 'owner', 'due', 'progress', 'status', 'priority'], formPreset: {body_kind: 'committee'}},
    recs: {title: 'توصيات اللجان', sub: 'التوصية لا تصبح قرارًا ملزمًا إلا بعد التصديق عليها من المخوَّل', base: d => d.record_type === 'recommendation', cols: ['ref', 'title', 'body', 'created', 'status', 'priority'], formPreset: {record_type: 'recommendation', body_kind: 'committee'}, newLabel: 'توصية جديدة', empty: 'لا توجد توصيات'},
    mine: {title: 'قرارات مكلَّف بتنفيذها', sub: 'القرارات المسندة إليك أو التي تساعد في تنفيذها أو لك فيها إجراء فرعي', newBtn: false,
      base: d => d.owner_id === DM.me.uid || (DM._mineIds || new Set()).has(d.id), cols: ['ref', 'title', 'due', 'progress', 'status', 'priority'], empty: 'لا توجد قرارات مكلّف بتنفيذها',
      async prep() { const [a, x] = await Promise.all([DM.sel('decision_assistants', q => q.eq('user_id', DM.me.uid)), DM.sel('decision_actions', q => q.eq('owner_id', DM.me.uid))]); DM._mineIds = new Set([...a.map(r => r.decision_id), ...x.map(r => r.decision_id)]); }},
    overdue: {title: 'القرارات المتأخرة', sub: 'مفتوحة تجاوزت موعد استحقاقها، مع أسباب التأخر والإجراء التصحيحي وحالة التصعيد', newBtn: false, noStatus: true, base: d => DM.isOverdue(d.status, d.due_date), sort: {key: 'daysLate', dir: -1},
      cols: ['ref', 'title', 'owner', 'daysLate', {key: 'reason', h: 'سبب التأخر', get: (d, x) => x.blocker?.[d.id] || '', cell: (d, x) => `<td>${esc(x.blocker?.[d.id] || '—')}</td>`}, {key: 'corr', h: 'الإجراء التصحيحي', get: (d, x) => x.corrective?.[d.id] || '', cell: (d, x) => `<td>${esc(x.corrective?.[d.id] || '—')}</td>`},
        {key: 'prop', h: 'الموعد الجديد المقترح', get: (d, x) => x.ext?.[d.id] || '', cell: (d, x) => `<td>${x.ext?.[d.id] ? esc(DM.date(x.ext[d.id])) : '—'}</td>`}, {key: 'esc', h: 'حالة التصعيد', get: (d, x) => x.esc?.[d.id] || '', cell: (d, x) => `<td>${x.esc?.[d.id] ? `<span class="dm-badge s-late">${esc(ESC[x.esc[d.id]] || x.esc[d.id])}</span>` : (d.escalated_to_report ? 'في التقرير الخاص' : '—')}</td>`}, 'progress'],
      extras: overdueExtras},
    verify: {title: 'طلبات اعتماد الإنجاز', sub: 'قرارات أرسل مسؤولوها طلب اعتماد الإنجاز، أو اعتُمد إنجازها وتنتظر اعتماد الإقفال', newBtn: false, noStatus: true, base: d => ['pending_verification', 'completed'].includes(d.status),
      cols: ['ref', 'title', 'owner', {key: 'req', h: 'تاريخ الطلب', get: d => d.verification_requested_at || '', cell: d => `<td>${esc(DM.date(d.verification_requested_at ? String(d.verification_requested_at).slice(0, 10) : ''))}</td>`}, 'progress', 'status'], empty: 'لا توجد طلبات اعتماد'},
    closed: {title: 'القرارات المكتملة والمقفلة', sub: 'أرشيف القرارات المنجزة، مع تواريخ الإنجاز والإقفال', newBtn: false, base: d => ['completed', 'closed', 'cancelled'].includes(d.status), sort: {key: 'closedAt', dir: -1},
      cols: ['ref', 'title', 'body', 'owner', 'completedAt', 'closedAt', 'status'], empty: 'لا توجد قرارات مكتملة'}
  };
  Object.entries(LISTS).forEach(([id, cfg]) => DM.register(id, async (el, preset) => { if (cfg.prep) await cfg.prep(); await renderList(el, {...cfg, id, screen: id}, preset); }));

  // ───────────── متابعة قرارات الاجتماعات السابقة ─────────────
  DM.register('previous', async (el, preset) => {
    const S = DM.state.prev ||= {meeting: ''};
    if (preset?.meeting) S.meeting = preset.meeting;
    const meetings = DM.refs.meetings; const today = new Date().toISOString().slice(0, 10);
    if (!S.meeting) S.meeting = (meetings.filter(m => m.gregorian_date >= today).sort((a, b) => a.gregorian_date.localeCompare(b.gregorian_date))[0] || meetings[0] || {}).id || '';
    el.innerHTML = head('متابعة تنفيذ قرارات الاجتماعات السابقة', 'اختر الاجتماع لعرض آخر حالة لقرارات الجهة قبله، وإصدار توجيهات أو طلب إيضاحات ضمن صلاحياتك') + noRoleBanner() +
      `<form class="dm-filters dm-noprint"><label>الاجتماع<select name="meeting">${meetings.map(m => `<option value="${esc(m.id)}">${esc(m.title)} — ${esc(m.gregorian_date)} (${esc(DM.nameOf.committee(m.committee_id))})</option>`).join('')}</select></label></form><div id="dmPrev"></div>`;
    bindTheme(el); const sel = el.querySelector('select'); sel.value = S.meeting;
    const run = async () => {
      S.meeting = sel.value; const box = el.querySelector('#dmPrev');
      if (!S.meeting) { box.innerHTML = empty('لا توجد اجتماعات'); return; }
      const r = await DM.rpc('dm_previous_report', {p_meeting: S.meeting});
      const s = r.summary;
      box.innerHTML = `<div class="dm-cards"><div class="dm-kpi"><span>قرارات سابقة</span><strong>${DM.num(s.total)}</strong></div><div class="dm-kpi good"><span>منجزة / مقفلة</span><strong>${DM.num(s.completed + s.closed)}</strong></div>
        <div class="dm-kpi"><span>قيد التنفيذ</span><strong>${DM.num(s.in_progress)}</strong></div><div class="dm-kpi ${s.overdue ? 'bad' : 'good'}"><span>متأخرة</span><strong>${DM.num(s.overdue)}</strong></div>
        <div class="dm-kpi ${s.pending_assignment ? 'warn' : ''}"><span>بانتظار الإسناد</span><strong>${DM.num(s.pending_assignment)}</strong></div></div>
        <div class="dm-table-wrap"><table class="dm-table"><thead><tr><th>الرقم</th><th>القرار</th><th>المسؤول</th><th>الاستحقاق</th><th>الإنجاز</th><th>الحالة</th><th>سبب التأخر / آخر عائق</th><th class="dm-noprint">إجراء</th></tr></thead><tbody>${r.items.map(i => {
          const x = DM.dueText(i.status, i.due_date);
          return `<tr data-id="${esc(i.id)}"><td class="ref">${esc(i.ref_no)}</td><td><strong>${esc(i.title)}</strong></td><td>${esc(i.owner || '—')}<br><small>${esc(i.unit || '')}</small></td>
            <td><span class="${x.cls === 'late' ? 'dm-late' : ''}">${esc(x.text)}</span>${i.extension_count ? `<br><small>مُدّد ${i.extension_count}×</small>` : ''}</td><td>${DM.bar(i.progress, ['completed', 'closed'].includes(i.status))}</td>
            <td>${DM.badge(i.status)} ${i.is_overdue ? '<span class="dm-badge s-late">متأخر</span>' : ''}</td><td>${esc(i.last_blocker || '—')}</td>
            <td class="dm-noprint"><button class="dm-btn sm ghost dm-dir" data-id="${esc(i.id)}" data-kind="clarification">طلب إيضاح</button> <button class="dm-btn sm ghost dm-dir" data-id="${esc(i.id)}" data-kind="directive">توجيه</button> <button class="dm-btn sm ghost dm-open" data-id="${esc(i.id)}">فتح</button></td></tr>`; }).join('') || '<tr><td colspan="8" class="dm-nodata">لا توجد قرارات سابقة لهذه الجهة</td></tr>'}</tbody></table></div>`;
      box.querySelectorAll('.dm-open').forEach(b => b.addEventListener('click', () => DM.openDetail?.(b.dataset.id)));
      box.querySelectorAll('.dm-dir').forEach(b => b.addEventListener('click', () => DM.directiveDialog?.(b.dataset.id, S.meeting, b.dataset.kind)));
    };
    sel.addEventListener('change', () => run().catch(e => failed('تقرير القرارات السابقة', e)));
    await run();
  });

  // ───────────── التشغيل ─────────────
  DM.boot = async () => {
    DM.ready = DM.init().catch(e => { console.error('dm init', e); return false; });
    DM.ready.then(ok => { if (ok) document.documentElement.dataset.dm = '1'; });
    document.addEventListener('click', e => { const b = e.target.closest('.dm-extract'); if (b) { e.preventDefault(); DM.ready.then(() => DM.extractDialog(b.dataset.id)).catch(err => toast(err.message)); } });
    DM.ensureSections();
    const handlers = {};
    Object.keys(DM.screens).forEach(n => { handlers['dm-' + n] = () => DM.render(n); });
    onOpen(handlers);
    const hash = location.hash.replace('#', '');
    if (handlers[hash]) handlers[hash]();
  };
})();
