const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs');
const ids={owner:'00000000-0000-0000-0000-000000000001',member:'00000000-0000-0000-0000-000000000002',stranger:'00000000-0000-0000-0000-000000000003',meeting:'00000000-0000-0000-0000-000000000010'};
test('SQL security boundaries under real PostgreSQL RLS in an isolated fixture',async t=>{
 const db=new PGlite();
 try {
 await db.exec(`create role authenticated; create role anon; create schema auth; create schema storage;
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth,storage to authenticated;
 create table profiles(id uuid primary key,role text,role_code text,is_active boolean,full_name text);
 create table meetings(id uuid primary key,committee_id uuid,created_by uuid,title text);
 create table committee_members(committee_id uuid,user_id uuid);
 create table meeting_attendees(meeting_id uuid,user_id uuid);
 create table attachments(id uuid,meeting_id uuid,uploaded_by uuid,storage_path text);
 create table minutes(id uuid,meeting_id uuid);
 create table signatures(minute_id uuid,signature_path text);
 create table storage.objects(bucket_id text,name text);
 insert into profiles values('${ids.owner}','secretary','secretary',true,'Owner'),('${ids.member}','member','member',true,'Member'),('${ids.stranger}','member','member',true,'Other');
 insert into meetings values('${ids.meeting}',null,'${ids.owner}','Private meeting');
 insert into meeting_attendees values('${ids.meeting}','${ids.member}');
 insert into attachments values(null,'${ids.meeting}','${ids.owner}','${ids.meeting}/report.pdf');
 insert into storage.objects values('meeting-files','${ids.meeting}/report.pdf');
 grant select,insert,update,delete on all tables in schema public,storage to authenticated;
 `);
 for(const table of ['profiles','meetings','committee_members','attachments','storage.objects']) await db.exec(`alter table ${table} enable row level security; create policy baseline on ${table} for all to authenticated using(true) with check(true);`);
 await db.exec(fs.readFileSync('database/proposals/access-hardening.sql','utf8'));
 const login=async id=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');};
 await t.test('member reads own meeting and file',async()=>{await login(ids.member);assert.equal((await db.query('select * from meetings')).rows.length,1);assert.equal((await db.query('select * from storage.objects')).rows.length,1);});
 await t.test('other account cannot read meeting or file despite permissive baseline',async()=>{await login(ids.stranger);assert.equal((await db.query('select * from meetings')).rows.length,0);assert.equal((await db.query('select * from storage.objects')).rows.length,0);});
 await t.test('member cannot promote self or deactivate others',async()=>{await login(ids.member);await assert.rejects(db.exec(`update profiles set role='admin' where id='${ids.member}'`),/Authorization/);assert.equal((await db.query(`update profiles set is_active=false where id='${ids.owner}' returning *`)).rows.length,0);});
 await t.test('member cannot create meeting or upload into its folder',async()=>{await assert.rejects(db.exec(`insert into meetings values('00000000-0000-0000-0000-000000000011',null,'${ids.member}','No')`),/row-level security/);await assert.rejects(db.exec(`insert into storage.objects values('meeting-files','${ids.meeting}/attack.pdf')`),/row-level security/);});
 await t.test('secretary can upload new version but cannot replace or delete existing object',async()=>{await login(ids.owner);await db.exec(`insert into storage.objects values('meeting-files','${ids.meeting}/new.pdf')`);assert.equal((await db.query(`update storage.objects set name='changed' returning *`)).rows.length,0);assert.equal((await db.query('delete from storage.objects returning *')).rows.length,0);});
 await t.test('meeting security scope is immutable',async()=>{await assert.rejects(db.exec(`update meetings set created_by='${ids.member}'`),/scope/);});
 await t.test('disabled account loses access immediately',async()=>{await db.exec('reset role');await db.exec(`update profiles set is_active=false where id='${ids.member}'`);await login(ids.member);assert.equal((await db.query('select * from meetings')).rows.length,0);assert.equal((await db.query('select * from storage.objects')).rows.length,0);});
 } finally {await db.close();}
});
