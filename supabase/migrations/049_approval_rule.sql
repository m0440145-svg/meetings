-- قاعدة الإقرار (نسبة الإقرار): تحدد هل «نجح» القرار بعد إغلاق التصويت. عرض معلوماتي فقط: لا تمنع صوتًا ولا تغيّر نتيجة مسجّلة ولا تُنشئ قرارًا.
-- القاعدة = (الأساس، النسبة): الموافقون ≥ ceil(عدد الأساس × النسبة ÷ 100) ويزيدون على الرافضين.
--   الأساس: cast = من صوّت موافق/غير موافق (الممتنع لا يُحسب) | voters = كل من شارك (يشمل الممتنع) | present = الحاضرون في الاجتماع | members = أعضاء لجنة الاجتماع (المؤهلون).
--   50.01 = أكثر من النصف، و66.66 = الثلثان. التعادل (موافق = رافض) لا يُقَرّ ويُعرض «متعادل».
-- الأولوية: قاعدة التصويت نفسه ← قاعدة اللجنة ← الافتراضية (cast، 50.01). تُثبَّت قاعدة التصويت عند فتحه (مشغّل)، فلا يتغير مصير تصويت مغلق بتعديل لاحق للإعدادات.
-- 1) أعمدة: quorum_settings (الافتراضية)، committees (قاعدة اللجنة، اختيارية)، votes (قاعدة التصويت). حارس نسبة/قاعدة اللجنة للمدير فقط (يوسّع مشغّل 048).
-- 2) approval_rule_for / vote_outcome(تصويت) [النتيجة بعد الإغلاق فقط، ولمن يرى الاجتماع، فلا تكشف جزئيات السري] / vote_rule_get / vote_set_approval_rule (المدير، والتصويت مفتوح فقط).
-- 3) approval_settings_get / approval_settings_set للمدير مع سجل تدقيق.
-- 4) أقفال التكامل: trg_guard_vote_rule (القاعدة لا تتغير إلا عبر الدالة والتصويت مفتوح ولم يصل صوت)، trg_freeze_vote_counts (يثبّت أعضاء اللجنة عند الإغلاق؛ والحاضرون من result الذي تحفظه close_vote).
-- آمن لإعادة التنفيذ. للتراجع: drop trigger if exists trg_vote_rule_snapshot, trg_guard_vote_rule, trg_freeze_vote_counts on public.votes؛ drop function للدوال الجديدة؛ drop column للأعمدة؛ وأعد تعريف guard_committee_quorum من 048.
begin;

alter table public.quorum_settings add column if not exists approval_base text not null default 'cast';
alter table public.quorum_settings add column if not exists approval_percent numeric(5,2) not null default 50.01;
alter table public.committees add column if not exists approval_base text;
alter table public.committees add column if not exists approval_percent numeric(5,2);
alter table public.votes add column if not exists approval_base text;
alter table public.votes add column if not exists approval_percent numeric(5,2);
alter table public.votes add column if not exists members_at_close int;   -- عدد أعضاء اللجنة لحظة الإغلاق (يثبّته مشغّل)
do $$ begin
  alter table public.quorum_settings add constraint quorum_settings_approval_chk check (approval_base in ('cast', 'voters', 'present', 'members') and approval_percent >= 1 and approval_percent <= 100);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.committees add constraint committees_approval_chk check ((approval_base is null or approval_base in ('cast', 'voters', 'present', 'members')) and (approval_percent is null or (approval_percent >= 1 and approval_percent <= 100)));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.votes add constraint votes_approval_chk check ((approval_base is null or approval_base in ('cast', 'voters', 'present', 'members')) and (approval_percent is null or (approval_percent >= 1 and approval_percent <= 100)));
exception when duplicate_object then null; end $$;

