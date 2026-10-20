(() => {
  // مساحتي (الساعات التطوعية) + الاجتماعات (مركز الدورة، الأزمات والطوارئ، طلبات الضيافة).
  // الجداول والصلاحيات في supabase/migrations/003_member_space.sql، وكل المنطق الحساس يُفرض هناك لا هنا.
  const $ = s => document.querySelector(s);
  const toast = m => window.showToast ? window.showToast(m) : alert(m);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const fmtDate = d => { try { return new Date(d).toLocaleDateString('ar-SA'); } catch { return d || ''; } };

  let db = null, uid = null, admin = false;
  const mode = {vol: 'mine', hosp: 'mine', crisis: 'mine'}; // mine = سجلي، all = للمدير

  const pill = (text, cls = '') => `<span class="status-pill ${cls}">${esc(text)}</span>`;
  const statusClass = s => ({'معتمدة': 'good', 'تم التسليم': 'good', 'تم الحل': 'good', 'مرفوضة': 'danger', 'ملغي': 'danger', 'عاجل': 'warn', 'حرجة': 'danger', 'عالية': 'warn', 'قيد المراجعة': 'warn', 'جديد': 'warn', 'مفتوحة': 'warn'}[s] || '');
  const empty = t => `<div class="list-item">${esc(t)}</div>`;
  const warnOnce = new Set();
  function failed(what, error) {
    console.error(what, error);
    if (warnOnce.has(what)) return;
    warnOnce.add(what);
    toast(`تعذر تحميل ${what}: ${error?.message || 'خطأ'}`);
  }
  const busy = async (btn, fn) => { if (btn.disabled) return; btn.disabled = true; try { await fn(); } finally { btn.disabled = false; } };

  async function loadMeetingsSelects() {
    const {data, error} = await db.from('meetings').select('id,title,gregorian_date').order('gregorian_date', {ascending: false}).limit(200);
    if (error) return failed('الاجتماعات', error);
    document.querySelectorAll('select.meeting-select').forEach(sel => {
      const first = sel.options[0], keep = sel.value;
      sel.replaceChildren(first, ...(data || []).map(m => { const o = document.createElement('option'); o.value = m.id; o.textContent = `${m.title} — ${m.gregorian_date}`; return o; }));
      sel.value = keep;
    });
  }

  // ───────────── الساعات التطوعية ─────────────
  async function loadVolunteer() {
    let q = db.from('volunteer_hours').select('*,meetings(title),profiles!volunteer_hours_user_id_fkey(full_name)').order('work_date', {ascending: false}).limit(200);
    q = mode.vol === 'all' ? q.eq('status', 'قيد المراجعة') : q.eq('user_id', uid);
    const {data, error} = await q;
    if (error) return failed('الساعات التطوعية', error);
    const rows = data || [];
    if (mode.vol === 'mine') {
      const sum = st => rows.filter(r => r.status === st).reduce((a, r) => a + Number(r.hours || 0), 0);
      $('#volApproved').textContent = sum('معتمدة');
      $('#volPending').textContent = sum('قيد المراجعة');
      $('#volCount').textContent = rows.length;
      $('#volLast').textContent = rows[0] ? fmtDate(rows[0].work_date) : '—';
    }
    $('#volListTitle').textContent = mode.vol === 'all' ? 'طلبات المراجعة' : 'سجلي';
    $('#volList').innerHTML = rows.map(r => {
      const who = mode.vol === 'all' ? `<span>${esc(r.profiles?.full_name || 'عضو')}</span>` : '';
      const acts = mode.vol === 'all'
        ? `<button class="btn small primary vol-review" data-id="${r.id}" data-status="معتمدة">اعتماد</button><button class="btn small ghost vol-review" data-id="${r.id}" data-status="مرفوضة">رفض</button>`
        : r.status === 'قيد المراجعة' ? `<button class="btn small ghost vol-delete" data-id="${r.id}">حذف</button>` : '';
      return `<div class="list-item"><strong>${esc(r.hours)} ساعة — ${esc(fmtDate(r.work_date))}</strong> ${pill(r.status, statusClass(r.status))}<p>${esc(r.activity)}</p><div class="meta">${who}<span>${esc(r.meetings?.title || '')}</span>${r.review_note ? `<span>ملاحظة المراجع: ${esc(r.review_note)}</span>` : ''}</div>${acts ? `<div class="item-actions">${acts}</div>` : ''}</div>`;
    }).join('') || empty(mode.vol === 'all' ? 'لا توجد طلبات بانتظار المراجعة.' : 'لم تسجّل ساعات بعد.');
  }

  async function submitVolunteer(e) {
    e.preventDefault();
    const form = e.currentTarget, f = new FormData(form);
    const hours = Number(f.get('hours')), date = f.get('work_date');
    if (!(hours >= 0.5 && hours <= 24)) return toast('عدد الساعات بين 0.5 و24');
    if (date > new Date().toISOString().slice(0, 10)) return toast('لا يمكن تسجيل ساعات بتاريخ مستقبلي');
    await busy(form.querySelector('[type=submit]'), async () => {
      const {error} = await db.from('volunteer_hours').insert({user_id: uid, work_date: date, hours, activity: String(f.get('activity')).trim(), meeting_id: f.get('meeting_id') || null});
      if (error) return toast('تعذر الإرسال: ' + error.message);
      form.reset();
      toast('تم إرسال الساعات للمراجعة');
      loadVolunteer();
    });
  }

  // ───────────── طلبات الضيافة ─────────────
  async function loadHospitality() {
    let q = db.from('hospitality_requests').select('*,meetings(title),profiles!hospitality_requests_requested_by_fkey(full_name)').order('created_at', {ascending: false}).limit(100);
    if (mode.hosp === 'mine') q = q.eq('requested_by', uid);
    const {data, error} = await q;
    if (error) return failed('طلبات الضيافة', error);
    $('#hospListTitle').textContent = mode.hosp === 'all' ? 'كل الطلبات' : 'طلباتي';
    $('#hospList').innerHTML = (data || []).map(r => {
      let acts = '';
      if (admin && r.status !== 'تم التسليم' && r.status !== 'ملغي') {
        acts = (r.status === 'جديد' ? `<button class="btn small ghost hosp-status" data-id="${r.id}" data-status="قيد التجهيز">قيد التجهيز</button>` : '') + `<button class="btn small primary hosp-status" data-id="${r.id}" data-status="تم التسليم">تم التسليم</button><button class="btn small ghost hosp-status" data-id="${r.id}" data-status="ملغي">إلغاء</button>`;
      } else if (r.requested_by === uid && r.status === 'جديد') {
        acts = `<button class="btn small ghost hosp-status" data-id="${r.id}" data-status="ملغي">إلغاء الطلب</button>`;
      }
      return `<div class="list-item"><strong>${esc(r.meetings?.title || 'اجتماع')}</strong> ${pill(r.status, statusClass(r.status))} ${r.priority === 'عاجل' ? pill('عاجل', 'warn') : ''}<p>${esc((r.items || []).join('، '))} — ${esc(r.people)} شخص${r.location ? ' — ' + esc(r.location) : ''}</p>${r.notes ? `<div class="meta"><span>${esc(r.notes)}</span></div>` : ''}<div class="meta"><span>${esc(r.profiles?.full_name || '')}</span><span>${esc(fmtDate(r.created_at))}</span></div>${acts ? `<div class="item-actions">${acts}</div>` : ''}</div>`;
    }).join('') || empty('لا توجد طلبات.');
  }

  async function submitHospitality(e) {
    e.preventDefault();
    const form = e.currentTarget, f = new FormData(form);
    const items = f.getAll('items');
    if (!f.get('meeting_id')) return toast('اختر الاجتماع');
    if (!items.length) return toast('اختر صنفًا واحدًا على الأقل');
    await busy(form.querySelector('[type=submit]'), async () => {
      const {error} = await db.from('hospitality_requests').insert({meeting_id: f.get('meeting_id'), requested_by: uid, items, people: Number(f.get('people')) || 1, priority: f.get('priority'), location: String(f.get('location') || '').trim(), notes: String(f.get('notes') || '').trim()});
      if (error) return toast('تعذر إرسال الطلب: ' + error.message);
      form.reset();
      toast('تم إرسال طلب الضيافة');
      loadHospitality();
    });
  }

  // ───────────── الأزمات والطوارئ ─────────────
  async function loadCrisis() {
    let q = db.from('incidents').select('*,meetings(title),profiles!incidents_reported_by_fkey(full_name)').order('created_at', {ascending: false}).limit(100);
    if (mode.crisis === 'mine') q = q.eq('reported_by', uid);
    const {data, error} = await q;
    if (error) return failed('البلاغات', error);
    $('#crisisListTitle').textContent = mode.crisis === 'all' ? 'كل البلاغات' : 'بلاغاتي';
    $('#crisisList').innerHTML = (data || []).map(r => {
      const acts = admin && r.status !== 'تم الحل'
        ? (r.status === 'مفتوحة' ? `<button class="btn small ghost crisis-status" data-id="${r.id}" data-status="قيد المعالجة">بدء المعالجة</button>` : '') + `<button class="btn small primary crisis-status" data-id="${r.id}" data-status="تم الحل">تم الحل</button>` : '';
      return `<div class="list-item"><strong>${esc(r.kind)}</strong> ${pill(r.severity, statusClass(r.severity))} ${pill(r.status, statusClass(r.status))}<p>${esc(r.description)}</p><div class="meta"><span>${esc(r.meetings?.title || '')}</span><span>${esc(r.profiles?.full_name || '')}</span><span>${esc(fmtDate(r.created_at))}</span>${r.resolution_note ? `<span>الحل: ${esc(r.resolution_note)}</span>` : ''}</div>${acts ? `<div class="item-actions">${acts}</div>` : ''}</div>`;
    }).join('') || empty('لا توجد بلاغات.');
  }

  async function submitCrisis(e) {
    e.preventDefault();
    const form = e.currentTarget, f = new FormData(form);
    await busy(form.querySelector('[type=submit]'), async () => {
      const {error} = await db.from('incidents').insert({reported_by: uid, kind: f.get('kind'), severity: f.get('severity'), meeting_id: f.get('meeting_id') || null, description: String(f.get('description')).trim()});
      if (error) return toast('تعذر إرسال البلاغ: ' + error.message);
      form.reset();
      toast('تم إرسال البلاغ وإشعار المدير');
      loadCrisis();
    });
  }

  // ───────────── مركز دورة الاجتماعات ─────────────
  const STAGES = [
    ['التحضير', 'meetings'], ['الدعوات', 'meetings'], ['الانعقاد والحضور', 'meetings'],
    ['التصويت', 'votes'], ['المحضر', 'minutes'], ['الاعتماد', 'minutes'], ['متابعة المهام', 'tasks']
  ];

  async function loadCycle() {
    const sel = t => db.from(t.name).select(t.cols).limit(5000);
    const tables = [{name: 'agenda_items', cols: 'meeting_id'}, {name: 'meeting_invitations', cols: 'meeting_id'}, {name: 'meeting_attendees', cols: 'meeting_id'},
      {name: 'votes', cols: 'meeting_id,status'}, {name: 'minutes', cols: 'meeting_id,status'}, {name: 'tasks', cols: 'meeting_id,status'}, {name: 'meeting_reminder_rules', cols: '*'}];
    const [ms, ...res] = await Promise.all([db.from('meetings').select('id,title,gregorian_date,status').order('gregorian_date', {ascending: false}).limit(200), ...tables.map(sel)]);
    if (ms.error) return failed('الاجتماعات', ms.error);
    const by = {}, unreadable = [];
    res.forEach((r, i) => {
      // قواعد التذكير يراها المنظّم والمدير فقط (أو لم يُنفَّذ الترحيل 005 بعد)؛ لا نُنبّه لغيابها
      if (r.error && tables[i].name !== 'meeting_reminder_rules') unreadable.push(tables[i].name);
      const map = by[tables[i].name] = {};
      (r.data || []).forEach(x => { (map[x.meeting_id] ||= []).push(x); });
    });
    const today = new Date().toISOString().slice(0, 10);
    const rows = (ms.data || []).map(m => {
      const g = n => by[n][m.id] || [];
      const votes = g('votes'), minutes = g('minutes'), tasks = g('tasks');
      const done = [
        g('agenda_items').length > 0,
        g('meeting_invitations').length > 0,
        g('meeting_attendees').length > 0,
        votes.length > 0 && votes.every(v => v.status === 'مغلق'),
        minutes.length > 0,
        minutes.some(x => x.status === 'معتمد'),
        tasks.length > 0 && tasks.every(t => t.status === 'مكتملة')
      ];
      // لا يوجد تصويت = مرحلة غير لازمة، تُعدّ منجزة إذا وُجد محضر
      if (!votes.length && minutes.length) done[3] = true;
      const current = done.findIndex(d => !d);
      return {m, done, current, upcoming: m.gregorian_date >= today};
    });
    const showAll = $('#cycleFilter').value === 'all';
    const list = rows.filter(r => showAll || r.current !== -1);
    const counts = STAGES.map((_, i) => rows.filter(r => r.current === i).length);
    $('#cycleStats').innerHTML = STAGES.map(([name], i) => `<article><span>${esc(name)}</span><strong>${counts[i]}</strong><small>اجتماع في هذه المرحلة</small></article>`).join('') + `<article><span>مكتملة الدورة</span><strong>${rows.filter(r => r.current === -1).length}</strong><small>اجتماع</small></article>`;
    const note = unreadable.length ? `<div class="list-item">تعذر قراءة: ${esc(unreadable.join('، '))} (قد تكون الصلاحيات تمنع ذلك)، وستظهر مراحلها غير منجزة.</div>` : '';
    $('#cycleList').innerHTML = note + (list.map(({m, done, current}) => {
      const track = STAGES.map(([name], i) => `<span class="stage ${done[i] ? 'done' : i === current ? 'current' : ''}">${done[i] ? '✓ ' : ''}${esc(name)}</span>`).join('');
      const next = current === -1 ? pill('اكتملت الدورة', 'good') : `<button class="btn small primary" data-view-jump="${STAGES[current][1]}">المرحلة التالية: ${esc(STAGES[current][0])}</button>`;
      const rem = window.ehsanReminders?.summary((by.meeting_reminder_rules?.[m.id] || [])[0]);
      const remBtn = `<button class="btn small ghost rem-edit" data-id="${m.id}" data-title="${esc(m.title)}">🔔 التذكير</button>`;
      return `<div class="list-item"><strong>${esc(m.title)}</strong><div class="meta"><span>${esc(m.gregorian_date)}</span>${pill(m.status || '')}${rem ? `<span>🔔 ${esc(rem)}</span>` : ''}</div><div class="stage-track">${track}</div><div class="item-actions">${next}${remBtn}</div></div>`;
    }).join('') || empty('لا توجد اجتماعات في هذه القائمة.'));
  }

  // ───────────── الربط ─────────────
  function bind() {
    $('#volForm')?.addEventListener('submit', submitVolunteer);
    $('#hospForm')?.addEventListener('submit', submitHospitality);
    $('#crisisForm')?.addEventListener('submit', submitCrisis);
    $('#cycleFilter')?.addEventListener('change', loadCycle);
    $('#emergencyMeetingBtn')?.addEventListener('click', () => {
      window.ehsanActivateView?.('new-meeting');
      const t = document.querySelector('#meetingForm [name=title]');
      if (t && !t.value) t.value = 'اجتماع طارئ: ';
      t?.focus();
    });
    [['volReviewToggle', 'vol', 'عرض طلبات المراجعة', 'عرض سجلي', loadVolunteer], ['hospAllToggle', 'hosp', 'عرض كل الطلبات', 'عرض طلباتي', loadHospitality], ['crisisAllToggle', 'crisis', 'عرض كل البلاغات', 'عرض بلاغاتي', loadCrisis]].forEach(([id, key, a, b, fn]) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.hidden = !admin;
      btn.addEventListener('click', () => { mode[key] = mode[key] === 'mine' ? 'all' : 'mine'; btn.textContent = mode[key] === 'mine' ? a : b; fn(); });
    });
    $('#cycleList')?.addEventListener('click', e => {
      const b = e.target.closest('.rem-edit');
      if (b) window.ehsanReminders?.openEditor(b.dataset.id, b.dataset.title);
    });
    document.addEventListener('click', async e => {
      const t = e.target.closest('.vol-review, .vol-delete, .hosp-status, .crisis-status');
      if (!t || t.disabled) return;
      await busy(t, async () => {
        const id = t.dataset.id, st = t.dataset.status;
        if (t.classList.contains('vol-delete')) {
          if (!confirm('حذف هذا التسجيل؟')) return;
          const {error} = await db.from('volunteer_hours').delete().eq('id', id);
          return error ? toast(error.message) : loadVolunteer();
        }
        if (t.classList.contains('vol-review')) {
          const note = st === 'مرفوضة' ? (prompt('سبب الرفض (اختياري):') ?? null) : '';
          if (note === null) return;
          const {error} = await db.from('volunteer_hours').update({status: st, review_note: note}).eq('id', id);
          return error ? toast(error.message) : loadVolunteer();
        }
        if (t.classList.contains('hosp-status')) {
          const {error} = await db.from('hospitality_requests').update({status: st}).eq('id', id);
          return error ? toast(error.message) : loadHospitality();
        }
        const note = st === 'تم الحل' ? (prompt('ما الذي تم لمعالجة البلاغ؟ (اختياري)') ?? null) : '';
        if (note === null) return;
        const {error} = await db.from('incidents').update({status: st, resolution_note: note}).eq('id', id);
        return error ? toast(error.message) : loadCrisis();
      });
    });
    // تحميل بيانات الصفحة عند فتحها
    document.addEventListener('click', e => {
      const v = e.target.closest('[data-view],[data-view-jump]');
      const name = v?.dataset.view || v?.dataset.viewJump;
      if (name === 'cycle') loadCycle();
      if (name === 'volunteer') loadVolunteer();
      if (name === 'hospitality') loadHospitality();
      if (name === 'crisis') loadCrisis();
      if (['volunteer', 'hospitality', 'crisis'].includes(name)) loadMeetingsSelects();
    }, true); // مرحلة الالتقاط: nav-fix.js يوقف انتشار نقرات التنقل قبل مرحلة الفقاعة
  }

  async function start() {
    for (let i = 0; i < 40 && !window.ehsanDB; i++) await new Promise(r => setTimeout(r, 250));
    db = window.ehsanDB;
    if (!db) return;
    const {data: {session}} = await db.auth.getSession();
    if (!session) return;
    uid = session.user.id;
    const r = await db.rpc('is_admin');
    admin = !r.error && r.data === true;
    bind();
    loadMeetingsSelects();
    const hash = location.hash.replace('#', '');
    if (hash === 'cycle') loadCycle();
    if (hash === 'volunteer') loadVolunteer();
    if (hash === 'hospitality') loadHospitality();
    if (hash === 'crisis') loadCrisis();
  }
  start().catch(err => console.error('member-space', err));
})();
