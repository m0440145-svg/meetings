-- إدارة الاجتماع من الواجهة: تعديل/حذف الاجتماع ومرفقاته وبنود أجندته لمنشئه أو للمدير.
-- يعتمد على: is_admin() (001). آمن لإعادة التنفيذ.
begin;

-- الاجتماع: الحذف لمنشئه أو للمدير (التعديل والإدخال موجودان أصلًا)
drop policy if exists meetings_owner_delete on public.meetings;
create policy meetings_owner_delete on public.meetings for delete to authenticated
  using (public.is_admin() or created_by = auth.uid());

-- جدول الأعمال والمرفقات: كتابة منشئ الاجتماع لاجتماعه فقط
drop policy if exists agenda_owner_write on public.agenda_items;
create policy agenda_owner_write on public.agenda_items for all to authenticated
  using (exists (select 1 from public.meetings m where m.id = agenda_items.meeting_id and m.created_by = auth.uid()))
  with check (exists (select 1 from public.meetings m where m.id = agenda_items.meeting_id and m.created_by = auth.uid()));

drop policy if exists attach_owner_write on public.attachments;
create policy attach_owner_write on public.attachments for all to authenticated
  using (exists (select 1 from public.meetings m where m.id = attachments.meeting_id and m.created_by = auth.uid()))
  with check (exists (select 1 from public.meetings m where m.id = attachments.meeting_id and m.created_by = auth.uid()));

-- ملفات التخزين: حذف ملفات اجتماع يملكه المستخدم (المسار: <meeting_id>/<file>) أو للمدير
drop policy if exists meeting_files_owner_delete on storage.objects;
create policy meeting_files_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'meeting-files' and (
    public.is_admin() or exists (select 1 from public.meetings m where m.id::text = (storage.foldername(name))[1] and m.created_by = auth.uid())));

commit;
