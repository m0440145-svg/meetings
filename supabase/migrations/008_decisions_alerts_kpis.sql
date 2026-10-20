-- إدارة القرارات — 008: التنبيهات والتصعيد (cron)، مؤشرات الأداء KPI، تفاصيل القرار، تقرير الاجتماع السابق، إصدار التقارير.
-- يعتمد على 007. دوال القراءة (kpis/detail/previous) SECURITY INVOKER فتحترم RLS: كل مستخدم يرى أرقامه ضمن ما يحق له الاطلاع عليه فقط.
-- سياسة احتساب المؤشرات (موثّقة في docs/نظام-القرارات/05-المؤشرات-والتقارير.md):
--   * تُستبعد المسودات وبانتظار الاعتماد والملغاة والتوصيات غير المصدَّق عليها. القرار "مستحق" إذا بلغ تاريخ استحقاقه.
--   * الالتزام بالموعد يُقاس بالموعد المعتمد الحالي افتراضيًا (setting measure_against = current)، أو بالموعد الأصلي (original)، ويُعرض الاثنان معًا.

begin;

create or replace function public.dm_setting_num(p_key text, p_default numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select (value)::text::numeric from public.dm_settings where key = p_key and jsonb_typeof(value) = 'number'), p_default);
$$;

-- ───────────── التنبيهات والتصعيد ─────────────
create or replace function public.dm_alert_once(p_decision uuid, p_kind text, p_due date) returns boolean
language plpgsql security definer set search_path = public as $$
declare rc int;
begin
  insert into public.decision_alerts(decision_id, kind, due_date) values (p_decision, p_kind, p_due) on conflict do nothing;
  get diagnostics rc = row_count;
  return rc > 0;
end $$;

-- يُستدعى يوميًا من cron. يرسل التذكيرات قبل الاستحقاق، وتنبيه التأخر، والتصعيد بحسب الإعدادات، ويُدرج المتأخر في تقرير خاص، ويحوّل ما لم يُحدَّث إلى "بانتظار تحديث".
create or replace function public.dm_run_alerts() returns int
language plpgsql security definer set search_path = public as $$
declare d public.decisions%rowtype; n int := 0; days_left int; late int; r int; rule jsonb; kind text; recips uuid[]; unit public.org_units%rowtype; parent public.org_units%rowtype;
        stale int := public.dm_setting_num_safe();
