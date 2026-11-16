-- الحوكمة والأمن: دالتان للقراءة فقط للمدير وأمين السر، تعرضان سجل نشاط حقيقيًا من الخادم وحالة ضوابط فعلية. لا جداول جديدة ولا تغيير في الصلاحيات.
-- المصادر: decision_events (007)، ai_audit_log (016/017/018)، meetings. يعتمد على is_admin() (001). آمن لإعادة التنفيذ.
begin;

create or replace function public.platform_activity(p_limit int default 100) returns table(happened_at timestamptz, actor text, area text, action text, detail text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'permission denied' using errcode = '42501'; end if;
  return query
  select * from (
    select e.created_at, coalesce(p.full_name, '—'), 'القرارات'::text,
           (case e.event_type when 'created' then 'إنشاء مسودة قرار' when 'edited_draft' then 'تعديل مسودة' when 'text_amended' then 'تعديل نص قرار'
              when 'action_added' then 'إضافة إجراء' when 'action_updated' then 'تحديث إجراء' when 'reassigned' then 'إعادة إسناد'
              when 'evidence_added' then 'إضافة دليل' when 'evidence_reviewed' then 'مراجعة دليل' when 'extension_requested' then 'طلب تمديد'
              when 'extension_approved' then 'اعتماد تمديد' when 'extension_rejected' then 'رفض تمديد' when 'directive' then 'إصدار توجيه'
              when 'reference_added' then 'إضافة مرجع' else e.event_type end)::text,
           (d.ref_no || ' — ' || left(d.title, 80))::text
      from public.decision_events e join public.decisions d on d.id = e.decision_id left join public.profiles p on p.id = e.actor_id
    union all
    select a.created_at, coalesce(p.full_name, '—'), 'المساعد الذكي'::text,
           (case a.action when 'analyze' then 'تحليل محضر' when 'accept' then 'اعتماد مقترح' when 'reject' then 'رفض مقترح' when 'convert' then 'تحويل مقترح إلى مسودة قرار' when 'ask' then 'سؤال للمستشار' else a.action end)::text,
           coalesce(left(a.details->>'q', 80), '')::text
      from public.ai_audit_log a left join public.profiles p on p.id = a.user_id
    union all
    select m.created_at, coalesce(p.full_name, '—'), 'الاجتماعات'::text, 'إنشاء اجتماع'::text, left(m.title, 80)::text
      from public.meetings m left join public.profiles p on p.id = m.created_by
  ) u(happened_at, actor, area, action, detail)
  order by u.happened_at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 100), 300));
end $$;

create or replace function public.platform_security_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_admin() then raise exception 'permission denied' using errcode = '42501'; end if;
  select jsonb_build_object(
    'tables', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'),
    'rls_tables', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity),
    'no_rls', coalesce((select jsonb_agg(c.relname order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), '[]'::jsonb),
    'privileged', (select count(*) from public.profiles where coalesce(role_code, role) in ('admin', 'secretary') and coalesce(is_active, true)),
    'active_users', (select count(*) from public.profiles where coalesce(is_active, true)),
    'inactive_users', (select count(*) from public.profiles where not coalesce(is_active, true)),
    'ai_events_24h', (select count(*) from public.ai_audit_log where created_at > now() - interval '24 hours')
  ) into r;
  return r;
end $$;

revoke all on function public.platform_activity(int) from public, anon;
revoke all on function public.platform_security_status() from public, anon;
grant execute on function public.platform_activity(int) to authenticated;
grant execute on function public.platform_security_status() to authenticated;

commit;
