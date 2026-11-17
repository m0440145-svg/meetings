-- صلاحيات العضو من صفحة «الأعضاء»: الدور واللجان والشاشات المتاحة، يحددها المدير/أمين السر.
-- 1) profiles.allowed_views (text[]): null = كل الشاشات؛ مصفوفة = تظهر هذه الشاشات فقط (للواجهة؛ حماية البيانات نفسها بسياسات RLS وعضوية اللجان). لا يغيّرها إلا المدير.
-- 2) member_access_get / member_access_set (للمدير فقط): قراءة وضبط الدور واللجان (مع صفة العضو: عضو/رئيس اللجنة) والشاشات في عملية واحدة، مع سجل تدقيق وإشعار للعضو. لا يغيّر المدير دور نفسه، ولا يُخلى النظام من آخر مدير.
-- 3) committees: القراءة للمدير ولأعضاء اللجنة (أو من حضر/دُعي لاجتماع لجنتها) فقط، بدل «أي مسجَّل». committee_members سياسته الحالية تقصر العضو على صفوفه.
-- آمن لإعادة التنفيذ.
begin;

alter table public.profiles add column if not exists allowed_views text[];
grant select (allowed_views) on public.profiles to authenticated;

create or replace function public.guard_profile_views() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if tg_op = 'INSERT' then new.allowed_views := null;
  elsif new.allowed_views is distinct from old.allowed_views then raise exception 'لا تملك صلاحية تعديل الشاشات المتاحة';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_profile_views on public.profiles;
create trigger trg_guard_profile_views before insert or update on public.profiles for each row execute function public.guard_profile_views();

create or replace function public.member_access_get(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pr public.profiles%rowtype;
begin
  if not public.is_admin() then raise exception 'لا تملك صلاحية عرض صلاحيات الأعضاء' using errcode = '42501'; end if;
  select * into pr from public.profiles where id = p_user;
  if not found then raise exception 'العضو غير موجود'; end if;
  return jsonb_build_object('role', coalesce(pr.role_code, pr.role, 'member'), 'views', to_jsonb(pr.allowed_views),
    'committees', coalesce((select jsonb_agg(jsonb_build_object('id', cm.committee_id, 'role', coalesce(cm.committee_role, 'member'))) from public.committee_members cm where cm.user_id = p_user), '[]'::jsonb));
end $$;

create or replace function public.member_access_set(p_user uuid, p_role text, p_committees jsonb, p_views text[]) returns void
language plpgsql security definer set search_path = public as $$
declare pr public.profiles%rowtype; cur text; c jsonb; cid uuid; crole text; ids uuid[] := '{}'; v text;
begin
  if not public.is_admin() then raise exception 'لا تملك صلاحية تعديل صلاحيات الأعضاء' using errcode = '42501'; end if;
  select * into pr from public.profiles where id = p_user for update;
  if not found then raise exception 'العضو غير موجود'; end if;
  cur := coalesce(pr.role_code, pr.role, 'member');
  if p_role not in ('member', 'secretary', 'admin') then raise exception 'دور غير صالح'; end if;
  if p_user = auth.uid() and p_role <> cur then raise exception 'لا تغيّر دورك بنفسك'; end if;
  if cur in ('admin', 'secretary') and p_role = 'member' and not exists (
       select 1 from public.profiles x where x.id <> p_user and coalesce(x.role_code, x.role) in ('admin', 'secretary') and coalesce(x.is_active, true)) then
    raise exception 'لا يمكن إخلاء النظام من آخر مدير';
  end if;
  if p_views is not null then
    if coalesce(array_length(p_views, 1), 0) > 150 then raise exception 'عدد الشاشات أكبر من الحد'; end if;
    foreach v in array p_views loop if char_length(v) > 60 or v !~ '^[A-Za-z0-9_-]+$' then raise exception 'اسم شاشة غير صالح'; end if; end loop;
  end if;
  update public.profiles set role_code = p_role, role = p_role, allowed_views = p_views where id = p_user;
  for c in select * from jsonb_array_elements(coalesce(p_committees, '[]'::jsonb)) loop
    cid := (c->>'id')::uuid; crole := coalesce(nullif(c->>'role', ''), 'member');
    if crole not in ('member', 'عضو', 'رئيس اللجنة') then raise exception 'صفة لجنة غير صالحة'; end if;
    if not exists (select 1 from public.committees where id = cid) then raise exception 'لجنة غير موجودة'; end if;
    ids := ids || cid;
    insert into public.committee_members(committee_id, user_id, committee_role) values (cid, p_user, crole)
      on conflict (committee_id, user_id) do update set committee_role = excluded.committee_role;
  end loop;
  delete from public.committee_members where user_id = p_user and not (committee_id = any(ids));
  insert into public.audit_logs(user_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'member_access_set', 'profile', p_user, jsonb_build_object('role', p_role, 'committees', coalesce(p_committees, '[]'::jsonb), 'views', to_jsonb(p_views)));
  if p_user <> auth.uid() then
    insert into public.notifications(user_id, title, body) values (p_user, 'تم تحديث صلاحياتك', 'عدّل مدير المنصة صلاحياتك ولجانك. قد تتغير الشاشات والاجتماعات الظاهرة لك.');
  end if;
end $$;
revoke all on function public.member_access_get(uuid), public.member_access_set(uuid, text, jsonb, text[]) from public, anon;
grant execute on function public.member_access_get(uuid), public.member_access_set(uuid, text, jsonb, text[]) to authenticated;

-- اللجان: لا يرى العضو إلا لجانه (أو لجان اجتماعات حضرها/دُعي إليها)
drop policy if exists "committees authenticated read" on public.committees;
create policy "committees authenticated read" on public.committees for select to authenticated using (
  public.is_admin()
  or created_by = auth.uid()
  or exists (select 1 from public.committee_members cm where cm.committee_id = committees.id and cm.user_id = auth.uid())
  or exists (select 1 from public.meetings m join public.meeting_attendees ma on ma.meeting_id = m.id where m.committee_id = committees.id and ma.user_id = auth.uid()));

commit;