begin
  perform set_config('app.dm_rpc', 'on', true);
  for d in select * from public.decisions where status in ('assigned', 'executing', 'awaiting_update', 'returned', 'pending_verification') and due_date is not null loop
    days_left := d.due_date - current_date;
    -- تذكيرات قبل الاستحقاق ويوم الاستحقاق
    for r in select (value)::text::int from jsonb_array_elements(coalesce(public.dm_setting('reminder_days'), '[]')) loop
      if days_left = r and public.dm_alert_once(d.id, 'reminder_' || r, d.due_date) then
        perform public.dm_notify(array[d.owner_id] || coalesce((select array_agg(user_id) from public.decision_assistants where decision_id = d.id), '{}'),
          case when r = 0 then 'اليوم موعد استحقاق قرار' else 'تذكير بموعد استحقاق قرار' end,
          d.ref_no || ' — ' || d.title || case when r = 0 then ' (اليوم)' else ' — بعد ' || r || ' أيام' end);
        perform public.dm_log(d.id, 'alert', d.status, d.status, jsonb_build_object('kind', 'reminder', 'days_left', r));
        n := n + 1;
      end if;
    end loop;
    if days_left < 0 then
      late := -days_left;
      for r in select (value)::text::int from jsonb_array_elements(coalesce(public.dm_setting('late_alert_days'), '[]')) loop
        if late = r and public.dm_alert_once(d.id, 'late_' || r, d.due_date) then
          perform public.dm_notify(array[d.owner_id] || public.dm_role_holders('secretary', d.committee_id), 'تأخر تنفيذ قرار',
            d.ref_no || ' — ' || d.title || ' — متأخر ' || late || ' يوم');
          perform public.dm_log(d.id, 'alert', d.status, d.status, jsonb_build_object('kind', 'late', 'days_late', late));
          n := n + 1;
        end if;
      end loop;
      -- التصعيد: unit_head = رئيس الإدارة المكلفة + أمين السر، upper = الإدارة الأعلى + رئيس الجهة + الحوكمة
      for rule in select value from jsonb_array_elements(coalesce(public.dm_setting('escalation'), '[]')) loop
        continue when late < (rule->>'days')::int;
        kind := 'esc_' || (rule->>'days');
        if public.dm_alert_once(d.id, kind, d.due_date) then
          select * into unit from public.org_units where id = d.responsible_unit_id;
          if (rule->>'level') = 'unit_head' then
            recips := array[unit.head_user_id] || public.dm_role_holders('secretary', d.committee_id);
          else
            select * into parent from public.org_units where id = unit.parent_id;
            recips := array[parent.head_user_id] || public.dm_role_holders('chair', d.committee_id) || public.dm_role_holders('governance', d.committee_id);
          end if;
          perform public.dm_notify(recips, 'تصعيد: قرار متأخر ' || late || ' يوم', d.ref_no || ' — ' || d.title || ' — المسؤول: ' || coalesce((select full_name from public.profiles where id = d.owner_id), ''));
          perform public.dm_log(d.id, 'escalation', d.status, d.status, jsonb_build_object('level', rule->>'level', 'days_late', late));
          n := n + 1;
        end if;
      end loop;
      -- استمرار التأخر: يُدرج في التقرير الخاص بالمجلس أو اللجنة
      if late >= coalesce(public.dm_setting_num('report_escalation_days', 21), 21) and not d.escalated_to_report then
        update public.decisions set escalated_to_report = true where id = d.id;
        perform public.dm_alert_once(d.id, 'report', d.due_date);
        perform public.dm_log(d.id, 'escalation', d.status, d.status, jsonb_build_object('level', 'report', 'days_late', late));
        perform public.dm_notify(public.dm_role_holders('chair', d.committee_id) || public.dm_role_holders('secretary', d.committee_id), 'قرار أُدرج في تقرير التأخر الخاص', d.ref_no || ' — ' || d.title);
        n := n + 1;
      end if;
    end if;
  end loop;
  -- جارٍ التنفيذ دون تحديث منذ مدة → بانتظار تحديث
  for d in select * from public.decisions where status = 'executing' and coalesce(last_update_at, assigned_at) < now() - make_interval(days => stale) loop
    perform public.dm_move(d.id, 'awaiting_update', 'auto_awaiting_update', jsonb_build_object('stale_days', stale));
    perform public.dm_notify(array[d.owner_id], 'قرار بانتظار تحديث', d.ref_no || ' — لم يُحدَّث منذ ' || stale || ' يومًا');
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.dm_setting_num_safe() returns int language sql stable security definer set search_path = public as $$
  select coalesce(public.dm_setting_num('stale_days', 14), 14)::int;
$$;

-- تشغيل يدوي للمخوّلين (الإعدادات أو الحوكمة)
create or replace function public.dm_run_alerts_manual() returns int
language plpgsql security definer set search_path = public as $$
begin
  if not (public.dm_has_perm(auth.uid(), 'manage_settings') or public.dm_has_perm(auth.uid(), 'audit_read')) then raise exception 'لا تملك صلاحية تشغيل التنبيهات'; end if;
  return public.dm_run_alerts();
end $$;

