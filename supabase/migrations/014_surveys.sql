-- الاستبيانات واستطلاعات المواعيد: جداول جديدة ودوال، دون تغيير أي جدول قائم.
-- يعتمد على: is_admin() (001) والجداول profiles / committees / committee_members / notifications. آمن لإعادة التنفيذ.
-- مبدأ الخصوصية: الإجابات لا يقرؤها أحد مباشرة؛ تُجمَّع عبر survey_results للمدير فقط، وفي الاستبيان المجهول لا يُخزَّن معها معرّف العضو.
begin;

create table if not exists public.surveys (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'استبيان' check (kind in ('استبيان', 'موعد')),
  title text not null check (length(btrim(title)) between 1 and 200),
  description text check (description is null or length(description) <= 2000),
  committee_id uuid references public.committees(id) on delete set null,
  anonymous boolean not null default false,
  status text not null default 'مسودة' check (status in ('مسودة', 'مفتوح', 'مغلق')),
  closes_at timestamptz,
  chosen_option text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.survey_questions (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys(id) on delete cascade,
  position int not null default 1,
  text text not null check (length(btrim(text)) between 1 and 500),
  qtype text not null check (qtype in ('single', 'multi', 'rating', 'text')),
  options jsonb not null default '[]'::jsonb,
  required boolean not null default true
);
create index if not exists survey_questions_survey_idx on public.survey_questions(survey_id, position);

create table if not exists public.survey_participation (
  survey_id uuid not null references public.surveys(id) on delete cascade,
  user_id uuid not null,
  submitted_at timestamptz not null default now(),
  primary key (survey_id, user_id)
);

create table if not exists public.survey_answers (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys(id) on delete cascade,
  question_id uuid not null references public.survey_questions(id) on delete cascade,
  user_id uuid,
  value jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists survey_answers_q_idx on public.survey_answers(question_id);

-- هل يحق للمستخدم الحالي رؤية الاستبيان؟ (المدير، منشئه، أو من الجمهور المستهدف بعد النشر)
create or replace function public.survey_can_access(p_survey uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.surveys s
     where s.id = p_survey
       and (public.is_admin() or s.created_by = auth.uid()
            or (s.status <> 'مسودة' and (s.committee_id is null
                or exists (select 1 from public.committee_members cm where cm.committee_id = s.committee_id and cm.user_id = auth.uid()))))
  )
$$;

alter table public.surveys enable row level security;
alter table public.survey_questions enable row level security;
alter table public.survey_participation enable row level security;
alter table public.survey_answers enable row level security;

drop policy if exists surveys_read on public.surveys;
create policy surveys_read on public.surveys for select to authenticated using (public.survey_can_access(id));
drop policy if exists sq_read on public.survey_questions;
create policy sq_read on public.survey_questions for select to authenticated using (public.survey_can_access(survey_id));
drop policy if exists sp_read on public.survey_participation;
create policy sp_read on public.survey_participation for select to authenticated using (user_id = auth.uid() or public.is_admin());
-- survey_answers: لا سياسة قراءة ولا كتابة مباشرة (الكتابة والقراءة عبر الدوال فقط)

revoke all on public.surveys, public.survey_questions, public.survey_participation, public.survey_answers from anon, authenticated;
grant select on public.surveys, public.survey_questions, public.survey_participation to authenticated;

-- ───────────── إنشاء/تعديل (مسودة فقط) ─────────────
create or replace function public.survey_save(p_id uuid, p_kind text, p_title text, p_desc text, p_committee uuid, p_anonymous boolean, p_closes timestamptz, p_questions jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id; q jsonb; i int := 0; v_type text; v_opts jsonb; v_n int; o text;
begin
  if not public.is_admin() then raise exception 'إنشاء الاستبيانات للمدير أو أمين السر فقط'; end if;
  if coalesce(p_kind, '') not in ('استبيان', 'موعد') then raise exception 'نوع غير صحيح'; end if;
  if btrim(coalesce(p_title, '')) = '' then raise exception 'العنوان مطلوب'; end if;
  if p_committee is not null and not exists (select 1 from public.committees where id = p_committee) then raise exception 'الجهة غير موجودة'; end if;
  if p_questions is null or jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) = 0 then raise exception 'أضف سؤالًا واحدًا على الأقل'; end if;
  if jsonb_array_length(p_questions) > 50 then raise exception 'الحد الأقصى 50 سؤالًا'; end if;
  if p_kind = 'موعد' and jsonb_array_length(p_questions) <> 1 then raise exception 'استطلاع الموعد له سؤال واحد'; end if;

  for q in select * from jsonb_array_elements(p_questions) loop
    v_type := q->>'qtype'; v_opts := coalesce(q->'options', '[]'::jsonb);
    if btrim(coalesce(q->>'text', '')) = '' then raise exception 'نص السؤال مطلوب'; end if;
    if length(q->>'text') > 500 then raise exception 'نص السؤال طويل (الحد 500 حرف)'; end if;
    if coalesce(v_type, '') not in ('single', 'multi', 'rating', 'text') then raise exception 'نوع سؤال غير صحيح'; end if;
    if v_type in ('single', 'multi') then
      if jsonb_typeof(v_opts) <> 'array' then raise exception 'خيارات غير صحيحة'; end if;
      v_n := jsonb_array_length(v_opts);
      if v_n < 2 or v_n > (case when p_kind = 'موعد' then 15 else 20 end) then raise exception 'عدد الخيارات غير مقبول (2 إلى 20، وللمواعيد حتى 15)'; end if;
      for o in select jsonb_array_elements_text(v_opts) loop
        if btrim(o) = '' or length(o) > 200 then raise exception 'خيار فارغ أو طويل'; end if;
        if p_kind = 'موعد' and o !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}' then raise exception 'صيغة الموعد غير صحيحة'; end if;
      end loop;
      if (select count(distinct x) from jsonb_array_elements_text(v_opts) x) <> v_n then raise exception 'خيارات مكررة'; end if;
    end if;
    if p_kind = 'موعد' and v_type <> 'multi' then raise exception 'استطلاع الموعد يقبل اختيار أكثر من موعد'; end if;
  end loop;

  if v_id is null then
    insert into public.surveys(kind, title, description, committee_id, anonymous, closes_at, created_by)
    values (p_kind, btrim(p_title), nullif(btrim(coalesce(p_desc, '')), ''), p_committee, coalesce(p_anonymous, false), p_closes, auth.uid()) returning id into v_id;
  else
    if not exists (select 1 from public.surveys where id = v_id) then raise exception 'الاستبيان غير موجود'; end if;
    if (select status from public.surveys where id = v_id) <> 'مسودة' then raise exception 'لا يُعدَّل الاستبيان بعد نشره'; end if;
    update public.surveys set kind = p_kind, title = btrim(p_title), description = nullif(btrim(coalesce(p_desc, '')), ''), committee_id = p_committee,
           anonymous = coalesce(p_anonymous, false), closes_at = p_closes, updated_at = now() where id = v_id;
    delete from public.survey_questions where survey_id = v_id;
  end if;

  for q in select * from jsonb_array_elements(p_questions) loop
    i := i + 1;
    insert into public.survey_questions(survey_id, position, text, qtype, options, required)
    values (v_id, i, btrim(q->>'text'), q->>'qtype', case when q->>'qtype' in ('single', 'multi') then q->'options' else '[]'::jsonb end, coalesce((q->>'required')::boolean, true));
  end loop;
  return v_id;
end $$;

-- ───────────── النشر والإغلاق ─────────────
create or replace function public.survey_set_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.surveys%rowtype;
begin
  if not public.is_admin() then raise exception 'للمدير أو أمين السر فقط'; end if;
  select * into s from public.surveys where id = p_id;
  if not found then raise exception 'الاستبيان غير موجود'; end if;
  if p_status not in ('مفتوح', 'مغلق') then raise exception 'حالة غير صحيحة'; end if;
  if p_status = 'مفتوح' and not exists (select 1 from public.survey_questions where survey_id = p_id) then raise exception 'لا أسئلة في الاستبيان'; end if;
  if p_status = 'مفتوح' and s.closes_at is not null and s.closes_at <= now() then raise exception 'موعد الإغلاق مضى، عدّل الموعد قبل النشر'; end if;
  if s.status = p_status then return; end if;
  if s.status = 'مغلق' and p_status = 'مفتوح' and s.chosen_option is not null then raise exception 'اعتُمد موعد فلا يُعاد فتح الاستطلاع'; end if;
  update public.surveys set status = p_status, updated_at = now() where id = p_id;
  if s.status = 'مسودة' and p_status = 'مفتوح' then
    insert into public.notifications(user_id, title, body)
    select u.id, case when s.kind = 'موعد' then 'استطلاع موعد جديد' else 'استبيان جديد' end, s.title
      from public.profiles u
     where coalesce(u.is_active, true)
       and (s.committee_id is null or exists (select 1 from public.committee_members cm where cm.committee_id = s.committee_id and cm.user_id = u.id))
       and not coalesce(u.is_manual, false);
  end if;
end $$;

create or replace function public.survey_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'للمدير أو أمين السر فقط'; end if;
  delete from public.surveys where id = p_id;
  if not found then raise exception 'الاستبيان غير موجود'; end if;
end $$;

-- اعتماد الموعد الفائز في استطلاع موعد (يُغلق الاستطلاع ويُخطر الجمهور)
create or replace function public.survey_choose(p_id uuid, p_option text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.surveys%rowtype;
begin
  if not public.is_admin() then raise exception 'للمدير أو أمين السر فقط'; end if;
  select * into s from public.surveys where id = p_id;
  if not found then raise exception 'الاستبيان غير موجود'; end if;
  if s.kind <> 'موعد' then raise exception 'الاعتماد لاستطلاعات المواعيد فقط'; end if;
  if not exists (select 1 from public.survey_questions q where q.survey_id = p_id and q.options ? p_option) then raise exception 'الموعد ليس من الخيارات'; end if;
  update public.surveys set chosen_option = p_option, status = 'مغلق', updated_at = now() where id = p_id;
  insert into public.notifications(user_id, title, body)
  select u.id, 'اعتماد موعد', s.title || ' — ' || replace(p_option, 'T', ' ')
    from public.profiles u
   where coalesce(u.is_active, true)
     and (s.committee_id is null or exists (select 1 from public.committee_members cm where cm.committee_id = s.committee_id and cm.user_id = u.id))
     and not coalesce(u.is_manual, false);
end $$;

-- ───────────── المشاركة (مرة واحدة لكل عضو) ─────────────
create or replace function public.survey_submit(p_id uuid, p_answers jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s public.surveys%rowtype; q public.survey_questions%rowtype; a jsonb; v jsonb; x text; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'سجّل الدخول أولًا'; end if;
  select * into s from public.surveys where id = p_id;
  if not found or not public.survey_can_access(p_id) then raise exception 'الاستبيان غير متاح لك'; end if;
  if s.status <> 'مفتوح' then raise exception 'الاستبيان غير مفتوح'; end if;
  if s.closes_at is not null and s.closes_at <= now() then raise exception 'انتهى موعد الاستبيان'; end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'array' then raise exception 'صيغة الإجابات غير صحيحة'; end if;
  if exists (select 1 from public.survey_participation where survey_id = p_id and user_id = uid) then raise exception 'سبق أن شاركت في هذا الاستبيان'; end if;

  -- التحقق من كل سؤال قبل أي كتابة
  for q in select * from public.survey_questions where survey_id = p_id order by position loop
    select e into a from jsonb_array_elements(p_answers) e where e->>'q' = q.id::text limit 1;
    v := a->'v';
    if v is null or v = 'null'::jsonb or v = '""'::jsonb or v = '[]'::jsonb then
      if q.required then raise exception 'السؤال مطلوب: %', q.text; end if;
      continue;
    end if;
    if q.qtype = 'single' then
      if jsonb_typeof(v) <> 'string' or not (q.options ? (v #>> '{}')) then raise exception 'اختيار غير صحيح: %', q.text; end if;
    elsif q.qtype = 'multi' then
      if jsonb_typeof(v) <> 'array' then raise exception 'اختيار غير صحيح: %', q.text; end if;
      for x in select jsonb_array_elements_text(v) loop
        if not (q.options ? x) then raise exception 'اختيار غير صحيح: %', q.text; end if;
      end loop;
      if (select count(distinct y) from jsonb_array_elements_text(v) y) <> jsonb_array_length(v) then raise exception 'اختيار مكرر: %', q.text; end if;
    elsif q.qtype = 'rating' then
      if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not between 1 and 5 or (v #>> '{}')::numeric <> floor((v #>> '{}')::numeric) then raise exception 'التقييم من 1 إلى 5: %', q.text; end if;
    else
      if jsonb_typeof(v) <> 'string' or length(v #>> '{}') > 1000 then raise exception 'الإجابة النصية طويلة (الحد 1000): %', q.text; end if;
    end if;
  end loop;

  insert into public.survey_participation(survey_id, user_id) values (p_id, uid);
  for q in select * from public.survey_questions where survey_id = p_id loop
    select e into a from jsonb_array_elements(p_answers) e where e->>'q' = q.id::text limit 1;
    v := a->'v';
    if v is null or v = 'null'::jsonb or v = '""'::jsonb or v = '[]'::jsonb then continue; end if;
    insert into public.survey_answers(survey_id, question_id, user_id, value) values (p_id, q.id, case when s.anonymous then null else uid end, v);
  end loop;
end $$;

-- ───────────── النتائج (للمدير فقط) ─────────────
create or replace function public.survey_results(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.surveys%rowtype; q public.survey_questions%rowtype; res jsonb := '[]'::jsonb; item jsonb; counts jsonb; v_total int; v_aud int; who jsonb := '[]'::jsonb;
begin
  if not public.is_admin() then raise exception 'النتائج للمدير أو أمين السر فقط'; end if;
  select * into s from public.surveys where id = p_id;
  if not found then raise exception 'الاستبيان غير موجود'; end if;
  select count(*) into v_total from public.survey_participation where survey_id = p_id;
  select count(*) into v_aud from public.profiles u
   where coalesce(u.is_active, true) and not coalesce(u.is_manual, false)
     and (s.committee_id is null or exists (select 1 from public.committee_members cm where cm.committee_id = s.committee_id and cm.user_id = u.id));
  for q in select * from public.survey_questions where survey_id = p_id order by position loop
    item := jsonb_build_object('id', q.id, 'text', q.text, 'qtype', q.qtype, 'options', q.options, 'required', q.required,
                               'answered', (select count(*) from public.survey_answers where question_id = q.id));
    if q.qtype = 'single' then
      select coalesce(jsonb_object_agg(z.o, z.n), '{}'::jsonb) into counts from (
        select t.o, (select count(*) from public.survey_answers a where a.question_id = q.id and a.value #>> '{}' = t.o) n
          from jsonb_array_elements_text(q.options) with ordinality t(o, ord) order by t.ord) z;
      item := item || jsonb_build_object('counts', counts);
    elsif q.qtype = 'multi' then
      select coalesce(jsonb_object_agg(z.o, z.n), '{}'::jsonb) into counts from (
        select t.o, (select count(*) from public.survey_answers a where a.question_id = q.id and a.value ? t.o) n
          from jsonb_array_elements_text(q.options) with ordinality t(o, ord) order by t.ord) z;
      item := item || jsonb_build_object('counts', counts);
    elsif q.qtype = 'rating' then
      select coalesce(jsonb_object_agg(z.r::text, z.n), '{}'::jsonb) into counts from (
        select g.r, (select count(*) from public.survey_answers a where a.question_id = q.id and (a.value #>> '{}')::numeric = g.r) n from generate_series(1, 5) g(r) order by g.r) z;
      item := item || jsonb_build_object('counts', counts, 'avg', (select round(avg((a.value #>> '{}')::numeric), 2) from public.survey_answers a where a.question_id = q.id));
    else
      item := item || jsonb_build_object('texts', coalesce((select jsonb_agg(t) from (select a.value #>> '{}' t from public.survey_answers a where a.question_id = q.id order by a.created_at limit 300) z), '[]'::jsonb));
    end if;
    res := res || item;
  end loop;
  if not s.anonymous then
    select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(u.full_name, 'عضو'), 'at', p.submitted_at) order by p.submitted_at), '[]'::jsonb) into who
      from public.survey_participation p left join public.profiles u on u.id = p.user_id where p.survey_id = p_id;
  end if;
  return jsonb_build_object('survey', jsonb_build_object('id', s.id, 'kind', s.kind, 'title', s.title, 'anonymous', s.anonymous, 'status', s.status, 'chosen', s.chosen_option),
                            'total', v_total, 'audience', v_aud, 'questions', res, 'respondents', who);
end $$;

revoke execute on function public.survey_save(uuid, text, text, text, uuid, boolean, timestamptz, jsonb), public.survey_set_status(uuid, text), public.survey_delete(uuid),
  public.survey_choose(uuid, text), public.survey_submit(uuid, jsonb), public.survey_results(uuid), public.survey_can_access(uuid) from public, anon;
grant execute on function public.survey_save(uuid, text, text, text, uuid, boolean, timestamptz, jsonb), public.survey_set_status(uuid, text), public.survey_delete(uuid),
  public.survey_choose(uuid, text), public.survey_submit(uuid, jsonb), public.survey_results(uuid), public.survey_can_access(uuid) to authenticated;

commit;
