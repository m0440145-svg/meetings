-- إعلان تعارض المصالح ومنع التصويت عليه.
-- 1) conflict_declarations: العضو يعلن تعارضه مع اجتماع كامل أو بند محدد (أو يسجّله المدير/أمين السر نيابةً عنه). الإعلان نشِط فورًا (احتراز) ولا يرفعه إلا المدير/أمين السر بسبب مكتوب.
-- 2) cast_vote(): يرفض تصويت من لديه إعلان نشِط على الاجتماع كله أو على بند التصويت. لا تغيير على بقية منطق cast_vote (نسخة 001 حرفيًا + فحص واحد).
-- 3) حماية: votes.agenda_item_id كان ON DELETE CASCADE (حذف بند يحذف تصويته ونتائجه) → يصبح SET NULL.
-- لا تغيير في بيانات قائمة. آمن لإعادة التنفيذ.
begin;

create table if not exists public.conflict_declarations (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  agenda_item_id uuid references public.agenda_items(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  description text not null check (char_length(btrim(description)) between 3 and 2000),
  status text not null default 'نشط' check (status in ('نشط','مرفوع')),
  declared_by uuid not null references auth.users(id),
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now()
);
create unique index if not exists conflict_active_uq on public.conflict_declarations
  (meeting_id, coalesce(agenda_item_id, '00000000-0000-0000-0000-000000000000'::uuid), user_id) where status = 'نشط';
create index if not exists conflict_meeting_idx on public.conflict_declarations(meeting_id);

alter table public.conflict_declarations enable row level security;
drop policy if exists conflict_read on public.conflict_declarations;
create policy conflict_read on public.conflict_declarations for select to authenticated
  using (public.is_admin() or user_id = auth.uid() or declared_by = auth.uid());
grant select on public.conflict_declarations to authenticated;
-- لا إدراج/تعديل مباشر: عبر الدوال فقط

create or replace function public.conflict_declare(p_meeting uuid, p_agenda uuid, p_description text, p_user uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); target uuid; nid uuid;
begin
  if uid is null then raise exception 'يجب تسجيل الدخول'; end if;
  target := coalesce(p_user, uid);
  if target <> uid and not public.is_admin() then raise exception 'لا تملك صلاحية تسجيل تعارض لعضو آخر' using errcode = '42501'; end if;
  if not exists (select 1 from public.meetings where id = p_meeting) then raise exception 'الاجتماع غير موجود'; end if;
  if not exists (select 1 from auth.users where id = target) then raise exception 'هذا العضو ليس له حساب دخول في المنصة بعد'; end if;
  if target = uid and not (public.is_admin() or exists (select 1 from public.meeting_attendees a where a.meeting_id = p_meeting and a.user_id = uid)
       or exists (select 1 from public.meetings m join public.committee_members cm on cm.committee_id = m.committee_id where m.id = p_meeting and cm.user_id = uid)) then
    raise exception 'لست من أعضاء هذا الاجتماع' using errcode = '42501';
  end if;
  if p_agenda is not null and not exists (select 1 from public.agenda_items g where g.id = p_agenda and g.meeting_id = p_meeting) then
    raise exception 'البند ليس من هذا الاجتماع';
  end if;
  if char_length(btrim(coalesce(p_description, ''))) < 3 then raise exception 'اكتب وصف التعارض'; end if;
  begin
    insert into public.conflict_declarations(meeting_id, agenda_item_id, user_id, description, declared_by)
    values (p_meeting, p_agenda, target, btrim(p_description), uid) returning id into nid;
  exception when unique_violation then
    raise exception 'يوجد إعلان نشِط لنفس العضو على نفس النطاق';
  end;
  return nid;
end $$;

create or replace function public.conflict_resolve(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'لا تملك صلاحية رفع المنع' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'اكتب سبب رفع المنع'; end if;
  update public.conflict_declarations set status = 'مرفوع', resolved_by = auth.uid(), resolved_at = now(), resolution_note = btrim(p_note)
   where id = p_id and status = 'نشط';
  if not found then raise exception 'الإعلان غير موجود أو مرفوع مسبقًا'; end if;
end $$;

-- نسخة 001 من cast_vote مع فحص تعارض المصالح فقط
create or replace function public.cast_vote(p_vote uuid, p_choice text) returns void
language plpgsql security definer set search_path = public as $$
declare v public.votes%rowtype; uid uuid := auth.uid(); vag uuid;
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
  insert into public.vote_ballots(vote_id, choice, user_id)
  values (p_vote, p_choice, case when v.vote_type = 'سري' then null else uid end);
end $$;

-- votes.agenda_item_id: من CASCADE إلى SET NULL (إن وُجدت قيود من هذا النوع)
do $$
declare r record;
begin
  for r in select c.conname from pg_constraint c
            where c.conrelid = 'public.votes'::regclass and c.contype = 'f'
              and c.confrelid = 'public.agenda_items'::regclass and c.confdeltype = 'c' loop
    execute format('alter table public.votes drop constraint %I', r.conname);
    execute 'alter table public.votes add constraint votes_agenda_item_id_fkey foreign key (agenda_item_id) references public.agenda_items(id) on delete set null';
  end loop;
end $$;

revoke all on function public.conflict_declare(uuid, uuid, text, uuid), public.conflict_resolve(uuid, text) from public, anon;
grant execute on function public.conflict_declare(uuid, uuid, text, uuid), public.conflict_resolve(uuid, text) to authenticated;
revoke all on function public.cast_vote(uuid, text) from public, anon;
grant execute on function public.cast_vote(uuid, text) to authenticated;

commit;
