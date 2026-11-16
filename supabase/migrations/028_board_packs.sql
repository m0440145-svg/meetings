-- المرفقات: «حزم المجلس» + صلاحية التنزيل للوثائق السرية.
-- 1) board_packs / board_pack_items: حزمة مرتبة لاجتماع (مرفقاته ووثائق غرفة البيانات)، تُنشر فيُشعَر أعضاء الاجتماع. الحزمة تنظّم ولا تمنح صلاحية:
--    فتح كل عنصر يبقى محكومًا بصلاحياته الأصلية (attachments / vdr_can_view).
-- 2) vdr_documents.allow_download (الافتراضي لا): العرض داخل المنصة فقط ما لم يسمح المدير بالتنزيل؛ ويُسجَّل التنزيل في سجل الوصول.
--    تنبيه: العرض فقط رادع لا مانع تقني (المستخدم الذي يصل إلى الملف يمكنه تصويره).
-- يعتمد على: is_admin() (001)، dm_notify (007)، attachments / meetings / committee_members / meeting_invitations، وجداول vdr_* (023). آمن لإعادة التنفيذ.
begin;

create table if not exists public.board_packs (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  title text not null check (length(btrim(title)) between 3 and 200),
  notes text not null default '' check (length(notes) <= 2000),
  status text not null default 'مسودة' check (status in ('مسودة', 'منشورة')),
  published_at timestamptz,
  published_by uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists board_packs_meeting_idx on public.board_packs(meeting_id);

create table if not exists public.board_pack_items (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.board_packs(id) on delete cascade,
  position int not null default 1,
  attachment_id uuid references public.attachments(id) on delete cascade,
  vdr_doc_id uuid references public.vdr_documents(id) on delete cascade,
  note text not null default '' check (length(note) <= 500),
  check ((attachment_id is not null)::int + (vdr_doc_id is not null)::int = 1)
);
create index if not exists board_pack_items_pack_idx on public.board_pack_items(pack_id, position);

-- المرفق يجب أن يكون من اجتماع الحزمة نفسه
create or replace function public.board_pack_item_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.attachment_id is not null and not exists (
       select 1 from public.attachments a join public.board_packs p on p.id = new.pack_id where a.id = new.attachment_id and a.meeting_id = p.meeting_id) then
    raise exception 'المرفق ليس من اجتماع هذه الحزمة';
  end if;
  return new;
end $$;
drop trigger if exists trg_board_pack_item_check on public.board_pack_items;
create trigger trg_board_pack_item_check before insert or update on public.board_pack_items for each row execute function public.board_pack_item_check();

alter table public.board_packs enable row level security;
alter table public.board_pack_items enable row level security;
drop policy if exists board_packs_read on public.board_packs;
create policy board_packs_read on public.board_packs for select to authenticated
  using (public.is_admin() or (status = 'منشورة' and exists (select 1 from public.meetings m where m.id = board_packs.meeting_id)));
drop policy if exists board_packs_admin on public.board_packs;
create policy board_packs_admin on public.board_packs for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists board_pack_items_read on public.board_pack_items;
create policy board_pack_items_read on public.board_pack_items for select to authenticated
  using (exists (select 1 from public.board_packs p where p.id = board_pack_items.pack_id));
drop policy if exists board_pack_items_admin on public.board_pack_items;
create policy board_pack_items_admin on public.board_pack_items for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.board_packs, public.board_pack_items from anon;

-- نشر الحزمة (أو سحبها إلى مسودة). النشر يتطلب عنصرًا واحدًا على الأقل ويُشعر أعضاء لجنة الاجتماع والمدعوين.
create or replace function public.board_pack_publish(p_pack uuid, p_publish boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare p public.board_packs%rowtype; m public.meetings%rowtype; n int; aud uuid[];
begin
  if not public.is_admin() then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into p from public.board_packs where id = p_pack for update;
  if not found then raise exception 'الحزمة غير موجودة'; end if;
  if p_publish then
    select count(*) into n from public.board_pack_items where pack_id = p_pack;
    if n = 0 then raise exception 'أضف عنصرًا واحدًا على الأقل قبل النشر'; end if;
    update public.board_packs set status = 'منشورة', published_at = now(), published_by = auth.uid() where id = p_pack;
    select * into m from public.meetings where id = p.meeting_id;
    select coalesce(array_agg(distinct u), '{}') into aud from (
      select cm.user_id as u from public.committee_members cm where cm.committee_id = m.committee_id
      union select i.user_id from public.meeting_invitations i where i.meeting_id = m.id and i.user_id is not null) s;
    perform public.dm_notify(aud, 'حزمة مجلس جديدة', p.title || ' — ' || m.title);
  else
    update public.board_packs set status = 'مسودة', published_at = null, published_by = null where id = p_pack;
  end if;
end $$;

-- تنزيل الوثائق السرية: مسموح فقط إن سمح المدير بذلك لهذا المستند، ويُسجَّل
alter table public.vdr_documents add column if not exists allow_download boolean not null default false;
alter table public.vdr_access_log drop constraint if exists vdr_access_log_action_check;
alter table public.vdr_access_log add constraint vdr_access_log_action_check check (action in ('view', 'upload', 'grant', 'revoke', 'delete', 'download', 'settings'));

create or replace function public.vdr_open(p_doc uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d public.vdr_documents; nm text;
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول'; end if;
  if not public.vdr_can_view(p_doc) then raise exception 'لا تملك صلاحية الاطلاع على هذا المستند' using errcode = '42501'; end if;
  select * into d from public.vdr_documents where id = p_doc;
  select full_name into nm from public.profiles where id = auth.uid();
  insert into public.vdr_access_log(doc_id, doc_title, action) values (d.id, d.title, 'view');
  return jsonb_build_object('path', d.storage_path, 'mime', d.mime_type, 'allow_download', d.allow_download, 'file_name', d.title,
    'watermark', coalesce(nm, 'مستخدم') || ' — ' || to_char(now() at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI') || ' — ' || d.confidentiality);
end $$;

create or replace function public.vdr_download(p_doc uuid) returns text
language plpgsql security definer set search_path = public as $$
declare d public.vdr_documents;
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول'; end if;
  if not public.vdr_can_view(p_doc) then raise exception 'لا تملك صلاحية الاطلاع على هذا المستند' using errcode = '42501'; end if;
  select * into d from public.vdr_documents where id = p_doc;
  if not d.allow_download then raise exception 'التنزيل غير مسموح لهذا المستند' using errcode = '42501'; end if;
  insert into public.vdr_access_log(doc_id, doc_title, action) values (d.id, d.title, 'download');
  return d.storage_path;
end $$;

create or replace function public.vdr_set_download(p_doc uuid, p_allow boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'permission denied' using errcode = '42501'; end if;
  update public.vdr_documents set allow_download = coalesce(p_allow, false) where id = p_doc;
  if not found then raise exception 'المستند غير موجود'; end if;
  insert into public.vdr_access_log(doc_id, doc_title, action) values (p_doc, coalesce((select title from public.vdr_documents where id = p_doc), ''), 'settings');
end $$;

revoke all on function public.board_pack_item_check() from public, anon, authenticated;
revoke all on function public.board_pack_publish(uuid, boolean) from public, anon;
revoke all on function public.vdr_download(uuid) from public, anon;
revoke all on function public.vdr_set_download(uuid, boolean) from public, anon;
grant execute on function public.board_pack_publish(uuid, boolean) to authenticated;
grant execute on function public.vdr_download(uuid) to authenticated;
grant execute on function public.vdr_set_download(uuid, boolean) to authenticated;

commit;
