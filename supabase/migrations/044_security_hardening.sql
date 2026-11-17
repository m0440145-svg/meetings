-- تحصين أمني بعد فحص الاختراق (التقرير: docs/تقرير-فحص-الأمان-ميثاق.md).
-- F-01: كان رفع الملفات إلى مخزن meeting-files مسموحًا لأي مسجَّل (شرط السياسة bucket_id فقط). يصبح الرفع مقصورًا على:
--   (أ) المدير/أمين السر؛ (ب) منشئ الاجتماع في مجلد اجتماعه (<meeting_id>/…)؛ (ج) صورة توقيع محضر باسم المستخدم نفسه فقط: signatures/<minute_id>/<uid>-….png لمحضر يراه المستخدم.
--   هذه هي المسارات الثلاثة التي يستعملها التطبيق فعلًا (مرفقات الاجتماع، إنشاء اجتماع، توقيع المحضر). لا تغيير في القراءة والحذف.
-- F-04: دالة dm_setting تُستدعى من المجهول؛ تُسحب من anon وتبقى للمسجَّلين.
-- آمن لإعادة التنفيذ.
begin;

drop policy if exists "meeting files authenticated upload" on storage.objects;
drop policy if exists meeting_files_scoped_insert on storage.objects;
create policy meeting_files_scoped_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'meeting-files' and (
    public.is_admin()
    or exists (select 1 from public.meetings m where m.id::text = (storage.foldername(name))[1] and m.created_by = auth.uid())
    or ((storage.foldername(name))[1] = 'signatures'
        and storage.filename(name) like (auth.uid()::text || '-%.png')
        and exists (select 1 from public.minutes mi where mi.id::text = (storage.foldername(name))[2]))
  )
);

revoke execute on function public.dm_setting(text) from public, anon;
grant execute on function public.dm_setting(text) to authenticated;

commit;