-- حارس قاعدة/نسبة اللجنة (يوسّع 048): المدير فقط
create or replace function public.guard_committee_quorum() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if tg_op = 'INSERT' then new.quorum_percent := null; new.approval_base := null; new.approval_percent := null;
    elsif new.quorum_percent is distinct from old.quorum_percent or new.approval_base is distinct from old.approval_base or new.approval_percent is distinct from old.approval_percent then
      raise exception 'لا يغيّر نسبة النصاب أو قاعدة الإقرار إلا مدير المنصة' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- القاعدة السارية لاجتماع (قاعدة اللجنة ثم الافتراضية)
create or replace function public.approval_rule_for(p_meeting uuid) returns table(base text, percent numeric)
language plpgsql stable security definer set search_path = public as $$
declare s public.quorum_settings%rowtype; c public.committees%rowtype;
begin
  select * into s from public.quorum_settings where id = 1;
  select cc.* into c from public.committees cc join public.meetings m on m.committee_id = cc.id where m.id = p_meeting;
  base := coalesce(c.approval_base, s.approval_base, 'cast');
  percent := coalesce(c.approval_percent, s.approval_percent, 50.01);
  return next;
end $$;
revoke all on function public.approval_rule_for(uuid) from public, anon, authenticated;

-- تثبيت قاعدة التصويت عند فتحه
create or replace function public.snapshot_vote_rule() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if auth.uid() is not null and not public.is_admin() then new.approval_base := null; new.approval_percent := null; end if;   -- غير المدير لا يختار قاعدة
  select * into r from public.approval_rule_for(new.meeting_id);
  new.approval_base := coalesce(new.approval_base, r.base);
  new.approval_percent := coalesce(new.approval_percent, r.percent);
  return new;
end $$;
revoke all on function public.snapshot_vote_rule() from public, anon, authenticated;
drop trigger if exists trg_vote_rule_snapshot on public.votes;
create trigger trg_vote_rule_snapshot before insert on public.votes for each row execute function public.snapshot_vote_rule();

-- تثبيت قواعد التصويتات القائمة (قبل إنشاء مشغّل القفل): لا يتغير مصير مغلق منها بتعديل لاحق للإعدادات
update public.votes v
   set approval_base = coalesce(v.approval_base, (select a.base from public.approval_rule_for(v.meeting_id) a)),
       approval_percent = coalesce(v.approval_percent, (select a.percent from public.approval_rule_for(v.meeting_id) a))
 where v.approval_base is null or v.approval_percent is null;

-- قفل القاعدة: لا تتغير إلا عبر vote_set_approval_rule (app.rpc) والتصويت مفتوح؛ ومنع كتابتها مباشرة بعد الإغلاق
create or replace function public.guard_vote_rule() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.approval_base is distinct from old.approval_base or new.approval_percent is distinct from old.approval_percent)
     and (current_setting('app.rpc', true) is distinct from 'on' or old.status is distinct from 'مفتوح') then
    raise exception 'قاعدة الإقرار لا تُعدَّل إلا عبر الدالة المخصصة والتصويت مفتوح';
  end if;
  return new;
end $$;
revoke all on function public.guard_vote_rule() from public, anon, authenticated;
drop trigger if exists trg_guard_vote_rule on public.votes;
create trigger trg_guard_vote_rule before update on public.votes for each row execute function public.guard_vote_rule();

-- تثبيت عدد الأعضاء لحظة الإغلاق (فلا تقلب نتيجةً مغلقة تغييراتُ عضوية اللجنة لاحقًا)
create or replace function public.freeze_vote_counts() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'مغلق' and old.status is distinct from 'مغلق' and new.meeting_id is not null then
    new.members_at_close := (public.quorum_state(new.meeting_id)->>'eligible')::int;
  end if;
  return new;
end $$;
revoke all on function public.freeze_vote_counts() from public, anon, authenticated;
drop trigger if exists trg_freeze_vote_counts on public.votes;
create trigger trg_freeze_vote_counts before update on public.votes for each row execute function public.freeze_vote_counts();

