(() => {
  // تقارير الإنجاز (عرض/طباعة PDF/Excel/CSV)، شاشة مؤشرات الأداء، وإعدادات الوحدة (الأدوار، مصفوفة الصلاحيات، دورة العمل والتصعيد، الإدارات، التدقيق).
  const DM = window.DM, {esc, toast, empty} = DM.ui;
  const head = (...a) => DM.head(...a);
  const opt = (v, l) => ({value: v, label: l});
  const pct = v => v === null || v === undefined ? '—' : DM.num(v) + '%';

  // ───────────── التقارير ─────────────
  const table = (cols, rows) => `<table class="dm-table rpt"><thead><tr>${cols.map(c => `<th>${esc(c[0])}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${esc(c[1](r) ?? '—')}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="dm-nodata">لا توجد بيانات</td></tr>`}</tbody></table>`;
  const COLS = {
    decisions: [['الرقم', r => r.ref_no], ['الموضوع', r => r.title], ['تاريخ الصدور', r => DM.date(r.decision_date)], ['المسؤول', r => r.owner], ['الإدارة', r => r.unit], ['تاريخ الاستحقاق', r => DM.date(r.due_date)],
      ['الأصلي', r => r.original_due_date && r.original_due_date !== r.due_date ? DM.date(r.original_due_date) : ''], ['الإنجاز', r => (r.progress ?? 0) + '%'], ['الحالة', r => DM.STATUS[r.status]?.[0] || r.status], ['آخر تحديث', r => DM.date(r.last_update_at ? String(r.last_update_at).slice(0, 10) : '')]],
    overdue: [['الرقم', r => r.ref_no], ['الموضوع', r => r.title], ['المسؤول', r => r.owner], ['أيام التأخر', r => r.days_late], ['سبب التأخر / العائق', r => r.reason], ['الإجراء التصحيحي', r => r.corrective], ['الموعد الجديد المقترح', r => r.proposed_due ? DM.date(r.proposed_due) : ''], ['التصعيد', r => r.escalated ? 'أُدرج في التقرير الخاص' : '']],
    completed: [['الرقم', r => r.ref_no], ['الموضوع', r => r.title], ['تاريخ الإنجاز', r => DM.date(r.completed_at ? String(r.completed_at).slice(0, 10) : '')], ['أدلة مقبولة', r => r.evidence_count], ['المتحقق', r => r.verified_by], ['الحالة', r => r.status === 'closed' ? 'مقفل' : 'بانتظار الإقفال'], ['تاريخ الإقفال', r => DM.date(r.closed_at ? String(r.closed_at).slice(0, 10) : '')]],
    attention: [['الرقم', r => r.ref_no], ['الموضوع', r => r.title], ['سبب الحاجة للتوجيه', r => r.reason]]
  };

  function reportHtml(R) {
    const m = R.meta, c = R.summary.cards, r = R.summary.rates;
    const logo = document.querySelector('.brand-box img')?.getAttribute('src') || 'assets/logo.svg';
    const org = document.querySelector('.brand-box small')?.textContent || 'جمعية الإحسان للخدمات الاجتماعية';
    return `<article class="rpt-doc" dir="rtl"><header class="rpt-head"><img src="${esc(logo)}" alt="" /><div><div class="rpt-org">${esc(org)}</div><h1>${esc(R.title)}</h1><div class="rpt-no">رقم الإصدار: <b>${esc(R.report_no)}</b></div></div></header>
      <section><h2>1. البيانات الأساسية</h2><table class="dm-table rpt"><tbody>
        <tr><th>المجلس أو اللجنة</th><td>${esc(m.body_name)}</td><th>الفترة</th><td>${m.from || m.to ? esc((m.from ? 'من ' + DM.date(m.from) : '') + ' ' + (m.to ? 'إلى ' + DM.date(m.to) : '')) : 'كل الفترات'}</td></tr>
        <tr><th>تاريخ الإعداد</th><td>${esc(DM.dateTime(m.generated_at))}</td><th>الجهة المعدّة</th><td>${esc(m.generated_by || '—')}</td></tr></tbody></table></section>
      <section><h2>2. الملخص التنفيذي</h2><div class="rpt-kpis">${[['إجمالي القرارات', c.total], ['المكتملة', c.completed], ['الجاري تنفيذها', c.in_execution], ['المتأخرة', c.overdue], ['بانتظار الإقفال/الاعتماد', (c.pending_verification || 0) + (R.completed.filter(x => x.status === 'completed').length)], ['نسبة الإنجاز', pct(c.overall_progress)], ['الالتزام بالمواعيد', pct(r.ontime_rate)], ['نسبة الإنجاز للمستحق', pct(r.completion_rate)]].map(([k, v]) => `<div><span>${esc(k)}</span><b>${typeof v === 'number' ? DM.num(v) : esc(v)}</b></div>`).join('')}</div></section>
      <section><h2>3. تفاصيل القرارات</h2>${table(COLS.decisions, R.decisions)}</section>
      <section><h2>4. القرارات المتأخرة</h2>${table(COLS.overdue, R.overdue)}</section>
      <section><h2>5. القرارات المنجزة</h2>${table(COLS.completed, R.completed)}</section>
      <section><h2>6. القرارات التي تتطلب توجيهًا</h2>${table(COLS.attention, R.attention)}</section>
      <section><h2>7. التوصيات</h2><ol>${R.recommendations.map(x => `<li>${esc(x)}</li>`).join('')}</ol></section>
      <footer class="rpt-foot"><div class="rpt-sign"><span>أمين السر: ................</span><span>الاعتماد: ................</span></div>
        <small>مصدر البيانات: منصة الاجتماعات — المؤشرات وفق سياسة القياس (${esc(R.policy.measure_against === 'original' ? 'الموعد الأصلي' : 'الموعد المعتمد')}) وتستبعد المسودات والملغاة والتوصيات غير المصدَّق عليها.</small></footer></article>`;
  }

  function csv(rows) {
    const cell = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    return '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n');
  }
  function downloadText(text, name, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], {type})); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
  const sheetRows = (cols, rows) => [cols.map(c => c[0]), ...rows.map(r => cols.map(c => { const v = c[1](r); return typeof v === 'number' ? v : (v ?? ''); }))];
  function exportXlsx(R) {
    const c = R.summary.cards, r = R.summary.rates;
    const sheets = [
      {name: 'الملخص', rows: [['البند', 'القيمة'], ['التقرير', R.title], ['رقم الإصدار', R.report_no], ['الجهة', R.meta.body_name], ['الفترة', (R.meta.from || '') + ' → ' + (R.meta.to || '')], ['تاريخ الإعداد', DM.dateTime(R.meta.generated_at)], ['الجهة المعدّة', R.meta.generated_by || ''],
        ['إجمالي القرارات', c.total], ['المكتملة', c.completed], ['المقفلة', c.closed], ['الجاري تنفيذها', c.in_execution], ['المتأخرة', c.overdue], ['نسبة الإنجاز الإجمالية %', c.overall_progress], ['نسبة الإنجاز للمستحق %', r.completion_rate ?? ''], ['الالتزام بالمواعيد %', r.ontime_rate ?? ''], ['نسبة المتأخرة %', r.overdue_rate ?? ''], ['معدل الإقفال %', r.closure_rate ?? '']], widths: [34, 50]},
      {name: 'القرارات', rows: sheetRows(COLS.decisions, R.decisions), widths: [14, 44, 14, 22, 22, 14, 14, 10, 20, 14]},
      {name: 'المتأخرة', rows: sheetRows(COLS.overdue, R.overdue), widths: [14, 40, 22, 12, 40, 40, 16, 22]},
      {name: 'المنجزة', rows: sheetRows(COLS.completed, R.completed), widths: [14, 40, 14, 12, 22, 16, 14]},
      {name: 'تتطلب توجيهًا', rows: sheetRows(COLS.attention, R.attention), widths: [14, 44, 40]},
      {name: 'التوصيات', rows: [['التوصية'], ...R.recommendations.map(x => [x])], widths: [100]}];
    window.XlsxLite.download(window.XlsxLite.build(sheets), `${R.report_no}.xlsx`);
  }
  function printReport(R) {
    document.getElementById('dmPrintRoot')?.remove();
    const root = document.createElement('div'); root.id = 'dmPrintRoot'; root.innerHTML = reportHtml(R); document.body.append(root);
    document.documentElement.classList.add('dm-printing');
    const done = () => { document.documentElement.classList.remove('dm-printing'); root.remove(); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done); setTimeout(() => window.print(), 50);
  }
  const PRINT_CSS = `
#dmPrintRoot{display:none}
.rpt-doc{font-family:"Segoe UI",Tahoma,Arial,sans-serif;color:#222;background:#fff;padding:18px;line-height:1.7}
.rpt-head{display:flex;gap:16px;align-items:center;border-bottom:3px solid #a8461a;padding-bottom:10px;margin-bottom:12px}.rpt-head img{height:64px}.rpt-head h1{margin:0;font-size:21px;color:#a8461a}.rpt-org{font-weight:700}
.rpt-doc h2{font-size:16px;color:#a8461a;margin:16px 0 6px;break-after:avoid}.rpt-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.rpt-kpis div{border:1px solid #ddd;border-radius:8px;padding:6px 10px}.rpt-kpis span{display:block;font-size:11px;color:#555}.rpt-kpis b{font-size:18px}
.rpt-doc table.rpt{width:100%;border-collapse:collapse;font-size:11px;min-width:0}.rpt-doc table.rpt th,.rpt-doc table.rpt td{border:1px solid #ccc;padding:4px 6px;text-align:right;vertical-align:top}.rpt-doc table.rpt th{background:#f3eee9;position:static}
.rpt-doc tr{break-inside:avoid}.rpt-foot{margin-top:18px;border-top:1px solid #ccc;padding-top:8px}.rpt-sign{display:flex;justify-content:space-between;margin:20px 0}
@media print{
  @page{size:A4;margin:16mm 12mm 18mm;@bottom-center{content:"صفحة " counter(page) " من " counter(pages);font-size:10px;color:#555}}
  html.dm-printing body>*:not(#dmPrintRoot){display:none!important}html.dm-printing #dmPrintRoot{display:block!important}
  html.dm-printing{background:#fff!important}
}`;
  if (!document.getElementById('dm-print-style')) { const s = document.createElement('style'); s.id = 'dm-print-style'; s.textContent = PRINT_CSS; document.head.appendChild(s); }

  DM.register('reports', async (el, preset) => {
    const S = DM.state.rep ||= {committee_id: '', unit_id: '', from: '', to: ''};
    el.innerHTML = head('تقارير الإنجاز', 'تقرير متابعة تنفيذ قرارات مجلس الإدارة واللجان: يُصدَر برقم إصدار ويُحفظ للمراجعة، ويُطبع أو يُصدَّر إلى PDF وExcel') + DM.noRoleBanner() + `
      <form class="dm-filters dm-noprint" id="dmRepF"><label>المجلس أو اللجنة<select name="committee_id">${DM.opts.committee()}</select></label><label>الإدارة<select name="unit_id">${DM.opts.unit()}</select></label>
        <label>من تاريخ القرار<input type="date" name="from"></label><label>إلى<input type="date" name="to"></label><button class="dm-btn primary" type="submit" ${DM.can('export') ? '' : 'disabled title="لا تملك صلاحية التصدير"'}>إصدار التقرير</button></form>
      <div id="dmRepActions" class="dm-acts-row dm-noprint" hidden><button class="dm-btn sm" data-x="print">طباعة / حفظ PDF</button><button class="dm-btn sm" data-x="xlsx">تصدير Excel</button><button class="dm-btn sm ghost" data-x="csv">تصدير CSV</button></div>
      <div id="dmRepDoc"></div><h3 class="dm-noprint">التقارير الصادرة سابقًا</h3><div id="dmRepList" class="dm-list dm-noprint"></div>`;
    DM.bindCommon(el);
    const form = el.querySelector('#dmRepF'); Object.entries(S).forEach(([k, v]) => { form.elements[k].value = v; });
    let current = null;
    const show = R => { current = R; el.querySelector('#dmRepDoc').innerHTML = reportHtml(R); el.querySelector('#dmRepActions').hidden = false; el.querySelector('#dmRepDoc').scrollIntoView?.({block: 'start'}); };
    form.addEventListener('submit', async e => {
      e.preventDefault(); const b = form.querySelector('button'); b.disabled = true;
      try {
        Object.keys(S).forEach(k => { S[k] = form.elements[k].value; });
        const p = Object.fromEntries(Object.entries(S).filter(([, v]) => v));
        show(await DM.rpc('dm_issue_report', {p})); toast('أُصدر التقرير ورقمه ' + current.report_no); loadList();
      } catch (ex) { toast(ex.message); } finally { b.disabled = !DM.can('export'); }
    });
    el.querySelector('#dmRepActions').addEventListener('click', e => {
      const x = e.target.closest('[data-x]')?.dataset.x; if (!x || !current) return;
      if (x === 'print') printReport(current); else if (x === 'xlsx') exportXlsx(current);
      else downloadText(csv(sheetRows(COLS.decisions, current.decisions)), current.report_no + '.csv', 'text/csv;charset=utf-8');
    });
    const loadList = async () => {
      const rows = await DM.sel('dm_reports', q => q.order('generated_at', {ascending: false}).limit(30)).catch(() => []);
      const box = el.querySelector('#dmRepList');
      box.innerHTML = rows.map(r => `<div class="dm-item"><strong>${esc(r.report_no)}</strong> <span class="meta"><span>${esc(DM.dateTime(r.generated_at))}</span><span>${esc(r.data?.meta?.body_name || '')}</span><span>${esc(DM.nameOf.user(r.generated_by))}</span></span> <button class="dm-btn sm ghost" data-id="${esc(r.id)}">فتح</button></div>`).join('') || empty('لا توجد تقارير صادرة');
      box.onclick = ev => { const id = ev.target.closest('[data-id]')?.dataset.id; const r = rows.find(x => x.id === id); if (r) show({...r.data, id: r.id}); };
    };
    await loadList();
  });

  // ───────────── مؤشرات الأداء ─────────────
  DM.register('kpis', async (el) => {
    const S = DM.state.kpi ||= {committee_id: '', unit_id: '', year: ''};
    el.innerHTML = head('مؤشرات الأداء', 'تُحسب مباشرة من بيانات القرارات المصرَّح لك بها، مع بيان البسط والمقام والسياسة المتبعة') + DM.noRoleBanner() + `
      <form class="dm-filters dm-noprint"><label>الجهة<select name="committee_id">${DM.opts.committee()}</select></label><label>الإدارة<select name="unit_id">${DM.opts.unit()}</select></label>
      <label>السنة<input name="year" type="number" min="2020" max="2100" placeholder="كل السنوات"></label></form><div id="dmKpiBody"></div>`;
    DM.bindCommon(el); const form = el.querySelector('form'); Object.entries(S).forEach(([k, v]) => { form.elements[k].value = v; });
    const run = async () => {
      Object.keys(S).forEach(k => { S[k] = form.elements[k].value; });
      const K = await DM.rpc('dm_kpis', {p: Object.fromEntries(Object.entries(S).filter(([, v]) => v))});
      const r = K.rates, d = r.denominators, n = r.numerators, orig = K.policy.measure_against === 'original';
      const row = (name, formula, value, num, den, note = '') => `<tr><td><strong>${esc(name)}</strong></td><td>${esc(formula)}</td><td><b>${value}</b></td><td>${num === null ? '—' : `${DM.num(num)} من ${DM.num(den)}`}</td><td>${esc(note)}</td></tr>`;
      el.querySelector('#dmKpiBody').innerHTML = `<div class="dm-table-wrap"><table class="dm-table"><thead><tr><th>المؤشر</th><th>طريقة الاحتساب</th><th>القيمة</th><th>البسط من المقام</th><th>ملاحظة</th></tr></thead><tbody>
        ${row('نسبة إنجاز القرارات', 'المكتملة والمعتمدة ÷ المستحقة (بلغ موعدها) × 100', pct(r.completion_rate), n.due_done, d.due, 'تستبعد المسودات والملغاة وغير المستحقة')}
        ${row('نسبة الالتزام بالمواعيد', `المنجزة ضمن ${orig ? 'الموعد الأصلي' : 'الموعد المعتمد'} ÷ المنجزة والمتأخرة المفتوحة × 100`, pct(orig ? r.ontime_rate_original : r.ontime_rate), orig ? n.ontime_original : n.ontime, orig ? d.evaluated_original : d.evaluated, orig ? 'تُقاس بالموعد الأصلي فتحتسب التمديدات تأخرًا' : 'التمديد المعتمد يغيّر الموعد المعتمد')}
        ${row('نسبة الالتزام (بالموعد المقابل)', `بالموعد ${orig ? 'المعتمد' : 'الأصلي'} للمقارنة`, pct(orig ? r.ontime_rate : r.ontime_rate_original), orig ? n.ontime : n.ontime_original, orig ? d.evaluated : d.evaluated_original, 'الفرق بين القيمتين يكشف أثر التمديدات')}
        ${row('نسبة القرارات المتأخرة', 'المفتوحة المتجاوزة للموعد ÷ المفتوحة المستحقة × 100', pct(r.overdue_rate), n.overdue, d.open_due)}
        ${row('معدل الإقفال', 'المقفلة ÷ المؤهلة للإقفال (مكتملة + مقفلة) × 100', pct(r.closure_rate), n.closed, d.completed)}
        ${row('متوسط مدة التنفيذ', 'من بدء التنفيذ إلى الإنجاز ÷ عدد المنجزة', r.avg_exec_days === null ? '—' : DM.num(r.avg_exec_days) + ' يوم', null, null)}
        ${row('متوسط مدة الإقفال', 'من الإسناد إلى الإقفال ÷ عدد المقفلة', r.avg_close_days === null ? '—' : DM.num(r.avg_close_days) + ' يوم', null, null)}
        ${row('نسبة الإنجاز الإجمالية', 'متوسط الإنجاز المبلَّغ عنه (المنجزة = 100%)', pct(K.cards.overall_progress), null, null)}</tbody></table></div>
        <section class="dm-card" style="margin-top:14px"><h3>سياسة الاحتساب</h3><ul><li>تُستبعد: المسودات، وبانتظار الاعتماد، والملغاة، والتوصيات غير المصدَّق عليها.</li><li>القرار «مستحق» إذا بلغ تاريخ استحقاقه.</li><li>يُقاس الالتزام بالموعد <b>${orig ? 'الأصلي' : 'المعتمد الحالي'}</b> (يُغيَّر من الإعدادات)، ويُعرض الآخر للمقارنة.</li><li>«المتأخر» حالة زمنية تُحسب من الموعد ولا تغيّر الحالة الإجرائية.</li></ul></section>`;
    };
    form.addEventListener('change', () => run().catch(e => toast(e.message))); await run();
  });

  // ───────────── الإعدادات والصلاحيات ─────────────
  DM.register('settings', async (el) => {
    const canRoles = DM.can('manage_roles'), canSet = DM.can('manage_settings'), canAudit = DM.can('audit_read');
    el.innerHTML = head('الإعدادات والصلاحيات', 'الأدوار ومصفوفة الصلاحيات ودورة العمل والتصعيد والإدارات وسجل التدقيق') + (canRoles || canSet || canAudit ? '' : '<div class="dm-banner">لا تملك صلاحية إدارة هذه الشاشة. تُمنح للمدير ومسؤول الحوكمة والمراجع.</div>') + `
      <div class="dm-tabs" role="tablist" id="dmSetTabs">${[['roles', 'الأدوار'], ['matrix', 'مصفوفة الصلاحيات'], ['flow', 'دورة العمل والتصعيد'], ['units', 'الإدارات'], ['audit', 'سجل التدقيق']].map(([k, l], i) => `<button type="button" role="tab" data-t="${k}" aria-selected="${i === 0}">${l}</button>`).join('')}</div><div id="dmSetBody"></div>`;
    DM.bindCommon(el);
    const body = el.querySelector('#dmSetBody');
    const T = {
      async roles() {
        const rows = await DM.sel('dm_user_roles', q => q.order('granted_at', {ascending: false}));
        body.innerHTML = `${canRoles ? '<p class="dm-noprint"><button class="dm-btn primary sm" id="dmGrant">＋ منح دور</button></p>' : ''}<div class="dm-table-wrap"><table class="dm-table"><thead><tr><th>المستخدم</th><th>الدور</th><th>النطاق</th><th>الحالة</th><th>منح بواسطة</th><th></th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(DM.nameOf.user(r.user_id))}</td><td>${esc(DM.ROLES[r.role] || r.role)}</td><td>${esc(r.committee_id ? DM.nameOf.committee(r.committee_id) : 'كل الجهات')}</td><td>${r.is_active ? 'فعّال' : 'موقوف'}</td><td>${esc(DM.nameOf.user(r.granted_by))}</td><td>${canRoles && r.is_active ? `<button class="dm-btn sm ghost" data-revoke="${esc(r.id)}">سحب</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="dm-nodata">لا توجد أدوار ممنوحة</td></tr>'}</tbody></table></div>
          <p class="dm-sub">مدير النظام دور تقني: لا يرى القرارات ولا يعتمدها. للمراجع الداخلي والحوكمة صلاحيات قراءة مستقلة. أي منح يُسجَّل ويصل إشعار لمسؤولي الحوكمة.</p>`;
        body.querySelector('#dmGrant')?.addEventListener('click', () => DM.form({title: 'منح دور', fields: [
          {name: 'user', label: 'المستخدم', type: 'select', required: true, options: [opt('', 'اختر…'), ...DM.refs.profiles.map(p => opt(p.id, p.full_name || 'مستخدم'))]},
          {name: 'role', label: 'الدور', type: 'select', required: true, options: Object.entries(DM.ROLES).map(([k, v]) => opt(k, v)), value: 'secretary'},
          {name: 'committee', label: 'النطاق (اختياري: جهة محددة)', type: 'select', options: [opt('', 'كل الجهات'), ...DM.refs.committees.map(c => opt(c.id, c.name))]}],
          onSubmit: async v => { await DM.rpc('dm_grant_role', {p_user: v.user, p_role: v.role, p_committee: v.committee || null}); toast('مُنح الدور'); T.roles(); }}));
        body.querySelectorAll('[data-revoke]').forEach(b => b.addEventListener('click', async () => { const r = await DM.confirm({title: 'سحب الدور', message: 'سيفقد المستخدم الصلاحيات المرتبطة بهذا الدور فورًا.', danger: true, confirmLabel: 'سحب'}); if (r.ok) { try { await DM.rpc('dm_revoke_role', {p_role_id: b.dataset.revoke}); toast('سُحب الدور'); T.roles(); } catch (e) { toast(e.message); } } }));
      },
      async matrix() {
        const perms = await DM.sel('dm_role_permissions'); const set = new Set(perms.map(p => p.role + '|' + p.permission)); const roles = Object.keys(DM.ROLES), keys = Object.keys(DM.PERMS);
        const locked = (role, perm) => role === 'admin' && ['approve', 'ratify', 'close', 'verify', 'review_evidence', 'cancel', 'amend', 'assign', 'reassign', 'approve_extension', 'approve_extension_limited', 'view_scope'].includes(perm);
        body.innerHTML = `<p class="dm-sub">الصلاحية المحدَّدة تُمنح لحاملي الدور ضمن نطاقهم. صلاحيات صاحب التنفيذ على قراره (تحديث، أدلة، طلب اعتماد وتمديد) تُمنح بالإسناد لا بالدور. المتحقق والمقفِل لا يكون هو المسؤول عن القرار (فصل المهام). الخلايا المقفلة لا تُمنح لمدير النظام.</p>
          <div class="dm-table-wrap"><table class="dm-table"><thead><tr><th>الصلاحية</th>${roles.map(r => `<th>${esc(DM.ROLES[r])}</th>`).join('')}</tr></thead><tbody>${keys.map(k => `<tr><td>${esc(DM.PERMS[k])}</td>${roles.map(r => `<td><input type="checkbox" data-r="${r}" data-p="${k}" ${set.has(r + '|' + k) ? 'checked' : ''} ${canSet && !locked(r, k) ? '' : 'disabled'} aria-label="${esc(DM.ROLES[r] + ' — ' + DM.PERMS[k])}"></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
        body.querySelectorAll('input[data-r]').forEach(c => c.addEventListener('change', async () => {
          try { await DM.rpc('dm_set_permission', {p_role: c.dataset.r, p_perm: c.dataset.p, p_allow: c.checked}); toast('حُدّثت المصفوفة'); } catch (e) { c.checked = !c.checked; toast(e.message); }
        }));
      },
      async flow() {
        const rows = await DM.sel('dm_settings'); const g = k => rows.find(r => r.key === k)?.value; const esco = g('escalation') || [];
        body.innerHTML = `<form id="dmFlow" class="dm-form" style="max-width:680px;background:transparent"><p class="dm-sub">مدد التنبيه والتصعيد قابلة للتعديل. تعمل جدولة التنبيهات يوميًا الساعة 6 صباحًا بتوقيت الرياض عند تفعيل pg_cron.</p>
          <label class="dm-field"><span class="dm-lab">أيام التذكير قبل الاستحقاق (0 = يوم الاستحقاق)</span><input name="reminder_days" value="${esc((g('reminder_days') || []).join(', '))}"></label>
          <label class="dm-field"><span class="dm-lab">أيام تنبيه التأخر بعد الموعد</span><input name="late_alert_days" value="${esc((g('late_alert_days') || []).join(', '))}"></label>
          <label class="dm-field"><span class="dm-lab">التصعيد الأول: بعد (أيام) → رئيس الإدارة وأمين السر</span><input name="esc1" type="number" min="1" value="${esc(esco.find(x => x.level === 'unit_head')?.days ?? 7)}"></label>
          <label class="dm-field"><span class="dm-lab">التصعيد الثاني: بعد (أيام) → الجهة الأعلى والرئيس والحوكمة</span><input name="esc2" type="number" min="1" value="${esc(esco.find(x => x.level === 'upper')?.days ?? 14)}"></label>
          <label class="dm-field"><span class="dm-lab">الإدراج في تقرير التأخر الخاص بعد (أيام)</span><input name="report_escalation_days" type="number" min="1" value="${esc(g('report_escalation_days') ?? 21)}"></label>
          <label class="dm-field"><span class="dm-lab">اعتبار القرار «بانتظار تحديث» بعد (أيام بلا تحديث)</span><input name="stale_days" type="number" min="1" value="${esc(g('stale_days') ?? 14)}"></label>
          <label class="dm-field"><span class="dm-lab">حد تمديد أمين السر (أيام)</span><input name="secretary_ext_days" type="number" min="1" value="${esc(g('secretary_ext_days') ?? 14)}"></label>
          <label class="dm-field"><span class="dm-lab">قياس الالتزام بالمواعيد</span><select name="measure_against"><option value="current">بالموعد المعتمد (بعد التمديد)</option><option value="original">بالموعد الأصلي</option></select></label>
          ${[['require_evidence', 'اشتراط دليل إنجاز قبل طلب الاعتماد'], ['require_approved_minute', 'اشتراط اعتماد المحضر قبل اعتماد القرار'], ['require_minute_link', 'اشتراط ربط القرار بمحضر'], ['email_notifications', 'إرسال إشعارات القرارات بالبريد']].map(([k, l]) => `<label class="dm-field dm-check"><input type="checkbox" name="${k}" ${g(k) ? 'checked' : ''}><span class="dm-lab">${l}</span></label>`).join('')}
          <p class="dm-err" role="alert"></p><div class="dm-acts"><button class="dm-btn primary" type="submit" ${canSet ? '' : 'disabled'}>حفظ الإعدادات</button><button class="dm-btn ghost" type="button" id="dmRunAlerts" ${canSet || canAudit ? '' : 'disabled'}>تشغيل التنبيهات الآن</button></div></form>`;
        const f = body.querySelector('#dmFlow'); f.elements.measure_against.value = g('measure_against') || 'current';
        const nums = s => s.split(/[,،\s]+/).filter(Boolean).map(Number);
        f.addEventListener('submit', async e => {
          e.preventDefault(); const err = f.querySelector('.dm-err'); err.textContent = '';
          try {
            const v = f.elements; const rd = nums(v.reminder_days.value), ld = nums(v.late_alert_days.value);
            if ([...rd, ...ld].some(x => !Number.isFinite(x) || x < 0 || x > 90)) throw new Error('الأيام أرقام بين 0 و90');
            const s = (k, val) => DM.rpc('dm_set_setting', {p_key: k, p_value: val});
            await s('reminder_days', rd); await s('late_alert_days', ld);
            await s('escalation', [{days: Number(v.esc1.value), level: 'unit_head'}, {days: Number(v.esc2.value), level: 'upper'}]);
            for (const k of ['report_escalation_days', 'stale_days', 'secretary_ext_days']) await s(k, Number(v[k].value));
            await s('measure_against', v.measure_against.value);
            for (const k of ['require_evidence', 'require_approved_minute', 'require_minute_link', 'email_notifications']) await s(k, v[k].checked);
            toast('حُفظت الإعدادات');
          } catch (ex) { err.textContent = ex.message; }
        });
        body.querySelector('#dmRunAlerts').addEventListener('click', async () => { try { const n = await DM.rpc('dm_run_alerts_manual'); toast(`شُغّلت التنبيهات: ${n} إجراء`); } catch (e) { toast(e.message); } });
      },
      async units() {
        const [units, mem] = await Promise.all([DM.sel('org_units', q => q.order('name')), DM.sel('org_unit_members')]); await DM.loadRefs(true);
        body.innerHTML = `${canSet ? '<p><button class="dm-btn primary sm" id="dmUnitNew">＋ إدارة جديدة</button></p>' : ''}<div class="dm-table-wrap"><table class="dm-table"><thead><tr><th>الإدارة</th><th>تتبع</th><th>الرئيس</th><th>الأعضاء</th><th>الحالة</th><th></th></tr></thead><tbody>${units.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.parent_id ? DM.nameOf.unit(u.parent_id) : '—')}</td><td>${esc(u.head_user_id ? DM.nameOf.user(u.head_user_id) : '—')}</td><td>${mem.filter(m => m.unit_id === u.id).length}</td><td>${u.is_active ? 'فعّالة' : 'موقوفة'}</td><td>${canSet ? `<button class="dm-btn sm ghost" data-edit="${esc(u.id)}">تعديل</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="dm-nodata">لا توجد إدارات؛ أضف الإدارات قبل الإسناد.</td></tr>'}</tbody></table></div>`;
        const dlg = (u) => DM.form({title: u ? 'تعديل إدارة' : 'إدارة جديدة', fields: [
          {name: 'name', label: 'اسم الإدارة', type: 'text', required: true, maxlength: 120, value: u?.name || ''},
          {name: 'parent', label: 'تتبع (الجهة الأعلى)', type: 'select', options: [opt('', 'بدون'), ...units.filter(x => x.id !== u?.id).map(x => opt(x.id, x.name))], value: u?.parent_id || ''},
          {name: 'head', label: 'رئيس الإدارة', type: 'select', options: [opt('', 'بدون'), ...DM.refs.profiles.map(p => opt(p.id, p.full_name || 'مستخدم'))], value: u?.head_user_id || ''},
          {name: 'active', label: 'فعّالة', type: 'checkbox', value: u ? u.is_active : true},
          {name: 'members', label: 'أعضاء الإدارة', type: 'multi', options: DM.refs.profiles.map(p => opt(p.id, p.full_name || 'مستخدم')), value: u ? mem.filter(m => m.unit_id === u.id).map(m => m.user_id) : []}],
          onSubmit: async v => {
            const row = {name: v.name, parent_id: v.parent || null, head_user_id: v.head || null, is_active: v.active};
            const res = u ? await DM.db.from('org_units').update(row).eq('id', u.id).select('id').single() : await DM.db.from('org_units').insert(row).select('id').single();
            if (res.error) throw new Error(res.error.message);
            const id = res.data.id; const cur = u ? mem.filter(m => m.unit_id === id).map(m => m.user_id) : [];
            const add = v.members.filter(x => !cur.includes(x)), del = cur.filter(x => !v.members.includes(x));
            if (add.length) { const r = await DM.db.from('org_unit_members').insert(add.map(x => ({unit_id: id, user_id: x}))); if (r.error) throw new Error(r.error.message); }
            for (const x of del) { const r = await DM.db.from('org_unit_members').delete().eq('unit_id', id).eq('user_id', x); if (r.error) throw new Error(r.error.message); }
            toast('حُفظت الإدارة'); T.units();
          }});
        body.querySelector('#dmUnitNew')?.addEventListener('click', () => dlg(null));
        body.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => dlg(units.find(x => x.id === b.dataset.edit))));
      },
      async audit() {
        if (!canAudit) { body.innerHTML = '<div class="dm-banner">سجل التدقيق لمن يملك صلاحية القراءة (الحوكمة والمراجع الداخلي).</div>'; return; }
        const [ev, decs] = await Promise.all([DM.sel('decision_events', q => q.order('id', {ascending: false}).limit(200)), DM.loadDecisions()]);
        const ref = id => decs.find(d => d.id === id)?.ref_no || '';
        body.innerHTML = `<div class="dm-table-wrap"><table class="dm-table"><thead><tr><th>الوقت</th><th>القرار</th><th>الحدث</th><th>الحالة</th><th>المنفِّذ</th><th>التفاصيل</th></tr></thead><tbody>${ev.map(e => `<tr><td>${esc(DM.dateTime(e.created_at))}</td><td class="ref">${esc(ref(e.decision_id))}</td><td>${esc(DM.EVENT[e.event_type] || e.event_type)}</td><td>${esc(e.to_status ? (DM.STATUS[e.to_status]?.[0] || e.to_status) : '')}</td><td>${esc(e.actor_id ? DM.nameOf.user(e.actor_id) : 'النظام')}</td><td>${esc(JSON.stringify(e.payload || {}).slice(0, 160))}</td></tr>`).join('')}</tbody></table></div>`;
      }
    };
    const tabs = el.querySelector('#dmSetTabs');
    const go = async k => { tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.t === k))); body.innerHTML = '<div class="dm-nodata">جارٍ التحميل…</div>'; try { await T[k](); } catch (e) { body.innerHTML = `<div class="dm-banner" role="alert">${esc(e.message)}</div>`; } };
    tabs.addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (b) go(b.dataset.t); });
    await go('roles');
  });

  DM.boot();
})();
