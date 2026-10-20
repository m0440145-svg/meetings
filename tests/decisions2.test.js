// اختبارات التنبيهات والتصعيد والمؤشرات والتقارير وتقرير الاجتماع السابق (تعتمد على decisions.test.js). بيانات تجريبية موسومة.
//   await resetDb(); const r = await runDecisionTests2();
(() => {
  const {U, as, su, ok, fails, eq, fixtures, results} = window.DMT;
  const BOARD = '11111111-1111-4111-8111-111111111111', MEET = '33333333-3333-4333-8333-333333333333', MIN = '44444444-4444-4444-8444-444444444444';
  const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  let seq = 0;
  async function ins(o) {
    const r = {ref_no: 'T-' + (++seq).toString().padStart(3, '0'), title: 'قرار اختبار ' + seq, body_text: 'نص قرار اختبار', committee_id: BOARD, body_kind: 'board', record_type: 'decision', priority: 'medium', progress_pct: 0, ...o};
    const cols = Object.keys(r);
    const res = await su(`insert into public.decisions(${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')}) returning id`, cols.map(c => r[c]));
    return res[0].id;
  }
  const notif = async (uid, like) => (await su('select count(*)::int as n from public.notifications where user_id=$1 and title like $2', [uid, like]))[0].n;
  const alerts = async (id, kind) => (await su('select count(*)::int as n from public.decision_alerts where decision_id=$1 and kind=$2', [id, kind]))[0].n;

  async function inner() {
    results.length = 0;
    await fixtures();
    await as(U.admin, "select public.dm_grant_role($1,'secretary',$2)", [U.sec, BOARD]);
    await as(U.admin, "select public.dm_grant_role($1,'chair',$2)", [U.chair, BOARD]);
    await as(U.admin, "select public.dm_grant_role($1,'governance',null)", [U.gov]);
    const parent = (await as(U.admin, "insert into public.org_units(name, head_user_id) values ('الإدارة العليا (اختبار)', $1) returning id", [U.out]))[0].id;
    const unit = (await as(U.admin, "insert into public.org_units(name, parent_id, head_user_id) values ('الإدارة القانونية (اختبار)', $1, $2) returning id", [parent, U.unitHead]))[0].id;

    // ───── التنبيهات والتصعيد (سيناريو التأخير) ─────
    let D3;
    await ok('قرار مسند بموعد بعد 7 أيام', async () => {
      const r = await as(U.sec, 'select public.dm_create_decision($1::jsonb) as id', [JSON.stringify({committee_id: BOARD, body_kind: 'board', meeting_id: MEET, minute_id: MIN, title: 'قرار التنبيهات', body_text: 'نص القرار'})]);
      D3 = r[0].id; await as(U.sec, 'select public.dm_submit($1)', [D3]); await as(U.chair, 'select public.dm_approve($1)', [D3]);
      await as(U.sec, 'select public.dm_assign($1,$2,$3,$4::date,$5,$6,$7::uuid[])', [D3, unit, U.exec, day(7), 'مخرج', '', []]);
      await as(U.exec, "select public.dm_post_update($1,'progress',30,'بدأ التنفيذ',null)", [D3]); return 'ok';
    });
    await ok('تذكير أول قبل 7 أيام مرة واحدة فقط', async () => {
      await su('select public.dm_run_alerts()'); eq(await alerts(D3, 'reminder_7'), 1, 'التنبيه'); eq(await notif(U.exec, 'تذكير بموعد%'), 1, 'الإشعار');
      const n2 = (await su('select public.dm_run_alerts() as n'))[0].n; eq(n2, 0, 'التكرار'); return 'بلا تكرار';
    });
    await su('update public.decisions set due_date = current_date + 3 where id=$1', [D3]);
    await ok('تذكير ثانٍ قبل 3 أيام', async () => { await su('select public.dm_run_alerts()'); eq(await alerts(D3, 'reminder_3'), 1, 'التنبيه'); return 'ok'; });
    await su('update public.decisions set due_date = current_date where id=$1', [D3]);
    await ok('إشعار يوم الاستحقاق', async () => { await su('select public.dm_run_alerts()'); eq(await alerts(D3, 'reminder_0'), 1, 'التنبيه'); eq(await notif(U.exec, 'اليوم موعد%'), 1, 'الإشعار'); return 'ok'; });
    await su('update public.decisions set due_date = current_date - 1 where id=$1', [D3]);
    await ok('تنبيه التأخر بعد يوم للمسؤول وأمين السر', async () => { await su('select public.dm_run_alerts()'); eq(await alerts(D3, 'late_1'), 1, 'late_1'); eq(await notif(U.sec, 'تأخر تنفيذ%'), 1, 'أمين السر'); eq(await notif(U.exec, 'تأخر تنفيذ%'), 1, 'المسؤول'); return 'ok'; });
    await su('update public.decisions set due_date = current_date - 7 where id=$1', [D3]);
    await ok('تصعيد بعد 7 أيام لرئيس الإدارة وأمين السر', async () => { await su('select public.dm_run_alerts()'); eq(await alerts(D3, 'esc_7'), 1, 'esc_7'); eq(await notif(U.unitHead, 'تصعيد%'), 1, 'رئيس الإدارة'); return 'ok'; });
    await su('update public.decisions set due_date = current_date - 14 where id=$1', [D3]);
    await ok('تصعيد بعد 14 يومًا للجهة الأعلى والرئيس والحوكمة', async () => {
      await su('select public.dm_run_alerts()'); eq(await alerts(D3, 'esc_14'), 1, 'esc_14');
      eq(await notif(U.out, 'تصعيد%'), 1, 'رئيس الإدارة العليا'); eq(await notif(U.chair, 'تصعيد%'), 1, 'رئيس المجلس'); eq(await notif(U.gov, 'تصعيد%'), 1, 'الحوكمة'); return 'ok';
    });
    await su('update public.decisions set due_date = current_date - 21 where id=$1', [D3]);
    await ok('استمرار التأخر يُدرج القرار في التقرير الخاص', async () => {
      await su('select public.dm_run_alerts()'); eq((await su('select escalated_to_report as f from public.decisions where id=$1', [D3]))[0].f, true, 'العلم'); eq(await alerts(D3, 'report'), 1, 'report'); return 'ok';
    });
    await ok('مدد التصعيد قابلة للتعديل من الإعدادات (مع التحقق)', async () => {
      await as(U.admin, "select public.dm_set_setting('reminder_days', '[10, 2, 0]'::jsonb)");
      try { await as(U.admin, "select public.dm_set_setting('reminder_days', '[\"x\"]'::jsonb)"); throw new Error('قُبلت قيمة خاطئة'); } catch (e) { if (e.message === 'قُبلت قيمة خاطئة') throw e; }
      try { await as(U.sec, "select public.dm_set_setting('stale_days', '5'::jsonb)"); throw new Error('عُدِّل بلا صلاحية'); } catch (e) { if (e.message === 'عُدِّل بلا صلاحية') throw e; }
      await as(U.admin, "select public.dm_set_setting('reminder_days', '[7, 3, 0]'::jsonb)"); return 'ok';
    });
    let D4;
    await ok('جارٍ التنفيذ دون تحديث يتحول آليًا إلى بانتظار تحديث', async () => {
      D4 = await ins({status: 'executing', owner_id: U.exec, responsible_unit_id: unit, due_date: day(40), assigned_at: new Date().toISOString(), last_update_at: new Date(Date.now() - 20 * 864e5).toISOString()});
      await su('select public.dm_run_alerts()'); return eq((await su('select status from public.decisions where id=$1', [D4]))[0].status, 'awaiting_update', 'الحالة');
    });
    await ok('تحديث جديد يعيده إلى جارٍ التنفيذ', async () => {
      await as(U.exec, "select public.dm_post_update($1,'progress',45,'استُؤنف',null)", [D4]); return eq((await su('select status from public.decisions where id=$1', [D4]))[0].status, 'executing', 'الحالة');
    });
    await ok('سجل الأحداث يتضمن التنبيهات والتصعيد', async () => {
      const t = (await su("select distinct event_type from public.decision_events where decision_id=$1", [D3])).map(r => r.event_type);
      for (const k of ['alert', 'escalation']) if (!t.includes(k)) throw new Error('ينقص ' + k); return t.join(',');
    });

    // ───── المؤشرات على بيانات معروفة ─────
    // (سجل الأحداث لا يُحذف: مُغطّى باختبار decisions.test.js)
  }

  async function kpiPart() {
    // قاعدة جديدة نظيفة لأرقام قابلة للتحقق اليدوي
    await window.resetDb(); results.length = 0; seq = 0;
    await fixtures();
    await as(U.admin, "select public.dm_grant_role($1,'secretary',$2)", [U.sec, BOARD]);
    await as(U.admin, "select public.dm_grant_role($1,'chair',$2)", [U.chair, BOARD]);
    await as(U.admin, "select public.dm_grant_role($1,'governance',null)", [U.gov]);
    const unit = (await as(U.admin, "insert into public.org_units(name, head_user_id) values ('الإدارة القانونية (اختبار)', $1) returning id", [U.unitHead]))[0].id;
    const unit2 = (await as(U.admin, "insert into public.org_units(name) values ('إدارة الموارد (اختبار)') returning id"))[0].id;
    const T = (s) => s + 'T08:00:00Z';
    const a = await ins({status: 'closed', priority: 'high', owner_id: U.exec2, responsible_unit_id: unit, decision_date: '2026-01-02', assigned_at: T('2026-01-01'), started_at: T('2026-01-05'), due_date: '2026-01-31', original_due_date: '2026-01-31', completed_at: T('2026-01-20'), closed_at: T('2026-02-01'), progress_pct: 100});
    const b = await ins({status: 'completed', owner_id: U.exec2, responsible_unit_id: unit, decision_date: '2026-02-02', assigned_at: T('2026-02-01'), started_at: T('2026-02-01'), due_date: '2026-03-10', original_due_date: '2026-02-15', completed_at: T('2026-03-05'), progress_pct: 100});
    const c = await ins({status: 'executing', priority: 'high', owner_id: U.exec, responsible_unit_id: unit2, decision_date: '2026-05-01', assigned_at: T('2026-05-02'), due_date: day(-10), original_due_date: day(-10), progress_pct: 40});
    const d = await ins({status: 'assigned', owner_id: U.exec2, responsible_unit_id: unit2, decision_date: '2026-09-01', assigned_at: T('2026-09-02'), due_date: day(20), original_due_date: day(20), progress_pct: 0});
    const e = await ins({status: 'pending_verification', priority: 'critical', owner_id: U.exec2, responsible_unit_id: unit, decision_date: '2026-09-01', assigned_at: T('2026-09-02'), due_date: day(-2), original_due_date: day(-2), progress_pct: 100});
    await ins({status: 'cancelled', owner_id: U.exec2, decision_date: '2026-03-01'});
    await ins({status: 'draft', decision_date: '2026-03-01'});
    await ins({status: 'approved', record_type: 'recommendation', decision_date: '2026-03-01'});
    const i = await ins({status: 'completed', owner_id: U.exec2, responsible_unit_id: unit, decision_date: '2026-03-01', assigned_at: T('2026-03-02'), started_at: T('2026-03-01'), due_date: '2026-03-31', original_due_date: '2026-03-31', completed_at: T('2026-03-20'), progress_pct: 100});
    const pend = await ins({status: 'pending_approval', decision_date: '2026-03-01', title: 'قرار بانتظار الاعتماد'});

    let K;
    await ok('المؤشرات: البطاقات (6 قرارات مؤهلة، 3 مكتملة، 1 مقفل، 2 متأخرة)', async () => {
      K = (await as(U.gov, "select public.dm_kpis('{}'::jsonb) as k"))[0].k; const c0 = K.cards;
      eq(c0.total, 6, 'الإجمالي'); eq(c0.completed, 3, 'المكتملة'); eq(c0.closed, 1, 'المقفلة'); eq(c0.overdue, 2, 'المتأخرة'); eq(c0.in_execution, 3, 'قيد التنفيذ');
      eq(c0.pending_verification, 1, 'بانتظار التحقق'); eq(c0.high_priority_open, 2, 'عالية الأولوية'); eq(c0.overall_progress, 73, 'نسبة الإنجاز الإجمالية'); return JSON.stringify(c0);
    });
    await ok('المؤشرات: النسب (إنجاز 60%، التزام 60% بالحالي و40% بالأصلي، تأخر 100%، إقفال 33.3%)', async () => {
      const r = K.rates; eq(r.completion_rate, 60, 'نسبة الإنجاز'); eq(r.ontime_rate, 60, 'الالتزام (الموعد الحالي)'); eq(r.ontime_rate_original, 40, 'الالتزام (الأصلي)');
      eq(r.overdue_rate, 100, 'نسبة المتأخرة'); eq(r.closure_rate, 33.3, 'معدل الإقفال'); eq(r.avg_exec_days, 22, 'متوسط التنفيذ'); eq(r.avg_close_days, 31, 'متوسط الإقفال'); return JSON.stringify(r);
    });
    await ok('المؤشرات: التوزيعات والرسوم', async () => {
      eq(K.by_status.closed, 1, 'closed'); eq(K.by_status.completed, 2, 'completed'); eq(K.by_priority.high, 2, 'high'); eq(K.by_committee[0].total, 6, 'اللجنة');
      const legal = K.by_unit.find(u => u.name.includes('القانونية')); eq(legal.total, 4, 'القانونية'); eq(legal.completed, 3, 'القانونية المنجزة'); eq(K.monthly.length, 12, 'الأشهر');
      return 'ok';
    });
    await ok('المرشحات: إدارة محددة', async () => { const k = (await as(U.gov, "select public.dm_kpis($1::jsonb) as k", [JSON.stringify({unit_id: unit2})]))[0].k; eq(k.cards.total, 2, 'إدارة الموارد'); return 'ok'; });
    await ok('المرشحات: الأولوية والفترة', async () => {
      eq((await as(U.gov, "select public.dm_kpis($1::jsonb) as k", [JSON.stringify({priority: 'critical'})]))[0].k.cards.total, 1, 'حرجة');
      eq((await as(U.gov, "select public.dm_kpis($1::jsonb) as k", [JSON.stringify({from: '2026-03-01', to: '2026-03-31'})]))[0].k.cards.total, 1, 'مارس'); return 'ok';
    });
    await ok('المؤشرات تحترم الصلاحيات: الخارجي صفر، المسؤول يرى قراره فقط', async () => {
      eq((await as(U.out, "select public.dm_kpis('{}'::jsonb) as k"))[0].k.cards.total, 0, 'الخارجي');
      eq((await as(U.exec, "select public.dm_kpis('{}'::jsonb) as k"))[0].k.cards.total, 1, 'المسؤول'); return 'ok';
    });
    await ok('سياسة القياس بالموعد الأصلي قابلة للتبديل', async () => {
      await as(U.admin, "select public.dm_set_setting('measure_against', '\"original\"'::jsonb)");
      const k = (await as(U.gov, "select public.dm_kpis('{}'::jsonb) as k"))[0].k; eq(k.rates.ontime_rate, 40, 'بالأصلي'); eq(k.policy.measure_against, 'original', 'السياسة');
      await as(U.admin, "select public.dm_set_setting('measure_against', '\"current\"'::jsonb)"); return 'ok';
    });

    // ───── تفاصيل القرار وما يحق للمستخدم ─────
    await ok('صلاحيات الأزرار في تفاصيل القرار', async () => {
      const dc = (await as(U.chair, 'select public.dm_decision_detail($1) as d', [pend]))[0].d, ds = (await as(U.sec, 'select public.dm_decision_detail($1) as d', [pend]))[0].d;
      eq(dc.can.approve, true, 'الرئيس يعتمد'); eq(ds.can.approve, false, 'أمين السر لا يعتمد'); eq(ds.can.submit, false, 'ليست مسودة');
      eq((await as(U.out, 'select public.dm_decision_detail($1) as d', [pend]))[0].d, null, 'الخارجي لا يرى');
      const de = (await as(U.exec, 'select public.dm_decision_detail($1) as d', [c]))[0].d; eq(de.can.update, true, 'المسؤول يحدّث'); eq(de.can.verify, false, 'لا يتحقق'); eq(de.decision.is_overdue, true, 'متأخر'); eq(de.decision.days_late, 10, 'أيام التأخر');
      return 'ok';
    });

    // ───── متابعة قرارات الاجتماعات السابقة ─────
    const M2 = '66666666-6666-4666-8666-666666666666';
    await su("insert into public.meetings(id, title, committee_id, gregorian_date, created_by) values ($1, 'الاجتماع القادم (اختبار)', $2, current_date + 30, $3)", [M2, BOARD, U.sec]);
    await ok('تقرير القرارات السابقة للاجتماع القادم', async () => {
      const r = (await as(U.gov, 'select public.dm_previous_report($1) as r', [M2]))[0].r;
      eq(r.items.length, 5, 'العناصر (المقفل القديم مستبعد)'); eq(r.summary.overdue, 2, 'المتأخرة'); eq(r.summary.in_progress, 3, 'الجارية');
      const late = r.items.find(x => x.is_overdue && x.progress === 40); eq(late.days_late, 10, 'أيام التأخر'); return r.items.length + ' عناصر';
    });
    await ok('إضافة بند المتابعة لجدول الأعمال مرة واحدة', async () => {
      eq((await as(U.sec, 'select public.dm_add_followup_agenda($1) as r', [M2]))[0].r, true, 'أول مرة'); eq((await as(U.sec, 'select public.dm_add_followup_agenda($1) as r', [M2]))[0].r, false, 'ثانية');
      eq((await su("select count(*)::int as n from public.agenda_items where meeting_id=$1 and item_order=1", [M2]))[0].n, 1, 'البند'); return 'ok';
    });
    await fails('إضافة بند المتابعة ممن لا يملك صلاحية', 'لا تملك صلاحية', () => as(U.out, 'select public.dm_add_followup_agenda($1)', [M2]));

    // ───── إصدار التقارير ─────
    let R;
    await fails('العضو بلا صلاحية التصدير لا يصدر تقريرًا', 'لا تملك صلاحية', () => as(U.member, "select public.dm_issue_report('{}'::jsonb)"));
    await ok('أمين السر يصدر التقرير برقم إصدار RPT-<السنة>-0001', async () => {
      R = (await as(U.sec, 'select public.dm_issue_report($1::jsonb) as r', [JSON.stringify({committee_id: BOARD})]))[0].r;
      const y = new Date().getUTCFullYear(); eq(R.report_no, `RPT-${y}-0001`, 'رقم الإصدار');
      eq(R.summary.cards.total, 6, 'الإجمالي'); eq(R.decisions.length, 6, 'جدول القرارات'); eq(R.overdue.length, 2, 'المتأخرة'); eq(R.completed.length, 3, 'المنجزة');
      eq(R.recommendations.length >= 1, true, 'التوصيات'); eq(R.meta.body_name, 'مجلس الإدارة (اختبار)', 'الجهة'); return R.report_no;
    });
    await ok('الإصدار الثاني يزيد الرقم والتقرير محفوظ للمراجعة', async () => {
      const r2 = (await as(U.chair, "select public.dm_issue_report('{}'::jsonb) as r"))[0].r; eq(r2.report_no.endsWith('-0002'), true, 'الرقم');
      eq((await as(U.gov, 'select count(*)::int as n from public.dm_reports'))[0].n, 2, 'السجل'); eq((await as(U.out, 'select count(*)::int as n from public.dm_reports'))[0].n, 0, 'الخارجي'); return 'ok';
    });
    await ok('فصل البيانات: تقرير المسؤول لا يتجاوز ما يراه (لا يملك تصدير)', async () => { try { await as(U.exec, "select public.dm_issue_report('{}'::jsonb)"); throw new Error('أُصدر'); } catch (e) { if (e.message === 'أُصدر') throw e; return 'مرفوض'; } });
  }

  async function run() {
    results.length = 0;
    try { await inner(); } catch (e) { results.push({name: 'توقف اختبار التنبيهات بخطأ غير متوقع', ok: false, detail: e.message}); }
    const part1 = results.slice();
    results.length = 0;
    try { await kpiPart(); } catch (e) { results.push({name: 'توقف اختبار المؤشرات بخطأ غير متوقع', ok: false, detail: e.message}); }
    const all = part1.concat(results);
    const passed = all.filter(r => r.ok).length;
    return {passed, failed: all.length - passed, results: all};
  }
  window.runDecisionTests2 = run;
})();
