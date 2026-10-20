-- بيانات المنصة القابلة للتحكم اليدوي (الاسم، الشعار، الأهداف، من نحن، التواصل...)
-- يعتمد على الدالة public.is_admin() من الترحيل 001، فنفّذ 001 أولًا.
-- تنبيه: القراءة مفتوحة حتى للزائر غير المسجل لأن الاسم والشعار يظهران في شاشة الدخول؛ لا تخزّن هنا أي سر.

begin;

create table if not exists public.platform_settings (
  key        text primary key,
  value      text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.platform_settings enable row level security;

-- المفاتيح المسموحة فقط، وبحدود طول (تتطابق مع platform-settings.js)
alter table public.platform_settings drop constraint if exists platform_settings_key_chk;
alter table public.platform_settings add constraint platform_settings_key_chk check (key in (
  'platform_name','org_name','home_eyebrow','home_title','home_text','about','vision','mission','goals',
  'contact_email','contact_phone','contact_address','contact_whatsapp','contact_hours','contact_website','footer_text','logo_url','logo2_url','favicon_url',
  'license_no','chair_name','chair_title','secretary_name','secretary_title',
  'social_x','social_linkedin','social_instagram','social_youtube','primary_color','accent_color'));
alter table public.platform_settings drop constraint if exists platform_settings_len_chk;
alter table public.platform_settings add constraint platform_settings_len_chk check (char_length(value) <= 2000);
alter table public.platform_settings drop constraint if exists platform_settings_value_chk;
alter table public.platform_settings add constraint platform_settings_value_chk check (
  (key not in ('contact_website','social_x','social_linkedin','social_instagram','social_youtube','logo_url','logo2_url','favicon_url') or value = '' or value ~ '^https://'
    or (key in ('logo_url','logo2_url','favicon_url') and value ~ '^assets/'))
  and (key not in ('primary_color','accent_color') or value ~ '^#[0-9a-fA-F]{6}$')
  and (key <> 'contact_whatsapp' or value = '' or value ~ '^[+]?[0-9]{9,15}$'));

drop policy if exists platform_settings_read on public.platform_settings;
create policy platform_settings_read on public.platform_settings for select to anon, authenticated using (true);
drop policy if exists platform_settings_admin_write on public.platform_settings;
create policy platform_settings_admin_write on public.platform_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

revoke all on public.platform_settings from anon, authenticated;
grant select on public.platform_settings to anon, authenticated;
grant insert, update, delete on public.platform_settings to authenticated;

-- من عدّل آخر مرة
create or replace function public.platform_settings_stamp() returns trigger
language plpgsql as $$
begin new.updated_by := auth.uid(); new.updated_at := now(); return new; end $$;
drop trigger if exists trg_platform_settings_stamp on public.platform_settings;
create trigger trg_platform_settings_stamp before insert or update on public.platform_settings
  for each row execute function public.platform_settings_stamp();

-- حاوية الشعار: عامة للقراءة، والرفع للمدير فقط، PNG/JPG/WebP حتى 2 م.ب (بلا SVG لأنه قد يحمل سكربتات)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', true, 2097152, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152,
  allowed_mime_types = array['image/png','image/jpeg','image/webp'];

drop policy if exists branding_admin_insert on storage.objects;
create policy branding_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'branding' and public.is_admin());
drop policy if exists branding_admin_update on storage.objects;
create policy branding_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'branding' and public.is_admin()) with check (bucket_id = 'branding' and public.is_admin());
drop policy if exists branding_admin_delete on storage.objects;
create policy branding_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'branding' and public.is_admin());

commit;
