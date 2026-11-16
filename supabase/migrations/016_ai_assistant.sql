-- مساعد أمين السر (المرحلة 1): جدول المقترحات وسجل التدقيق، دون تغيير أي جدول قائم.
-- كل ما يولّده المساعد يُحفظ بحالة «مقترح» ولا يصير رسميًا إلا باعتماد المدير/أمين السر. لا يُنشأ قرار أو مهمة تلقائيًا.
-- يعتمد على: is_admin() (001) وجداول minutes / meetings. آمن لإعادة التنفيذ.
begin;

create table if not exists public.ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  minute_id uuid not null references public.minutes(id) on delete cascade,
  meeting_id uuid references public.meetings(id) on delete set null,
  kind text not null check (kind in ('قرار', 'توصية', 'مهمة')),
  title text not null check (length(btrim(title)) between 3 and 200),
  body text check (body is null or length(body) <= 2000),
  quote text not null check (length(btrim(quote)) between 1 and 1000),
  agenda_ref text check (agenda_ref is null or length(agenda_ref) <= 200),
  owner_hint text check (owner_hint is null or length(owner_hint) <= 120),
  due_hint text check (due_hint is null or length(due_hint) <= 120),
  status text not null default 'مقترح' check (status in ('مقترح', 'معتمد', 'مرفوض')),
  source text not null default 'mock' check (source in ('mock', 'model')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text check (review_note is null or length(review_note) <= 500)
);
create index if not exists ai_suggestions_minute_idx on public.ai_suggestions(minute_id, status);

create table if not exists public.ai_audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid default auth.uid(),
  action text not null check (action in ('analyze', 'accept', 'reject')),
  minute_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ai_audit_log_created_idx on public.ai_audit_log(created_at desc);

alter table public.ai_suggestions enable row level security;
alter table public.ai_audit_log enable row level security;

-- القراءة للمدير وأمين السر فقط. لا كتابة مباشرة: الكتابة عبر الدالتين أدناه فقط.
drop policy if exists ai_suggestions_read on public.ai_suggestions;
create policy ai_suggestions_read on public.ai_suggestions for select to authenticated using (public.is_admin());
drop policy if exists ai_audit_read on public.ai_audit_log;
create policy ai_audit_read on public.ai_audit_log for select to authenticated using (public.is_admin());
revoke insert, update, delete on public.ai_suggestions from authenticated, anon;
revoke insert, update, delete on public.ai_audit_log from authenticated, anon;

-- حفظ نتيجة تحليل محضر: تُستبدل المقترحات غير المراجَعة لنفس المحضر ولا تُمسّ المعتمدة أو المرفوضة.
create or replace function public.ai_save_suggestions(p_minute uuid, p_items jsonb, p_source text default 'mock') returns int
language plpgsql security definer set search_path = public as $$
declare
  it jsonb; n int := 0; v_meeting uuid;
begin
  if not public.is_admin() then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_source not in ('mock', 'model') then raise exception 'مصدر غير صالح'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 100 then raise exception 'قائمة المقترحات غير صالحة'; end if;
  select meeting_id into v_meeting from public.minutes where id = p_minute;
  if not found then raise exception 'المحضر غير موجود'; end if;

  delete from public.ai_suggestions where minute_id = p_minute and status = 'مقترح';
  for it in select * from jsonb_array_elements(p_items) loop
    insert into public.ai_suggestions(minute_id, meeting_id, kind, title, body, quote, agenda_ref, owner_hint, due_hint, source)
    values (p_minute, v_meeting, it->>'kind', left(btrim(it->>'title'), 200), left(it->>'body', 2000), left(btrim(it->>'quote'), 1000),
            nullif(left(it->>'agenda_ref', 200), ''), nullif(left(it->>'owner_hint', 120), ''), nullif(left(it->>'due_hint', 120), ''), p_source);
    n := n + 1;
  end loop;
  insert into public.ai_audit_log(action, minute_id, details) values ('analyze', p_minute, jsonb_build_object('count', n, 'source', p_source));
  return n;
end $$;

-- اعتماد أو رفض مقترح. الاعتماد هنا يعني قبوله كمسودة معتمدة من أمين السر؛ تحويله إلى قرار أو مهمة رسمية يتم يدويًا.
create or replace function public.ai_review_suggestion(p_id uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.ai_suggestions;
begin
  if not public.is_admin() then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_status not in ('معتمد', 'مرفوض') then raise exception 'حالة غير صالحة'; end if;
  update public.ai_suggestions set status = p_status, reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(left(btrim(coalesce(p_note, '')), 500), '')
   where id = p_id returning * into r;
  if not found then raise exception 'المقترح غير موجود'; end if;
  insert into public.ai_audit_log(action, minute_id, details)
  values (case p_status when 'معتمد' then 'accept' else 'reject' end, r.minute_id, jsonb_build_object('suggestion', p_id, 'kind', r.kind));
end $$;

revoke all on function public.ai_save_suggestions(uuid, jsonb, text) from public, anon;
revoke all on function public.ai_review_suggestion(uuid, text, text) from public, anon;
grant execute on function public.ai_save_suggestions(uuid, jsonb, text) to authenticated;
grant execute on function public.ai_review_suggestion(uuid, text, text) to authenticated;

commit;
