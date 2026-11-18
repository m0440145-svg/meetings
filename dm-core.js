(() => {
  // إدارة قرارات المجلس واللجان ومتابعة تنفيذها — النواة المشتركة: القواميس، الوصول للبيانات، الصلاحيات (للعرض فقط)، نماذج الحوار، الرسوم.
  // كل الصلاحيات الحقيقية تُفرض في قاعدة البيانات (supabase/migrations/007-008)؛ ما هنا يخفي الأزرار فقط.
  const ui = window.ehsanUI;
  const esc = ui.esc;
  const DM = window.DM = {ui};

  // ───────────── القواميس ─────────────
  DM.STATUS = {
    draft: ['مسودة قرار', 's-draft'], pending_approval: ['بانتظار الاعتماد', 's-pa'], approved: ['معتمد', 's-ap'], pending_assignment: ['بانتظار الإسناد', 's-pas'],
    assigned: ['مسند للتنفيذ', 's-as'], executing: ['جارٍ التنفيذ', 's-ex'], awaiting_update: ['بانتظار تحديث', 's-au'], pending_verification: ['بانتظار التحقق من الإنجاز', 's-pv'],
    returned: ['معاد للاستكمال', 's-re'], completed: ['مكتمل ومعتمد للإقفال', 's-co'], closed: ['مقفل', 's-cl'], cancelled: ['ملغى', 's-ca']
  };
  DM.ACTIVE = ['assigned', 'executing', 'awaiting_update', 'returned', 'pending_verification']; // حالات تُعدّ فيها المهلة قائمة (المتأخر حالة زمنية فوقها)
  DM.PRIORITY = {low: 'منخفضة', medium: 'متوسطة', high: 'عالية', critical: 'حرجة'};
  DM.CATEGORY = {administrative: 'إداري', financial: 'مالي', organizational: 'تنظيمي', strategic: 'استراتيجي', other: 'أخرى'};
  DM.RECORD = {decision: 'قرار', recommendation: 'توصية', assignment: 'تكليف'};
  DM.BODY = {board: 'مجلس إدارة', committee: 'لجنة'};
  DM.UPDATE_KIND = {progress: 'تحديث إنجاز', note: 'ملاحظة', blocker: 'عائق', corrective: 'إجراء تصحيحي'};
  DM.DIRECTIVE = {clarification: 'طلب إيضاح', directive: 'توجيه', reassign_request: 'طلب إعادة تكليف', extension_request: 'طلب تعديل مدة', close_recommendation: 'توصية بالإقفال'};
  DM.ACTION_STATUS = {open: 'مفتوح', in_progress: 'جارٍ', done: 'منجز', cancelled: 'ملغى'};
  DM.ROLES = {admin: 'مدير النظام', secretary: 'أمين السر', chair: 'الرئيس', member: 'عضو', executor: 'مسؤول تنفيذي', unit_manager: 'مدير إدارة', governance: 'مسؤول الحوكمة', auditor: 'مراجع داخلي'};
  DM.PERMS = {
    view_scope: 'الاطلاع على قرارات الجهة', create: 'إنشاء قرار', edit_draft: 'تعديل المسودة', submit: 'تقديم للاعتماد', approve: 'اعتماد القرار', ratify: 'التصديق على التوصية',
    assign: 'الإسناد', reassign: 'إعادة الإسناد', add_action: 'إضافة إجراءات فرعية', add_note: 'إضافة ملاحظات', review_evidence: 'مراجعة الأدلة', verify: 'اعتماد الإنجاز',
    close: 'إقفال القرار', cancel: 'إلغاء القرار', amend: 'التعديل الرسمي للنص', approve_extension: 'اعتماد التمديد', approve_extension_limited: 'اعتماد التمديد (ضمن حد)',
    direct: 'إصدار توجيهات', export: 'تصدير التقارير', audit_read: 'قراءة سجل التدقيق', manage_roles: 'إدارة الأدوار', manage_settings: 'إدارة الإعدادات', view_own: 'الاطلاع على قراراتي'
  };
  DM.EVENT = {
    created: 'إنشاء القرار', edited_draft: 'تعديل المسودة', submitted: 'تقديم للاعتماد', returned_to_draft: 'إعادة للتعديل', approved: 'اعتماد القرار', auto_pending_assignment: 'بانتظار الإسناد',
    ratified: 'تصديق التوصية', assigned: 'إسناد للتنفيذ', reassigned: 'إعادة إسناد', started: 'بدء التنفيذ', resumed: 'استئناف التنفيذ', progress: 'تحديث إنجاز', note: 'ملاحظة', blocker: 'عائق',
    corrective: 'إجراء تصحيحي', action_added: 'إضافة إجراء فرعي', action_updated: 'تحديث إجراء فرعي', evidence_added: 'رفع دليل إنجاز', reference_added: 'إرفاق مستند مرجعي',
    evidence_reviewed: 'مراجعة دليل', verification_requested: 'طلب اعتماد الإنجاز', verified: 'اعتماد الإنجاز', verification_returned: 'إعادة للاستكمال بعد التحقق',
    returned_before_closure: 'إعادة قبل الإقفال', closed: 'إقفال القرار', cancelled: 'إلغاء القرار', extension_requested: 'طلب تمديد', extension_approved: 'اعتماد التمديد',
    extension_rejected: 'رفض التمديد', directive: 'توجيه', text_amended: 'تعديل رسمي للنص', alert: 'تنبيه', escalation: 'تصعيد', auto_awaiting_update: 'تحويل آلي إلى بانتظار تحديث'
  };

  // ───────────── التنسيق ─────────────
  const DAY = 86400000;
  DM.today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  DM.date = d => { if (!d) return '—'; try { return new Date(String(d).length <= 10 ? d + 'T00:00:00' : d).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', {year: 'numeric', month: '2-digit', day: '2-digit'}); } catch { return String(d); } };
  DM.dateTime = d => { if (!d) return '—'; try { return new Date(d).toLocaleString('ar-SA-u-ca-gregory-nu-latn', {dateStyle: 'medium', timeStyle: 'short'}); } catch { return String(d); } };
  DM.isOverdue = (status, due) => !!due && DM.ACTIVE.includes(status) && new Date(due + 'T00:00:00') < DM.today();
  DM.daysLate = due => Math.max(0, Math.round((DM.today() - new Date(due + 'T00:00:00')) / DAY));
  const days = n => n === 1 ? 'يوم واحد' : n === 2 ? 'يومان' : n <= 10 ? `${n} أيام` : `${n} يومًا`;
  DM.dueText = (status, due) => {
    if (!due) return {text: 'بلا موعد', cls: ''};
    if (['completed', 'closed', 'cancelled'].includes(status)) return {text: DM.date(due), cls: ''};
    const diff = Math.round((new Date(due + 'T00:00:00') - DM.today()) / DAY);
    if (diff < 0) return {text: `متأخر ${days(-diff)}`, cls: 'late'};
    if (diff === 0) return {text: 'يستحق اليوم', cls: 'soon'};
    if (diff <= 7) return {text: diff === 1 ? 'غدًا' : `بعد ${days(diff)}`, cls: 'soon'};
    return {text: DM.date(due), cls: ''};
  };
  DM.badge = status => { const s = DM.STATUS[status] || [status, '']; return `<span class="dm-badge ${s[1]}">${esc(s[0])}</span>`; };
  DM.lateBadge = d => DM.isOverdue(d.status, d.due_date) ? '<span class="dm-badge s-late">متأخر</span>' : '';
  DM.prio = p => `<span class="dm-prio p-${esc(p)}">${esc(DM.PRIORITY[p] || p)}</span>`;
  DM.bar = (pct, done) => `<span class="dm-bar${done ? ' done' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Number(pct) || 0}" aria-label="نسبة الإنجاز"><i style="width:${Math.max(0, Math.min(100, Number(pct) || 0))}%"></i></span><small class="dm-pct">${Number(pct) || 0}%</small>`;
  DM.num = n => (n === null || n === undefined) ? '—' : Number(n).toLocaleString('ar-SA-u-nu-latn');

  // ───────────── الوصول للبيانات ─────────────
  DM.db = null; DM.me = {uid: null, roles: [], rolePerms: {}, platformAdmin: false};
  DM.refs = {committees: [], units: [], profiles: [], meetings: [], loadedAt: 0};

  DM.rpc = async (name, args = {}) => {
    const {data, error} = await DM.db.rpc(name, args);
    if (error) { const e = new Error(error.message || 'تعذر تنفيذ الإجراء'); e.cause = error; throw e; }
    return data;
  };
  DM.sel = async (table, build) => {
    let q = DM.db.from(table).select('*'); if (build) q = build(q);
    const {data, error} = await q; if (error) throw new Error(error.message); return data || [];
  };

  DM.init = async () => {
    DM.db = await ui.waitDb(); if (!DM.db) return false;
    const {data: {session}} = await DM.db.auth.getSession(); if (!session) return false;
    DM.me.uid = session.user.id;
    const [roles, perms, prof] = await Promise.all([
      DM.db.from('dm_user_roles').select('*').eq('user_id', DM.me.uid), DM.db.from('dm_role_permissions').select('*'), DM.db.from('profiles').select('id,role_code,role,full_name').eq('id', DM.me.uid)
    ]);
    DM.me.roles = (roles.data || []).filter(r => r.is_active);
    DM.me.rolePerms = {}; (perms.data || []).forEach(p => { (DM.me.rolePerms[p.role] ||= new Set()).add(p.permission); });
    const p = (prof.data || [])[0]; DM.me.name = p?.full_name || ''; DM.me.platformAdmin = (p?.role_code || p?.role) === 'admin';
    DM.me.permsLoaded = !perms.error;
    return true;
  };
  // واجهة فقط: هل يملك المستخدم الصلاحية (ربما ضمن لجنة)؟ الخادم هو المرجع
  DM.can = (perm, committeeId) => {
    if (['manage_roles', 'manage_settings'].includes(perm) && DM.me.platformAdmin) return true;
    return DM.me.roles.some(r => (r.committee_id === null || !committeeId || r.committee_id === committeeId) && DM.me.rolePerms[r.role]?.has(perm));
  };
  DM.hasAnyRole = () => DM.me.roles.length > 0 || DM.me.platformAdmin;

  DM.loadRefs = async (force = false) => {
    if (!force && Date.now() - DM.refs.loadedAt < 60000) return DM.refs;
    const [c, u, p, m] = await Promise.all([
      DM.db.from('committees').select('*').order('name'), DM.db.from('org_units').select('*').order('name'),
      DM.db.from('profiles').select('id,full_name,is_active').order('full_name'), DM.db.from('meetings').select('id,title,gregorian_date,committee_id,meeting_no').order('gregorian_date', {ascending: false}).limit(500)
    ]);
    DM.refs = {committees: c.data || [], units: u.data || [], profiles: p.data || [], meetings: m.data || [], loadedAt: Date.now()};
    return DM.refs;
  };
  DM.nameOf = {
    committee: id => DM.refs.committees.find(x => x.id === id)?.name || '—',
    unit: id => DM.refs.units.find(x => x.id === id)?.name || '—',
    user: id => DM.refs.profiles.find(x => x.id === id)?.full_name || (id ? 'مستخدم' : '—'),
    meeting: id => DM.refs.meetings.find(x => x.id === id)?.title || '—'
  };
  DM.loadDecisions = () => DM.sel('decisions', q => q.order('created_at', {ascending: false}).limit(2000));

  // ───────────── نماذج الحوار ─────────────
  // DM.form: حوار نموذجي بتحقق وعرض أخطاء الخادم داخل الحوار دون إغلاقه. يعيد true عند النجاح.
  DM.form = ({title, intro, fields, submit = 'حفظ', danger = false, onSubmit, wide = false}) => new Promise(resolve => {
    const dlg = document.createElement('dialog'); dlg.className = 'dm-dialog' + (wide ? ' wide' : ''); dlg.setAttribute('aria-labelledby', 'dm-dlg-title');
    const form = document.createElement('form'); form.noValidate = true; form.className = 'dm-form';
    const head = document.createElement('div'); head.className = 'dm-dlg-head';
    const h = document.createElement('h3'); h.id = 'dm-dlg-title'; h.textContent = title;
    const x = document.createElement('button'); x.type = 'button'; x.className = 'dm-x'; x.textContent = '✕'; x.setAttribute('aria-label', 'إغلاق');
    head.append(h, x); form.append(head);
    if (intro) { const p = document.createElement('p'); p.className = 'dm-intro'; p.textContent = intro; form.append(p); }
    const inputs = {};
    // قراءة القيم بلا تحقق (لقوائم تعتمد على غيرها ولأزرار الإجراء داخل النموذج)
    function readValues() {
      const v = {};
      for (const [name, {el, f}] of Object.entries(inputs)) {
        if (f.type === 'multi') v[name] = [...el.querySelectorAll('input:checked')].map(c => c.value);
        else if (f.type === 'checkbox') v[name] = el.checked;
        else if (f.type === 'file') v[name] = f.multiple ? [...(el.files || [])] : (el.files?.[0] || null);
        else v[name] = (el.value || '').trim();
      }
      return v;
    }
    function setValue(name, value) { const x = inputs[name]; if (x && x.f.type !== 'file') x.el.value = value; }
    for (const f of fields) {
      const wrap = document.createElement(f.type === 'multi' || f.type === 'checkbox' ? 'fieldset' : 'label'); wrap.className = 'dm-field';
      const id = 'dmf_' + f.name;
      if (f.type === 'info') { wrap.className = 'dm-info'; wrap.textContent = f.text; form.append(wrap); continue; }
      if (f.type === 'button') { const b = document.createElement('button'); b.type = 'button'; b.className = 'dm-btn ghost sm'; b.textContent = f.label; b.addEventListener('click', () => f.onClick && f.onClick(readValues(), setValue)); form.append(b); continue; }
      const lab = document.createElement(f.type === 'multi' ? 'legend' : 'span'); lab.className = 'dm-lab'; lab.textContent = f.label + (f.required ? ' *' : '');
      let el;
      if (f.type === 'textarea') { el = document.createElement('textarea'); el.rows = f.rows || 3; }
      else if (f.type === 'select') {
        el = document.createElement('select');
        (f.options || []).forEach(o => { const op = document.createElement('option'); op.value = o.value; op.textContent = o.label; el.append(op); });
      } else if (f.type === 'multi') {
        el = document.createElement('div'); el.className = 'dm-multi';
        (f.options || []).forEach(o => {
          const l = document.createElement('label'); const c = document.createElement('input'); c.type = 'checkbox'; c.value = o.value; l.append(c, document.createTextNode(' ' + o.label)); el.append(l);
        });
      } else if (f.type === 'checkbox') {
        el = document.createElement('input'); el.type = 'checkbox';
      } else { el = document.createElement('input'); el.type = f.type || 'text'; }
      if (f.type !== 'multi') { el.id = id; el.name = f.name; if (f.multiple) el.multiple = true; if (f.maxlength) el.maxLength = f.maxlength; if (f.min !== undefined) el.min = f.min; if (f.max !== undefined) el.max = f.max; if (f.step) el.step = f.step; if (f.accept) el.accept = f.accept; if (f.placeholder) el.placeholder = f.placeholder; }
      if (f.value !== undefined && f.type !== 'multi' && f.type !== 'file' && f.type !== 'checkbox') el.value = f.value;
      if (f.type === 'checkbox' && f.value) el.checked = true;
      if (f.type === 'multi' && Array.isArray(f.value)) el.querySelectorAll('input').forEach(c => { c.checked = f.value.includes(c.value); });
      if (f.type === 'checkbox') { wrap.className = 'dm-field dm-check'; wrap.append(el, lab); } else wrap.append(lab, el);
      if (f.help) { const s = document.createElement('small'); s.className = 'dm-help'; s.textContent = f.help; wrap.append(s); }
      if (f.type === 'range') { const out = document.createElement('output'); out.textContent = el.value + '%'; el.addEventListener('input', () => { out.textContent = el.value + '%'; }); wrap.append(out); }
      inputs[f.name] = {el, f}; form.append(wrap);
    }
    const err = document.createElement('p'); err.className = 'dm-err'; err.setAttribute('role', 'alert'); form.append(err);
    const acts = document.createElement('div'); acts.className = 'dm-acts';
    const ok = document.createElement('button'); ok.type = 'submit'; ok.className = 'dm-btn ' + (danger ? 'danger' : 'primary'); ok.textContent = submit;
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'dm-btn ghost'; cancel.textContent = 'إلغاء';
    acts.append(ok, cancel); form.append(acts); dlg.append(form); document.body.append(dlg);
    let done = false; const close = v => { if (done) return; done = true; try { dlg.close(); } catch { /* مغلق */ } dlg.remove(); resolve(v); };
    x.addEventListener('click', () => close(false)); cancel.addEventListener('click', () => close(false)); dlg.addEventListener('cancel', e => { e.preventDefault(); close(false); });
    form.addEventListener('submit', async e => {
      e.preventDefault(); err.textContent = '';
      const values = {};
      for (const [name, {el, f}] of Object.entries(inputs)) {
        let v;
        if (f.type === 'multi') v = [...el.querySelectorAll('input:checked')].map(c => c.value);
        else if (f.type === 'checkbox') v = el.checked;
        else if (f.type === 'file') v = f.multiple ? [...(el.files || [])] : (el.files?.[0] || null);
        else if (f.type === 'number' || f.type === 'range') v = el.value === '' ? null : Number(el.value);
        else v = (el.value || '').trim();
        if (f.required && (v === '' || v === null || (Array.isArray(v) && !v.length))) { err.textContent = `الحقل مطلوب: ${f.label}`; (el.focus ? el : el.querySelector('input'))?.focus(); return; }
        if (f.minlength && typeof v === 'string' && v.length < f.minlength) { err.textContent = `${f.label}: ${f.minlength} أحرف على الأقل`; el.focus?.(); return; }
        if ((f.type === 'number' || f.type === 'range') && v !== null && ((f.min !== undefined && v < f.min) || (f.max !== undefined && v > f.max))) { err.textContent = `${f.label}: القيمة خارج المدى`; el.focus?.(); return; }
        values[name] = v;
      }
      ok.disabled = true;
      try { if (onSubmit) await onSubmit(values); close(true); }
      catch (ex) { err.textContent = ex.message || 'تعذر تنفيذ الإجراء'; ok.disabled = false; }
    });
    // حقول تعتمد قائمتها على قيم غيرها (optionsFn) وردود تغيّر (onChange)
    function refresh(changed) {
      const vals = readValues();
      for (const [name, {el, f}] of Object.entries(inputs)) {
        if (!f.optionsFn || f.type !== 'select') continue;
        const keep = el.value; el.replaceChildren();
        f.optionsFn(vals).forEach(o => { const op = document.createElement('option'); op.value = o.value; op.textContent = o.label; el.append(op); });
        el.value = [...el.options].some(o => o.value === keep) ? keep : (f.defaultFirst ? el.options[0]?.value ?? '' : '');
      }
      if (changed && inputs[changed]?.f.onChange) inputs[changed].f.onChange(readValues(), setValue);
    }
    form.addEventListener('change', e => refresh(e.target.name));
    refresh(null);
    dlg.showModal();
    const first = form.querySelector('input:not([type=checkbox]), select, textarea'); first?.focus();
  });

  // تأكيد الإجراءات الحساسة (مع ملاحظة اختيارية/إلزامية)
  DM.confirm = ({title, message, confirmLabel = 'تأكيد', danger = false, noteLabel, noteRequired = false}) => new Promise(resolve => {
    let note = '';
    DM.form({title, intro: message, fields: noteLabel ? [{name: 'note', label: noteLabel, type: 'textarea', required: noteRequired, minlength: noteRequired ? 3 : 0}] : [], submit: confirmLabel, danger,
      onSubmit: v => { note = v.note || ''; }}).then(ok => resolve(ok ? {ok: true, note} : {ok: false, note: ''}));
  });

  // ───────────── رسوم بيانية خفيفة (SVG بلا مكتبات) ─────────────
  const PALETTE = ['#a8461a', '#f18927', '#2d7a5a', '#3b6ea5', '#8a5a9e', '#c4a02a', '#7a7a7a', '#b64242'];
  DM.charts = {
    palette: PALETTE,
    // حلقة (Donut): data = [{label, value, color?}]
    donut(data, {title = ''} = {}) {
      const total = data.reduce((a, d) => a + d.value, 0);
      if (!total) return '<div class="dm-nodata">لا توجد بيانات</div>';
      let acc = 0; const R = 54, C = 2 * Math.PI * R;
      const segs = data.filter(d => d.value > 0).map((d, i) => { const len = C * d.value / total; const s = `<circle r="${R}" cx="70" cy="70" fill="none" stroke="${d.color || PALETTE[i % PALETTE.length]}" stroke-width="22" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-acc}" transform="rotate(-90 70 70)"><title>${esc(d.label)}: ${d.value}</title></circle>`; acc += len; return s; }).join('');
      const legend = data.filter(d => d.value > 0).map((d, i) => `<li><i style="background:${d.color || PALETTE[i % PALETTE.length]}"></i>${esc(d.label)} <b>${d.value}</b></li>`).join('');
      return `<figure class="dm-fig"><svg viewBox="0 0 140 140" role="img" aria-label="${esc(title)}">${segs}<text x="70" y="76" text-anchor="middle" class="dm-donut-n">${total}</text></svg><ul class="dm-legend">${legend}</ul></figure>`;
    },
    // أعمدة أفقية: data = [{label, value, max?, sub?}]
    bars(data, {unit = '', title = ''} = {}) {
      if (!data.length) return '<div class="dm-nodata">لا توجد بيانات</div>';
      const max = Math.max(1, ...data.map(d => d.max ?? d.value));
      return `<div class="dm-bars" role="img" aria-label="${esc(title)}">${data.map(d => `<div class="dm-brow"><span class="dm-bl">${esc(d.label)}</span><span class="dm-btrack"><i style="width:${Math.round(100 * d.value / max)}%;${d.color ? 'background:' + d.color : ''}"></i></span><b>${d.value}${unit}</b>${d.sub ? `<small>${esc(d.sub)}</small>` : ''}</div>`).join('')}</div>`;
    },
    // أعمدة مجمّعة شهريًا: series = [{key,label,color}], rows = [{month, ...}]
    grouped(rows, series, {title = ''} = {}) {
      if (!rows.length) return '<div class="dm-nodata">لا توجد بيانات</div>';
      const max = Math.max(1, ...rows.flatMap(r => series.map(s => r[s.key] || 0)));
      const W = 560, H = 190, pad = 26, gw = (W - pad) / rows.length, bw = Math.max(4, Math.min(14, gw / (series.length + 1)));
      const bars = rows.map((r, i) => series.map((s, k) => { const h = Math.round((H - 40) * (r[s.key] || 0) / max); const x = pad + i * gw + gw / 2 - (series.length * bw) / 2 + k * bw; return `<rect x="${x}" y="${H - 24 - h}" width="${bw - 1}" height="${h}" fill="${s.color}" rx="2"><title>${esc(r.month)} — ${esc(s.label)}: ${r[s.key] || 0}</title></rect>`; }).join('')).join('');
      const labels = rows.map((r, i) => (i % 2 === 0 ? `<text x="${pad + i * gw + gw / 2}" y="${H - 8}" text-anchor="middle" class="dm-ax">${esc(String(r.month).slice(2))}</text>` : '')).join('');
      return `<figure class="dm-fig"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}" preserveAspectRatio="xMidYMid meet"><line x1="${pad}" x2="${W}" y1="${H - 24}" y2="${H - 24}" class="dm-axis"/>${bars}${labels}</svg><ul class="dm-legend">${series.map(s => `<li><i style="background:${s.color}"></i>${esc(s.label)}</li>`).join('')}</ul></figure>`;
    },
    // خط اتجاه: points = [{label, value}] (قيمة null تُتخطى)
    line(points, {title = '', unit = '', color = '#a8461a'} = {}) {
      const pts = points.map((p, i) => ({...p, i}));
      if (pts.filter(p => p.value !== null && p.value !== undefined).length < 2) return '<div class="dm-nodata">لا توجد بيانات كافية للاتجاه</div>';
      const W = 560, H = 170, pad = 26, max = Math.max(1, ...pts.map(p => p.value || 0)), sx = i => pad + i * ((W - pad - 10) / Math.max(1, points.length - 1)), sy = v => H - 28 - (H - 50) * v / max;
      const valid = pts.filter(p => p.value !== null && p.value !== undefined);
      const path = valid.map((p, k) => `${k ? 'L' : 'M'}${sx(p.i).toFixed(1)} ${sy(p.value).toFixed(1)}`).join(' ');
      const dots = valid.map(p => `<circle cx="${sx(p.i).toFixed(1)}" cy="${sy(p.value).toFixed(1)}" r="3.5" fill="${color}"><title>${esc(p.label)}: ${p.value}${unit}</title></circle>`).join('');
      const labels = points.map((p, i) => (i % 2 === 0 ? `<text x="${sx(i)}" y="${H - 8}" text-anchor="middle" class="dm-ax">${esc(String(p.label).slice(2))}</text>` : '')).join('');
      return `<figure class="dm-fig"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}" preserveAspectRatio="xMidYMid meet"><line x1="${pad}" x2="${W - 6}" y1="${H - 28}" y2="${H - 28}" class="dm-axis"/><path d="${path}" fill="none" stroke="${color}" stroke-width="2.5"/>${dots}${labels}</svg></figure>`;
    }
  };

  // ───────────── الأنماط (فاتح/داكن) تُحقن من هنا ─────────────
  const CSS = `
.dm-scope{--dm-bg:#fff;--dm-ink:#3a332f;--dm-mut:#6b5f59;--dm-line:#eadfd8;--dm-soft:#f9f4ee;--dm-brand:#a8461a;--dm-card:#fff;--dm-accent:#f18927}
html[data-dm-theme=dark] .dm-scope{--dm-bg:#1f1a17;--dm-ink:#f3ebe5;--dm-mut:#c9bcb3;--dm-line:#4a3f38;--dm-soft:#2a2420;--dm-brand:#ffa468;--dm-card:#2a2420;--dm-accent:#f6a655}
html[data-dm-theme=dark] .view.dm-scope{background:var(--dm-bg);color:var(--dm-ink)}
.dm-scope .dm-head{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:14px}
.dm-scope h2,.dm-scope h3{color:var(--dm-ink)}
.dm-scope .dm-sub{color:var(--dm-mut);font-size:13px;margin:0}
.dm-btn{border:1px solid var(--dm-line,#eadfd8);background:var(--dm-card,#fff);color:var(--dm-ink,#3a332f);border-radius:11px;padding:9px 16px;font:inherit;font-weight:700;cursor:pointer;transition:transform .15s,background .2s}
.dm-btn:hover{transform:translateY(-1px)}.dm-btn:active{transform:scale(.98)}
.dm-btn.primary{background:#a8461a;border-color:#a8461a;color:#fff}.dm-btn.primary:hover{background:#8f3a14}
.dm-btn.danger{background:#b3261e;border-color:#b3261e;color:#fff}
.dm-btn.ghost{background:transparent}
.dm-btn.sm{padding:5px 11px;font-size:12px;border-radius:9px}
.dm-btn[disabled]{opacity:.55;cursor:not-allowed;transform:none}
.dm-btn:focus-visible,.dm-scope a:focus-visible,.dm-scope input:focus-visible,.dm-scope select:focus-visible,.dm-scope textarea:focus-visible{outline:3px solid #f18927;outline-offset:2px}
.dm-card{background:var(--dm-card,#fff);border:1px solid var(--dm-line,#eadfd8);border-radius:16px;padding:16px;box-shadow:0 6px 18px rgba(68,46,31,.05)}
.dm-grid{display:grid;gap:14px}.dm-grid.c2{grid-template-columns:repeat(2,minmax(0,1fr))}.dm-grid.c3{grid-template-columns:repeat(3,minmax(0,1fr))}
.dm-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px}
.dm-kpi{background:var(--dm-card);border:1px solid var(--dm-line);border-radius:14px;padding:12px 14px;text-align:right;cursor:pointer;font:inherit;color:var(--dm-ink);border-inline-start:5px solid #a8461a;transition:transform .15s,box-shadow .2s}
.dm-kpi:hover{transform:translateY(-2px);box-shadow:0 10px 22px rgba(68,46,31,.1)}
.dm-kpi span{display:block;font-size:12.5px;color:var(--dm-mut)}.dm-kpi strong{display:block;font-size:28px;line-height:1.2}.dm-kpi small{color:var(--dm-mut)}
.dm-kpi.bad{border-inline-start-color:#b3261e}.dm-kpi.bad strong{color:#b3261e}.dm-kpi.good{border-inline-start-color:#218558}.dm-kpi.warn{border-inline-start-color:#d9a016}
.dm-filters{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px}
.dm-filters label{display:grid;gap:3px;font-size:12px;font-weight:700;color:var(--dm-mut)}
.dm-filters input,.dm-filters select,.dm-form input,.dm-form select,.dm-form textarea{border:1px solid var(--dm-line,#cdbfb6);border-radius:10px;padding:8px 10px;background:var(--dm-card,#fff);color:var(--dm-ink,#3a332f);font:inherit;min-width:0}
.dm-table-wrap{overflow:auto;border:1px solid var(--dm-line);border-radius:14px;background:var(--dm-card)}
.dm-table{width:100%;border-collapse:collapse;min-width:880px}
.dm-table th,.dm-table td{padding:10px 12px;border-bottom:1px solid var(--dm-line);text-align:right;font-size:13px;vertical-align:top}
.dm-table th{background:var(--dm-soft);color:var(--dm-mut);position:sticky;top:0;cursor:pointer;white-space:nowrap}
.dm-table tbody tr{cursor:pointer}.dm-table tbody tr:hover{background:var(--dm-soft)}
.dm-table td.ref{font-weight:800;color:var(--dm-brand);white-space:nowrap}
.dm-badge{display:inline-block;border-radius:999px;padding:2px 10px;font-size:11.5px;font-weight:800;background:#eee;color:#444;white-space:nowrap}
.s-draft{background:#ece9e6;color:#4a4540}.s-pa{background:#fff1d6;color:#7a4a0c}.s-ap{background:#e0ecfa;color:#1f4f85}.s-pas{background:#efe3f6;color:#5d2c75}
.s-as{background:#dcf1ee;color:#12625a}.s-ex{background:#ffe6cf;color:#8a3f0a}.s-au{background:#fff6bf;color:#6b5a00}.s-pv{background:#e3e5fb;color:#2b3585}
.s-re{background:#fde0e0;color:#8f2020}.s-co{background:#d9f1e3;color:#17623f}.s-cl{background:#17623f;color:#fff}.s-ca{background:#ddd;color:#555;text-decoration:line-through}.s-late{background:#b3261e;color:#fff}
.dm-prio{font-size:12px;font-weight:800}.p-critical{color:#b3261e}.p-high{color:#b3601a}.p-medium{color:#6b5f59}.p-low{color:#218558}
.dm-bar{display:inline-block;width:80px;height:9px;border-radius:99px;background:var(--dm-soft);vertical-align:middle;overflow:hidden;border:1px solid var(--dm-line)}
.dm-bar i{display:block;height:100%;background:linear-gradient(90deg,#cf6028,#f18927)}.dm-bar.done i{background:#218558}
.dm-pct{margin-inline-start:6px;color:var(--dm-mut)}
.dm-late{color:#b3261e;font-weight:800}.dm-soon{color:#9a5a11;font-weight:700}
.dm-nodata{color:var(--dm-mut);padding:20px;text-align:center}
.dm-fig{margin:0;display:flex;gap:14px;flex-wrap:wrap;align-items:center}.dm-fig svg{width:100%;max-width:560px;height:auto}
.dm-fig svg[viewBox="0 0 140 140"]{max-width:150px}
.dm-donut-n{font-size:24px;font-weight:800;fill:var(--dm-ink)}.dm-ax{font-size:9px;fill:var(--dm-mut)}.dm-axis{stroke:var(--dm-line)}
.dm-legend{list-style:none;margin:0;padding:0;display:grid;gap:4px;font-size:12.5px}.dm-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-inline-end:6px}
.dm-bars{display:grid;gap:8px}.dm-brow{display:grid;grid-template-columns:130px 1fr 52px;gap:8px;align-items:center;font-size:12.5px}
.dm-brow small{grid-column:2/4;color:var(--dm-mut);margin-top:-4px}
.dm-btrack{background:var(--dm-soft);border-radius:99px;height:12px;overflow:hidden;border:1px solid var(--dm-line)}.dm-btrack i{display:block;height:100%;background:linear-gradient(90deg,#cf6028,#f18927)}
.dm-tabs{display:flex;gap:4px;border-bottom:2px solid var(--dm-line);margin:12px 0;flex-wrap:wrap}
.dm-tabs button{border:0;background:transparent;font:inherit;font-weight:700;padding:9px 14px;cursor:pointer;color:var(--dm-mut);border-bottom:3px solid transparent;margin-bottom:-2px}
.dm-tabs button[aria-selected=true]{color:var(--dm-brand);border-bottom-color:var(--dm-brand)}
.dm-timeline{list-style:none;margin:0;padding:0 14px 0 0;border-inline-start:0;display:grid;gap:12px;position:relative}
.dm-timeline li{position:relative;padding-inline-start:18px}.dm-timeline li::before{content:"";position:absolute;inset-inline-start:0;top:7px;width:10px;height:10px;border-radius:50%;background:var(--dm-brand)}
.dm-timeline li small{color:var(--dm-mut)}
.dm-dialog{border:0;border-radius:18px;padding:0;width:min(94vw,560px);max-height:92vh;color:#3a332f;box-shadow:0 25px 80px rgba(0,0,0,.28)}
.dm-dialog.wide{width:min(96vw,760px)}.dm-dialog::backdrop{background:rgba(35,28,24,.5)}
.dm-form{padding:18px 20px;display:grid;gap:12px;max-height:88vh;overflow:auto;background:#fff}
.dm-dlg-head{display:flex;justify-content:space-between;align-items:center}.dm-dlg-head h3{margin:0;font-size:18px}
.dm-x{border:1px solid #eadfd8;background:#fff;border-radius:9px;width:34px;height:34px;cursor:pointer}
.dm-field{display:grid;gap:4px;border:0;padding:0;margin:0}.dm-lab{font-weight:700;font-size:13px}.dm-help{color:#6b5f59}
.dm-check{display:flex;align-items:center;gap:8px}.dm-check input{width:auto}
.dm-multi{display:grid;grid-template-columns:repeat(2,1fr);gap:4px;max-height:160px;overflow:auto;border:1px solid #eadfd8;border-radius:10px;padding:8px}
.dm-multi label{display:flex;gap:6px;align-items:center;font-size:13px}.dm-multi input{width:auto}
.dm-info{background:#f9f4ee;border-radius:10px;padding:8px 10px;font-size:13px;color:#4a403b}.dm-intro{margin:0;color:#4a403b}
.dm-err{color:#b3261e;font-weight:700;margin:0;min-height:1.2em}.dm-acts{display:flex;gap:8px;justify-content:flex-start}
.dm-dialog .dm-form input,.dm-dialog .dm-form select,.dm-dialog .dm-form textarea{background:#fff;color:#3a332f}
.dm-banner{background:#fff7e6;border:1px solid #f0d9a8;border-radius:12px;padding:10px 14px;margin-bottom:12px;color:#6b4a07}
.dm-theme-btn{position:absolute;inset-inline-end:0;top:0}
.dm-info-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
.dm-info-grid div{background:var(--dm-soft);border-radius:10px;padding:8px 12px}.dm-info-grid span{display:block;font-size:12px;color:var(--dm-mut)}.dm-info-grid b{font-size:14px}
.dm-text{white-space:pre-wrap;background:var(--dm-soft);border-radius:12px;padding:12px 14px;line-height:1.9}
.dm-list{display:grid;gap:10px}.dm-item{border:1px solid var(--dm-line);border-radius:12px;padding:10px 14px;background:var(--dm-card)}
.dm-item .meta{display:flex;gap:10px;flex-wrap:wrap;color:var(--dm-mut);font-size:12px}
.dm-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
@media(max-width:900px){.dm-grid.c2,.dm-grid.c3{grid-template-columns:1fr}.dm-brow{grid-template-columns:90px 1fr 44px}}
.dm-extract{display:none!important}html[data-dm="1"] .dm-extract{display:inline-flex!important}
.dm-followup{display:flex;gap:8px;align-items:center;font-weight:600;margin:10px 0}.dm-followup input{width:auto}
.dm-acts-row{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.dm-acts-top{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.dm-chk{display:flex!important;align-items:center;gap:6px;flex-direction:row}.dm-chk input{width:auto}
@media print{.dm-noprint{display:none!important}}
`;
  if (!document.getElementById('dm-style')) { const st = document.createElement('style'); st.id = 'dm-style'; st.textContent = CSS; document.head.appendChild(st); }
  DM.theme = () => { try { return localStorage.getItem('ehsan_dm_theme') || 'light'; } catch { return 'light'; } };
  DM.setTheme = t => { document.documentElement.dataset.dmTheme = t; try { localStorage.setItem('ehsan_dm_theme', t); } catch { /* غير متاح */ } };
  DM.setTheme(DM.theme());
})();
