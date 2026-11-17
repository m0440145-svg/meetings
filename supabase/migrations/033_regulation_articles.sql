-- مواد الأنظمة واللوائح (للبحث بالاستشهاد): كل نظام في regulations يمكن أن تُرفق به مواده نصًّا.
-- القراءة لكل مسجَّل، والكتابة للمدير/أمين السر عبر regulation_import (ذرّية: استبدال أو إضافة). لا تغيير في جدول regulations ولا في بياناته.
-- آمن لإعادة التنفيذ.
begin;

create table if not exists public.regulation_articles (
  id uuid primary key default gen_random_uuid(),
  regulation_id uuid not null references public.regulations(id) on delete cascade,
  seq int not null,
  art_no text not null check (char_length(art_no) between 1 and 120),
  body text not null check (char_length(btrim(body)) between 1 and 20000),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (regulation_id, seq)
);
create index if not exists regulation_articles_reg_idx on public.regulation_articles(regulation_id, seq);

alter table public.regulation_articles enable row level security;
drop policy if exists regart_read on public.regulation_articles;
create policy regart_read on public.regulation_articles for select to authenticated using (true);
grant select on public.regulation_articles to authenticated;
-- لا كتابة مباشرة: عبر الدالة فقط

-- p_articles: [{"art_no":"المادة 1","body":"..."}, ...] بالترتيب؛ p_replace=true يستبدل مواد النظام كلها
create or replace function public.regulation_import(p_regulation uuid, p_articles jsonb, p_replace boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare a jsonb; n int := 0; base int;
begin
  if not public.is_admin() then raise exception 'لا تملك صلاحية إدارة مواد الأنظمة' using errcode = '42501'; end if;
  if not exists (select 1 from public.regulations where id = p_regulation) then raise exception 'النظام غير موجود'; end if;
  if jsonb_typeof(p_articles) <> 'array' or jsonb_array_length(p_articles) = 0 then raise exception 'لا مواد للإدخال'; end if;
  if jsonb_array_length(p_articles) > 2000 then raise exception 'عدد المواد أكبر من الحد (2000)'; end if;
  if p_replace then delete from public.regulation_articles where regulation_id = p_regulation; end if;
  select coalesce(max(seq), 0) into base from public.regulation_articles where regulation_id = p_regulation;
  for a in select * from jsonb_array_elements(p_articles) loop
    n := n + 1;
    insert into public.regulation_articles(regulation_id, seq, art_no, body)
    values (p_regulation, base + n, left(btrim(a->>'art_no'), 120), btrim(a->>'body'));
  end loop;
  return n;
end $$;

revoke all on function public.regulation_import(uuid, jsonb, boolean) from public, anon;
grant execute on function public.regulation_import(uuid, jsonb, boolean) to authenticated;

commit;
