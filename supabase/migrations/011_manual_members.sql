-- الأعضاء اليدويون: إدخال عضو (اسم/وظيفة/جوال/بريد) دون أن يُنشئ حسابًا، ليدخل اللجان وتصله الدعوات والتذكيرات.
-- يعتمد على: is_admin() (001) ، 005 (generate_meeting_reminders). آمن لإعادة التنفيذ.
-- أثر على المخطط: يُزال ربط profiles.id بجدول auth.users (كل الجداول الأخرى تشير إلى profiles أصلًا) كي يُسمح بملف عضو بلا حساب دخول.
begin;

alter table public.profiles add column if not exists is_manual boolean not null default false;

do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.profiles'::regclass and contype = 'f' and confrelid = 'auth.users'::regclass loop
    execute format('alter table public.profiles drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.profiles alter column id set default gen_random_uuid();

-- ───────────── إضافة عضو يدوي ─────────────
create or replace function public.add_manual_member(
  p_name text, p_job text, p_org text, p_phone text, p_email text, p_committees uuid[] default '{}') returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := gen_random_uuid(); v_email text := nullif(lower(btrim(coalesce(p_email, ''))), ''); v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[\s\-()]', '', 'g'), ''); c uuid;
begin
  if not public.is_admin() then raise exception 'إضافة الأعضاء للمدير أو أمين السر فقط'; end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'اسم العضو مطلوب'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'صيغة البريد الإلكتروني غير صحيحة'; end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9]{8,15}$' then raise exception 'صيغة الجوال غير صحيحة (أرقام فقط مع رمز الدولة، مثال: 9665XXXXXXXX)'; end if;
  if v_email is not null and exists (select 1 from public.profiles where lower(email) = v_email) then raise exception 'يوجد عضو بهذا البريد مسبقًا'; end if;
  insert into public.profiles(id, full_name, phone, job_title, organization, role, role_code, is_active, email, is_manual)
  values (v_id, btrim(p_name), v_phone, nullif(btrim(coalesce(p_job, '')), ''), nullif(btrim(coalesce(p_org, '')), ''), 'member', 'member', true, v_email, true);
  foreach c in array coalesce(p_committees, '{}') loop
    insert into public.committee_members(committee_id, user_id) values (c, v_id) on conflict do nothing;
  end loop;
  return v_id;
end $$;

-- ───────────── تعديل عضو يدوي ─────────────
create or replace function public.update_manual_member(
  p_id uuid, p_name text, p_job text, p_org text, p_phone text, p_email text, p_active boolean, p_committees uuid[] default '{}') returns void
language plpgsql security definer set search_path = public as $$
declare v_email text := nullif(lower(btrim(coalesce(p_email, ''))), ''); v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[\s\-()]', '', 'g'), ''); c uuid;
begin
  if not public.is_admin() then raise exception 'تعديل الأعضاء للمدير أو أمين السر فقط'; end if;
  if not exists (select 1 from public.profiles where id = p_id and is_manual) then raise exception 'يمكن تعديل الأعضاء المضافين يدويًا فقط'; end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'اسم العضو مطلوب'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'صيغة البريد الإلكتروني غير صحيحة'; end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9]{8,15}$' then raise exception 'صيغة الجوال غير صحيحة (أرقام فقط مع رمز الدولة، مثال: 9665XXXXXXXX)'; end if;
  if v_email is not null and exists (select 1 from public.profiles where lower(email) = v_email and id <> p_id) then raise exception 'يوجد عضو بهذا البريد مسبقًا'; end if;
  update public.profiles set full_name = btrim(p_name), phone = v_phone, job_title = nullif(btrim(coalesce(p_job, '')), ''),
         organization = nullif(btrim(coalesce(p_org, '')), ''), email = v_email, is_active = coalesce(p_active, true)
   where id = p_id;
  delete from public.committee_members where user_id = p_id and committee_id <> all (coalesce(p_committees, '{}'));
  foreach c in array coalesce(p_committees, '{}') loop
    insert into public.committee_members(committee_id, user_id) values (c, p_id) on conflict do nothing;
  end loop;
end $$;

