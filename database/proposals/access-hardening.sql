-- Staging candidate; promote via Supabase CLI migration after hosted acceptance.
-- Additive restrictions: does not remove records or existing policies.
begin;
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
commit;
