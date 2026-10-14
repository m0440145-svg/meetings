-- Candidate: requires existing application schema. Validate on hosted staging before production.
BEGIN;
-- Staging candidate; promote via Supabase CLI migration after hosted acceptance.
-- Additive restrictions: does not remove records or existing policies.

create schema if not exists meeting_private;
revoke all on schema meeting_private from public;
grant usage on schema meeting_private to authenticated;
create or replace function meeting_private.actor_role() returns text
language sql stable security definer set search_path = '' as $$
 select p.role from public.profiles p where p.id = auth.uid() and p.is_active is true
$$;
revoke all on function meeting_private.actor_role() from public;
grant execute on function meeting_private.actor_role() to authenticated;

create or replace function meeting_private.can_read_meeting(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select auth.uid() is not null and meeting_private.actor_role() is not null and exists (
 select 1 from public.meetings m where m.id=target and (
 meeting_private.actor_role()='admin' or m.created_by=auth.uid()
 or exists(select 1 from public.meeting_attendees a where a.meeting_id=m.id and a.user_id=auth.uid())
 or exists(select 1 from public.committee_members c where c.committee_id=m.committee_id and c.user_id=auth.uid())))
$$;
create or replace function meeting_private.can_manage_meeting(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select meeting_private.can_read_meeting(target) and meeting_private.actor_role() in ('admin','board_chair','secretary')
$$;
revoke all on function meeting_private.can_read_meeting(uuid), meeting_private.can_manage_meeting(uuid) from public;
grant execute on function meeting_private.can_read_meeting(uuid), meeting_private.can_manage_meeting(uuid) to authenticated;

create or replace function meeting_private.protect_profile() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
 if current_user in ('anon','authenticated') then
   if tg_op='INSERT' then
     raise exception 'Account provisioning requires a trusted administrator' using errcode='42501';
   end if;
   if (new.id,new.role,new.role_code,new.is_active) is distinct from (old.id,old.role,old.role_code,old.is_active) then
     raise exception 'Authorization fields require trusted administration' using errcode='42501';
   end if;
 end if;
 return new;
end $$;
create trigger protect_profile_authorization before insert or update on public.profiles
for each row execute function meeting_private.protect_profile();

create policy enterprise_active_profile on public.profiles as restrictive for all to authenticated
using (meeting_private.actor_role() is not null) with check (meeting_private.actor_role() is not null);
create policy enterprise_meeting_read on public.meetings as restrictive for select to authenticated
using ((created_by=auth.uid() and meeting_private.actor_role() is not null) or meeting_private.can_read_meeting(id));
create policy enterprise_meeting_insert on public.meetings as restrictive for insert to authenticated
with check (created_by=auth.uid() and meeting_private.actor_role() in ('admin','board_chair','secretary')
and (meeting_private.actor_role()='admin' or committee_id is null or exists
(select 1 from public.committee_members c where c.committee_id=meetings.committee_id and c.user_id=auth.uid())));
create policy enterprise_meeting_update on public.meetings as restrictive for update to authenticated
using (meeting_private.can_manage_meeting(id)) with check (meeting_private.can_manage_meeting(id));
create policy enterprise_meeting_delete on public.meetings as restrictive for delete to authenticated
using (meeting_private.can_manage_meeting(id));

-- Prevent moving a meeting across security boundaries through an otherwise allowed update.
create or replace function meeting_private.protect_meeting_scope() returns trigger
language plpgsql set search_path = '' as $$
begin
 if current_user in ('anon','authenticated') and
 (new.id,new.committee_id,new.created_by) is distinct from (old.id,old.committee_id,old.created_by) then
 raise exception 'Meeting scope cannot be reassigned' using errcode='42501'; end if;
 return new;
end $$;
create trigger protect_meeting_scope before update on public.meetings for each row execute function meeting_private.protect_meeting_scope();

create policy enterprise_attachment_read on public.attachments as restrictive for select to authenticated
using (meeting_private.can_read_meeting(meeting_id));
create policy enterprise_attachment_write on public.attachments as restrictive for insert to authenticated
with check (uploaded_by=auth.uid() and meeting_private.can_manage_meeting(meeting_id)
and split_part(storage_path,'/',1)=meeting_id::text);
create policy enterprise_attachment_update on public.attachments as restrictive for update to authenticated
using (meeting_private.can_manage_meeting(meeting_id))
with check (meeting_private.can_manage_meeting(meeting_id) and split_part(storage_path,'/',1)=meeting_id::text);
create policy enterprise_attachment_delete on public.attachments as restrictive for delete to authenticated
using (meeting_private.can_manage_meeting(meeting_id));

create or replace function meeting_private.can_read_object(bucket text, path text) returns boolean
language sql stable security definer set search_path = '' as $$
 select auth.uid() is not null and (
 (bucket='meeting-files' and exists(select 1 from public.attachments a where a.storage_path=path and meeting_private.can_read_meeting(a.meeting_id)))
 or (bucket in ('meeting-files','signatures') and exists(select 1 from public.signatures s join public.minutes m on m.id=s.minute_id
 where s.signature_path=path and meeting_private.can_read_meeting(m.meeting_id))))
$$;
create or replace function meeting_private.can_upload_object(bucket text, path text) returns boolean
language sql stable security definer set search_path = '' as $$
 select auth.uid() is not null and bucket='meeting-files' and exists
 (select 1 from public.meetings m where m.id::text=split_part(path,'/',1) and meeting_private.can_manage_meeting(m.id))
$$;
revoke all on function meeting_private.can_read_object(text,text), meeting_private.can_upload_object(text,text) from public;
grant execute on function meeting_private.can_read_object(text,text), meeting_private.can_upload_object(text,text) to authenticated;
create policy enterprise_file_read on storage.objects as restrictive for select to authenticated
using (bucket_id not in ('meeting-files','signatures') or meeting_private.can_read_object(bucket_id,name));
create policy enterprise_file_insert on storage.objects as restrictive for insert to authenticated
with check (bucket_id not in ('meeting-files','signatures') or meeting_private.can_upload_object(bucket_id,name));
-- Existing documents/signatures are immutable. Corrections require new version paths.
create policy enterprise_file_update on storage.objects as restrictive for update to authenticated
using (bucket_id not in ('meeting-files','signatures')) with check (bucket_id not in ('meeting-files','signatures'));
create policy enterprise_file_delete on storage.objects as restrictive for delete to authenticated
using (bucket_id not in ('meeting-files','signatures'));
create policy enterprise_profile_update on public.profiles as restrictive for update to authenticated
using (id=auth.uid()) with check (id=auth.uid());
create function meeting_private.can_read_committee(cid uuid) returns boolean language sql stable security definer set search_path='' as $$
select auth.uid() is not null and meeting_private.actor_role() is not null and (meeting_private.actor_role()='admin' or exists(select 1 from public.committee_members c where c.committee_id=cid and c.user_id=auth.uid()))
$$;
revoke all on function meeting_private.can_read_committee(uuid) from public,anon;
grant execute on function meeting_private.can_read_committee(uuid) to authenticated;
create policy enterprise_committee_membership on public.committee_members as restrictive for all to authenticated
using (meeting_private.can_read_committee(committee_id))
with check (meeting_private.actor_role()='admin');
create policy enterprise_committee_membership_delete on public.committee_members as restrictive for delete to authenticated
using (meeting_private.actor_role()='admin');

-- Apply after access-hardening.sql in isolated staging first. No existing rows deleted.

alter table public.meetings add column if not exists quorum_percent numeric(5,2);
alter table public.meetings add column if not exists roster_locked boolean not null default false;
alter table public.meeting_attendees add column if not exists eligible boolean not null default false;
alter table public.minutes add column if not exists approved_by uuid;
alter table public.minutes add column if not exists approved_at timestamptz;
alter table public.minutes add column if not exists sealed_hash text;
alter table public.votes add column if not exists engine_version smallint not null default 1;
create table public.meeting_events (
 id bigint generated always as identity primary key, meeting_id uuid references public.meetings(id) on delete restrict,
 actor_id uuid, action text not null, entity_id uuid, happened_at timestamptz not null default clock_timestamp(),
 previous_hash text not null, event_hash text not null, details jsonb not null default '{}'::jsonb
);
alter table public.meeting_events enable row level security;
grant select on public.meeting_events to authenticated;
create policy meeting_events_read on public.meeting_events for select to authenticated using (meeting_private.can_read_meeting(meeting_id));
create function meeting_private.append_event(mid uuid, act text, eid uuid, info jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare prev text; stamp timestamptz:=clock_timestamp(); hash text;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 perform pg_advisory_xact_lock(715421);
 select event_hash into prev from public.meeting_events order by id desc limit 1;
 prev:=coalesce(prev,'GENESIS');
 hash:=encode(sha256(convert_to(jsonb_build_array(prev,mid,auth.uid(),act,eid,stamp,info)::text,'UTF8')),'hex');
 insert into public.meeting_events(meeting_id,actor_id,action,entity_id,happened_at,previous_hash,event_hash,details)
 values(mid,auth.uid(),act,eid,stamp,prev,hash,info);
end $$;
revoke all on function meeting_private.append_event(uuid,text,uuid,jsonb) from public,authenticated;

create function meeting_private.quorum(mid uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare pct numeric; total integer; present integer; required integer;
begin
 if not meeting_private.can_read_meeting(mid) then raise exception 'Access denied' using errcode='42501'; end if;
 select quorum_percent into pct from public.meetings where id=mid;
 select count(*),count(*) filter(where a.attendance_status in ('حاضر','عن بُعد')) into total,present
 from public.meeting_attendees a join public.profiles p on p.id=a.user_id where a.meeting_id=mid and a.eligible;
 -- Frozen roster remains the denominator even when an account is suspended.
 select count(*) into present from public.meeting_attendees a join public.profiles p on p.id=a.user_id
 where a.meeting_id=mid and a.eligible and p.is_active and a.attendance_status in ('حاضر','عن بُعد');
 required:=ceil(total*pct/100.0);
 return jsonb_build_object('percent',pct,'total',total,'present',present,'required',required,'complete',coalesce(pct>0 and pct<=100 and total>0 and present>=required,false),'missing',greatest(coalesce(required,0)-present,0));
end $$;
create function public.meeting_quorum(p_meeting uuid) returns jsonb language sql security invoker set search_path='' as $$select meeting_private.quorum(p_meeting)$$;

create function meeting_private.guard_meeting() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' and (new.quorum_percent is null or new.quorum_percent<=0 or new.quorum_percent>100) then raise exception 'Quorum percentage between 0 and 100 is required'; end if;
 if tg_op='UPDATE' then
  if new.quorum_percent is distinct from old.quorum_percent and (old.roster_locked or new.quorum_percent is null or new.quorum_percent<=0 or new.quorum_percent>100) then raise exception 'Invalid or frozen quorum'; end if;
  if current_user in ('authenticated','anon') and (new.status,new.roster_locked) is distinct from (old.status,old.roster_locked) then raise exception 'Use meeting transition'; end if;
 else
  if new.status<>'مجدول' or new.roster_locked then raise exception 'New meeting must be scheduled'; end if;
 end if;
 return new;
end $$;
create trigger meeting_lifecycle_guard before insert or update on public.meetings for each row execute function meeting_private.guard_meeting();

create function meeting_private.prepare_roster(mid uuid, members uuid[]) returns void language plpgsql security definer set search_path='' as $$
declare m public.meetings; member uuid;
begin
 if not meeting_private.can_manage_meeting(mid) then raise exception 'Access denied'; end if;
 select * into m from public.meetings where id=mid for update;
 if m.roster_locked or m.status<>'مجدول' then raise exception 'Roster frozen'; end if;
 if coalesce(cardinality(members),0)=0 then raise exception 'At least one eligible member required'; end if;
 -- Do not delete old invitees or attendance; only reset eligibility before freezing.
 update public.meeting_attendees set eligible=false where meeting_id=mid;
 foreach member in array members loop
  if not exists(select 1 from public.profiles p where p.id=member and p.is_active and p.role in ('admin','board_chair','secretary','member')) then raise exception 'Ineligible account'; end if;
  if m.committee_id is not null and not exists(select 1 from public.committee_members c where c.committee_id=m.committee_id and c.user_id=member) then raise exception 'Member outside committee'; end if;
  insert into public.meeting_attendees(meeting_id,user_id,eligible) values(mid,member,true)
  on conflict(meeting_id,user_id) do update set eligible=true;
 end loop;
 perform meeting_private.append_event(mid,'roster_prepared',mid,jsonb_build_object('members',members));
end $$;
create function public.prepare_meeting_roster(p_meeting uuid,p_members uuid[]) returns void language sql security invoker set search_path='' as $$select meeting_private.prepare_roster(p_meeting,p_members)$$;
create function meeting_private.record_attendance(mid uuid, member uuid, state text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not meeting_private.can_manage_meeting(mid) then raise exception 'Access denied'; end if;
 perform 1 from public.meetings where id=mid and status in ('مجدول','منعقد') for update;
 if not found or state not in ('حاضر','عن بُعد','غائب','معتذر') then raise exception 'Invalid meeting or attendance state'; end if;
 update public.meeting_attendees set attendance_status=state,attended_at=clock_timestamp() where meeting_id=mid and user_id=member;
 if not found then raise exception 'Member is not on the roster'; end if;
 perform meeting_private.append_event(mid,'attendance_recorded',member,jsonb_build_object('status',state));
end $$;
create function public.record_meeting_attendance(p_meeting uuid,p_member uuid,p_status text) returns void language sql security invoker set search_path='' as $$select meeting_private.record_attendance(p_meeting,p_member,p_status)$$;
create function meeting_private.transition_meeting(mid uuid, state text) returns void language plpgsql security definer set search_path='' as $$
declare m public.meetings;
begin
 if not meeting_private.can_manage_meeting(mid) then raise exception 'Access denied'; end if;
 select * into m from public.meetings where id=mid for update;
 if state='منعقد' and m.status='مجدول' then
  if not (meeting_private.quorum(mid)->>'complete')::boolean then raise exception 'Quorum incomplete'; end if;
  update public.meetings set status=state,roster_locked=true where id=mid;
 elsif state='مكتمل' and m.status='منعقد' then
  if exists(select 1 from public.votes where meeting_id=mid and status='مفتوح') then raise exception 'Close all votes first'; end if;
  update public.meetings set status=state where id=mid;
 else raise exception 'Invalid meeting transition'; end if;
 perform meeting_private.append_event(mid,'meeting_transition',mid,jsonb_build_object('status',state));
end $$;
create function public.transition_meeting(p_meeting uuid,p_status text) returns void language sql security invoker set search_path='' as $$select meeting_private.transition_meeting(p_meeting,p_status)$$;

-- Separate receipt from secret choice. No identity or timestamp is stored on secret ballots.
-- This is application-level confidentiality, not cryptographic anonymity against DB operators.
create table meeting_private.ballot_receipts(vote_id uuid references public.votes(id),user_id uuid references public.profiles(id),voted_at timestamptz not null default clock_timestamp(),primary key(vote_id,user_id));
create table meeting_private.ballots(id uuid primary key default gen_random_uuid(),vote_id uuid references public.votes(id),user_id uuid,choice text not null check(choice in ('موافق','غير موافق','ممتنع')));
alter table meeting_private.ballot_receipts enable row level security;
alter table meeting_private.ballots enable row level security;
revoke all on meeting_private.ballots,meeting_private.ballot_receipts from public,authenticated,anon;
create function meeting_private.open_vote(mid uuid, question text, secret boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare vid uuid;
begin
 if not meeting_private.can_manage_meeting(mid) then raise exception 'Access denied'; end if;
 perform 1 from public.meetings where id=mid and status='منعقد' and roster_locked for update;
 if not found or not (meeting_private.quorum(mid)->>'complete')::boolean then raise exception 'Quorum incomplete or meeting not started'; end if;
 if question is null or length(trim(question))=0 then raise exception 'Question required'; end if;
 insert into public.votes(meeting_id,question,vote_type,quorum_required,status,created_by,engine_version)
 values(mid,question,case when secret then 'سري' else 'معلن' end,(meeting_private.quorum(mid)->>'required')::integer,'مفتوح',auth.uid(),2) returning id into vid;
 perform meeting_private.append_event(mid,'vote_opened',vid); return vid;
end $$;
create function public.open_meeting_vote(p_meeting uuid,p_question text,p_secret boolean) returns uuid language sql security invoker set search_path='' as $$select meeting_private.open_vote(p_meeting,p_question,p_secret)$$;
create function meeting_private.cast_vote(vid uuid, selection text) returns void language plpgsql security definer set search_path='' as $$
declare v public.votes;
begin
 select * into v from public.votes where id=vid;
 if not meeting_private.can_read_meeting(v.meeting_id) then raise exception 'Access denied'; end if;
 perform 1 from public.meetings where id=v.meeting_id for update;
 select * into v from public.votes where id=vid for update;
 if v.engine_version<>2 then raise exception 'Legacy vote requires review before accepting new ballots'; end if;
 if v.status<>'مفتوح' or not (meeting_private.quorum(v.meeting_id)->>'complete')::boolean then raise exception 'Vote closed or quorum incomplete'; end if;
 if not exists(select 1 from public.meeting_attendees where meeting_id=v.meeting_id and user_id=auth.uid() and eligible and attendance_status in ('حاضر','عن بُعد')) then raise exception 'Not eligible to vote'; end if;
 if selection not in ('موافق','غير موافق','ممتنع') or selection is null then raise exception 'Invalid choice'; end if;
 insert into meeting_private.ballot_receipts(vote_id,user_id) values(vid,auth.uid());
 insert into meeting_private.ballots(vote_id,user_id,choice) values(vid,case when v.vote_type='سري' then null else auth.uid() end,selection);
 perform meeting_private.append_event(v.meeting_id,'vote_cast',vid); -- never log choice
end $$;
create function public.cast_meeting_vote(p_vote uuid,p_choice text) returns void language sql security invoker set search_path='' as $$select meeting_private.cast_vote(p_vote,p_choice)$$;
create function meeting_private.close_vote(vid uuid) returns void language plpgsql security definer set search_path='' as $$
declare mid uuid;
begin
 select meeting_id into mid from public.votes where id=vid;
 if not meeting_private.can_manage_meeting(mid) then raise exception 'Access denied'; end if;
 perform 1 from public.meetings where id=mid for update;
 update public.votes set status='مغلق' where id=vid and status='مفتوح';
 if not found then raise exception 'Vote already closed'; end if;
 perform meeting_private.append_event(mid,'vote_closed',vid);
end $$;
create function public.close_meeting_vote(p_vote uuid) returns void language sql security invoker set search_path='' as $$select meeting_private.close_vote(p_vote)$$;
create function meeting_private.vote_results(vid uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v public.votes; result jsonb;
begin
 select * into v from public.votes where id=vid;
 if not meeting_private.can_read_meeting(v.meeting_id) then raise exception 'Access denied'; end if;
 if v.status<>'مغلق' then return jsonb_build_object('status',v.status); end if;
 select jsonb_build_object('yes',count(*) filter(where choice='موافق'),'no',count(*) filter(where choice='غير موافق'),'abstain',count(*) filter(where choice='ممتنع'),'total',count(*)) into result from meeting_private.ballots where vote_id=vid;
 if v.engine_version=1 then
 select jsonb_build_object('yes',count(*) filter(where choice='موافق'),'no',count(*) filter(where choice='غير موافق'),'abstain',count(*) filter(where choice='ممتنع'),'total',count(*),'legacy',true) into result from public.vote_responses where vote_id=vid;
 end if;
 return result;
end $$;
create function public.meeting_vote_results(p_vote uuid) returns jsonb language sql security invoker set search_path='' as $$select meeting_private.vote_results(p_vote)$$;

create function meeting_private.guard_minute() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Minutes must be retained'; end if;
 if tg_op='INSERT' then
  if new.status is distinct from 'مسودة' or new.approved_by is not null or new.approved_at is not null or new.sealed_hash is not null then raise exception 'New minute must be draft'; end if;
 else
  if old.status is distinct from 'مسودة' and (new.content,new.recommendations,new.improvement_opportunities,new.meeting_id,new.created_by) is distinct from (old.content,old.recommendations,old.improvement_opportunities,old.meeting_id,old.created_by) then raise exception 'Minute version locked'; end if;
  if new.meeting_id is distinct from old.meeting_id then raise exception 'Minute scope immutable'; end if;
  if current_user in ('authenticated','anon') and (new.status,new.approved_by,new.approved_at,new.sealed_hash) is distinct from (old.status,old.approved_by,old.approved_at,old.sealed_hash) then raise exception 'Use minute transition'; end if;
 end if;
 return new;
end $$;
create trigger minute_lifecycle_guard before insert or update or delete on public.minutes for each row execute function meeting_private.guard_minute();
create function meeting_private.transition_minute(minid uuid,state text) returns void language plpgsql security definer set search_path='' as $$
declare m public.minutes; stamp timestamptz:=clock_timestamp();
begin
 select * into m from public.minutes where id=minid for update;
 if not meeting_private.can_manage_meeting(m.meeting_id) then raise exception 'Access denied'; end if;
 if state='معروض للاعتماد' and m.status='مسودة' then
  if length(trim(coalesce(m.content,'')))=0 then raise exception 'Minute content required'; end if;
  if not exists(select 1 from public.meetings where id=m.meeting_id and status='مكتمل') then raise exception 'Complete meeting first'; end if;
  update public.minutes set status=state where id=minid;
 elsif state='معتمد داخليًا' and m.status='معروض للاعتماد' and meeting_private.actor_role()='board_chair' then
  update public.minutes set status=state,approved_by=auth.uid(),approved_at=stamp,
  sealed_hash=encode(sha256(convert_to(jsonb_build_array(m.id,m.meeting_id,m.content,m.recommendations,m.improvement_opportunities)::text,'UTF8')),'hex') where id=minid;
 else raise exception 'Invalid minute transition; official signature is not enabled'; end if;
 perform meeting_private.append_event(m.meeting_id,'minute_transition',minid,jsonb_build_object('status',state));
end $$;
create function public.transition_meeting_minute(p_minute uuid,p_status text) returns void language sql security invoker set search_path='' as $$select meeting_private.transition_minute(p_minute,p_status)$$;

-- Explicit write fences for RPC-managed records, regardless of legacy permissive policies.
do $$declare tab text; op text; begin
 foreach tab in array array['meeting_attendees','votes','vote_responses','signatures'] loop
  foreach op in array array['insert','update','delete'] loop
   execute format('create policy lifecycle_%s on public.%I as restrictive for %s to authenticated %s',op,tab,op,case when op='insert' then 'with check(false)' when op='update' then 'using(false) with check(false)' else 'using(false)' end);
  end loop;
 end loop;
end $$;
create policy lifecycle_vote_read on public.votes as restrictive for select to authenticated using(meeting_private.can_read_meeting(meeting_id));
create policy lifecycle_attendance_read on public.meeting_attendees for select to authenticated using(meeting_private.can_read_meeting(meeting_id));
create policy lifecycle_attendance_read_fence on public.meeting_attendees as restrictive for select to authenticated using(meeting_private.can_read_meeting(meeting_id));
create policy lifecycle_legacy_vote_read on public.vote_responses as restrictive for select to authenticated using(false);
create policy lifecycle_minute_read on public.minutes as restrictive for select to authenticated using(meeting_private.can_read_meeting(meeting_id));
create policy lifecycle_minute_insert on public.minutes as restrictive for insert to authenticated with check(meeting_private.can_manage_meeting(meeting_id) and created_by=auth.uid());
create policy lifecycle_minute_update on public.minutes as restrictive for update to authenticated using(meeting_private.can_manage_meeting(meeting_id)) with check(meeting_private.can_manage_meeting(meeting_id));

-- Automatic audit covers direct, permitted edits as well as guarded transitions.
create function meeting_private.audit_record() returns trigger language plpgsql security definer set search_path='' as $$
declare row_data jsonb; mid uuid; eid uuid;
begin
 row_data:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 mid:=case when tg_table_name='meetings' then (row_data->>'id')::uuid else (row_data->>'meeting_id')::uuid end;
 eid:=(row_data->>'id')::uuid;
 if auth.uid() is not null and mid is not null then
 perform meeting_private.append_event(mid,tg_table_name||':'||lower(tg_op),eid,jsonb_build_object('operation',tg_op));
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function meeting_private.audit_record() from public,anon,authenticated;
create trigger meeting_audit after insert or update on public.meetings for each row execute function meeting_private.audit_record();
create trigger minute_audit after insert or update on public.minutes for each row execute function meeting_private.audit_record();

-- Grant only explicit guarded APIs; internal event writer remains uncallable.
do $$declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='meeting_private' and p.proname in ('quorum','prepare_roster','record_attendance','transition_meeting','open_vote','cast_vote','close_vote','vote_results','transition_minute'))
 or (n.nspname='public' and p.proname in ('meeting_quorum','prepare_meeting_roster','record_meeting_attendance','transition_meeting','open_meeting_vote','cast_meeting_vote','close_meeting_vote','meeting_vote_results','transition_meeting_minute')) loop
 execute format('revoke all on function %s from public, anon',f.signature);
 execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
end $$;


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

COMMIT;
