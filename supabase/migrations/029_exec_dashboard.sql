-- التقارير: دالة قراءة واحدة تغذّي «اللوحة التنفيذية» للمجلس واللجان والقرارات (للمدير وأمين السر). بلا جداول جديدة ولا تغيير في أي دالة قائمة.
-- التعريفات تطابق dm_kpis (008): تُستبعد المسودات وما بانتظار الاعتماد والملغاة والتوصيات؛ والتأخر بـ dm_is_overdue؛ والالتزام بالموعد على الموعد الحالي.
-- مؤشرات الامتثال والنضج: سبعة مؤشرات بمستهدفات افتراضية ثابتة في الدالة (وتُعرض في اللوحة)، ودرجة النضج = نسبة المؤشرات المحقّقة من القابلة للقياس.
--   المستهدفات سياسة مقترحة وليست لائحة معتمدة؛ تُعدَّل هنا بعد اعتماد الجمعية لها.
-- المصادر: meetings, meeting_attendees, meeting_invitations, minutes, votes, decisions, decision_evidence, committees. آمن لإعادة التنفيذ.
begin;

create or replace function public.exec_dashboard(p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  f date := coalesce(p_from, current_date - 365);
  t date := coalesce(p_to, current_date);
  req_ev boolean := coalesce((public.dm_setting('require_evidence'))::text = 'true', true);
  res jsonb; ind jsonb := '[]'::jsonb;
  mt_n int; mt_old int; mt_ontime int; att_inv int; att_ok int;
  dc_total int; dc_assigned int; dc_eval int; dc_ontime int; dc_open_due int; dc_overdue int; dc_done int; dc_done_ev int;
  v_closed int; v_quorum int;
  v jsonb;
begin
  if not public.is_admin() then raise exception 'permission denied' using errcode = '42501'; end if;
  if t < f then raise exception 'نهاية الفترة قبل بدايتها'; end if;


  -- الاجتماعات في الفترة وأول محضر معتمد لكل اجتماع
  select count(*), count(*) filter (where m.gregorian_date <= current_date - 7),
         count(*) filter (where m.gregorian_date <= current_date - 7 and exists (
           select 1 from public.minutes x where x.meeting_id = m.id and x.status = 'معتمد' and x.approved_at::date <= m.gregorian_date + 7))
    into mt_n, mt_old, mt_ontime
    from public.meetings m where m.gregorian_date between f and t;

  -- الحضور: المدعوون (دعوات الاجتماع، وإلا سجلات الحضور) والحاضرون حضوريًا أو عن بعد، للاجتماعات المنعقدة
  select coalesce(sum(inv), 0)::int, coalesce(sum(ok), 0)::int into att_inv, att_ok from (
    select coalesce(nullif((select count(*) from public.meeting_invitations i where i.meeting_id = m.id), 0), (select count(*) from public.meeting_attendees a where a.meeting_id = m.id)) as inv,
           (select count(*) from public.meeting_attendees a where a.meeting_id = m.id and a.attendance_status in ('حاضر', 'عن بعد')) as ok
      from public.meetings m where m.gregorian_date between f and least(t, current_date)) s;

  -- القرارات المعتمدة فما بعد (نفس استبعادات dm_kpis)
  select count(*), count(*) filter (where d.assigned_at is not null),
         count(*) filter (where d.status in ('completed', 'closed') or public.dm_is_overdue(d.status, d.due_date)),
         count(*) filter (where d.status in ('completed', 'closed') and d.completed_at::date <= d.due_date),
         count(*) filter (where d.status in ('assigned', 'executing', 'awaiting_update', 'returned', 'pending_verification') and d.due_date <= current_date),
         count(*) filter (where public.dm_is_overdue(d.status, d.due_date)),
         count(*) filter (where d.status in ('completed', 'closed')),
         count(*) filter (where d.status in ('completed', 'closed') and exists (select 1 from public.decision_evidence e where e.decision_id = d.id and e.review_status = 'accepted'))
    into dc_total, dc_assigned, dc_eval, dc_ontime, dc_open_due, dc_overdue, dc_done, dc_done_ev
    from public.decisions d
   where d.status not in ('draft', 'pending_approval', 'cancelled') and d.record_type <> 'recommendation'
     and coalesce(d.decision_date, d.created_at::date) between f and t;

  -- التصويتات المغلقة وتحقق النصاب
  select count(*), count(*) filter (where (v.result->>'quorum_met') = 'true') into v_closed, v_quorum
    from public.votes v where v.closed_at is not null and v.closed_at::date between f and t and v.quorum_required is not null;

  -- المؤشرات: القيمة بالنسبة المئوية، والاتجاه (ge: الأعلى أفضل، le: الأدنى أفضل)
  ind := jsonb_build_array(
    jsonb_build_object('key', 'minutes_on_time', 'label', 'اعتماد المحضر خلال 7 أيام من الاجتماع', 'dir', 'ge', 'target', 80, 'num', mt_ontime, 'den', mt_old),
    jsonb_build_object('key', 'attendance', 'label', 'نسبة حضور الأعضاء للاجتماعات', 'dir', 'ge', 'target', 75, 'num', att_ok, 'den', att_inv),
    jsonb_build_object('key', 'decisions_assigned', 'label', 'قرارات معتمدة أُسندت (مسؤول وموعد)', 'dir', 'ge', 'target', 90, 'num', dc_assigned, 'den', dc_total),
    jsonb_build_object('key', 'ontime', 'label', 'الالتزام بموعد تنفيذ القرارات', 'dir', 'ge', 'target', 80, 'num', dc_ontime, 'den', dc_eval),
    jsonb_build_object('key', 'overdue', 'label', 'نسبة القرارات المتأخرة', 'dir', 'le', 'target', 10, 'num', dc_overdue, 'den', dc_open_due),
    jsonb_build_object('key', 'evidence', 'label', 'قرارات منجزة بأدلة تنفيذ مقبولة' || case when req_ev then '' else ' (غير مشترطة حاليًا)' end, 'dir', 'ge', 'target', 90, 'num', dc_done_ev, 'den', dc_done),
    jsonb_build_object('key', 'quorum', 'label', 'تصويتات مغلقة (ذات نصاب محدد) حقّقت نصابها', 'dir', 'ge', 'target', 100, 'num', v_quorum, 'den', v_closed));
  select coalesce(jsonb_agg(i || jsonb_build_object(
      'value', case when (i->>'den')::int > 0 then round(100.0 * (i->>'num')::int / (i->>'den')::int, 1) end,
      'met', case when (i->>'den')::int = 0 then null
                  when i->>'dir' = 'ge' then 100.0 * (i->>'num')::int / (i->>'den')::int >= (i->>'target')::numeric
                  else 100.0 * (i->>'num')::int / (i->>'den')::int <= (i->>'target')::numeric end)), '[]'::jsonb)
    into ind from jsonb_array_elements(ind) i;

  res := jsonb_build_object(
    'period', jsonb_build_object('from', f, 'to', t),
    'targets_note', 'المستهدفات سياسة افتراضية مقترحة وليست لائحة معتمدة',
    'summary', jsonb_build_object(
      'meetings', mt_n,
      'minutes_approved', (select count(*) from public.minutes x join public.meetings m on m.id = x.meeting_id where x.status = 'معتمد' and m.gregorian_date between f and t),
      'avg_days_to_minute_approval', (select round(avg(x.approved_at::date - m.gregorian_date), 1) from public.minutes x join public.meetings m on m.id = x.meeting_id where x.status = 'معتمد' and m.gregorian_date between f and t),
      'decisions', dc_total, 'decisions_completed', dc_done, 'decisions_overdue', dc_overdue,
      'decisions_open', (select count(*) from public.decisions d where d.status in ('assigned', 'executing', 'awaiting_update', 'returned', 'pending_verification', 'pending_assignment') and d.record_type <> 'recommendation' and coalesce(d.decision_date, d.created_at::date) between f and t),
      'avg_exec_days', (select round(avg(d.completed_at::date - coalesce(d.started_at, d.assigned_at)::date), 1) from public.decisions d where d.status in ('completed', 'closed') and d.record_type <> 'recommendation' and coalesce(d.decision_date, d.created_at::date) between f and t),
      'votes_closed', v_closed, 'attendance_rate', case when att_inv > 0 then round(100.0 * att_ok / att_inv, 1) end),
    'indicators', ind,
    'maturity', jsonb_build_object(
      'measurable', (select count(*) from jsonb_array_elements(ind) i where i->>'met' is not null),
      'met', (select count(*) from jsonb_array_elements(ind) i where i->>'met' = 'true'),
      'score', (select case when count(*) filter (where i->>'met' is not null) > 0 then round(100.0 * count(*) filter (where i->>'met' = 'true') / count(*) filter (where i->>'met' is not null)) end from jsonb_array_elements(ind) i)),
    'by_committee', coalesce((select jsonb_agg(r order by (r->>'meetings')::int desc, r->>'name') from (
      select jsonb_build_object('id', c.id, 'name', c.name,
        'meetings', (select count(*) from public.meetings m where m.committee_id = c.id and m.gregorian_date between f and t),
        'minutes_approved', (select count(*) from public.minutes x join public.meetings m on m.id = x.meeting_id where m.committee_id = c.id and x.status = 'معتمد' and m.gregorian_date between f and t),
        'attendance_rate', (select case when sum(inv) > 0 then round(100.0 * sum(ok) / sum(inv), 1) end from (
            select coalesce(nullif((select count(*) from public.meeting_invitations i where i.meeting_id = m.id), 0), (select count(*) from public.meeting_attendees a where a.meeting_id = m.id)) as inv,
                   (select count(*) from public.meeting_attendees a where a.meeting_id = m.id and a.attendance_status in ('حاضر', 'عن بعد')) as ok
              from public.meetings m where m.committee_id = c.id and m.gregorian_date between f and least(t, current_date)) z),
        'decisions', (select count(*) from public.decisions d where d.committee_id = c.id and d.status not in ('draft', 'pending_approval', 'cancelled') and d.record_type <> 'recommendation' and coalesce(d.decision_date, d.created_at::date) between f and t),
        'completed', (select count(*) from public.decisions d where d.committee_id = c.id and d.status in ('completed', 'closed') and d.record_type <> 'recommendation' and coalesce(d.decision_date, d.created_at::date) between f and t),
        'overdue', (select count(*) from public.decisions d where d.committee_id = c.id and public.dm_is_overdue(d.status, d.due_date) and d.record_type <> 'recommendation' and coalesce(d.decision_date, d.created_at::date) between f and t)) as r
        from public.committees c) q
      where (r->>'meetings')::int > 0 or (r->>'decisions')::int > 0), '[]'::jsonb),
    'monthly', (select coalesce(jsonb_agg(jsonb_build_object('month', to_char(g, 'YYYY-MM'),
        'meetings', (select count(*) from public.meetings m where date_trunc('month', m.gregorian_date) = g),
        'decisions_created', (select count(*) from public.decisions d where d.status not in ('draft', 'cancelled') and d.record_type <> 'recommendation' and date_trunc('month', coalesce(d.decision_date, d.created_at::date)) = g),
        'decisions_completed', (select count(*) from public.decisions d where d.status in ('completed', 'closed') and d.record_type <> 'recommendation' and date_trunc('month', d.completed_at) = g)) order by g), '[]'::jsonb)
      from generate_series(date_trunc('month', t) - interval '11 months', date_trunc('month', t), interval '1 month') g));
  return res;
end $$;

revoke all on function public.exec_dashboard(date, date) from public, anon;
grant execute on function public.exec_dashboard(date, date) to authenticated;

commit;
