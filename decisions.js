(() => {
  // متابعة القرارات: مؤشرات، لوحة/قائمة مهام بتصفية، حساب التأخر تلقائيًا، وسجل قرارات (تصويتات مغلقة وقرارات بالتمرير) مع تقدّم التنفيذ.
  // يستخدم الجداول الحالية فقط: tasks, meetings, votes, circular_decisions, profiles. لا ترحيل جديد.
  // [افتراض] tasks(id, title, description, assignee_id, due_date, status, priority, meeting_id, created_by) وقيم الأولوية: منخفضة/متوسطة/عالية.
  const {esc, toast, fmtDate, empty, busy, failed, onOpen, session, waitDb} = window.ehsanUI;
  const $ = s => document.querySelector(s);
  const DAY = 86400000;
  const PRIORITIES = ['عالية', 'متوسطة', 'منخفضة'];
  const PRIO_RANK = {'عالية': 0, 'متوسطة': 1, 'منخفضة': 2};
  const VIEW_KEY = 'ehsan_df_view';

  const CSS = `
.df-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:14px 0}
.df-kpi{background:#fff;border:1px solid var(--line,#eadfd8);border-radius:16px;padding:14px 16px;text-align:right;cursor:pointer;font:inherit;color:inherit;border-inline-start:5px solid var(--primary,#cf6028);transition:transform .15s,box-shadow .2s}
.df-kpi:hover{transform:translateY(-2px);box-shadow:0 10px 22px rgba(68,46,31,.08)}
.df-kpi:focus-visible{outline:3px solid #f18927;outline-offset:2px}
.df-kpi span{display:block;font-size:13px;color:#6b5f59}
.df-kpi strong{display:block;font-size:30px;line-height:1.2}
.df-kpi small{color:#6b5f59}
.df-kpi.danger{border-inline-start-color:#b64242}.df-kpi.danger strong{color:#b64242}
.df-kpi.warn{border-inline-start-color:#d9a016}
.df-kpi.good{border-inline-start-color:#218558}.df-kpi.good strong{color:#218558}
.df-tabs{display:flex;gap:6px;border-bottom:2px solid var(--line,#eadfd8);margin-bottom:14px}
.df-tabs button{border:0;background:transparent;font:inherit;font-weight:700;padding:10px 16px;cursor:pointer;color:#6b5f59;border-bottom:3px solid transparent;margin-bottom:-2px}
.df-tabs button[aria-selected=true]{color:#a8461a;border-bottom-color:#a8461a}
.df-filters{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
.df-filters input[type=search]{flex:1;min-width:180px}
.df-filters select{width:auto;min-width:140px}
.df-check{display:flex;align-items:center;gap:6px;font-weight:600;font-size:13px}
.df-check input{width:auto}
.df-view{display:flex;gap:6px;margin-inline-start:auto}
.df-view button[aria-pressed=true]{background:#a8461a;color:#fff;border-color:#a8461a}
.df-board{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.df-col{background:var(--bg,#f9f4ee);border:1px solid var(--line,#eadfd8);border-radius:16px;padding:12px;min-height:240px}
.df-col h3{margin:0 0 10px;display:flex;justify-content:space-between;font-size:15px}
.df-col h3 small{background:#fff;border-radius:999px;padding:0 9px;font-weight:700}
.df-cards{display:grid;gap:10px}
.df-card{background:#fff;border:1px solid var(--line,#eadfd8);border-radius:13px;padding:12px;border-inline-start:5px solid #afa5a2;display:grid;gap:6px}
.df-card.p0{border-inline-start-color:#b64242}.df-card.p1{border-inline-start-color:#d9a016}.df-card.p2{border-inline-start-color:#218558}
.df-card.late{background:#fff7f6}
.df-card h4{margin:0;font-size:15px;line-height:1.5}
.df-meta{display:flex;gap:8px;flex-wrap:wrap;font-size:12px;color:#6b5f59;align-items:center}
.df-due{font-weight:800}.df-due.late{color:#b64242}.df-due.soon{color:#9a5a11}.df-due.ok{color:#218558}
.df-tag{display:inline-block;border-radius:999px;padding:1px 9px;font-size:11px;font-weight:700;background:#f3eee9;color:#4a403b}
.df-tag.p0{background:#fdeaea;color:#8f2d2d}.df-tag.p1{background:#fff1df;color:#7a4a0c}.df-tag.p2{background:#e9f6ef;color:#17623f}.df-tag.late{background:#b64242;color:#fff}
.df-act{display:flex;gap:6px;flex-wrap:wrap}
.df-act .btn{padding:6px 10px;font-size:12px}
.df-bar{background:#f3eee9;border-radius:999px;height:10px;overflow:hidden;min-width:120px}
.df-bar i{display:block;height:100%;background:linear-gradient(90deg,#cf6028,#f18927);border-radius:999px}
.df-bar.done i{background:#218558}
.df-reg{display:grid;gap:8px}
.df-reg .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
@media(max-width:900px){.df-board{grid-template-columns:1fr}.df-view{margin-inline-start:0}}
`;
  if (!document.getElementById('decisions-style')) {
    const st = document.createElement('style'); st.id = 'decisions-style'; st.textContent = CSS; document.head.appendChild(st);
  }

  let db, me, tasks = [], meetings = [], profiles = [], votes = [], circulars = [];
  const F = {q: '', assignee: '', meeting: '', priority: '', overdue: false, status: '', view: 'board'};
  try { F.view = localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'board'; } catch { /* غير متاح */ }

  const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const dueDate = t => t.due_date ? new Date(String(t.due_date).slice(0, 10) + 'T00:00:00') : null;
  const isDone = t => t.status === 'مكتملة';
  const isOverdue = t => !isDone(t) && dueDate(t) && dueDate(t) < today();
  const colOf = t => isDone(t) ? 'done' : (t.status === 'قيد التنفيذ' || t.status === 'متأخرة') ? 'progress' : 'new';
  const nameOf = id => profiles.find(p => p.id === id)?.full_name || 'غير مسند';
  const meetingOf = id => meetings.find(m => m.id === id);

  function dueInfo(t) {
    const d = dueDate(t);
    if (!d) return {text: 'بلا موعد', cls: ''};
    const diff = Math.round((d - today()) / DAY);
    if (isDone(t)) return {text: fmtDate(t.due_date), cls: ''};
    // صياغة عربية صحيحة للعدد: يوم، يومان، 3–10 أيام، 11 يومًا فأكثر
    const days = n => n === 1 ? 'يوم واحد' : n === 2 ? 'يومان' : n <= 10 ? `${n} أيام` : `${n} يومًا`;
    if (diff < 0) return {text: `متأخرة ${days(-diff)}`, cls: 'late'};
    if (diff === 0) return {text: 'تستحق اليوم', cls: 'soon'};
    if (diff === 1) return {text: 'غدًا', cls: 'soon'};
    if (diff <= 7) return {text: `بعد ${days(diff)}`, cls: 'soon'};
    return {text: fmtDate(t.due_date), cls: 'ok'};
  }

  function filtered() {
    const q = F.q.trim().toLowerCase();
    return tasks.filter(t => {
      if (F.assignee === 'me' ? t.assignee_id !== me.uid : F.assignee && t.assignee_id !== F.assignee) return false;
      if (F.meeting && t.meeting_id !== F.meeting) return false;
      if (F.priority && t.priority !== F.priority) return false;
      if (F.overdue && !isOverdue(t)) return false;
      if (q && !`${t.title} ${t.description || ''} ${nameOf(t.assignee_id)} ${meetingOf(t.meeting_id)?.title || ''}`.toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => (isOverdue(b) - isOverdue(a)) || ((dueDate(a)?.getTime() ?? Infinity) - (dueDate(b)?.getTime() ?? Infinity)) || ((PRIO_RANK[a.priority] ?? 1) - (PRIO_RANK[b.priority] ?? 1)));
  }

  // ───────────── المؤشرات ─────────────
  function renderKpis() {
    const open = tasks.filter(t => !isDone(t)), late = open.filter(isOverdue);
    const soon = open.filter(t => { const d = dueDate(t); return d && !isOverdue(t) && (d - today()) / DAY <= 7; });
    const mine = open.filter(t => t.assignee_id === me.uid);
    const rate = tasks.length ? Math.round(100 * (tasks.length - open.length) / tasks.length) : null;
    const k = [
      ['dfk-open', '', 'مهام مفتوحة', open.length, 'قيد المتابعة'],
      ['dfk-late', late.length ? 'danger' : 'good', 'متأخرة', late.length, late.length ? 'تحتاج تدخلًا' : 'لا تأخير'],
      ['dfk-soon', soon.length ? 'warn' : '', 'تستحق خلال 7 أيام', soon.length, 'استعدّ لها'],
      ['dfk-mine', '', 'مهامي المفتوحة', mine.length, 'المسندة إليّ'],
      ['dfk-rate', 'good', 'نسبة الإنجاز', rate === null ? '—' : rate + '%', `${tasks.length - open.length} من ${tasks.length}`]
    ];
    $('#dfKpis').innerHTML = k.map(([id, cls, a, b, c]) => `<button type="button" class="df-kpi ${cls}" data-kpi="${id}"><span>${esc(a)}</span><strong>${esc(b)}</strong><small>${esc(c)}</small></button>`).join('');
  }

  // ───────────── اللوحة والقائمة ─────────────
  function actions(t) {
    const a = [];
    if (colOf(t) === 'new') a.push(`<button class="btn small ghost df-move" data-id="${t.id}" data-status="قيد التنفيذ">ابدأ</button>`);
    if (!isDone(t)) a.push(`<button class="btn small primary df-move" data-id="${t.id}" data-status="مكتملة">أكمل</button>`);
    else a.push(`<button class="btn small ghost df-move" data-id="${t.id}" data-status="قيد التنفيذ">أعد الفتح</button>`);
    a.push(`<button class="btn small ghost df-edit" data-id="${t.id}">تعديل</button>`);
    if (me.admin || t.created_by === me.uid) a.push(`<button class="btn small ghost df-del" data-id="${t.id}">حذف</button>`);
    return a.join('');
  }

  function card(t) {
    const due = dueInfo(t), m = meetingOf(t.meeting_id), late = isOverdue(t), pr = PRIO_RANK[t.priority] ?? 1;
    return `<article class="df-card p${pr}${late ? ' late' : ''}"><h4>${esc(t.title)}</h4>
      <div class="df-meta"><span class="df-tag p${pr}">${esc(t.priority || 'متوسطة')}</span>${late ? '<span class="df-tag late">متأخرة</span>' : ''}<span class="df-due ${due.cls}">⏱ ${esc(due.text)}</span></div>
      <div class="df-meta"><span>👤 ${esc(nameOf(t.assignee_id))}</span>${m ? `<span>◫ ${esc(m.title)}</span>` : ''}</div>
      ${t.description ? `<div class="df-meta">${esc(String(t.description).slice(0, 120))}</div>` : ''}
      <div class="df-act">${actions(t)}</div></article>`;
  }

  function render() {
    renderKpis();
    const rows = filtered();
    $('#dfBoard').hidden = F.view !== 'board'; $('#dfList').hidden = F.view !== 'list';
    document.querySelectorAll('[data-dfview]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.dfview === F.view)));
    if (F.view === 'board') {
      const cols = [['new', 'جديدة'], ['progress', 'قيد التنفيذ'], ['done', 'مكتملة']];
      $('#dfBoard').innerHTML = cols.map(([k, name]) => {
        const items = rows.filter(t => colOf(t) === k);
        return `<div class="df-col"><h3>${name} <small>${items.length}</small></h3><div class="df-cards">${items.map(card).join('') || '<div class="meta">لا توجد مهام</div>'}</div></div>`;
      }).join('');
    } else {
      $('#dfList').innerHTML = `<table><thead><tr><th>المهمة</th><th>الاجتماع</th><th>المسؤول</th><th>الاستحقاق</th><th>الأولوية</th><th>الحالة</th><th></th></tr></thead><tbody>${rows.map(t => {
        const due = dueInfo(t), pr = PRIO_RANK[t.priority] ?? 1;
        return `<tr><td>${esc(t.title)}</td><td>${esc(meetingOf(t.meeting_id)?.title || '—')}</td><td>${esc(nameOf(t.assignee_id))}</td><td><span class="df-due ${due.cls}">${esc(due.text)}</span></td><td><span class="df-tag p${pr}">${esc(t.priority || 'متوسطة')}</span></td><td>${isOverdue(t) ? '<span class="df-tag late">متأخرة</span>' : esc(isDone(t) ? 'مكتملة' : t.status || 'جديدة')}</td><td><div class="df-act">${actions(t)}</div></td></tr>`;
      }).join('') || '<tr><td colspan="7">لا توجد مهام مطابقة.</td></tr>'}</tbody></table>`;
    }
  }

  // ───────────── سجل القرارات ─────────────
  function renderRegister() {
    const items = [];
    votes.filter(v => v.status === 'مغلق').forEach(v => {
      const r = v.result || {}, m = meetingOf(v.meeting_id);
      const outcome = r.quorum_met === false ? 'النصاب غير مكتمل' : r.approve > r.reject ? 'اعتُمد' : r.approve < r.reject ? 'لم يُعتمد' : r.approve === undefined ? 'مغلق' : 'تعادل';
      items.push({key: 'v' + v.id, kind: 'تصويت', title: v.question, meeting_id: v.meeting_id, meetingTitle: m?.title, date: v.closed_at || m?.gregorian_date, outcome,
        detail: r.approve !== undefined ? `موافق ${r.approve} · غير موافق ${r.reject} · ممتنع ${r.abstain}` : '', linked: tasks.filter(t => t.meeting_id === v.meeting_id)});
    });
    circulars.forEach(c => items.push({key: 'c' + c.id, kind: 'قرار بالتمرير', title: c.title, meeting_id: null, date: c.created_at, outcome: c.status || '—', detail: c.description || '', linked: []}));
    items.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    $('#dfRegister').innerHTML = items.map(it => {
      const total = it.linked.length, done = it.linked.filter(isDone).length, late = it.linked.filter(isOverdue).length, pct = total ? Math.round(100 * done / total) : 0;
      const prog = it.meeting_id ? (total ? `<div class="row"><div class="df-bar ${pct === 100 ? 'done' : ''}" aria-label="تقدم التنفيذ ${pct}%"><i style="width:${pct}%"></i></div><span class="meta">${done} من ${total} مكتملة${late ? ` · <b style="color:#b64242">${late} متأخرة</b>` : ''}</span></div>` : '<span class="meta">لا مهام مرتبطة بعد</span>') : '<span class="meta">القرارات بالتمرير لا ترتبط باجتماع، أضف لها مهام يدويًا</span>';
      const acts = `<button class="btn small primary df-new-for" data-key="${esc(it.key)}">＋ مهمة لهذا القرار</button>${it.meeting_id && total ? `<button class="btn small ghost df-show" data-meeting="${esc(it.meeting_id)}">عرض المهام</button>` : ''}`;
      return `<div class="list-item df-reg"><div class="row"><strong>${esc(it.title)}</strong><span class="df-tag ${it.outcome === 'اعتُمد' ? 'p2' : it.outcome === 'لم يُعتمد' || it.outcome === 'النصاب غير مكتمل' ? 'p0' : ''}">${esc(it.outcome)}</span><span class="df-tag">${esc(it.kind)}</span></div><div class="meta"><span>${esc(it.meetingTitle || '')}</span><span>${esc(it.date ? fmtDate(it.date) : '')}</span>${it.detail ? `<span>${esc(String(it.detail).slice(0, 100))}</span>` : ''}</div>${prog}<div class="df-act">${acts}</div></div>`;
    }).join('') || empty('لا توجد قرارات مسجلة بعد: القرارات الناتجة عن تصويت مغلق أو بالتمرير تظهر هنا.');
    $('#dfRegister')._items = items;
  }

  // ───────────── التحميل ─────────────
  async function load() {
    const [t, m, v, c, p] = await Promise.all([
      db.from('tasks').select('*').order('created_at', {ascending: false}).limit(1000),
      db.from('meetings').select('id,title,gregorian_date').order('gregorian_date', {ascending: false}).limit(300),
      db.from('votes').select('*').order('created_at', {ascending: false}).limit(300),
      db.from('circular_decisions').select('*').order('created_at', {ascending: false}).limit(200),
      db.from('profiles').select('id,full_name')
    ]);
    if (t.error) return failed('المهام', t.error);
    tasks = t.data || []; meetings = m.data || []; votes = v.data || []; circulars = c.data || []; profiles = p.data || [];
    fillSelects(); render(); renderRegister();
  }

  function fillSelects() {
    const opt = (v, t) => Object.assign(document.createElement('option'), {value: v, textContent: t});
    const a = $('#dfAssignee'), ka = a.value; a.replaceChildren(a.options[0], a.options[1], ...profiles.map(p => opt(p.id, p.full_name || 'عضو'))); a.value = ka;
    const m = $('#dfMeeting'), km = m.value; m.replaceChildren(m.options[0], ...meetings.map(x => opt(x.id, `${x.title} — ${x.gregorian_date}`))); m.value = km;
  }

  // ───────────── الإضافة والتعديل ─────────────
  function taskModal(t, preset = {}) {
    const people = profiles.map(p => `<option value="${esc(p.id)}"${(t?.assignee_id ?? preset.assignee_id) === p.id ? ' selected' : ''}>${esc(p.full_name || 'عضو')}</option>`).join('');
    const meets = meetings.map(x => `<option value="${esc(x.id)}"${(t?.meeting_id ?? preset.meeting_id) === x.id ? ' selected' : ''}>${esc(x.title)} — ${esc(x.gregorian_date)}</option>`).join('');
    const prio = PRIORITIES.map(p => `<option${(t?.priority || 'متوسطة') === p ? ' selected' : ''}>${p}</option>`).join('');
    window.openModal?.(t ? 'تعديل المهمة' : 'مهمة جديدة',
      `<label>العنوان<input id="mf_dt" maxlength="200" value="${esc(t?.title ?? preset.title ?? '')}" /></label>
       <label>الوصف<textarea id="mf_dd" rows="3" maxlength="500">${esc(t?.description ?? '')}</textarea></label>
       <label>المسؤول<select id="mf_da"><option value="">غير مسند</option>${people}</select></label>
       <label>الاجتماع / القرار المرتبط<select id="mf_dm"><option value="">بدون</option>${meets}</select></label>
       <label>تاريخ الاستحقاق<input id="mf_dx" type="date" value="${esc(String(t?.due_date ?? '').slice(0, 10))}" /></label>
       <label>الأولوية<select id="mf_dp">${prio}</select></label>`,
      async () => {
        // القيم تُقرأ قبل أي await لأن النافذة تُغلق بعد الحفظ مباشرة
        const row = {title: $('#mf_dt').value.trim(), description: $('#mf_dd').value.trim(), assignee_id: $('#mf_da').value || null, meeting_id: $('#mf_dm').value || null, due_date: $('#mf_dx').value || null, priority: $('#mf_dp').value};
        if (!row.title) return toast('أدخل عنوان المهمة');
        const r = t ? await db.from('tasks').update(row).eq('id', t.id) : await db.from('tasks').insert({...row, status: 'جديدة', created_by: me.uid});
        if (r.error) return toast('تعذر الحفظ: ' + r.error.message);
        toast(t ? 'تم تحديث المهمة' : 'تمت إضافة المهمة'); load();
      });
  }

  async function onAction(e) {
    const b = e.target.closest('.df-move, .df-edit, .df-del, .df-new-for, .df-show, [data-kpi]');
    if (!b) return;
    if (b.dataset.kpi) return applyKpi(b.dataset.kpi);
    if (b.classList.contains('df-edit')) return taskModal(tasks.find(x => x.id === b.dataset.id));
    if (b.classList.contains('df-show')) { F.meeting = b.dataset.meeting; $('#dfMeeting').value = F.meeting; switchTab('tasks'); return render(); }
    if (b.classList.contains('df-new-for')) {
      const it = $('#dfRegister')._items?.find(x => x.key === b.dataset.key);
      return taskModal(null, {title: 'تنفيذ: ' + (it?.title || ''), meeting_id: it?.meeting_id || ''});
    }
    await busy(b, async () => {
      let r;
      if (b.classList.contains('df-move')) r = await db.from('tasks').update({status: b.dataset.status}).eq('id', b.dataset.id);
      else { if (!confirm('حذف هذه المهمة؟')) return; r = await db.from('tasks').delete().eq('id', b.dataset.id); }
      if (r.error) return toast(r.error.message);
      load();
    });
  }

  function applyKpi(id) {
    Object.assign(F, {q: '', assignee: '', meeting: '', priority: '', overdue: false});
    if (id === 'dfk-late') F.overdue = true;
    if (id === 'dfk-mine') F.assignee = 'me';
    syncControls(); switchTab('tasks'); render();
  }
  function syncControls() {
    $('#dfSearch').value = F.q; $('#dfAssignee').value = F.assignee; $('#dfMeeting').value = F.meeting; $('#dfPriority').value = F.priority; $('#dfOverdue').checked = F.overdue;
  }
  function switchTab(name) {
    const reg = name === 'register';
    $('#dfTasksPane').hidden = reg; $('#dfRegisterPane').hidden = !reg;
    $('#dfTabTasks').setAttribute('aria-selected', String(!reg)); $('#dfTabReg').setAttribute('aria-selected', String(reg));
  }

  async function start() {
    db = await waitDb();
    if (!db) return;
    me = await session(db);
    if (!me) return;
    $('#dfAdd').addEventListener('click', () => taskModal(null));
    $('#dfSearch').addEventListener('input', e => { F.q = e.target.value; render(); });
    $('#dfAssignee').addEventListener('change', e => { F.assignee = e.target.value; render(); });
    $('#dfMeeting').addEventListener('change', e => { F.meeting = e.target.value; render(); });
    $('#dfPriority').addEventListener('change', e => { F.priority = e.target.value; render(); });
    $('#dfOverdue').addEventListener('change', e => { F.overdue = e.target.checked; render(); });
    document.querySelectorAll('[data-dfview]').forEach(b => b.addEventListener('click', () => { F.view = b.dataset.dfview; try { localStorage.setItem(VIEW_KEY, F.view); } catch { /* غير متاح */ } render(); }));
    document.querySelectorAll('.df-tabs [data-tab]').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
    $('#view-tasks').addEventListener('click', onAction);
    // لوحة المتابعة تتحدث لحظيًا عند تغيّر المهام من مستخدم آخر
    db.channel('df-live').on('postgres_changes', {event: '*', schema: 'public', table: 'tasks'}, () => { if ($('#view-tasks').classList.contains('active')) load(); }).subscribe();
    onOpen({tasks: load});
    if (location.hash === '#tasks') load();
  }
  start().catch(err => console.error('decisions', err));
})();
