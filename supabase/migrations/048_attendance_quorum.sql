-- نصاب الحضور للاجتماعات: نسبة من أعضاء لجنة الاجتماع يجب أن يكونوا «حاضر/عن بعد» في الاجتماع.
-- يبدأ بوضع «تحذير» (يظهر للجميع ولا يمنع شيئًا)، ويستطيع المدير تحويله إلى «منع» (لا يُفتح تصويت ولا يُقبل صوت قبل اكتمال النصاب) أو «إيقاف».
-- 1) committees.quorum_percent (اختياري): نسبة اللجنة من لائحتها. بلا قيمة تُستخدم النسبة الافتراضية (50.01 = أكثر من النصف).
--    required = ceil(عدد الأعضاء × النسبة ÷ 100) بحد أدنى 1. للثلثين اكتب 66.66.
-- 2) quorum_settings (صف واحد): mode ∈ off/warn/block، default_percent. تُقرأ وتُعدَّل عبر RPC للمدير فقط.
-- 3) quorum_state (داخلي) / meeting_quorum(اجتماع) / vote_quorum(تصويت): الأعضاء المؤهلون = أعضاء لجنة الاجتماع؛ الحاضرون = من سجّل حاضر/عن بعد منهم
--    (ضيف حاضر يصوّت كما تقرر لكنه لا يُحتسب في النصاب). اجتماع بلا لجنة أو لجنة بلا أعضاء: النصاب غير منطبق.
-- 4) في وضع «منع» فقط: مشغّل على votes (فتح التصويت) وفحص داخل cast_vote (قبول الصوت). عدّاد vote_tally.quorum_met (عدد الأصوات) باقٍ كما هو.
-- 5) quorum_settings_get/set للمدير/أمين السر مع سجل تدقيق.
-- آمن لإعادة التنفيذ. تعطيل الأثر فورًا دون حذف: ضبط الوضع «off» من «إعدادات النصاب».
-- التراجع الكامل: drop trigger if exists trg_guard_vote_quorum on public.votes; drop trigger if exists trg_guard_committee_quorum on public.committees;
--   ثم أعد تشغيل تعريف cast_vote من 046؛ ثم drop function quorum_state(uuid), meeting_quorum(uuid), vote_quorum(uuid), guard_vote_quorum(), guard_committee_quorum(), quorum_settings_get(), quorum_settings_set(text, numeric, jsonb);
--   ثم drop table public.quorum_settings; alter table public.committees drop column quorum_percent;
-- ملاحظة تصميم: في وضع «منع» يُحسب النصاب لحظة كل صوت لا لحظة فتح التصويت، فنزول الحضور أثناء التصويت يوقف قبول الأصوات.
begin;

alter table public.committees add column if not exists quorum_percent numeric(5,2);
do $$ begin
  alter table public.committees add constraint committees_quorum_percent_chk check (quorum_percent is null or (quorum_percent >= 1 and quorum_percent <= 100));
exception when duplicate_object then null; end $$;

