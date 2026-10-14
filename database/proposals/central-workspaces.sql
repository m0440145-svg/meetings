begin;
alter table public.schedule_polls add column if not exists meeting_id uuid references public.meetings(id);
alter table public.circular_decisions add column if not exists meeting_id uuid references public.meetings(id);
create function meeting_private.guard_workspace() returns trigger language plpgsql set search_path='' as $$
begin
 if new.meeting_id is null then raise exception 'Meeting is required for operational data'; end if;
 if tg_op='INSERT' and current_user='authenticated' and to_jsonb(new)?'created_by' then new:=jsonb_populate_record(new,jsonb_build_object('created_by',auth.uid())); end if;
 if to_jsonb(new)?'updated_by' then new:=jsonb_populate_record(new,jsonb_build_object('updated_by',auth.uid())); end if;
 if to_jsonb(new)?'updated_at' then new:=jsonb_populate_record(new,jsonb_build_object('updated_at',clock_timestamp())); end if;
 if tg_table_name in ('schedule_polls','circular_decisions') then
  if new.status not in ('مفتوح','مغلق','ملغي') or (tg_op='INSERT' and new.status<>'مفتوح') then raise exception 'Invalid workspace status'; end if;
  if tg_op='UPDATE' and old.status<>'مفتوح' and to_jsonb(new) is distinct from to_jsonb(old) then raise exception 'Closed workspace immutable'; end if;
 end if;
 if tg_op='UPDATE' and (to_jsonb(new)->'id',to_jsonb(new)->'meeting_id',to_jsonb(new)->'created_by') is distinct from (to_jsonb(old)->'id',to_jsonb(old)->'meeting_id',to_jsonb(old)->'created_by') then raise exception 'Workspace scope immutable'; end if;
 return new;
end $$;
do $$declare tab text; begin
 foreach tab in array array['transcripts','whiteboards','schedule_polls','circular_decisions'] loop
 execute format('create trigger workspace_audit after insert or update on public.%I for each row execute function meeting_private.audit_record()',tab);
 execute format('create trigger workspace_scope before insert or update on public.%I for each row execute function meeting_private.guard_workspace()',tab);
 execute format('create policy central_read on public.%I for select to authenticated using(meeting_private.can_read_meeting(meeting_id))',tab);
 execute format('create policy central_read_fence on public.%I as restrictive for select to authenticated using(meeting_private.can_read_meeting(meeting_id))',tab);
 execute format('create policy central_write on public.%I for all to authenticated using(meeting_private.can_manage_meeting(meeting_id)) with check(meeting_private.can_manage_meeting(meeting_id))',tab);
 execute format('create policy central_insert_fence on public.%I as restrictive for insert to authenticated with check(meeting_private.can_manage_meeting(meeting_id))',tab);
 execute format('create policy central_update_fence on public.%I as restrictive for update to authenticated using(meeting_private.can_manage_meeting(meeting_id)) with check(meeting_private.can_manage_meeting(meeting_id))',tab);
 execute format('create policy central_delete_fence on public.%I as restrictive for delete to authenticated using(false)',tab);
 end loop;
end $$;
create function meeting_private.create_poll(mid uuid, title text, options timestamptz[]) returns uuid language plpgsql security definer set search_path='' as $$
declare pid uuid; option_time timestamptz;
begin
 if not meeting_private.can_manage_meeting(mid) then raise exception 'Access denied'; end if;
 if length(trim(title))=0 or coalesce(cardinality(options),0)<2 or cardinality(options)>10 then raise exception 'Title and 2 to 10 options required'; end if;
 insert into public.schedule_polls(title,meeting_id,created_by,status) values(title,mid,auth.uid(),'مفتوح') returning id into pid;
 foreach option_time in array options loop insert into public.schedule_poll_options(poll_id,option_time) values(pid,option_time); end loop;
 perform meeting_private.append_event(mid,'schedule_poll_created',pid);return pid;
