-- موافقة المدير على الحسابات الجديدة.
-- التسجيل الذاتي يبقى، لكن الحساب الجديد يُنشأ «قيد الموافقة» ولا يرى أي بيانات حتى يعتمده المدير/أمين السر ويحدد دوره ولجانه.
-- 1) profiles.approval_status ('معتمد' | 'قيد الموافقة' | 'مرفوض'): الحسابات الحالية تُعتمد تلقائيًا، والجديدة تبدأ «قيد الموافقة».
-- 2) is_approved(): دالة الحماية. سياسة RESTRICTIVE باسم approved_only على كل جداول public وعلى storage.objects تمنع غير المعتمد من أي قراءة أو كتابة
--    (ملفه الشخصي وحده مقروء له ليعرض شاشة الانتظار).
-- 3) access_requests() / access_decide(): قائمة الطلبات وقرار الموافقة (الدور + اللجان) أو الرفض، للمدير فقط. لا يظهر الطلب ولا يُقبل إلا بعد تأكيد البريد.
-- 4) إشعار للمديرين عند وصول طلب مؤكَّد، وإشعار لصاحب الطلب عند القرار، وسجل في audit_logs.
-- 5) approval_gate_missing(): تعرض أي جدول في public بلا سياسة الحماية (لتشغيلها بعد إضافة جداول مستقبلًا).
-- آمن لإعادة التنفيذ.
begin;

alter table public.profiles add column if not exists approval_status text not null default 'معتمد';
do $$ begin
  alter table public.profiles add constraint profiles_approval_status_chk check (approval_status in ('معتمد','قيد الموافقة','مرفوض'));
exception when duplicate_object then null; end $$;
alter table public.profiles add column if not exists approved_by uuid;
alter table public.profiles add column if not exists approved_at timestamptz;
alter table public.profiles add column if not exists approval_note text;
alter table public.profiles alter column approval_status set default 'قيد الموافقة';

-- أي مستخدم دخول بلا ملف شخصي (حسابات سابقة) يُنشأ له ملف معتمد حتى لا يُحجب
insert into public.profiles(id, full_name, approval_status)
select u.id, coalesce(u.raw_user_meta_data->>'full_name', ''), 'معتمد'
  from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

create or replace function public.is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.approval_status = 'معتمد');
$$;
revoke all on function public.is_approved() from public, anon;
grant execute on function public.is_approved() to authenticated;

-- لا يغيّر حالة الموافقة إلا مدير؛ والإدراج المباشر من مستخدم عادي يُجبَر على «قيد الموافقة»
create or replace function public.guard_profile_approval() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    new.approval_status := 'قيد الموافقة'; new.approved_by := null; new.approved_at := null; new.approval_note := null;
  elsif new.approval_status is distinct from old.approval_status or new.approved_by is distinct from old.approved_by
     or new.approved_at is distinct from old.approved_at or new.approval_note is distinct from old.approval_note then
    raise exception 'لا تملك صلاحية تعديل حالة الموافقة';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_profile_approval on public.profiles;
create trigger trg_guard_profile_approval before insert or update on public.profiles
  for each row execute function public.guard_profile_approval();

-- إشعار المديرين بطلب جديد مؤكَّد البريد
create or replace function public.notify_admins_new_request(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  select coalesce(nullif(full_name, ''), 'مستخدم جديد') into nm from public.profiles where id = p_user;
  insert into public.notifications(user_id, title, body)
  select p.id, 'طلب انضمام جديد', 'طلب «' || nm || '» اعتماد حسابه في المنصة. افتح «طلبات الانضمام» للمراجعة.'
    from public.profiles p where coalesce(p.role_code, p.role) in ('admin', 'secretary') and coalesce(p.is_active, true) and p.approval_status = 'معتمد';
end $$;
revoke all on function public.notify_admins_new_request(uuid) from public, anon, authenticated;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, full_name, phone, email, approval_status)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), new.phone, new.email, 'قيد الموافقة')
  on conflict (id) do nothing;
  if new.email_confirmed_at is not null then perform public.notify_admins_new_request(new.id); end if;
  return new;
end $$;

