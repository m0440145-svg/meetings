-- إدارة قرارات مجلس الإدارة واللجان ومتابعة تنفيذها — النواة: المخطط، RBAC، RLS، آلة الحالات، دوال دورة الحياة، سجل الأحداث غير القابل للتعديل.
-- يعتمد على: 001 (is_admin, audit_trg) و 003 (اختياري) . يُتبع بالترحيل 008 (التنبيهات والتصعيد والمؤشرات والتقارير).
-- [افتراض] meetings(id, committee_id, gregorian_date, ...) ، minutes(id, meeting_id, status 'معتمد'), committees(id, name), committee_members(committee_id, user_id), profiles(id, full_name, is_active, role_code), notifications(user_id, title, body), delivery_jobs(channel, recipient, template, payload, status)
-- المبدأ: كل الكتابة على جداول القرارات تتم عبر دوال SECURITY DEFINER تتحقق من الصلاحية والحالة في الخادم؛ لا كتابة مباشرة من العميل.
-- اختُبر هذا الملف على Postgres 18 (PGlite) مع مخطط افتراضي؛ راجع tests/ وdocs/نظام-القرارات.

begin;

-- ───────────── الهيكل التنظيمي (الإدارات) ─────────────
create table if not exists public.org_units (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique check (char_length(name) between 2 and 120),
  parent_id    uuid references public.org_units(id) on delete set null,
  head_user_id uuid references public.profiles(id) on delete set null,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);
