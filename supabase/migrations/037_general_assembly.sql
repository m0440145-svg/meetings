-- الميزة 10: الجمعية العمومية — سجل العضوية، الحضور، توكيل التصويت، وحساب النصاب بالنسبة.
-- لا أرقام نظامية هنا: الحد الأقصى للتوكيلات ونسبة النصاب (الأول والثاني) ومدة الإشعار تُدخَل من لائحة الجمعية في ga_settings، وتبقى «غير محددة» حتى تُدخَل.
-- لا يغيّر cast_vote ولا close_vote ولا النصاب بالعدد في التصويتات القائمة: هذه وحدة سجل وحضور وتقرير نصاب منفصلة.
-- الكتابة والقراءة للمدير/أمين السر فقط (بيانات عضوية). كل جدول عليه approved_only (035). آمن لإعادة التنفيذ.
begin;

create table if not exists public.ga_settings (
  id int primary key default 1 check (id = 1),
  max_proxies int check (max_proxies is null or max_proxies >= 0),
  quorum_percent numeric check (quorum_percent is null or quorum_percent between 0 and 100),
  second_quorum_percent numeric check (second_quorum_percent is null or second_quorum_percent between 0 and 100),
  notice_days int check (notice_days is null or notice_days >= 0),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
insert into public.ga_settings(id) values (1) on conflict (id) do nothing;

create table if not exists public.ga_members (
  id uuid primary key default gen_random_uuid(),
  member_no text,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 200),
  member_type text not null default 'عامل' check (char_length(member_type) <= 60),
  eligible boolean not null default true,
  user_id uuid references public.profiles(id) on delete set null,
  joined_on date,
  notes text not null default '' check (char_length(notes) <= 1000),
  created_at timestamptz not null default now()
);
create unique index if not exists ga_members_no_uq on public.ga_members(member_no) where member_no is not null and member_no <> '';

create table if not exists public.ga_attendance (
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  member_id uuid not null references public.ga_members(id) on delete cascade,
  mode text not null default 'حاضر' check (mode in ('حاضر','عن بعد')),
  checked_in_at timestamptz not null default now(),
  checked_by uuid default auth.uid(),
  primary key (meeting_id, member_id)
);

