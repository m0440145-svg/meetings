-- التنبيه والتذكير بالاجتماعات عبر البريد والواتساب والرسائل النصية
-- يعتمد على: 001 (is_admin) ويُفضَّل 003. لم يُجرَّب على قاعدة فعلية؛ جرّبه على نسخة تجريبية أولًا.
-- [افتراض] meetings(id, title, gregorian_date date, start_time time, location, mode, meeting_url, committee_id, created_by)
-- [افتراض] profiles(id, full_name, phone, is_active)، meeting_invitations(meeting_id, user_id)، committee_members(committee_id, user_id)
-- [افتراض] delivery_jobs(channel, recipient, template, payload jsonb, status, scheduled_for) وأن قيد channel (إن وُجد) يقبل 'sms'
-- [افتراض] التوقيت: كل المواعيد بتوقيت الرياض Asia/Riyadh، والتذكير المتكرر يُرسل الساعة 9:00 صباحًا.
--
-- آلية العمل:
--   1) المنظّم يحدد لكل اجتماع: القنوات + تكرارًا اختياريًا (يوميًا/كل يومين/كل 3 أيام/أسبوعيًا) + تذكيرات قبل الموعد بالساعات.
--   2) دالة generate_meeting_reminders() تُجدول كل 15 دقيقة وتضع رسائل في delivery_jobs (دون تكرار بفضل reminder_log).
--   3) دالة Edge اسمها process-delivery-jobs ترسل الرسائل المعلّقة فعليًا (انظر supabase/functions/process-delivery-jobs).

begin;