create table if not exists public.quorum_settings (
  id int primary key default 1 check (id = 1),
  mode text not null default 'warn' check (mode in ('off', 'warn', 'block')),
  default_percent numeric(5,2) not null default 50.01 check (default_percent >= 1 and default_percent <= 100),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
insert into public.quorum_settings(id) values (1) on conflict (id) do nothing;
alter table public.quorum_settings enable row level security;
drop policy if exists approved_only on public.quorum_settings;
create policy approved_only on public.quorum_settings as restrictive for all to authenticated using ((select public.is_approved())) with check ((select public.is_approved()));
drop policy if exists quorum_settings_admin on public.quorum_settings;
create policy quorum_settings_admin on public.quorum_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.quorum_settings from anon;
revoke insert, update, delete, truncate on public.quorum_settings from authenticated;   -- الكتابة عبر quorum_settings_set فقط (مع التدقيق)
grant select on public.quorum_settings to authenticated;

-- الحالة (داخلية: بلا فحص صلاحية، لا تُمنح للعملاء)
create or replace function public.quorum_state(p_meeting uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m public.meetings%rowtype; s public.quorum_settings%rowtype; pct numeric; eligible int := 0; present int := 0; req int := 0; applicable boolean;
begin
  select * into m from public.meetings where id = p_meeting;
  if not found then return null; end if;
  select * into s from public.quorum_settings where id = 1;
  if m.committee_id is not null then
    -- الأعضاء الموقوفون/المرفوضون/غير النشطين لا يُحتسبون لا في المقام ولا في الحضور
    select count(*) into eligible from public.committee_members cm
      join public.profiles p on p.id = cm.user_id and p.is_active is not false and coalesce(p.approval_status, 'معتمد') not in ('موقوف', 'مرفوض')
     where cm.committee_id = m.committee_id;
    select count(*) into present from public.committee_members cm
      join public.profiles p on p.id = cm.user_id and p.is_active is not false and coalesce(p.approval_status, 'معتمد') not in ('موقوف', 'مرفوض')
      join public.meeting_attendees a on a.meeting_id = p_meeting and a.user_id = cm.user_id and a.attendance_status in ('حاضر', 'عن بعد')
     where cm.committee_id = m.committee_id;
  end if;
  applicable := m.committee_id is not null and eligible > 0;
  select quorum_percent into pct from public.committees where id = m.committee_id;
  pct := coalesce(pct, s.default_percent, 50.01);
  if applicable then req := least(eligible, greatest(1, ceil(eligible * pct / 100.0)::int)); end if;
  return jsonb_build_object('applicable', applicable, 'eligible', eligible, 'present', present, 'required', req, 'percent', pct,
                            'met', (not applicable) or present >= req, 'mode', coalesce(s.mode, 'warn'));
end $$;
revoke all on function public.quorum_state(uuid) from public, anon, authenticated;

-- للمستخدم: يرى الحالة من يرى الاجتماع (مدير، منشئ، عضو لجنة، حاضر/مدعو)
create or replace function public.meeting_quorum(p_meeting uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); m public.meetings%rowtype;
begin
  if uid is null or not public.is_approved() then raise exception 'غير مصرح' using errcode = '42501'; end if;
  select * into m from public.meetings where id = p_meeting;
  if not found then return null; end if;
  if not (public.is_admin() or m.created_by = uid
       or exists (select 1 from public.committee_members cm where cm.committee_id = m.committee_id and cm.user_id = uid)
       or exists (select 1 from public.meeting_attendees a where a.meeting_id = p_meeting and a.user_id = uid)
       or exists (select 1 from public.meeting_invitations i where i.meeting_id = p_meeting and i.user_id = uid)) then
    return null;
  end if;
  return public.quorum_state(p_meeting);
end $$;

create or replace function public.vote_quorum(p_vote uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare mid uuid;
begin
  select meeting_id into mid from public.votes where id = p_vote;
  if mid is null then return null; end if;
  return public.meeting_quorum(mid);
end $$;

-- وضع «منع»: لا يُفتح تصويت قبل اكتمال النصاب
create or replace function public.guard_vote_quorum() returns trigger
language plpgsql security definer set search_path = public as $$
declare q jsonb;
begin
  if auth.uid() is null or new.meeting_id is null then return new; end if;
  q := public.quorum_state(new.meeting_id);
  if q is not null and q->>'mode' = 'block' and (q->>'applicable')::boolean and not (q->>'met')::boolean then
    raise exception 'لا يمكن فتح التصويت: النصاب غير مكتمل (حاضر % من % والمطلوب %)', q->>'present', q->>'eligible', q->>'required';
  end if;
  return new;
end $$;
revoke all on function public.guard_vote_quorum() from public, anon, authenticated;
drop trigger if exists trg_guard_vote_quorum on public.votes;
create trigger trg_guard_vote_quorum before insert on public.votes for each row execute function public.guard_vote_quorum();

-- cast_vote: نسخة 046 حرفيًا + فحص النصاب في وضع «منع» فقط
create or replace function public.cast_vote(p_vote uuid, p_choice text, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v public.votes%rowtype; uid uuid := auth.uid(); vag uuid; rs text := nullif(btrim(coalesce(p_reason, '')), ''); q jsonb;
begin
  if uid is null then raise exception 'يجب تسجيل الدخول'; end if;
  if not public.is_approved() then raise exception 'حسابك غير معتمد' using errcode = '42501'; end if;
  if p_choice not in ('موافق', 'غير موافق', 'ممتنع') then raise exception 'خيار غير صالح'; end if;
  if p_choice = 'ممتنع' and (rs is null or char_length(rs) < 3) then raise exception 'اكتب سبب الامتناع'; end if;
  select * into v from public.votes where id = p_vote for share;
  if not found then raise exception 'التصويت غير موجود'; end if;
  if v.status <> 'مفتوح' or (v.closes_at is not null and v.closes_at < now()) then
    raise exception 'التصويت مغلق';
  end if;
  if not public.is_present(v.meeting_id, uid) then
    raise exception 'يشترط تسجيل حضورك في الاجتماع (حاضر أو عن بعد) قبل التصويت';
  end if;
  q := public.quorum_state(v.meeting_id);
  if q is not null and q->>'mode' = 'block' and (q->>'applicable')::boolean and not (q->>'met')::boolean then
    raise exception 'لا يمكن التصويت: النصاب غير مكتمل (حاضر % من % والمطلوب %)', q->>'present', q->>'eligible', q->>'required';
  end if;
  vag := nullif(to_jsonb(v)->>'agenda_item_id', '')::uuid;
  if exists (select 1 from public.conflict_declarations c
              where c.meeting_id = v.meeting_id and c.user_id = uid and c.status = 'نشط'
                and (c.agenda_item_id is null or c.agenda_item_id = vag)) then
    raise exception 'لا يمكنك التصويت: لديك إعلان تعارض مصالح نشِط على هذا البند أو الاجتماع';
  end if;
  begin
    insert into public.vote_participation(vote_id, user_id) values (p_vote, uid);
  exception when unique_violation then
    raise exception 'سبق أن صوّتّ في هذا التصويت ولا يمكن تغييره';
  end;
  insert into public.vote_ballots(vote_id, choice, user_id, reason)
  values (p_vote, p_choice, case when v.vote_type = 'سري' then null else uid end, case when p_choice = 'ممتنع' then left(rs, 1000) end);
end $$;

-- حارس نسبة اللجنة: لا يغيّرها إلا المدير (حتى لو ملك المنشئ/الرئيس تعديل اللجنة عبر سياساتها القائمة)
create or replace function public.guard_committee_quorum() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if tg_op = 'INSERT' then new.quorum_percent := null;
    elsif new.quorum_percent is distinct from old.quorum_percent then raise exception 'لا يغيّر نسبة النصاب إلا مدير المنصة' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_committee_quorum() from public, anon, authenticated;
drop trigger if exists trg_guard_committee_quorum on public.committees;
create trigger trg_guard_committee_quorum before insert or update on public.committees for each row execute function public.guard_committee_quorum();

-- إعدادات النصاب (للمدير/أمين السر)
create or replace function public.quorum_settings_get() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.quorum_settings%rowtype;
begin
  if not public.is_admin() then raise exception 'لا تملك صلاحية عرض إعدادات النصاب' using errcode = '42501'; end if;
  select * into s from public.quorum_settings where id = 1;
  return jsonb_build_object('mode', s.mode, 'default_percent', s.default_percent,
    'committees', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'percent', c.quorum_percent,
        'members', (select count(*) from public.committee_members cm where cm.committee_id = c.id)) order by c.name) from public.committees c), '[]'::jsonb));
