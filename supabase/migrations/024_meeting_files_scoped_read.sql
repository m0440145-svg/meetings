-- إصلاح ثغرة: سياسة القراءة السابقة على مخزن meeting-files كانت (bucket_id = 'meeting-files') فقط، فيستطيع أي مستخدم مسجّل قراءة أي ملف إن عرف مساره.
-- الجديد: القراءة (ومنها إنشاء الرابط المؤقت) للمدير وأمين السر، أو لمن يرى سجل المرفق في جدول attachments.
-- ورؤية سجل المرفق محكومة أصلًا بسياسات attachments و meetings: منشئ الاجتماع، والحاضرون، وأعضاء لجنته.
-- لا تغيير في الرفع أو الحذف. الملفات بلا سجل مرفق (يتيمة) تصبح للمدير فقط. آمن لإعادة التنفيذ.
begin;

drop policy if exists "meeting files authenticated read" on storage.objects;
drop policy if exists meeting_files_scoped_read on storage.objects;
create policy meeting_files_scoped_read on storage.objects for select to authenticated
  using (bucket_id = 'meeting-files' and (public.is_admin() or exists (select 1 from public.attachments a where a.storage_path = objects.name)));

commit;
