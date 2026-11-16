-- مساعد أمين السر (المرحلة 2): ربط المقترح بمسودة القرار التي أُنشئت منه. لا ينشئ هذا الترحيل قرارات؛ الإنشاء يتم عبر dm_create_decision الموجودة (بصلاحياتها وترقيمها)،
-- ثم تُسجَّل الصلة هنا فقط. يعتمد على 016 وجدول decisions (007). آمن لإعادة التنفيذ.
begin;

alter table public.ai_suggestions add column if not exists decision_id uuid references public.decisions(id) on delete set null;

alter table public.ai_suggestions drop constraint if exists ai_suggestions_status_check;
alter table public.ai_suggestions add constraint ai_suggestions_status_check check (status in ('مقترح', 'معتمد', 'مرفوض', 'محوّل'));

alter table public.ai_audit_log drop constraint if exists ai_audit_log_action_check;
alter table public.ai_audit_log add constraint ai_audit_log_action_check check (action in ('analyze', 'accept', 'reject', 'convert'));

-- لا تُغيَّر حالة مقترح محوَّل إلى قرار بالاعتماد أو الرفض
create or replace function public.ai_review_suggestion(p_id uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.ai_suggestions;
begin
  if not public.is_admin() then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_status not in ('معتمد', 'مرفوض') then raise exception 'حالة غير صالحة'; end if;
  update public.ai_suggestions set status = p_status, reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(left(btrim(coalesce(p_note, '')), 500), '')
   where id = p_id and status <> 'محوّل' returning * into r;
  if not found then raise exception 'المقترح غير موجود أو سبق تحويله إلى قرار'; end if;
  insert into public.ai_audit_log(action, minute_id, details)
  values (case p_status when 'معتمد' then 'accept' else 'reject' end, r.minute_id, jsonb_build_object('suggestion', p_id, 'kind', r.kind));
end $$;

-- تسجيل أن المقترح تحوّل إلى مسودة القرار p_decision (المنشأة بالدالة dm_create_decision). يشترط أن يكون القرار من المحضر نفسه.
create or replace function public.ai_link_decision(p_id uuid, p_decision uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.ai_suggestions; d_minute uuid;
begin
  if not public.is_admin() then raise exception 'permission denied' using errcode = '42501'; end if;
  select minute_id into d_minute from public.decisions where id = p_decision;
  if not found then raise exception 'القرار غير موجود'; end if;
  update public.ai_suggestions set status = 'محوّل', decision_id = p_decision, reviewed_by = coalesce(reviewed_by, auth.uid()), reviewed_at = coalesce(reviewed_at, now())
   where id = p_id and status in ('مقترح', 'معتمد') and minute_id = d_minute returning * into r;
  if not found then raise exception 'تعذر الربط: المقترح غير موجود أو سبق تحويله أو القرار من محضر آخر'; end if;
  insert into public.ai_audit_log(action, minute_id, details) values ('convert', r.minute_id, jsonb_build_object('suggestion', p_id, 'decision', p_decision, 'kind', r.kind));
end $$;

revoke all on function public.ai_link_decision(uuid, uuid) from public, anon;
grant execute on function public.ai_link_decision(uuid, uuid) to authenticated;

commit;