create table if not exists public.org_unit_members (
  unit_id uuid not null references public.org_units(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (unit_id, user_id)
);

-- ───────────── الأدوار والصلاحيات (RBAC) ─────────────
create table if not exists public.dm_user_roles (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  role         text not null check (role in ('admin', 'secretary', 'chair', 'member', 'executor', 'unit_manager', 'governance', 'auditor')),
  committee_id uuid references public.committees(id) on delete cascade,   -- null = كل الجهات
  is_active    boolean not null default true,
  granted_by   uuid default auth.uid(),
  granted_at   timestamptz not null default now(),
  unique nulls not distinct (user_id, role, committee_id)
);
create table if not exists public.dm_role_permissions (
  role       text not null,
  permission text not null,
  primary key (role, permission)
);
create table if not exists public.dm_settings (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create table if not exists public.dm_counters (
  key  text not null,
  year int not null,
  last int not null default 0,
  primary key (key, year)
);
-- مصفوفة الانتقالات المسموحة بين الحالات (توثيق وإنفاذ)
create table if not exists public.dm_transitions (
  from_status text not null,
  to_status   text not null,
  primary key (from_status, to_status)
);

-- ───────────── القرارات ─────────────
create table if not exists public.decisions (
  id                 uuid primary key default gen_random_uuid(),
  ref_no             text not null unique,
  title              text not null check (char_length(title) between 3 and 200),
  body_text          text not null check (char_length(body_text) between 3 and 8000),
  body_kind          text not null check (body_kind in ('board', 'committee')),
  committee_id       uuid not null references public.committees(id),
  meeting_id         uuid references public.meetings(id) on delete set null,
  meeting_no         text check (char_length(meeting_no) <= 40),
  minute_id          uuid references public.minutes(id) on delete set null,
  record_type        text not null default 'decision' check (record_type in ('decision', 'recommendation', 'assignment')),
  category           text not null default 'administrative' check (category in ('administrative', 'financial', 'organizational', 'strategic', 'other')),
  priority           text not null default 'medium' check (priority in ('low', 'medium', 'high', 'critical')),
  status             text not null default 'draft' check (status in ('draft', 'pending_approval', 'approved', 'pending_assignment', 'assigned', 'executing',
                       'awaiting_update', 'pending_verification', 'returned', 'completed', 'closed', 'cancelled')),
  decision_date      date,
  responsible_unit_id uuid references public.org_units(id) on delete set null,
  owner_id           uuid references public.profiles(id) on delete set null,
  assigned_at        timestamptz,
  due_date           date,
  original_due_date  date,
  extension_count    int not null default 0,
  deliverables       text not null default '' check (char_length(deliverables) <= 4000),
  success_criteria   text not null default '' check (char_length(success_criteria) <= 4000),
  notes              text not null default '' check (char_length(notes) <= 4000),
  progress_pct       int not null default 0 check (progress_pct between 0 and 100),
  expected_end       date,
  last_update_at     timestamptz,
  started_at         timestamptz,
  verification_requested_at timestamptz,
  completed_at       timestamptz,
  closed_at          timestamptz,
  closed_by          uuid,
  approved_at        timestamptz,
  approved_by        uuid,
  ratified_at        timestamptz,
  ratified_by        uuid,
  cancelled_at       timestamptz,
  cancelled_by       uuid,
  cancel_reason      text,
  escalated_to_report boolean not null default false,
  text_version       int not null default 1,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists decisions_committee_idx on public.decisions(committee_id, status);
create index if not exists decisions_owner_idx on public.decisions(owner_id);
create index if not exists decisions_due_idx on public.decisions(due_date) where status in ('assigned', 'executing', 'awaiting_update', 'returned', 'pending_verification');
create index if not exists decisions_meeting_idx on public.decisions(meeting_id);

create table if not exists public.decision_text_versions (
  decision_id uuid not null references public.decisions(id) on delete cascade,
  version     int not null,
  body_text   text not null,
  changed_by  uuid,
  changed_at  timestamptz not null default now(),
  basis       text not null default '',
  primary key (decision_id, version)
);
create table if not exists public.decision_assistants (
  decision_id uuid not null references public.decisions(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  primary key (decision_id, user_id)
);
create table if not exists public.decision_actions (
  id          uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.decisions(id) on delete cascade,
  title       text not null check (char_length(title) between 2 and 200),
  unit_id     uuid references public.org_units(id) on delete set null,
  owner_id    uuid references public.profiles(id) on delete set null,
  due_date    date,
  status      text not null default 'open' check (status in ('open', 'in_progress', 'done', 'cancelled')),
  progress_pct int not null default 0 check (progress_pct between 0 and 100),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create table if not exists public.decision_updates (
  id          uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.decisions(id) on delete cascade,
  kind        text not null check (kind in ('progress', 'note', 'blocker', 'corrective')),
  progress_pct int check (progress_pct between 0 and 100),
  body        text not null default '',
  expected_end date,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create table if not exists public.decision_evidence (
  id          uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.decisions(id) on delete cascade,
  action_id   uuid references public.decision_actions(id) on delete set null,
  file_name   text not null check (char_length(file_name) between 1 and 200),
  storage_path text not null,
  mime_type   text,
  size_bytes  bigint check (size_bytes >= 0),
  description text not null default '' check (char_length(description) <= 500),
  uploaded_by uuid default auth.uid(),
  uploaded_at timestamptz not null default now(),
  review_status text not null default 'pending' check (review_status in ('pending', 'accepted', 'rejected')),
  review_note text,
  kind        text not null default 'evidence' check (kind in ('evidence', 'reference')),   -- evidence = دليل إنجاز يخضع للمراجعة، reference = مرفق مرجعي للقرار
  reviewed_by uuid,
  reviewed_at timestamptz
);
create table if not exists public.decision_verifications (
  id           uuid primary key default gen_random_uuid(),
  decision_id  uuid not null references public.decisions(id) on delete cascade,
  requested_by uuid default auth.uid(),
  requested_at timestamptz not null default now(),
  request_note text not null default '',
  status       text not null default 'pending' check (status in ('pending', 'approved', 'returned')),
  reviewer_id  uuid,
  reviewed_at  timestamptz,
  review_note  text
);
create table if not exists public.decision_extensions (
  id          uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.decisions(id) on delete cascade,
  requested_by uuid default auth.uid(),
  requested_at timestamptz not null default now(),
  current_due date not null,
  requested_due date not null,
  reason      text not null check (char_length(reason) >= 5),
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by  uuid,
  decided_at  timestamptz,
  decision_note text,
  approved_due date
);
create table if not exists public.decision_directives (
  id          uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.decisions(id) on delete cascade,
  meeting_id  uuid references public.meetings(id) on delete set null,
  kind        text not null check (kind in ('clarification', 'directive', 'reassign_request', 'extension_request', 'close_recommendation')),
  body        text not null check (char_length(body) >= 3),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
-- سجل الأحداث: غير قابل للتعديل أو الحذف حتى من الدوال
create table if not exists public.decision_events (
  id          bigint generated always as identity primary key,
  decision_id uuid not null references public.decisions(id) on delete cascade,
  event_type  text not null,
  from_status text,
  to_status   text,
  actor_id    uuid,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists decision_events_idx on public.decision_events(decision_id, id);
create table if not exists public.decision_alerts (
  id          uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.decisions(id) on delete cascade,
  kind        text not null,
  due_date    date,
  created_at  timestamptz not null default now(),
  unique (decision_id, kind, due_date)
);
create table if not exists public.dm_reports (
  id           uuid primary key default gen_random_uuid(),
  report_no    text not null unique,
  filters      jsonb not null default '{}'::jsonb,
  data         jsonb not null,
  generated_by uuid default auth.uid(),
  generated_at timestamptz not null default now()
);

-- ربط المهام الحالية بالقرار (اختياري)
alter table public.tasks add column if not exists decision_id uuid references public.decisions(id) on delete set null;
-- رقم الاجتماع (نص حر مثل "5/2026") لعرضه مع القرار
alter table public.meetings add column if not exists meeting_no text;

-- حماية سجل الأحداث والنسخ
create or replace function public.dm_immutable() returns trigger language plpgsql as $$
begin raise exception 'هذا السجل غير قابل للتعديل أو الحذف'; end $$;
drop trigger if exists trg_dm_events_immutable on public.decision_events;
create trigger trg_dm_events_immutable before update or delete on public.decision_events for each row execute function public.dm_immutable();
drop trigger if exists trg_dm_versions_immutable on public.decision_text_versions;
create trigger trg_dm_versions_immutable before update or delete on public.decision_text_versions for each row execute function public.dm_immutable();
create or replace function public.dm_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists trg_dm_touch on public.decisions;
create trigger trg_dm_touch before update on public.decisions for each row execute function public.dm_touch();

-- ───────────── بيانات التهيئة: الانتقالات، الصلاحيات، الإعدادات ─────────────
insert into public.dm_transitions(from_status, to_status) values
  ('draft', 'pending_approval'), ('draft', 'cancelled'),
  ('pending_approval', 'approved'), ('pending_approval', 'draft'), ('pending_approval', 'cancelled'),
  ('approved', 'pending_assignment'), ('approved', 'cancelled'),
  ('pending_assignment', 'assigned'), ('pending_assignment', 'cancelled'),
  ('assigned', 'executing'), ('assigned', 'pending_verification'), ('assigned', 'cancelled'),
  ('executing', 'awaiting_update'), ('executing', 'pending_verification'), ('executing', 'cancelled'),
  ('awaiting_update', 'executing'), ('awaiting_update', 'pending_verification'), ('awaiting_update', 'cancelled'),
  ('pending_verification', 'completed'), ('pending_verification', 'returned'), ('pending_verification', 'cancelled'),
  ('returned', 'executing'), ('returned', 'pending_verification'), ('returned', 'cancelled'),
  ('completed', 'closed'), ('completed', 'returned'), ('completed', 'cancelled')
on conflict do nothing;

-- الصلاحيات: لا يحصل دور على صلاحية حساسة إلا بنص صريح. مدير النظام تقني فقط (أدوار وإعدادات)، لا يرى القرارات ولا يعتمدها.
insert into public.dm_role_permissions(role, permission) values
  ('admin', 'manage_roles'), ('admin', 'manage_settings'),
  ('secretary', 'view_scope'), ('secretary', 'create'), ('secretary', 'edit_draft'), ('secretary', 'submit'), ('secretary', 'assign'), ('secretary', 'reassign'),
  ('secretary', 'add_action'), ('secretary', 'add_note'), ('secretary', 'review_evidence'), ('secretary', 'verify'), ('secretary', 'close'),
  ('secretary', 'approve_extension_limited'), ('secretary', 'direct'), ('secretary', 'export'),
  ('chair', 'view_scope'), ('chair', 'approve'), ('chair', 'ratify'), ('chair', 'assign'), ('chair', 'reassign'), ('chair', 'amend'), ('chair', 'close'),
  ('chair', 'cancel'), ('chair', 'approve_extension'), ('chair', 'direct'), ('chair', 'export'),
  ('member', 'view_scope'), ('member', 'direct'),
  ('executor', 'view_own'),
  ('unit_manager', 'view_own'), ('unit_manager', 'add_action'),
  ('governance', 'view_scope'), ('governance', 'review_evidence'), ('governance', 'verify'), ('governance', 'export'), ('governance', 'audit_read'), ('governance', 'manage_settings'),
  ('auditor', 'view_scope'), ('auditor', 'audit_read'), ('auditor', 'export')
on conflict do nothing;

insert into public.dm_settings(key, value) values
  ('reminder_days', '[7, 3, 0]'),
  ('late_alert_days', '[1]'),
  ('escalation', '[{"days": 7, "level": "unit_head"}, {"days": 14, "level": "upper"}]'),
  ('report_escalation_days', '21'),
  ('stale_days', '14'),
  ('require_evidence', 'true'),
  ('require_approved_minute', 'true'),
  ('require_minute_link', 'false'),
  ('secretary_ext_days', '14'),
  ('measure_against', '"current"'),
  ('email_notifications', 'true')
on conflict (key) do nothing;

-- ───────────── دوال مساعدة للصلاحيات ─────────────
create or replace function public.dm_setting(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$
  select value from public.dm_settings where key = p_key;
$$;

create or replace function public.dm_platform_admin(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = p_user and coalesce(p.role_code, p.role) = 'admin' and coalesce(p.is_active, true));
$$;

create or replace function public.dm_is_executor(p_user uuid, p_decision uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.decisions d where d.id = p_decision and (
           d.owner_id = p_user
        or exists (select 1 from public.decision_assistants a where a.decision_id = d.id and a.user_id = p_user)
        or exists (select 1 from public.org_units u where u.id = d.responsible_unit_id and u.head_user_id = p_user)
        or exists (select 1 from public.decision_actions x where x.decision_id = d.id and x.owner_id = p_user)));
$$;

create or replace function public.dm_has_perm(p_user uuid, p_perm text, p_decision uuid default null, p_committee uuid default null) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare c uuid := p_committee; d public.decisions%rowtype;
begin
  if p_user is null then return false; end if;
  if p_decision is not null then
    select * into d from public.decisions where id = p_decision;
    if not found then return false; end if;
    c := d.committee_id;
  end if;
  -- إدارة الأدوار والإعدادات: مدير المنصة (role_code = admin) أو من يملك الدور
  if p_perm in ('manage_roles', 'manage_settings') and public.dm_platform_admin(p_user) then return true; end if;
  if exists (select 1 from public.dm_user_roles ur
              join public.dm_role_permissions rp on rp.role = ur.role and rp.permission = p_perm
             where ur.user_id = p_user and ur.is_active and (ur.committee_id is null or c is null or ur.committee_id = c)) then
    -- فصل المهام: المسؤول عن التنفيذ لا يتحقق من إنجاز قراره ولا يقفله
    if p_perm in ('verify', 'review_evidence', 'close') and d.id is not null and public.dm_is_executor(p_user, d.id) then return false; end if;
    return true;
  end if;
  -- عضو اللجنة يوجّه (يصدر توجيهات) ضمن لجنته
  if p_perm = 'direct' and c is not null and exists (select 1 from public.committee_members cm where cm.committee_id = c and cm.user_id = p_user) then return true; end if;
  -- صلاحيات صاحب التنفيذ على قراره
  if d.id is not null and p_perm in ('update', 'add_action', 'upload_evidence', 'request_verification', 'request_extension') and public.dm_is_executor(p_user, d.id) then return true; end if;
  return false;
end $$;

create or replace function public.dm_can_view(p_user uuid, p_decision uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare d public.decisions%rowtype;
begin
  if p_user is null then return false; end if;
  select * into d from public.decisions where id = p_decision;
  if not found then return false; end if;
  if d.created_by = p_user then return true; end if;
  if public.dm_has_perm(p_user, 'view_scope', null, d.committee_id) then return true; end if;
  if exists (select 1 from public.committee_members cm where cm.committee_id = d.committee_id and cm.user_id = p_user) and d.status not in ('draft') then return true; end if;
  return public.dm_is_executor(p_user, p_decision);
end $$;

create or replace function public.dm_role_holders(p_role text, p_committee uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct ur.user_id), '{}') from public.dm_user_roles ur
   where ur.role = p_role and ur.is_active and (ur.committee_id is null or ur.committee_id = p_committee);
$$;

create or replace function public.dm_perm_holders(p_perm text, p_committee uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct ur.user_id), '{}') from public.dm_user_roles ur
    join public.dm_role_permissions rp on rp.role = ur.role and rp.permission = p_perm
   where ur.is_active and (ur.committee_id is null or ur.committee_id = p_committee);
$$;

create or replace function public.dm_is_overdue(p_status text, p_due date) returns boolean
language sql immutable as $$
  select p_due is not null and p_due < current_date and p_status in ('assigned', 'executing', 'awaiting_update', 'returned', 'pending_verification');
$$;

-- ───────────── السجل والإشعارات وآلة الحالات ─────────────
create or replace function public.dm_log(p_decision uuid, p_type text, p_from text, p_to text, p_payload jsonb default '{}') returns void
language sql security definer set search_path = public as $$
  insert into public.decision_events(decision_id, event_type, from_status, to_status, actor_id, payload) values (p_decision, p_type, p_from, p_to, auth.uid(), coalesce(p_payload, '{}'));
$$;

-- إشعار داخل المنصة + بريد (إن فُعّل ولم يعطّله المستخدم). لا يوقف العملية إن فشل
create or replace function public.dm_notify(p_users uuid[], p_title text, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid; mail text; email_on boolean := coalesce((public.dm_setting('email_notifications'))::text = 'true', true);
begin
  foreach u in array coalesce(p_users, '{}') loop
    continue when u is null or u is not distinct from auth.uid();
    begin
      insert into public.notifications(user_id, title, body) values (u, p_title, p_body);
      if email_on and coalesce((select np.email from public.notification_preferences np where np.user_id = u), true) then
        select au.email into mail from auth.users au where au.id = u;
        if mail is not null and mail <> '' then
          insert into public.delivery_jobs(channel, recipient, template, payload, status)
          values ('email', mail, 'decision_notice', jsonb_build_object('title', p_title, 'body', p_body), 'pending');
        end if;
      end if;
    exception when others then
      raise warning 'تعذر إشعار % : %', u, sqlerrm;
    end;
  end loop;
end $$;

-- كل تغيير للحالة يمر من هنا: يتحقق من الانتقال المسموح ويسجل الحدث
create or replace function public.dm_move(p_id uuid, p_to text, p_event text, p_payload jsonb default '{}') returns void
language plpgsql security definer set search_path = public as $$
declare cur text;
begin
  select status into cur from public.decisions where id = p_id for update;
  if not found then raise exception 'القرار غير موجود'; end if;
  if cur = p_to then return; end if;
  if not exists (select 1 from public.dm_transitions where from_status = cur and to_status = p_to) then
    raise exception 'الانتقال من % إلى % غير مسموح', cur, p_to;
  end if;
  perform set_config('app.dm_rpc', 'on', true);
  update public.decisions set status = p_to where id = p_id;
  perform public.dm_log(p_id, p_event, cur, p_to, p_payload);
end $$;

create or replace function public.dm_require(p_perm text, p_decision uuid default null, p_committee uuid default null) returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول'; end if;
  if not public.dm_has_perm(auth.uid(), p_perm, p_decision, p_committee) then raise exception 'لا تملك صلاحية تنفيذ هذا الإجراء'; end if;
  return auth.uid();
end $$;

-- حماية الأعمدة الحساسة من التعديل المباشر
create or replace function public.dm_guard_decisions() returns trigger language plpgsql as $$
begin
  if current_setting('app.dm_rpc', true) is distinct from 'on' and auth.uid() is not null then
    raise exception 'لا يُعدَّل القرار إلا عبر إجراءات دورة العمل المعتمدة';
  end if;
  return new;
end $$;
drop trigger if exists trg_dm_guard on public.decisions;
create trigger trg_dm_guard before update or delete on public.decisions for each row execute function public.dm_guard_decisions();

-- الرقم المرجعي: BD-2026-0005 لمجلس الإدارة، CM-2026-0012 للجان (تسلسل لكل نوع وسنة)
create or replace function public.dm_next_ref(p_kind text, p_year int) returns text
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.dm_counters(key, year, last) values (p_kind, p_year, 1)
  on conflict (key, year) do update set last = public.dm_counters.last + 1 returning last into n;
  return (case p_kind when 'board' then 'BD' else 'CM' end) || '-' || p_year || '-' || lpad(n::text, 4, '0');
end $$;

-- ───────────── إنشاء القرار وتحريره واعتماده ─────────────
create or replace function public.dm_create_decision(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid; cm public.committees%rowtype; m public.meetings%rowtype; mi public.minutes%rowtype;
        kind text := coalesce(p->>'body_kind', 'committee'); y int; ref text; new_id uuid; dd date;
begin
  if kind not in ('board', 'committee') then raise exception 'نوع الجهة غير صالح'; end if;
  select * into cm from public.committees where id = (p->>'committee_id')::uuid;
  if not found then raise exception 'اختر المجلس أو اللجنة'; end if;
  uid := public.dm_require('create', null, cm.id);
  if coalesce(btrim(p->>'title'), '') = '' or coalesce(btrim(p->>'body_text'), '') = '' then raise exception 'عنوان القرار ونصه مطلوبان'; end if;
  if nullif(p->>'meeting_id', '') is not null then
    select * into m from public.meetings where id = (p->>'meeting_id')::uuid;
    if not found then raise exception 'الاجتماع غير موجود'; end if;
    if m.committee_id is not null and m.committee_id <> cm.id then raise exception 'الاجتماع يخص جهة أخرى'; end if;
    dd := m.gregorian_date;
  end if;
  if nullif(p->>'minute_id', '') is not null then
    select * into mi from public.minutes where id = (p->>'minute_id')::uuid;
    if not found then raise exception 'المحضر غير موجود'; end if;
    if m.id is not null and mi.meeting_id <> m.id then raise exception 'المحضر لا يخص هذا الاجتماع'; end if;
  end if;
  if coalesce((public.dm_setting('require_minute_link'))::text = 'true', false) and mi.id is null then raise exception 'ربط القرار بمحضر الاجتماع مطلوب'; end if;
  y := extract(year from coalesce(dd, current_date))::int;
  ref := public.dm_next_ref(kind, y);
  perform set_config('app.dm_rpc', 'on', true);
  insert into public.decisions(ref_no, title, body_text, body_kind, committee_id, meeting_id, meeting_no, minute_id, record_type, category, priority, decision_date,
                               deliverables, success_criteria, notes, created_by)
  values (ref, btrim(p->>'title'), btrim(p->>'body_text'), kind, cm.id, m.id, coalesce(nullif(p->>'meeting_no', ''), m.meeting_no), mi.id,
          coalesce(nullif(p->>'record_type', ''), 'decision'), coalesce(nullif(p->>'category', ''), 'administrative'), coalesce(nullif(p->>'priority', ''), 'medium'), dd,
          coalesce(p->>'deliverables', ''), coalesce(p->>'success_criteria', ''), coalesce(p->>'notes', ''), uid)
  returning id into new_id;
  perform public.dm_log(new_id, 'created', null, 'draft', jsonb_build_object('ref_no', ref));
  return new_id;
end $$;

create or replace function public.dm_update_draft(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare d public.decisions%rowtype; uid uuid;
begin
  select * into d from public.decisions where id = p_id for update;
  if not found then raise exception 'القرار غير موجود'; end if;
  if d.status <> 'draft' then raise exception 'لا يُعدَّل إلا القرار في حالة المسودة؛ التعديل بعد ذلك بإجراء رسمي'; end if;
  uid := auth.uid();
  if not (public.dm_has_perm(uid, 'edit_draft', p_id) or (d.created_by = uid and public.dm_has_perm(uid, 'create', p_id))) then raise exception 'لا تملك صلاحية تعديل هذه المسودة'; end if;
  perform set_config('app.dm_rpc', 'on', true);
  update public.decisions set
    title = coalesce(nullif(btrim(p->>'title'), ''), title), body_text = coalesce(nullif(btrim(p->>'body_text'), ''), body_text),
    category = coalesce(nullif(p->>'category', ''), category), priority = coalesce(nullif(p->>'priority', ''), priority),
    record_type = coalesce(nullif(p->>'record_type', ''), record_type),
    deliverables = coalesce(p->>'deliverables', deliverables), success_criteria = coalesce(p->>'success_criteria', success_criteria), notes = coalesce(p->>'notes', notes),
    meeting_no = coalesce(nullif(p->>'meeting_no', ''), meeting_no)
   where id = p_id;
  perform public.dm_log(p_id, 'edited_draft', 'draft', 'draft', '{}');
end $$;

create or replace function public.dm_submit(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d public.decisions%rowtype;
begin
  select * into d from public.decisions where id = p_id;
  if not found then raise exception 'القرار غير موجود'; end if;
  perform public.dm_require('submit', p_id);
  perform public.dm_move(p_id, 'pending_approval', 'submitted');
  perform public.dm_notify(public.dm_perm_holders('approve', d.committee_id), 'قرار بانتظار الاعتماد', d.ref_no || ' — ' || d.title);
end $$;

create or replace function public.dm_return_to_draft(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare d public.decisions%rowtype;
begin
  select * into d from public.decisions where id = p_id;
  if not found then raise exception 'القرار غير موجود'; end if;
  perform public.dm_require('approve', p_id);
  if coalesce(btrim(p_reason), '') = '' then raise exception 'سبب الإعادة مطلوب'; end if;
  perform public.dm_move(p_id, 'draft', 'returned_to_draft', jsonb_build_object('reason', p_reason));
  perform public.dm_notify(array[d.created_by], 'أُعيد القرار للتعديل', d.ref_no || ' — ' || p_reason);
end $$;

create or replace function public.dm_approve(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d public.decisions%rowtype; uid uuid; mst text;
begin
  select * into d from public.decisions where id = p_id for update;
  if not found then raise exception 'القرار غير موجود'; end if;
  uid := public.dm_require('approve', p_id);
  if d.status <> 'pending_approval' then raise exception 'القرار ليس بانتظار الاعتماد'; end if;
  if d.minute_id is not null and coalesce((public.dm_setting('require_approved_minute'))::text = 'true', true) then
    select status into mst from public.minutes where id = d.minute_id;
    if mst is distinct from 'معتمد' then raise exception 'لا يُعتمد القرار قبل اعتماد محضر الاجتماع المرتبط به'; end if;
  end if;
  perform set_config('app.dm_rpc', 'on', true);
  update public.decisions set approved_at = now(), approved_by = uid where id = p_id;
  insert into public.decision_text_versions(decision_id, version, body_text, changed_by, basis) values (p_id, d.text_version, d.body_text, uid, 'النص المعتمد الأصلي');
  perform public.dm_move(p_id, 'approved', 'approved');
  if d.record_type in ('decision', 'assignment') then
    perform public.dm_move(p_id, 'pending_assignment', 'auto_pending_assignment');
    perform public.dm_notify(public.dm_role_holders('secretary', d.committee_id), 'قرار معتمد بانتظار الإسناد', d.ref_no || ' — ' || d.title);
  else
    perform public.dm_notify(public.dm_role_holders('chair', d.committee_id), 'توصية معتمدة بانتظار التصديق', d.ref_no || ' — ' || d.title);
  end if;
end $$;

-- التوصية لا تصبح قرارًا تنفيذيًا ملزمًا إلا بالتصديق ممن يملك صلاحية التصديق
create or replace function public.dm_ratify(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d public.decisions%rowtype; uid uuid;
begin
  select * into d from public.decisions where id = p_id for update;
  if not found then raise exception 'القرار غير موجود'; end if;
  uid := public.dm_require('ratify', p_id);
  if d.record_type <> 'recommendation' or d.status <> 'approved' then raise exception 'التصديق للتوصية المعتمدة فقط'; end if;
  perform set_config('app.dm_rpc', 'on', true);
  update public.decisions set record_type = 'decision', ratified_at = now(), ratified_by = uid where id = p_id;
  perform public.dm_move(p_id, 'pending_assignment', 'ratified');
  perform public.dm_notify(public.dm_role_holders('secretary', d.committee_id), 'توصية صُدِّق عليها وأصبحت قرارًا بانتظار الإسناد', d.ref_no || ' — ' || d.title);
end $$;

-- ───────────── الإسناد وإعادة الإسناد ─────────────
create or replace function public.dm_task_priority(p text) returns text language sql immutable as $$
  select case p when 'critical' then 'عالية' when 'high' then 'عالية' when 'low' then 'منخفضة' else 'متوسطة' end;
$$;

create or replace function public.dm_assign(p_id uuid, p_unit uuid, p_owner uuid, p_due date, p_deliverables text, p_criteria text, p_assistants uuid[] default '{}') returns void
language plpgsql security definer set search_path = public as $$
declare d public.decisions%rowtype; u uuid; own public.profiles%rowtype; base date;
begin
  select * into d from public.decisions where id = p_id for update;
  if not found then raise exception 'القرار غير موجود'; end if;
  perform public.dm_require('assign', p_id);
  if d.status <> 'pending_assignment' then raise exception 'القرار ليس بانتظار الإسناد'; end if;
  if p_unit is null or not exists (select 1 from public.org_units where id = p_unit and is_active) then raise exception 'حدد الجهة المكلفة (إدارة فعّالة)'; end if;
  select * into own from public.profiles where id = p_owner;
  if not found or coalesce(own.is_active, true) = false then raise exception 'المسؤول عن التنفيذ غير صالح'; end if;
  base := coalesce(d.decision_date, current_date);
  if p_due is null or p_due < base then raise exception 'تاريخ الاستحقاق مطلوب ولا يسبق تاريخ القرار'; end if;
  if coalesce(btrim(p_deliverables), '') = '' then raise exception 'المخرجات المطلوبة مطلوبة'; end if;
  perform set_config('app.dm_rpc', 'on', true);
  update public.decisions set responsible_unit_id = p_unit, owner_id = p_owner, assigned_at = now(), due_date = p_due, original_due_date = p_due,
         deliverables = btrim(p_deliverables), success_criteria = coalesce(btrim(p_criteria), '') where id = p_id;
  foreach u in array coalesce(p_assistants, '{}') loop
    continue when u = p_owner;
    insert into public.decision_assistants(decision_id, user_id) values (p_id, u) on conflict do nothing;
  end loop;
  perform public.dm_move(p_id, 'assigned', 'assigned', jsonb_build_object('owner_id', p_owner, 'unit_id', p_unit, 'due_date', p_due));
  -- بطاقة مهمة في قائمة مهام المنصة
  insert into public.tasks(meeting_id, title, description, assignee_id, due_date, status, priority, created_by, decision_id)
  values (d.meeting_id, 'تنفيذ القرار ' || d.ref_no || ': ' || d.title, btrim(p_deliverables), p_owner, p_due, 'جديدة', public.dm_task_priority(d.priority), auth.uid(), p_id);
  perform public.dm_notify(array[p_owner] || coalesce(p_assistants, '{}'), 'قرار مكلّف بتنفيذه', d.ref_no || ' — ' || d.title || ' — الاستحقاق ' || p_due);
end $$;

create or replace function public.dm_reassign(p_id uuid, p_unit uuid, p_owner uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare d public.decisions%rowtype; old_owner uuid;
begin
  select * into d from public.decisions where id = p_id for update;
  if not found then raise exception 'القرار غير موجود'; end if;
  perform public.dm_require('reassign', p_id);
  if d.status not in ('assigned', 'executing', 'awaiting_update', 'returned', 'pending_verification') then raise exception 'لا يمكن إعادة الإسناد في هذه الحالة'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'سبب إعادة الإسناد مطلوب'; end if;
  if not exists (select 1 from public.profiles where id = p_owner and coalesce(is_active, true)) then raise exception 'المسؤول الجديد غير صالح'; end if;
  old_owner := d.owner_id;
  perform set_config('app.dm_rpc', 'on', true);
  update public.decisions set owner_id = p_owner, responsible_unit_id = coalesce(p_unit, responsible_unit_id) where id = p_id;
  update public.tasks set assignee_id = p_owner where decision_id = p_id;
  perform public.dm_log(p_id, 'reassigned', d.status, d.status, jsonb_build_object('old_owner', old_owner, 'new_owner', p_owner, 'unit_id', p_unit, 'reason', p_reason));
  perform public.dm_notify(array[p_owner, old_owner], 'تغيير مسؤول تنفيذ قرار', d.ref_no || ' — ' || p_reason);
end $$;

-- ───────────── التنفيذ: التحديثات والإجراءات الفرعية والأدلة ─────────────
create or replace function public.dm_post_update(p_id uuid, p_kind text, p_progress int, p_text text, p_expected date default null) returns void
language plpgsql security definer set search_path = public as $$
declare d public.decisions%rowtype; uid uuid;
begin
  select * into d from public.decisions where id = p_id for update;
  if not found then raise exception 'القرار غير موجود'; end if;
  if p_kind not in ('progress', 'note', 'blocker', 'corrective') then raise exception 'نوع التحديث غير صالح'; end if;
  if p_kind = 'note' and not public.dm_is_executor(auth.uid(), p_id) then uid := public.dm_require('add_note', p_id); else uid := public.dm_require('update', p_id); end if;
  if d.status not in ('assigned', 'executing', 'awaiting_update', 'returned') and not (p_kind = 'note' and d.status in ('pending_verification', 'completed')) then
    raise exception 'لا يقبل القرار تحديثات في حالته الحالية';
  end if;
  if p_kind = 'progress' and (p_progress is null or p_progress < 0 or p_progress > 100) then raise exception 'نسبة الإنجاز بين 0 و100'; end if;
  if p_kind <> 'progress' and coalesce(btrim(p_text), '') = '' then raise exception 'نص التحديث مطلوب'; end if;
  insert into public.decision_updates(decision_id, kind, progress_pct, body, expected_end) values (p_id, p_kind, case when p_kind = 'progress' then p_progress end, coalesce(btrim(p_text), ''), p_expected);
  perform set_config('app.dm_rpc', 'on', true);
  if p_kind <> 'note' then
    update public.decisions set last_update_at = now(), expected_end = coalesce(p_expected, expected_end),
           progress_pct = case when p_kind = 'progress' then p_progress else progress_pct end,
           started_at = coalesce(started_at, now()) where id = p_id;
    if d.status in ('assigned', 'awaiting_update', 'returned') then
      perform public.dm_move(p_id, 'executing', case when d.status = 'assigned' then 'started' else 'resumed' end);
    end if;
    update public.tasks set status = 'قيد التنفيذ' where decision_id = p_id and status = 'جديدة';
  end if;
  perform public.dm_log(p_id, case p_kind when 'progress' then 'progress' else p_kind end, d.status, null, jsonb_build_object('progress', p_progress, 'text', left(coalesce(p_text, ''), 300)));
  if p_kind = 'blocker' then perform public.dm_notify(public.dm_role_holders('secretary', d.committee_id), 'عائق في تنفيذ قرار', d.ref_no || ' — ' || left(p_text, 140)); end if;
end $$;

create or replace function public.dm_add_action(p_id uuid, p_title text, p_unit uuid, p_owner uuid, p_due date) returns uuid
language plpgsql security definer set search_path = public as $$
declare d public.decisions%rowtype; aid uuid;
begin
  select * into d from public.decisions where id = p_id;
  if not found then raise exception 'القرار غير موجود'; end if;
  if not (public.dm_has_perm(auth.uid(), 'add_action', p_id) or public.dm_has_perm(auth.uid(), 'update', p_id)) then raise exception 'لا تملك صلاحية إضافة إجراء'; end if;
  if d.status not in ('assigned', 'executing', 'awaiting_update', 'returned') then raise exception 'لا تُضاف إجراءات في هذه الحالة'; end if;
  if coalesce(btrim(p_title), '') = '' then raise exception 'عنوان الإجراء مطلوب'; end if;
  if p_due is not null and d.due_date is not null and p_due > d.due_date then raise exception 'موعد الإجراء بعد موعد القرار؛ اطلب تمديد القرار أولًا'; end if;
  insert into public.decision_actions(decision_id, title, unit_id, owner_id, due_date) values (p_id, btrim(p_title), p_unit, p_owner, p_due) returning id into aid;
  perform public.dm_log(p_id, 'action_added', d.status, d.status, jsonb_build_object('action_id', aid, 'title', p_title, 'owner_id', p_owner));
  if p_owner is not null then perform public.dm_notify(array[p_owner], 'إجراء تنفيذي مسند إليك', d.ref_no || ' — ' || p_title); end if;
  return aid;
end $$;

create or replace function public.dm_set_action(p_action uuid, p_status text, p_progress int) returns void
language plpgsql security definer set search_path = public as $$
declare a public.decision_actions%rowtype; d public.decisions%rowtype;
begin
  select * into a from public.decision_actions where id = p_action for update;
  if not found then raise exception 'الإجراء غير موجود'; end if;
  select * into d from public.decisions where id = a.decision_id;
  if not (a.owner_id = auth.uid() or public.dm_has_perm(auth.uid(), 'update', a.decision_id)) then raise exception 'لا تملك صلاحية تحديث هذا الإجراء'; end if;
  if p_status not in ('open', 'in_progress', 'done', 'cancelled') then raise exception 'حالة الإجراء غير صالحة'; end if;
  if d.status not in ('assigned', 'executing', 'awaiting_update', 'returned') then raise exception 'لا تُحدَّث الإجراءات في هذه الحالة'; end if;
  update public.decision_actions set status = p_status, progress_pct = case when p_status = 'done' then 100 else coalesce(p_progress, progress_pct) end where id = p_action;
  perform public.dm_log(a.decision_id, 'action_updated', d.status, d.status, jsonb_build_object('action_id', p_action, 'status', p_status));
end $$;

create or replace function public.dm_add_evidence(p_id uuid, p_action uuid, p_name text, p_path text, p_mime text, p_size bigint, p_desc text) returns uuid
language plpgsql security definer set search_path = public as $$
declare d public.decisions%rowtype; eid uuid;
begin
  select * into d from public.decisions where id = p_id;
  if not found then raise exception 'القرار غير موجود'; end if;
  perform public.dm_require('upload_evidence', p_id);
  if d.status not in ('assigned', 'executing', 'awaiting_update', 'returned') then raise exception 'لا تُرفع أدلة في هذه الحالة'; end if;
  if p_path is null or p_path not like p_id::text || '/%' then raise exception 'مسار الملف غير صالح'; end if;
  insert into public.decision_evidence(decision_id, action_id, file_name, storage_path, mime_type, size_bytes, description) values (p_id, p_action, p_name, p_path, p_mime, p_size, coalesce(p_desc, ''))
  returning id into eid;
  perform public.dm_log(p_id, 'evidence_added', d.status, d.status, jsonb_build_object('evidence_id', eid, 'file', p_name));
  return eid;
end $$;

-- مرفق مرجعي للقرار (مستند ذو صلة): لا يُعدّ دليل إنجاز ولا يخضع للمراجعة
create or replace function public.dm_add_reference(p_id uuid, p_name text, p_path text, p_mime text, p_size bigint, p_desc text) returns uuid
language plpgsql security definer set search_path = public as $$
declare d public.decisions%rowtype; eid uuid; uid uuid := auth.uid();
begin
  select * into d from public.decisions where id = p_id;
  if not found then raise exception 'القرار غير موجود'; end if;
  if not (public.dm_has_perm(uid, 'edit_draft', p_id) or public.dm_has_perm(uid, 'create', p_id) or public.dm_has_perm(uid, 'amend', p_id)) then raise exception 'لا تملك صلاحية إرفاق مستندات مرجعية'; end if;
  if d.status in ('closed', 'cancelled') then raise exception 'لا تُرفق مستندات لقرار مقفل أو ملغى'; end if;
  if p_path is null or p_path not like p_id::text || '/%' then raise exception 'مسار الملف غير صالح'; end if;
  insert into public.decision_evidence(decision_id, kind, file_name, storage_path, mime_type, size_bytes, description, review_status)
  values (p_id, 'reference', p_name, p_path, p_mime, p_size, coalesce(p_desc, ''), 'accepted') returning id into eid;
  perform public.dm_log(p_id, 'reference_added', d.status, d.status, jsonb_build_object('evidence_id', eid, 'file', p_name));
  return eid;
end $$;

-- ───────────── التحقق من الإنجاز والإقفال ─────────────
create or replace function public.dm_request_verification(p_id uuid, p_note text, p_all_done boolean) returns void
language plpgsql security definer set search_path = public as $$
declare d public.decisions%rowtype; n int; open_actions int;
begin
  select * into d from public.decisions where id = p_id for update;
  if not found then raise exception 'القرار غير موجود'; end if;
  perform public.dm_require('request_verification', p_id);
  if d.status not in ('assigned', 'executing', 'awaiting_update', 'returned') then raise exception 'لا يمكن طلب الاعتماد في هذه الحالة'; end if;
  if not coalesce(p_all_done, false) then raise exception 'أكّد أن جميع المخرجات المطلوبة أُنجزت'; end if;
  if d.progress_pct < 100 then raise exception 'نسبة الإنجاز المبلَّغ عنها يجب أن تكون 100%% قبل طلب الاعتماد'; end if;
  select count(*) into open_actions from public.decision_actions where decision_id = p_id and status in ('open', 'in_progress');
  if open_actions > 0 then raise exception 'توجد % إجراءات فرعية غير مكتملة', open_actions; end if;
  if coalesce((public.dm_setting('require_evidence'))::text = 'true', true) then
    select count(*) into n from public.decision_evidence where decision_id = p_id and kind = 'evidence' and review_status <> 'rejected';
    if n = 0 then raise exception 'أرفق دليل إنجاز واحدًا على الأقل'; end if;
  end if;
  insert into public.decision_verifications(decision_id, request_note) values (p_id, coalesce(p_note, ''));
  perform set_config('app.dm_rpc', 'on', true);
  update public.decisions set verification_requested_at = now() where id = p_id;
  perform public.dm_move(p_id, 'pending_verification', 'verification_requested', jsonb_build_object('note', p_note));
  perform public.dm_notify(public.dm_perm_holders('verify', d.committee_id), 'طلب اعتماد إنجاز قرار', d.ref_no || ' — ' || d.title);
end $$;

create or replace function public.dm_review_evidence(p_evidence uuid, p_accept boolean, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare e public.decision_evidence%rowtype; uid uuid;
begin
  select * into e from public.decision_evidence where id = p_evidence for update;
  if not found then raise exception 'الدليل غير موجود'; end if;
  uid := public.dm_require('review_evidence', e.decision_id);
  if e.kind <> 'evidence' then raise exception 'المرفقات المرجعية لا تُراجَع'; end if;
  if not p_accept and coalesce(btrim(p_note), '') = '' then raise exception 'سبب رفض الدليل مطلوب'; end if;
  update public.decision_evidence set review_status = case when p_accept then 'accepted' else 'rejected' end, review_note = p_note, reviewed_by = uid, reviewed_at = now() where id = p_evidence;
  perform public.dm_log(e.decision_id, 'evidence_reviewed', null, null, jsonb_build_object('evidence_id', p_evidence, 'accepted', p_accept, 'note', p_note));
end $$;

create or replace function public.dm_verify(p_id uuid, p_approve boolean, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare d public.decisions%rowtype; uid uuid; pend int; acc int;
begin
  select * into d from public.decisions where id = p_id for update;
  if not found then raise exception 'القرار غير موجود'; end if;
  uid := public.dm_require('verify', p_id);
  if d.status <> 'pending_verification' then raise exception 'القرار ليس بانتظار التحقق'; end if;
  if p_approve then
    select count(*) filter (where review_status = 'pending'), count(*) filter (where review_status = 'accepted') into pend, acc from public.decision_evidence where decision_id = p_id and kind = 'evidence';
    if pend > 0 then raise exception 'راجع % دليلًا لم يُراجَع بعد قبل الموافقة', pend; end if;
    if coalesce((public.dm_setting('require_evidence'))::text = 'true', true) and acc = 0 then raise exception 'لا يوجد دليل إنجاز مقبول'; end if;
    update public.decision_verifications set status = 'approved', reviewer_id = uid, reviewed_at = now(), review_note = p_note
     where id = (select id from public.decision_verifications where decision_id = p_id and status = 'pending' order by requested_at desc limit 1);
    perform set_config('app.dm_rpc', 'on', true);
    update public.decisions set completed_at = now() where id = p_id;
    perform public.dm_move(p_id, 'completed', 'verified', jsonb_build_object('note', p_note));
    perform public.dm_notify(public.dm_perm_holders('close', d.committee_id), 'إنجاز قرار معتمد بانتظار الإقفال', d.ref_no || ' — ' || d.title);
  else
    if coalesce(btrim(p_note), '') = '' then raise exception 'سبب الإعادة للاستكمال مطلوب'; end if;
    update public.decision_verifications set status = 'returned', reviewer_id = uid, reviewed_at = now(), review_note = p_note
     where id = (select id from public.decision_verifications where decision_id = p_id and status = 'pending' order by requested_at desc limit 1);
    perform public.dm_move(p_id, 'returned', 'verification_returned', jsonb_build_object('reason', p_note));
    perform public.dm_notify(array[d.owner_id], 'أُعيد القرار للاستكمال', d.ref_no || ' — ' || p_note);
  end if;
end $$;

create or replace function public.dm_close(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare d public.decisions%rowtype; uid uuid;
begin
  select * into d from public.decisions where id = p_id for update;
  if not found then raise exception 'القرار غير موجود'; end if;
  uid := public.dm_require('close', p_id);
  if d.status <> 'completed' then raise exception 'لا يُقفل القرار قبل اكتمال التحقق والاعتماد'; end if;
  if not exists (select 1 from public.decision_verifications where decision_id = p_id and status = 'approved') then raise exception 'لا يوجد اعتماد إنجاز'; end if;
  perform set_config('app.dm_rpc', 'on', true);
  update public.decisions set closed_at = now(), closed_by = uid where id = p_id;
  perform public.dm_move(p_id, 'closed', 'closed', jsonb_build_object('note', p_note));
  update public.tasks set status = 'مكتملة' where decision_id = p_id;
  perform public.dm_notify(array[d.owner_id], 'أُقفل القرار', d.ref_no || ' — ' || d.title);
end $$;

-- إعادة قرار مكتمل للاستكمال قبل الإقفال
create or replace function public.dm_return(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare d public.decisions%rowtype;
begin
  select * into d from public.decisions where id = p_id for update;
  if not found then raise exception 'القرار غير موجود'; end if;
  perform public.dm_require('close', p_id);
  if d.status <> 'completed' then raise exception 'الإعادة للقرار المكتمل قبل الإقفال فقط'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'السبب مطلوب'; end if;
  perform public.dm_move(p_id, 'returned', 'returned_before_closure', jsonb_build_object('reason', p_reason));
  perform public.dm_notify(array[d.owner_id], 'أُعيد القرار للاستكمال', d.ref_no || ' — ' || p_reason);
end $$;

create or replace function public.dm_cancel(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare d public.decisions%rowtype; uid uuid;
begin
  select * into d from public.decisions where id = p_id for update;
  if not found then raise exception 'القرار غير موجود'; end if;
  uid := public.dm_require('cancel', p_id);
  if d.status in ('closed', 'cancelled') then raise exception 'لا يُلغى قرار مقفل أو ملغى'; end if;
  if char_length(coalesce(btrim(p_reason), '')) < 5 then raise exception 'سبب الإلغاء مطلوب (5 أحرف فأكثر)'; end if;
  perform set_config('app.dm_rpc', 'on', true);
  update public.decisions set cancelled_at = now(), cancelled_by = uid, cancel_reason = p_reason where id = p_id;
  perform public.dm_move(p_id, 'cancelled', 'cancelled', jsonb_build_object('reason', p_reason));
  perform public.dm_notify(array[d.owner_id, d.created_by], 'أُلغي القرار', d.ref_no || ' — ' || p_reason);
end $$;

-- ───────────── التمديد والتوجيهات وتعديل النص ─────────────
create or replace function public.dm_request_extension(p_id uuid, p_new_due date, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare d public.decisions%rowtype; rid uuid;
begin
  select * into d from public.decisions where id = p_id for update;
  if not found then raise exception 'القرار غير موجود'; end if;
  perform public.dm_require('request_extension', p_id);
  if d.status not in ('assigned', 'executing', 'awaiting_update', 'returned', 'pending_verification') then raise exception 'لا يُطلب تمديد في هذه الحالة'; end if;
  if d.due_date is null or p_new_due is null or p_new_due <= d.due_date then raise exception 'الموعد المقترح يجب أن يكون بعد الموعد الحالي'; end if;
  if char_length(coalesce(btrim(p_reason), '')) < 5 then raise exception 'سبب التمديد مطلوب'; end if;
  if exists (select 1 from public.decision_extensions where decision_id = p_id and status = 'pending') then raise exception 'يوجد طلب تمديد قيد الدراسة'; end if;
  insert into public.decision_extensions(decision_id, current_due, requested_due, reason) values (p_id, d.due_date, p_new_due, btrim(p_reason)) returning id into rid;
  perform public.dm_log(p_id, 'extension_requested', d.status, d.status, jsonb_build_object('request_id', rid, 'from', d.due_date, 'to', p_new_due, 'reason', p_reason));
  perform public.dm_notify(public.dm_perm_holders('approve_extension', d.committee_id) || public.dm_perm_holders('approve_extension_limited', d.committee_id), 'طلب تمديد مدة قرار', d.ref_no || ' — حتى ' || p_new_due);
  return rid;
end $$;

create or replace function public.dm_decide_extension(p_req uuid, p_approve boolean, p_note text, p_due date default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.decision_extensions%rowtype; d public.decisions%rowtype; uid uuid := auth.uid(); newdue date; days int; limit_days int;
begin
  select * into r from public.decision_extensions where id = p_req for update;
  if not found then raise exception 'الطلب غير موجود'; end if;
  select * into d from public.decisions where id = r.decision_id for update;
  if r.status <> 'pending' then raise exception 'الطلب محسوم مسبقًا'; end if;
  newdue := coalesce(p_due, r.requested_due);
  days := newdue - d.due_date;
  limit_days := coalesce((public.dm_setting('secretary_ext_days'))::int, 14);
  if not (public.dm_has_perm(uid, 'approve_extension', d.id) or (public.dm_has_perm(uid, 'approve_extension_limited', d.id) and days <= limit_days)) then
    raise exception 'لا تملك صلاحية البت في هذا التمديد (الحد لأمين السر % يومًا)', limit_days;
  end if;
  if public.dm_is_executor(uid, d.id) then raise exception 'لا يبتّ في التمديد من يتولى تنفيذ القرار'; end if;
  if p_approve then
    if newdue <= d.due_date then raise exception 'الموعد الجديد يجب أن يكون بعد الموعد الحالي'; end if;
    update public.decision_extensions set status = 'approved', decided_by = uid, decided_at = now(), decision_note = p_note, approved_due = newdue where id = p_req;
    perform set_config('app.dm_rpc', 'on', true);
    update public.decisions set due_date = newdue, extension_count = extension_count + 1 where id = d.id;   -- original_due_date يبقى للمقارنة
    update public.tasks set due_date = newdue where decision_id = d.id;
    perform public.dm_log(d.id, 'extension_approved', d.status, d.status, jsonb_build_object('request_id', p_req, 'new_due', newdue, 'original_due', d.original_due_date));
  else
    if coalesce(btrim(p_note), '') = '' then raise exception 'سبب الرفض مطلوب'; end if;
    update public.decision_extensions set status = 'rejected', decided_by = uid, decided_at = now(), decision_note = p_note where id = p_req;
    perform public.dm_log(d.id, 'extension_rejected', d.status, d.status, jsonb_build_object('request_id', p_req, 'note', p_note));
  end if;
  perform public.dm_notify(array[r.requested_by, d.owner_id], case when p_approve then 'اعتُمد تمديد مدة القرار' else 'رُفض تمديد مدة القرار' end, d.ref_no || ' — ' || coalesce(p_note, ''));
end $$;

create or replace function public.dm_issue_directive(p_id uuid, p_meeting uuid, p_kind text, p_text text) returns uuid
language plpgsql security definer set search_path = public as $$
declare d public.decisions%rowtype; did uuid;
begin
  select * into d from public.decisions where id = p_id;
  if not found then raise exception 'القرار غير موجود'; end if;
  perform public.dm_require('direct', p_id);
  if not public.dm_can_view(auth.uid(), p_id) then raise exception 'لا تملك الاطلاع على هذا القرار'; end if;
  if p_kind not in ('clarification', 'directive', 'reassign_request', 'extension_request', 'close_recommendation') then raise exception 'نوع التوجيه غير صالح'; end if;
  if char_length(coalesce(btrim(p_text), '')) < 3 then raise exception 'نص التوجيه مطلوب'; end if;
  insert into public.decision_directives(decision_id, meeting_id, kind, body) values (p_id, p_meeting, p_kind, btrim(p_text)) returning id into did;
  perform public.dm_log(p_id, 'directive', d.status, d.status, jsonb_build_object('directive_id', did, 'kind', p_kind, 'meeting_id', p_meeting, 'text', left(p_text, 300)));
  perform public.dm_notify(array[d.owner_id] || public.dm_role_holders('secretary', d.committee_id), 'توجيه جديد على قرار', d.ref_no || ' — ' || left(p_text, 140));
  return did;
end $$;

create or replace function public.dm_amend_text(p_id uuid, p_text text, p_basis text) returns void
language plpgsql security definer set search_path = public as $$
declare d public.decisions%rowtype; uid uuid; v int;
begin
  select * into d from public.decisions where id = p_id for update;
  if not found then raise exception 'القرار غير موجود'; end if;
  uid := public.dm_require('amend', p_id);
  if d.status in ('draft', 'closed', 'cancelled') then raise exception 'لا يُعدَّل النص بإجراء رسمي في هذه الحالة'; end if;
  if char_length(coalesce(btrim(p_text), '')) < 3 or char_length(coalesce(btrim(p_basis), '')) < 5 then raise exception 'النص الجديد وسند التعديل مطلوبان'; end if;
  v := d.text_version + 1;
  insert into public.decision_text_versions(decision_id, version, body_text, changed_by, basis) values (p_id, v, btrim(p_text), uid, btrim(p_basis));
  perform set_config('app.dm_rpc', 'on', true);
  update public.decisions set body_text = btrim(p_text), text_version = v where id = p_id;
  perform public.dm_log(p_id, 'text_amended', d.status, d.status, jsonb_build_object('version', v, 'basis', p_basis));
  perform public.dm_notify(array[d.owner_id], 'تعديل نص قرار', d.ref_no || ' — ' || p_basis);
end $$;

-- ───────────── الأدوار والإعدادات ─────────────
create or replace function public.dm_grant_role(p_user uuid, p_role text, p_committee uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  perform public.dm_require('manage_roles');
  if p_role not in ('admin', 'secretary', 'chair', 'member', 'executor', 'unit_manager', 'governance', 'auditor') then raise exception 'دور غير معروف'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'المستخدم غير موجود'; end if;
  insert into public.dm_user_roles(user_id, role, committee_id) values (p_user, p_role, p_committee)
  on conflict (user_id, role, committee_id) do update set is_active = true, granted_by = auth.uid(), granted_at = now() returning id into rid;
  perform public.dm_notify(array[p_user] || public.dm_role_holders('governance', p_committee), 'منح دور في إدارة القرارات', p_role);
  return rid;
end $$;

create or replace function public.dm_revoke_role(p_role_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.dm_require('manage_roles');
  update public.dm_user_roles set is_active = false where id = p_role_id;
end $$;

create or replace function public.dm_set_setting(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.dm_require('manage_settings');
  if p_key not in ('reminder_days', 'late_alert_days', 'escalation', 'report_escalation_days', 'stale_days', 'require_evidence', 'require_approved_minute', 'require_minute_link',
                   'secretary_ext_days', 'measure_against', 'email_notifications') then raise exception 'إعداد غير معروف'; end if;
  if p_key in ('reminder_days', 'late_alert_days') and (jsonb_typeof(p_value) <> 'array' or exists (
       select 1 from jsonb_array_elements(p_value) e where case when jsonb_typeof(e) = 'number' then ((e)::text::numeric < 0 or (e)::text::numeric > 90) else true end)) then
    raise exception 'قيم الأيام يجب أن تكون أرقامًا بين 0 و90';
  end if;
  if p_key = 'escalation' and (jsonb_typeof(p_value) <> 'array' or exists (select 1 from jsonb_array_elements(p_value) e where not (e ? 'days') or not (e ? 'level') or (e->>'level') not in ('unit_head', 'upper'))) then
    raise exception 'قواعد التصعيد غير صالحة';
  end if;
  if p_key in ('stale_days', 'report_escalation_days', 'secretary_ext_days') and (jsonb_typeof(p_value) <> 'number' or (p_value)::text::numeric < 1) then raise exception 'القيمة يجب أن تكون رقمًا موجبًا'; end if;
  if p_key in ('require_evidence', 'require_approved_minute', 'require_minute_link', 'email_notifications') and jsonb_typeof(p_value) <> 'boolean' then raise exception 'القيمة يجب أن تكون صح/خطأ'; end if;
  if p_key = 'measure_against' and p_value not in ('"current"', '"original"') then raise exception 'القيمة current أو original'; end if;
  insert into public.dm_settings(key, value, updated_by) values (p_key, p_value, auth.uid())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
end $$;

-- لا تُمنح الصلاحيات الحساسة لدور مدير النظام التقني مهما كان
create or replace function public.dm_set_permission(p_role text, p_perm text, p_allow boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.dm_require('manage_settings');
  if p_role = 'admin' and p_perm in ('approve', 'ratify', 'close', 'verify', 'review_evidence', 'cancel', 'amend', 'assign', 'reassign', 'approve_extension', 'approve_extension_limited', 'view_scope') then
    raise exception 'لا تُمنح هذه الصلاحية لدور مدير النظام (فصل الصلاحيات الإدارية التقنية عن صلاحيات القرار)';
  end if;
  if p_allow then insert into public.dm_role_permissions(role, permission) values (p_role, p_perm) on conflict do nothing;
  else delete from public.dm_role_permissions where role = p_role and permission = p_perm; end if;
end $$;

-- ───────────── RLS والامتيازات ─────────────
do $$
declare t text;
begin
  foreach t in array array['org_units', 'org_unit_members', 'dm_user_roles', 'dm_role_permissions', 'dm_settings', 'dm_counters', 'dm_transitions', 'decisions', 'decision_text_versions',
                           'decision_assistants', 'decision_actions', 'decision_updates', 'decision_evidence', 'decision_verifications', 'decision_extensions', 'decision_directives',
                           'decision_events', 'decision_alerts', 'dm_reports'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
revoke all on public.dm_counters, public.decision_alerts from authenticated;

drop policy if exists d_read on public.decisions;
create policy d_read on public.decisions for select to authenticated using (public.dm_can_view(auth.uid(), id));
do $$
declare t text;
begin
  foreach t in array array['decision_text_versions', 'decision_assistants', 'decision_actions', 'decision_updates', 'decision_evidence', 'decision_verifications', 'decision_extensions', 'decision_directives', 'decision_events'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (exists (select 1 from public.decisions d where d.id = decision_id))', t || '_read', t);
  end loop;
end $$;

drop policy if exists ou_read on public.org_units;
create policy ou_read on public.org_units for select to authenticated using (true);
drop policy if exists ou_write on public.org_units;
create policy ou_write on public.org_units for all to authenticated using (public.dm_has_perm(auth.uid(), 'manage_settings')) with check (public.dm_has_perm(auth.uid(), 'manage_settings'));
grant insert, update, delete on public.org_units, public.org_unit_members to authenticated;
drop policy if exists oum_read on public.org_unit_members;
create policy oum_read on public.org_unit_members for select to authenticated using (true);
drop policy if exists oum_write on public.org_unit_members;
create policy oum_write on public.org_unit_members for all to authenticated using (public.dm_has_perm(auth.uid(), 'manage_settings')) with check (public.dm_has_perm(auth.uid(), 'manage_settings'));

drop policy if exists ur_read on public.dm_user_roles;
create policy ur_read on public.dm_user_roles for select to authenticated
  using (user_id = auth.uid() or public.dm_has_perm(auth.uid(), 'manage_roles') or public.dm_has_perm(auth.uid(), 'audit_read'));
drop policy if exists rp_read on public.dm_role_permissions;
create policy rp_read on public.dm_role_permissions for select to authenticated using (true);
drop policy if exists st_read on public.dm_settings;
create policy st_read on public.dm_settings for select to authenticated using (true);
drop policy if exists tr_read on public.dm_transitions;
create policy tr_read on public.dm_transitions for select to authenticated using (true);
drop policy if exists rep_read on public.dm_reports;
create policy rep_read on public.dm_reports for select to authenticated
  using (generated_by = auth.uid() or public.dm_has_perm(auth.uid(), 'export') or public.dm_has_perm(auth.uid(), 'audit_read'));

-- دوال تُستدعى من العميل
do $$
declare f text;
begin
  foreach f in array array[
    'dm_create_decision(jsonb)', 'dm_update_draft(uuid,jsonb)', 'dm_submit(uuid)', 'dm_return_to_draft(uuid,text)', 'dm_approve(uuid)', 'dm_ratify(uuid)',
    'dm_assign(uuid,uuid,uuid,date,text,text,uuid[])', 'dm_reassign(uuid,uuid,uuid,text)', 'dm_post_update(uuid,text,int,text,date)', 'dm_add_action(uuid,text,uuid,uuid,date)',
    'dm_set_action(uuid,text,int)', 'dm_add_evidence(uuid,uuid,text,text,text,bigint,text)', 'dm_add_reference(uuid,text,text,text,bigint,text)', 'dm_request_verification(uuid,text,boolean)', 'dm_review_evidence(uuid,boolean,text)',
    'dm_verify(uuid,boolean,text)', 'dm_close(uuid,text)', 'dm_return(uuid,text)', 'dm_cancel(uuid,text)', 'dm_request_extension(uuid,date,text)',
    'dm_decide_extension(uuid,boolean,text,date)', 'dm_issue_directive(uuid,uuid,text,text)', 'dm_amend_text(uuid,text,text)', 'dm_grant_role(uuid,text,uuid)',
    'dm_revoke_role(uuid)', 'dm_set_setting(text,jsonb)', 'dm_set_permission(text,text,boolean)', 'dm_has_perm(uuid,text,uuid,uuid)', 'dm_can_view(uuid,uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
-- الدوال الداخلية لا تُستدعى من العميل مباشرة
revoke execute on function public.dm_log(uuid, text, text, text, jsonb), public.dm_notify(uuid[], text, text), public.dm_move(uuid, text, text, jsonb), public.dm_next_ref(text, int),
  public.dm_require(text, uuid, uuid), public.dm_role_holders(text, uuid), public.dm_perm_holders(text, uuid), public.dm_is_executor(uuid, uuid), public.dm_platform_admin(uuid) from public, anon, authenticated;

-- ───────────── التدقيق العام ─────────────
do $$
declare t text;
begin
  if to_regprocedure('public.audit_trg()') is not null then
    foreach t in array array['decisions', 'decision_actions', 'decision_evidence', 'decision_extensions', 'decision_directives', 'dm_user_roles', 'dm_settings', 'dm_role_permissions', 'org_units'] loop
      execute format('drop trigger if exists trg_audit on public.%I', t);
      execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.audit_trg()', t);
    end loop;
  end if;
end $$;

-- ───────────── مخزن أدلة الإنجاز (خاص) ─────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('decision-files', 'decision-files', false, 15728640, array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'image/png', 'image/jpeg', 'image/webp', 'text/plain'])
on conflict (id) do update set public = false, file_size_limit = 15728640;

drop policy if exists dm_files_insert on storage.objects;
create policy dm_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'decision-files' and (public.dm_has_perm(auth.uid(), 'upload_evidence', ((storage.foldername(name))[1])::uuid)
    or public.dm_has_perm(auth.uid(), 'edit_draft', ((storage.foldername(name))[1])::uuid) or public.dm_has_perm(auth.uid(), 'create', ((storage.foldername(name))[1])::uuid)));
drop policy if exists dm_files_read on storage.objects;
create policy dm_files_read on storage.objects for select to authenticated
  using (bucket_id = 'decision-files' and public.dm_can_view(auth.uid(), ((storage.foldername(name))[1])::uuid));

commit;
