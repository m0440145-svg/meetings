// اختبارات SQL لوحدة القرارات على Postgres حقيقي (PGlite). تعمل داخل tests/pg.html:
//   await resetDb(BASE); const r = await runDecisionTests(); console.log(r)
// كل البيانات هنا تجريبية وموسومة بـ (اختبار) ولا تُستخدم في المنصة الفعلية.
(() => {
  const U = {
    admin: '00000000-0000-4000-8000-000000000001', sec: '00000000-0000-4000-8000-000000000002', chair: '00000000-0000-4000-8000-000000000003',
    member: '00000000-0000-4000-8000-000000000004', exec: '00000000-0000-4000-8000-000000000005', gov: '00000000-0000-4000-8000-000000000006',
    aud: '00000000-0000-4000-8000-000000000007', out: '00000000-0000-4000-8000-000000000008', unitHead: '00000000-0000-4000-8000-000000000009',
    exec2: '00000000-0000-4000-8000-00000000000a'
  };
  const results = [];
  const pg = () => window.pg;

  async function as(uid, sql, params = []) {
    await pg().exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false)`);
    try { return (await pg().query(sql, params)).rows; }
    finally { await pg().exec("reset role; select set_config('request.jwt.claim.sub','',false)"); }
  }
  const su = async (sql, params = []) => (await pg().query(sql, params)).rows;
  async function ok(name, fn) {
    try { const d = await fn(); results.push({name, ok: true, detail: d === undefined ? '' : String(d)}); }
    catch (e) { results.push({name, ok: false, detail: e.message}); }
  }
  // يتوقع فشل العملية برسالة تحتوي النص المحدد
  async function fails(name, match, fn) {
    try { await fn(); results.push({name, ok: false, detail: 'لم تفشل العملية كما هو متوقع'}); }
    catch (e) { results.push({name, ok: e.message.includes(match), detail: e.message.includes(match) ? 'رُفضت: ' + e.message : 'رسالة مختلفة: ' + e.message}); }
  }
  const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg || 'تساوٍ'}: المتوقع ${b} والفعلي ${a}`); return `${a}`; };

  async function fixtures() {
    for (const [k, id] of Object.entries(U)) {
      await su('insert into auth.users(id, email) values ($1, $2)', [id, k + '@test.example']);
      await su('insert into public.profiles(id, full_name, role_code, is_active) values ($1, $2, $3, true)', [id, k + ' (اختبار)', k === 'admin' ? 'admin' : null]);
    }
    await su("insert into public.committees(id, name, type) values ('11111111-1111-4111-8111-111111111111', 'مجلس الإدارة (اختبار)', 'مجلس'), ('22222222-2222-4222-8222-222222222222', 'لجنة المراجعة (اختبار)', 'لجنة')");
    await su("insert into public.committee_members(committee_id, user_id) values ('11111111-1111-4111-8111-111111111111', $1), ('22222222-2222-4222-8222-222222222222', $1)", [U.member]);
    await su("insert into public.meetings(id, title, committee_id, gregorian_date, meeting_no, status) values ('33333333-3333-4333-8333-333333333333', 'الاجتماع الخامس 2026 (اختبار)', '11111111-1111-4111-8111-111111111111', '2026-03-10', '5/2026', 'مجدول')");
    await su("insert into public.minutes(id, meeting_id, content, status) values ('44444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-333333333333', 'محضر اختبار', 'مسودة')");
    // تثبيت الاعتماد كما تفعل دالة approve_minute (الترحيل 001 يمنع إدراج محضر معتمد مباشرة)
    await su("select set_config('app.rpc', 'on', false)"); await su("update public.minutes set status = 'معتمد' where id = '44444444-4444-4444-8444-444444444444'"); await su("select set_config('app.rpc', 'off', false)");
    await su("insert into public.minutes(id, meeting_id, content, status) values ('44444444-4444-4444-8444-444444444445', '33333333-3333-4333-8333-333333333333', 'محضر مسودة', 'مسودة')");
  }

  async function runInner() {
    results.length = 0;
    const BOARD = '11111111-1111-4111-8111-111111111111', CMT = '22222222-2222-4222-8222-222222222222', MEET = '33333333-3333-4333-8333-333333333333', MIN = '44444444-4444-4444-8444-444444444444', MIN_DRAFT = '44444444-4444-4444-8444-444444444445';
    await fixtures();
    let UNIT, DEC;

    // ───── الأدوار والإعداد ─────
    await fails('غير المدير لا يمنح أدوارًا', 'لا تملك صلاحية', () => as(U.sec, "select public.dm_grant_role($1,'secretary',null)", [U.sec]));
    await ok('المدير يمنح أمين السر دورًا ضمن المجلس', async () => { await as(U.admin, "select public.dm_grant_role($1,'secretary',$2)", [U.sec, BOARD]); return 'ok'; });
    await as(U.admin, "select public.dm_grant_role($1,'chair',$2)", [U.chair, BOARD]);
    await as(U.admin, "select public.dm_grant_role($1,'governance',null)", [U.gov]);
    await as(U.admin, "select public.dm_grant_role($1,'auditor',null)", [U.aud]);
    await as(U.admin, "select public.dm_grant_role($1,'secretary',$2)", [U.sec, CMT]);
    await fails('لا تُمنح صلاحية الاعتماد لدور مدير النظام', 'لا تُمنح هذه الصلاحية', () => as(U.admin, "select public.dm_set_permission('admin','approve',true)"));
    await ok('المدير ينشئ إدارة (إدارة قانونية - اختبار)', async () => {
      const r = await as(U.admin, "insert into public.org_units(name, head_user_id) values ('الإدارة القانونية (اختبار)', $1) returning id", [U.unitHead]); UNIT = r[0].id; return UNIT;
    });
    await as(U.admin, "insert into public.org_unit_members(unit_id, user_id) values ($1,$2), ($1,$3)", [UNIT, U.exec, U.exec2]);

    // ───── تسجيل القرار (السيناريو: الاجتماع 5 لسنة 2026، تحديث سياسة الصلاحيات خلال 30 يومًا) ─────
    await fails('عضو بلا دور لا ينشئ قرارًا', 'لا تملك صلاحية', () => as(U.member, "select public.dm_create_decision($1::jsonb)", [JSON.stringify({committee_id: BOARD, body_kind: 'board', title: 'x', body_text: 'y'})]));
    await ok('أمين السر ينشئ القرار ويُولَّد رقم مرجعي BD-2026-0001', async () => {
      const r = await as(U.sec, "select public.dm_create_decision($1::jsonb) as id", [JSON.stringify({committee_id: BOARD, body_kind: 'board', meeting_id: MEET, minute_id: MIN, title: 'تحديث سياسة الصلاحيات',
        body_text: 'قرر المجلس تحديث سياسة الصلاحيات خلال 30 يومًا من تاريخه.', category: 'organizational', priority: 'high'})]);
      DEC = r[0].id; const d = (await su('select ref_no, status, meeting_no, decision_date::text as dd from public.decisions where id=$1', [DEC]))[0];
      eq(d.ref_no, 'BD-2026-0001', 'الرقم المرجعي'); eq(d.status, 'draft', 'الحالة'); eq(d.meeting_no, '5/2026', 'رقم الاجتماع'); eq(d.dd, '2026-03-10', 'تاريخ القرار');
      return d.ref_no;
    });
    await fails('لا يُعدَّل القرار مباشرة من العميل', 'permission denied', () => as(U.sec, "update public.decisions set title='تلاعب' where id=$1", [DEC]));
    await fails('ربط محضر لاجتماع آخر مرفوض', 'المحضر لا يخص', async () => {
      await su("insert into public.meetings(id, title, committee_id, gregorian_date) values ('55555555-5555-4555-8555-555555555555','اجتماع آخر (اختبار)','11111111-1111-4111-8111-111111111111','2026-04-01')");
      await as(U.sec, "select public.dm_create_decision($1::jsonb)", [JSON.stringify({committee_id: BOARD, body_kind: 'board', meeting_id: '55555555-5555-4555-8555-555555555555', minute_id: MIN, title: 'مخالف', body_text: 'نص'})]);
    });
    await ok('أمين السر يعدّل المسودة', async () => { await as(U.sec, "select public.dm_update_draft($1,$2::jsonb)", [DEC, JSON.stringify({deliverables: 'سياسة صلاحيات محدّثة معتمدة'})]); return 'ok'; });
    let REF;
    await ok('أمين السر يرفق مستندًا مرجعيًا بالقرار (لا يُعدّ دليل إنجاز)', async () => {
      const r = await as(U.sec, 'select public.dm_add_reference($1,$2,$3,$4,$5,$6) as id', [DEC, 'ملحق مرجعي.pdf', DEC + '/ref.pdf', 'application/pdf', 100, 'مستند ذو صلة']); REF = r[0].id;
      return eq((await su("select kind from public.decision_evidence where id=$1", [REF]))[0].kind, 'reference', 'النوع');
    });
    await fails('المرفق المرجعي لا يُراجَع كدليل', 'لا تُراجَع', () => as(U.gov, 'select public.dm_review_evidence($1,true,$2)', [REF, 'x']));
    await fails('عضو بلا صلاحية لا يرفق مرجعًا', 'لا تملك صلاحية', () => as(U.member, 'select public.dm_add_reference($1,$2,$3,$4,$5,$6)', [DEC, 'x.pdf', DEC + '/x.pdf', 'application/pdf', 1, '']));
    await ok('الطرف الخارجي لا يرى القرار (RLS)', async () => eq((await as(U.out, 'select id from public.decisions')).length, 0, 'عدد المرئي'));
    await ok('مدير النظام التقني لا يرى محتوى القرارات', async () => eq((await as(U.admin, 'select id from public.decisions')).length, 0, 'عدد المرئي'));
    await ok('عضو المجلس لا يرى المسودة', async () => eq((await as(U.member, 'select id from public.decisions')).length, 0, 'عدد المرئي'));

    // ───── الاعتماد ─────
    await as(U.sec, 'select public.dm_submit($1)', [DEC]);
    await fails('أمين السر لا يعتمد (صلاحية رئيس المجلس)', 'لا تملك صلاحية', () => as(U.sec, 'select public.dm_approve($1)', [DEC]));
    await ok('أعضاء المجلس يرون القرار بعد تقديمه', async () => eq((await as(U.member, 'select id from public.decisions')).length, 1, 'عدد المرئي'));
    await fails('لا يُعتمد قرار مرتبط بمحضر غير معتمد', 'قبل اعتماد محضر', async () => {
      const r = await as(U.sec, "select public.dm_create_decision($1::jsonb) as id", [JSON.stringify({committee_id: BOARD, body_kind: 'board', meeting_id: MEET, minute_id: MIN_DRAFT, title: 'قرار بمحضر مسودة', body_text: 'نص القرار'})]);
      await as(U.sec, 'select public.dm_submit($1)', [r[0].id]);
      await as(U.chair, 'select public.dm_approve($1)', [r[0].id]);
    });
    await ok('رئيس المجلس يعتمد القرار فينتقل لبانتظار الإسناد', async () => { await as(U.chair, 'select public.dm_approve($1)', [DEC]); return eq((await su('select status from public.decisions where id=$1', [DEC]))[0].status, 'pending_assignment', 'الحالة'); });
    await ok('النص المعتمد الأصلي محفوظ كنسخة 1', async () => eq((await su('select count(*)::int as n from public.decision_text_versions where decision_id=$1', [DEC]))[0].n, 1, 'عدد النسخ'));

    // ───── الإسناد ─────
    const due30 = (await su("select (date '2026-03-10' + 30)::text as d"))[0].d;
    await fails('الإسناد بلا مخرجات مرفوض', 'المخرجات المطلوبة', () => as(U.sec, 'select public.dm_assign($1,$2,$3,$4::date,$5,$6,$7::uuid[])', [DEC, UNIT, U.exec, due30, '', '', []]));
    await fails('الإسناد بتاريخ قبل القرار مرفوض', 'لا يسبق', () => as(U.sec, 'select public.dm_assign($1,$2,$3,$4::date,$5,$6,$7::uuid[])', [DEC, UNIT, U.exec, '2026-01-01', 'مخرج', '', []]));
    await fails('من لا يملك صلاحية الإسناد', 'لا تملك صلاحية', () => as(U.exec, 'select public.dm_assign($1,$2,$3,$4::date,$5,$6,$7::uuid[])', [DEC, UNIT, U.exec, due30, 'مخرج', '', []]));
    await ok('أمين السر يسند للإدارة القانونية مع مساعد ويُنشأ إشعار ومهمة', async () => {
      await as(U.sec, 'select public.dm_assign($1,$2,$3,$4::date,$5,$6,$7::uuid[])', [DEC, UNIT, U.exec, due30, 'سياسة صلاحيات محدّثة معتمدة', 'اعتماد السياسة من المجلس', [U.exec2]]);
      const d = (await su('select status, to_char(due_date, \'YYYY-MM-DD\') as due, to_char(original_due_date, \'YYYY-MM-DD\') as orig from public.decisions where id=$1', [DEC]))[0];
      eq(d.status, 'assigned', 'الحالة'); eq(d.due, due30, 'الاستحقاق'); eq(d.orig, due30, 'الاستحقاق الأصلي');
      eq((await su("select count(*)::int as n from public.tasks where decision_id=$1 and assignee_id=$2", [DEC, U.exec]))[0].n, 1, 'المهمة');
      eq((await su("select count(*)::int as n from public.notifications where user_id=$1 and title like 'قرار مكلّف%'", [U.exec]))[0].n, 1, 'إشعار المسؤول');
      eq((await su("select count(*)::int as n from public.notifications where user_id=$1 and title like 'قرار مكلّف%'", [U.exec2]))[0].n, 1, 'إشعار المساعد');
      return 'assigned';
    });
    await ok('المسؤول يرى قراره ويظهر في قراراته المكلف بها', async () => eq((await as(U.exec, 'select id from public.decisions where owner_id = auth.uid()')).length, 1, 'العدد'));

    // ───── التنفيذ والأدلة ─────
    await fails('تحديث من غير المكلّف مرفوض', 'لا تملك صلاحية', () => as(U.member, "select public.dm_post_update($1,'progress',20,'محاولة',null)", [DEC]));
    await ok('المسؤول يحدّث الإنجاز 50% فيصبح جارٍ التنفيذ', async () => {
      await as(U.exec, "select public.dm_post_update($1,'progress',50,'تمت مراجعة المسودة الأولية',null)", [DEC]);
      const d = (await su('select status, progress_pct from public.decisions where id=$1', [DEC]))[0]; eq(d.status, 'executing', 'الحالة'); eq(d.progress_pct, 50, 'النسبة'); return d.status;
    });
    await ok('إجراء فرعي بمسؤول وموعد', async () => { const r = await as(U.exec, 'select public.dm_add_action($1,$2,$3,$4,$5::date) as id', [DEC, 'مراجعة قانونية للسياسة', UNIT, U.exec2, '2026-04-01']); return r[0].id; });
    await fails('لا يُضاف إجراء بعد موعد القرار', 'بعد موعد القرار', () => as(U.exec, 'select public.dm_add_action($1,$2,$3,$4,$5::date)', [DEC, 'متأخر', UNIT, U.exec2, '2027-01-01']));
    await fails('طلب الاعتماد قبل 100%', 'يجب أن تكون 100', () => as(U.exec, 'select public.dm_request_verification($1,$2,true)', [DEC, 'جاهز']));
    await as(U.exec, "select public.dm_post_update($1,'progress',100,'اكتمل التنفيذ',null)", [DEC]);
    await fails('طلب الاعتماد مع إجراء فرعي مفتوح', 'إجراءات فرعية غير مكتملة', () => as(U.exec, 'select public.dm_request_verification($1,$2,true)', [DEC, 'جاهز']));
    const actionId = (await su("select id from public.decision_actions where decision_id=$1", [DEC]))[0].id;
    await fails('تحديث الإجراء من غير مسؤوله', 'لا تملك صلاحية', () => as(U.member, "select public.dm_set_action($1,'done',100)", [actionId]));
    await ok('مسؤول الإجراء يكمله', async () => { await as(U.exec2, "select public.dm_set_action($1,'done',100)", [actionId]); return 'ok'; });
    await fails('طلب الاعتماد بلا دليل إنجاز', 'دليل إنجاز', () => as(U.exec, 'select public.dm_request_verification($1,$2,true)', [DEC, 'جاهز']));
    let EV;
    await fails('رفع دليل بمسار خاطئ', 'مسار الملف', () => as(U.exec, 'select public.dm_add_evidence($1,null,$2,$3,$4,$5,$6)', [DEC, 'x.pdf', 'other/x.pdf', 'application/pdf', 10, '']));
    await ok('المسؤول يرفع دليل الإنجاز', async () => { const r = await as(U.exec, 'select public.dm_add_evidence($1,null,$2,$3,$4,$5,$6) as id', [DEC, 'السياسة المعتمدة.pdf', DEC + '/policy.pdf', 'application/pdf', 20480, 'النسخة النهائية']); EV = r[0].id; return EV; });
    await fails('طلب الاعتماد دون تأكيد اكتمال المخرجات', 'أكّد', () => as(U.exec, 'select public.dm_request_verification($1,$2,false)', [DEC, 'جاهز']));
    await ok('طلب اعتماد الإنجاز', async () => { await as(U.exec, 'select public.dm_request_verification($1,$2,true)', [DEC, 'جميع المخرجات منجزة']); return eq((await su('select status from public.decisions where id=$1', [DEC]))[0].status, 'pending_verification', 'الحالة'); });
    await ok('المسؤول لا يرفع أدلة بعد طلب الاعتماد', async () => { try { await as(U.exec, 'select public.dm_add_evidence($1,null,$2,$3,$4,$5,$6)', [DEC, 'y.pdf', DEC + '/y.pdf', 'application/pdf', 1, '']); throw new Error('قُبل الرفع'); } catch (e) { if (e.message === 'قُبل الرفع') throw e; return 'مرفوض'; } });

    // ───── التحقق (فصل المهام) ─────
    await fails('المسؤول لا يتحقق من إنجاز قراره', 'لا تملك صلاحية', () => as(U.exec, 'select public.dm_verify($1,true,$2)', [DEC, 'موافق']));
    await fails('لا يُقفل القرار قبل التحقق', 'قبل اكتمال التحقق', () => as(U.chair, 'select public.dm_close($1,$2)', [DEC, 'إقفال']));
    await fails('الموافقة قبل مراجعة الأدلة', 'لم يُراجَع', () => as(U.gov, 'select public.dm_verify($1,true,$2)', [DEC, 'موافق']));
    await ok('مسؤول الحوكمة يرفض الدليل مع السبب', async () => { await as(U.gov, 'select public.dm_review_evidence($1,false,$2)', [EV, 'الملف لا يحمل توقيع الاعتماد']); return 'ok'; });
    await fails('رفض الدليل بلا سبب', 'سبب رفض', () => as(U.gov, 'select public.dm_review_evidence($1,false,$2)', [EV, '']));
    await ok('إعادة القرار للاستكمال مع السبب', async () => {
      await as(U.gov, 'select public.dm_verify($1,false,$2)', [DEC, 'الدليل غير مستوفٍ: يلزم توقيع الاعتماد']);
      return eq((await su('select status from public.decisions where id=$1', [DEC]))[0].status, 'returned', 'الحالة');
    });
    await ok('المسؤول يستكمل ويرفع دليلًا جديدًا ثم يعيد الطلب', async () => {
      await as(U.exec, "select public.dm_post_update($1,'corrective',null,'أُضيف التوقيع المطلوب',null)", [DEC]);
      const r = await as(U.exec, 'select public.dm_add_evidence($1,null,$2,$3,$4,$5,$6) as id', [DEC, 'السياسة موقّعة.pdf', DEC + '/signed.pdf', 'application/pdf', 25000, 'بعد التوقيع']); EV = r[0].id;
      await as(U.exec, 'select public.dm_request_verification($1,$2,true)', [DEC, 'تم الاستكمال']);
      return eq((await su('select status from public.decisions where id=$1', [DEC]))[0].status, 'pending_verification', 'الحالة');
    });
    await fails('الموافقة والدليل القديم المرفوض ما زال قائمًا؟ (القديم مرفوض والجديد لم يُراجع)', 'لم يُراجَع', () => as(U.gov, 'select public.dm_verify($1,true,$2)', [DEC, 'موافق']));
    await as(U.gov, 'select public.dm_review_evidence($1,true,$2)', [EV, 'مقبول']);
    await ok('مسؤول الحوكمة يعتمد الإنجاز فيصبح مكتملًا بانتظار الإقفال', async () => { await as(U.gov, 'select public.dm_verify($1,true,$2)', [DEC, 'مستوفٍ']); return eq((await su('select status from public.decisions where id=$1', [DEC]))[0].status, 'completed', 'الحالة'); });
    await fails('الإقفال ممن لا يملك الصلاحية', 'لا تملك صلاحية', () => as(U.exec, 'select public.dm_close($1,$2)', [DEC, 'إقفال']));
    await ok('رئيس المجلس يقفل القرار ويُغلق المهمة المرتبطة', async () => {
      await as(U.chair, 'select public.dm_close($1,$2)', [DEC, 'اعتُمد الإقفال']);
      const d = (await su('select status, closed_by::text as cb from public.decisions where id=$1', [DEC]))[0]; eq(d.status, 'closed', 'الحالة'); eq(d.cb, U.chair, 'المقفِل');
      return eq((await su("select status from public.tasks where decision_id=$1", [DEC]))[0].status, 'مكتملة', 'المهمة');
    });
    await fails('لا يُلغى قرار مقفل', 'مقفل', () => as(U.chair, 'select public.dm_cancel($1,$2)', [DEC, 'سبب الإلغاء']));
    await ok('سجل الأحداث مكتمل وغير قابل للتعديل', async () => {
      const ev = await su('select event_type from public.decision_events where decision_id=$1 order by id', [DEC]);
      const types = ev.map(e => e.event_type);
      for (const t of ['created', 'submitted', 'approved', 'assigned', 'started', 'verification_requested', 'verification_returned', 'verified', 'closed']) if (!types.includes(t)) throw new Error('ينقص الحدث ' + t);
      try { await su("update public.decision_events set event_type='x' where decision_id=$1", [DEC]); throw new Error('عُدِّل السجل'); } catch (e) { if (e.message === 'عُدِّل السجل') throw e; }
      return types.length + ' حدثًا';
    });
    await ok('المراجع الداخلي يقرأ القرار والسجل ولا يعدّل', async () => {
      eq((await as(U.aud, 'select id from public.decisions')).length >= 1, true, 'يرى');
      eq((await as(U.aud, 'select id from public.decision_events where decision_id=$1', [DEC])).length > 5, true, 'السجل');
      try { await as(U.aud, 'select public.dm_close($1,$2)', [DEC, 'x']); throw new Error('أغلق'); } catch (e) { if (e.message === 'أغلق') throw e; }
      return 'ok';
    });

    // ───── التمديد ─────
    let D2;
    await ok('قرار ثانٍ بالرقم BD-2026-0003 ويمر حتى الإسناد (0002 استُهلك لمسودة محضر غير معتمد)', async () => {
      const r = await as(U.sec, 'select public.dm_create_decision($1::jsonb) as id', [JSON.stringify({committee_id: BOARD, body_kind: 'board', meeting_id: MEET, minute_id: MIN, title: 'اعتماد الميزانية التقديرية', body_text: 'اعتمد المجلس الميزانية.', priority: 'critical'})]);
      D2 = r[0].id; await as(U.sec, 'select public.dm_submit($1)', [D2]); await as(U.chair, 'select public.dm_approve($1)', [D2]);
      await as(U.sec, 'select public.dm_assign($1,$2,$3,$4::date,$5,$6,$7::uuid[])', [D2, UNIT, U.exec, '2026-06-01', 'ميزانية معتمدة', '', []]);
      return eq((await su('select ref_no from public.decisions where id=$1', [D2]))[0].ref_no, 'BD-2026-0003', 'الرقم');
    });
    let REQ;
    await fails('تمديد بموعد قبل الحالي', 'بعد الموعد الحالي', () => as(U.exec, 'select public.dm_request_extension($1,$2::date,$3)', [D2, '2026-05-01', 'سبب كافٍ للتمديد']));
    await ok('المسؤول يطلب تمديدًا 40 يومًا', async () => { const r = await as(U.exec, 'select public.dm_request_extension($1,$2::date,$3) as id', [D2, '2026-07-11', 'بانتظار بيانات الجهات المعنية']); REQ = r[0].id; return REQ; });
    await fails('طلب تمديد ثانٍ أثناء الأول', 'قيد الدراسة', () => as(U.exec, 'select public.dm_request_extension($1,$2::date,$3)', [D2, '2026-07-20', 'سبب كافٍ آخر']));
    await fails('المسؤول لا يبتّ في تمديد قراره', 'لا تملك صلاحية', () => as(U.exec, 'select public.dm_decide_extension($1,true,$2,null)', [REQ, 'موافق']));
    await fails('أمين السر لا يتجاوز حد التمديد (14 يومًا)', 'الحد لأمين السر', () => as(U.sec, 'select public.dm_decide_extension($1,true,$2,null)', [REQ, 'موافق']));
    await ok('رئيس المجلس يعتمد التمديد ويُحفظ الموعد الأصلي', async () => {
      await as(U.chair, 'select public.dm_decide_extension($1,true,$2,null)', [REQ, 'موافقة المجلس']);
      const d = (await su("select to_char(due_date,'YYYY-MM-DD') as due, to_char(original_due_date,'YYYY-MM-DD') as orig, extension_count as n from public.decisions where id=$1", [D2]))[0];
      eq(d.due, '2026-07-11', 'الموعد الجديد'); eq(d.orig, '2026-06-01', 'الأصلي'); eq(d.n, 1, 'عدد التمديدات'); return 'محفوظ الأصلي';
    });
    await ok('أمين السر يعتمد تمديدًا ضمن حده (10 أيام)', async () => {
      const r = await as(U.exec, 'select public.dm_request_extension($1,$2::date,$3) as id', [D2, '2026-07-21', 'تعذّر الحصول على الاعتماد النهائي']);
      await as(U.sec, 'select public.dm_decide_extension($1,true,$2,null)', [r[0].id, 'ضمن صلاحية أمين السر']); return 'ok';
    });
    await ok('رفض تمديد مع السبب', async () => {
      const r = await as(U.exec, 'select public.dm_request_extension($1,$2::date,$3) as id', [D2, '2026-12-31', 'طلب مفتوح المدة']);
      await fails2(() => as(U.chair, 'select public.dm_decide_extension($1,false,$2,null)', [r[0].id, '']), 'سبب الرفض');
      await as(U.chair, 'select public.dm_decide_extension($1,false,$2,null)', [r[0].id, 'المدة المطلوبة مبالغ فيها']); return 'ok';
    });

    // ───── إعادة الإسناد والتوجيه وتعديل النص والإلغاء ─────
    await fails('إعادة الإسناد بلا سبب', 'سبب إعادة الإسناد', () => as(U.sec, 'select public.dm_reassign($1,$2,$3,$4)', [D2, UNIT, U.exec2, '']));
    await ok('تغيير المسؤول عن التنفيذ يحدّث المهمة ويُسجَّل', async () => {
      await as(U.sec, 'select public.dm_reassign($1,$2,$3,$4)', [D2, UNIT, U.exec2, 'نقل المسؤول الأول لمهمة أخرى']);
      eq((await su('select owner_id::text as o from public.decisions where id=$1', [D2]))[0].o, U.exec2, 'المسؤول');
      eq((await su('select assignee_id::text as a from public.tasks where decision_id=$1', [D2]))[0].a, U.exec2, 'المهمة'); return 'ok';
    });
    await ok('عضو اللجنة يصدر توجيهًا مرتبطًا بالقرار الأصلي', async () => { const r = await as(U.member, "select public.dm_issue_directive($1,$2,'clarification',$3) as id", [D2, MEET, 'نطلب إيضاحًا عن سبب التأخر']); return r[0].id; });
    await fails('طرف خارجي لا يوجّه', 'لا تملك صلاحية', () => as(U.out, "select public.dm_issue_directive($1,$2,'directive',$3)", [D2, MEET, 'توجيه']));
    await fails('أمين السر لا يعدّل النص المعتمد', 'لا تملك صلاحية', () => as(U.sec, 'select public.dm_amend_text($1,$2,$3)', [D2, 'نص جديد', 'سند التعديل']));
    await ok('رئيس المجلس يعدّل النص بسند وتبقى النسخ التاريخية', async () => {
      await as(U.chair, 'select public.dm_amend_text($1,$2,$3)', [D2, 'اعتمد المجلس الميزانية التقديرية المعدّلة.', 'قرار المجلس في الاجتماع السادس']);
      const v = await su('select version, body_text from public.decision_text_versions where decision_id=$1 order by version', [D2]);
      eq(v.length, 2, 'النسخ'); eq(v[0].body_text, 'اعتمد المجلس الميزانية.', 'النص الأصلي محفوظ'); return 'v' + v.length;
    });
    await fails('إلغاء بلا سبب كافٍ', 'سبب الإلغاء', () => as(U.chair, 'select public.dm_cancel($1,$2)', [D2, 'x']));
    await ok('رئيس المجلس يلغي القرار بسبب موثّق', async () => { await as(U.chair, 'select public.dm_cancel($1,$2)', [D2, 'ألغي لتغير الظروف المالية']); return eq((await su('select status from public.decisions where id=$1', [D2]))[0].status, 'cancelled', 'الحالة'); });

    // ───── التوصية لا تصبح ملزمة قبل التصديق ─────
    await ok('توصية لجنة: معتمدة لكنها لا تُسند قبل التصديق', async () => {
      const r = await as(U.sec, 'select public.dm_create_decision($1::jsonb) as id', [JSON.stringify({committee_id: CMT, body_kind: 'committee', record_type: 'recommendation', title: 'توصية بتحديث لائحة المشتريات', body_text: 'توصي اللجنة بتحديث اللائحة.'})]);
      const id = r[0].id; eq((await su('select ref_no from public.decisions where id=$1', [id]))[0].ref_no, 'CM-2026-0001', 'ترقيم اللجان');
      await as(U.sec, 'select public.dm_submit($1)', [id]);
      await as(U.admin, "select public.dm_grant_role($1,'chair',$2)", [U.chair, CMT]);
      await as(U.chair, 'select public.dm_approve($1)', [id]);
      eq((await su('select status from public.decisions where id=$1', [id]))[0].status, 'approved', 'تبقى معتمدة');
      await fails2(() => as(U.sec, 'select public.dm_assign($1,$2,$3,$4::date,$5,$6,$7::uuid[])', [id, UNIT, U.exec, '2026-12-01', 'مخرج', '', []]), 'ليس بانتظار الإسناد');
      await as(U.chair, 'select public.dm_ratify($1)', [id]);
      eq((await su('select status, record_type from public.decisions where id=$1', [id]))[0].status, 'pending_assignment', 'بعد التصديق'); return 'CM-2026-0001';
    });

    const passed = results.filter(r => r.ok).length;
    return {passed, failed: results.length - passed, results};
  }
  async function fails2(fn, match) { try { await fn(); } catch (e) { if (!e.message.includes(match)) throw new Error('رسالة مختلفة: ' + e.message); return; } throw new Error('لم تفشل العملية'); }

  async function run() { results.length = 0; try { await runInner(); } catch (e) { results.push({name: "توقف الاختبار بخطأ غير متوقع", ok: false, detail: e.message}); } const passed = results.filter(r => r.ok).length; return {passed, failed: results.length - passed, results}; }
  window.DMT = {U, as, su, ok, fails, fails2, eq, fixtures, results};
  window.runDecisionTests = run;
  window.TEST_USERS = U;
})();
