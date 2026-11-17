-- تسجيل الحضور: العضو يسجّل حضوره بنفسه في نافذة زمنية، وأمين السر هو المرجع.
-- 1) meeting_attendees.source: 'ذاتي' أو 'أمين السر'. ما سجّله أمين السر لا يغيّره العضو بنفسه.
-- 2) attendance_settings: دقائق السماح قبل بدء الاجتماع وبعد نهايته (الافتراضي 30 و60، يعدّلها المدير).
-- 3) attendance_self(): للعضو في لجنة الاجتماع أو المدعو إليه: «حاضر» أو «عن بعد» أو «معتذر» لنفسه فقط ضمن النافذة (بتوقيت الرياض).
-- 4) attendance_set(): للمدير/أمين السر: يسجّل أو يعدّل حالة أي عضو («حاضر»/«عن بعد»/«معتذر»/«غائب») أو يمسحها بـ null (فيعود للعضو حق التسجيل الذاتي)؛ «غائب» تقفل التسجيل الذاتي.
-- الكتابة المباشرة على الجدول تبقى للمدير فقط. cast_vote وis_present لم يتغيرا (حاضر/عن بعد فقط). سجل تدقيق لكل تسجيل. آمن لإعادة التنفيذ.
begin;

alter table public.meeting_attendees add column if not exists source text not null default 'أمين السر';
do $$ begin
  alter table public.meeting_attendees add constraint meeting_attendees_source_chk check (source in ('ذاتي', 'أمين السر'));
exception when duplicate_object then null; end $$;

create table if not exists public.attendance_settings (
  id int primary key default 1 check (id = 1),
  before_minutes int not null default 30 check (before_minutes between 0 and 1440),
  after_minutes int not null default 60 check (after_minutes between 0 and 1440),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
insert into public.attendance_settings(id) values (1) on conflict (id) do nothing;
alter table public.attendance_settings enable row level security;
drop policy if exists attendance_settings_read on public.attendance_settings;
create policy attendance_settings_read on public.attendance_settings for select to authenticated using (true);
drop policy if exists attendance_settings_admin on public.attendance_settings;
create policy attendance_settings_admin on public.attendance_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists approved_only on public.attendance_settings;
create policy approved_only on public.attendance_settings as restrictive for all to authenticated using ((select public.is_approved())) with check ((select public.is_approved()));
grant select, insert, update, delete on public.attendance_settings to authenticated;

create or replace function public.attendance_self(p_meeting uuid, p_status text) returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); m public.meetings%rowtype; st timestamptz; en timestamptz; b int; a int; old_src text; ok boolean;
begin
  if uid is null then raise exception 'يجب تسجيل الدخول'; end if;
  if p_status not in ('حاضر', 'عن بعد', 'معتذر') then raise exception 'حالة غير صالحة'; end if;
  select * into m from public.meetings where id = p_meeting;
  if not found then raise exception 'الاجتماع غير موجود'; end if;
  ok := exists (select 1 from public.committee_members cm where cm.committee_id = m.committee_id and cm.user_id = uid)
     or exists (select 1 from public.meeting_invitations i where i.meeting_id = p_meeting and i.user_id = uid)
     or exists (select 1 from public.meeting_attendees x where x.meeting_id = p_meeting and x.user_id = uid);
  if not ok then raise exception 'لست من أعضاء هذا الاجتماع أو المدعوين إليه' using errcode = '42501'; end if;
  select source into old_src from public.meeting_attendees where meeting_id = p_meeting and user_id = uid;
  if old_src = 'أمين السر' then raise exception 'سجّل أمين السر حالتك في هذا الاجتماع، ولا يغيّرها إلا هو'; end if;
  select before_minutes, after_minutes into b, a from public.attendance_settings where id = 1;
  st := ((m.gregorian_date + m.start_time) at time zone 'Asia/Riyadh') - make_interval(mins => coalesce(b, 30));
  en := ((m.gregorian_date + coalesce(m.end_time, m.start_time + interval '3 hours')) at time zone 'Asia/Riyadh') + make_interval(mins => coalesce(a, 60));
  if now() < st or now() > en then
    raise exception 'التسجيل متاح من % إلى % بتوقيت الرياض', to_char(st at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI'), to_char(en at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI');
  end if;
  insert into public.meeting_attendees(meeting_id, user_id, attendance_status, attended_at, source)
    values (p_meeting, uid, p_status, now(), 'ذاتي')
  on conflict (meeting_id, user_id) do update set attendance_status = excluded.attendance_status, attended_at = excluded.attended_at, source = 'ذاتي';
  insert into public.audit_logs(user_id, action, entity_type, entity_id, metadata)
    values (uid, 'attendance_self', 'meeting', p_meeting, jsonb_build_object('status', p_status));
  return p_status;
end $$;

create or replace function public.attendance_set(p_meeting uuid, p_user uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'لا تملك صلاحية تسجيل حضور الأعضاء' using errcode = '42501'; end if;
  if not exists (select 1 from public.meetings where id = p_meeting) then raise exception 'الاجتماع غير موجود'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'العضو غير موجود'; end if;
  if p_status is null then
    delete from public.meeting_attendees where meeting_id = p_meeting and user_id = p_user;
  else
    if p_status not in ('حاضر', 'عن بعد', 'معتذر', 'غائب') then raise exception 'حالة غير صالحة'; end if;
    insert into public.meeting_attendees(meeting_id, user_id, attendance_status, attended_at, source)
      values (p_meeting, p_user, p_status, now(), 'أمين السر')
    on conflict (meeting_id, user_id) do update set attendance_status = excluded.attendance_status, attended_at = excluded.attended_at, source = 'أمين السر';
  end if;
  insert into public.audit_logs(user_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'attendance_set', 'meeting', p_meeting, jsonb_build_object('user', p_user, 'status', p_status));
end $$;

revoke all on function public.attendance_self(uuid, text), public.attendance_set(uuid, uuid, text) from public, anon;
grant execute on function public.attendance_self(uuid, text), public.attendance_set(uuid, uuid, text) to authenticated;

commit;
