-- ترحيل مقترح: تحصين التصويت والتوقيع والدعوات والأدوار
-- مهم: كُتب دون الاطلاع على مخطط قاعدة البيانات الفعلي. راجع كل افتراض (موسوم بـ [افتراض]) على نسخة تجريبية
-- من المشروع قبل التنفيذ على الإنتاج، ثم نفّذه من SQL Editor.
--
-- افتراضات عن المخطط الحالي:
--  [افتراض] profiles(id, role_code, role, is_active, phone, full_name)، وقيم role_code الإدارية: 'admin' و 'secretary'
--  [افتراض] votes(id, meeting_id, question, vote_type 'معلن'|'سري', quorum_required int, status 'مفتوح'|'مغلق', created_by)
--  [افتراض] minutes(id, meeting_id, content, status 'مسودة'|..., created_by)
--  [افتراض] signatures(minute_id, user_id, signature_path, signed_at)
--  [افتراض] meeting_attendees(meeting_id, user_id, attendance_status 'حاضر'|...)، committee_members(committee_id, user_id)
--  [افتراض] meeting_invitations, delivery_jobs, notifications, audit_logs بالأعمدة التي يستخدمها الكود الحالي
--
-- خطوة يدوية خارج SQL: Authentication ▸ Sign In / Providers ▸ عطّل "Allow new users to sign up"
-- وأنشئ الحسابات بالدعوة (Invite user) أو من لوحة المدير.

begin;

-- ───────────── أدوات مساعدة ─────────────
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and coalesce(p.role_code, p.role) in ('admin', 'secretary')
      and coalesce(p.is_active, true)
  );
$$;

-- الحضور: خيارات الواجهة هي حاضر / عن بعد / معتذر، والأولان يُعدّان حضورًا
create or replace function public.is_present(p_meeting uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.meeting_attendees a
                 where a.meeting_id = p_meeting and a.user_id = p_user
                   and a.attendance_status in ('حاضر', 'عن بعد'));
$$;

-- منع تغيير الدور/التفعيل من غير المدير (تصعيد الصلاحيات)
create or replace function public.guard_profile_privileges() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() and (
       to_jsonb(new)->>'role_code' is distinct from to_jsonb(old)->>'role_code'
    or to_jsonb(new)->>'role'      is distinct from to_jsonb(old)->>'role'
    or to_jsonb(new)->>'is_active' is distinct from to_jsonb(old)->>'is_active') then
    raise exception 'لا تملك صلاحية تعديل الدور أو حالة الحساب';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_profile_privileges on public.profiles;
create trigger trg_guard_profile_privileges before update on public.profiles
  for each row execute function public.guard_profile_privileges();

-- ───────────── التصويت ─────────────
alter table public.votes
  add column if not exists closes_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid,
  add column if not exists result jsonb;

-- من صوّت (بلا اختياره) — يمنع التصويت المزدوج
create table if not exists public.vote_participation (
  vote_id  uuid not null references public.votes(id) on delete cascade,
  user_id  uuid not null references auth.users(id),
  voted_at timestamptz not null default now(),
  primary key (vote_id, user_id)
);
-- الأصوات: في التصويت السري user_id = null، ولا يوجد وقت ولا معرّف تسلسلي يربطها بالمشاركة
create table if not exists public.vote_ballots (
  vote_id uuid not null references public.votes(id) on delete cascade,
  choice  text not null check (choice in ('موافق', 'غير موافق', 'ممتنع')),
  user_id uuid
);
create index if not exists vote_ballots_vote_idx on public.vote_ballots(vote_id);
alter table public.vote_participation enable row level security;
alter table public.vote_ballots enable row level security;  -- بلا سياسات: الوصول عبر الدوال فقط
-- المشاركة (من صوّت دون اختياره) مقروءة للجميع ليعمل التحديث الفوري لعدد المشاركين
drop policy if exists vote_participation_read on public.vote_participation;
create policy vote_participation_read on public.vote_participation for select to authenticated using (true);
grant select on public.vote_participation to authenticated;
do $$ begin
  alter publication supabase_realtime add table public.vote_participation;
exception when duplicate_object then null; end $$;

