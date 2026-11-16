-- حزم المجلس حسب بنود جدول الأعمال: ربط المرفق ببند، وتجميع عناصر الحزمة تحت البنود.
-- 1) board_pack_items.agenda_item_id (اختياري): يُنسخ تلقائيًا من attachments.agenda_item_id عند إضافة مرفق مرتبط ببند، ويُشترط أن يكون البند من اجتماع الحزمة.
-- 2) attachment_set_agenda(): يربط مرفقًا ببند من اجتماعه (للمدير/أمين السر أو منشئ الاجتماع، كسياسة الكتابة القائمة على المرفقات)؛ العمود attachments.agenda_item_id موجود أصلًا وغير مستخدم.
-- لا تغيير في أي بيانات قائمة ولا في صلاحيات القراءة. يعتمد على 028. آمن لإعادة التنفيذ.
begin;

alter table public.board_pack_items add column if not exists agenda_item_id uuid references public.agenda_items(id) on delete set null;

create or replace function public.board_pack_item_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.attachment_id is not null and not exists (
       select 1 from public.attachments a join public.board_packs p on p.id = new.pack_id where a.id = new.attachment_id and a.meeting_id = p.meeting_id) then
    raise exception 'المرفق ليس من اجتماع هذه الحزمة';
  end if;
  -- عند الإضافة: يرث العنصر بند مرفقه إن لم يحدَّد بند
  if tg_op = 'INSERT' and new.agenda_item_id is null and new.attachment_id is not null then
    select a.agenda_item_id into new.agenda_item_id from public.attachments a where a.id = new.attachment_id;
  end if;
  if new.agenda_item_id is not null and not exists (
       select 1 from public.agenda_items g join public.board_packs p on p.id = new.pack_id where g.id = new.agenda_item_id and g.meeting_id = p.meeting_id) then
    raise exception 'البند ليس من اجتماع هذه الحزمة';
  end if;
  return new;
end $$;

create or replace function public.attachment_set_agenda(p_attachment uuid, p_agenda uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a public.attachments%rowtype; ok boolean;
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول'; end if;
  select * into a from public.attachments where id = p_attachment for update;
  if not found then raise exception 'المرفق غير موجود'; end if;
  ok := public.is_admin() or exists (select 1 from public.meetings m where m.id = a.meeting_id and m.created_by = auth.uid());
  if not ok then raise exception 'لا تملك صلاحية تعديل هذا المرفق' using errcode = '42501'; end if;
  if p_agenda is not null and not exists (select 1 from public.agenda_items g where g.id = p_agenda and g.meeting_id = a.meeting_id) then
    raise exception 'البند ليس من اجتماع هذا المرفق';
  end if;
  update public.attachments set agenda_item_id = p_agenda where id = p_attachment;
end $$;


-- حماية من فقد البيانات: كان attachments_agenda_item_id_fkey بـ ON DELETE CASCADE، فحذف بند الأعمال سيحذف سجلات المرفقات المرتبطة به (ويترك ملفاتها يتيمة في التخزين).
-- لم يكن ذلك ظاهرًا لأن العمود لم يكن مستخدمًا؛ وبعد ربط المرفقات بالبنود صار خطرًا فعليًا. يُغيَّر إلى SET NULL: يبقى المرفق في الاجتماع ويفقد ربطه بالبند فقط. لا أثر على أي بيانات الآن (0 مرفقات مرتبطة).
alter table public.attachments drop constraint if exists attachments_agenda_item_id_fkey;
alter table public.attachments add constraint attachments_agenda_item_id_fkey foreign key (agenda_item_id) references public.agenda_items(id) on delete set null;
revoke all on function public.attachment_set_agenda(uuid, uuid) from public, anon;
grant execute on function public.attachment_set_agenda(uuid, uuid) to authenticated;

commit;