end $$;
create function public.create_meeting_poll(p_meeting uuid,p_title text,p_options timestamptz[]) returns uuid language sql security invoker set search_path='' as $$select meeting_private.create_poll(p_meeting,p_title,p_options)$$;
revoke all on function public.create_meeting_poll(uuid,text,timestamptz[]),meeting_private.create_poll(uuid,text,timestamptz[]) from public,anon;
grant execute on function public.create_meeting_poll(uuid,text,timestamptz[]),meeting_private.create_poll(uuid,text,timestamptz[]) to authenticated;
create function meeting_private.option_access(oid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.schedule_poll_options o join public.schedule_polls p on p.id=o.poll_id where o.id=oid and meeting_private.can_read_meeting(p.meeting_id))
$$;
revoke all on function meeting_private.option_access(uuid) from public,anon;
grant execute on function meeting_private.option_access(uuid) to authenticated;
create policy central_options_read on public.schedule_poll_options as restrictive for select to authenticated using(meeting_private.option_access(id));
create policy central_options_no_insert on public.schedule_poll_options as restrictive for insert to authenticated with check(false);
create policy central_options_no_update on public.schedule_poll_options as restrictive for update to authenticated using(false) with check(false);
create policy central_options_no_delete on public.schedule_poll_options as restrictive for delete to authenticated using(false);
create policy central_response_read on public.schedule_poll_responses as restrictive for select to authenticated using(meeting_private.option_access(option_id));
create policy central_response_insert on public.schedule_poll_responses as restrictive for insert to authenticated with check(user_id=auth.uid() and meeting_private.option_access(option_id));
create policy central_response_update on public.schedule_poll_responses as restrictive for update to authenticated using(false) with check(false);
create policy central_response_delete on public.schedule_poll_responses as restrictive for delete to authenticated using(false);
create function meeting_private.response_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare mid uuid; state text;
begin
 if auth.uid() is null or new.user_id<>auth.uid() or meeting_private.actor_role() not in ('member','board_chair','secretary','admin') then raise exception 'Response not authorized'; end if;
 if tg_table_name='schedule_poll_responses' then
  select p.meeting_id,p.status into mid,state from public.schedule_polls p join public.schedule_poll_options o on o.poll_id=p.id where o.id=new.option_id for update of p;
  new.created_at:=clock_timestamp();
 else
  select p.meeting_id,p.status into mid,state from public.circular_decisions p where p.id=new.circular_id for update;
  new.responded_at:=clock_timestamp();
 end if;
 if state is distinct from 'مفتوح' or not meeting_private.can_read_meeting(mid) then raise exception 'Response closed or not authorized'; end if;
 perform meeting_private.append_event(mid,'workspace_response',null);
 return new;
end $$;
create trigger poll_response_guard before insert on public.schedule_poll_responses for each row execute function meeting_private.response_guard();
create trigger circular_response_guard before insert on public.circular_responses for each row execute function meeting_private.response_guard();
create policy central_circular_response_read on public.circular_responses as restrictive for select to authenticated using(exists(select 1 from public.circular_decisions c where c.id=circular_id and meeting_private.can_read_meeting(c.meeting_id)));
create policy central_circular_response_insert on public.circular_responses as restrictive for insert to authenticated with check(user_id=auth.uid() and exists(select 1 from public.circular_decisions c where c.id=circular_id and meeting_private.can_read_meeting(c.meeting_id)));
create policy central_circular_response_update on public.circular_responses as restrictive for update to authenticated using(false) with check(false);
create policy central_circular_response_delete on public.circular_responses as restrictive for delete to authenticated using(false);
-- Only the actual administrator may change configuration. Values do not activate providers.
create policy central_settings_write on public.app_settings as restrictive for all to authenticated using(meeting_private.actor_role()='admin') with check(meeting_private.actor_role()='admin');
create policy central_poll_response_visible on public.schedule_poll_responses for select to authenticated using(meeting_private.option_access(option_id));
create policy central_circular_response_visible on public.circular_responses for select to authenticated using(exists(select 1 from public.circular_decisions c where c.id=circular_id and meeting_private.can_read_meeting(c.meeting_id)));
commit;
