-- إصلاح ثغرة: سياسة القراءة السابقة على مخزن signatures كانت (bucket_id = 'signatures') فقط، فيستطيع أي مستخدم مسجّل قراءة توقيع غيره إن عرف مساره.
-- الجديد: صاحب التوقيع يقرأ مجلده فقط (المسار <user_id>/... كما تفرضه سياسة الرفع القائمة)، والمدير وأمين السر يقرؤون الكل.
-- لا تغيير في الرفع. المقارنة نصية بلا تحويل نوع. آمن لإعادة التنفيذ.
begin;

drop policy if exists "signatures owner read" on storage.objects;
drop policy if exists signatures_scoped_read on storage.objects;
create policy signatures_scoped_read on storage.objects for select to authenticated
  using (bucket_id = 'signatures' and ((storage.foldername(name))[1] = (auth.uid())::text or public.is_admin()));

commit;
