-- بنرات الإعلانات في الصفحة الرئيسية (يديرها المدير يدويًا). يعتمد على: 001 (is_admin) و 002 (حاوية الصور branding).
-- القراءة العامة للبنرات الفعّالة فقط وضمن نافذة التاريخ، لأنها تظهر لزوار غير مسجلين؛ لا تضع فيها أي معلومة سرية.

begin;

create table if not exists public.platform_banners (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(title) between 1 and 80),
  body        text not null default '' check (char_length(body) <= 200),
  image_url   text check (image_url is null or image_url = '' or image_url ~ '^https://'),
  link_url    text check (link_url is null or link_url = '' or link_url ~ '^https://'),
  cta_label   text not null default '' check (char_length(cta_label) <= 30),
  sort_order  int not null default 0 check (sort_order between 0 and 999),
  is_active   boolean not null default true,
  starts_at   timestamptz,
  ends_at     timestamptz,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create index if not exists platform_banners_order_idx on public.platform_banners(sort_order, created_at);
alter table public.platform_banners enable row level security;

drop policy if exists pb_public_read on public.platform_banners;
create policy pb_public_read on public.platform_banners for select to anon, authenticated
  using (is_active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at >= now()));
drop policy if exists pb_admin_all on public.platform_banners;
create policy pb_admin_all on public.platform_banners for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

revoke all on public.platform_banners from anon, authenticated;
grant select on public.platform_banners to anon, authenticated;
grant insert, update, delete on public.platform_banners to authenticated;

create or replace function public.touch_banner() returns trigger language plpgsql as $$
begin new.updated_at := now(); new.created_by := coalesce(new.created_by, auth.uid()); return new; end $$;
drop trigger if exists trg_touch_banner on public.platform_banners;
create trigger trg_touch_banner before insert or update on public.platform_banners for each row execute function public.touch_banner();

do $$
begin
  if to_regprocedure('public.audit_trg()') is not null then
    drop trigger if exists trg_audit on public.platform_banners;
    create trigger trg_audit after insert or update or delete on public.platform_banners for each row execute function public.audit_trg();
  end if;
end $$;

commit;