end $$;

create or replace function public.quorum_settings_set(p_mode text, p_default numeric, p_committees jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare c jsonb; cid uuid; pct numeric;
begin
  if not public.is_admin() then raise exception 'لا تملك صلاحية تعديل إعدادات النصاب' using errcode = '42501'; end if;
  if p_mode not in ('off', 'warn', 'block') then raise exception 'وضع غير صالح'; end if;
  if p_default is null or p_default < 1 or p_default > 100 then raise exception 'النسبة الافتراضية بين 1 و100'; end if;
  for c in select * from jsonb_array_elements(coalesce(p_committees, '[]'::jsonb)) loop
    cid := (c->>'id')::uuid;
    pct := nullif(c->>'percent', '')::numeric;
    if pct is not null and (pct < 1 or pct > 100) then raise exception 'نسبة اللجنة بين 1 و100'; end if;
    if not exists (select 1 from public.committees where id = cid) then raise exception 'لجنة غير موجودة'; end if;
    update public.committees set quorum_percent = pct where id = cid;
  end loop;
  update public.quorum_settings set mode = p_mode, default_percent = p_default, updated_by = auth.uid(), updated_at = now() where id = 1;
  if not found then insert into public.quorum_settings(id, mode, default_percent, updated_by) values (1, p_mode, p_default, auth.uid()); end if;
  insert into public.audit_logs(user_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'quorum_settings_set', 'quorum_settings', null, jsonb_build_object('mode', p_mode, 'default_percent', p_default, 'committees', coalesce(p_committees, '[]'::jsonb)));
end $$;

revoke all on function public.meeting_quorum(uuid), public.vote_quorum(uuid), public.cast_vote(uuid, text, text),
  public.quorum_settings_get(), public.quorum_settings_set(text, numeric, jsonb) from public, anon;
grant execute on function public.meeting_quorum(uuid), public.vote_quorum(uuid), public.cast_vote(uuid, text, text),
  public.quorum_settings_get(), public.quorum_settings_set(text, numeric, jsonb) to authenticated;

commit;