-- الجدول القديم كان يكشف user_id حتى في السري ويسمح بتغيير الصوت: نغلقه (ترحّل بياناته يدويًا إن لزم)
revoke all on public.vote_responses from authenticated, anon;

-- حالة التصويت ونتيجته لا تتغير إلا عبر الدوال أدناه
create or replace function public.guard_vote_fields() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then  -- الإدراج المباشر بحالة مغلقة أو بنتيجة جاهزة ممنوع
    new.status := 'مفتوح'; new.result := null; new.closed_at := null; new.closed_by := null;
    return new;
  end if;
  if current_setting('app.rpc', true) is distinct from 'on' and (
       new.status is distinct from old.status or new.result is distinct from old.result
    or new.closed_at is distinct from old.closed_at or new.closed_by is distinct from old.closed_by) then
    raise exception 'تُغلق التصويتات عبر الدالة close_vote فقط';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_vote_fields on public.votes;
create trigger trg_guard_vote_fields before insert or update on public.votes
  for each row execute function public.guard_vote_fields();

create or replace function public.cast_vote(p_vote uuid, p_choice text) returns void
language plpgsql security definer set search_path = public as $$
declare v public.votes%rowtype; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'يجب تسجيل الدخول'; end if;
  if p_choice not in ('موافق', 'غير موافق', 'ممتنع') then raise exception 'خيار غير صالح'; end if;
  select * into v from public.votes where id = p_vote for share;
  if not found then raise exception 'التصويت غير موجود'; end if;
  if v.status <> 'مفتوح' or (v.closes_at is not null and v.closes_at < now()) then
    raise exception 'التصويت مغلق';
  end if;
  if not public.is_present(v.meeting_id, uid) then
    raise exception 'يشترط تسجيل حضورك في الاجتماع (حاضر أو عن بعد) قبل التصويت';
  end if;
  begin
    insert into public.vote_participation(vote_id, user_id) values (p_vote, uid);
  exception when unique_violation then
    raise exception 'سبق أن صوّتّ في هذا التصويت ولا يمكن تغييره';
  end;
  insert into public.vote_ballots(vote_id, choice, user_id)
  values (p_vote, p_choice, case when v.vote_type = 'سري' then null else uid end);
end $$;

