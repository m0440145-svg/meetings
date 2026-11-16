-- القرارات: ربط القرار ببند جدول الأعمال الذي صدر عنه (إضافة إلى ربطه بالاجتماع والمحضر الموجود أصلًا).
-- عمود اختياري على decisions، ودالة تضبطه (أو تفكّه) بنفس صلاحيات تعديل المسودة، وتشترط أن يكون البند من اجتماع القرار نفسه.
-- لا تغيير في dm_create_decision ولا في بقية دورة العمل؛ يظهر العمود تلقائيًا في dm_decision_detail لأنها تُعيد to_jsonb(d).
-- يعتمد على: decisions و dm_has_perm و dm_log (007) وجدول agenda_items. آمن لإعادة التنفيذ.
begin;

alter table public.decisions add column if not exists agenda_item_id uuid references public.agenda_items(id) on delete set null;
create index if not exists decisions_agenda_idx on public.decisions(agenda_item_id) where agenda_item_id is not null;

-- p_agenda = null يفكّ الربط. للمسودة فقط ولمن يملك صلاحية تعديلها في وحدة القرارات (نفس شرط dm_update_draft)، فلا يتجاوز الربط نظام الأدوار القائم.
create or replace function public.dm_set_agenda_item(p_id uuid, p_agenda uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d public.decisions%rowtype; uid uuid := auth.uid(); a_meeting uuid; ok boolean;
begin
  if uid is null then raise exception 'يجب تسجيل الدخول'; end if;
  select * into d from public.decisions where id = p_id for update;
  if not found then raise exception 'القرار غير موجود'; end if;
  ok := d.status = 'draft' and (public.dm_has_perm(uid, 'edit_draft', p_id) or (d.created_by = uid and public.dm_has_perm(uid, 'create', p_id)));
  if not ok then raise exception 'لا تملك صلاحية تعديل ربط هذا القرار'; end if;
  if p_agenda is not null then
    select meeting_id into a_meeting from public.agenda_items where id = p_agenda;
    if not found then raise exception 'بند جدول الأعمال غير موجود'; end if;
    if d.meeting_id is null then raise exception 'اربط القرار باجتماع أولًا'; end if;
    if a_meeting <> d.meeting_id then raise exception 'البند ليس من اجتماع هذا القرار'; end if;
  end if;
  perform set_config('app.dm_rpc', 'on', true);
  update public.decisions set agenda_item_id = p_agenda where id = p_id;
  perform public.dm_log(p_id, 'edited_draft', d.status, d.status, jsonb_build_object('agenda_item_id', p_agenda));
end $$;

revoke all on function public.dm_set_agenda_item(uuid, uuid) from public, anon;
grant execute on function public.dm_set_agenda_item(uuid, uuid) to authenticated;

commit;
