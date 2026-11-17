-- خصوصية جهات الاتصال: الجوال والبريد في profiles لا يقرؤها إلا صاحبها والمدير/أمين السر.
-- كان أي عضو معتمد يقرأ كل صفوف profiles بكل أعمدتها (بما فيها phone وemail). الأسماء والمسمى الوظيفي والجهة تبقى ظاهرة للجميع (دليل الأعضاء وأسماء المنفذين والحضور).
-- التنفيذ: سحب SELECT على الجدول، ومنح SELECT على بقية الأعمدة فقط، ودالة profile_contacts() ترجع (id, phone, email) للمدير لكل الصفوف ولغيره لصفه فقط.
-- الدوال SECURITY DEFINER والكتابة (UPDATE الذاتي) لا تتأثر. تنبيه: select('*') على profiles من العميل يفشل بعد هذا الترحيل، فتُحدَّث الشاشات لتستعمل قائمة أعمدة صريحة + profile_contacts().
-- أي عمود جديد في profiles لا يُقرأ إلا بعد منحه صراحةً. آمن لإعادة التنفيذ.
begin;

revoke select on public.profiles from authenticated, anon;
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ',' order by ordinal_position) into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'profiles' and column_name not in ('phone', 'email');
  execute 'grant select (' || cols || ') on public.profiles to authenticated';
end $$;

create or replace function public.profile_contacts() returns table(id uuid, phone text, email text)
language sql stable security definer set search_path = public as $$
  select p.id, p.phone, p.email from public.profiles p where public.is_admin() or p.id = auth.uid();
$$;
revoke all on function public.profile_contacts() from public, anon;
grant execute on function public.profile_contacts() to authenticated;

commit;
