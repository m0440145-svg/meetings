-- إصلاحات مراجعة ما قبل الإطلاق (الترحيلات 032–045).
-- 1) بوابة api_gate قبل كل طلب RPC (PostgREST db_pre_request): من لم يعد «معتمدًا» (موقوف/قيد الموافقة/مرفوض) لا يستدعي أي دالة،
--    فلا تتجاوز دوال SECURITY DEFINER بوابة RLS (موقوف كان يستطيع تسجيل الحضور والتصويت). يُستثنى is_approved فقط.
-- 2) is_admin() يشترط الاعتماد أيضًا.
-- 3) profiles: يُسحب UPDATE العام ويُمنح للأعمدة الذاتية فقط (الاسم، الجوال، المسمى، الجهة)؛ فلا يغيّر العضو is_manual أو email أو غيرها.
-- 4) cast_vote وattendance_self: فحص اعتماد صريح. attendance_self: نافذة الوقت تُحسب كـ timestamp (اجتماعات المساء)، وتُرفض الاجتماعات بلا تاريخ/وقت، ولا يُغيَّر الحضور إلى «معتذر» بعد التصويت.
-- 5) member_suspend: لا يوقف إلا الحساب «معتمد»، ويقفل صف المنفِّذ لمنع تسابق الإيقاف المتبادل بين المدير وأمين السر.
-- 6) member_access_set: null للّجان = لا تغيير (لا يحذف عضويات)، وتوحيد صفة «رئيس»/«chair» إلى «رئيس اللجنة»، وشرط آخر مدير يحسب المعتمدين فقط.
-- آمن لإعادة التنفيذ.
-- التراجع (عند الحاجة): البوابة: alter role authenticator reset pgrst.db_pre_request; notify pgrst, 'reload config';
--   التعديل على profiles: grant update on public.profiles to authenticated;
--   الدوال: أعد تشغيل تعريفاتها من 040 (member_access_set) و041 (attendance_self) و042 (cast_vote) و043 (member_suspend) و001 (is_admin).
begin;

-- 2) is_admin
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and coalesce(p.role_code, p.role) in ('admin', 'secretary')
       and coalesce(p.is_active, true)
       and coalesce(p.approval_status, 'معتمد') = 'معتمد'
  );
$$;

-- 3) أعمدة التعديل الذاتي
revoke update on public.profiles from authenticated, anon;
grant update (full_name, phone, job_title, organization) on public.profiles to authenticated;

-- 4) cast_vote
create or replace function public.cast_vote(p_vote uuid, p_choice text, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v public.votes%rowtype; uid uuid := auth.uid(); vag uuid; rs text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if uid is null then raise exception 'يجب تسجيل الدخول'; end if;
  if not public.is_approved() then raise exception 'حسابك غير معتمد' using errcode = '42501'; end if;
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

-- 4) attendance_self
create or replace function public.attendance_self(p_meeting uuid, p_status text) returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); m public.meetings%rowtype; st timestamptz; en timestamptz; b int; a int; old_src text; ok boolean; stl timestamp; enl timestamp;
begin
  if uid is null then raise exception 'يجب تسجيل الدخول'; end if;
  if not public.is_approved() then raise exception 'حسابك غير معتمد' using errcode = '42501'; end if;
  if p_status not in ('حاضر', 'عن بعد', 'معتذر') then raise exception 'حالة غير صالحة'; end if;
  select * into m from public.meetings where id = p_meeting;
  if not found then raise exception 'الاجتماع غير موجود'; end if;
  ok := exists (select 1 from public.committee_members cm where cm.committee_id = m.committee_id and cm.user_id = uid)
     or exists (select 1 from public.meeting_invitations i where i.meeting_id = p_meeting and i.user_id = uid)
     or exists (select 1 from public.meeting_attendees x where x.meeting_id = p_meeting and x.user_id = uid);
  if not ok then raise exception 'لست من أعضاء هذا الاجتماع أو المدعوين إليه' using errcode = '42501'; end if;
  select source into old_src from public.meeting_attendees where meeting_id = p_meeting and user_id = uid;
  if old_src = 'أمين السر' then raise exception 'سجّل أمين السر حالتك في هذا الاجتماع، ولا يغيّرها إلا هو'; end if;
  if m.gregorian_date is null or m.start_time is null then raise exception 'موعد الاجتماع غير محدد؛ يسجّل أمين السر الحضور'; end if;
  if p_status = 'معتذر' and exists (select 1 from public.vote_participation vp join public.votes v on v.id = vp.vote_id where v.meeting_id = p_meeting and vp.user_id = uid) then
    raise exception 'لا يمكن تغيير حضورك بعد مشاركتك في تصويت هذا الاجتماع';
  end if;
  select before_minutes, after_minutes into b, a from public.attendance_settings where id = 1;
  stl := m.gregorian_date + m.start_time;
  enl := case when m.end_time is null or m.end_time = m.start_time then stl + interval '3 hours'
              when m.end_time < m.start_time then (m.gregorian_date + m.end_time) + interval '1 day'
              else m.gregorian_date + m.end_time end;
  st := (stl at time zone 'Asia/Riyadh') - make_interval(mins => coalesce(b, 30));
  en := (enl at time zone 'Asia/Riyadh') + make_interval(mins => coalesce(a, 60));
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