-- هل للمستخدم صلة بالاجتماع (مدير، منشئ الاجتماع/التصويت، عضو لجنة، حاضر، مدعو)
create or replace function public.can_see_meeting_quorum(p_meeting uuid, p_creator uuid, p_invited boolean default true) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); m public.meetings%rowtype;
begin
  if uid is null then return false; end if;
  select * into m from public.meetings where id = p_meeting;
  if not found then return false; end if;
  return public.is_admin() or m.created_by = uid or p_creator = uid
      or exists (select 1 from public.committee_members cm where cm.committee_id = m.committee_id and cm.user_id = uid)
      or exists (select 1 from public.meeting_attendees a where a.meeting_id = p_meeting and a.user_id = uid)
      or (p_invited and exists (select 1 from public.meeting_invitations i where i.meeting_id = p_meeting and i.user_id = uid));
end $$;
revoke all on function public.can_see_meeting_quorum(uuid, uuid, boolean) from public, anon, authenticated;

-- النتيجة النهائية (بعد الإغلاق فقط)
create or replace function public.vote_outcome(p_vote uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v public.votes%rowtype; a int; r int; ab int; b text; pct numeric; base_n int; req int; q jsonb; rr record;
begin
  if auth.uid() is null or not public.is_approved() then raise exception 'غير مصرح' using errcode = '42501'; end if;
  select * into v from public.votes where id = p_vote;
  if not found or v.status is distinct from 'مغلق' then return null; end if;
  if not public.can_see_meeting_quorum(v.meeting_id, v.created_by, false) then return null; end if;   -- كدائرة vote_tally: بلا المدعو غير الحاضر
  select count(*) filter (where choice = 'موافق'), count(*) filter (where choice = 'غير موافق'), count(*) filter (where choice = 'ممتنع')
    into a, r, ab from public.vote_ballots where vote_id = p_vote;
  select * into rr from public.approval_rule_for(v.meeting_id);
  b := coalesce(v.approval_base, rr.base, 'cast');
  pct := coalesce(v.approval_percent, rr.percent, 50.01);
  q := public.quorum_state(v.meeting_id);
  base_n := case b
    when 'cast' then a + r
    when 'voters' then a + r + ab
    when 'present' then coalesce((v.result->>'present')::int, (select count(*) from public.meeting_attendees x where x.meeting_id = v.meeting_id and x.attendance_status in ('حاضر', 'عن بعد')))   -- المحفوظ عند الإغلاق
    else coalesce(v.members_at_close, (q->>'eligible')::int, 0) end;
  if b = 'members' and base_n = 0 then base_n := a + r; end if;   -- اجتماع بلا لجنة أو لجنة بلا أعضاء: يُرجَع لأصوات الموافق/غير الموافق
  req := greatest(1, ceil(base_n * pct / 100.0)::int);
  return jsonb_build_object('approve', a, 'reject', r, 'abstain', ab, 'base', b, 'percent', pct, 'base_count', base_n, 'required', req,
                            'passed', a >= req and a > r, 'tied', a = r and a > 0);
end $$;

create or replace function public.vote_rule_get(p_vote uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v public.votes%rowtype; rr record;
begin
  if not public.is_admin() then raise exception 'لا تملك صلاحية' using errcode = '42501'; end if;
  select * into v from public.votes where id = p_vote;
  if not found then return null; end if;
  select * into rr from public.approval_rule_for(v.meeting_id);
  return jsonb_build_object('status', v.status, 'base', coalesce(v.approval_base, rr.base), 'percent', coalesce(v.approval_percent, rr.percent));
end $$;

create or replace function public.vote_set_approval_rule(p_vote uuid, p_base text, p_percent numeric) returns void
language plpgsql security definer set search_path = public as $$
declare v public.votes%rowtype;
begin
  if not public.is_admin() then raise exception 'لا تملك صلاحية تعديل قاعدة الإقرار' using errcode = '42501'; end if;
  if p_base not in ('cast', 'voters', 'present', 'members') then raise exception 'أساس غير صالح'; end if;
  if p_percent is null or p_percent < 1 or p_percent > 100 then raise exception 'النسبة بين 1 و100'; end if;
  select * into v from public.votes where id = p_vote for update;
  if not found then raise exception 'التصويت غير موجود'; end if;
  if v.status is distinct from 'مفتوح' then raise exception 'لا تُعدَّل قاعدة الإقرار بعد إغلاق التصويت'; end if;
  if (v.closes_at is not null and v.closes_at < now()) or exists (select 1 from public.vote_participation where vote_id = p_vote) then
    raise exception 'لا تُعدَّل قاعدة الإقرار بعد بدء التصويت (وصلت أصوات)';
  end if;
  perform set_config('app.rpc', 'on', true);
  update public.votes set approval_base = p_base, approval_percent = p_percent where id = p_vote;
  perform set_config('app.rpc', '', true);
  insert into public.audit_logs(user_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'vote_approval_rule', 'vote', p_vote, jsonb_build_object('base', p_base, 'percent', p_percent));
end $$;

-- الإعدادات (الافتراضية + قاعدة كل لجنة) للمدير/أمين السر
create or replace function public.approval_settings_get() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.quorum_settings%rowtype;
begin
  if not public.is_admin() then raise exception 'لا تملك صلاحية عرض إعدادات الإقرار' using errcode = '42501'; end if;
  select * into s from public.quorum_settings where id = 1;
  return jsonb_build_object('base', s.approval_base, 'percent', s.approval_percent,
    'committees', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'base', c.approval_base, 'percent', c.approval_percent) order by c.name) from public.committees c), '[]'::jsonb));
