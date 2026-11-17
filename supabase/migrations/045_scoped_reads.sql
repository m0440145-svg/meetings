-- تضييق سياسات القراءة المفتوحة (F-03 في تقرير فحص الأمان). كانت SELECT لكل مسجَّل (using true) على:
--   transcripts, whiteboards, reminders  → تُقرأ فقط لمن يرى الاجتماع نفسه (سياسات meetings: منشئ/عضو لجنة/مدعو/حاضر) أو المدير أو كاتب السجل.
--   circular_decisions → للمدير أو منشئ القرار أو أعضاء لجنته؛ والقرار بلا لجنة (committee_id فارغ) يبقى ظاهرًا للجميع كما كان.
--   vote_participation → من شارك في تصويت يراه المستخدم (سياسات votes) أو صفه هو.
-- الكتابة والسياسات الأخرى و approved_only لم تتغير. الجداول فارغة اليوم، فلا أثر على بيانات قائمة. آمن لإعادة التنفيذ.
begin;

drop policy if exists "transcripts auth" on public.transcripts;
create policy "transcripts auth" on public.transcripts for select to authenticated using (
  public.is_admin() or created_by = auth.uid() or exists (select 1 from public.meetings m where m.id = transcripts.meeting_id));

drop policy if exists "whiteboards auth" on public.whiteboards;
create policy "whiteboards auth" on public.whiteboards for select to authenticated using (
  public.is_admin() or updated_by = auth.uid() or exists (select 1 from public.meetings m where m.id = whiteboards.meeting_id));

drop policy if exists "reminders auth read" on public.reminders;
create policy "reminders auth read" on public.reminders for select to authenticated using (
  public.is_admin() or created_by = auth.uid() or exists (select 1 from public.meetings m where m.id = reminders.meeting_id));

drop policy if exists "circular auth read" on public.circular_decisions;
create policy "circular auth read" on public.circular_decisions for select to authenticated using (
  public.is_admin() or created_by = auth.uid() or committee_id is null
  or exists (select 1 from public.committee_members cm where cm.committee_id = circular_decisions.committee_id and cm.user_id = auth.uid()));

drop policy if exists vote_participation_read on public.vote_participation;
create policy vote_participation_read on public.vote_participation for select to authenticated using (
  user_id = auth.uid() or public.is_admin() or exists (select 1 from public.votes v where v.id = vote_participation.vote_id));

commit;
