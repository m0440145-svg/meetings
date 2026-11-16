-- أثناء الاجتماع: حفظ التفريغ النصي وملاحظات السبورة على الخادم بدل المتصفح. جدول ودالة جديدان دون تغيير أي جدول قائم.
-- القراءة والكتابة للمدير وأمين السر فقط (is_admin من 001). الكتابة عبر الدالة مع قفل تفاؤلي لمنع أن يمحو حفظٌ حفظًا أحدث منه. آمن لإعادة التنفيذ.
begin;

create table if not exists public.meeting_live_notes (
  meeting_id uuid primary key references public.meetings(id) on delete cascade,
  transcript text not null default '' check (length(transcript) <= 100000),
  board text not null default '' check (length(board) <= 20000),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

alter table public.meeting_live_notes enable row level security;
drop policy if exists live_notes_read on public.meeting_live_notes;
create policy live_notes_read on public.meeting_live_notes for select to authenticated using (public.is_admin());
revoke insert, update, delete on public.meeting_live_notes from authenticated, anon;

-- p_expected: قيمة updated_at التي قرأها العميل؛ إن تغيّرت على الخادم يُرفض الحفظ ويُطلب إعادة التحميل. null عند أول حفظ.
create or replace function public.live_notes_save(p_meeting uuid, p_transcript text, p_board text, p_expected timestamptz default null) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare cur timestamptz; ts timestamptz := now();
begin
  if not public.is_admin() then raise exception 'permission denied' using errcode = '42501'; end if;
  if not exists (select 1 from public.meetings where id = p_meeting) then raise exception 'الاجتماع غير موجود'; end if;
  select updated_at into cur from public.meeting_live_notes where meeting_id = p_meeting for update;
  if found then
    if p_expected is null or cur <> p_expected then raise exception 'conflict: عُدّل التفريغ من جهاز أو مستخدم آخر. أعد التحميل لتجنب فقد التعديلات.' using errcode = '40001'; end if;
    update public.meeting_live_notes set transcript = coalesce(p_transcript, ''), board = coalesce(p_board, ''), updated_by = auth.uid(), updated_at = ts where meeting_id = p_meeting;
  else
    insert into public.meeting_live_notes(meeting_id, transcript, board, updated_by, updated_at) values (p_meeting, coalesce(p_transcript, ''), coalesce(p_board, ''), auth.uid(), ts);
  end if;
  return ts;
end $$;

revoke all on function public.live_notes_save(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.live_notes_save(uuid, text, text, timestamptz) to authenticated;

commit;
