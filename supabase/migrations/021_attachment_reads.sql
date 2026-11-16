-- مركز المرفقات: تتبّع قراءة مرفقات الاجتماعات (من فتح الملف ومتى). جدول ودالتان جديدان دون تغيير جدول attachments أو التخزين.
-- يعتمد على: attachments و meeting_invitations و committee_members و meetings (الأساس) و is_admin() (001). آمن لإعادة التنفيذ.
begin;

create table if not exists public.attachment_reads (
  attachment_id uuid not null references public.attachments(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  first_read_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  read_count int not null default 1,
  primary key (attachment_id, user_id)
);
-- قاعدة الإنتاج فيها جدول attachment_reads قديم من الأساس (attachment_id, user_id, read_at) وغير مستخدم؛ تُضاف إليه الأعمدة الناقصة فقط
alter table public.attachment_reads add column if not exists first_read_at timestamptz not null default now();
alter table public.attachment_reads add column if not exists last_read_at timestamptz not null default now();
alter table public.attachment_reads add column if not exists read_count int not null default 1;

alter table public.attachment_reads enable row level security;
drop policy if exists attachment_reads_read on public.attachment_reads;
create policy attachment_reads_read on public.attachment_reads for select to authenticated using (user_id = auth.uid() or public.is_admin());
revoke insert, update, delete on public.attachment_reads from authenticated, anon;

-- يسجّل المستخدم الحالي قراءته للمرفق (يُستدعى عند فتح الملف). لا يسجّل إلا لنفسه.
create or replace function public.attachment_mark_read(p_attachment uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول'; end if;
  if not exists (select 1 from public.attachments where id = p_attachment) then raise exception 'المرفق غير موجود'; end if;
  insert into public.attachment_reads(attachment_id, user_id) values (p_attachment, auth.uid())
  on conflict (attachment_id, user_id) do update set last_read_at = now(), read_count = public.attachment_reads.read_count + 1;
end $$;

-- إحصاء القراءة لكل مرفق (للمدير وأمين السر): عدد القرّاء، والجمهور المتوقع (المدعوون للاجتماع، وإلا أعضاء لجنته)، وأسماء القرّاء.
create or replace function public.attachment_read_stats() returns table(attachment_id uuid, readers int, audience int, reader_names jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'permission denied' using errcode = '42501'; end if;
  return query
  select a.id,
         (select count(*)::int from public.attachment_reads r where r.attachment_id = a.id),
         coalesce(nullif((select count(*)::int from public.meeting_invitations i where i.meeting_id = a.meeting_id), 0),
                  (select count(*)::int from public.committee_members cm join public.meetings m on m.committee_id = cm.committee_id where m.id = a.meeting_id)),
         coalesce((select jsonb_agg(coalesce(p.full_name, '—') order by r.first_read_at) from public.attachment_reads r left join public.profiles p on p.id = r.user_id where r.attachment_id = a.id), '[]'::jsonb)
    from public.attachments a;
end $$;

revoke all on function public.attachment_mark_read(uuid) from public, anon;
revoke all on function public.attachment_read_stats() from public, anon;
grant execute on function public.attachment_mark_read(uuid) to authenticated;
grant execute on function public.attachment_read_stats() to authenticated;

commit;
