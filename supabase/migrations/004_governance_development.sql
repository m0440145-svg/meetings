-- الحوكمة والتوثيق + الذكاء والتطوير: الانتخابات، مرجع الأنظمة، الأفكار والأثر، القاعات وحجزها
-- يعتمد على الترحيل 001 (is_admin, is_present, audit_trg). [افتراض] profiles(id) و meetings(id) و committees(id) و committee_members(committee_id, user_id) من نوع uuid.
-- التقارير والأرشفة ومؤشرات الامتثال والنضج تُحسب في الواجهة من الجداول الموجودة ولا تحتاج جداول جديدة.

begin;

-- ───────────── مرجع الأنظمة ─────────────
create table if not exists public.regulations (
  id             uuid primary key default gen_random_uuid(),
  title          text not null check (char_length(title) between 1 and 200),
  category       text not null default 'عام' check (char_length(category) <= 60),
  version        text not null default '' check (char_length(version) <= 30),
  summary        text not null default '' check (char_length(summary) <= 1000),
  url            text check (url is null or url = '' or url ~ '^https://'),
  effective_date date,
  status         text not null default 'ساري' check (status in ('ساري', 'قيد المراجعة', 'ملغى')),
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.regulations enable row level security;
drop policy if exists reg_read on public.regulations;
create policy reg_read on public.regulations for select to authenticated using (true);
drop policy if exists reg_write on public.regulations;
create policy reg_write on public.regulations for all to authenticated using (public.is_admin()) with check (public.is_admin());
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists trg_touch_regulations on public.regulations;
create trigger trg_touch_regulations before update on public.regulations for each row execute function public.touch_updated_at();

-- ───────────── الأفكار والأثر ─────────────
create table if not exists public.ideas (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null default auth.uid() constraint ideas_author_id_fkey references public.profiles(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 150),
  description text not null default '' check (char_length(description) <= 1000),
  category    text not null default 'عام' check (char_length(category) <= 60),
  status      text not null default 'مقترحة' check (status in ('مقترحة', 'قيد الدراسة', 'معتمدة', 'منفذة', 'مرفوضة')),
  impact_note text not null default '' check (char_length(impact_note) <= 500),
  impact_score smallint check (impact_score between 1 and 5),
  updated_by  uuid,
  created_at  timestamptz not null default now()
);
create table if not exists public.idea_votes (
  idea_id uuid not null references public.ideas(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  primary key (idea_id, user_id)
);
alter table public.ideas enable row level security;
alter table public.idea_votes enable row level security;

create or replace function public.guard_ideas() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.author_id := auth.uid(); new.status := 'مقترحة'; new.impact_note := ''; new.impact_score := null; new.updated_by := null;
    return new;
  end if;
  if to_jsonb(new) - array['status','impact_note','impact_score','updated_by']
     is distinct from to_jsonb(old) - array['status','impact_note','impact_score','updated_by'] then
    raise exception 'لا يمكن تعديل نص الفكرة بعد إرسالها';
  end if;
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists trg_guard_ideas on public.ideas;
create trigger trg_guard_ideas before insert or update on public.ideas for each row execute function public.guard_ideas();

drop policy if exists ideas_read on public.ideas;
create policy ideas_read on public.ideas for select to authenticated using (true);
drop policy if exists ideas_insert on public.ideas;
create policy ideas_insert on public.ideas for insert to authenticated with check (author_id = auth.uid());
drop policy if exists ideas_admin_update on public.ideas;
create policy ideas_admin_update on public.ideas for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists ideas_delete on public.ideas;
create policy ideas_delete on public.ideas for delete to authenticated
  using (public.is_admin() or (author_id = auth.uid() and status = 'مقترحة'));
drop policy if exists iv_read on public.idea_votes;
create policy iv_read on public.idea_votes for select to authenticated using (true);
drop policy if exists iv_insert on public.idea_votes;
create policy iv_insert on public.idea_votes for insert to authenticated with check (user_id = auth.uid());
drop policy if exists iv_delete on public.idea_votes;
create policy iv_delete on public.idea_votes for delete to authenticated using (user_id = auth.uid());

-- ───────────── القاعات وحجزها ─────────────
create table if not exists public.halls (
  id        uuid primary key default gen_random_uuid(),
  name      text not null unique check (char_length(name) between 1 and 100),
  capacity  int not null default 10 check (capacity between 1 and 2000),
  features  text[] not null default '{}',
  notes     text not null default '' check (char_length(notes) <= 300),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.hall_bookings (
  id         uuid primary key default gen_random_uuid(),
  hall_id    uuid not null references public.halls(id) on delete cascade,
  meeting_id uuid references public.meetings(id) on delete cascade,
  booked_by  uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  start_at   timestamptz not null,
  end_at     timestamptz not null,
  status     text not null default 'مؤكد' check (status in ('مؤكد', 'ملغي')),
  created_at timestamptz not null default now(),
  check (end_at > start_at and end_at - start_at <= interval '24 hours')
);
create index if not exists hall_bookings_hall_idx on public.hall_bookings(hall_id, start_at);
alter table public.halls enable row level security;
alter table public.hall_bookings enable row level security;

create or replace function public.guard_hall_booking() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.booked_by := auth.uid(); new.status := 'مؤكد';
    if not (public.is_admin() or (new.meeting_id is not null and exists (
              select 1 from public.meetings m where m.id = new.meeting_id and m.created_by = auth.uid()))) then
      raise exception 'حجز القاعة للمدير أو لمنظّم الاجتماع المرتبط';
    end if;
  else
    if not public.is_admin() and (old.booked_by is distinct from auth.uid()
       or to_jsonb(new) - array['status'] is distinct from to_jsonb(old) - array['status'] or new.status <> 'ملغي') then
      raise exception 'يمكنك إلغاء حجزك فقط';
    end if;
  end if;
  if new.status = 'مؤكد' then
    perform pg_advisory_xact_lock(hashtext(new.hall_id::text));  -- يمنع حجزين متزامنين لنفس القاعة
    if not exists (select 1 from public.halls h where h.id = new.hall_id and h.is_active) then
      raise exception 'القاعة غير متاحة';
    end if;
    if exists (select 1 from public.hall_bookings b
               where b.hall_id = new.hall_id and b.status = 'مؤكد' and b.id <> new.id
                 and tstzrange(b.start_at, b.end_at) && tstzrange(new.start_at, new.end_at)) then
      raise exception 'القاعة محجوزة في هذه الفترة';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_hall_booking on public.hall_bookings;
create trigger trg_guard_hall_booking before insert or update on public.hall_bookings for each row execute function public.guard_hall_booking();

drop policy if exists halls_read on public.halls;
create policy halls_read on public.halls for select to authenticated using (true);
drop policy if exists halls_write on public.halls;
create policy halls_write on public.halls for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists hb_read on public.hall_bookings;
create policy hb_read on public.hall_bookings for select to authenticated using (true);
drop policy if exists hb_insert on public.hall_bookings;
create policy hb_insert on public.hall_bookings for insert to authenticated with check (booked_by = auth.uid());
drop policy if exists hb_update on public.hall_bookings;
create policy hb_update on public.hall_bookings for update to authenticated
  using (public.is_admin() or booked_by = auth.uid()) with check (public.is_admin() or booked_by = auth.uid());

-- ───────────── الترشيحات والانتخابات (اقتراع سري) ─────────────
create table if not exists public.elections (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(title) between 1 and 150),
  committee_id uuid references public.committees(id) on delete set null,
  seats        int not null default 1 check (seats between 1 and 20),
  status       text not null default 'ترشيح' check (status in ('ترشيح', 'تصويت', 'مغلقة')),
  result       jsonb,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  closed_at    timestamptz
);
create table if not exists public.election_candidates (
  id          uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections(id) on delete cascade,
  user_id     uuid not null constraint election_candidates_user_id_fkey references public.profiles(id) on delete cascade,
  statement   text not null default '' check (char_length(statement) <= 500),
  status      text not null default 'مرشح' check (status in ('مرشح', 'منسحب')),
  created_at  timestamptz not null default now(),
  unique (election_id, user_id)
);
create table if not exists public.election_participation (
  election_id uuid not null references public.elections(id) on delete cascade,
  user_id     uuid not null references auth.users(id),
  primary key (election_id, user_id)
);
-- الأصوات بلا هوية ولا وقت
create table if not exists public.election_ballots (
  election_id  uuid not null references public.elections(id) on delete cascade,
  candidate_id uuid not null references public.election_candidates(id) on delete cascade
);
create index if not exists election_ballots_idx on public.election_ballots(election_id);
alter table public.elections enable row level security;
alter table public.election_candidates enable row level security;
alter table public.election_participation enable row level security;
alter table public.election_ballots enable row level security;  -- بلا سياسات: عبر الدوال فقط
revoke all on public.election_ballots from anon, authenticated;

create or replace function public.guard_elections() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'ترشيح'; new.result := null; new.closed_at := null; new.created_by := auth.uid();
    return new;
  end if;
  if current_setting('app.rpc', true) is distinct from 'on'
     and (new.status is distinct from old.status or new.result is distinct from old.result or new.closed_at is distinct from old.closed_at
          or new.seats is distinct from old.seats) then
    raise exception 'تُدار مراحل الانتخاب عبر الدوال المخصصة فقط';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_elections on public.elections;
create trigger trg_guard_elections before insert or update on public.elections for each row execute function public.guard_elections();

create or replace function public.guard_candidates() returns trigger
language plpgsql security definer set search_path = public as $$
declare e public.elections%rowtype;
begin
  select * into e from public.elections where id = new.election_id;
  if tg_op = 'INSERT' then
    if e.status <> 'ترشيح' then raise exception 'باب الترشيح مغلق'; end if;
    if not public.is_admin() and new.user_id <> auth.uid() then raise exception 'الترشيح لنفسك فقط'; end if;
    if e.committee_id is not null and not exists (select 1 from public.committee_members cm where cm.committee_id = e.committee_id and cm.user_id = new.user_id) then
      raise exception 'الترشح لأعضاء اللجنة فقط';
    end if;
    new.status := 'مرشح';
  else
    if to_jsonb(new) - array['status'] is distinct from to_jsonb(old) - array['status'] then raise exception 'لا يمكن تعديل بيانات الترشح'; end if;
    if e.status <> 'ترشيح' then raise exception 'انتهت مرحلة الترشيح'; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_candidates on public.election_candidates;
create trigger trg_guard_candidates before insert or update on public.election_candidates for each row execute function public.guard_candidates();

drop policy if exists el_read on public.elections;
create policy el_read on public.elections for select to authenticated using (true);
drop policy if exists el_admin on public.elections;
create policy el_admin on public.elections for insert to authenticated with check (public.is_admin());
drop policy if exists ec_read on public.election_candidates;
create policy ec_read on public.election_candidates for select to authenticated using (true);
drop policy if exists ec_insert on public.election_candidates;
create policy ec_insert on public.election_candidates for insert to authenticated with check (user_id = auth.uid() or public.is_admin());
drop policy if exists ec_update on public.election_candidates;
create policy ec_update on public.election_candidates for update to authenticated using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());
drop policy if exists ep_read on public.election_participation;
create policy ep_read on public.election_participation for select to authenticated using (true);
grant select on public.election_participation to authenticated;

create or replace function public.election_eligible(p_election uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.elections e where e.id = p_election and (
    e.committee_id is null
    or exists (select 1 from public.committee_members cm where cm.committee_id = e.committee_id and cm.user_id = p_user)));
$$;

create or replace function public.advance_election(p_election uuid) returns text
language plpgsql security definer set search_path = public as $$
declare e public.elections%rowtype; r jsonb; n int;
begin
  if not public.is_admin() then raise exception 'للمدير فقط'; end if;
  select * into e from public.elections where id = p_election for update;
  if not found then raise exception 'الانتخاب غير موجود'; end if;
  perform set_config('app.rpc', 'on', true);
  if e.status = 'ترشيح' then
    select count(*) into n from public.election_candidates where election_id = p_election and status = 'مرشح';
    if n < e.seats then raise exception 'عدد المرشحين (%) أقل من المقاعد (%)', n, e.seats; end if;
    update public.elections set status = 'تصويت' where id = p_election;
    return 'تصويت';
  elsif e.status = 'تصويت' then
    select coalesce(jsonb_agg(x order by (x->>'votes')::int desc, x->>'name'), '[]'::jsonb) into r from (
      select jsonb_build_object('candidate_id', c.id, 'user_id', c.user_id, 'name', p.full_name,
             'votes', (select count(*) from public.election_ballots b where b.election_id = p_election and b.candidate_id = c.id)) as x
        from public.election_candidates c join public.profiles p on p.id = c.user_id
       where c.election_id = p_election and c.status = 'مرشح') t;
    update public.elections set status = 'مغلقة', closed_at = now(), result = jsonb_build_object(
      'candidates', r, 'voters', (select count(*) from public.election_participation where election_id = p_election), 'seats', e.seats)
     where id = p_election;
    return 'مغلقة';
  end if;
  raise exception 'الانتخاب مغلق مسبقًا';
end $$;

create or replace function public.cast_election_vote(p_election uuid, p_candidates uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare e public.elections%rowtype; uid uuid := auth.uid(); c uuid;
begin
  if uid is null then raise exception 'يجب تسجيل الدخول'; end if;
  select * into e from public.elections where id = p_election for share;
  if not found then raise exception 'الانتخاب غير موجود'; end if;
  if e.status <> 'تصويت' then raise exception 'التصويت غير مفتوح'; end if;
  if not public.election_eligible(p_election, uid) then raise exception 'لست من الناخبين'; end if;
  if p_candidates is null or cardinality(p_candidates) < 1 or cardinality(p_candidates) > e.seats then
    raise exception 'اختر من 1 إلى % مرشحين', e.seats;
  end if;
  if (select count(distinct x) from unnest(p_candidates) x) <> cardinality(p_candidates) then raise exception 'مرشح مكرر'; end if;
  foreach c in array p_candidates loop
    if not exists (select 1 from public.election_candidates k where k.id = c and k.election_id = p_election and k.status = 'مرشح') then
      raise exception 'مرشح غير صالح';
    end if;
  end loop;
  begin
    insert into public.election_participation(election_id, user_id) values (p_election, uid);
  exception when unique_violation then raise exception 'سبق أن صوّتّ في هذا الانتخاب';
  end;
  foreach c in array p_candidates loop
    insert into public.election_ballots(election_id, candidate_id) values (p_election, c);
  end loop;
end $$;

create or replace function public.election_info(p_election uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'eligible', public.election_eligible(p_election, auth.uid()),
    'my_voted', exists (select 1 from public.election_participation where election_id = p_election and user_id = auth.uid()),
    'voted', (select count(*) from public.election_participation where election_id = p_election));
$$;

-- ───────────── التدقيق والصلاحيات ─────────────
do $$
declare t text;
begin
  if to_regprocedure('public.audit_trg()') is not null then
    foreach t in array array['regulations', 'ideas', 'halls', 'hall_bookings', 'elections', 'election_candidates', 'election_participation'] loop
      execute format('drop trigger if exists trg_audit on public.%I', t);
      execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.audit_trg()', t);
    end loop;
  end if;
end $$;

revoke execute on function public.advance_election(uuid), public.cast_election_vote(uuid, uuid[]), public.election_info(uuid),
  public.election_eligible(uuid, uuid) from public, anon;
grant execute on function public.advance_election(uuid), public.cast_election_vote(uuid, uuid[]), public.election_info(uuid),
  public.election_eligible(uuid, uuid) to authenticated;

commit;