-- 5) member_suspend
create or replace function public.member_suspend(p_user uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare pr public.profiles%rowtype; rs text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول' using errcode = '42501'; end if;
  perform 1 from public.profiles where id in (auth.uid(), p_user) order by id for update;   -- يقفل الصفين بترتيب ثابت: لا يوقف مديران بعضهما في اللحظة نفسها ولا deadlock
  if not public.is_admin() then raise exception 'لا تملك صلاحية إيقاف الحسابات' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'لا يمكنك إيقاف حسابك بنفسك'; end if;
  if char_length(rs) < 3 then raise exception 'اكتب سبب الإيقاف'; end if;
  select * into pr from public.profiles where id = p_user for update;
  if not found then raise exception 'العضو غير موجود'; end if;
  if coalesce(pr.is_manual, false) then raise exception 'العضو المضاف يدويًا يُعدَّل من «تعديل» لا من الإيقاف'; end if;
  if pr.approval_status = 'موقوف' then raise exception 'الحساب موقوف مسبقًا'; end if;
  if pr.approval_status <> 'معتمد' then raise exception 'يُوقَف الحساب المعتمد فقط؛ طلبات الانضمام تُقرَّر من «طلبات الانضمام»'; end if;
  update public.profiles set approval_status = 'موقوف', is_active = false, approval_note = left(rs, 500), approved_by = auth.uid(), approved_at = now() where id = p_user;
  insert into public.notifications(user_id, title, body) values (p_user, 'تم إيقاف حسابك', 'أوقف مدير المنصة حسابك. السبب: ' || left(rs, 300));
  insert into public.audit_logs(user_id, action, entity_type, entity_id, metadata) values (auth.uid(), 'member_suspended', 'profile', p_user, jsonb_build_object('reason', rs));
end $$;

-- 6) member_access_set
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
       select 1 from public.profiles x where x.id <> p_user and coalesce(x.role_code, x.role) in ('admin', 'secretary') and coalesce(x.is_active, true) and coalesce(x.approval_status, 'معتمد') = 'معتمد') then
    raise exception 'لا يمكن إخلاء النظام من آخر مدير';
  end if;
  if p_views is not null then
    if coalesce(array_length(p_views, 1), 0) > 150 then raise exception 'عدد الشاشات أكبر من الحد'; end if;
    foreach v in array p_views loop if char_length(v) > 60 or v !~ '^[A-Za-z0-9_-]+$' then raise exception 'اسم شاشة غير صالح'; end if; end loop;
  end if;
  update public.profiles set role_code = p_role, role = p_role, allowed_views = p_views where id = p_user;
  if p_committees is not null then   -- null = لا تغيير في اللجان
    for c in select * from jsonb_array_elements(p_committees) loop
      cid := (c->>'id')::uuid; crole := coalesce(nullif(c->>'role', ''), 'member');
      if crole not in ('member', 'عضو', 'رئيس اللجنة', 'رئيس', 'chair') then raise exception 'صفة لجنة غير صالحة'; end if;
      if crole in ('رئيس', 'chair') then crole := 'رئيس اللجنة'; end if;
      if not exists (select 1 from public.committees where id = cid) then raise exception 'لجنة غير موجودة'; end if;
      ids := ids || cid;
      insert into public.committee_members(committee_id, user_id, committee_role) values (cid, p_user, crole)
        on conflict (committee_id, user_id) do update set committee_role = excluded.committee_role;
    end loop;
    delete from public.committee_members where user_id = p_user and not (committee_id = any(ids));
  end if;
  insert into public.audit_logs(user_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'member_access_set', 'profile', p_user, jsonb_build_object('role', p_role, 'committees', coalesce(p_committees, 'null'::jsonb), 'views', to_jsonb(p_views)));
  if p_user <> auth.uid() then
    insert into public.notifications(user_id, title, body) values (p_user, 'تم تحديث صلاحياتك', 'عدّل مدير المنصة صلاحياتك ولجانك. قد تتغير الشاشات والاجتماعات الظاهرة لك.');
  end if;
end $$;

-- 1) البوابة العامة لطلبات RPC
-- قائمة سماح: غير المعتمد لا يمر إلا إلى is_approved وقراءة profiles (شاشة الانتظار). كل ما عداها مرفوض، فلا ينفع تمويه المسار بالترميز.
create or replace function public.api_gate() returns void
language plpgsql stable set search_path = public as $$
declare p text := current_setting('request.path', true); mth text := upper(coalesce(current_setting('request.method', true), ''));
begin
  if p is not null and p <> '' and auth.uid() is not null then
    if not public.is_approved() then
      if p = '/rpc/is_approved' or (p = '/profiles' and mth in ('GET', 'HEAD')) then return; end if;
      raise exception 'الحساب غير معتمد أو موقوف' using errcode = '42501';
    end if;
  end if;
end $$;
grant execute on function public.api_gate() to public, anon, authenticated, service_role;

revoke all on function public.cast_vote(uuid, text, text), public.attendance_self(uuid, text), public.member_suspend(uuid, text), public.member_access_set(uuid, text, jsonb, text[]) from public, anon;
grant execute on function public.cast_vote(uuid, text, text), public.attendance_self(uuid, text), public.member_suspend(uuid, text), public.member_access_set(uuid, text, jsonb, text[]) to authenticated;

alter role authenticator set pgrst.db_pre_request = 'public.api_gate';
notify pgrst, 'reload config';

commit;