create or replace function public.close_vote(p_vote uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.votes%rowtype; uid uuid := auth.uid(); r jsonb; present int;
begin
  select * into v from public.votes where id = p_vote for update;
  if not found then raise exception 'التصويت غير موجود'; end if;
  if not (public.is_admin() or v.created_by = uid) then raise exception 'لا تملك صلاحية إغلاق التصويت'; end if;
  if v.status = 'مغلق' then raise exception 'التصويت مغلق مسبقًا'; end if;
  select count(*) into present from public.meeting_attendees
   where meeting_id = v.meeting_id and attendance_status in ('حاضر', 'عن بعد');
  -- النصاب في الواجهة معرَّف بـ"الحد الأدنى (عدد الأصوات)"، فيُقارن بعدد من صوّتوا لا بعدد الحاضرين
  select jsonb_build_object(
    'approve', count(*) filter (where choice = 'موافق'),
    'reject',  count(*) filter (where choice = 'غير موافق'),
    'abstain', count(*) filter (where choice = 'ممتنع'),
    'voted',   count(*),
    'present', present,
    'quorum_met', count(*) >= coalesce(v.quorum_required, 1)
  ) into r from public.vote_ballots where vote_id = p_vote;
  perform set_config('app.rpc', 'on', true);
  update public.votes set status = 'مغلق', closed_at = now(), closed_by = uid, result = r where id = p_vote;
  return r;
end $$;

-- النتائج: السري لا تظهر نتائجه الجزئية قبل الإغلاق إلا لمن يملك صلاحية الإغلاق
create or replace function public.vote_tally(p_vote uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.votes%rowtype; uid uuid := auth.uid(); can_close boolean; show boolean; r jsonb;
begin
  select * into v from public.votes where id = p_vote;
  if not found then return null; end if;
  can_close := public.is_admin() or v.created_by = uid;
  if not (can_close or exists (select 1 from public.meeting_attendees a
                               where a.meeting_id = v.meeting_id and a.user_id = uid)) then
    return null;
  end if;
  show := v.vote_type <> 'سري' or v.status = 'مغلق' or can_close;
  select jsonb_build_object(
    'voted',   count(*),
    'approve', case when show then count(*) filter (where choice = 'موافق') end,
    'reject',  case when show then count(*) filter (where choice = 'غير موافق') end,
    'abstain', case when show then count(*) filter (where choice = 'ممتنع') end
  ) into r from public.vote_ballots where vote_id = p_vote;
  return r || jsonb_build_object(
    'can_close', can_close,
    'my_voted', exists (select 1 from public.vote_participation where vote_id = p_vote and user_id = uid),
    'my_choice', case when v.vote_type <> 'سري'
                      then (select choice from public.vote_ballots where vote_id = p_vote and user_id = uid) end,
    'quorum_met', v.result->'quorum_met');
end $$;

-- ───────────── المحاضر والتوقيع ─────────────
alter table public.minutes
  add column if not exists content_hash text,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid,
  add column if not exists required_signatures int not null default 2;
alter table public.signatures
  add column if not exists content_hash text;
alter table public.signatures alter column signature_path drop not null;  -- التوقيع المعتمد يعتمد على البصمة، والصورة اختيارية
create unique index if not exists signatures_minute_user_uq on public.signatures(minute_id, user_id);

revoke insert, update, delete on public.signatures from authenticated, anon;

-- بعد أول توقيع لا يتغير نص المحضر، والحالة/الاعتماد لا يتغيران إلا عبر approve_minute
create or replace function public.guard_minutes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then  -- لا يُدرج محضر معتمد جاهزًا
    new.status := 'مسودة'; new.approved_at := null; new.approved_by := null; new.content_hash := null;
    return new;
  end if;
  if (new.content is distinct from old.content or new.meeting_id is distinct from old.meeting_id)
     and (old.status = 'معتمد' or exists (select 1 from public.signatures s where s.minute_id = old.id)) then
    raise exception 'لا يمكن تعديل محضر تم توقيعه أو اعتماده';
  end if;
  if current_setting('app.rpc', true) is distinct from 'on' and (
       new.status is distinct from old.status
    or new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by
    or new.content_hash is distinct from old.content_hash) then
    raise exception 'يُعتمد المحضر عبر الدالة approve_minute فقط';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_minutes on public.minutes;
create trigger trg_guard_minutes before insert or update on public.minutes
  for each row execute function public.guard_minutes();

create or replace function public.sign_minute(p_minute uuid, p_signature_path text default null) returns void
language plpgsql security definer set search_path = public as $$
declare m public.minutes%rowtype; uid uuid := auth.uid(); h text;
begin
  if uid is null then raise exception 'يجب تسجيل الدخول'; end if;
  select * into m from public.minutes where id = p_minute;
  if not found then raise exception 'المحضر غير موجود'; end if;
  if m.status = 'معتمد' then raise exception 'المحضر معتمد ولا يقبل توقيعات جديدة'; end if;
  if not (public.is_admin() or public.is_present(m.meeting_id, uid)) then
    raise exception 'التوقيع للحاضرين في الاجتماع فقط';
  end if;
  if p_signature_path is not null and p_signature_path not like 'signatures/' || p_minute || '/' || uid || '-%' then
    raise exception 'مسار صورة التوقيع غير صالح';
  end if;
  h := encode(sha256(convert_to(coalesce(m.content, ''), 'UTF8')), 'hex');
  insert into public.signatures(minute_id, user_id, signature_path, signed_at, content_hash)
  values (p_minute, uid, p_signature_path, now(), h)
  on conflict (minute_id, user_id) do nothing;
  if not found then raise exception 'سبق أن وقّعت هذا المحضر'; end if;
end $$;

create or replace function public.approve_minute(p_minute uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m public.minutes%rowtype; h text; n int;
begin
  if not public.is_admin() then raise exception 'الاعتماد لمدير النظام أو أمين السر فقط'; end if;
  select * into m from public.minutes where id = p_minute for update;
  if not found then raise exception 'المحضر غير موجود'; end if;
  if m.status = 'معتمد' then raise exception 'المحضر معتمد مسبقًا'; end if;
  h := encode(sha256(convert_to(coalesce(m.content, ''), 'UTF8')), 'hex');
  select count(*) into n from public.signatures where minute_id = p_minute and content_hash = h;
  if n < m.required_signatures then
    raise exception 'عدد التوقيعات (%) أقل من المطلوب (%)', n, m.required_signatures;
  end if;
  perform set_config('app.rpc', 'on', true);
  update public.minutes set status = 'معتمد', approved_at = now(), approved_by = auth.uid(), content_hash = h
   where id = p_minute;
end $$;

-- ───────────── الدعوات والإشعارات (كانت تُدرج من أي مستخدم لأي مستخدم) ─────────────
revoke insert on public.meeting_invitations from authenticated, anon;
revoke insert on public.delivery_jobs from authenticated, anon;
revoke insert on public.notifications from authenticated, anon;

create or replace function public.send_meeting_invitations(p_meeting uuid) returns int
language plpgsql security definer set search_path = public as $$
declare m public.meetings%rowtype; uid uuid := auth.uid(); r record; n int := 0;
begin
  select * into m from public.meetings where id = p_meeting;
  if not found then raise exception 'الاجتماع غير موجود'; end if;
  if not (public.is_admin() or m.created_by = uid) then raise exception 'لا تملك صلاحية إرسال الدعوات'; end if;
  for r in
    select distinct cm.user_id, p.phone
      from public.committee_members cm
      join public.profiles p on p.id = cm.user_id
     where cm.committee_id = m.committee_id
       and not exists (select 1 from public.meeting_invitations i
                       where i.meeting_id = p_meeting and i.user_id = cm.user_id)
  loop
    insert into public.meeting_invitations(meeting_id, user_id, phone, status, created_by)
    values (p_meeting, r.user_id, r.phone, 'مجدولة', uid);
    if r.phone is not null then
      insert into public.delivery_jobs(channel, recipient, template, payload, status)
      values ('whatsapp', r.phone, 'meeting_invitation',
              jsonb_build_object('meeting_id', p_meeting, 'title', m.title, 'date', m.gregorian_date, 'time', m.start_time),
              'pending');
    end if;
    insert into public.notifications(user_id, title, body)
    values (r.user_id, 'دعوة اجتماع', m.title || ' — ' || m.gregorian_date || ' ' || coalesce(m.start_time::text, ''));
    n := n + 1;
  end loop;
  return n;
end $$;

-- ───────────── سجل التدقيق من قاعدة البيانات (لا يُكتب من العميل) ─────────────
revoke insert, update, delete on public.audit_logs from authenticated, anon;
alter table public.audit_logs enable row level security;
drop policy if exists audit_admin_read on public.audit_logs;
create policy audit_admin_read on public.audit_logs for select to authenticated using (public.is_admin());
-- راجع السياسات القديمة على audit_logs واحذف أي سياسة تتيح القراءة/الكتابة لغير المدير

create or replace function public.audit_trg() returns trigger
language plpgsql security definer set search_path = public as $$
declare row_json jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.audit_logs(user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), tg_op || ' ' || tg_table_name, tg_table_name,
          nullif(row_json->>'id', '')::uuid,
          jsonb_build_object('vote_id', row_json->>'vote_id', 'minute_id', row_json->>'minute_id',
                             'meeting_id', row_json->>'meeting_id', 'status', row_json->>'status'));
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['meetings', 'votes', 'vote_participation', 'minutes', 'signatures', 'meeting_attendees', 'meeting_invitations'] loop
    execute format('drop trigger if exists trg_audit on public.%I', t);
    execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.audit_trg()', t);
  end loop;
end $$;

-- ───────────── الصلاحيات على الدوال ─────────────
revoke execute on function public.cast_vote(uuid, text), public.close_vote(uuid), public.vote_tally(uuid),
  public.sign_minute(uuid, text), public.approve_minute(uuid), public.send_meeting_invitations(uuid),
  public.is_admin(), public.is_present(uuid, uuid) from public, anon;
grant execute on function public.cast_vote(uuid, text), public.close_vote(uuid), public.vote_tally(uuid),
  public.sign_minute(uuid, text), public.approve_minute(uuid), public.send_meeting_invitations(uuid),
  public.is_admin(), public.is_present(uuid, uuid) to authenticated;

commit;
