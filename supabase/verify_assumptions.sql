-- استعلامات قراءة فقط للتحقق من افتراضات الترحيل 001 — شغّلها في SQL Editor قبل التنفيذ.
-- كل استعلام يوضح ما المتوقع في تعليقه.

-- 1) الأعمدة وأنواعها (المتوقع: id من نوع uuid في كل الجداول، والأعمدة المذكورة موجودة)
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('profiles','meetings','votes','vote_responses','minutes','signatures','meeting_attendees',
                     'committee_members','meeting_invitations','delivery_jobs','notifications','audit_logs','ai_documents')
order by table_name, ordinal_position;

-- 2) قيود CHECK (هل تسمح حالات: votes.status='مغلق'، minutes.status='معتمد'، attendance_status='عن بعد'؟)
select conrelid::regclass as tbl, conname, pg_get_constraintdef(oid) as def
from pg_constraint
where contype = 'c' and connamespace = 'public'::regnamespace
  and conrelid::regclass::text in ('votes','minutes','meeting_attendees','delivery_jobs','notifications','meeting_invitations');

-- 3) قيم الأدوار والحالات الفعلية (هل 'admin' و 'secretary' هما قيم role_code الإدارية؟)
select coalesce(role_code, role) as role_value, count(*) from profiles group by 1;
select status, count(*) from votes group by 1;
select status, count(*) from minutes group by 1;
select attendance_status, count(*) from meeting_attendees group by 1;
select vote_type, count(*) from votes group by 1;

-- 4) تكرارات تمنع إنشاء الفهرس الفريد على signatures (المتوقع: لا صفوف)
select minute_id, user_id, count(*) from signatures group by 1, 2 having count(*) > 1;

-- 5) المفاتيح الأساسية والفريدة الحالية على signatures و meeting_attendees و vote_responses
select conrelid::regclass as tbl, conname, contype, pg_get_constraintdef(oid)
from pg_constraint
where contype in ('p','u') and conrelid::regclass::text in ('signatures','meeting_attendees','vote_responses');

-- 6) المشغّلات الحالية — خصوصًا أي مشغّل يُدرج في notifications / delivery_jobs / meeting_invitations بصلاحية المستدعي
--    (بعد سحب INSERT سيفشل إن لم تكن دالته SECURITY DEFINER)
select event_object_table as tbl, trigger_name, action_timing, event_manipulation, action_statement
from information_schema.triggers where trigger_schema = 'public' order by 1, 2;
select p.proname, p.prosecdef as security_definer
from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype;

-- 7) السياسات الحالية (RLS) — ما الذي يسمح به كل جدول فعليًا؟
select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies where schemaname = 'public' order by tablename, policyname;
select relname, relrowsecurity as rls_enabled, relforcerowsecurity as rls_forced
from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by relname;

-- 8) صلاحيات الجداول الحالية لأدوار anon/authenticated (هل منحت صلاحية شاملة على كل الجداول؟)
select table_name, grantee, string_agg(privilege_type, ',') as privileges
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon','authenticated')
group by 1, 2 order by 1, 2;

-- 9) سياسات التخزين على الحاوية meeting-files (من يرفع/يقرأ مسارات signatures/ و المرفقات؟ والحاوية عامة أم خاصة؟)
select id, name, public from storage.buckets where id = 'meeting-files';
select policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'storage' and tablename = 'objects';

-- 10) Realtime: هل publication موجودة وما الجداول فيها؟
select pubname, schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime';

-- 11) بيانات قديمة تتأثر: توقيعات سابقة بلا content_hash وأصوات قديمة في vote_responses
select count(*) as legacy_signatures from signatures;
select count(*) as legacy_vote_responses from vote_responses;

-- 12) للترحيل 005 (التذكير): نوع start_time (المتوقع time) وأعمدة meetings وdelivery_jobs
select table_name, column_name, data_type from information_schema.columns
where table_schema = 'public' and ((table_name = 'meetings' and column_name in ('gregorian_date','start_time','location','mode','meeting_url','committee_id','created_by'))
   or (table_name = 'delivery_jobs') or (table_name = 'profiles' and column_name in ('phone','full_name','is_active')))
order by table_name, column_name;
-- قيد القناة على delivery_jobs: يجب أن يسمح بـ sms
select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.delivery_jobs'::regclass and contype = 'c';
-- هل pg_cron و pg_net مفعّلتان؟
select extname from pg_extension where extname in ('pg_cron', 'pg_net');
