-- مستشار المحاضر (المرحلة 3): تسجيل أسئلة البحث في سجل التدقيق. لا تغيير في صلاحيات القراءة: البحث نفسه يتم بصلاحيات السائل (RLS) على المحاضر والقرارات.
-- يعتمد على 016. آمن لإعادة التنفيذ.
begin;

alter table public.ai_audit_log drop constraint if exists ai_audit_log_action_check;
alter table public.ai_audit_log add constraint ai_audit_log_action_check check (action in ('analyze', 'accept', 'reject', 'convert', 'ask'));

-- أي مستخدم مسجّل يسجّل سؤاله (نص مقتطع)؛ القراءة تبقى للمدير فقط.
create or replace function public.ai_log_query(p_query text, p_results int default 0) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول'; end if;
  insert into public.ai_audit_log(action, details)
  values ('ask', jsonb_build_object('q', left(btrim(coalesce(p_query, '')), 300), 'results', greatest(0, least(coalesce(p_results, 0), 1000))));
end $$;

revoke all on function public.ai_log_query(text, int) from public, anon;
grant execute on function public.ai_log_query(text, int) to authenticated;

commit;
