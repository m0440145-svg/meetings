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
    db = new PGlite();
    await db.waitReady;
    await db.exec(text('tests/prelude.sql'));
    await db.exec("do $$ begin create role authenticator nologin; exception when duplicate_object then null; end $$;");
    for (const f of migrations) {
      try { await db.exec(text('supabase/migrations/' + f)); }
      catch (e) { assert.fail('migration ' + f + ' failed on a clean database: ' + e.message); }
    }
    // بيانات تجريبية
    for (const [id, name, role] of [[ID.admin, 'مدير اختبار', 'admin'], [ID.m1, 'عضو اختبار أول', 'member'], [ID.m2, 'عضو اختبار ثان', 'member']]) {
      await db.query('insert into auth.users(id, email) values ($1, $2)', [id, name.length + '@example.test']);
      await db.query("insert into public.profiles(id, full_name, role, role_code, is_active, approval_status) values ($1, $2, $3, $3, true, 'معتمد')", [id, name, role]);
    }
    await db.query("insert into public.committees(id, name) values ($1, 'لجنة اختبار')", [ID.c1]);
    await db.query("insert into public.committee_members(committee_id, user_id) values ($1, $2)", [ID.c1, ID.m1]);
    await db.query("insert into public.meetings(id, title, committee_id, gregorian_date, start_time, end_time, created_by, status) values ($1, 'اجتماع اختبار', $2, current_date, '10:00', '11:00', $3, 'مجدول')", [ID.mt, ID.c1, ID.admin]);
    await db.query("insert into public.votes(id, meeting_id, question, vote_type, quorum_required, status, created_by) values ($1, $2, 'سؤال اختبار', 'علني', 1, 'مفتوح', $3)", [ID.vt, ID.mt, ID.admin]);
  });
  after(async () => { await db?.close(); });

  it('approval gate: no public table is missing the approved_only policy', async () => {
    const r = await db.query('select * from public.approval_gate_missing()');
    assert.deepEqual(r.rows, [], 'tables without the approval gate: ' + JSON.stringify(r.rows));
  });

  it('a member cannot edit sensitive profile columns but can edit their own contact data', async () => {
    await asUser(ID.m1, async () => {
      assert.equal(await outcome(db.query('update public.profiles set is_manual = true where id = $1', [ID.m1])), '42501');
      assert.equal(await outcome(db.query("update public.profiles set email = 'x@y.zz' where id = $1", [ID.m1])), '42501');
      assert.equal(await outcome(db.query("update public.profiles set role_code = 'admin' where id = $1", [ID.m1])), '42501');
      assert.equal(await outcome(db.query("update public.profiles set approval_status = 'معتمد' where id = $1", [ID.m1])), '42501');
      assert.equal(await outcome(db.query("update public.profiles set phone = '0555555555' where id = $1", [ID.m1])), 'ok');
      assert.equal(await outcome(db.query('update public.profiles set full_name = full_name where id = $1', [ID.m1])), 'ok');
    });
  });

  it('a suspended account is rejected by SECURITY DEFINER RPCs', async () => {
    await setStatus(ID.m1, 'موقوف');
    try {
      await asUser(ID.m1, async () => {
        assert.equal(await outcome(db.query("select public.cast_vote($1, 'موافق', null)", [ID.vt])), '42501');
        assert.equal(await outcome(db.query("select public.attendance_self($1, 'حاضر')", [ID.mt])), '42501');
      });
    } finally { await setStatus(ID.m1, 'معتمد'); }
  });

  it('api_gate: unapproved accounts reach only is_approved and GET profiles; approved and anonymous pass', async () => {
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

  it('is_admin requires an approved account', async () => {
    await asUser(ID.admin, async () => { assert.equal((await db.query('select public.is_admin() as r')).rows[0].r, true); });
    await setStatus(ID.admin, 'موقوف');
    try {
      await asUser(ID.admin, async () => { assert.equal((await db.query('select public.is_admin() as r')).rows[0].r, false); });
    } finally { await setStatus(ID.admin, 'معتمد'); }
  });

  it('attendance and voting flow: window across midnight, presence required, one vote, abstain needs a reason', async () => {
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

  it('member_suspend / member_reactivate rules', async () => {
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

  it('member_access_set: null committees keeps them; chair alias is normalised', async () => {
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
});
