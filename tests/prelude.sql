-- محاكاة بيئة Supabase مع جداول المنصة الافتراضية (حسب افتراضات الترحيلات) لاختبار SQL على Postgres حقيقي (PGlite).
-- هذه افتراضات مني عن المخطط، فالاختبار يثبت صحة منطقي أنا لا تطابق قاعدة بياناتك الفعلية.
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;

do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
grant usage on schema public, auth, storage to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create table auth.users (id uuid primary key default gen_random_uuid(), email text);
grant select on auth.users to service_role;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;

create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.buckets, storage.objects to authenticated, anon, service_role;
create publication supabase_realtime;

create table public.profiles (id uuid primary key references auth.users(id), full_name text, phone text, role text, role_code text, is_active boolean default true, job_title text, created_at timestamptz default now());
create table public.committees (id uuid primary key default gen_random_uuid(), name text not null, description text, type text);
create table public.committee_members (committee_id uuid references public.committees(id) on delete cascade, user_id uuid references public.profiles(id) on delete cascade, primary key (committee_id, user_id));
create table public.meetings (id uuid primary key default gen_random_uuid(), title text, committee_id uuid references public.committees(id), gregorian_date date, hijri_date text, start_time time, end_time time, mode text, location text, platform text, meeting_url text, description text, status text default 'مجدول', created_by uuid, created_at timestamptz default now());
create table public.agenda_items (id uuid primary key default gen_random_uuid(), meeting_id uuid references public.meetings(id) on delete cascade, item_order int, title text, duration_minutes int);
create table public.meeting_attendees (meeting_id uuid references public.meetings(id) on delete cascade, user_id uuid, attendance_status text, attended_at timestamptz, primary key (meeting_id, user_id));
create table public.meeting_invitations (id uuid primary key default gen_random_uuid(), meeting_id uuid references public.meetings(id) on delete cascade, user_id uuid, phone text, status text, created_by uuid, created_at timestamptz default now());
create table public.votes (id uuid primary key default gen_random_uuid(), meeting_id uuid references public.meetings(id), question text, vote_type text, quorum_required int, status text, created_by uuid, created_at timestamptz default now());
create table public.vote_responses (vote_id uuid references public.votes(id), user_id uuid, choice text, voted_at timestamptz, primary key (vote_id, user_id));
create table public.minutes (id uuid primary key default gen_random_uuid(), meeting_id uuid references public.meetings(id), content text, recommendations text, improvement_opportunities text, status text, created_by uuid, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.signatures (id uuid primary key default gen_random_uuid(), minute_id uuid references public.minutes(id), user_id uuid, signature_path text not null default '', signed_at timestamptz default now());
create table public.tasks (id uuid primary key default gen_random_uuid(), meeting_id uuid, title text, description text, assignee_id uuid, due_date date, status text default 'جديدة', priority text, created_by uuid, created_at timestamptz default now());
create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text, body text, is_read boolean default false, created_at timestamptz default now());
create table public.delivery_jobs (id uuid primary key default gen_random_uuid(), channel text, recipient text, template text, payload jsonb, status text default 'pending', scheduled_for timestamptz default now(), created_at timestamptz default now());
create table public.audit_logs (id uuid primary key default gen_random_uuid(), user_id uuid, action text, entity_type text, entity_id uuid, metadata jsonb, created_at timestamptz default now());
create table public.circular_decisions (id uuid primary key default gen_random_uuid(), title text, description text, committee_id uuid, status text, created_by uuid, created_at timestamptz default now());
create table public.ai_documents (id uuid primary key default gen_random_uuid(), entity_type text, entity_id uuid, title text, content text);

create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(regexp_replace(name, '/[^/]*$', ''), '/') $$;