create table if not exists public.ga_proxies (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  grantor_id uuid not null references public.ga_members(id) on delete cascade,
  holder_id uuid not null references public.ga_members(id) on delete cascade,
  document_ref text not null default '' check (char_length(document_ref) <= 300),
  status text not null default 'معتمد' check (status in ('معتمد','ملغى')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  check (grantor_id <> holder_id)
);
create unique index if not exists ga_proxy_active_uq on public.ga_proxies(meeting_id, grantor_id) where status = 'معتمد';
create index if not exists ga_proxy_holder_idx on public.ga_proxies(meeting_id, holder_id) where status = 'معتمد';

do $$
declare t text;
begin
  foreach t in array array['ga_settings','ga_members','ga_attendance','ga_proxies'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t || '_admin', t);
    execute format('drop policy if exists approved_only on public.%I', t);
    execute format('create policy approved_only on public.%I as restrictive for all to authenticated using ((select public.is_approved())) with check ((select public.is_approved()))', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- لا تسجيل حضور مباشر لمن له توكيل معتمد على الاجتماع نفسه، ولا لغير الأهل
create or replace function public.ga_attendance_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.ga_members m where m.id = new.member_id and m.eligible) then raise exception 'العضو غير مؤهل للحضور والتصويت'; end if;
  if exists (select 1 from public.ga_proxies p where p.meeting_id = new.meeting_id and p.grantor_id = new.member_id and p.status = 'معتمد') then
    raise exception 'لهذا العضو توكيل معتمد على هذا الاجتماع؛ ألغِ التوكيل قبل تسجيل حضوره';
  end if;
  return new;
end $$;
drop trigger if exists trg_ga_attendance_check on public.ga_attendance;
create trigger trg_ga_attendance_check before insert or update on public.ga_attendance for each row execute function public.ga_attendance_check();

create or replace function public.ga_proxy_register(p_meeting uuid, p_grantor uuid, p_holder uuid, p_ref text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare mx int; n int; nid uuid;
begin
  if not public.is_admin() then raise exception 'لا تملك صلاحية تسجيل التوكيلات' using errcode = '42501'; end if;
  if p_grantor = p_holder then raise exception 'لا يوكّل العضو نفسه'; end if;
  if not exists (select 1 from public.meetings where id = p_meeting) then raise exception 'الاجتماع غير موجود'; end if;
  if not exists (select 1 from public.ga_members where id = p_grantor and eligible) then raise exception 'الموكِّل غير مؤهل'; end if;
  if not exists (select 1 from public.ga_members where id = p_holder and eligible) then raise exception 'الوكيل غير مؤهل'; end if;
  if exists (select 1 from public.ga_attendance where meeting_id = p_meeting and member_id = p_grantor) then raise exception 'الموكِّل مسجَّل الحضور بنفسه في هذا الاجتماع'; end if;
  if exists (select 1 from public.ga_proxies where meeting_id = p_meeting and holder_id = p_grantor and status = 'معتمد') then raise exception 'الموكِّل وكيل عن غيره في هذا الاجتماع (لا توكيل متسلسل)'; end if;
  if exists (select 1 from public.ga_proxies where meeting_id = p_meeting and grantor_id = p_holder and status = 'معتمد') then raise exception 'الوكيل موكِّل لغيره في هذا الاجتماع (لا توكيل متسلسل)'; end if;
  select max_proxies into mx from public.ga_settings where id = 1;
  select count(*) into n from public.ga_proxies where meeting_id = p_meeting and holder_id = p_holder and status = 'معتمد';
  if mx is not null and n >= mx then raise exception 'بلغ الوكيل الحد الأقصى للتوكيلات (%)', mx; end if;
  begin
    insert into public.ga_proxies(meeting_id, grantor_id, holder_id, document_ref) values (p_meeting, p_grantor, p_holder, coalesce(btrim(p_ref), '')) returning id into nid;
  exception when unique_violation then raise exception 'للموكِّل توكيل معتمد على هذا الاجتماع';
  end;
  return nid;
end $$;

create or replace function public.ga_proxy_cancel(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'لا تملك صلاحية إلغاء التوكيلات' using errcode = '42501'; end if;
  update public.ga_proxies set status = 'ملغى', cancelled_at = now() where id = p_id and status = 'معتمد';
  if not found then raise exception 'التوكيل غير موجود أو ملغى مسبقًا'; end if;
end $$;

-- تقرير النصاب: المؤهلون، الحاضرون، المُمثَّلون بالوكالة (يُحتسب التوكيل فقط إن كان وكيله حاضرًا)، والنسبة مقابل الإعداد
create or replace function public.ga_quorum(p_meeting uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare el int; pr int; px int; rep int; pct numeric; q numeric; q2 numeric;
begin
  if not public.is_admin() then raise exception 'لا تملك صلاحية عرض النصاب' using errcode = '42501'; end if;
  select count(*) into el from public.ga_members where eligible;
  select count(*) into pr from public.ga_attendance a join public.ga_members m on m.id = a.member_id where a.meeting_id = p_meeting and m.eligible;
  select count(*) into px from public.ga_proxies p
    join public.ga_attendance a on a.meeting_id = p.meeting_id and a.member_id = p.holder_id
    join public.ga_members g on g.id = p.grantor_id and g.eligible
   where p.meeting_id = p_meeting and p.status = 'معتمد';
  rep := pr + px;
  pct := case when el = 0 then 0 else round(100.0 * rep / el, 1) end;
  select quorum_percent, second_quorum_percent into q, q2 from public.ga_settings where id = 1;
  return jsonb_build_object('eligible', el, 'present', pr, 'by_proxy', px, 'represented', rep, 'percent', pct,
    'quorum_percent', q, 'quorum_met', case when q is null then null else pct >= q end,
    'second_quorum_percent', q2, 'second_quorum_met', case when q2 is null then null else pct >= q2 end);
end $$;

revoke all on function public.ga_proxy_register(uuid, uuid, uuid, text), public.ga_proxy_cancel(uuid), public.ga_quorum(uuid) from public, anon;
grant execute on function public.ga_proxy_register(uuid, uuid, uuid, text), public.ga_proxy_cancel(uuid), public.ga_quorum(uuid) to authenticated;

commit;
