-- دالة إرسال الدعوات فقط (مقتطعة من الترحيل 001 لتعمل دون بقية 001).
-- تعتمد على: is_admin() ، وجداول meetings و committee_members و profiles و meeting_invitations و delivery_jobs و notifications.
-- آمنة لإعادة التنفيذ.
begin;

create or replace function public.send_meeting_invitations(p_meeting uuid) returns int
language plpgsql security definer set search_path = public as $$
declare m public.meetings%rowtype; uid uuid := auth.uid(); r record; n int := 0;
begin
  select * into m from public.meetings where id = p_meeting;
  if not found then raise exception 'الاجتماع غير موجود'; end if;
  if not (public.is_admin() or m.created_by = uid) then raise exception 'لا تملك صلاحية إرسال الدعوات'; end if;
  for r in
    select distinct cm.user_id, p.phone
      from public.committee_members cm
      join public.profiles p on p.id = cm.user_id
     where cm.committee_id = m.committee_id
       and not exists (select 1 from public.meeting_invitations i
                       where i.meeting_id = p_meeting and i.user_id = cm.user_id)
  loop
    insert into public.meeting_invitations(meeting_id, user_id, phone, status, created_by)
    values (p_meeting, r.user_id, r.phone, 'مجدولة', uid);
    if r.phone is not null then
      insert into public.delivery_jobs(channel, recipient, template, payload, status)
      values ('whatsapp', r.phone, 'meeting_invitation',
              jsonb_build_object('meeting_id', p_meeting, 'title', m.title, 'date', m.gregorian_date, 'time', m.start_time),
              'pending');
    end if;
    insert into public.notifications(user_id, title, body)
    values (r.user_id, 'دعوة اجتماع', m.title || ' — ' || m.gregorian_date || ' ' || coalesce(m.start_time::text, ''));
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function public.send_meeting_invitations(uuid) from public, anon;
grant execute on function public.send_meeting_invitations(uuid) to authenticated;

commit;
