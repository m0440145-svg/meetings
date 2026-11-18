-- حماية نطاق الاجتماع: لا يغيّر لجنة الاجتماع بعد إنشائه إلا مدير المنصة/أمين السر.
-- الثغرة: سياسة «meetings owner update» تسمح لمنشئ الاجتماع (رئيس لجنة) بتعديل أي عمود، ومنه committee_id، فيستطيع نقل اجتماعه إلى لجنة أخرى
-- فيظهر محتواه (بنود، مرفقات، تصويتات) لأعضاء تلك اللجنة. الإنشاء نفسه مقيَّد بالمدير/رئيس اللجنة (الترحيل 039) فلا يُضاف قيد جديد عليه.
-- المشغّل يعمل عند تغيير committee_id فقط (تعديل بقية الأعمدة، ومنها العمود نفسه بنفس القيمة، لا يتأثر). السياقات بلا مستخدم (auth.uid() فارغ: ترحيلات، دوال النظام) تمرّ.
-- لا تغيير على الواجهة: نموذج تعديل الاجتماع لا يرسل committee_id أصلًا. آمن لإعادة التنفيذ.
-- للتراجع: drop trigger if exists trg_guard_meeting_scope on public.meetings; drop function if exists public.guard_meeting_scope();
begin;

create or replace function public.guard_meeting_scope() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.committee_id is distinct from old.committee_id and auth.uid() is not null and not public.is_admin() then
    raise exception 'لا يغيّر لجنة الاجتماع إلا مدير المنصة' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_meeting_scope() from public, anon, authenticated;

drop trigger if exists trg_guard_meeting_scope on public.meetings;
create trigger trg_guard_meeting_scope before update of committee_id on public.meetings
  for each row execute function public.guard_meeting_scope();

commit;
