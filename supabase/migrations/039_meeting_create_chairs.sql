-- إنشاء الاجتماعات: المدير وأمين السر (is_admin) أو رئيس اللجنة المعنية فقط (رئيس مجلس الإدارة = رئيس لجنة «مجلس الإدارة»).
-- كانت سياسة الإدراج `meetings admin create` تسمح لأي عضو بإنشاء اجتماع في أي لجنة (created_by = auth.uid()) ثم إرسال دعوات لأعضائها.
-- التعديل: شرط الإدراج يصبح created_by = المستخدم، وأن يكون مديرًا أو من يحمل صفة «رئيس اللجنة» في لجنة الاجتماع نفسها. اجتماع بلا لجنة للمدير فقط.
-- لا تغيير على القراءة ولا التعديل ولا الحذف ولا على الاجتماعات القائمة. آمن لإعادة التنفيذ.
begin;

alter policy "meetings admin create" on public.meetings
  with check (
    created_by = auth.uid()
    and (
      public.is_admin()
      or (committee_id is not null and exists (
            select 1 from public.committee_members cm
             where cm.committee_id = meetings.committee_id
               and cm.user_id = auth.uid()
               and cm.committee_role in ('رئيس اللجنة', 'رئيس', 'chair')))
    )
  );

commit;
