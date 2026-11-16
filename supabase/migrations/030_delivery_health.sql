-- الإشعارات: لوحة صحة الإرسال للمدير وأمين السر. دالتان فقط، بلا جداول جديدة ولا تغيير في الطابور أو الدوال القائمة.
-- 1) delivery_health(): حالة طابور الإرسال (delivery_jobs) والمجدول الدوري (pg_cron) والتذكيرات المولَّدة وتفضيلات الأعضاء، مع آخر الرسائل الفاشلة بعناوين مقنَّعة.
-- 2) delivery_requeue(): يعيد الرسائل الفاشلة إلى الانتظار (لا يمسّ المرسَلة)، بتأكيد من الواجهة.
-- يعتمد على: is_admin() (001)، delivery_jobs / reminder_log / notification_preferences / profiles، وإضافة pg_cron إن وُجدت. آمن لإعادة التنفيذ.
begin;

create or replace function public.delivery_mask(p text) returns text
language sql immutable as $$
  select case when p is null or p = '' then '—'
              when position('@' in p) > 1 then left(split_part(p, '@', 1), 2) || '***@' || split_part(p, '@', 2)
              else '***' || right(regexp_replace(p, '\D', '', 'g'), 3) end
$$;

create or replace function public.delivery_health() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb; cron_rows jsonb := '[]'::jsonb;
begin
  if not public.is_admin() then raise exception 'permission denied' using errcode = '42501'; end if;
  begin
    execute $q$select coalesce(jsonb_agg(jsonb_build_object('job', j.jobname, 'schedule', j.schedule, 'active', j.active,
              'last_status', d.status, 'last_run', d.start_time, 'minutes_ago', round(extract(epoch from now() - d.start_time) / 60)) order by j.jobname), '[]'::jsonb)
            from cron.job j left join lateral (select r.status, r.start_time from cron.job_run_details r where r.jobid = j.jobid order by r.start_time desc limit 1) d on true$q$ into cron_rows;
  exception when others then cron_rows := '[]'::jsonb;
  end;
  select jsonb_build_object(
    'queue', (select coalesce(jsonb_agg(jsonb_build_object('channel', channel, 'status', status, 'n', n) order by channel, status), '[]'::jsonb)
                from (select channel, coalesce(status, '—') as status, count(*) n from public.delivery_jobs group by channel, status) s),
    'due_pending', (select count(*) from public.delivery_jobs where status = 'pending' and coalesce(scheduled_for, now()) <= now()),
    'oldest_due_minutes', (select round(extract(epoch from now() - min(scheduled_for)) / 60) from public.delivery_jobs where status = 'pending' and scheduled_for <= now()),
    'sent_24h', (select count(*) from public.delivery_jobs where status = 'sent' and sent_at > now() - interval '24 hours'),
    'failed_total', (select count(*) from public.delivery_jobs where status = 'failed'),
    'failed_recent', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'channel', channel, 'to', public.delivery_mask(recipient), 'template', template, 'attempts', attempts, 'error', left(coalesce(last_error, ''), 200), 'at', created_at) order by created_at desc), '[]'::jsonb)
                       from (select * from public.delivery_jobs where status = 'failed' order by created_at desc limit 20) f),
    'cron', cron_rows,
    'reminders_24h', (select count(*) from public.reminder_log where created_at > now() - interval '24 hours'),
    'prefs', jsonb_build_object('email', (select count(*) from public.notification_preferences where email), 'whatsapp', (select count(*) from public.notification_preferences where whatsapp), 'sms', (select count(*) from public.notification_preferences where sms)),
    'members_active', (select count(*) from public.profiles where coalesce(is_active, true)),
    'members_no_phone', (select count(*) from public.profiles where coalesce(is_active, true) and coalesce(btrim(phone), '') = '')
  ) into res;
  return res;
end $$;

create or replace function public.delivery_requeue(p_channel text default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'permission denied' using errcode = '42501'; end if;
  update public.delivery_jobs set status = 'pending', scheduled_for = now() where status = 'failed' and (p_channel is null or channel = p_channel);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.delivery_mask(text) from public, anon, authenticated; -- داخلية: تستدعيها delivery_health فقط
revoke all on function public.delivery_health() from public, anon;
revoke all on function public.delivery_requeue(text) from public, anon;
grant execute on function public.delivery_health() to authenticated;
grant execute on function public.delivery_requeue(text) to authenticated;

commit;
