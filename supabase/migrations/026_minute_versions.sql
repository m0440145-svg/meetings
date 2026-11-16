-- المحاضر: سجل إصدارات متكامل + مسار تعديل بعد الاعتماد بموافقة ثانية.
-- 1) minute_versions: لقطة تلقائية عند كل إنشاء أو تغيير في نص المحضر أو توصياته أو اعتماده (trigger بعد الحدث، لا يغيّر سلوك الحفظ).
-- 2) minute_amendments: طلب تعديل لمحضر موقَّع أو معتمد (كان التعديل ممنوعًا كليًا). يقدّمه مدير/أمين سر ويوافق عليه مدير/أمين سر آخر (لا يوافق مقدّم الطلب على طلبه).
--    عند الموافقة يُطبَّق النص الجديد ويُحدَّث content_hash، وتبقى التوقيعات السابقة محفوظة كما هي (مرتبطة ببصمة النص الأصلي) والإصدار السابق محفوظ في السجل.
-- 3) guard_minutes: نفسها كما في 001 مع استثناء واحد فقط: السماح بتغيير النص حين يكون app.minute_amend = on (تضبطه دالة الموافقة وحدها).
-- يعتمد على: is_admin() (001) وجدول minutes. آمن لإعادة التنفيذ.
begin;

create table if not exists public.minute_versions (
  id bigint generated always as identity primary key,
  minute_id uuid not null references public.minutes(id) on delete cascade,
  version_no int not null,
  kind text not null check (kind in ('إنشاء', 'تعديل مسودة', 'اعتماد', 'تعديل بعد الاعتماد')),
  content text,
  recommendations text,
  status text,
  content_hash text,
  changed_by uuid default auth.uid(),
  approved_by uuid,
  reason text,
  created_at timestamptz not null default now(),
  unique (minute_id, version_no)
);
create index if not exists minute_versions_minute_idx on public.minute_versions(minute_id, version_no desc);

create table if not exists public.minute_amendments (
  id uuid primary key default gen_random_uuid(),
  minute_id uuid not null references public.minutes(id) on delete cascade,
  proposed_content text not null,
  proposed_recommendations text,
  reason text not null check (length(btrim(reason)) between 10 and 1000),
  status text not null default 'بانتظار الموافقة' check (status in ('بانتظار الموافقة', 'معتمد', 'مرفوض')),
  requested_by uuid not null default auth.uid(),
  requested_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 1000)
);
create unique index if not exists minute_amendments_one_pending on public.minute_amendments(minute_id) where status = 'بانتظار الموافقة';

alter table public.minute_versions enable row level security;
alter table public.minute_amendments enable row level security;
drop policy if exists minute_versions_read on public.minute_versions;
create policy minute_versions_read on public.minute_versions for select to authenticated
  using (public.is_admin() or exists (select 1 from public.minutes m where m.id = minute_versions.minute_id));
drop policy if exists minute_amendments_read on public.minute_amendments;
create policy minute_amendments_read on public.minute_amendments for select to authenticated using (public.is_admin());
revoke insert, update, delete on public.minute_versions, public.minute_amendments from authenticated, anon;

-- لقطة الإصدار: عند الإنشاء، وعند تغيّر النص أو التوصيات، وعند الاعتماد
create or replace function public.minute_snapshot() returns trigger
language plpgsql security definer set search_path = public as $$
declare v int; k text; appr uuid;
begin
  if tg_op = 'INSERT' then k := 'إنشاء';
  elsif new.status = 'معتمد' and old.status is distinct from 'معتمد' then k := 'اعتماد';
  elsif new.content is distinct from old.content or new.recommendations is distinct from old.recommendations then
    k := case when current_setting('app.minute_amend', true) = 'on' then 'تعديل بعد الاعتماد' else 'تعديل مسودة' end;
  else return new; end if;
  select coalesce(max(version_no), 0) + 1 into v from public.minute_versions where minute_id = new.id;
  appr := case when k in ('اعتماد', 'تعديل بعد الاعتماد') then coalesce(nullif(current_setting('app.minute_approver', true), '')::uuid, new.approved_by) end;
  insert into public.minute_versions(minute_id, version_no, kind, content, recommendations, status, content_hash, changed_by, approved_by, reason)
  values (new.id, v, k, new.content, new.recommendations, new.status, new.content_hash, auth.uid(), appr, nullif(current_setting('app.minute_reason', true), ''));
  return new;
