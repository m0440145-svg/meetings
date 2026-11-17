-- سبب الامتناع: عند اختيار «ممتنع» يُطلب من العضو بيان السبب.
-- 1) vote_ballots.reason: يُحفظ مع الصوت ذاته؛ في التصويت السري يبقى بلا هوية (user_id فارغ كالسابق)، وفي العلني ينسب للعضو كاختياره.
-- 2) cast_vote(p_vote, p_choice, p_reason default null): نسخة 032 حرفيًا (الحضور، تعارض المصالح، منع التكرار) + اشتراط سبب لا يقل عن 3 أحرف عند الامتناع. تُستبدل الدالة ذات المعاملين بها حتى لا يحدث غموض في الاستدعاء.
-- 3) vote_abstain_reasons(p_vote): للمدير/أمين السر أو منشئ التصويت فقط: قائمة الأسباب (مع اسم العضو في العلني، وبدونه في السري).
-- التصويتات السابقة لا تتأثر (reason فارغ). آمن لإعادة التنفيذ.
begin;

alter table public.vote_ballots add column if not exists reason text;
do $$ begin
  alter table public.vote_ballots add constraint vote_ballots_reason_len check (reason is null or char_length(reason) <= 1000);
exception when duplicate_object then null; end $$;

drop function if exists public.cast_vote(uuid, text);
create or replace function public.cast_vote(p_vote uuid, p_choice text, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v public.votes%rowtype; uid uuid := auth.uid(); vag uuid; rs text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if uid is null then raise exception 'يجب تسجيل الدخول'; end if;
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

create or replace function public.vote_abstain_reasons(p_vote uuid) returns table(voter text, reason text)
language plpgsql stable security definer set search_path = public as $$
declare v public.votes%rowtype;
begin
  select * into v from public.votes where id = p_vote;
  if not found then return; end if;
  if not (public.is_admin() or v.created_by = auth.uid()) then raise exception 'لا تملك صلاحية عرض أسباب الامتناع' using errcode = '42501'; end if;
  return query
    select case when v.vote_type = 'سري' then null else coalesce(p.full_name, 'عضو') end, b.reason
      from public.vote_ballots b left join public.profiles p on p.id = b.user_id
     where b.vote_id = p_vote and b.choice = 'ممتنع' and b.reason is not null
     order by 1 nulls last, 2;
end $$;

revoke all on function public.cast_vote(uuid, text, text), public.vote_abstain_reasons(uuid) from public, anon;
grant execute on function public.cast_vote(uuid, text, text), public.vote_abstain_reasons(uuid) to authenticated;

commit;