-- ───────────── قواعد التذكير لكل اجتماع ─────────────
create table if not exists public.meeting_reminder_rules (
  meeting_id   uuid primary key references public.meetings(id) on delete cascade,
  channels     text[] not null default '{}' check (channels <@ array['email', 'whatsapp', 'sms']::text[]),
  repeat_days  int check (repeat_days in (1, 2, 3, 7)),
  hours_before int[] not null default '{}' check (hours_before <@ array[1, 2, 3, 6, 12, 24, 48] and cardinality(hours_before) <= 4),
  enabled      boolean not null default true,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.meeting_reminder_rules enable row level security;
drop policy if exists mrr_read on public.meeting_reminder_rules;
create policy mrr_read on public.meeting_reminder_rules for select to authenticated
  using (public.is_admin() or exists (select 1 from public.meetings m where m.id = meeting_id and m.created_by = auth.uid()));
revoke insert, update, delete on public.meeting_reminder_rules from authenticated, anon;  -- الكتابة عبر الدالة فقط

-- تفضيلات العضو: يستطيع إيقاف أي قناة لنفسه
create table if not exists public.notification_preferences (
  user_id    uuid primary key default auth.uid() references public.profiles(id) on delete cascade,
  email      boolean not null default true,
  whatsapp   boolean not null default true,
  sms        boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.notification_preferences enable row level security;
drop policy if exists np_own on public.notification_preferences;
create policy np_own on public.notification_preferences for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- سجل ما أُرسل لمنع التكرار (مفتاح الخانة: r:تاريخ للتكرار أو h:ساعات للتذكير قبل الموعد)
create table if not exists public.reminder_log (
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  user_id    uuid not null,
  channel    text not null,
  slot       text not null,
  created_at timestamptz not null default now(),
  primary key (meeting_id, user_id, channel, slot)
);
alter table public.reminder_log enable row level security;  -- بلا سياسات: داخلي
revoke all on public.reminder_log from anon, authenticated;

-- ───────────── ضبط قاعدة التذكير (المنظّم أو المدير) ─────────────
create or replace function public.set_meeting_reminders(
  p_meeting uuid, p_channels text[], p_repeat_days int, p_hours int[], p_enabled boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare m public.meetings%rowtype; ch text[]; hrs int[];
begin
  select * into m from public.meetings where id = p_meeting;
  if not found then raise exception 'الاجتماع غير موجود'; end if;
  if not (public.is_admin() or m.created_by = auth.uid()) then raise exception 'لا تملك صلاحية ضبط التذكير لهذا الاجتماع'; end if;
  select coalesce(array_agg(distinct x), '{}') into ch from unnest(coalesce(p_channels, '{}')) x;
  select coalesce(array_agg(distinct x order by x desc), '{}') into hrs from unnest(coalesce(p_hours, '{}')) x;
  if p_enabled and cardinality(ch) = 0 then raise exception 'اختر قناة تنبيه واحدة على الأقل'; end if;
  if p_enabled and p_repeat_days is null and cardinality(hrs) = 0 then
    raise exception 'اختر تكرارًا أو تذكيرًا قبل الموعد بالساعات';
  end if;
  insert into public.meeting_reminder_rules(meeting_id, channels, repeat_days, hours_before, enabled, created_by)
  values (p_meeting, ch, p_repeat_days, hrs, p_enabled, auth.uid())
  on conflict (meeting_id) do update
    set channels = excluded.channels, repeat_days = excluded.repeat_days, hours_before = excluded.hours_before,
        enabled = excluded.enabled, updated_at = now();
end $$;

-- ───────────── مولّد التذكيرات (يُستدعى من cron) ─────────────
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
    -- تذكير متكرر: كل N يومًا للخلف من يوم الاجتماع (يشمل يوم الاجتماع نفسه) الساعة 9 صباحًا
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
    -- تذكير قبل الموعد بعدد ساعات
    foreach h in array r.hours_before loop
      slot_ts := start_ts - make_interval(hours => h);
      if slot_ts <= now() and slot_ts > now() - interval '3 hours' and slot_ts >= r.updated_at then
        v_slots := v_slots || ('h:' || h::text);
      end if;
    end loop;
    if cardinality(v_slots) = 0 then continue; end if;

    for rec in
      select u.user_id, au.email, p.phone, p.full_name,
             coalesce(np.email, true) as pe, coalesce(np.whatsapp, true) as pw, coalesce(np.sms, true) as ps
        from (
          select i.user_id from public.meeting_invitations i where i.meeting_id = m.id
          union
          select cm.user_id from public.committee_members cm
           where cm.committee_id = m.committee_id
             and not exists (select 1 from public.meeting_invitations i2 where i2.meeting_id = m.id)
        ) u
        join public.profiles p on p.id = u.user_id
        join auth.users au on au.id = u.user_id
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
          if rc = 0 then continue; end if;  -- أُرسل سابقًا
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
revoke execute on function public.set_meeting_reminders(uuid, text[], int, int[], boolean) from public, anon;
grant execute on function public.set_meeting_reminders(uuid, text[], int, int[], boolean) to authenticated;

-- ───────────── الجدولة: كل 15 دقيقة (يتطلب تفعيل الإضافة pg_cron من لوحة Supabase) ─────────────
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'meeting-reminders') then
      perform cron.unschedule('meeting-reminders');
    end if;
    perform cron.schedule('meeting-reminders', '*/15 * * * *', 'select public.generate_meeting_reminders()');
  else
    raise notice 'pg_cron غير مفعّلة: فعّلها من Database ▸ Extensions ثم أعد تنفيذ هذا الجزء، أو استدعِ generate_meeting_reminders() بجدولة خارجية.';
  end if;
end $$;

-- تنبيه إن كان قيد delivery_jobs.channel لا يقبل sms
do $$
declare c record;
begin
  for c in select conname, pg_get_constraintdef(oid) as def from pg_constraint
            where conrelid = 'public.delivery_jobs'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%channel%' loop
    if c.def not ilike '%sms%' then
      raise notice 'القيد % على delivery_jobs.channel لا يسمح بـ sms: عدّله ليشملها (%)', c.conname, c.def;
    end if;
  end loop;
end $$;

commit;