-- ───────────── حذف عضو يدوي ─────────────
create or replace function public.delete_manual_member(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'حذف الأعضاء للمدير أو أمين السر فقط'; end if;
  if not exists (select 1 from public.profiles where id = p_id and is_manual) then raise exception 'يمكن حذف الأعضاء المضافين يدويًا فقط'; end if;
  begin
    delete from public.committee_members where user_id = p_id;
    delete from public.profiles where id = p_id;
  exception when foreign_key_violation then
    raise exception 'لا يمكن حذف العضو لارتباطه بسجلات (دعوات أو مهام أو قرارات). عطّله بدلًا من حذفه من شاشة التعديل.';
  end;
end $$;

revoke execute on function public.add_manual_member(text, text, text, text, text, uuid[]), public.update_manual_member(uuid, text, text, text, text, text, boolean, uuid[]),
  public.delete_manual_member(uuid) from public, anon;
grant execute on function public.add_manual_member(text, text, text, text, text, uuid[]), public.update_manual_member(uuid, text, text, text, text, text, boolean, uuid[]),
  public.delete_manual_member(uuid) to authenticated;

-- ───────────── التذكيرات: البريد من ملف العضو إن لم يكن له حساب ─────────────
create or replace function public.generate_meeting_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare
  tz constant text := 'Asia/Riyadh';
  r public.meeting_reminder_rules%rowtype;
  m public.meetings%rowtype;
  rec record;
  v_slots text[]; v_slot text;
  start_ts timestamptz; slot_ts timestamptz; slot_date date;
  k int; h int; ch text; dest text; allowed boolean; rc int; n int := 0;
begin
  for r in select * from public.meeting_reminder_rules where enabled loop
    select * into m from public.meetings where id = r.meeting_id;
    if not found then continue; end if;
    start_ts := (m.gregorian_date::timestamp + coalesce(m.start_time, time '09:00')) at time zone tz;
    if start_ts <= now() then continue; end if;

    v_slots := '{}';
    if r.repeat_days is not null then
      for k in 0..60 loop
        slot_date := m.gregorian_date - (k * r.repeat_days);
        exit when slot_date < current_date - 1;
        slot_ts := (slot_date::timestamp + time '09:00') at time zone tz;
        if slot_ts <= now() and slot_ts > now() - interval '12 hours'
           and slot_ts >= r.updated_at and slot_ts < start_ts - interval '30 minutes' then
          v_slots := v_slots || ('r:' || slot_date::text);
        end if;
      end loop;
    end if;
    foreach h in array r.hours_before loop
      slot_ts := start_ts - make_interval(hours => h);
      if slot_ts <= now() and slot_ts > now() - interval '3 hours' and slot_ts >= r.updated_at then
        v_slots := v_slots || ('h:' || h::text);
      end if;
    end loop;
    if cardinality(v_slots) = 0 then continue; end if;

    for rec in
      select u.user_id, coalesce(au.email, p.email) as email, p.phone, p.full_name,
             coalesce(np.email, true) as pe, coalesce(np.whatsapp, true) as pw, coalesce(np.sms, true) as ps
        from (
          select i.user_id from public.meeting_invitations i where i.meeting_id = m.id
          union
          select cm.user_id from public.committee_members cm
           where cm.committee_id = m.committee_id
             and not exists (select 1 from public.meeting_invitations i2 where i2.meeting_id = m.id)
        ) u
        join public.profiles p on p.id = u.user_id
        left join auth.users au on au.id = u.user_id
        left join public.notification_preferences np on np.user_id = u.user_id
       where u.user_id is not null and coalesce(p.is_active, true)
         and not exists (select 1 from public.meeting_attendees a
                          where a.meeting_id = m.id and a.user_id = u.user_id and a.attendance_status = 'معتذر')
    loop
      foreach v_slot in array v_slots loop
        foreach ch in array r.channels loop
          dest := case ch when 'email' then rec.email else rec.phone end;
          allowed := case ch when 'email' then rec.pe when 'whatsapp' then rec.pw else rec.ps end;
          if not allowed or dest is null or btrim(dest) = '' then continue; end if;
          insert into public.reminder_log(meeting_id, user_id, channel, slot)
          values (m.id, rec.user_id, ch, v_slot) on conflict do nothing;
          get diagnostics rc = row_count;
          if rc = 0 then continue; end if;
          begin
            insert into public.delivery_jobs(channel, recipient, template, payload, status)
            values (ch, dest, 'meeting_reminder',
                    jsonb_build_object('meeting_id', m.id, 'title', m.title, 'date', m.gregorian_date, 'time', m.start_time,
                                       'location', m.location, 'mode', m.mode, 'url', m.meeting_url,
                                       'slot', v_slot, 'name', rec.full_name),
                    'pending');
            n := n + 1;
          exception when others then
            raise warning 'تعذر إنشاء تذكير (% / %): %', ch, m.id, sqlerrm;
            delete from public.reminder_log where meeting_id = m.id and user_id = rec.user_id and channel = ch and slot = v_slot;
          end;
        end loop;
      end loop;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function public.generate_meeting_reminders() from public, anon, authenticated;

commit;
