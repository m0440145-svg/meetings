-- غرفة البيانات الآمنة: مستندات سرّية في مخزن خاص بها (vdr-files) بصلاحية اطلاع لكل مستند، وسجل وصول، وعلامة مائية باسم المطّلع.
-- مخزن منفصل عمدًا: سياسة القراءة على meeting-files تسمح لأي مستخدم مسجّل، فلا تصلح للمستندات السرية.
-- الاطلاع: المدير وأمين السر دائمًا؛ وغيرهما إن كان من أعضاء الجهة المحددة أو مُنح المستند بالاسم، وقبل تاريخ الانتهاء.
-- يعتمد على: is_admin() (001)، committees / committee_members / profiles. آمن لإعادة التنفيذ.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vdr-files', 'vdr-files', false, 26214400, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.vdr_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 2 and 200),
  description text not null default '' check (length(description) <= 2000),
  confidentiality text not null default 'سري' check (confidentiality in ('سري', 'سري للغاية')),
  committee_id uuid references public.committees(id) on delete set null,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')),
  size_bytes bigint not null default 0,
  expires_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.vdr_access (
  doc_id uuid not null references public.vdr_documents(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  granted_by uuid default auth.uid(),
  granted_at timestamptz not null default now(),
  primary key (doc_id, user_id)
);

create table if not exists public.vdr_access_log (
  id bigint generated always as identity primary key,
  doc_id uuid references public.vdr_documents(id) on delete set null,
  doc_title text not null default '',
  user_id uuid default auth.uid(),
  action text not null check (action in ('view', 'upload', 'grant', 'revoke', 'delete')),
  created_at timestamptz not null default now()
);
create index if not exists vdr_access_log_doc_idx on public.vdr_access_log(doc_id, created_at desc);

create or replace function public.vdr_can_view(p_doc uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.vdr_documents d
     where d.id = p_doc and (d.expires_at is null or d.expires_at > now())
       and (exists (select 1 from public.vdr_access a where a.doc_id = d.id and a.user_id = auth.uid())
            or (d.committee_id is not null and exists (select 1 from public.committee_members cm where cm.committee_id = d.committee_id and cm.user_id = auth.uid())))
  )
$$;

-- لسياسة التخزين: يتحقق من صيغة المجلد قبل التحويل إلى uuid، حتى لا يفشل تقييم السياسة لملفات المخازن الأخرى
create or replace function public.vdr_can_view_folder(p_bucket text, p_folder text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if p_bucket is distinct from 'vdr-files' then return false; end if;
  if p_folder is null or p_folder !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return false; end if;
  return public.vdr_can_view(p_folder::uuid);
end $$;

alter table public.vdr_documents enable row level security;
alter table public.vdr_access enable row level security;
alter table public.vdr_access_log enable row level security;

drop policy if exists vdr_docs_read on public.vdr_documents;
create policy vdr_docs_read on public.vdr_documents for select to authenticated using (public.vdr_can_view(id));
drop policy if exists vdr_docs_admin on public.vdr_documents;
create policy vdr_docs_admin on public.vdr_documents for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists vdr_access_read on public.vdr_access;
create policy vdr_access_read on public.vdr_access for select to authenticated using (public.is_admin() or user_id = auth.uid());
drop policy if exists vdr_access_admin on public.vdr_access;
create policy vdr_access_admin on public.vdr_access for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists vdr_log_read on public.vdr_access_log;
create policy vdr_log_read on public.vdr_access_log for select to authenticated using (public.is_admin());
revoke insert, update, delete on public.vdr_access_log from authenticated, anon;
revoke all on public.vdr_documents, public.vdr_access, public.vdr_access_log from anon;

-- التخزين: القراءة (ومنها إنشاء الرابط المؤقت) لمن يحق له الاطلاع على المستند؛ الرفع والحذف للمدير. المسار: <doc_id>/<ملف>
drop policy if exists vdr_files_read on storage.objects;
create policy vdr_files_read on storage.objects for select to authenticated
  using (public.vdr_can_view_folder(bucket_id, (storage.foldername(name))[1]));
drop policy if exists vdr_files_insert on storage.objects;
create policy vdr_files_insert on storage.objects for insert to authenticated with check (bucket_id = 'vdr-files' and public.is_admin());
drop policy if exists vdr_files_delete on storage.objects;
create policy vdr_files_delete on storage.objects for delete to authenticated using (bucket_id = 'vdr-files' and public.is_admin());

-- فتح مستند: يتحقق من الصلاحية ويسجّل الاطلاع، ويعيد المسار ونص العلامة المائية (اسم المطّلع ووقت الاطلاع)
create or replace function public.vdr_open(p_doc uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d public.vdr_documents; nm text;
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول'; end if;
  if not public.vdr_can_view(p_doc) then raise exception 'لا تملك صلاحية الاطلاع على هذا المستند' using errcode = '42501'; end if;
  select * into d from public.vdr_documents where id = p_doc;
  select full_name into nm from public.profiles where id = auth.uid();
  insert into public.vdr_access_log(doc_id, doc_title, action) values (d.id, d.title, 'view');
  return jsonb_build_object('path', d.storage_path, 'mime', d.mime_type,
    'watermark', coalesce(nm, 'مستخدم') || ' — ' || to_char(now() at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI') || ' — ' || d.confidentiality);
end $$;

-- تسجيل إجراءات المدير (رفع، منح، سحب، حذف) في سجل الوصول
create or replace function public.vdr_log(p_doc uuid, p_action text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_action not in ('upload', 'grant', 'revoke', 'delete') then raise exception 'إجراء غير صالح'; end if;
  insert into public.vdr_access_log(doc_id, doc_title, action) values (p_doc, coalesce((select title from public.vdr_documents where id = p_doc), ''), p_action);
end $$;

revoke all on function public.vdr_can_view(uuid) from public, anon;
revoke all on function public.vdr_can_view_folder(text, text) from public, anon;
grant execute on function public.vdr_can_view_folder(text, text) to authenticated;
revoke all on function public.vdr_open(uuid) from public, anon;
revoke all on function public.vdr_log(uuid, text) from public, anon;
grant execute on function public.vdr_can_view(uuid) to authenticated;
grant execute on function public.vdr_open(uuid) to authenticated;
grant execute on function public.vdr_log(uuid, text) to authenticated;

commit;
