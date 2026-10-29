-- مفاتيح جديدة لبيانات المنصة: رابط سياسة الخصوصية، رابط شروط الاستخدام، بريد الدعم الفني (تظهر في تذييل الصفحة العامة عند ضبطها).
-- يعيد تعريف قيدي المفاتيح والقيم كما في 002 مع الإضافات فقط. آمن لإعادة التنفيذ ولا يغيّر البيانات.
begin;

alter table public.platform_settings drop constraint if exists platform_settings_key_chk;
alter table public.platform_settings add constraint platform_settings_key_chk check (key in (
  'platform_name','org_name','home_eyebrow','home_title','home_text','about','vision','mission','goals',
  'contact_email','contact_phone','contact_address','contact_whatsapp','contact_hours','contact_website','footer_text','logo_url','logo2_url','favicon_url',
  'license_no','chair_name','chair_title','secretary_name','secretary_title',
  'social_x','social_linkedin','social_instagram','social_youtube','primary_color','accent_color',
  'privacy_url','terms_url','support_email'));

alter table public.platform_settings drop constraint if exists platform_settings_value_chk;
alter table public.platform_settings add constraint platform_settings_value_chk check (
  (key not in ('contact_website','social_x','social_linkedin','social_instagram','social_youtube','privacy_url','terms_url','logo_url','logo2_url','favicon_url') or value = '' or value ~ '^https://'
    or (key in ('logo_url','logo2_url','favicon_url') and value ~ '^assets/'))
  and (key not in ('primary_color','accent_color') or value ~ '^#[0-9a-fA-F]{6}$')
  and (key <> 'contact_whatsapp' or value = '' or value ~ '^[+]?[0-9]{9,15}$')
  and (key <> 'support_email' or value = '' or value ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'));

commit;
