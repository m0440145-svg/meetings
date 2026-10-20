(() => {
  // نماذج القرار (إنشاء/تعديل/استخراج من المحضر) وشاشة تفاصيل القرار وكل إجراءات دورة الحياة (إسناد، تحديث، أدلة، اعتماد، إقفال، تمديد، توجيه...).
  // كل زر هنا يستدعي دالة خادم (dm_*) تتحقق من الصلاحية والحالة؛ إخفاء الأزرار حسب الصلاحية للعرض فقط.
  const DM = window.DM, {esc, toast, failed} = DM.ui;
  const MAX_BYTES = 15 * 1024 * 1024;
  const MIMES = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel', 'image/png', 'image/jpeg', 'image/webp', 'text/plain'];
  const opt = (v, l) => ({value: v, label: l});
  const users = () => DM.refs.profiles.filter(p => p.is_active !== false).map(p => opt(p.id, p.full_name || 'مستخدم'));

  async function upload(decisionId, file) {
    if (file.size > MAX_BYTES) throw new Error(`حجم الملف «${file.name}» يتجاوز 15 م.ب`);
    if (file.type && !MIMES.includes(file.type)) throw new Error(`صيغة «${file.name}» غير مسموحة (PDF/Word/Excel/صور/نص)`);
    const ext = (file.name.match(/\.([A-Za-z0-9]{1,8})$/) || [])[1];
    const path = `${decisionId}/${crypto.randomUUID()}${ext ? '.' + ext.toLowerCase() : ''}`;
    const {error} = await DM.db.storage.from('decision-files').upload(path, file, {contentType: file.type || 'application/octet-stream'});
    if (error) throw new Error('تعذر رفع الملف: ' + error.message);
    return path;
  }
  DM.upload = upload;

  // ───────────── استخراج القرارات من المحضر ─────────────
  const CAND = /^\s*(?:[\d٠-٩]+\s*[\.\-\)\/]|[-•*●▪–]|قرر|قرّر|يقرر|تقرر|وافق|وافقت|يوصي|أوصى|توصي|التوصية|القرار)/;
  DM.parseCandidates = text => {
    const lines = String(text || '').split(/\r?\n/).map(s => s.replace(/^[\s\-•*●▪–\d٠-٩\.\)\/]+/, '').trim()).filter(s => s.length >= 12);
    const raw = String(text || '').split(/\r?\n/).filter(s => CAND.test(s));
    const picked = raw.map(s => s.replace(/^[\s\-•*●▪–\d٠-٩\.\)\/]+/, '').trim()).filter(s => s.length >= 12);
    return [...new Set(picked.length ? picked : lines)].slice(0, 30);
  };
  DM.extractDialog = async minuteId => {
    await DM.loadRefs();
    const minutes = await DM.sel('minutes', q => q.order('created_at', {ascending: false}).limit(500));
    const minute = minutes.find(m => m.id === minuteId);
    if (!minute) return toast('المحضر غير موجود أو لا تملك الاطلاع عليه');
    const meeting = DM.refs.meetings.find(m => m.id === minute.meeting_id);
    if (!meeting?.committee_id) return toast('اجتماع المحضر غير مرتبط بمجلس أو لجنة');
    const cands = DM.parseCandidates([minute.content, minute.recommendations].filter(Boolean).join('\n'));
    if (!cands.length) return toast('لم أجد في المحضر بنودًا تشبه القرارات؛ أضف القرار يدويًا');
    await DM.form({title: 'استخراج القرارات من المحضر', wide: true, intro: `المحضر: ${meeting.title} (${meeting.gregorian_date}). اختر البنود التي تُنشأ منها مسودات قرارات؛ تُراجع وتُعدَّل قبل التقديم للاعتماد.`,
      fields: [{name: 'kind', label: 'نوع الجهة', type: 'select', options: [opt('committee', 'لجنة'), opt('board', 'مجلس إدارة')], value: 'committee'}, {name: 'items', label: 'البنود المقترحة', type: 'multi', options: cands.map((c, i) => opt(String(i), c.length > 140 ? c.slice(0, 140) + '…' : c)), required: true}],
      submit: 'إنشاء المسودات', onSubmit: async v => {
        const ids = [];
        for (const i of v.items) {
          const t = cands[Number(i)]; const title = t.length > 90 ? t.slice(0, 90).replace(/\s\S*$/, '') + '…' : t;
          ids.push(await DM.rpc('dm_create_decision', {p: {committee_id: meeting.committee_id, body_kind: v.kind, meeting_id: meeting.id, minute_id: minute.id, title, body_text: t}}));
        }
        toast(`أُنشئت ${ids.length} مسودات؛ راجعها من «كل القرارات»`);
        DM.show('all', {status: 'draft'});
      }});
  };

  // ───────────── إنشاء / تعديل القرار ─────────────
  DM.openForm = async (preset = {}) => {
    await DM.loadRefs();
    const minutes = await DM.sel('minutes', q => q.order('created_at', {ascending: false}).limit(500));
    const meetOpts = v => [opt('', 'بدون ربط باجتماع'), ...DM.refs.meetings.filter(m => !v.committee_id || m.committee_id === v.committee_id).map(m => opt(m.id, `${m.title} — ${m.gregorian_date}`))];
    const minuteOpts = v => [opt('', 'بدون محضر'), ...minutes.filter(m => m.meeting_id === v.meeting_id).map(m => opt(m.id, `محضر (${m.status || '—'}) — ${String(m.created_at).slice(0, 10)}`))];
    await DM.form({title: preset.record_type === 'recommendation' ? 'توصية جديدة' : 'قرار جديد', wide: true,
      intro: 'يُنشأ السجل مسودة برقم مرجعي تلقائي، ثم يُقدَّم للاعتماد. بعد الاعتماد لا يُعدَّل النص إلا بإجراء رسمي موثّق.',
      fields: [
        {name: 'body_kind', label: 'نوع الجهة', type: 'select', required: true, options: [opt('board', 'مجلس إدارة'), opt('committee', 'لجنة')], value: preset.body_kind || 'committee'},
        {name: 'committee_id', label: 'اسم المجلس أو اللجنة', type: 'select', required: true, options: [opt('', 'اختر…'), ...DM.refs.committees.map(c => opt(c.id, c.name))], value: preset.committee_id || ''},
        {name: 'record_type', label: 'نوع السجل', type: 'select', options: Object.entries(DM.RECORD).map(([k, v]) => opt(k, v)), value: preset.record_type || 'decision'},
        {name: 'meeting_id', label: 'الاجتماع', type: 'select', optionsFn: meetOpts, onChange: (v, set) => { const m = DM.refs.meetings.find(x => x.id === v.meeting_id); set('meeting_no', m?.meeting_no || ''); }},
        {name: 'meeting_no', label: 'رقم الاجتماع (مثل 5/2026)', type: 'text', maxlength: 40},
        {name: 'minute_id', label: 'مرجع المحضر', type: 'select', optionsFn: minuteOpts, help: 'لا يُعتمد القرار قبل اعتماد المحضر المرتبط به'},
        {name: 'x', type: 'button', label: '⇩ استخراج القرارات من المحضر المختار', onClick: v => { if (!v.minute_id) return toast('اختر المحضر أولًا'); DM.extractDialog(v.minute_id); }},
        {name: 'title', label: 'عنوان القرار', type: 'text', required: true, maxlength: 200, minlength: 3},
        {name: 'body_text', label: 'نص القرار الكامل المعتمد', type: 'textarea', rows: 5, required: true, maxlength: 8000, minlength: 3},
        {name: 'category', label: 'التصنيف', type: 'select', options: Object.entries(DM.CATEGORY).map(([k, v]) => opt(k, v)), value: 'administrative'},
        {name: 'priority', label: 'الأولوية', type: 'select', options: Object.entries(DM.PRIORITY).map(([k, v]) => opt(k, v)), value: 'medium'},
        {name: 'deliverables', label: 'المخرجات المطلوبة (الإنجاز المتوقع)', type: 'textarea', rows: 2, maxlength: 4000},
        {name: 'success_criteria', label: 'مؤشرات الإنجاز (معايير القياس)', type: 'textarea', rows: 2, maxlength: 4000},
        {name: 'notes', label: 'ملاحظات', type: 'textarea', rows: 2, maxlength: 4000},
        {name: 'files', label: 'مرفقات (مستندات ذات صلة، حتى 15 م.ب للملف)', type: 'file', multiple: true, accept: '.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.txt'}
      ], submit: 'حفظ كمسودة',
      onSubmit: async v => {
        const {files, ...p} = v;
        for (const f of files || []) { if (f.size > MAX_BYTES) throw new Error(`حجم «${f.name}» يتجاوز 15 م.ب`); }
        const id = await DM.rpc('dm_create_decision', {p});
        const failures = [];
        for (const f of files || []) {
          try { const path = await upload(id, f); await DM.rpc('dm_add_reference', {p_id: id, p_name: f.name, p_path: path, p_mime: f.type || null, p_size: f.size, p_desc: ''}); }
          catch (e) { failures.push(f.name + ': ' + e.message); }
        }
        toast(failures.length ? `حُفظ القرار وتعذر رفع: ${failures.join(' | ')}` : 'تم حفظ القرار كمسودة');
        DM.openDetail(id);
      }});
  };

  DM.editDraft = D => DM.form({title: 'تعديل المسودة', wide: true, fields: [
    {name: 'title', label: 'عنوان القرار', type: 'text', required: true, maxlength: 200, value: D.decision.title},
    {name: 'body_text', label: 'نص القرار', type: 'textarea', rows: 5, required: true, maxlength: 8000, value: D.decision.body_text},
    {name: 'record_type', label: 'نوع السجل', type: 'select', options: Object.entries(DM.RECORD).map(([k, v]) => opt(k, v)), value: D.decision.record_type},
    {name: 'category', label: 'التصنيف', type: 'select', options: Object.entries(DM.CATEGORY).map(([k, v]) => opt(k, v)), value: D.decision.category},
    {name: 'priority', label: 'الأولوية', type: 'select', options: Object.entries(DM.PRIORITY).map(([k, v]) => opt(k, v)), value: D.decision.priority},
    {name: 'meeting_no', label: 'رقم الاجتماع', type: 'text', maxlength: 40, value: D.decision.meeting_no || ''},
    {name: 'deliverables', label: 'المخرجات المطلوبة', type: 'textarea', rows: 2, maxlength: 4000, value: D.decision.deliverables},
    {name: 'success_criteria', label: 'مؤشرات الإنجاز', type: 'textarea', rows: 2, maxlength: 4000, value: D.decision.success_criteria},
    {name: 'notes', label: 'ملاحظات', type: 'textarea', rows: 2, maxlength: 4000, value: D.decision.notes}],
    onSubmit: async v => { await DM.rpc('dm_update_draft', {p_id: D.decision.id, p: v}); toast('حُفظت التعديلات'); DM.openDetail(D.decision.id); }});

  // ───────────── الحوارات المتخصصة ─────────────
  const refresh = (D, tab) => DM.openDetail(D.decision.id, tab);
  const members = async () => (await DM.sel('org_unit_members').catch(() => []));
  DM.directiveDialog = (id, meetingId, kind) => DM.form({title: 'توجيه / طلب إيضاح على القرار', fields: [
    {name: 'kind', label: 'النوع', type: 'select', options: Object.entries(DM.DIRECTIVE).map(([k, v]) => opt(k, v)), value: kind || 'directive'},
    {name: 'meeting_id', label: 'الاجتماع', type: 'select', options: [opt('', 'بدون'), ...DM.refs.meetings.map(m => opt(m.id, `${m.title} — ${m.gregorian_date}`))], value: meetingId || ''},
    {name: 'text', label: 'نص التوجيه', type: 'textarea', rows: 3, required: true, minlength: 3}],
    submit: 'إصدار', onSubmit: async v => { await DM.rpc('dm_issue_directive', {p_id: id, p_meeting: v.meeting_id || null, p_kind: v.kind, p_text: v.text}); toast('سُجّل التوجيه وأُشعر المسؤول'); DM.openDetail(id, 'follow'); }});

  async function assignDialog(D) {
    const mem = await members(); const d = D.decision;
    return DM.form({title: 'إسناد القرار للتنفيذ ' + d.ref_no, wide: true, intro: 'يُنشأ بطاقة متابعة ويصل إشعار للمسؤول والمساعدين، وتظهر المهمة في قائمة مهامه.', fields: [
      {name: 'unit', label: 'الإدارة المكلفة', type: 'select', required: true, options: [opt('', 'اختر…'), ...DM.refs.units.filter(u => u.is_active !== false).map(u => opt(u.id, u.name))]},
      {name: 'owner', label: 'المسؤول عن التنفيذ', type: 'select', required: true, optionsFn: v => [opt('', 'اختر…'), ...(v.unit && mem.some(m => m.unit_id === v.unit) ? DM.refs.profiles.filter(p => mem.some(m => m.unit_id === v.unit && m.user_id === p.id)).map(p => opt(p.id, p.full_name || 'مستخدم')) : users())]},
      {name: 'due', label: 'تاريخ الاستحقاق', type: 'date', required: true, min: d.decision_date || ''},
      {name: 'deliverables', label: 'المخرجات المطلوبة', type: 'textarea', rows: 2, required: true, value: d.deliverables || ''},
      {name: 'criteria', label: 'مؤشرات الإنجاز', type: 'textarea', rows: 2, value: d.success_criteria || ''},
      {name: 'assistants', label: 'مسؤولون مساعدون (اختياري)', type: 'multi', options: users()}],
      submit: 'إسناد', onSubmit: async v => { await DM.rpc('dm_assign', {p_id: d.id, p_unit: v.unit, p_owner: v.owner, p_due: v.due, p_deliverables: v.deliverables, p_criteria: v.criteria || '', p_assistants: v.assistants.filter(a => a !== v.owner)}); toast('أُسند القرار وأُرسل إشعار للمسؤول'); refresh(D); }});
  }
  const reassignDialog = D => DM.form({title: 'إعادة إسناد / تغيير المسؤول', fields: [
    {name: 'unit', label: 'الإدارة (اختياري)', type: 'select', options: [opt('', 'بدون تغيير'), ...DM.refs.units.map(u => opt(u.id, u.name))]},
    {name: 'owner', label: 'المسؤول الجديد', type: 'select', required: true, options: [opt('', 'اختر…'), ...users()]},
    {name: 'reason', label: 'السبب', type: 'textarea', rows: 2, required: true, minlength: 3}],
    submit: 'تأكيد', onSubmit: async v => { await DM.rpc('dm_reassign', {p_id: D.decision.id, p_unit: v.unit || null, p_owner: v.owner, p_reason: v.reason}); toast('تم تغيير المسؤول'); refresh(D); }});
  const updateDialog = (D, kind) => DM.form({title: 'تحديث التنفيذ', intro: `الإنجاز الحالي ${D.decision.progress_pct}%. التحديث لا يقفل القرار؛ الإقفال بعد التحقق والاعتماد.`, fields: [
    {name: 'kind', label: 'نوع التحديث', type: 'select', options: Object.entries(DM.UPDATE_KIND).filter(([k]) => D.can.update || k === 'note').map(([k, v]) => opt(k, v)), value: kind || 'progress'},
    {name: 'progress', label: 'نسبة الإنجاز (عند تحديث الإنجاز)', type: 'range', min: 0, max: 100, step: 5, value: String(D.decision.progress_pct)},
    {name: 'text', label: 'الوصف (مطلوب للملاحظة والعائق والإجراء التصحيحي)', type: 'textarea', rows: 3},
    {name: 'expected', label: 'التاريخ المتوقع للانتهاء (اختياري)', type: 'date', value: D.decision.expected_end || ''}],
    submit: 'حفظ التحديث', onSubmit: async v => { await DM.rpc('dm_post_update', {p_id: D.decision.id, p_kind: v.kind, p_progress: v.kind === 'progress' ? v.progress : null, p_text: v.text, p_expected: v.expected || null}); toast('سُجّل التحديث'); refresh(D, 'follow'); }});
  const extensionDialog = D => DM.form({title: 'طلب تمديد المدة', intro: `الموعد الحالي ${DM.date(D.decision.due_date)}${D.decision.original_due_date !== D.decision.due_date ? ' (الأصلي ' + DM.date(D.decision.original_due_date) + ')' : ''}. يبقى الموعد الأصلي محفوظًا للمقارنة.`, fields: [
    {name: 'due', label: 'الموعد المقترح', type: 'date', required: true, min: D.decision.due_date}, {name: 'reason', label: 'سبب التمديد', type: 'textarea', rows: 3, required: true, minlength: 5}],
    submit: 'إرسال الطلب', onSubmit: async v => { await DM.rpc('dm_request_extension', {p_id: D.decision.id, p_new_due: v.due, p_reason: v.reason}); toast('أُرسل طلب التمديد'); refresh(D, 'verify'); }});
  const decideExtension = (D, req, approve) => approve
    ? DM.form({title: 'اعتماد التمديد', intro: `المطلوب: ${DM.date(req.requested_due)} — السبب: ${req.reason}`, fields: [{name: 'due', label: 'الموعد المعتمد', type: 'date', value: req.requested_due, min: D.decision.due_date, required: true}, {name: 'note', label: 'ملاحظة', type: 'textarea', rows: 2}],
      submit: 'اعتماد', onSubmit: async v => { await DM.rpc('dm_decide_extension', {p_req: req.id, p_approve: true, p_note: v.note || '', p_due: v.due}); toast('اعتُمد التمديد'); refresh(D, 'verify'); }})
    : DM.form({title: 'رفض التمديد', danger: true, fields: [{name: 'note', label: 'سبب الرفض', type: 'textarea', rows: 3, required: true, minlength: 3}],
      submit: 'رفض', onSubmit: async v => { await DM.rpc('dm_decide_extension', {p_req: req.id, p_approve: false, p_note: v.note, p_due: null}); toast('رُفض التمديد'); refresh(D, 'verify'); }});
  const amendDialog = D => DM.form({title: 'تعديل رسمي لنص القرار', wide: true, intro: 'يُحفظ النص الأصلي كنسخة تاريخية مع سند التعديل واسم من عدّله وتاريخه.', fields: [
    {name: 'text', label: 'النص الجديد', type: 'textarea', rows: 5, required: true, value: D.decision.body_text, maxlength: 8000}, {name: 'basis', label: 'سند التعديل (قرار/اجتماع/مرجع)', type: 'textarea', rows: 2, required: true, minlength: 5}],
    submit: 'تعديل', onSubmit: async v => { await DM.rpc('dm_amend_text', {p_id: D.decision.id, p_text: v.text, p_basis: v.basis}); toast('عُدّل النص وحُفظت النسخة السابقة'); refresh(D, 'text'); }});
  const actionDialog = async D => { await members(); return DM.form({title: 'إضافة إجراء تنفيذي فرعي', fields: [
    {name: 'title', label: 'الإجراء', type: 'text', required: true, maxlength: 200}, {name: 'unit', label: 'الإدارة', type: 'select', options: [opt('', 'بدون'), ...DM.refs.units.map(u => opt(u.id, u.name))]},
    {name: 'owner', label: 'المسؤول', type: 'select', options: [opt('', 'بدون'), ...users()]}, {name: 'due', label: 'الموعد (لا يتجاوز موعد القرار)', type: 'date', max: D.decision.due_date || ''}],
    submit: 'إضافة', onSubmit: async v => { await DM.rpc('dm_add_action', {p_id: D.decision.id, p_title: v.title, p_unit: v.unit || null, p_owner: v.owner || null, p_due: v.due || null}); toast('أُضيف الإجراء'); refresh(D, 'actions'); }}); };
  const evidenceDialog = (D, kind) => DM.form({title: kind === 'reference' ? 'إرفاق مستند مرجعي' : 'رفع دليل إنجاز', fields: [
    {name: 'file', label: 'الملف (PDF / Word / Excel / صورة، حتى 15 م.ب)', type: 'file', required: true, accept: '.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.txt'},
    {name: 'desc', label: 'وصف المستند', type: 'textarea', rows: 2, maxlength: 500}],
    submit: 'رفع', onSubmit: async v => {
      const path = await upload(D.decision.id, v.file);
      if (kind === 'reference') await DM.rpc('dm_add_reference', {p_id: D.decision.id, p_name: v.file.name, p_path: path, p_mime: v.file.type || null, p_size: v.file.size, p_desc: v.desc});
      else await DM.rpc('dm_add_evidence', {p_id: D.decision.id, p_action: null, p_name: v.file.name, p_path: path, p_mime: v.file.type || null, p_size: v.file.size, p_desc: v.desc});
      toast('تم رفع المستند'); refresh(D, 'evidence');
    }});
  const reviewEvidence = (D, ev, accept) => accept
    ? DM.confirm({title: 'قبول دليل الإنجاز', message: ev.file_name, noteLabel: 'ملاحظة (اختياري)', confirmLabel: 'قبول'}).then(async r => { if (r.ok) { try { await DM.rpc('dm_review_evidence', {p_evidence: ev.id, p_accept: true, p_note: r.note}); toast('قُبل الدليل'); refresh(D, 'evidence'); } catch (e) { toast(e.message); } } })
    : DM.form({title: 'رفض دليل الإنجاز', danger: true, intro: ev.file_name, fields: [{name: 'note', label: 'سبب الرفض', type: 'textarea', rows: 3, required: true, minlength: 3}], submit: 'رفض',
      onSubmit: async v => { await DM.rpc('dm_review_evidence', {p_evidence: ev.id, p_accept: false, p_note: v.note}); toast('رُفض الدليل'); refresh(D, 'evidence'); }});

  // إجراءات تحتاج تأكيدًا
  const flows = {
    submit: D => DM.confirm({title: 'تقديم القرار للاعتماد', message: `${D.decision.ref_no} — ${D.decision.title}`, confirmLabel: 'تقديم'}).then(async r => { if (r.ok) { await DM.rpc('dm_submit', {p_id: D.decision.id}); toast('قُدِّم للاعتماد'); refresh(D); } }),
    approve: D => DM.confirm({title: 'اعتماد القرار', message: 'بعد الاعتماد لا يُعدَّل نص القرار إلا بإجراء رسمي موثّق، ويُرقَّم ويُتاح للإسناد.', confirmLabel: 'اعتماد'}).then(async r => { if (r.ok) { await DM.rpc('dm_approve', {p_id: D.decision.id}); toast('اعتُمد القرار'); refresh(D); } }),
    backDraft: D => DM.form({title: 'إعادة القرار للتعديل', fields: [{name: 'reason', label: 'السبب', type: 'textarea', rows: 3, required: true, minlength: 3}], submit: 'إعادة',
      onSubmit: async v => { await DM.rpc('dm_return_to_draft', {p_id: D.decision.id, p_reason: v.reason}); toast('أُعيد للتعديل'); refresh(D); }}),
    ratify: D => DM.confirm({title: 'التصديق على التوصية', message: 'بعد التصديق تصبح التوصية قرارًا تنفيذيًا بانتظار الإسناد.', confirmLabel: 'تصديق'}).then(async r => { if (r.ok) { await DM.rpc('dm_ratify', {p_id: D.decision.id}); toast('صُدِّق على التوصية'); refresh(D); } }),
    verifyReq: D => DM.form({title: 'طلب اعتماد الإنجاز', intro: 'يشترط: نسبة الإنجاز 100%، إنجاز كل الإجراءات الفرعية، ودليل إنجاز واحد على الأقل.', fields: [
      {name: 'all', label: 'أؤكد أن جميع المخرجات المطلوبة قد أُنجزت', type: 'checkbox', required: true}, {name: 'note', label: 'ملاحظة للمتحقق', type: 'textarea', rows: 2}],
      submit: 'إرسال الطلب', onSubmit: async v => { await DM.rpc('dm_request_verification', {p_id: D.decision.id, p_note: v.note || '', p_all_done: v.all}); toast('أُرسل طلب اعتماد الإنجاز'); refresh(D, 'verify'); }}),
    verifyOk: D => DM.confirm({title: 'اعتماد الإنجاز', message: 'يُشترط أن تكون جميع الأدلة قد روجعت. بعد الاعتماد يصبح القرار بانتظار اعتماد الإقفال.', noteLabel: 'ملاحظة (اختياري)', confirmLabel: 'اعتماد الإنجاز'}).then(async r => { if (r.ok) { await DM.rpc('dm_verify', {p_id: D.decision.id, p_approve: true, p_note: r.note}); toast('اعتُمد الإنجاز'); refresh(D, 'verify'); } }),
    verifyNo: D => DM.form({title: 'إعادة القرار للاستكمال', danger: true, fields: [{name: 'note', label: 'السبب ومتطلبات الاستكمال', type: 'textarea', rows: 3, required: true, minlength: 3}], submit: 'إعادة للاستكمال',
      onSubmit: async v => { await DM.rpc('dm_verify', {p_id: D.decision.id, p_approve: false, p_note: v.note}); toast('أُعيد للاستكمال'); refresh(D, 'verify'); }}),
    close: D => DM.confirm({title: 'اعتماد إقفال القرار', message: 'الإقفال نهائي: يُحفظ تاريخه واسم المعتمد والأدلة المرتبطة.', noteLabel: 'ملاحظة الإقفال (اختياري)', confirmLabel: 'إقفال'}).then(async r => { if (r.ok) { await DM.rpc('dm_close', {p_id: D.decision.id, p_note: r.note}); toast('أُقفل القرار'); refresh(D, 'verify'); } }),
    returnDone: D => DM.form({title: 'إعادة القرار للاستكمال قبل الإقفال', danger: true, fields: [{name: 'reason', label: 'السبب', type: 'textarea', rows: 3, required: true, minlength: 3}], submit: 'إعادة',
      onSubmit: async v => { await DM.rpc('dm_return', {p_id: D.decision.id, p_reason: v.reason}); toast('أُعيد للاستكمال'); refresh(D, 'verify'); }}),
    cancel: D => DM.form({title: 'إلغاء القرار', danger: true, intro: 'يُلغى القرار بقرار من صاحب الصلاحية مع حفظ السبب في السجل. لا يُلغى قرار مقفل.', fields: [{name: 'reason', label: 'سبب الإلغاء', type: 'textarea', rows: 3, required: true, minlength: 5}], submit: 'إلغاء القرار',
      onSubmit: async v => { await DM.rpc('dm_cancel', {p_id: D.decision.id, p_reason: v.reason}); toast('أُلغي القرار'); refresh(D); }})
  };

  // ───────────── شاشة التفاصيل ─────────────
  const TABS = [['summary', 'ملخص'], ['follow', 'المتابعة والتحديثات'], ['actions', 'الإجراءات الفرعية'], ['evidence', 'الأدلة والمرفقات'], ['verify', 'التحقق والإقفال والتمديد'], ['text', 'النص والنسخ'], ['events', 'سجل الأحداث']];
  const fileSize = n => n == null ? '' : n > 1048576 ? (n / 1048576).toFixed(1) + ' م.ب' : Math.max(1, Math.round(n / 1024)) + ' ك.ب';
  function eventLine(e) {
    const p = e.payload || {}; const bits = [];
    if (p.reason) bits.push('السبب: ' + p.reason); if (p.note) bits.push('ملاحظة: ' + p.note); if (p.text) bits.push(p.text); if (p.basis) bits.push('السند: ' + p.basis);
    if (p.progress !== undefined && p.progress !== null) bits.push(p.progress + '%'); if (p.new_due) bits.push('الموعد الجديد ' + DM.date(p.new_due)); if (p.days_late) bits.push('متأخر ' + p.days_late + ' يوم');
    if (p.level) bits.push('المستوى: ' + p.level); if (p.file) bits.push(p.file); if (p.ref_no) bits.push(p.ref_no); if (p.title) bits.push(p.title);
    return `<li><strong>${esc(DM.EVENT[e.event_type] || e.event_type)}</strong> ${e.to_status && e.from_status !== e.to_status ? `<small>(${esc(DM.STATUS[e.from_status]?.[0] || e.from_status || '')} ← ${esc(DM.STATUS[e.to_status]?.[0] || e.to_status)})</small>` : ''}
      <br><small>${esc(e.actor || 'النظام')} — ${esc(DM.dateTime(e.created_at))}</small>${bits.length ? `<br>${esc(bits.join(' · '))}` : ''}</li>`;
  }

  function render(el, D, tab) {
    const d = D.decision, can = D.can; DM.state.detailTab = tab;
    const late = DM.isOverdue(d.status, d.due_date);
    const btn = (act, label, cls = '') => `<button class="dm-btn sm ${cls}" type="button" data-act="${act}">${label}</button>`;
    const acts = [
      can.edit_draft && btn('edit', 'تعديل المسودة'), can.submit && btn('submit', 'تقديم للاعتماد', 'primary'), can.approve && btn('approve', 'اعتماد القرار', 'primary'), can.approve && btn('backDraft', 'إعادة للتعديل'),
      can.ratify && btn('ratify', 'التصديق على التوصية', 'primary'), can.assign && btn('assign', 'إسناد للتنفيذ', 'primary'), can.reassign && btn('reassign', 'إعادة إسناد'),
      can.update && btn('update', 'تحديث الإنجاز', 'primary'), can.note && !can.update && btn('note', 'إضافة ملاحظة'), can.request_verification && btn('verifyReq', 'طلب اعتماد الإنجاز', 'primary'),
      can.verify && btn('verifyOk', 'اعتماد الإنجاز', 'primary'), can.verify && btn('verifyNo', 'إعادة للاستكمال'), can.close && btn('close', 'اعتماد الإقفال', 'primary'), can.close && btn('returnDone', 'إعادة قبل الإقفال'),
      can.extend && btn('extend', 'طلب تمديد'), can.direct && btn('direct', 'توجيه / إيضاح'), can.amend && btn('amend', 'تعديل رسمي للنص'), can.cancel && btn('cancel', 'إلغاء القرار', 'danger')
    ].filter(Boolean).join(' ');
    const pending = D.extensions.filter(x => x.status === 'pending');
    const evidence = D.evidence.filter(e => e.kind === 'evidence'), refs = D.evidence.filter(e => e.kind === 'reference');
    const evRow = e => `<div class="dm-item"><strong>${esc(e.file_name)}</strong> <small>${fileSize(e.size_bytes)}</small> ${e.kind === 'evidence' ? `<span class="dm-badge ${e.review_status === 'accepted' ? 's-co' : e.review_status === 'rejected' ? 's-re' : 's-pa'}">${e.review_status === 'accepted' ? 'مقبول' : e.review_status === 'rejected' ? 'مرفوض' : 'بانتظار المراجعة'}</span>` : ''}
        <div class="meta"><span>${esc(e.uploader || '')}</span><span>${esc(DM.dateTime(e.uploaded_at))}</span>${e.description ? `<span>${esc(e.description)}</span>` : ''}${e.review_note ? `<span>ملاحظة المراجع: ${esc(e.review_note)}</span>` : ''}</div>
        <div class="dm-acts-row"><button class="dm-btn sm ghost" type="button" data-act="open-file" data-path="${esc(e.storage_path)}">فتح الملف</button>
        ${can.review_evidence && e.kind === 'evidence' ? `<button class="dm-btn sm ghost" type="button" data-act="ev-ok" data-id="${esc(e.id)}">قبول</button><button class="dm-btn sm ghost" type="button" data-act="ev-no" data-id="${esc(e.id)}">رفض</button>` : ''}</div></div>`;
    const panels = {
      summary: `<div class="dm-info-grid">
          <div><span>الجهة</span><b>${esc(DM.BODY[d.body_kind])} — ${esc(d.committee_name || '')}</b></div><div><span>الاجتماع</span><b>${esc(d.meeting_title || '—')}${d.meeting_no ? ' (' + esc(d.meeting_no) + ')' : ''}</b></div>
          <div><span>تاريخ القرار</span><b>${esc(DM.date(d.decision_date))}</b></div><div><span>النوع / التصنيف</span><b>${esc(DM.RECORD[d.record_type])} · ${esc(DM.CATEGORY[d.category])}</b></div>
          <div><span>الأولوية</span><b>${DM.prio(d.priority)}</b></div><div><span>الإدارة المكلفة</span><b>${esc(d.unit_name || '—')}</b></div>
          <div><span>المسؤول عن التنفيذ</span><b>${esc(d.owner_name || '—')}</b></div><div><span>المساعدون</span><b>${esc(D.assistants.map(a => a.name).join('، ') || '—')}</b></div>
          <div><span>تاريخ التكليف</span><b>${esc(DM.date(d.assigned_at ? String(d.assigned_at).slice(0, 10) : ''))}</b></div>
          <div><span>تاريخ الاستحقاق</span><b class="${late ? 'dm-late' : ''}">${esc(DM.date(d.due_date))}${late ? ' (متأخر ' + d.days_late + ' يوم)' : ''}</b></div>
          <div><span>الاستحقاق الأصلي / التمديدات</span><b>${esc(DM.date(d.original_due_date))} · ${DM.num(d.extension_count)}</b></div><div><span>التاريخ المتوقع للانتهاء</span><b>${esc(DM.date(d.expected_end))}</b></div>
          <div><span>الإنجاز المبلَّغ عنه</span><b>${DM.bar(d.progress_pct, ['completed', 'closed'].includes(d.status))}</b></div><div><span>آخر تحديث</span><b>${esc(DM.dateTime(d.last_update_at))}</b></div>
          <div><span>أنشأه</span><b>${esc(d.creator_name || '—')}</b></div><div><span>اعتمده</span><b>${esc(d.approver_name || '—')} ${d.approved_at ? '· ' + esc(DM.date(String(d.approved_at).slice(0, 10))) : ''}</b></div></div>
        <h3>نص القرار</h3><div class="dm-text">${esc(d.body_text)}</div>
        ${d.deliverables ? `<h3>المخرجات المطلوبة</h3><div class="dm-text">${esc(d.deliverables)}</div>` : ''}${d.success_criteria ? `<h3>مؤشرات الإنجاز</h3><div class="dm-text">${esc(d.success_criteria)}</div>` : ''}${d.notes ? `<h3>ملاحظات</h3><div class="dm-text">${esc(d.notes)}</div>` : ''}
        ${d.status === 'cancelled' ? `<div class="dm-banner">أُلغي القرار: ${esc(d.cancel_reason || '')}</div>` : ''}`,
      follow: `<div class="dm-card"><strong>الإنجاز المبلَّغ عنه:</strong> ${DM.bar(d.progress_pct, ['completed', 'closed'].includes(d.status))}<p class="dm-sub">نسبة الإنجاز المبلَّغ عنها لا تعني الإقفال؛ الإقفال يتطلب التحقق من الأدلة والاعتماد.</p></div>
        <div class="dm-list" style="margin-top:12px">${D.updates.map(u => `<div class="dm-item"><strong>${esc(DM.UPDATE_KIND[u.kind] || u.kind)}</strong>${u.progress_pct !== null && u.progress_pct !== undefined ? ` — ${u.progress_pct}%` : ''}<div class="meta"><span>${esc(u.author || '')}</span><span>${esc(DM.dateTime(u.created_at))}</span>${u.expected_end ? `<span>المتوقع ${esc(DM.date(u.expected_end))}</span>` : ''}</div>${u.body ? `<p>${esc(u.body)}</p>` : ''}</div>`).join('') || '<div class="dm-nodata">لا توجد تحديثات بعد</div>'}</div>`,
      actions: `${can.add_action ? `<p class="dm-noprint">${btn('addAction', '＋ إضافة إجراء فرعي', 'primary')}</p>` : ''}<div class="dm-table-wrap"><table class="dm-table"><thead><tr><th>الإجراء</th><th>الإدارة</th><th>المسؤول</th><th>الموعد</th><th>الحالة</th><th class="dm-noprint"></th></tr></thead><tbody>${D.actions.map(a => `<tr><td>${esc(a.title)}</td><td>${esc(a.unit_name || '—')}</td><td>${esc(a.owner_name || '—')}</td><td>${esc(DM.date(a.due_date))}</td><td>${esc(DM.ACTION_STATUS[a.status])}</td>
        <td class="dm-noprint">${(a.owner_id === DM.me.uid || can.update) && !['done', 'cancelled'].includes(a.status) && ['assigned', 'executing', 'awaiting_update', 'returned'].includes(d.status) ? `<button class="dm-btn sm ghost" data-act="act-prog" data-id="${esc(a.id)}">جارٍ</button> <button class="dm-btn sm ghost" data-act="act-done" data-id="${esc(a.id)}">أنجز</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="dm-nodata">لا توجد إجراءات فرعية</td></tr>'}</tbody></table></div>`,
      evidence: `<p class="dm-noprint">${can.upload ? btn('addEvidence', '＋ رفع دليل إنجاز', 'primary') + ' ' : ''}${can.add_reference ? btn('addRef', '＋ مستند مرجعي') : ''}</p>
        <h3>أدلة الإنجاز</h3><div class="dm-list">${evidence.map(evRow).join('') || '<div class="dm-nodata">لا توجد أدلة إنجاز</div>'}</div>
        <h3>المستندات المرجعية</h3><div class="dm-list">${refs.map(evRow).join('') || '<div class="dm-nodata">لا توجد مستندات مرجعية</div>'}</div>`,
      verify: `<h3>طلبات التحقق</h3><div class="dm-list">${D.verifications.map(v => `<div class="dm-item"><span class="dm-badge ${v.status === 'approved' ? 's-co' : v.status === 'returned' ? 's-re' : 's-pa'}">${v.status === 'approved' ? 'مُعتمد' : v.status === 'returned' ? 'أُعيد للاستكمال' : 'قيد المراجعة'}</span>
          <div class="meta"><span>طُلب ${esc(DM.dateTime(v.requested_at))}</span>${v.reviewed_at ? `<span>روجع ${esc(DM.dateTime(v.reviewed_at))}</span>` : ''}</div>${v.request_note ? `<p>ملاحظة الطلب: ${esc(v.request_note)}</p>` : ''}${v.review_note ? `<p>ملاحظة المراجع: ${esc(v.review_note)}</p>` : ''}</div>`).join('') || '<div class="dm-nodata">لا توجد طلبات تحقق</div>'}</div>
        ${d.closed_at ? `<div class="dm-banner">أُقفل القرار في ${esc(DM.dateTime(d.closed_at))}</div>` : ''}
        <h3>طلبات تمديد المدة</h3><div class="dm-list">${D.extensions.map(x => `<div class="dm-item"><span class="dm-badge ${x.status === 'approved' ? 's-co' : x.status === 'rejected' ? 's-re' : 's-pa'}">${x.status === 'approved' ? 'معتمد' : x.status === 'rejected' ? 'مرفوض' : 'قيد الدراسة'}</span> من ${esc(DM.date(x.current_due))} إلى ${esc(DM.date(x.requested_due))}${x.approved_due ? ' (المعتمد ' + esc(DM.date(x.approved_due)) + ')' : ''}
          <div class="meta"><span>${esc(x.requester || '')}</span><span>${esc(DM.dateTime(x.requested_at))}</span></div><p>${esc(x.reason)}</p>${x.decision_note ? `<p>قرار البتّ: ${esc(x.decision_note)}</p>` : ''}
          ${x.status === 'pending' && can.decide_extension ? `<button class="dm-btn sm primary" data-act="ext-ok" data-id="${esc(x.id)}">اعتماد</button> <button class="dm-btn sm ghost" data-act="ext-no" data-id="${esc(x.id)}">رفض</button>` : ''}</div>`).join('') || '<div class="dm-nodata">لا توجد طلبات تمديد</div>'}</div>
        <h3>التوجيهات والإيضاحات</h3><div class="dm-list">${D.directives.map(x => `<div class="dm-item"><strong>${esc(DM.DIRECTIVE[x.kind] || x.kind)}</strong><div class="meta"><span>${esc(x.author || '')}</span><span>${esc(DM.dateTime(x.created_at))}</span>${x.meeting_id ? `<span>${esc(DM.nameOf.meeting(x.meeting_id))}</span>` : ''}</div><p>${esc(x.body)}</p></div>`).join('') || '<div class="dm-nodata">لا توجد توجيهات</div>'}</div>`,
      text: `<h3>النص الحالي (النسخة ${d.text_version})</h3><div class="dm-text">${esc(d.body_text)}</div><h3>النسخ التاريخية</h3><div class="dm-list">${D.versions.map(v => `<div class="dm-item"><strong>النسخة ${v.version}</strong><div class="meta"><span>${esc(DM.dateTime(v.changed_at))}</span><span>${esc(v.basis || '')}</span></div><div class="dm-text">${esc(v.body_text)}</div></div>`).join('') || '<div class="dm-nodata">تُحفظ نسخة عند الاعتماد</div>'}</div>`,
      events: `<ul class="dm-timeline">${D.events.slice().reverse().map(eventLine).join('')}</ul>`
    };
    el.innerHTML = `<div class="dm-head"><div><span class="eyebrow">${esc(DM.BODY[d.body_kind])} · ${esc(d.committee_name || '')}</span><h2>${esc(d.ref_no)} — ${esc(d.title)}</h2>
        <p>${DM.badge(d.status)} ${DM.lateBadge(d)} ${DM.prio(d.priority)} <span class="dm-badge s-draft">${esc(DM.RECORD[d.record_type])}</span></p></div>
        <div class="dm-acts-top dm-noprint"><button class="dm-btn sm ghost" type="button" data-act="back">→ القائمة</button><button class="dm-btn sm ghost" type="button" data-act="print">طباعة</button></div></div>
      <div class="dm-acts-row dm-noprint">${acts || '<small class="dm-sub">لا توجد إجراءات متاحة لك على هذا القرار في حالته الحالية.</small>'}</div>
      <div class="dm-tabs dm-noprint" role="tablist">${TABS.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${k === tab}">${l}${k === 'verify' && pending.length ? ` (${pending.length})` : ''}</button>`).join('')}</div>
      <div id="dmPanel">${panels[tab]}</div>`;
    el.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => render(el, D, b.dataset.tab)));
    el.onclick = async e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const act = b.dataset.act; b.disabled = true;
      try {
        if (act === 'back') history.length > 1 ? DM.show(DM.lastList || 'all') : DM.show('all');
        else if (act === 'print') window.print();
        else if (act === 'edit') await DM.editDraft(D);
        else if (act === 'assign') await assignDialog(D);
        else if (act === 'reassign') await reassignDialog(D);
        else if (act === 'update') await updateDialog(D, 'progress');
        else if (act === 'note') await updateDialog(D, 'note');
        else if (act === 'extend') await extensionDialog(D);
        else if (act === 'direct') await DM.directiveDialog(d.id, '', 'directive');
        else if (act === 'amend') await amendDialog(D);
        else if (act === 'addAction') await actionDialog(D);
        else if (act === 'addEvidence') await evidenceDialog(D, 'evidence');
        else if (act === 'addRef') await evidenceDialog(D, 'reference');
        else if (act === 'ev-ok' || act === 'ev-no') await reviewEvidence(D, D.evidence.find(x => x.id === b.dataset.id), act === 'ev-ok');
        else if (act === 'ext-ok' || act === 'ext-no') await decideExtension(D, D.extensions.find(x => x.id === b.dataset.id), act === 'ext-ok');
        else if (act === 'act-prog' || act === 'act-done') { await DM.rpc('dm_set_action', {p_action: b.dataset.id, p_status: act === 'act-done' ? 'done' : 'in_progress', p_progress: act === 'act-done' ? 100 : null}); refresh(D, 'actions'); }
        else if (act === 'open-file') { const {data, error} = await DM.db.storage.from('decision-files').createSignedUrl(b.dataset.path, 120); if (error) throw new Error(error.message); window.open(data.signedUrl, '_blank', 'noopener'); }
        else if (flows[act]) await flows[act](D);
      } catch (ex) { toast(ex.message); }
      finally { b.disabled = false; }
    };
  }

  DM.openDetail = async (id, tab) => {
    const el = document.getElementById('view-dm-detail'); if (!el) return;
    const active = document.querySelector('.view.active')?.id?.replace('view-dm-', ''); if (active && DM.screens[active]) DM.lastList = active;
    window.ehsanActivateView?.('dm-detail');
    const pt = document.getElementById('pageTitle'); if (pt) pt.textContent = 'تفاصيل القرار';
    el.classList.add('dm-scope'); el.setAttribute('aria-busy', 'true');
    try {
      await DM.ready; await DM.loadRefs();
      const D = await DM.rpc('dm_decision_detail', {p_id: id});
      if (!D) { el.innerHTML = '<div class="dm-banner">القرار غير موجود أو لا تملك الاطلاع عليه.</div>'; return; }
      render(el, D, tab || (DM.state.detailId === id ? DM.state.detailTab : 'summary') || 'summary'); DM.state.detailId = id;
    } catch (e) { el.innerHTML = `<div class="dm-banner" role="alert">${esc(e.message)}</div>`; failed('تفاصيل القرار', e); }
    finally { el.removeAttribute('aria-busy'); }
  };
})();
