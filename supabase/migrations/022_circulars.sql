-- القرارات بالتمرير: دوال فوق الجدولين الموجودين في الأساس circular_decisions و circular_responses (بلا جداول جديدة).
-- الكتابة على الردود تصبح عبر circular_respond فقط، لفرض: القرار مفتوح، والموعد لم ينته، والعضو من الجهة، والخيار من القائمة.
-- الاحتساب: يُعتمد القرار إذا وافق أكثر من نصف أعضاء الجهة (الأغلبية المطلقة)؛ راجع هذه القاعدة مع لائحة الجمعية.
-- يعتمد على: is_admin() (001)، dm_notify (007)، committees / committee_members / profiles. آمن لإعادة التنفيذ.
begin;

-- لا كتابة مباشرة على الردود (لم تكن تُستخدم من الواجهة)؛ القراءة كما هي (العضو يرى رده، والمدير يرى الكل)
revoke insert, update, delete on public.circular_responses from authenticated, anon;

-- جمهور القرار: أعضاء جهته، أو كل الحسابات النشطة إن لم تُحدد جهة
create or replace function public.circular_audience(p_circular uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select cm.user_id from public.circular_decisions c join public.committee_members cm on cm.committee_id = c.committee_id where c.id = p_circular
  union
  select p.id from public.circular_decisions c cross join public.profiles p where c.id = p_circular and c.committee_id is null and coalesce(p.is_active, true)
$$;

create or replace function public.circular_create(p_title text, p_description text, p_committee uuid, p_deadline timestamptz) returns uuid
language plpgsql security definer set search_path = public as $$
declare new_id uuid; cname text;
begin
  if not public.is_admin() then raise exception 'permission denied' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_title, ''))) not between 3 and 200 then raise exception 'عنوان القرار مطلوب (3 إلى 200 حرف)'; end if;
  if length(coalesce(p_description, '')) > 8000 then raise exception 'نص القرار طويل جدًا'; end if;
  if p_deadline is null or p_deadline <= now() + interval '1 hour' then raise exception 'حدد موعدًا نهائيًا بعد ساعة على الأقل من الآن'; end if;
  if p_committee is not null then
    select name into cname from public.committees where id = p_committee;
    if not found then raise exception 'الجهة غير موجودة'; end if;
  end if;
  insert into public.circular_decisions(title, description, committee_id, deadline, status, created_by)
  values (btrim(p_title), coalesce(p_description, ''), p_committee, p_deadline, 'مفتوح', auth.uid()) returning id into new_id;
  perform public.dm_notify(array(select public.circular_audience(new_id)), 'قرار بالتمرير بانتظار رأيك',
    btrim(p_title) || coalesce(' — ' || cname, '') || ' — آخر موعد: ' || to_char(p_deadline at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI'));
  return new_id;
end $$;

create or replace function public.circular_respond(p_circular uuid, p_choice text, p_comment text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.circular_decisions;
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول'; end if;
  if p_choice not in ('موافق', 'غير موافق', 'ممتنع') then raise exception 'اختر: موافق أو غير موافق أو ممتنع'; end if;
  select * into c from public.circular_decisions where id = p_circular;
  if not found then raise exception 'القرار غير موجود'; end if;
  if c.status <> 'مفتوح' then raise exception 'التصويت على هذا القرار مغلق'; end if;
  if c.deadline is not null and c.deadline < now() then raise exception 'انتهى موعد التصويت على هذا القرار'; end if;
  if not exists (select 1 from public.circular_audience(p_circular) a where a = auth.uid()) then raise exception 'هذا القرار ليس موجّهًا إلى جهتك'; end if;
  insert into public.circular_responses(circular_id, user_id, choice, comment, responded_at)
  values (p_circular, auth.uid(), p_choice, nullif(left(btrim(coalesce(p_comment, '')), 1000), ''), now())
  on conflict (circular_id, user_id) do update set choice = excluded.choice, comment = excluded.comment, responded_at = now();
end $$;

-- النتائج: للمدير كاملة بالأسماء؛ وللعضو من الجمهور الأعداد فقط
create or replace function public.circular_results(p_circular uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare aud int; yes int; no int; abst int; names jsonb := '[]'::jsonb;
begin
  if not (public.is_admin() or exists (select 1 from public.circular_audience(p_circular) a where a = auth.uid())) then raise exception 'permission denied' using errcode = '42501'; end if;
  select count(*) into aud from public.circular_audience(p_circular);
  select count(*) filter (where choice = 'موافق'), count(*) filter (where choice = 'غير موافق'), count(*) filter (where choice = 'ممتنع')
    into yes, no, abst from public.circular_responses where circular_id = p_circular;
  if public.is_admin() then
    select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(p.full_name, '—'), 'choice', r.choice, 'comment', r.comment) order by r.responded_at), '[]'::jsonb)
      into names from public.circular_responses r left join public.profiles p on p.id = r.user_id where r.circular_id = p_circular;
  end if;
  return jsonb_build_object('audience', aud, 'yes', yes, 'no', no, 'abstain', abst, 'pending', greatest(aud - yes - no - abst, 0), 'needed', aud / 2 + 1, 'responses', names);
end $$;

-- الإغلاق والاحتساب (أو الإلغاء) للمدير
create or replace function public.circular_close(p_circular uuid, p_cancel boolean default false) returns text
language plpgsql security definer set search_path = public as $$
declare c public.circular_decisions; aud int; yes int; result text;
begin
  if not public.is_admin() then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into c from public.circular_decisions where id = p_circular for update;
  if not found then raise exception 'القرار غير موجود'; end if;
  if c.status <> 'مفتوح' then raise exception 'القرار مغلق مسبقًا'; end if;
  if p_cancel then result := 'ملغى';
  else
    select count(*) into aud from public.circular_audience(p_circular);
    select count(*) into yes from public.circular_responses where circular_id = p_circular and choice = 'موافق';
    result := case when aud > 0 and yes > aud / 2.0 then 'معتمد' else 'غير معتمد' end;
  end if;
  update public.circular_decisions set status = result where id = p_circular;
  perform public.dm_notify(array(select public.circular_audience(p_circular)), 'نتيجة قرار بالتمرير', c.title || ' — ' || result);
  return result;
end $$;

revoke all on function public.circular_audience(uuid) from public, anon, authenticated; -- داخلية فقط (تكشف قائمة الأعضاء)
revoke all on function public.circular_create(text, text, uuid, timestamptz) from public, anon;
revoke all on function public.circular_respond(uuid, text, text) from public, anon;
revoke all on function public.circular_results(uuid) from public, anon;
revoke all on function public.circular_close(uuid, boolean) from public, anon;
grant execute on function public.circular_create(text, text, uuid, timestamptz) to authenticated;
grant execute on function public.circular_respond(uuid, text, text) to authenticated;
grant execute on function public.circular_results(uuid) to authenticated;
grant execute on function public.circular_close(uuid, boolean) to authenticated;

commit;