end $$;
drop trigger if exists trg_minute_snapshot on public.minutes;
create trigger trg_minute_snapshot after insert or update on public.minutes
  for each row execute function public.minute_snapshot();

-- نفس guard_minutes من 001 مع استثناء التعديل بالموافقة الثانية فقط
create or replace function public.guard_minutes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then  -- لا يُدرج محضر معتمد جاهزًا
    new.status := 'مسودة'; new.approved_at := null; new.approved_by := null; new.content_hash := null;
    return new;
  end if;
  if (new.content is distinct from old.content or new.meeting_id is distinct from old.meeting_id)
     and (old.status = 'معتمد' or exists (select 1 from public.signatures s where s.minute_id = old.id))
     and current_setting('app.minute_amend', true) is distinct from 'on' then
    raise exception 'لا يمكن تعديل محضر تم توقيعه أو اعتماده';
  end if;
  if current_setting('app.rpc', true) is distinct from 'on' and (
       new.status is distinct from old.status
    or new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by
    or new.content_hash is distinct from old.content_hash) then
    raise exception 'يُعتمد المحضر عبر الدالة approve_minute فقط';
  end if;
  return new;
end $$;

-- طلب تعديل لمحضر موقَّع أو معتمد
create or replace function public.minute_amend_request(p_minute uuid, p_content text, p_recommendations text, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.minutes%rowtype; new_id uuid;
begin
  if not public.is_admin() then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into m from public.minutes where id = p_minute;
  if not found then raise exception 'المحضر غير موجود'; end if;
  if not (m.status = 'معتمد' or exists (select 1 from public.signatures s where s.minute_id = m.id)) then
    raise exception 'المحضر مسودة غير موقّعة: عدّله مباشرة دون طلب تعديل';
  end if;
  if length(btrim(coalesce(p_content, ''))) < 10 then raise exception 'نص المحضر المقترح قصير جدًا'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'اكتب سبب التعديل (10 أحرف على الأقل)'; end if;
  if p_content = coalesce(m.content, '') and coalesce(p_recommendations, '') = coalesce(m.recommendations, '') then raise exception 'لا فرق بين النص المقترح والحالي'; end if;
  insert into public.minute_amendments(minute_id, proposed_content, proposed_recommendations, reason)
  values (p_minute, p_content, p_recommendations, btrim(p_reason)) returning id into new_id;
  return new_id;
exception when unique_violation then raise exception 'يوجد طلب تعديل معلّق لهذا المحضر بانتظار الموافقة';
end $$;

-- الموافقة الثانية أو الرفض: لا يقرّر مقدّم الطلب على طلبه
create or replace function public.minute_amend_decide(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare a public.minute_amendments%rowtype; h text;
begin
  if not public.is_admin() then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into a from public.minute_amendments where id = p_id for update;
  if not found then raise exception 'طلب التعديل غير موجود'; end if;
  if a.status <> 'بانتظار الموافقة' then raise exception 'سبق البتّ في هذا الطلب'; end if;
  if a.requested_by = auth.uid() then raise exception 'لا يوافق مقدّم الطلب على طلبه؛ يلزم مدير أو أمين سر آخر'; end if;
  if not p_approve and length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'اكتب سبب الرفض'; end if;
  if p_approve then
    h := encode(sha256(convert_to(coalesce(a.proposed_content, ''), 'UTF8')), 'hex');
    perform set_config('app.rpc', 'on', true);
    perform set_config('app.minute_amend', 'on', true);
    perform set_config('app.minute_approver', auth.uid()::text, true);
    perform set_config('app.minute_reason', a.reason, true);
    update public.minutes set content = a.proposed_content, recommendations = coalesce(a.proposed_recommendations, recommendations), content_hash = case when status = 'معتمد' then h else content_hash end, updated_at = now() where id = a.minute_id;
    perform set_config('app.minute_amend', 'off', true);
    perform set_config('app.minute_reason', '', true);
  end if;
  update public.minute_amendments set status = case when p_approve then 'معتمد' else 'مرفوض' end, decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), '') where id = p_id;
end $$;

revoke all on function public.minute_snapshot() from public, anon, authenticated;
revoke all on function public.minute_amend_request(uuid, text, text, text) from public, anon;
revoke all on function public.minute_amend_decide(uuid, boolean, text) from public, anon;
grant execute on function public.minute_amend_request(uuid, text, text, text) to authenticated;
grant execute on function public.minute_amend_decide(uuid, boolean, text) to authenticated;

commit;
