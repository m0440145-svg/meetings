-- رابط تسجيل الاجتماع (يُسجَّل في أداة خارجية مثل Teams/Zoom/Meet) مع تاريخ انتهاء الاحتفاظ.
-- جدول مستقل: لا يغيّر جدول الاجتماعات ولا أي جدول قائم. يعتمد على: is_admin() (001) و009 (created_by). آمن لإعادة التنفيذ.
begin;

create table if not exists public.meeting_recordings (
  meeting_id uuid primary key references public.meetings(id) on delete cascade,
  url text not null check (url ~* '^https://[^[:space:]]+$' and length(url) <= 2000),
  retain_until date,
  note text check (note is null or length(note) <= 500),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.meeting_recordings enable row level security;

-- القراءة: لمن يستطيع رؤية الاجتماع نفسه (تتبع سياسات جدول الاجتماعات)
drop policy if exists mrec_read on public.meeting_recordings;
create policy mrec_read on public.meeting_recordings for select to authenticated
  using (exists (select 1 from public.meetings m where m.id = meeting_recordings.meeting_id));

-- الكتابة: لمنشئ الاجتماع أو المدير/أمين السر
drop policy if exists mrec_write on public.meeting_recordings;
create policy mrec_write on public.meeting_recordings for all to authenticated
  using (public.is_admin() or exists (select 1 from public.meetings m where m.id = meeting_recordings.meeting_id and m.created_by = auth.uid()))
  with check (public.is_admin() or exists (select 1 from public.meetings m where m.id = meeting_recordings.meeting_id and m.created_by = auth.uid()));

revoke all on public.meeting_recordings from anon;
grant select, insert, update, delete on public.meeting_recordings to authenticated;

commit;
