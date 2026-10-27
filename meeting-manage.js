// إدارة الاجتماع: تعديل البيانات، بنود جدول الأعمال، المرفقات، والحذف.
// الصلاحيات الفعلية تفرضها قاعدة البيانات (RLS في الترحيل 009)؛ الواجهة تُظهر الزر لكل أحد وتعرض رسالة الرفض إن لم يكن مصرَّحًا له.
(() => {
  'use strict';
  const ui = window.ehsanUI, DM = window.DM;
  if (!ui || !DM) return;
  const {esc, toast} = ui;
  const MODES = ['حضوري', 'عن بُعد', 'حضوري + عن بُعد'];
  const PLATFORMS = ['بدون رابط', 'Zoom', 'Microsoft Teams', 'Google Meet'];
  const STATUSES = ['مجدول', 'منعقد', 'مكتمل'];
  const opt = (arr, cur) => arr.concat(cur && !arr.includes(cur) ? [cur] : []).map(x => ({value: x, label: x}));
  const safeUrl = u => { try { const x = new URL(u); return x.protocol === 'https:' ? x.href : ''; } catch { return ''; } };
  const err = (e, what) => { throw new Error(`${what}: ${e?.message || e}`); };

  async function db() { return ui.waitDb(); }

  async function loadAll(id) {
    const c = await db();
    const [m, ag, at] = await Promise.all([
      c.from('meetings').select('*').eq('id', id).maybeSingle(),
      c.from('agenda_items').select('*').eq('meeting_id', id).order('item_order', {ascending: true}),
      c.from('attachments').select('*').eq('meeting_id', id).order('created_at', {ascending: true})
    ]);
    if (m.error) err(m.error, 'تعذر تحميل الاجتماع');
    if (!m.data) throw new Error('الاجتماع غير موجود أو لا تملك صلاحية الاطلاع عليه');
    if (m.data.committee_id) {
      const cm = await c.from('committees').select('name').eq('id', m.data.committee_id).maybeSingle();
      m.data.committees = cm.data || null;
    }
    return {meeting: m.data, agenda: ag.data || [], files: at.data || []};
  }

  async function editMeeting(m) {
    const c = await db();
    return DM.form({
      title: 'تعديل بيانات الاجتماع', submit: 'حفظ التعديل', wide: true,
      fields: [
        {name: 'title', label: 'عنوان الاجتماع', required: true, maxlength: 200, value: m.title || ''},
        {name: 'date', label: 'التاريخ', type: 'date', required: true, value: m.gregorian_date || ''},
        {name: 'time', label: 'وقت البداية', type: 'time', required: true, value: (m.start_time || '').slice(0, 5)},
        {name: 'endTime', label: 'وقت النهاية', type: 'time', value: (m.end_time || '').slice(0, 5)},
        {name: 'mode', label: 'نمط الحضور', type: 'select', options: opt(MODES, m.mode), value: m.mode},
        {name: 'location', label: 'المكان', maxlength: 120, value: m.location || ''},
        {name: 'platform', label: 'المنصة', type: 'select', options: opt(PLATFORMS, m.platform), value: m.platform},
        {name: 'url', label: 'رابط الاجتماع (https)', type: 'url', value: m.meeting_url || ''},
        {name: 'status', label: 'الحالة', type: 'select', options: opt(STATUSES, m.status), value: m.status},
        {name: 'description', label: 'الوصف', type: 'textarea', rows: 3, value: m.description || ''}
      ],
      onSubmit: async v => {
        if (v.endTime && v.endTime <= v.time) throw new Error('وقت النهاية يجب أن يكون بعد وقت البداية');
        if (v.url && !safeUrl(v.url)) throw new Error('رابط الاجتماع يجب أن يبدأ بـ https://');
        const {data, error} = await c.from('meetings').update({
          title: v.title, gregorian_date: v.date, start_time: v.time, end_time: v.endTime || null, mode: v.mode, location: v.location,
          platform: v.platform, meeting_url: v.url || null, status: v.status, description: v.description
        }).eq('id', m.id).select('id');
        if (error) err(error, 'تعذر حفظ التعديل');
        if (!data || !data.length) throw new Error('لم يُحفظ التعديل: لا تملك صلاحية تعديل هذا الاجتماع');
      }
    });
  }

  async function addAgenda(m, count) {
    const c = await db();
    return DM.form({
      title: 'إضافة بند إلى جدول الأعمال', submit: 'إضافة',
      fields: [
        {name: 'title', label: 'عنوان البند', required: true, maxlength: 200},
        {name: 'minutes', label: 'المدة (دقائق)', type: 'number', min: 1, max: 600, value: 10},
        {name: 'notes', label: 'ملاحظات', type: 'textarea', rows: 2}
      ],
      onSubmit: async v => {
        const {error} = await c.from('agenda_items').insert({meeting_id: m.id, item_order: count + 1, title: v.title, duration_minutes: v.minutes || 10, notes: v.notes || null});
        if (error) err(error, 'تعذر إضافة البند');
      }
    });
  }

  async function addFiles(m) {
    const c = await db();
    const s = await ui.session(c);
    return DM.form({
      title: 'رفع مرفقات للاجتماع', submit: 'رفع', fields: [
        {name: 'files', label: 'الملفات', type: 'file', multiple: true, required: true, help: 'يمكن اختيار أكثر من ملف'}
      ],
      onSubmit: async v => {
        const failed = [];
        for (const file of v.files) {
          const ext = (file.name.match(/\.[A-Za-z0-9]{1,8}$/) || [''])[0];
          const path = `${m.id}/${crypto.randomUUID()}${ext}`;
          const up = await c.storage.from('meeting-files').upload(path, file);
          const rec = up.error ? up : await c.from('attachments').insert({meeting_id: m.id, file_name: file.name, storage_path: path, mime_type: file.type, size_bytes: file.size, uploaded_by: s?.user?.id});
          if (rec.error) failed.push(`${file.name} (${rec.error.message})`);
        }
        if (failed.length) throw new Error('تعذر رفع: ' + failed.join('، '));
      }
    });
  }

  async function removeFile(f) {
    const c = await db();
    const {data, error} = await c.from('attachments').delete().eq('id', f.id).select('id');
    if (error) err(error, 'تعذر حذف المرفق');
    if (!data || !data.length) throw new Error('لم يُحذف المرفق: لا تملك صلاحية');
    const r = await c.storage.from('meeting-files').remove([f.storage_path]);
    if (r.error) console.warn('تعذر حذف الملف من التخزين', r.error);
  }

  async function deleteMeeting(m, files) {
    const c = await db();
    const ok = await DM.confirm({title: 'حذف الاجتماع نهائيًا', danger: true, confirmLabel: 'حذف نهائي',
      message: `سيُحذف «${m.title}» مع جدول أعماله ومرفقاته وتذكيراته. لا يمكن التراجع.`});
    if (!ok.ok) return false;
    const paths = files.map(f => f.storage_path).filter(Boolean);
    const {data, error} = await c.from('meetings').delete().eq('id', m.id).select('id');
    if (error) err(error, 'تعذر حذف الاجتماع');
    if (!data || !data.length) throw new Error('لم يُحذف الاجتماع: لا تملك صلاحية الحذف');
    if (paths.length) { const r = await c.storage.from('meeting-files').remove(paths); if (r.error) console.warn('تعذر حذف ملفات التخزين', r.error); }
    return true;
  }

  // ───────── نافذة الإدارة ─────────
  async function openManage(id) {
    let state;
    try { state = await loadAll(id); } catch (e) { toast(e.message); return; }
    const dlg = document.createElement('dialog'); dlg.className = 'dm-dialog wide mm-dialog'; dlg.setAttribute('aria-label', 'إدارة الاجتماع');
    document.body.append(dlg);
    let closed = false;
    const close = () => { if (closed) return; closed = true; try { dlg.close(); } catch { /* مغلق */ } dlg.remove(); window.ehsanMeetings?.reload?.(); };
    dlg.addEventListener('cancel', e => { e.preventDefault(); close(); });

    async function paint() {
      const {meeting: m, agenda, files} = state;
      const url = safeUrl(m.meeting_url);
      dlg.innerHTML = `<div class="dm-form">
        <div class="dm-dlg-head"><h3>إدارة الاجتماع</h3><button type="button" class="dm-x" data-x aria-label="إغلاق">✕</button></div>
        <section class="mm-sec"><div class="mm-row"><strong>${esc(m.title)}</strong><span class="status-pill">${esc(m.status || '')}</span></div>
          <div class="meta mm-meta"><span>${esc(m.committees?.name || '')}</span><span>${esc(m.gregorian_date || '')}</span><span>${esc((m.start_time || '').slice(0, 5))}${m.end_time ? '–' + esc(m.end_time.slice(0, 5)) : ''}</span><span>${esc(m.mode || '')}</span>${m.location ? `<span>${esc(m.location)}</span>` : ''}${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">رابط الاجتماع</a>` : ''}</div>
          <div class="dm-acts mm-top"><button type="button" class="dm-btn primary" data-edit>تعديل البيانات</button><button type="button" class="dm-btn danger" data-del>حذف الاجتماع</button></div></section>
        <section class="mm-sec"><div class="mm-row"><h4>جدول الأعمال (${agenda.length})</h4><button type="button" class="dm-btn ghost sm" data-addag>＋ بند</button></div>
          ${agenda.length ? `<ol class="mm-list">${agenda.map(a => `<li><span>${esc(a.title)} <small class="meta">${a.duration_minutes || ''} دقيقة</small></span><button type="button" class="dm-btn ghost sm" data-delag="${esc(a.id)}">حذف</button></li>`).join('')}</ol>` : '<p class="meta">لا توجد بنود.</p>'}</section>
        <section class="mm-sec"><div class="mm-row"><h4>المرفقات (${files.length})</h4><button type="button" class="dm-btn ghost sm" data-addfile>＋ مرفق</button></div>
          ${files.length ? `<ul class="mm-list">${files.map(f => `<li><span>${esc(f.file_name)} <small class="meta">${f.size_bytes ? Math.round(f.size_bytes / 1024) + ' ك.ب' : ''}</small></span><span class="mm-fa"><button type="button" class="dm-btn ghost sm" data-openf="${esc(f.id)}">فتح</button><button type="button" class="dm-btn ghost sm" data-delf="${esc(f.id)}">حذف</button></span></li>`).join('')}</ul>` : '<p class="meta">لا توجد مرفقات.</p>'}</section>
        <p class="dm-err" role="alert" data-err></p>
      </div>`;
    }
    const refresh = async () => { state = await loadAll(id); await paint(); };
    const run = async fn => { dlg.querySelector('[data-err]').textContent = ''; try { await fn(); } catch (e) { dlg.querySelector('[data-err]').textContent = e.message; } };

    dlg.addEventListener('click', e => {
      const t = e.target.closest('button'); if (!t) return;
      const {meeting: m, agenda, files} = state;
      if (t.hasAttribute('data-x')) return close();
      if (t.hasAttribute('data-edit')) return run(async () => { if (await editMeeting(m)) await refresh(); });
      if (t.hasAttribute('data-del')) return run(async () => { if (await deleteMeeting(m, files)) { toast('تم حذف الاجتماع'); close(); } });
      if (t.hasAttribute('data-addag')) return run(async () => { if (await addAgenda(m, agenda.length)) await refresh(); });
      if (t.dataset.delag) return run(async () => { const c = await db(); const {data, error} = await c.from('agenda_items').delete().eq('id', t.dataset.delag).select('id'); if (error) err(error, 'تعذر حذف البند'); if (!data?.length) throw new Error('لا تملك صلاحية حذف البند'); await refresh(); });
      if (t.hasAttribute('data-addfile')) return run(async () => { if (await addFiles(m)) await refresh(); });
      if (t.dataset.delf) return run(async () => { await removeFile(files.find(f => f.id === t.dataset.delf)); await refresh(); });
      if (t.dataset.openf) return run(async () => {
        const f = files.find(x => x.id === t.dataset.openf); const c = await db();
        const {data, error} = await c.storage.from('meeting-files').createSignedUrl(f.storage_path, 120);
        if (error || !data?.signedUrl) throw new Error('تعذر فتح الملف: ' + (error?.message || ''));
        window.open(data.signedUrl, '_blank', 'noopener');
      });
    });
    await paint(); dlg.showModal();
  }

  // ───────── ربط الزر في جدول الاجتماعات ─────────
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-manage-meeting]'); if (!b) return;
    e.preventDefault(); openManage(b.dataset.manageMeeting);
  });

  // أنماط خفيفة تُكمل أنماط dm-core
  const st = document.createElement('style');
  st.textContent = `.mm-dialog .mm-sec{border-top:1px solid var(--line,#e7ddd2);padding:12px 0}.mm-dialog .mm-sec:first-of-type{border-top:0}
  .mm-row{display:flex;justify-content:space-between;align-items:center;gap:10px}.mm-row h4{margin:0}.mm-meta{display:flex;flex-wrap:wrap;gap:10px;margin:6px 0}
  .mm-list{list-style:none;margin:8px 0 0;padding:0;display:grid;gap:6px}.mm-list li{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--line,#e7ddd2);border-radius:10px}
  .mm-fa{display:flex;gap:6px}.mm-top{justify-content:flex-start}`;
  document.head.append(st);
})();
