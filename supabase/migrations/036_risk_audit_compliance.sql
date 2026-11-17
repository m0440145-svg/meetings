-- الميزة 8: المخاطر والتدقيق الداخلي والالتزامات (وحدات مستقلة؛ لا تمسّ محرك القرارات).
-- سجل المخاطر: احتمال وأثر من 1 إلى 5 (مقياس افتراضي قابل للتعديل لاحقًا) ودرجة = احتمال × أثر، وإجراءات معالجة بمواعيد.
-- التدقيق الداخلي: مهام تدقيق ضمن خطة سنوية وملاحظات (درجة خطورة) وتوصيات بمسؤول وموعد.
-- سجل الالتزامات: التزام ومصدره (لائحة/نظام/عقد) ودورية ومسؤول وموعد قادم وسجل إنجاز؛ obligation_mark_done تُقدّم الموعد التالي حسب الدورية.
-- الكتابة للمدير/أمين السر، والقراءة لهم ولمالك العنصر. كل جدول عليه سياسة approved_only (الترحيل 035). آمن لإعادة التنفيذ.
begin;

create sequence if not exists public.risk_code_seq;

create table if not exists public.risks (
  id uuid primary key default gen_random_uuid(),
  code text unique default ('R-' || lpad(nextval('public.risk_code_seq')::text, 3, '0')),
  title text not null check (char_length(btrim(title)) between 3 and 200),
  description text not null default '' check (char_length(description) <= 3000),
  category text not null default 'عام' check (char_length(category) <= 60),
  owner_id uuid references public.profiles(id) on delete set null,
  likelihood int not null check (likelihood between 1 and 5),
  impact int not null check (impact between 1 and 5),
  score int generated always as (likelihood * impact) stored,
  status text not null default 'مفتوح' check (status in ('مفتوح','قيد المعالجة','مقبول','مغلق')),
  review_due date,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.risk_actions (
  id uuid primary key default gen_random_uuid(),
  risk_id uuid not null references public.risks(id) on delete cascade,
  action text not null check (char_length(btrim(action)) between 3 and 1000),
  owner_id uuid references public.profiles(id) on delete set null,
  due_date date,
  status text not null default 'مفتوح' check (status in ('مفتوح','منجز')),
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.audit_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 3 and 200),
  scope text not null default '' check (char_length(scope) <= 2000),
  plan_year int not null default extract(year from now())::int,
  lead_id uuid references public.profiles(id) on delete set null,
  planned_date date,
  status text not null default 'مخطط' check (status in ('مخطط','قيد التنفيذ','مكتمل','مؤجل')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create table if not exists public.audit_findings (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.audit_tasks(id) on delete cascade,
  finding text not null check (char_length(btrim(finding)) between 3 and 3000),
  severity text not null default 'متوسطة' check (severity in ('منخفضة','متوسطة','عالية')),
  recommendation text not null default '' check (char_length(recommendation) <= 3000),
  owner_id uuid references public.profiles(id) on delete set null,
  due_date date,
  status text not null default 'مفتوحة' check (status in ('مفتوحة','قيد المعالجة','مغلقة')),
  closed_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.obligations (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 3 and 200),
  source text not null default '' check (char_length(source) <= 300),
  frequency text not null default 'سنوي' check (frequency in ('شهري','ربع سنوي','نصف سنوي','سنوي','عند الحاجة')),
  owner_id uuid references public.profiles(id) on delete set null,
  next_due date,
  last_done date,
  status text not null default 'ساري' check (status in ('ساري','موقوف')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create table if not exists public.obligation_log (
  id uuid primary key default gen_random_uuid(),
  obligation_id uuid not null references public.obligations(id) on delete cascade,
  done_on date not null,
  note text not null default '' check (char_length(note) <= 1000),
  done_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists risk_actions_risk_idx on public.risk_actions(risk_id);
create index if not exists audit_findings_task_idx on public.audit_findings(task_id);
create index if not exists obligation_log_ob_idx on public.obligation_log(obligation_id);

create or replace function public.touch_risk() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists trg_touch_risk on public.risks;
create trigger trg_touch_risk before update on public.risks for each row execute function public.touch_risk();

-- ختم الإنجاز/الإغلاق تلقائيًا
create or replace function public.risk_action_stamp() returns trigger language plpgsql as $$
begin
  if new.status = 'منجز' and old.status is distinct from 'منجز' then new.done_at := now(); end if;
  if new.status = 'مفتوح' then new.done_at := null; end if;
  return new;
end $$;
drop trigger if exists trg_risk_action_stamp on public.risk_actions;
create trigger trg_risk_action_stamp before update on public.risk_actions for each row execute function public.risk_action_stamp();
create or replace function public.finding_stamp() returns trigger language plpgsql as $$
begin
  if new.status = 'مغلقة' and old.status is distinct from 'مغلقة' then new.closed_at := now(); end if;
  if new.status <> 'مغلقة' then new.closed_at := null; end if;
  return new;
end $$;
drop trigger if exists trg_finding_stamp on public.audit_findings;
create trigger trg_finding_stamp before update on public.audit_findings for each row execute function public.finding_stamp();

do $$
declare t text;
begin
  foreach t in array array['risks','risk_actions','audit_tasks','audit_findings','obligations','obligation_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t || '_admin', t);
    execute format('drop policy if exists approved_only on public.%I', t);
    execute format('create policy approved_only on public.%I as restrictive for all to authenticated using ((select public.is_approved())) with check ((select public.is_approved()))', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- المالك يقرأ عناصره فقط
drop policy if exists risks_owner_read on public.risks;
create policy risks_owner_read on public.risks for select to authenticated using (owner_id = auth.uid());
drop policy if exists risk_actions_owner_read on public.risk_actions;
create policy risk_actions_owner_read on public.risk_actions for select to authenticated using (owner_id = auth.uid());
drop policy if exists audit_findings_owner_read on public.audit_findings;
create policy audit_findings_owner_read on public.audit_findings for select to authenticated using (owner_id = auth.uid());
drop policy if exists obligations_owner_read on public.obligations;
create policy obligations_owner_read on public.obligations for select to authenticated using (owner_id = auth.uid());

-- تسجيل إنجاز التزام وتقديم الموعد التالي (للمدير أو مالك الالتزام)
create or replace function public.obligation_mark_done(p_id uuid, p_note text default '', p_date date default current_date) returns date
language plpgsql security definer set search_path = public as $$
declare o public.obligations%rowtype; nxt date;
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول'; end if;
  select * into o from public.obligations where id = p_id for update;
  if not found then raise exception 'الالتزام غير موجود'; end if;
  if not (public.is_admin() or o.owner_id = auth.uid()) then raise exception 'لا تملك صلاحية تسجيل إنجاز هذا الالتزام' using errcode = '42501'; end if;
  if p_date > current_date then raise exception 'تاريخ الإنجاز لا يكون في المستقبل'; end if;
  nxt := case o.frequency when 'شهري' then p_date + interval '1 month' when 'ربع سنوي' then p_date + interval '3 months'
                          when 'نصف سنوي' then p_date + interval '6 months' when 'سنوي' then p_date + interval '1 year' else null end;
  insert into public.obligation_log(obligation_id, done_on, note) values (p_id, p_date, coalesce(btrim(p_note), ''));
  update public.obligations set last_done = p_date, next_due = nxt where id = p_id;
  return nxt;
end $$;
revoke all on function public.obligation_mark_done(uuid, text, date) from public, anon;
grant execute on function public.obligation_mark_done(uuid, text, date) to authenticated;

commit;