create or replace function public.on_user_confirmed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null
     and exists (select 1 from public.profiles where id = new.id and approval_status = 'قيد الموافقة') then
    perform public.notify_admins_new_request(new.id);
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed after update of email_confirmed_at on auth.users
  for each row execute function public.on_user_confirmed();

create or replace function public.access_requests() returns table(user_id uuid, full_name text, email text, phone text, requested_at timestamptz, status text, note text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'لا تملك صلاحية عرض طلبات الانضمام' using errcode = '42501'; end if;
  return query
    select p.id, p.full_name, u.email::text, p.phone, p.created_at, p.approval_status, p.approval_note
      from public.profiles p join auth.users u on u.id = p.id
     where p.approval_status in ('قيد الموافقة', 'مرفوض') and u.email_confirmed_at is not null
     order by (p.approval_status = 'قيد الموافقة') desc, p.created_at desc;
end $$;

create or replace function public.access_decide(p_user uuid, p_approve boolean, p_role text default 'member', p_committees uuid[] default '{}', p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare pr public.profiles%rowtype; cid uuid; confirmed boolean;
begin
  if not public.is_admin() then raise exception 'لا تملك صلاحية البت في طلبات الانضمام' using errcode = '42501'; end if;
  select * into pr from public.profiles where id = p_user for update;
  if not found then raise exception 'الطلب غير موجود'; end if;
  if pr.approval_status = 'معتمد' then raise exception 'الحساب معتمد مسبقًا'; end if;
  select (email_confirmed_at is not null) into confirmed from auth.users where id = p_user;
  if not coalesce(confirmed, false) then raise exception 'لم يؤكّد صاحب الطلب بريده الإلكتروني بعد'; end if;
  if p_approve then
    if p_role not in ('member', 'secretary', 'admin') then raise exception 'دور غير صالح'; end if;
    update public.profiles set approval_status = 'معتمد', role_code = p_role, role = p_role, is_active = true,
           approved_by = auth.uid(), approved_at = now(), approval_note = nullif(btrim(coalesce(p_note, '')), '') where id = p_user;
    foreach cid in array coalesce(p_committees, '{}') loop
      insert into public.committee_members(committee_id, user_id) values (cid, p_user) on conflict do nothing;
    end loop;
    insert into public.notifications(user_id, title, body) values (p_user, 'تمت الموافقة على حسابك', 'اعتمد مدير المنصة حسابك. يمكنك الآن استخدام المنصة.');
  else
    update public.profiles set approval_status = 'مرفوض', approved_by = auth.uid(), approved_at = now(), approval_note = nullif(btrim(coalesce(p_note, '')), '') where id = p_user;
  end if;
  insert into public.audit_logs(user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), case when p_approve then 'account_approved' else 'account_rejected' end, 'profile', p_user,
          jsonb_build_object('role', case when p_approve then p_role end, 'committees', coalesce(p_committees, '{}'), 'note', p_note));
end $$;

revoke all on function public.access_requests(), public.access_decide(uuid, boolean, text, uuid[], text) from public, anon;
grant execute on function public.access_requests(), public.access_decide(uuid, boolean, text, uuid[], text) to authenticated;

-- سياسة الحماية على كل جداول public (RESTRICTIVE: تُضاف على السياسات القائمة ولا تستبدلها)
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('drop policy if exists approved_only on public.%I', r.tablename);
    if r.tablename = 'profiles' then
      execute 'create policy approved_only on public.profiles as restrictive for all to authenticated using ((select public.is_approved()) or id = auth.uid()) with check ((select public.is_approved()) or id = auth.uid())';
    else
      execute format('create policy approved_only on public.%I as restrictive for all to authenticated using ((select public.is_approved())) with check ((select public.is_approved()))', r.tablename);
    end if;
  end loop;
end $$;

drop policy if exists approved_only on storage.objects;
create policy approved_only on storage.objects as restrictive for all to authenticated using ((select public.is_approved())) with check ((select public.is_approved()));

create or replace function public.approval_gate_missing() returns setof text
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'للمدير فقط' using errcode = '42501'; end if;
  return query select t.tablename::text from pg_tables t
    where t.schemaname = 'public' and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.tablename and p.policyname = 'approved_only');
end $$;
revoke all on function public.approval_gate_missing() from public, anon;
grant execute on function public.approval_gate_missing() to authenticated;

commit;
