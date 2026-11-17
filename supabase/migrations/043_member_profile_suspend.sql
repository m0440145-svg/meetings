-- تعديل بيانات العضو وإيقاف/إعادة تفعيل حسابه (للمدير/أمين السر).
-- 1) approval_status يقبل 'موقوف' أيضًا: is_approved() لا يعتمد إلا 'معتمد' فيُحجب الموقوف عن كل البيانات (سياسة approved_only) ويرى ملفه فقط لعرض شاشة «حسابك موقوف». الجلسات القائمة لا تفيده لأن الحجب في قاعدة البيانات.
-- 2) member_profile_update(): الاسم والمسمى والجهة والجوال، مع تدقيق.
-- 3) member_suspend(user, reason) / member_reactivate(user, note): السبب إلزامي للإيقاف؛ لا يوقف المدير نفسه؛ لا يطبَّق على الأعضاء المضافين يدويًا (لهم حالتهم في update_manual_member)؛ يُسجَّل في audit_logs ويصل العضو إشعار.
-- الحذف النهائي للحساب يبقى من لوحة Supabase (له أثر في الأصوات والحضور والتوقيعات). آمن لإعادة التنفيذ.
begin;

do $$ begin
  alter table public.profiles drop constraint if exists profiles_approval_status_chk;
  alter table public.profiles add constraint profiles_approval_status_chk check (approval_status in ('معتمد', 'قيد الموافقة', 'مرفوض', 'موقوف'));
end $$;

create or replace function public.member_profile_update(p_user uuid, p_name text, p_job text, p_org text, p_phone text) returns void
language plpgsql security definer set search_path = public as $$
declare nm text := btrim(coalesce(p_name, '')); ph text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  if not public.is_admin() then raise exception 'لا تملك صلاحية تعديل بيانات الأعضاء' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'العضو غير موجود'; end if;
  if char_length(nm) < 2 or char_length(nm) > 200 then raise exception 'الاسم من حرفين إلى 200 حرف'; end if;
  if char_length(coalesce(p_job, '')) > 200 or char_length(coalesce(p_org, '')) > 200 then raise exception 'المسمى أو الجهة أطول من المسموح'; end if;
  if ph is not null and ph !~ '^\+?[0-9\s-]{9,16}$' then raise exception 'رقم الجوال غير صالح'; end if;
  update public.profiles set full_name = nm, job_title = nullif(btrim(coalesce(p_job, '')), ''), organization = coalesce(nullif(btrim(coalesce(p_org, '')), ''), organization), phone = ph where id = p_user;
  insert into public.audit_logs(user_id, action, entity_type, entity_id, metadata) values (auth.uid(), 'member_profile_update', 'profile', p_user, jsonb_build_object('name', nm));
end $$;

create or replace function public.member_suspend(p_user uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare pr public.profiles%rowtype; rs text := btrim(coalesce(p_reason, ''));
begin
  if not public.is_admin() then raise exception 'لا تملك صلاحية إيقاف الحسابات' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'لا يمكنك إيقاف حسابك بنفسك'; end if;
  if char_length(rs) < 3 then raise exception 'اكتب سبب الإيقاف'; end if;
  select * into pr from public.profiles where id = p_user for update;
  if not found then raise exception 'العضو غير موجود'; end if;
  if coalesce(pr.is_manual, false) then raise exception 'العضو المضاف يدويًا يُعدَّل من «تعديل» لا من الإيقاف'; end if;
  if pr.approval_status = 'موقوف' then raise exception 'الحساب موقوف مسبقًا'; end if;
  update public.profiles set approval_status = 'موقوف', is_active = false, approval_note = left(rs, 500), approved_by = auth.uid(), approved_at = now() where id = p_user;
  insert into public.notifications(user_id, title, body) values (p_user, 'تم إيقاف حسابك', 'أوقف مدير المنصة حسابك. السبب: ' || left(rs, 300));
  insert into public.audit_logs(user_id, action, entity_type, entity_id, metadata) values (auth.uid(), 'member_suspended', 'profile', p_user, jsonb_build_object('reason', rs));
end $$;

create or replace function public.member_reactivate(p_user uuid, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare pr public.profiles%rowtype;
begin
  if not public.is_admin() then raise exception 'لا تملك صلاحية إعادة تفعيل الحسابات' using errcode = '42501'; end if;
  select * into pr from public.profiles where id = p_user for update;
  if not found then raise exception 'العضو غير موجود'; end if;
  if pr.approval_status <> 'موقوف' then raise exception 'الحساب ليس موقوفًا'; end if;
  update public.profiles set approval_status = 'معتمد', is_active = true, approval_note = nullif(btrim(coalesce(p_note, '')), ''), approved_by = auth.uid(), approved_at = now() where id = p_user;
  insert into public.notifications(user_id, title, body) values (p_user, 'أُعيد تفعيل حسابك', 'أعاد مدير المنصة تفعيل حسابك. يمكنك استخدام المنصة الآن.');
  insert into public.audit_logs(user_id, action, entity_type, entity_id, metadata) values (auth.uid(), 'member_reactivated', 'profile', p_user, jsonb_build_object('note', p_note));
end $$;

revoke all on function public.member_profile_update(uuid, text, text, text, text), public.member_suspend(uuid, text), public.member_reactivate(uuid, text) from public, anon;
grant execute on function public.member_profile_update(uuid, text, text, text, text), public.member_suspend(uuid, text), public.member_reactivate(uuid, text) to authenticated;

commit;
