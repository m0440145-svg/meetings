const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
test('meeting lifecycle, central data and physical restore in isolated PostgreSQL',async t=>{
 let db=new PGlite();let restored;
 const q=(sql,args=[])=>db.query(sql,args);
 const login=async n=>{await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[uid(n)]);await db.exec('set role authenticated');};
 let mid,vid,minute,poll;
 try{
 await db.exec(fs.readFileSync('tests/fixtures/lifecycle.sql','utf8'));
 await db.exec(fs.readFileSync(require('../tools/assemble-migration.cjs').target(),'utf8')); // Test the exact deployment artifact in one transaction.
 await login(1);
 await t.test('new meeting requires explicit quorum',async()=>{
  await assert.rejects(q("insert into meetings(title,created_by) values('Test',$1)",[uid(1)]),/Quorum/);
  mid=(await q("insert into meetings(title,created_by,quorum_percent) values('Test',$1,60) returning id",[uid(1)])).rows[0].id;
 });
 await t.test('no start or vote before quorum',async()=>{
  await assert.rejects(q("select transition_meeting($1,'منعقد')",[mid]),/Quorum/);
  await assert.rejects(q("select open_meeting_vote($1,'Decision',true)",[mid]),/Quorum/);
  await q('select prepare_meeting_roster($1,$2)',[mid,[uid(1),uid(2),uid(3)]]);
  await q("select record_meeting_attendance($1,$2,'حاضر')",[mid,uid(1)]);
  const result=(await q('select meeting_quorum($1) as q',[mid])).rows[0].q;assert.equal(result.required,2);assert.equal(result.complete,false);
  await q("select record_meeting_attendance($1,$2,'حاضر')",[mid,uid(2)]);
  await q("select transition_meeting($1,'منعقد')",[mid]);
 });
 await t.test('roster and quorum freeze on start; direct vote bypass blocked',async()=>{
  await assert.rejects(q('select prepare_meeting_roster($1,$2)',[mid,[uid(1)]]),/frozen/);
  await assert.rejects(q('update meetings set quorum_percent=1 where id=$1',[mid]),/frozen/);
  await assert.rejects(q("insert into votes(meeting_id,question,status) values($1,'Bypass','مفتوح')",[mid]),/row-level security/);
  vid=(await q("select open_meeting_vote($1,'Approve decision',true) as id",[mid])).rows[0].id;
 });
 await t.test('loss of quorum rejects ballot without leaving a receipt',async()=>{
  await login(1);await q("select record_meeting_attendance($1,$2,'غائب')",[mid,uid(2)]);
  await assert.rejects(q("select cast_meeting_vote($1,'موافق')",[vid]),/quorum incomplete/);
  await db.exec('reset role');assert.equal((await q('select count(*)::int n from meeting_private.ballot_receipts')).rows[0].n,0);
  await login(1);await q("select record_meeting_attendance($1,$2,'حاضر')",[mid,uid(2)]);
 });
 await t.test('invalid choices and partial poll failures roll back atomically',async()=>{
  await assert.rejects(q('select cast_meeting_vote($1,$2)',[vid,'invalid']),/Invalid choice/);
  await assert.rejects(q("select create_meeting_poll($1,'Partial failure',$2)",[mid,['2026-11-01T09:00:00Z',null]]),/null value/);
  assert.equal((await q('select count(*)::int n from schedule_polls')).rows[0].n,0);
  await db.exec('reset role');assert.equal((await q('select count(*)::int n from meeting_private.ballots')).rows[0].n,0);
  assert.equal((await q('select count(*)::int n from meeting_private.ballot_receipts')).rows[0].n,0);
  await login(1);
 });
 await t.test('eligible member casts once; outsiders and direct writes denied',async()=>{
  await login(2);await q("select cast_meeting_vote($1,'موافق')",[vid]);
  await assert.rejects(q("select cast_meeting_vote($1,'ممتنع')",[vid]),/duplicate key/);
  await assert.rejects(q("insert into vote_responses values($1,$2,'موافق',now())",[vid,uid(2)]),/row-level security/);
  await login(5);await assert.rejects(q("select cast_meeting_vote($1,'موافق')",[vid]),/Access denied/);
 });
 await t.test('close vote, accurate tally and immutable ballot',async()=>{
  await login(1);await q("select cast_meeting_vote($1,'ممتنع')",[vid]);await q('select close_meeting_vote($1)',[vid]);
  await assert.rejects(q("select cast_meeting_vote($1,'موافق')",[vid]),/closed/);
  assert.deepEqual((await q('select meeting_vote_results($1) as r',[vid])).rows[0].r,{yes:1,no:0,abstain:1,total:2});
  await assert.rejects(q('select * from meeting_private.ballots'),/permission denied/);
  await login(4);await assert.rejects(q('select cast_meeting_vote($1,$2)',[vid,'موافق']),/Access denied/);
  await login(1);
  await db.exec('reset role');assert.equal((await q('select count(*)::int n from meeting_private.ballots where user_id is not null')).rows[0].n,0);
  await login(1);
 });
 await t.test('central transcript, board, schedule poll and circular persist',async()=>{
  await q("insert into transcripts(meeting_id,content,created_by) values($1,'Permanent transcript',$2)",[mid,uid(1)]);
  await q("insert into whiteboards(meeting_id,content,updated_by) values($1,'Permanent board',$2)",[mid,uid(1)]);
  poll=(await q("select create_meeting_poll($1,'Schedule',$2) as id",[mid,['2026-11-01T09:00:00Z','2026-11-02T09:00:00Z']])).rows[0].id;
  await q("insert into circular_decisions(meeting_id,title,description,created_by) values($1,'Follow-up','Decision text',$2)",[mid,uid(1)]);
  await login(2);assert.equal((await q('select * from transcripts')).rows.length,1);
  const oid=(await q('select id from schedule_poll_options where poll_id=$1',[poll])).rows[0].id;
  await q('insert into schedule_poll_responses(option_id,user_id) values($1,$2)',[oid,uid(2)]);
  await assert.rejects(q('insert into schedule_poll_responses(option_id,user_id) values($1,$2)',[oid,uid(2)]),/duplicate key/);
  await login(5);assert.equal((await q('select * from transcripts')).rows.length,0);assert.equal((await q('select * from schedule_poll_options')).rows.length,0);
 });
 await t.test('minutes require meeting completion and chairman approval then lock',async()=>{
  await login(1);minute=(await q("insert into minutes(meeting_id,content,created_by) values($1,'Final text',$2) returning id",[mid,uid(1)])).rows[0].id;
  await assert.rejects(q("select transition_meeting_minute($1,'معروض للاعتماد')",[minute]),/Complete meeting/);
  await q("select transition_meeting($1,'مكتمل')",[mid]);
  await q("select transition_meeting_minute($1,'معروض للاعتماد')",[minute]);
  await assert.rejects(q("update minutes set content='tamper' where id=$1",[minute]),/locked/);
  await assert.rejects(q("select transition_meeting_minute($1,'معتمد داخليًا')",[minute]),/Invalid minute/);
  await login(3);await q("select transition_meeting_minute($1,'معتمد داخليًا')",[minute]);
  const m=(await q('select * from minutes where id=$1',[minute])).rows[0];assert.equal(m.approved_by,uid(3));assert.equal(m.sealed_hash.length,64);
  await assert.rejects(q("select transition_meeting_minute($1,'موقّع')",[minute]),/official signature/);
  await assert.rejects(q('delete from minutes where id=$1',[minute]),/retained/);
 });
 await t.test('server audit is append-only to application users',async()=>{
  assert.ok((await q('select * from meeting_events')).rows.length>=10);
  await assert.rejects(q("insert into meeting_events(action,previous_hash,event_hash) values('fake','a','b')"),/permission denied/);
  await assert.rejects(q("update meeting_events set action='fake'"),/permission denied/);
 });
 await t.test('physical backup restores records, seals, audit chain and RLS in another database',async()=>{
  await db.exec('reset role');const before=(await q('select * from meeting_events order by id')).rows;
  const backup=await db.dumpDataDir();assert.ok(backup.size>0);
  restored=new PGlite({loadDataDir:backup});
  const after=(await restored.query('select * from meeting_events order by id')).rows;assert.deepEqual(after,before);
  const verifySQL=`select count(*)::int as bad from (select *,lag(event_hash,1,'GENESIS') over(order by id) expected_previous from meeting_events) e where previous_hash<>expected_previous or event_hash<>encode(sha256(convert_to(jsonb_build_array(previous_hash,meeting_id,actor_id,action,entity_id,happened_at,details)::text,'UTF8')),'hex')`;
  assert.equal((await restored.query(verifySQL)).rows[0].bad,0);
  await restored.exec("update meeting_events set action='tampered' where id=(select min(id) from meeting_events)");
  assert.ok((await restored.query(verifySQL)).rows[0].bad>0);
  await restored.query('update meeting_events set action=$1 where id=$2',[before[0].action,before[0].id]);
  for(const table of ['meetings','minutes','transcripts','whiteboards','schedule_polls','schedule_poll_responses','circular_decisions','meeting_private.ballots','meeting_private.ballot_receipts'])assert.deepEqual((await restored.query(`select * from ${table}`)).rows,(await q(`select * from ${table}`)).rows);
  await restored.query("select set_config('request.jwt.claim.sub',$1,false)",[uid(5)]);await restored.exec('set role authenticated');
  assert.equal((await restored.query('select * from meetings')).rows.length,0);
  await assert.rejects(restored.query('select cast_meeting_vote($1,$2)',[vid,'موافق']),/Access denied/);
 });
 }finally{await db.close();if(restored)await restored.close()}
});
