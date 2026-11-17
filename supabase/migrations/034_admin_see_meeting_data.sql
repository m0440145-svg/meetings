-- المدير وأمين السر يرون بيانات كل الاجتماعات.
-- أربع سياسات RESTRICTIVE للقراءة (agenda_items, attachments, votes, minutes) كانت تحصر القراءة بمنشئ الاجتماع أو عضو لجنته أو مدعوّه، فلا يرى المدير بنود/مرفقات/محاضر/تصويتات اجتماعات ليس طرفًا فيها
-- (مع أنه يملك كتابتها)، فتظهر مسودة المحضر وحزم المجلس بلا بنود. التعديل: إضافة `public.is_admin() or` إلى شرط كل سياسة. لا تغيير لغير المدير ولا لسياسات الكتابة. آمن لإعادة التنفيذ.
begin;

alter policy "agenda restrict to member meetings" on public.agenda_items using (public.is_admin() or (exists (select 1 from meetings m where m.id = agenda_items.meeting_id and (m.created_by = auth.uid() or exists (select 1 from committee_members cm where cm.committee_id = m.committee_id and cm.user_id = auth.uid()) or exists (select 1 from meeting_attendees ma where ma.meeting_id = m.id and ma.user_id = auth.uid())))));

alter policy "attachments restrict to member meetings" on public.attachments using (public.is_admin() or (meeting_id is null) or (exists (select 1 from meetings m where m.id = attachments.meeting_id and (m.created_by = auth.uid() or exists (select 1 from committee_members cm where cm.committee_id = m.committee_id and cm.user_id = auth.uid()) or exists (select 1 from meeting_attendees ma where ma.meeting_id = m.id and ma.user_id = auth.uid())))));

alter policy "votes restrict to member meetings" on public.votes using (public.is_admin() or (exists (select 1 from meetings m where m.id = votes.meeting_id and (m.created_by = auth.uid() or exists (select 1 from committee_members cm where cm.committee_id = m.committee_id and cm.user_id = auth.uid()) or exists (select 1 from meeting_attendees ma where ma.meeting_id = m.id and ma.user_id = auth.uid())))));

alter policy "minutes restrict to member meetings" on public.minutes using (public.is_admin() or (exists (select 1 from meetings m where m.id = minutes.meeting_id and (m.created_by = auth.uid() or exists (select 1 from committee_members cm where cm.committee_id = m.committee_id and cm.user_id = auth.uid()) or exists (select 1 from meeting_attendees ma where ma.meeting_id = m.id and ma.user_id = auth.uid())))));

commit;
