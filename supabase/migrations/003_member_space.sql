-- مساحتي والاجتماعات: الساعات التطوعية، طلبات الضيافة، بلاغات الأزمات والطوارئ
-- يعتمد على الترحيل 001 (الدوال is_admin و is_present والمشغّل audit_trg)، فنفّذه أولًا.
-- [افتراض] profiles(id) هو مفتاح أساسي uuid، و meetings(id) uuid، و notifications(user_id, title, body).
-- [افتراض] المدير = public.is_admin() (role_code ∈ admin, secretary). لا يوجد دور "ضيافة" مستقل بعد؛ المدير يعالج الطلبات.

begin;

-- ───────────── الساعات التطوعية ─────────────
create table if not exists public.volunteer_hours (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() constraint volunteer_hours_user_id_fkey references public.profiles(id) on delete cascade,
  meeting_id  uuid references public.meetings(id) on delete set null,
  work_date   date not null check (work_date <= current_date),
  hours       numeric(4,1) not null check (hours >= 0.5 and hours <= 24),
  activity    text not null check (char_length(activity) between 1 and 300),
  status      text not null default 'قيد المراجعة' check (status in ('قيد المراجعة', 'معتمدة', 'مرفوضة')),
  review_note text check (char_length(review_note) <= 300),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists volunteer_hours_user_idx on public.volunteer_hours(user_id, work_date desc);
alter table public.volunteer_hours enable row level security;

create or replace function public.guard_volunteer_hours() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.user_id := auth.uid(); new.status := 'قيد المراجعة';
    new.reviewed_by := null; new.reviewed_at := null; new.review_note := null;
    return new;
  end if;
  -- التعديل للمراجِع فقط، ولا يغيّر سوى القرار والملاحظة
  if to_jsonb(new) - array['status','review_note','reviewed_by','reviewed_at']
     is distinct from to_jsonb(old) - array['status','review_note','reviewed_by','reviewed_at'] then
    raise exception 'لا يمكن تعديل بيانات التسجيل بعد إرساله';
  end if;
  new.reviewed_by := auth.uid(); new.reviewed_at := now();
  return new;
end $$;
drop trigger if exists trg_guard_volunteer_hours on public.volunteer_hours;
create trigger trg_guard_volunteer_hours before insert or update on public.volunteer_hours
  for each row execute function public.guard_volunteer_hours();

drop policy if exists vh_select on public.volunteer_hours;
create policy vh_select on public.volunteer_hours for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists vh_insert on public.volunteer_hours;
create policy vh_insert on public.volunteer_hours for insert to authenticated with check (user_id = auth.uid());
drop policy if exists vh_review on public.volunteer_hours;
create policy vh_review on public.volunteer_hours for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists vh_delete on public.volunteer_hours;
create policy vh_delete on public.volunteer_hours for delete to authenticated
  using ((user_id = auth.uid() and status = 'قيد المراجعة') or public.is_admin());

-- ───────────── طلبات الضيافة ─────────────
create table if not exists public.hospitality_requests (
  id           uuid primary key default gen_random_uuid(),
  meeting_id   uuid not null references public.meetings(id) on delete cascade,
  requested_by uuid not null default auth.uid() constraint hospitality_requests_requested_by_fkey references public.profiles(id) on delete cascade,
  items        text[] not null check (cardinality(items) between 1 and 12),
  people       int not null default 1 check (people between 1 and 500),
  location     text not null default '' check (char_length(location) <= 120),
  notes        text not null default '' check (char_length(notes) <= 300),
  priority     text not null default 'عادي' check (priority in ('عادي', 'عاجل')),
  status       text not null default 'جديد' check (status in ('جديد', 'قيد التجهيز', 'تم التسليم', 'ملغي')),
  handled_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists hospitality_meeting_idx on public.hospitality_requests(meeting_id, created_at desc);
alter table public.hospitality_requests enable row level security;

create or replace function public.guard_hospitality() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.requested_by := auth.uid(); new.status := 'جديد'; new.handled_by := null;
    if not (public.is_admin() or public.is_present(new.meeting_id, auth.uid())
            or exists (select 1 from public.meetings m where m.id = new.meeting_id and m.created_by = auth.uid())) then
      raise exception 'طلب الضيافة للحاضرين في الاجتماع أو منظّمه أو المدير';
    end if;
    return new;
  end if;
  if not public.is_admin() then
    -- صاحب الطلب يستطيع إلغاءه فقط وهو ما زال "جديد"
    if old.requested_by is distinct from auth.uid() or old.status <> 'جديد' or new.status <> 'ملغي'
       or to_jsonb(new) - array['status','updated_at','handled_by'] is distinct from to_jsonb(old) - array['status','updated_at','handled_by'] then
      raise exception 'لا تملك صلاحية تعديل هذا الطلب';
    end if;
  else
    new.handled_by := auth.uid();
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_guard_hospitality on public.hospitality_requests;
create trigger trg_guard_hospitality before insert or update on public.hospitality_requests
  for each row execute function public.guard_hospitality();

drop policy if exists hr_select on public.hospitality_requests;
create policy hr_select on public.hospitality_requests for select to authenticated using (requested_by = auth.uid() or public.is_admin());
drop policy if exists hr_insert on public.hospitality_requests;
create policy hr_insert on public.hospitality_requests for insert to authenticated with check (requested_by = auth.uid());
drop policy if exists hr_update on public.hospitality_requests;
create policy hr_update on public.hospitality_requests for update to authenticated
  using (public.is_admin() or requested_by = auth.uid()) with check (public.is_admin() or requested_by = auth.uid());

-- ───────────── الأزمات والطوارئ ─────────────
create table if not exists public.incidents (
  id              uuid primary key default gen_random_uuid(),
  meeting_id      uuid references public.meetings(id) on delete set null,
  reported_by     uuid not null default auth.uid() constraint incidents_reported_by_fkey references public.profiles(id) on delete cascade,
  kind            text not null check (kind in ('مشكلة تقنية', 'انقطاع الاتصال', 'طارئ صحي', 'إخلاء', 'خلل أمني', 'تسريب معلومات', 'أخرى')),
  severity        text not null check (severity in ('منخفضة', 'متوسطة', 'عالية', 'حرجة')),
  description     text not null check (char_length(description) between 1 and 1000),
  status          text not null default 'مفتوحة' check (status in ('مفتوحة', 'قيد المعالجة', 'تم الحل')),
  resolution_note text check (char_length(resolution_note) <= 500),
  resolved_by     uuid references public.profiles(id),
  resolved_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists incidents_status_idx on public.incidents(status, created_at desc);
alter table public.incidents enable row level security;

create or replace function public.guard_incidents() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.reported_by := auth.uid(); new.status := 'مفتوحة';
    new.resolution_note := null; new.resolved_by := null; new.resolved_at := null;
    return new;
  end if;
  if to_jsonb(new) - array['status','resolution_note','resolved_by','resolved_at']
     is distinct from to_jsonb(old) - array['status','resolution_note','resolved_by','resolved_at'] then
    raise exception 'لا يمكن تعديل نص البلاغ بعد إرساله';
  end if;
  if new.status = 'تم الحل' then new.resolved_by := auth.uid(); new.resolved_at := now(); end if;
  return new;
end $$;
drop trigger if exists trg_guard_incidents on public.incidents;
create trigger trg_guard_incidents before insert or update on public.incidents
  for each row execute function public.guard_incidents();

drop policy if exists inc_select on public.incidents;
create policy inc_select on public.incidents for select to authenticated using (reported_by = auth.uid() or public.is_admin());
drop policy if exists inc_insert on public.incidents;
create policy inc_insert on public.incidents for insert to authenticated with check (reported_by = auth.uid());
drop policy if exists inc_update on public.incidents;
create policy inc_update on public.incidents for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ───────────── إشعار المديرين عند بلاغ أو طلب ضيافة (لا يوقف الحفظ إن فشل) ─────────────
create or replace function public.notify_admins() returns trigger
language plpgsql security definer set search_path = public as $$
declare t text; b text;
begin
  if tg_table_name = 'incidents' then
    t := case when new.severity in ('عالية', 'حرجة') then 'بلاغ طارئ — ' else 'بلاغ جديد — ' end || new.kind;
    b := left(new.description, 200);
  else
    t := 'طلب ضيافة جديد' || case when new.priority = 'عاجل' then ' (عاجل)' else '' end;
    b := array_to_string(new.items, '، ') || ' — ' || new.people || ' شخص';
  end if;
  begin
    insert into public.notifications(user_id, title, body)
    select p.id, t, b from public.profiles p
     where coalesce(p.role_code, p.role) in ('admin', 'secretary') and coalesce(p.is_active, true);
  exception when others then
    raise warning 'تعذر إشعار المديرين: %', sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists trg_notify_incident on public.incidents;
create trigger trg_notify_incident after insert on public.incidents for each row execute function public.notify_admins();
drop trigger if exists trg_notify_hospitality on public.hospitality_requests;
create trigger trg_notify_hospitality after insert on public.hospitality_requests for each row execute function public.notify_admins();

-- ───────────── التدقيق (إن كانت دالة 001 موجودة) ─────────────
do $$
declare t text;
begin
  if to_regprocedure('public.audit_trg()') is not null then
    foreach t in array array['volunteer_hours', 'hospitality_requests', 'incidents'] loop
      execute format('drop trigger if exists trg_audit on public.%I', t);
      execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.audit_trg()', t);
    end loop;
  end if;
end $$;

commit;