-- ───────────── مؤشرات الأداء ─────────────
create or replace function public.dm_kpis(p jsonb default '{}') returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare res jsonb; basis text := coalesce(trim(both '"' from (public.dm_setting('measure_against'))::text), 'current');
begin
  with b as (
    select d.*, case when basis = 'original' then coalesce(d.original_due_date, d.due_date) else d.due_date end as due_basis,
           coalesce(d.original_due_date, d.due_date) as due_orig
      from public.decisions d
     where d.status not in ('draft', 'pending_approval', 'cancelled') and d.record_type <> 'recommendation' and public.dm_can_view(auth.uid(), d.id)
       and (nullif(p->>'committee_id', '') is null or d.committee_id = (p->>'committee_id')::uuid)
       and (nullif(p->>'unit_id', '') is null or d.responsible_unit_id = (p->>'unit_id')::uuid)
       and (nullif(p->>'owner_id', '') is null or d.owner_id = (p->>'owner_id')::uuid)
       and (nullif(p->>'priority', '') is null or d.priority = p->>'priority')
       and (nullif(p->>'status', '') is null or d.status = p->>'status')
       and (nullif(p->>'record_type', '') is null or d.record_type = p->>'record_type')
       and (nullif(p->>'body_kind', '') is null or d.body_kind = p->>'body_kind')
       and (nullif(p->>'from', '') is null or d.decision_date >= (p->>'from')::date)
       and (nullif(p->>'to', '') is null or d.decision_date <= (p->>'to')::date)
       and (nullif(p->>'year', '') is null or extract(year from d.decision_date) = (p->>'year')::int)
  ), cnt as (
    select count(*) as total,
           count(*) filter (where status in ('assigned', 'executing', 'awaiting_update', 'returned', 'pending_verification')) as in_exec,
           count(*) filter (where status in ('executing', 'awaiting_update')) as executing,
           count(*) filter (where status in ('completed', 'closed')) as completed,
           count(*) filter (where status = 'closed') as closed,
           count(*) filter (where status = 'pending_verification') as pending_verification,
           count(*) filter (where public.dm_is_overdue(status, due_date)) as overdue,
           count(*) filter (where priority in ('high', 'critical') and status <> 'closed') as high_priority_open,
           count(*) filter (where status = 'pending_assignment') as pending_assignment,
           coalesce(round(avg(case when status in ('completed', 'closed') then 100 else progress_pct end)), 0) as overall_progress,
           count(*) filter (where due_date is not null and due_date <= current_date) as due_total,
           count(*) filter (where due_date is not null and due_date <= current_date and status in ('completed', 'closed')) as due_done,
           count(*) filter (where status in ('assigned', 'executing', 'awaiting_update', 'returned', 'pending_verification') and due_date <= current_date) as open_due,
           count(*) filter (where status in ('completed', 'closed') or public.dm_is_overdue(status, due_basis)) as eval_current,
           count(*) filter (where status in ('completed', 'closed') and completed_at::date <= due_basis) as ontime_current,
           count(*) filter (where status in ('completed', 'closed') or public.dm_is_overdue(status, due_orig)) as eval_orig,
           count(*) filter (where status in ('completed', 'closed') and completed_at::date <= due_orig) as ontime_orig,
           round(avg(completed_at::date - coalesce(started_at, assigned_at)::date) filter (where status in ('completed', 'closed')), 1) as avg_exec_days,
           round(avg(closed_at::date - assigned_at::date) filter (where status = 'closed'), 1) as avg_close_days
      from b
  )
  select jsonb_build_object(
    'policy', jsonb_build_object('measure_against', basis, 'excluded', jsonb_build_array('draft', 'pending_approval', 'cancelled', 'unratified_recommendation')),
    'cards', jsonb_build_object('total', cnt.total, 'approved', cnt.total, 'in_execution', cnt.in_exec, 'executing', cnt.executing, 'completed', cnt.completed, 'closed', cnt.closed,
      'overdue', cnt.overdue, 'pending_verification', cnt.pending_verification, 'pending_assignment', cnt.pending_assignment, 'high_priority_open', cnt.high_priority_open,
      'overall_progress', cnt.overall_progress),
    'rates', jsonb_build_object(
      'completion_rate', case when cnt.due_total > 0 then round(100.0 * cnt.due_done / cnt.due_total, 1) end,
      'ontime_rate', case when cnt.eval_current > 0 then round(100.0 * cnt.ontime_current / cnt.eval_current, 1) end,
      'ontime_rate_original', case when cnt.eval_orig > 0 then round(100.0 * cnt.ontime_orig / cnt.eval_orig, 1) end,
      'overdue_rate', case when cnt.open_due > 0 then round(100.0 * cnt.overdue / cnt.open_due, 1) end,
      'closure_rate', case when cnt.completed > 0 then round(100.0 * cnt.closed / cnt.completed, 1) end,
      'avg_exec_days', cnt.avg_exec_days, 'avg_close_days', cnt.avg_close_days,
      'denominators', jsonb_build_object('due', cnt.due_total, 'open_due', cnt.open_due, 'evaluated', cnt.eval_current, 'evaluated_original', cnt.eval_orig, 'completed', cnt.completed),
      'numerators', jsonb_build_object('due_done', cnt.due_done, 'overdue', cnt.overdue, 'ontime', cnt.ontime_current, 'ontime_original', cnt.ontime_orig, 'closed', cnt.closed)),
    'by_status', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from b group by status) s),
    'by_priority', (select coalesce(jsonb_object_agg(priority, n), '{}') from (select priority, count(*) n from b group by priority) s),
    'by_committee', (select coalesce(jsonb_agg(jsonb_build_object('committee_id', committee_id, 'name', name, 'total', total, 'completed', done, 'overdue', late) order by total desc), '[]')
                       from (select b.committee_id, c.name, count(*) total, count(*) filter (where b.status in ('completed', 'closed')) done, count(*) filter (where public.dm_is_overdue(b.status, b.due_date)) late
                               from b join public.committees c on c.id = b.committee_id group by b.committee_id, c.name) s),
    'by_unit', (select coalesce(jsonb_agg(jsonb_build_object('unit_id', unit_id, 'name', name, 'total', total, 'completed', done, 'overdue', late, 'avg_progress', prog) order by total desc), '[]')
                  from (select b.responsible_unit_id unit_id, coalesce(u.name, 'غير مسند') as name, count(*) total, count(*) filter (where b.status in ('completed', 'closed')) done,
                               count(*) filter (where public.dm_is_overdue(b.status, b.due_date)) late,
                               round(avg(case when b.status in ('completed', 'closed') then 100 else b.progress_pct end)) prog
                          from b left join public.org_units u on u.id = b.responsible_unit_id group by b.responsible_unit_id, u.name) s),
    'monthly', (select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'),
                  'due', (select count(*) from b where date_trunc('month', b.due_date) = m),
                  'completed_on_time', (select count(*) from b where date_trunc('month', b.due_date) = m and b.status in ('completed', 'closed') and b.completed_at::date <= b.due_basis),
                  'completed_late', (select count(*) from b where date_trunc('month', b.due_date) = m and b.status in ('completed', 'closed') and b.completed_at::date > b.due_basis),
                  'open_overdue', (select count(*) from b where date_trunc('month', b.due_date) = m and public.dm_is_overdue(b.status, b.due_date)),
                  'completed_in_month', (select count(*) from b where date_trunc('month', b.completed_at) = m)) order by m), '[]')
                  from generate_series(date_trunc('month', current_date) - interval '11 months', date_trunc('month', current_date), interval '1 month') m)
  ) into res from cnt;
  return res;
