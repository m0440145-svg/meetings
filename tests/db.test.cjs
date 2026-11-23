'use strict';
// اختبارات قاعدة البيانات على PostgreSQL معزول (PGlite): تُطبَّق ترحيلاتنا الحقيقية 001..N على مخطط يحاكي Supabase (tests/prelude.sql)،
// ثم تُعاد سيناريوهات الأمان التي جُرّبت على الإنتاج. بيانات تجريبية فقط، ولا اتصال بأي مشروع Supabase.
// ملاحظة: المخطط الأساسي مبني على افتراضات (tests/prelude.sql)؛ النجاح هنا يثبت منطق ترحيلاتنا وليس مطابقة قاعدة الإنتاج حرفيًا.
const {describe, it, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {PGlite} = require('@electric-sql/pglite');
process.on('unhandledRejection', e => { console.error('UNHANDLED REJECTION:', e && e.stack || e); process.exitCode = 1; });

const root = path.resolve(__dirname, '..');
const text = p => fs.readFileSync(path.join(root, p), 'utf8');
const migrations = fs.readdirSync(path.join(root, 'supabase', 'migrations')).filter(f => /^\d{3}_.*\.sql$/.test(f)).sort();

const ID = {
  admin: '00000000-0000-4000-8000-0000000000a1',
  m1: '00000000-0000-4000-8000-0000000000b1',
  m2: '00000000-0000-4000-8000-0000000000b2',
  c1: '00000000-0000-4000-8000-0000000000c1',
  mt: '00000000-0000-4000-8000-0000000000d1',
  vt: '00000000-0000-4000-8000-0000000000e1'
};
let db;
// يكتب في ملخص تشغيل GitHub Actions (الصفحة الرئيسية للتشغيل) حتى لا نحتاج لتصفح السجلات الطويلة
function summary(line) {
  console.error(line);
  try { if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '- ' + line + '\n'); } catch { /* غير حرج */ }
}
// يغلّف الاختبار: يسجّل نجاحه أو فشله (مع الرسالة) في ملخص التشغيل ثم يعيد رمي الخطأ
function check(name, fn) {
  it(name, async () => {
    try { await fn(); summary('ok: ' + name); }
    catch (e) { summary('FAIL: ' + name + ' :: ' + String(e && e.message).replace(/\r?\n/g, ' ').slice(0, 700)); throw e; }
  });
}

// جداول أساسية موجودة في الإنتاج ولا ترحيلات لها (تفترضها الترحيلات) وغير موجودة في tests/prelude.sql. أعمدتها مستنتجة من استخدام الترحيلات لها.
const EXTRA_BASE = `
alter table auth.users add column if not exists raw_user_meta_data jsonb, add column if not exists email_confirmed_at timestamptz;
alter table public.profiles add column if not exists email text, add column if not exists organization text;
alter table public.committee_members add column if not exists committee_role text default 'member';
alter table public.committees add column if not exists created_by uuid, add column if not exists created_at timestamptz default now();
create or replace function storage.filename(name text) returns text language sql immutable as $$ select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;
create table if not exists public.attachments (id uuid primary key default gen_random_uuid(), meeting_id uuid references public.meetings(id) on delete cascade,
  agenda_item_id uuid references public.agenda_items(id) on delete cascade, file_name text, storage_path text, uploaded_by uuid, created_at timestamptz default now());
create table if not exists public.circular_responses (circular_id uuid references public.circular_decisions(id) on delete cascade, user_id uuid, choice text, comment text,
  responded_at timestamptz default now(), primary key (circular_id, user_id));
create table if not exists public.transcripts (id uuid primary key default gen_random_uuid(), meeting_id uuid references public.meetings(id) on delete cascade, content text, created_by uuid, created_at timestamptz default now());
create table if not exists public.whiteboards (id uuid primary key default gen_random_uuid(), meeting_id uuid references public.meetings(id) on delete cascade, content text, updated_by uuid, updated_at timestamptz default now());
create table if not exists public.reminders (id uuid primary key default gen_random_uuid(), meeting_id uuid references public.meetings(id) on delete cascade, created_by uuid, created_at timestamptz default now());
-- سياسات أساسية في الإنتاج بلا ترحيلات؛ ترحيلاتنا تعدّلها بـ alter policy (034 و039) أو تعتمد وجودها
create policy "agenda restrict to member meetings" on public.agenda_items as restrictive for select to authenticated using (true);
create policy "attachments restrict to member meetings" on public.attachments as restrictive for select to authenticated using (true);
create policy "votes restrict to member meetings" on public.votes as restrictive for select to authenticated using (true);
create policy "minutes restrict to member meetings" on public.minutes as restrictive for select to authenticated using (true);
create policy "meetings admin create" on public.meetings for insert to authenticated with check (true);
create policy "profiles authenticated read" on public.profiles for select to authenticated using (true);
create policy "profiles self update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
`;

