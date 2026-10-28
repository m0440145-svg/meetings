-- الجهات (مجلس إدارة / لجان / جمعية عمومية): نوع الجهة وتاريخ البداية، تعديل الجهة، واستيراد الأعضاء من Excel.
-- يعتمد على: is_admin() (001) ، 011 (الأعضاء اليدويون). آمن لإعادة التنفيذ ولا يغيّر أي بيانات قائمة.
begin;

-- عمود النوع: يُضاف مع قيد القيم المسموحة فقط إن لم يكن موجودًا (إن وُجد من قبل نتركه كما هو)
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'committees' and column_name = 'type') then
    alter table public.committees add column type text not null default 'لجنة';
    alter table public.committees add constraint committees_type_chk check (type in ('مجلس إدارة', 'لجنة', 'جمعية عمومية'));
  end if;
end $$;
alter table public.committees add column if not exists start_date date;

-- توحيد صيغة الجوال: أرقام فقط، و05XXXXXXXX / 5XXXXXXXX → 9665XXXXXXXX ، و00 تُحذف
create or replace function public.dm_norm_phone(p text) returns text
language sql immutable as $$
  select case when d = '' then null
              when d ~ '^05[0-9]{8}$' then '966' || substr(d, 2)
              when d ~ '^5[0-9]{8}$' then '966' || d
              when d ~ '^00' then substr(d, 3)
              else d end
    from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x
$$;

-- ───────────── إضافة جهة ─────────────
create or replace function public.add_committee(p_name text, p_type text, p_start date, p_description text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'إضافة الجهات للمدير أو أمين السر فقط'; end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'اسم الجهة مطلوب'; end if;
  if coalesce(p_type, '') not in ('مجلس إدارة', 'لجنة', 'جمعية عمومية') then raise exception 'نوع الجهة غير صحيح'; end if;
  if exists (select 1 from public.committees where lower(btrim(name)) = lower(btrim(p_name))) then raise exception 'توجد جهة بهذا الاسم مسبقًا'; end if;
  insert into public.committees(name, type, start_date, description, created_by)
  values (btrim(p_name), p_type, p_start, nullif(btrim(coalesce(p_description, '')), ''), auth.uid()) returning id into v_id;
  return v_id;
end $$;

-- ───────────── تعديل جهة (الاسم، النوع، تاريخ البداية، الوصف) ─────────────
create or replace function public.update_committee(p_id uuid, p_name text, p_type text, p_start date, p_description text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'تعديل الجهات للمدير أو أمين السر فقط'; end if;
  if not exists (select 1 from public.committees where id = p_id) then raise exception 'الجهة غير موجودة'; end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'اسم الجهة مطلوب'; end if;
  if coalesce(p_type, '') not in ('مجلس إدارة', 'لجنة', 'جمعية عمومية') then raise exception 'نوع الجهة غير صحيح'; end if;
  if exists (select 1 from public.committees where lower(btrim(name)) = lower(btrim(p_name)) and id <> p_id) then raise exception 'توجد جهة بهذا الاسم مسبقًا'; end if;
  update public.committees set name = btrim(p_name), type = p_type, start_date = p_start, description = nullif(btrim(coalesce(p_description, '')), '')
   where id = p_id;
end $$;

-- ───────────── استيراد أعضاء (من Excel) إلى جهة ─────────────
-- p_rows: [{name, job, org, phone, email, role}] ، حتى 500 صف. يعيد نتيجة كل صف: created | linked | exists | error
-- المطابقة: بالبريد ثم بالجوال مع الأعضاء القائمين (حسابات أو يدويين) فلا يتكرر عضو؛ وإلا يُنشأ عضو يدوي.
create or replace function public.import_members(p_committee uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; i int := 0; res jsonb := '[]'::jsonb; v_name text; v_email text; v_phone text; v_role text; v_job text; v_org text; v_id uuid; v_st text; v_msg text; v_existing text;
begin
  if not public.is_admin() then raise exception 'استيراد الأعضاء للمدير أو أمين السر فقط'; end if;
  if not exists (select 1 from public.committees where id = p_committee) then raise exception 'الجهة غير موجودة'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'صيغة البيانات غير صحيحة'; end if;
  if jsonb_array_length(p_rows) > 500 then raise exception 'الحد الأقصى 500 صف في كل عملية استيراد'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1; v_name := null; v_id := null; v_st := null; v_msg := null;
    begin
      v_name := btrim(coalesce(r->>'name', ''));
      v_email := nullif(lower(btrim(coalesce(r->>'email', ''))), '');
      v_phone := public.dm_norm_phone(r->>'phone');
      v_role := nullif(left(btrim(coalesce(r->>'role', '')), 60), '');
      v_job := nullif(left(btrim(coalesce(r->>'job', '')), 120), '');
      v_org := nullif(left(btrim(coalesce(r->>'org', '')), 120), '');
      if v_name = '' then raise exception 'الاسم مطلوب'; end if;
      if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'صيغة البريد غير صحيحة'; end if;
      if v_phone is not null and v_phone !~ '^[0-9]{8,15}$' then raise exception 'صيغة الجوال غير صحيحة'; end if;

      if v_email is not null then
        select p.id, p.full_name into v_id, v_existing from public.profiles p
         where lower(p.email) = v_email or exists (select 1 from auth.users u where u.id = p.id and lower(u.email) = v_email) limit 1;
      end if;
      if v_id is null and v_phone is not null then
        select p.id, p.full_name into v_id, v_existing from public.profiles p where public.dm_norm_phone(p.phone) = v_phone limit 1;
      end if;

      if v_id is null then
        v_id := gen_random_uuid();
        insert into public.profiles(id, full_name, phone, job_title, organization, role, role_code, is_active, email, is_manual)
        values (v_id, v_name, v_phone, v_job, v_org, 'member', 'member', true, v_email, true);
        v_st := 'created';
      else
        v_st := 'linked'; v_msg := 'مطابق لعضو قائم: ' || coalesce(v_existing, '');
      end if;

      if exists (select 1 from public.committee_members where committee_id = p_committee and user_id = v_id) then
        update public.committee_members set committee_role = coalesce(v_role, committee_role) where committee_id = p_committee and user_id = v_id;
        if v_st = 'linked' then v_st := 'exists'; v_msg := 'عضو في هذه الجهة مسبقًا: ' || coalesce(v_existing, ''); end if;
      else
        insert into public.committee_members(committee_id, user_id, committee_role) values (p_committee, v_id, v_role);
      end if;
      res := res || jsonb_build_object('row', i, 'status', v_st, 'name', v_name, 'message', v_msg);
    exception when others then
      res := res || jsonb_build_object('row', i, 'status', 'error', 'name', coalesce(v_name, ''), 'message', sqlerrm);
    end;
  end loop;
  return res;
end $$;

revoke execute on function public.add_committee(text, text, date, text), public.update_committee(uuid, text, text, date, text), public.import_members(uuid, jsonb) from public, anon;
grant execute on function public.add_committee(text, text, date, text), public.update_committee(uuid, text, text, date, text), public.import_members(uuid, jsonb) to authenticated;
grant execute on function public.dm_norm_phone(text) to authenticated;

commit;