end $$;

-- ───────────── تفاصيل القرار (حزمة واحدة + ما يحق للمستخدم فعله) ─────────────
create or replace function public.dm_decision_detail(p_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare d public.decisions%rowtype; uid uuid := auth.uid();
begin
  select * into d from public.decisions where id = p_id;
  if not found then return null; end if;
  return jsonb_build_object(
    'decision', to_jsonb(d) || jsonb_build_object(
      'committee_name', (select name from public.committees where id = d.committee_id),
      'meeting_title', (select title from public.meetings where id = d.meeting_id),
      'unit_name', (select name from public.org_units where id = d.responsible_unit_id),
      'owner_name', (select full_name from public.profiles where id = d.owner_id),
      'creator_name', (select full_name from public.profiles where id = d.created_by),
      'approver_name', (select full_name from public.profiles where id = d.approved_by),
      'is_overdue', public.dm_is_overdue(d.status, d.due_date),
      'days_late', case when public.dm_is_overdue(d.status, d.due_date) then current_date - d.due_date end),
    'assistants', (select coalesce(jsonb_agg(jsonb_build_object('user_id', a.user_id, 'name', p.full_name)), '[]') from public.decision_assistants a join public.profiles p on p.id = a.user_id where a.decision_id = p_id),
    'actions', (select coalesce(jsonb_agg(to_jsonb(x) || jsonb_build_object('owner_name', (select full_name from public.profiles where id = x.owner_id), 'unit_name', (select name from public.org_units where id = x.unit_id)) order by x.created_at), '[]') from public.decision_actions x where x.decision_id = p_id),
    'updates', (select coalesce(jsonb_agg(to_jsonb(u) || jsonb_build_object('author', (select full_name from public.profiles where id = u.created_by)) order by u.created_at desc), '[]') from (select * from public.decision_updates where decision_id = p_id order by created_at desc limit 100) u),
    'evidence', (select coalesce(jsonb_agg(to_jsonb(e) || jsonb_build_object('uploader', (select full_name from public.profiles where id = e.uploaded_by)) order by e.uploaded_at desc), '[]') from public.decision_evidence e where e.decision_id = p_id),
    'verifications', (select coalesce(jsonb_agg(to_jsonb(v) order by v.requested_at desc), '[]') from public.decision_verifications v where v.decision_id = p_id),
    'extensions', (select coalesce(jsonb_agg(to_jsonb(x) || jsonb_build_object('requester', (select full_name from public.profiles where id = x.requested_by)) order by x.requested_at desc), '[]') from public.decision_extensions x where x.decision_id = p_id),
    'directives', (select coalesce(jsonb_agg(to_jsonb(x) || jsonb_build_object('author', (select full_name from public.profiles where id = x.created_by)) order by x.created_at desc), '[]') from public.decision_directives x where x.decision_id = p_id),
    'versions', (select coalesce(jsonb_agg(to_jsonb(v) order by v.version), '[]') from public.decision_text_versions v where v.decision_id = p_id),
    'events', (select coalesce(jsonb_agg(to_jsonb(e) || jsonb_build_object('actor', (select full_name from public.profiles where id = e.actor_id)) order by e.id), '[]') from public.decision_events e where e.decision_id = p_id),
    'can', jsonb_build_object(
      'edit_draft', d.status = 'draft' and (public.dm_has_perm(uid, 'edit_draft', p_id) or (d.created_by = uid and public.dm_has_perm(uid, 'create', p_id))),
      'submit', d.status = 'draft' and public.dm_has_perm(uid, 'submit', p_id),
      'approve', d.status = 'pending_approval' and public.dm_has_perm(uid, 'approve', p_id),
      'ratify', d.status = 'approved' and d.record_type = 'recommendation' and public.dm_has_perm(uid, 'ratify', p_id),
      'assign', d.status = 'pending_assignment' and public.dm_has_perm(uid, 'assign', p_id),
      'reassign', d.status in ('assigned', 'executing', 'awaiting_update', 'returned', 'pending_verification') and public.dm_has_perm(uid, 'reassign', p_id),
      'update', d.status in ('assigned', 'executing', 'awaiting_update', 'returned') and public.dm_has_perm(uid, 'update', p_id),
      'note', d.status in ('assigned', 'executing', 'awaiting_update', 'returned', 'pending_verification', 'completed') and (public.dm_has_perm(uid, 'add_note', p_id) or public.dm_has_perm(uid, 'update', p_id)),
      'upload', d.status in ('assigned', 'executing', 'awaiting_update', 'returned') and public.dm_has_perm(uid, 'upload_evidence', p_id),
      'request_verification', d.status in ('assigned', 'executing', 'awaiting_update', 'returned') and public.dm_has_perm(uid, 'request_verification', p_id),
      'review_evidence', public.dm_has_perm(uid, 'review_evidence', p_id),
      'verify', d.status = 'pending_verification' and public.dm_has_perm(uid, 'verify', p_id),
      'close', d.status = 'completed' and public.dm_has_perm(uid, 'close', p_id),
      'cancel', d.status not in ('closed', 'cancelled') and public.dm_has_perm(uid, 'cancel', p_id),
      'extend', d.status in ('assigned', 'executing', 'awaiting_update', 'returned', 'pending_verification') and public.dm_has_perm(uid, 'request_extension', p_id),
      'decide_extension', public.dm_has_perm(uid, 'approve_extension', p_id) or public.dm_has_perm(uid, 'approve_extension_limited', p_id),
      'direct', d.status not in ('draft', 'cancelled') and public.dm_has_perm(uid, 'direct', p_id),
      'amend', d.status not in ('draft', 'closed', 'cancelled') and public.dm_has_perm(uid, 'amend', p_id),
      'add_reference', d.status not in ('closed', 'cancelled') and (public.dm_has_perm(uid, 'edit_draft', p_id) or public.dm_has_perm(uid, 'create', p_id) or public.dm_has_perm(uid, 'amend', p_id)),
      'add_action', d.status in ('assigned', 'executing', 'awaiting_update', 'returned') and (public.dm_has_perm(uid, 'add_action', p_id) or public.dm_has_perm(uid, 'update', p_id))));
end $$;

-- ───────────── متابعة قرارات الاجتماعات السابقة ─────────────
create or replace function public.dm_previous_report(p_meeting uuid) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare m public.meetings%rowtype; res jsonb;
begin
  select * into m from public.meetings where id = p_meeting;
  if not found then raise exception 'الاجتماع غير موجود'; end if;
  select jsonb_build_object(
    'meeting', jsonb_build_object('id', m.id, 'title', m.title, 'date', m.gregorian_date),
    'summary', jsonb_build_object('total', count(*), 'closed', count(*) filter (where d.status = 'closed'), 'completed', count(*) filter (where d.status = 'completed'),
        'in_progress', count(*) filter (where d.status in ('assigned', 'executing', 'awaiting_update', 'returned', 'pending_verification')),
        'overdue', count(*) filter (where public.dm_is_overdue(d.status, d.due_date)), 'pending_assignment', count(*) filter (where d.status = 'pending_assignment')),
    'items', coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'ref_no', d.ref_no, 'title', d.title, 'status', d.status, 'priority', d.priority, 'progress', d.progress_pct,
        'due_date', d.due_date, 'original_due_date', d.original_due_date, 'extension_count', d.extension_count, 'is_overdue', public.dm_is_overdue(d.status, d.due_date),
        'days_late', case when public.dm_is_overdue(d.status, d.due_date) then current_date - d.due_date end,
        'owner', (select full_name from public.profiles where id = d.owner_id), 'unit', (select name from public.org_units where id = d.responsible_unit_id),
        'last_blocker', (select body from public.decision_updates u where u.decision_id = d.id and u.kind = 'blocker' order by u.created_at desc limit 1),
        'last_update_at', d.last_update_at, 'meeting_no', d.meeting_no, 'decision_date', d.decision_date) order by d.decision_date, d.ref_no), '[]'))
    into res
    from public.decisions d
   where d.committee_id = m.committee_id and d.status not in ('draft', 'pending_approval', 'cancelled') and d.record_type <> 'recommendation' and public.dm_can_view(auth.uid(), d.id)
     and d.meeting_id is distinct from m.id and coalesce(d.decision_date, d.created_at::date) <= coalesce(m.gregorian_date, current_date)
     and (d.status <> 'closed' or d.closed_at::date >= coalesce(m.gregorian_date, current_date) - 90);   -- المقفل يظهر لو أُقفل خلال 90 يومًا قبل الاجتماع
  return res;