async function setClaims(uid, role) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', $2, false)", [uid || '', role || '']);
}
async function asUser(uid, fn) {
  await setClaims(uid, 'authenticated');
  await db.exec('set role authenticated');
  try { return await fn(); } finally { await db.exec('reset role'); await setClaims('', ''); }
}
async function asAnon(fn) {
  await setClaims('', 'anon');
  await db.exec('set role anon');
  try { return await fn(); } finally { await db.exec('reset role'); await setClaims('', ''); }
}
// يعيد SQLSTATE عند الرفض أو 'ok' عند النجاح
async function outcome(promise) {
  try { await promise; return 'ok'; } catch (e) { return e.code || ('ERR:' + e.message); }
}
async function setStatus(uid, status) {
  await setClaims('', '');
  await db.query('update public.profiles set approval_status = $2 where id = $1', [uid, status]);
}
async function gate(p, method) {
  await db.query("select set_config('request.path', $1, false), set_config('request.method', $2, false)", [p, method]);
  return outcome(db.query('select public.api_gate()'));
}



describe('security scenarios on the real migrations', () => {
  before(async () => {
    try {
    db = new PGlite();
    await db.waitReady;
    await db.exec(text('tests/prelude.sql'));
    await db.exec(EXTRA_BASE);
    await db.exec("do $$ begin create role authenticator nologin; exception when duplicate_object then null; end $$;");
    const failures = [];
    for (const f of migrations) {
      try { await db.exec(text('supabase/migrations/' + f)); }
      catch (e) { failures.push(f + ': ' + e.message); try { await db.exec('rollback'); } catch { /* لا معاملة مفتوحة */ } }
    }
    if (failures.length) {
      // تنبيهات GitHub Actions: تظهر في ملخص التشغيل (سطر لكل إخفاق، الأول هو السبب الجذري وما بعده قد يكون نتيجة له)
      failures.slice(0, 8).forEach(m => summary('Migration failed on a clean database: ' + m.replace(/\r?\n/g, ' ').slice(0, 600)));
    }
    assert.deepEqual(failures, [], 'migrations failed on a clean database (the first is the root cause, later ones may follow from it):\n' + failures.join('\n'));
    // بيانات تجريبية
    for (const [id, name, role] of [[ID.admin, 'مدير اختبار', 'admin'], [ID.m1, 'عضو اختبار أول', 'member'], [ID.m2, 'عضو اختبار ثان', 'member']]) {
      await db.query('insert into auth.users(id, email) values ($1, $2)', [id, name.length + '@example.test']);
      await db.query("insert into public.profiles(id, full_name, role, role_code, is_active, approval_status) values ($1, $2, $3, $3, true, 'معتمد')", [id, name, role]);
    }
    await db.query("insert into public.committees(id, name) values ($1, 'لجنة اختبار')", [ID.c1]);
    await db.query("insert into public.committee_members(committee_id, user_id) values ($1, $2)", [ID.c1, ID.m1]);
    await db.query("insert into public.meetings(id, title, committee_id, gregorian_date, start_time, end_time, created_by, status) values ($1, 'اجتماع اختبار', $2, current_date, '10:00', '11:00', $3, 'مجدول')", [ID.mt, ID.c1, ID.admin]);
    await db.query("insert into public.votes(id, meeting_id, question, vote_type, quorum_required, status, created_by) values ($1, $2, 'سؤال اختبار', 'علني', 1, 'مفتوح', $3)", [ID.vt, ID.mt, ID.admin]);
    } catch (e) {
      summary('DB test setup failed: ' + String(e && e.message).replace(/\r?\n/g, ' ').slice(0, 800));
      throw e;
    }
  });
  after(async () => { await db?.close(); });

  check('approval gate: no public table is missing the approved_only policy', async () => {
    // الدالة للمدير فقط (بتصميمها)؛ يستدعيها حساب المدير المعتمد
    const rows = await asUser(ID.admin, async () => (await db.query('select * from public.approval_gate_missing()')).rows);
    assert.deepEqual(rows, [], 'tables without the approval gate: ' + JSON.stringify(rows));
  });

  check('a member cannot edit sensitive profile columns but can edit their own contact data', async () => {
    await asUser(ID.m1, async () => {
      assert.equal(await outcome(db.query('update public.profiles set is_manual = true where id = $1', [ID.m1])), '42501');
      assert.equal(await outcome(db.query("update public.profiles set email = 'x@y.zz' where id = $1", [ID.m1])), '42501');
      assert.equal(await outcome(db.query("update public.profiles set role_code = 'admin' where id = $1", [ID.m1])), '42501');
      assert.equal(await outcome(db.query("update public.profiles set approval_status = 'معتمد' where id = $1", [ID.m1])), '42501');
      assert.equal(await outcome(db.query("update public.profiles set phone = '0555555555' where id = $1", [ID.m1])), 'ok');
      assert.equal(await outcome(db.query('update public.profiles set full_name = full_name where id = $1', [ID.m1])), 'ok');
    });
  });

  check('a suspended account is rejected by SECURITY DEFINER RPCs', async () => {
    await setStatus(ID.m1, 'موقوف');
    try {
      await asUser(ID.m1, async () => {
        assert.equal(await outcome(db.query("select public.cast_vote($1, 'موافق', null)", [ID.vt])), '42501');
        assert.equal(await outcome(db.query("select public.attendance_self($1, 'حاضر')", [ID.mt])), '42501');
      });
    } finally { await setStatus(ID.m1, 'معتمد'); }
  });

  check('api_gate: unapproved accounts reach only is_approved and GET profiles; approved and anonymous pass', async () => {
    await setStatus(ID.m1, 'موقوف');
    try {
      await asUser(ID.m1, async () => {
        assert.equal(await gate('/rpc/cast_vote', 'POST'), '42501');
        assert.equal(await gate('/rpc/is_approved', 'POST'), 'ok');
        assert.equal(await gate('/profiles', 'GET'), 'ok');
        assert.equal(await gate('/profiles', 'POST'), '42501');
        assert.equal(await gate('/r%70c/cast_vote', 'POST'), '42501');
        assert.equal(await gate('/meetings', 'GET'), '42501');
      });
    } finally { await setStatus(ID.m1, 'معتمد'); }
    await asUser(ID.m1, async () => { assert.equal(await gate('/rpc/cast_vote', 'POST'), 'ok'); });
    await asAnon(async () => { assert.equal(await gate('/rpc/cast_vote', 'POST'), 'ok'); });
    await db.query("select set_config('request.path', '', false)");
  });

  check('is_admin requires an approved account', async () => {
    await asUser(ID.admin, async () => { assert.equal((await db.query('select public.is_admin() as r')).rows[0].r, true); });
    await setStatus(ID.admin, 'موقوف');
    try {
      await asUser(ID.admin, async () => { assert.equal((await db.query('select public.is_admin() as r')).rows[0].r, false); });
    } finally { await setStatus(ID.admin, 'معتمد'); }
  });

  check('attendance and voting flow: window across midnight, presence required, one vote, abstain needs a reason', async () => {
    // اجتماع تبدأ لحظته الآن بتوقيت الرياض وتنتهي «قبلها» (يعبر منتصف الليل)
    await db.query(`update public.meetings set gregorian_date = (now() at time zone 'Asia/Riyadh')::date,
      start_time = (now() at time zone 'Asia/Riyadh')::time, end_time = ((now() at time zone 'Asia/Riyadh')::time - interval '1 minute') where id = $1`, [ID.mt]);
    await asUser(ID.m2, async () => {
      assert.equal(await outcome(db.query("select public.attendance_self($1, 'حاضر')", [ID.mt])), '42501'); // ليس من اللجنة
      assert.equal(await outcome(db.query("select public.cast_vote($1, 'موافق', null)", [ID.vt])), 'P0001'); // بلا حضور
    });
    await asUser(ID.m1, async () => {
      assert.equal(await outcome(db.query("select public.cast_vote($1, 'موافق', null)", [ID.vt])), 'P0001'); // بلا حضور بعد
      const r = await db.query("select public.attendance_self($1, 'حاضر') as r", [ID.mt]);
      assert.equal(r.rows[0].r, 'حاضر');
      assert.equal(await outcome(db.query("select public.cast_vote($1, 'ممتنع', null)", [ID.vt])), 'P0001'); // امتناع بلا سبب
      assert.equal(await outcome(db.query("select public.cast_vote($1, 'ممتنع', 'سبب كاف')", [ID.vt])), 'ok');
      assert.equal(await outcome(db.query("select public.cast_vote($1, 'موافق', null)", [ID.vt])), 'P0001'); // تصويت ثان
    });
    const n = await db.query('select count(*)::int as c from public.vote_ballots where vote_id = $1', [ID.vt]);
    assert.equal(n.rows[0].c, 1);
  });

  check('member_suspend / member_reactivate rules', async () => {
    await asUser(ID.m1, async () => { assert.equal(await outcome(db.query("select public.member_suspend($1, 'سبب')", [ID.m2])), '42501'); });
    await asUser(ID.admin, async () => {
      assert.equal(await outcome(db.query("select public.member_suspend($1, 'سبب الإيقاف')", [ID.m2])), 'ok');
      assert.equal(await outcome(db.query("select public.member_suspend($1, 'سبب الإيقاف')", [ID.m2])), 'P0001'); // موقوف مسبقًا
      assert.equal(await outcome(db.query("select public.member_reactivate($1, '')", [ID.m2])), 'ok');
      assert.equal(await outcome(db.query("select public.member_suspend($1, 'سبب الإيقاف')", [ID.admin])), 'P0001'); // لا يوقف نفسه
    });
    await setStatus(ID.m2, 'قيد الموافقة');
    try {
      await asUser(ID.admin, async () => { assert.equal(await outcome(db.query("select public.member_suspend($1, 'سبب الإيقاف')", [ID.m2])), 'P0001'); });
    } finally { await setStatus(ID.m2, 'معتمد'); }
  });

  check('member_access_set: null committees keeps them; chair alias is normalised', async () => {
    const count = async () => (await db.query('select count(*)::int as c from public.committee_members where user_id = $1', [ID.m1])).rows[0].c;
    assert.equal(await count(), 1);
    await asUser(ID.admin, async () => {
      assert.equal(await outcome(db.query("select public.member_access_set($1, 'member', null, null)", [ID.m1])), 'ok');
    });
    assert.equal(await count(), 1);
    await asUser(ID.admin, async () => {
      assert.equal(await outcome(db.query("select public.member_access_set($1, 'member', $2::jsonb, null)", [ID.m1, JSON.stringify([{id: ID.c1, role: 'chair'}])])), 'ok');
    });
    const r = await db.query('select committee_role from public.committee_members where user_id = $1 and committee_id = $2', [ID.m1, ID.c1]);
    assert.equal(r.rows[0].committee_role, 'رئيس اللجنة');
  });

  check('047: only an admin can move a meeting to another committee', async () => {
    const c2 = '00000000-0000-4000-8000-0000000000c2';
    const m2 = '00000000-0000-4000-8000-0000000000d2';
    await db.query("insert into public.committees(id, name) values ($1, 'لجنة اختبار ثانية')", [c2]);
    await db.query("insert into public.meetings(id, title, committee_id, gregorian_date, start_time, created_by, status) values ($1, 'اجتماع منشئه عضو', $2, current_date, '10:00', $3, 'مجدول')", [m2, ID.c1, ID.m1]);
    // سياسات الإنتاج الأساسية المقابلة (تُنشأ هنا لأنها تستدعي دالة is_admin التي تأتي بترحيلاتنا)
    await db.exec(`drop policy if exists t_meetings_sel on public.meetings; create policy t_meetings_sel on public.meetings for select to authenticated using (true);
      drop policy if exists "meetings owner update" on public.meetings;
      create policy "meetings owner update" on public.meetings for update to authenticated using (public.is_admin() or created_by = auth.uid()) with check (public.is_admin() or created_by = auth.uid());`);
    await asUser(ID.m1, async () => {
      assert.equal(await outcome(db.query('update public.meetings set committee_id = $2 where id = $1', [m2, c2])), '42501'); // المنشئ لا ينقل
      assert.equal(await outcome(db.query('update public.meetings set committee_id = $2, title = $3 where id = $1', [m2, ID.c1, 'عنوان جديد'])), 'ok'); // نفس القيمة مع تعديل آخر
      assert.equal(await outcome(db.query('update public.meetings set title = $2 where id = $1', [m2, 'عنوان آخر'])), 'ok');
    });
    assert.equal((await db.query('select committee_id from public.meetings where id = $1', [m2])).rows[0].committee_id, ID.c1);
    await asUser(ID.admin, async () => {
      assert.equal(await outcome(db.query('update public.meetings set committee_id = $2 where id = $1', [m2, c2])), 'ok'); // المدير ينقل
    });
    assert.equal((await db.query('select committee_id from public.meetings where id = $1', [m2])).rows[0].committee_id, c2);
  });

  check('048: attendance quorum — warn by default; block mode enforces opening and casting a vote', async () => {
    const [cq, mq, v1, v2, v3, u3] = ['c3', 'd3', 'e3', 'e4', 'e5', 'a3'].map(s => '00000000-0000-4000-8000-0000000000' + s);
    await db.query("insert into public.committees(id, name) values ($1, 'لجنة النصاب')", [cq]);
    for (const u of [ID.admin, ID.m1, ID.m2]) await db.query('insert into public.committee_members(committee_id, user_id) values ($1, $2)', [cq, u]);
    await db.query("insert into public.meetings(id, title, committee_id, gregorian_date, start_time, created_by, status) values ($1, 'اجتماع النصاب', $2, current_date, '10:00', $3, 'مجدول')", [mq, cq, ID.admin]);
    await db.query("insert into public.meeting_attendees(meeting_id, user_id, attendance_status, source) values ($1, $2, 'حاضر', 'أمين السر')", [mq, ID.m1]);
    const quorum = uid => asUser(uid, async () => (await db.query('select public.meeting_quorum($1) as r', [mq])).rows[0].r);
    // فتح تصويت كمدير مع بقاء الدور superuser (RLS لا يهم هنا؛ المشغّل يرى auth.uid() = المدير)
    const openVote = async id => { await setClaims(ID.admin, 'authenticated'); try { return await outcome(db.query("insert into public.votes(id, meeting_id, question, vote_type, quorum_required, status, created_by) values ($1, $2, 'سؤال النصاب', 'علني', 1, 'مفتوح', $3)", [id, mq, ID.admin])); } finally { await setClaims('', ''); } };

    let r = await quorum(ID.m1);
    assert.deepEqual([r.eligible, r.present, r.required, r.met, r.mode], [3, 1, 2, false, 'warn']); // 50.01% من 3 = 2
    // وضع «تحذير»: لا منع
    assert.equal(await openVote(v1), 'ok');
    assert.equal(await openVote(v2), 'ok');
    await asUser(ID.m1, async () => { assert.equal(await outcome(db.query("select public.cast_vote($1, 'موافق', null)", [v1])), 'ok'); });
    // الإعدادات للمدير فقط
    await asUser(ID.m1, async () => {
      assert.equal(await outcome(db.query("select public.quorum_settings_set('block', 50.01, null)")), '42501');
      assert.equal(await outcome(db.query('select public.quorum_settings_get()')), '42501');
    });
    await asUser(ID.admin, async () => { assert.equal(await outcome(db.query("select public.quorum_settings_set('block', 50.01, null)")), 'ok'); });
    // وضع «منع»
    assert.equal(await openVote(v3), 'P0001'); // لا يُفتح تصويت والنصاب ناقص
    await asUser(ID.m1, async () => { assert.equal(await outcome(db.query("select public.cast_vote($1, 'موافق', null)", [v2])), 'P0001'); });
    await db.query("insert into public.meeting_attendees(meeting_id, user_id, attendance_status, source) values ($1, $2, 'عن بعد', 'أمين السر')", [mq, ID.m2]);
    r = await quorum(ID.m1);
    assert.deepEqual([r.present, r.required, r.met], [2, 2, true]);
    await asUser(ID.m1, async () => { assert.equal(await outcome(db.query("select public.cast_vote($1, 'موافق', null)", [v2])), 'ok'); });
    assert.equal(await openVote(v3), 'ok');
    // نسبة اللجنة 100%: يلزم حضور الثلاثة
    await asUser(ID.admin, async () => { assert.equal(await outcome(db.query("select public.quorum_settings_set('warn', 50.01, $1::jsonb)", [JSON.stringify([{id: cq, percent: 100}])])), 'ok'); });
    r = await quorum(ID.m1);
    assert.deepEqual([r.required, r.met, r.mode], [3, false, 'warn']);
    // الموقوف لا يُحتسب لا في المقام ولا في الحضور
    await setStatus(ID.m2, 'موقوف');
    try { r = await quorum(ID.m1); assert.deepEqual([r.eligible, r.present, r.required], [2, 1, 2]); } finally { await setStatus(ID.m2, 'معتمد'); }
    // نسبة اللجنة لا يغيّرها إلا المدير، وجدول الإعدادات لا يُكتب مباشرة
    const setPct = async uid => { await setClaims(uid, 'authenticated'); try { return await outcome(db.query('update public.committees set quorum_percent = 1 where id = $1', [cq])); } finally { await setClaims('', ''); } };
    assert.equal(await setPct(ID.m1), '42501');
    assert.equal(await setPct(ID.admin), 'ok');
    await asUser(ID.admin, async () => { assert.equal(await outcome(db.query("update public.quorum_settings set mode = 'off' where id = 1")), '42501'); });
    // من لا علاقة له بالاجتماع لا يرى الحالة
    await db.query('insert into auth.users(id, email) values ($1, $2)', [u3, 'u3@example.test']);
    await db.query("insert into public.profiles(id, full_name, role, role_code, is_active, approval_status) values ($1, 'غريب اختبار', 'member', 'member', true, 'معتمد')", [u3]);
    assert.equal(await quorum(u3), null);
  });

  check('049: approval rule — outcome only after close; bases and percentages; tie; rule frozen at opening; admin-only settings', async () => {
    const id = s => '00000000-0000-4000-8000-0000000000' + s;
    const [cr, mr, u4] = [id('c4'), id('d4'), id('a4')];
    const u3 = id('a3'); // أُنشئ في اختبار 048 السابق
    const vote = id => asUser(ID.m1, async () => (await db.query('select public.vote_outcome($1) as r', [id])).rows[0].r);
    const nid = n => '00000000-0000-4000-8000-0000000' + (0x10000 + n).toString(16); // معرّف فريد لكل تصويت في الحلقات
    const mk = async (vid, a, r, ab, secret, base, pct) => {
      await db.query("insert into public.votes(id, meeting_id, question, vote_type, quorum_required, status, created_by, approval_base, approval_percent) values ($1, $2, 'قاعدة الإقرار', $3, 1, 'مفتوح', $4, $5, $6)", [vid, mr, secret ? 'سري' : 'علني', ID.admin, base || null, pct || null]);
      for (const [n, c] of [[a, 'موافق'], [r, 'غير موافق'], [ab, 'ممتنع']]) for (let i = 0; i < n; i++) await db.query('insert into public.vote_ballots(vote_id, choice, user_id) values ($1, $2, null)', [vid, c]);
    };
    // الإغلاق كما تفعل close_vote: الحالة + النتيجة (فيها عدد الحاضرين) عبر app.rpc
    const close = async (vid, result) => { await db.query("select set_config('app.rpc', 'on', false)"); await db.query("update public.votes set status = 'مغلق', closed_at = now(), result = $2::jsonb where id = $1", [vid, result ? JSON.stringify(result) : null]); await db.query("select set_config('app.rpc', '', false)"); };

    await db.query("insert into public.committees(id, name) values ($1, 'لجنة الإقرار')", [cr]);
    for (const u of [ID.admin, ID.m1, ID.m2, u3]) await db.query('insert into public.committee_members(committee_id, user_id) values ($1, $2)', [cr, u]);
    await db.query("insert into public.meetings(id, title, committee_id, gregorian_date, start_time, created_by, status) values ($1, 'اجتماع الإقرار', $2, current_date, '10:00', $3, 'مجدول')", [mr, cr, ID.admin]);
    for (const u of [ID.admin, ID.m1, ID.m2, u3]) await db.query("insert into public.meeting_attendees(meeting_id, user_id, attendance_status, source) values ($1, $2, 'حاضر', 'أمين السر') on conflict (meeting_id, user_id) do update set attendance_status = 'حاضر'", [mr, u]);

    // موافق 3، غير موافق 1، ممتنع 1 | 4 أعضاء | 4 حاضرون
    const v1 = id('f1'); await mk(v1, 3, 1, 1, false);
    assert.equal(await vote(v1), null); // مفتوح: لا نتيجة
    await close(v1);
    assert.equal((await vote(v1)).passed, true); // القاعدة الافتراضية المثبَّتة (cast 50.01)
    const cases = [['cast', 50.01, true], ['cast', 75, true], ['cast', 76, false], ['voters', 50.01, true], ['voters', 61, false], ['present', 66.66, true], ['present', 80, false], ['members', 50.01, true], ['members', 80, false]];
    const ids = {};
    let k = 0;
    for (const [b, p, want] of cases) {
      const cv = nid(++k); ids[b + p] = cv;
      await mk(cv, 3, 1, 1, false, b, p); await close(cv);
      const o = await vote(cv);
      assert.equal(o.passed, want, b + ' ' + p + ' -> ' + JSON.stringify(o));
    }
    // أقفال التكامل: لا تُغيَّر قاعدة تصويت مغلق مباشرةً (حتى مع app.rpc)
    assert.equal(await outcome(db.query('update public.votes set approval_percent = 1 where id = $1', [ids['cast76']])), 'P0001');
    await db.query("select set_config('app.rpc', 'on', false)");
    assert.equal(await outcome(db.query('update public.votes set approval_percent = 1 where id = $1', [ids['cast76']])), 'P0001');
    await db.query("select set_config('app.rpc', '', false)");
    assert.equal((await vote(ids['cast76'])).passed, false);
    // عدد أعضاء اللجنة يُثبَّت عند الإغلاق: حذف عضو لاحقًا لا يقلب نتيجة مغلقة
    const frozen = ids['members50.01'];
    assert.equal((await vote(frozen)).base_count, 4);
    await db.query('delete from public.committee_members where committee_id = $1 and user_id = $2', [cr, u3]);
    assert.equal((await vote(frozen)).base_count, 4);
    await db.query('insert into public.committee_members(committee_id, user_id) values ($1, $2)', [cr, u3]);
    // الحاضرون يؤخذون مما حفظه الإغلاق (result.present) لا من الحضور الحالي
    const pv = nid(++k); await mk(pv, 3, 1, 0, false, 'present', 50.01); await close(pv, {present: 4});
    await db.query("update public.meeting_attendees set attendance_status = 'غائب' where meeting_id = $1 and user_id = $2", [mr, u3]);
    assert.equal((await vote(pv)).base_count, 4);
    await db.query("update public.meeting_attendees set attendance_status = 'حاضر' where meeting_id = $1 and user_id = $2", [mr, u3]);
    // التعادل لا يُقَرّ
    const v2 = id('f2'); await mk(v2, 2, 2, 0, false); await close(v2);
    let o = await vote(v2); assert.deepEqual([o.passed, o.tied], [false, true]);
    // السري المفتوح لا نتيجة له
    const v3 = id('f3'); await mk(v3, 1, 0, 0, true); assert.equal(await vote(v3), null);
    // القاعدة تُثبَّت عند فتح التصويت ولا تتبع تعديل الإعدادات لاحقًا
    await asUser(ID.admin, async () => {
      assert.equal(await outcome(db.query("select public.approval_settings_set('cast', 50.01, $1::jsonb)", [JSON.stringify([{id: cr, base: 'members', percent: 90}])])), 'ok');
    });
    const v4 = id('f4'); await mk(v4, 1, 0, 0, false);
    let row = (await db.query('select approval_base, approval_percent from public.votes where id = $1', [v4])).rows[0];
    assert.deepEqual([row.approval_base, Number(row.approval_percent)], ['members', 90]);
    await asUser(ID.admin, async () => { await db.query("select public.approval_settings_set('cast', 50.01, $1::jsonb)", [JSON.stringify([{id: cr, base: null, percent: null}])]); });
    row = (await db.query('select approval_base, approval_percent from public.votes where id = $1', [v4])).rows[0];
    assert.deepEqual([row.approval_base, Number(row.approval_percent)], ['members', 90]);
    // قاعدة تصويت مفتوح يعدّلها المدير فقط، وبعد الإغلاق تُقفل
    await asUser(ID.m1, async () => { assert.equal(await outcome(db.query("select public.vote_set_approval_rule($1, 'cast', 60)", [v4])), '42501'); });
    await asUser(ID.admin, async () => {
      assert.equal(await outcome(db.query("select public.vote_set_approval_rule($1, 'cast', 60)", [v4])), 'ok');
      assert.equal(await outcome(db.query("select public.vote_set_approval_rule($1, 'cast', 60)", [v2])), 'P0001'); // مغلق
    });
    // بعد وصول أي صوت لا تُعدَّل قاعدة التصويت المفتوح
    await db.query('insert into public.vote_participation(vote_id, user_id) values ($1, $2)', [v4, ID.admin]);
    await asUser(ID.admin, async () => { assert.equal(await outcome(db.query("select public.vote_set_approval_rule($1, 'cast', 70)", [v4])), 'P0001'); });
    // غير المدير لا يختار قاعدة عند فتح التصويت
    await setClaims(ID.m1, 'authenticated');
    try {
      const v5 = nid(++k);
      await db.query("insert into public.votes(id, meeting_id, question, vote_type, quorum_required, status, created_by, approval_base, approval_percent) values ($1, $2, 'س', 'علني', 1, 'مفتوح', $3, 'cast', 1)", [v5, mr, ID.m1]);
      const rr = (await db.query('select approval_base, approval_percent from public.votes where id = $1', [v5])).rows[0];
      assert.notEqual(Number(rr.approval_percent), 1);
    } finally { await setClaims('', ''); }
    // الإعدادات للمدير فقط، ولا يغيّر العضو قاعدة اللجنة مباشرة
    await asUser(ID.m1, async () => {
      assert.equal(await outcome(db.query("select public.approval_settings_set('cast', 50.01, null)")), '42501');
      assert.equal(await outcome(db.query('select public.approval_settings_get()')), '42501');
    });
    await setClaims(ID.m1, 'authenticated');
    try { assert.equal(await outcome(db.query("update public.committees set approval_percent = 1 where id = $1", [cr])), '42501'); } finally { await setClaims('', ''); }
    // من لا علاقة له بالاجتماع لا يرى النتيجة
    await db.query('insert into auth.users(id, email) values ($1, $2)', [u4, 'u4@example.test']);
    await db.query("insert into public.profiles(id, full_name, role, role_code, is_active, approval_status) values ($1, 'غريب ثان', 'member', 'member', true, 'معتمد')", [u4]);
    assert.equal(await asUser(u4, async () => (await db.query('select public.vote_outcome($1) as r', [v1])).rows[0].r), null);
  });
  check('050: meeting media — visible to participants only, writable by admin/creator, single live item, limits', async () => {
    const id = s => '00000000-0000-4000-8000-0000000000' + s;
    const [cmm, mmx, u4, ma, mb] = [id('c5'), id('d5'), id('a4'), id('01'), id('02')]; // u4: غريب أُنشئ في اختبار 049
    await db.query("insert into public.committees(id, name) values ($1, 'لجنة العرض')", [cmm]);
    await db.query('insert into public.committee_members(committee_id, user_id) values ($1, $2)', [cmm, ID.m1]);
    await db.query("insert into public.meetings(id, title, committee_id, gregorian_date, start_time, created_by, status) values ($1, 'اجتماع العرض', $2, current_date, '10:00', $3, 'مجدول')", [mmx, cmm, ID.m2]);
    // سياسة قراءة الاجتماعات كما في الإنتاج (بدل سياسة الاختبار المفتوحة)
    await db.exec(`drop policy if exists t_meetings_sel on public.meetings; drop policy if exists "meetings participants read" on public.meetings;
      create policy "meetings participants read" on public.meetings for select to authenticated using (public.is_admin() or created_by = auth.uid()
        or exists (select 1 from public.meeting_attendees ma where ma.meeting_id = meetings.id and ma.user_id = auth.uid())
        or exists (select 1 from public.committee_members cm where cm.committee_id = meetings.committee_id and cm.user_id = auth.uid()));
      alter table public.meetings enable row level security;`);
    const ins = (uid, title, url) => asUser(uid, () => outcome(db.query('insert into public.meeting_media(meeting_id, title, url) values ($1, $2, $3)', [mmx, title, url])));
    const count = uid => asUser(uid, async () => (await db.query('select count(*)::int as c from public.meeting_media where meeting_id = $1', [mmx])).rows[0].c);

    assert.equal(await ins(ID.m2, 'عرض المجلس', 'https://www.canva.com/design/DAFabc123XYZ/aBcDeF123456/view'), 'ok'); // المنشئ
    assert.equal(await ins(ID.m1, 'محاولة عضو', 'https://youtu.be/dQw4w9WgXcQ'), '42501');                            // عضو لجنة ليس منشئًا
    assert.equal(await ins(u4, 'محاولة غريب', 'https://youtu.be/dQw4w9WgXcQ'), '42501');
    assert.equal(await ins(ID.admin, 'فيديو المدير', 'https://youtu.be/dQw4w9WgXcQ'), 'ok');                           // المدير
    assert.equal(await count(ID.m1), 2);   // عضو اللجنة يرى
    assert.equal(await count(ID.m2), 2);
    assert.equal(await count(u4), 0);      // الغريب لا يرى
    // قيود البيانات
    assert.equal(await ins(ID.m2, 'رابط غير آمن', 'http://example.org/a.mp4'), '23514');
    assert.equal(await ins(ID.m2, 'رابط جافاسكربت', 'javascript:alert(1)'), '23514');
    assert.equal(await ins(ID.m2, '   ', 'https://example.org/a'), '23514');
    // المجهول لا يصل
    await asAnon(async () => { assert.equal(await outcome(db.query('select * from public.meeting_media')), '42501'); });
    // «يُعرض الآن»: واحد للاجتماع، والتحكم للمدير/المنشئ فقط
    await db.query('insert into public.meeting_media(id, meeting_id, title, url, created_by) values ($1, $3, $4, $5, $6), ($2, $3, $7, $8, $6)', [ma, mb, mmx, 'أ', 'https://example.org/a', ID.m2, 'ب', 'https://example.org/b']);
    await asUser(ID.m1, async () => { assert.equal(await outcome(db.query('select public.media_set_live($1, true)', [ma])), '42501'); });
    await asUser(ID.m2, async () => {
      assert.equal(await outcome(db.query('select public.media_set_live($1, true)', [ma])), 'ok');
      assert.equal(await outcome(db.query('select public.media_set_live($1, true)', [mb])), 'ok');
    });
    const live = (await db.query('select id from public.meeting_media where meeting_id = $1 and is_live', [mmx])).rows.map(r => r.id);
    assert.deepEqual(live, [mb]);
    await asUser(ID.admin, async () => { assert.equal(await outcome(db.query('select public.media_set_live($1, false)', [mb])), 'ok'); });
    assert.equal((await db.query('select count(*)::int as c from public.meeting_media where meeting_id = $1 and is_live', [mmx])).rows[0].c, 0);
    // لا كتابة مباشرة في أعمدة العرض/المنشئ، ولا نقل عنصر إلى اجتماع آخر، ولا عنصرين معروضين
    await asUser(ID.m2, async () => {
      assert.equal(await outcome(db.query('update public.meeting_media set is_live = true where id = $1', [ma])), '42501');
      assert.equal(await outcome(db.query('update public.meeting_media set meeting_id = $2 where id = $1', [ma, mmx])), '42501');
      assert.equal(await outcome(db.query("insert into public.meeting_media(meeting_id, title, url, created_by) values ($1, 'س', 'https://example.org/z', $2)", [mmx, ID.admin])), '42501');
      assert.equal(await outcome(db.query('update public.meeting_media set title = $2 where id = $1', [ma, 'عنوان معدّل'])), 'ok');
    });
    await db.query('update public.meeting_media set is_live = true where id = $1', [ma]);
    assert.equal(await outcome(db.query('update public.meeting_media set is_live = true where id = $1', [mb])), '23505');   // فهرس العنصر الواحد
    await db.query('update public.meeting_media set is_live = false where id = $1', [ma]);
    // المنشئ يُسجَّل من الجلسة لا من المدخل
    await asUser(ID.m2, async () => { await db.query("insert into public.meeting_media(meeting_id, title, url) values ($1, 'منشئ تلقائي', 'https://example.org/c')", [mmx]); });
    assert.equal((await db.query("select created_by from public.meeting_media where title = 'منشئ تلقائي'")).rows[0].created_by, ID.m2);
    // حد أقصى 40 عنصرًا
    const have = (await db.query('select count(*)::int as c from public.meeting_media where meeting_id = $1', [mmx])).rows[0].c;
    for (let i = have; i < 40; i++) await db.query("insert into public.meeting_media(meeting_id, title, url) values ($1, 'عنصر', 'https://example.org/x')", [mmx]);
    assert.equal(await ins(ID.admin, 'الحادي والأربعون', 'https://example.org/last'), 'P0001');
  });
});