end $$;

create or replace function public.approval_settings_set(p_base text, p_percent numeric, p_committees jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare c jsonb; cid uuid; cb text; cp numeric;
begin
  if not public.is_admin() then raise exception 'لا تملك صلاحية تعديل إعدادات الإقرار' using errcode = '42501'; end if;
  if p_base not in ('cast', 'voters', 'present', 'members') then raise exception 'أساس غير صالح'; end if;
  if p_percent is null or p_percent < 1 or p_percent > 100 then raise exception 'النسبة بين 1 و100'; end if;
  for c in select * from jsonb_array_elements(coalesce(p_committees, '[]'::jsonb)) loop
    cid := (c->>'id')::uuid; cb := nullif(c->>'base', ''); cp := nullif(c->>'percent', '')::numeric;
    if cb is not null and cb not in ('cast', 'voters', 'present', 'members') then raise exception 'أساس غير صالح'; end if;
    if cp is not null and (cp < 1 or cp > 100) then raise exception 'نسبة اللجنة بين 1 و100'; end if;
    if not exists (select 1 from public.committees where id = cid) then raise exception 'لجنة غير موجودة'; end if;
    update public.committees set approval_base = cb, approval_percent = cp where id = cid;
  end loop;
  update public.quorum_settings set approval_base = p_base, approval_percent = p_percent, updated_by = auth.uid(), updated_at = now() where id = 1;
  if not found then insert into public.quorum_settings(id, approval_base, approval_percent, updated_by) values (1, p_base, p_percent, auth.uid()); end if;
  insert into public.audit_logs(user_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'approval_settings_set', 'quorum_settings', null, jsonb_build_object('base', p_base, 'percent', p_percent, 'committees', coalesce(p_committees, '[]'::jsonb)));
end $$;

revoke all on function public.vote_outcome(uuid), public.vote_rule_get(uuid), public.vote_set_approval_rule(uuid, text, numeric),
  public.approval_settings_get(), public.approval_settings_set(text, numeric, jsonb) from public, anon;
grant execute on function public.vote_outcome(uuid), public.vote_rule_get(uuid), public.vote_set_approval_rule(uuid, text, numeric),
  public.approval_settings_get(), public.approval_settings_set(text, numeric, jsonb) to authenticated;

commit;