end $$;

-- إضافة بند "متابعة تنفيذ قرارات الاجتماعات السابقة" إلى جدول أعمال اجتماع جديد (لمنظّم الاجتماع أو من يملك صلاحية)
create or replace function public.dm_add_followup_agenda(p_meeting uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare m public.meetings%rowtype; has int;
begin
  select * into m from public.meetings where id = p_meeting;
  if not found then raise exception 'الاجتماع غير موجود'; end if;
  if not (m.created_by = auth.uid() or public.is_admin() or public.dm_has_perm(auth.uid(), 'create', null, m.committee_id)) then raise exception 'لا تملك صلاحية تعديل جدول الأعمال'; end if;
  select count(*) into has from public.agenda_items where meeting_id = p_meeting and title like 'متابعة تنفيذ قرارات%';
  if has > 0 then return false; end if;
  update public.agenda_items set item_order = item_order + 1 where meeting_id = p_meeting;
  insert into public.agenda_items(meeting_id, item_order, title, duration_minutes) values (p_meeting, 1, 'متابعة تنفيذ قرارات الاجتماعات السابقة', 15);
  return true;
end $$;

-- ───────────── إصدار التقارير (رقم إصدار + لقطة بيانات محفوظة) ─────────────
create or replace function public.dm_issue_report(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); cid uuid := nullif(p->>'committee_id', '')::uuid; y int := extract(year from current_date)::int; seq int; rno text; k jsonb; rows jsonb; res jsonb; rid uuid;
        cname text; gname text; due_rows jsonb; done_rows jsonb; attn jsonb; recs jsonb := '[]'; cards jsonb; rates jsonb; late_rate numeric; ont numeric;
begin
  if not public.dm_has_perm(uid, 'export', null, cid) then raise exception 'لا تملك صلاحية إصدار التقارير'; end if;
  k := public.dm_kpis(p); cards := k->'cards'; rates := k->'rates';
  select name into cname from public.committees where id = cid;
  select full_name into gname from public.profiles where id = uid;
  with b as (
    select d.* from public.decisions d where d.status not in ('draft', 'pending_approval', 'cancelled') and d.record_type <> 'recommendation' and public.dm_can_view(uid, d.id)
       and (cid is null or d.committee_id = cid)
       and (nullif(p->>'unit_id', '') is null or d.responsible_unit_id = (p->>'unit_id')::uuid)
       and (nullif(p->>'from', '') is null or d.decision_date >= (p->>'from')::date) and (nullif(p->>'to', '') is null or d.decision_date <= (p->>'to')::date)
  )
  select coalesce(jsonb_agg(jsonb_build_object('ref_no', ref_no, 'title', title, 'decision_date', decision_date, 'owner', (select full_name from public.profiles where id = b.owner_id),
           'unit', (select name from public.org_units where id = b.responsible_unit_id), 'due_date', due_date, 'original_due_date', original_due_date, 'progress', progress_pct,
           'status', status, 'last_update_at', last_update_at, 'priority', priority) order by decision_date, ref_no), '[]') into rows from b;
  select coalesce(jsonb_agg(x), '[]') into due_rows from (
    select jsonb_build_object('ref_no', d.ref_no, 'title', d.title, 'owner', (select full_name from public.profiles where id = d.owner_id), 'days_late', current_date - d.due_date,
           'reason', (select body from public.decision_updates u where u.decision_id = d.id and u.kind = 'blocker' order by u.created_at desc limit 1),
           'corrective', (select body from public.decision_updates u where u.decision_id = d.id and u.kind = 'corrective' order by u.created_at desc limit 1),
           'proposed_due', (select requested_due from public.decision_extensions e where e.decision_id = d.id and e.status = 'pending' limit 1), 'escalated', d.escalated_to_report) x
      from public.decisions d where public.dm_can_view(uid, d.id) and public.dm_is_overdue(d.status, d.due_date) and (cid is null or d.committee_id = cid) and d.record_type <> 'recommendation'
       and (nullif(p->>'unit_id', '') is null or d.responsible_unit_id = (p->>'unit_id')::uuid)
     order by d.due_date) s;
  select coalesce(jsonb_agg(x), '[]') into done_rows from (
    select jsonb_build_object('ref_no', d.ref_no, 'title', d.title, 'completed_at', d.completed_at, 'closed_at', d.closed_at, 'status', d.status,
           'evidence_count', (select count(*) from public.decision_evidence e where e.decision_id = d.id and e.review_status = 'accepted'),
           'verified_by', (select full_name from public.profiles where id = (select reviewer_id from public.decision_verifications v where v.decision_id = d.id and v.status = 'approved' order by reviewed_at desc limit 1))) x
      from public.decisions d where public.dm_can_view(uid, d.id) and d.status in ('completed', 'closed') and (cid is null or d.committee_id = cid) and d.record_type <> 'recommendation'
       and (nullif(p->>'from', '') is null or d.completed_at::date >= (p->>'from')::date) and (nullif(p->>'to', '') is null or d.completed_at::date <= (p->>'to')::date)
     order by d.completed_at desc) s;
  select coalesce(jsonb_agg(x), '[]') into attn from (
    select jsonb_build_object('ref_no', d.ref_no, 'title', d.title, 'reason',
             case when exists (select 1 from public.decision_extensions e where e.decision_id = d.id and e.status = 'pending') then 'طلب تمديد بانتظار قرار'
                  when public.dm_is_overdue(d.status, d.due_date) and current_date - d.due_date >= 14 then 'تأخر ' || (current_date - d.due_date) || ' يومًا ويحتاج توجيهًا'
                  when d.extension_count >= 2 then 'مُدّد ' || d.extension_count || ' مرات'
                  else 'عائق مسجَّل' end) x
      from public.decisions d where public.dm_can_view(uid, d.id) and (cid is null or d.committee_id = cid) and d.status in ('assigned', 'executing', 'awaiting_update', 'returned', 'pending_verification') and d.record_type <> 'recommendation'
       and (exists (select 1 from public.decision_extensions e where e.decision_id = d.id and e.status = 'pending')
         or (public.dm_is_overdue(d.status, d.due_date) and current_date - d.due_date >= 14) or d.extension_count >= 2
         or (select u.kind from public.decision_updates u where u.decision_id = d.id order by u.created_at desc limit 1) = 'blocker')) s;
  late_rate := (rates->>'overdue_rate')::numeric; ont := (rates->>'ontime_rate')::numeric;
  if late_rate is not null and late_rate > 20 then recs := recs || to_jsonb('ارتفاع نسبة المتأخر (' || late_rate || '%): يُوصى بمراجعة القرارات المتأخرة في الاجتماع القادم وتفعيل التصعيد.'::text); end if;
  if ont is not null and ont < 70 then recs := recs || to_jsonb('الالتزام بالمواعيد دون المستهدف (' || ont || '%): يُوصى بمراجعة واقعية المدد عند الإسناد.'::text); end if;
  if (cards->>'pending_verification')::int > 0 then recs := recs || to_jsonb('يوجد ' || (cards->>'pending_verification') || ' قرارًا بانتظار اعتماد الإنجاز: يُوصى بسرعة البت فيها.'::text); end if;
  if (cards->>'pending_assignment')::int > 0 then recs := recs || to_jsonb('يوجد ' || (cards->>'pending_assignment') || ' قرارًا معتمدًا لم يُسنَد بعد: يُوصى بإسنادها وتحديد مواعيدها.'::text); end if;
  if jsonb_array_length(attn) > 0 then recs := recs || to_jsonb('توجد ' || jsonb_array_length(attn) || ' قرارات تحتاج توجيهًا من المجلس أو اللجنة (تمديد، تأخر طويل، أو عوائق).'::text); end if;
  if jsonb_array_length(recs) = 0 then recs := to_jsonb(array['لا توجد توصيات عاجلة: استمر على الوتيرة الحالية وراجع المؤشرات دوريًا.']); end if;
  insert into public.dm_counters(key, year, last) values ('report', y, 1) on conflict (key, year) do update set last = public.dm_counters.last + 1 returning last into seq;
  rno := 'RPT-' || y || '-' || lpad(seq::text, 4, '0');
  res := jsonb_build_object('report_no', rno, 'title', 'تقرير متابعة تنفيذ قرارات مجلس الإدارة واللجان',
    'meta', jsonb_build_object('body_name', coalesce(cname, 'جميع المجالس واللجان'), 'from', p->>'from', 'to', p->>'to', 'generated_at', now(), 'generated_by', gname),
    'summary', jsonb_build_object('cards', cards, 'rates', rates), 'decisions', rows, 'overdue', due_rows, 'completed', done_rows, 'attention', attn, 'recommendations', recs,
    'policy', k->'policy');
  insert into public.dm_reports(report_no, filters, data) values (rno, p, res) returning id into rid;
  return res || jsonb_build_object('id', rid);
end $$;

-- ───────────── الصلاحيات والجدولة ─────────────
revoke execute on function public.dm_run_alerts(), public.dm_alert_once(uuid, text, date), public.dm_setting_num(text, numeric), public.dm_setting_num_safe() from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['dm_run_alerts_manual()', 'dm_kpis(jsonb)', 'dm_decision_detail(uuid)', 'dm_previous_report(uuid)', 'dm_add_followup_agenda(uuid)', 'dm_issue_report(jsonb)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- القرارات المنهية أو المعتمدة تظهر أيضًا في تدقيق التقارير
do $$
begin
  if to_regprocedure('public.audit_trg()') is not null then
    drop trigger if exists trg_audit on public.dm_reports;
    create trigger trg_audit after insert on public.dm_reports for each row execute function public.audit_trg();
  end if;
end $$;

-- التنبيهات اليومية: 06:00 بتوقيت الرياض (03:00 UTC). تتطلب تفعيل pg_cron من لوحة Supabase
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'dm-alerts') then perform cron.unschedule('dm-alerts'); end if;
    perform cron.schedule('dm-alerts', '0 3 * * *', 'select public.dm_run_alerts()');
  else
    raise notice 'pg_cron غير مفعّلة: فعّلها ثم أعد تنفيذ هذا الجزء، أو شغّل dm_run_alerts() بجدولة خارجية.';
  end if;
end $$;

commit;
