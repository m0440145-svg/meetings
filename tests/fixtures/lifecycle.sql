-- Synthetic schema/identities for isolated tests. Never a production seed.
create role authenticated;create role anon;create schema auth;create schema storage;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth,storage to authenticated;
create table profiles(id uuid primary key,role text,role_code text,is_active boolean,full_name text);
create table meetings(id uuid primary key default gen_random_uuid(),committee_id uuid,created_by uuid,title text,status text default 'مجدول');
create table committee_members(committee_id uuid,user_id uuid,primary key(committee_id,user_id));
create table meeting_attendees(meeting_id uuid references meetings(id),user_id uuid references profiles(id),attendance_status text default 'مدعو',attended_at timestamptz,primary key(meeting_id,user_id));
create table attachments(id uuid default gen_random_uuid(),meeting_id uuid,uploaded_by uuid,storage_path text);
create table minutes(id uuid primary key default gen_random_uuid(),meeting_id uuid unique references meetings(id),content text,recommendations text,improvement_opportunities text,status text default 'مسودة',created_by uuid);
create table signatures(minute_id uuid references minutes(id),signature_path text);
create table storage.objects(bucket_id text,name text);
create table votes(id uuid primary key default gen_random_uuid(),meeting_id uuid references meetings(id),question text,vote_type text,quorum_required integer,status text,created_by uuid);
create table vote_responses(vote_id uuid,user_id uuid,choice text,voted_at timestamptz,primary key(vote_id,user_id));
create table transcripts(id uuid primary key default gen_random_uuid(),meeting_id uuid references meetings(id),content text,created_by uuid,created_at timestamptz default now(),updated_at timestamptz default now());
create table whiteboards(id uuid primary key default gen_random_uuid(),meeting_id uuid references meetings(id),content text,updated_by uuid,updated_at timestamptz default now());
create table schedule_polls(id uuid primary key default gen_random_uuid(),title text,committee_id uuid,status text default 'مفتوح',created_by uuid,created_at timestamptz default now());
create table schedule_poll_options(id uuid primary key default gen_random_uuid(),poll_id uuid references schedule_polls(id),option_time timestamptz not null);
create table schedule_poll_responses(option_id uuid references schedule_poll_options(id),user_id uuid,preference text default 'مناسب',created_at timestamptz default now(),primary key(option_id,user_id));
create table circular_decisions(id uuid primary key default gen_random_uuid(),title text,description text,committee_id uuid,status text default 'مفتوح',created_by uuid,created_at timestamptz default now());
create table circular_responses(circular_id uuid references circular_decisions(id),user_id uuid,choice text,comment text,responded_at timestamptz default now(),primary key(circular_id,user_id));
create table app_settings(key text primary key,value jsonb,updated_by uuid,updated_at timestamptz);
grant select,insert,update,delete on all tables in schema public,storage to authenticated;
do $$declare t record;begin for t in select schemaname,tablename from pg_tables where schemaname in ('public','storage') loop
execute format('alter table %I.%I enable row level security',t.schemaname,t.tablename);
execute format('create policy baseline on %I.%I for all to authenticated using(true) with check(true)',t.schemaname,t.tablename);
end loop;end$$;
insert into profiles values
('00000000-0000-0000-0000-000000000001','secretary','secretary',true,'Test Secretary'),
('00000000-0000-0000-0000-000000000002','member','member',true,'Test Member'),
('00000000-0000-0000-0000-000000000003','board_chair','board_chair',true,'Test Chair'),
('00000000-0000-0000-0000-000000000004','viewer','viewer',true,'Test Observer'),
('00000000-0000-0000-0000-000000000005','member','member',true,'Outside Member');
