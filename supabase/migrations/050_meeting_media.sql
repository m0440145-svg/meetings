-- عرض المحتوى داخل الاجتماع: روابط فيديو وعروض (PowerPoint وCanva وغيرها) تُحفظ لكل اجتماع وتُعرض داخل المنصة لمن يرى الاجتماع.
-- 1) meeting_media: الرابط (https فقط) وعنوانه وملاحظة اختيارية وترتيبه، وعلامة «يُعرض الآن» (is_live). لا يُخزَّن ملف، الرابط فقط.
-- 2) الصلاحيات: القراءة لمن يرى الاجتماع (سياسة meetings نفسها: مدير، منشئ، عضو لجنة، حاضر)، والكتابة للمدير/أمين السر ومنشئ الاجتماع فقط. حد أقصى 40 عنصرًا للاجتماع.
-- 3) media_set_live(عنصر، حالة): المدير/المنشئ يجعل عنصرًا «يُعرض الآن» (واحد فقط للاجتماع) فيظهر للحاضرين عبر التحديث الفوري (realtime).
-- 4) تحويل الرابط إلى تضمين آمن يتم في الواجهة بقائمة مزوّدين محددة (يوتيوب، فيميو، كانفا، قوقل سلايدز/درايف، PowerPoint عبر OneDrive/SharePoint/Office Online، لوم)؛ ما عداها يُفتح كرابط في تبويب جديد بلا تضمين.
-- آمن لإعادة التنفيذ. للتراجع: drop table public.meeting_media cascade; drop function public.media_set_live(uuid, boolean); drop function public.guard_media_limit();
begin;

create table if not exists public.meeting_media (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 150),
  url text not null check (url ~ '^https://[^[:space:]]+$' and char_length(url) <= 800),
  note text check (note is null or char_length(note) <= 300),
  sort_order int not null default 0,
  is_live boolean not null default false,
  live_since timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists meeting_media_meeting_idx on public.meeting_media(meeting_id, sort_order, created_at);

alter table public.meeting_media enable row level security;
drop policy if exists approved_only on public.meeting_media;
create policy approved_only on public.meeting_media as restrictive for all to authenticated using ((select public.is_approved())) with check ((select public.is_approved()));
drop policy if exists meeting_media_read on public.meeting_media;
create policy meeting_media_read on public.meeting_media for select to authenticated
  using (exists (select 1 from public.meetings m where m.id = meeting_media.meeting_id));
drop policy if exists meeting_media_write on public.meeting_media;
create policy meeting_media_write on public.meeting_media for all to authenticated
  using (public.is_admin() or exists (select 1 from public.meetings m where m.id = meeting_media.meeting_id and m.created_by = auth.uid()))
  with check (public.is_admin() or exists (select 1 from public.meetings m where m.id = meeting_media.meeting_id and m.created_by = auth.uid()));
revoke all on public.meeting_media from anon;
grant select, insert, update, delete on public.meeting_media to authenticated;

-- حد أقصى لعدد العناصر
create or replace function public.guard_media_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.meeting_media where meeting_id = new.meeting_id) >= 40 then
    raise exception 'بلغ الاجتماع الحد الأقصى من عناصر العرض (40)';
  end if;
  return new;
end $$;
revoke all on function public.guard_media_limit() from public, anon, authenticated;
drop trigger if exists trg_guard_media_limit on public.meeting_media;
create trigger trg_guard_media_limit before insert on public.meeting_media for each row execute function public.guard_media_limit();

drop trigger if exists trg_audit on public.meeting_media;
create trigger trg_audit after insert or update or delete on public.meeting_media for each row execute function public.audit_trg();

-- «يُعرض الآن»: عنصر واحد للاجتماع
create or replace function public.media_set_live(p_id uuid, p_live boolean) returns void
language plpgsql security definer set search_path = public as $$
declare mm public.meeting_media%rowtype; m public.meetings%rowtype;
begin
  if auth.uid() is null or not public.is_approved() then raise exception 'غير مصرح' using errcode = '42501'; end if;
  select * into mm from public.meeting_media where id = p_id;
  if not found then raise exception 'العنصر غير موجود'; end if;
  select * into m from public.meetings where id = mm.meeting_id;
  if not (public.is_admin() or m.created_by = auth.uid()) then raise exception 'لا تملك صلاحية إدارة العرض' using errcode = '42501'; end if;
  if p_live then
    update public.meeting_media set is_live = false, live_since = null where meeting_id = mm.meeting_id and is_live and id <> p_id;
    update public.meeting_media set is_live = true, live_since = now() where id = p_id;
  else
    update public.meeting_media set is_live = false, live_since = null where id = p_id;
  end if;
end $$;
revoke all on function public.media_set_live(uuid, boolean) from public, anon;
grant execute on function public.media_set_live(uuid, boolean) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.meeting_media;
exception when duplicate_object then null; when undefined_object then null; end $$;

commit;
