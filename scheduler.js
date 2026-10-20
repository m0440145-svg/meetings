(() => {
  // جدولة الاجتماعات: تقويم شهري + نافذة جدولة (تكرار، كشف التعارض، حجز قاعة، تذكيرات) + تغيير موعد اجتماع قائم.
  // تستخدم جدول meetings الحالي (وhall_bookings من الترحيل 004 وreminders من 005 إن وُجدا) ولا تحتاج جداول جديدة.
  const {esc, toast, pill, empty, busy, failed, onOpen, session, waitDb} = window.ehsanUI;
  const $ = s => document.querySelector(s);
  const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const pad = n => String(n).padStart(2, '0');
  const key = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseKey = s => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  const toMin = t => t ? (+String(t).slice(0, 2)) * 60 + (+String(t).slice(3, 5)) : null;
  const hhmm = t => String(t || '').slice(0, 5);
  const fGreg = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {month: 'long', year: 'numeric'});
  const fHijriMonth = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', {month: 'long', year: 'numeric'});
  const fHijriDay = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', {day: 'numeric'});
  const fHijriFull = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', {day: 'numeric', month: 'long', year: 'numeric'});
  const safeHttps = u => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };

  const CSS = `
.sched-bar{display:flex;gap:12px;justify-content:space-between;align-items:center;flex-wrap:wrap;margin-bottom:12px}
.sched-nav{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.sched-nav strong{min-width:210px;text-align:center}
.sched-bar select{width:auto;min-width:180px}
.sched-cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:1px;background:var(--line,#eadfd8);border:1px solid var(--line,#eadfd8);border-radius:14px;overflow:hidden}
.sched-dow{background:var(--bg,#f9f4ee);padding:8px 4px;text-align:center;font-weight:800;font-size:12px;color:#665a54}
.sched-cell{background:#fff;min-height:104px;padding:4px;display:flex;flex-direction:column;gap:3px;cursor:pointer;text-align:right;border:0;font:inherit;color:inherit}
.sched-cell:hover{background:#fffaf5}
.sched-cell.other{background:#fbfaf9;color:#b0a7a1}
.sched-cell.today .sched-day{background:var(--primary,#cf6028);color:#fff}
.sched-day{display:flex;justify-content:space-between;align-items:center;font-size:12px;font-weight:700;padding:1px 6px;border-radius:999px;width:fit-content;min-width:26px;gap:6px}
.sched-day small{font-weight:400;opacity:.7;font-size:10px}
.sched-ev{display:block;width:100%;text-align:right;border:0;border-radius:6px;padding:2px 6px;font:inherit;font-size:11px;background:#fdeadc;color:#8a3f17;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sched-ev:hover{background:#fbd9bf}
.sched-ev.done{background:#e9f6ef;color:#1d6b46}
.sched-more{font-size:11px;color:#84766e;padding:0 6px}
.sched-fields .check-grid{grid-template-columns:1fr 1fr}
#schedDialog,#schedDetail{max-width:680px;width:min(94%,680px)}
#schedDialog .modal-card,#schedDetail .modal-card{max-height:86vh;overflow:auto}
@media(max-width:700px){.sched-cell{min-height:70px}.sched-ev{font-size:10px;padding:1px 3px}.sched-day small{display:none}.sched-nav strong{min-width:0;width:100%;order:-1}}
`;
  if (!document.getElementById('scheduler-style')) {
    const st = document.createElement('style'); st.id = 'scheduler-style'; st.textContent = CSS; document.head.appendChild(st);
  }

  let db, me, committees = [], halls = [], cursor = new Date(), monthMeetings = [];
  cursor.setDate(1);

  // ───────────── التقويم ─────────────
  async function loadMonth() {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1), last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    let q = db.from('meetings').select('id,title,gregorian_date,start_time,end_time,committee_id,status,mode,location,created_by,committees(name)')
      .gte('gregorian_date', key(first)).lte('gregorian_date', key(last)).order('gregorian_date').order('start_time').limit(500);
    const c = $('#schedCommittee').value;
    if (c) q = q.eq('committee_id', c);
    const {data, error} = await q;
    if (error) return failed('الاجتماعات', error);
    monthMeetings = data || [];
    render();
  }

  function render() {
    $('#schedTitle').textContent = `${fGreg.format(cursor)} — ${fHijriMonth.format(new Date(cursor.getFullYear(), cursor.getMonth(), 15))}`;
    const cal = $('#schedCal');
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = new Date(first); start.setDate(1 - first.getDay()); // الأحد أول الأسبوع
    const todayKey = key(new Date());
    const byDay = {};
    monthMeetings.forEach(m => { (byDay[m.gregorian_date] ||= []).push(m); });
    const nodes = WEEKDAYS.map(n => { const d = document.createElement('div'); d.className = 'sched-dow'; d.textContent = n; return d; });
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      if (i >= 35 && d.getMonth() !== cursor.getMonth()) break; // لا نعرض أسبوعًا سادسًا كله من شهر آخر
      const k = key(d), cell = document.createElement('div');
      cell.className = 'sched-cell' + (d.getMonth() !== cursor.getMonth() ? ' other' : '') + (k === todayKey ? ' today' : '');
      cell.dataset.date = k; cell.setAttribute('role', 'button'); cell.tabIndex = 0;
      cell.setAttribute('aria-label', `جدولة اجتماع بتاريخ ${k}`);
      const dayEl = document.createElement('span'); dayEl.className = 'sched-day';
      dayEl.append(document.createTextNode(String(d.getDate())));
      const hj = document.createElement('small'); hj.textContent = fHijriDay.format(d); dayEl.append(hj);
      cell.append(dayEl);
      const list = byDay[k] || [];
      list.slice(0, 3).forEach(m => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'sched-ev' + (m.status === 'مكتمل' ? ' done' : ''); b.dataset.id = m.id;
        b.textContent = `${hhmm(m.start_time)} ${m.title}`; b.title = m.title;
        cell.append(b);
      });
      if (list.length > 3) { const more = document.createElement('span'); more.className = 'sched-more'; more.textContent = `+${list.length - 3} أخرى`; cell.append(more); }
      nodes.push(cell);
    }
    cal.replaceChildren(...nodes);
    $('#schedList').innerHTML = monthMeetings.map(m => `<div class="list-item"><strong>${esc(m.title)}</strong> ${pill(m.status || '')}<div class="meta"><span>${esc(m.gregorian_date)}</span><span>${esc(hhmm(m.start_time))}${m.end_time ? ' – ' + esc(hhmm(m.end_time)) : ''}</span><span>${esc(m.committees?.name || '')}</span><span>${esc(m.location || '')}</span></div><div class="item-actions"><button class="btn small ghost sched-open" data-id="${m.id}">التفاصيل</button></div></div>`).join('') || empty('لا توجد اجتماعات في هذا الشهر.');
  }

  // ───────────── التعارض ─────────────
  // يعتبر اجتماعين متعارضين إذا تداخل وقتهما في اليوم نفسه واشتركا في اللجنة أو المكان
  function overlaps(a, b) {
    const a0 = toMin(a.start_time), b0 = toMin(b.start_time);
    if (a0 === null || b0 === null) return false;
    const a1 = toMin(a.end_time) ?? a0 + 120, b1 = toMin(b.end_time) ?? b0 + 120;
    return a0 < b1 && b0 < a1;
  }
  async function findConflicts(candidates, ignoreId) {
    const dates = [...new Set(candidates.map(c => c.gregorian_date))];
    const {data, error} = await db.from('meetings').select('id,title,gregorian_date,start_time,end_time,committee_id,location').in('gregorian_date', dates);
    if (error) { failed('فحص التعارض', error); return []; }
    const out = [];
    candidates.forEach(c => (data || []).forEach(m => {
      if (m.id === ignoreId || m.gregorian_date !== c.gregorian_date || !overlaps(c, m)) return;
      const sameCommittee = c.committee_id && m.committee_id === c.committee_id;
      const sameLocation = c.location && m.location && c.location.trim() === m.location.trim();
      if (sameCommittee || sameLocation) out.push(`${m.gregorian_date} ${hhmm(m.start_time)} — ${m.title} (${sameLocation ? 'نفس المكان' : 'نفس اللجنة'})`);
    }));
    return out;
  }

  // ───────────── جدولة جديدة ─────────────
  function occurrenceDates(startKey, repeat, count) {
    const d0 = parseKey(startKey), out = [startKey];
    if (!repeat) return out;
    for (let i = 1; i < count; i++) {
      let d;
      if (repeat === 'monthly') {
        d = new Date(d0.getFullYear(), d0.getMonth() + i, 1);
        d.setDate(Math.min(d0.getDate(), new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); // 31 في شهر أقصر → آخر يوم
      } else {
        d = new Date(d0); d.setDate(d0.getDate() + i * (repeat === 'weekly' ? 7 : 14));
      }
      out.push(key(d));
    }
    return out;
  }

  function openSchedule(dateKey) {
    const f = $('#schedForm');
    f.reset();
    f.elements.date.value = dateKey || key(new Date());
    window.ehsanReminders?.render($('#schedRemBox'), null);
    $('#schedDialog').showModal();
    f.elements.title.focus();
  }

  async function submitSchedule(e) {
    e.preventDefault();
    const f = e.currentTarget, v = f.elements;
    const repeat = v.repeat.value, count = repeat ? Math.max(2, Math.min(12, parseInt(v.count.value, 10) || 2)) : 1;
    if (v.endTime.value && v.endTime.value <= v.time.value) return toast('وقت النهاية يجب أن يكون بعد وقت البداية');
    if (v.meetingUrl.value && !safeHttps(v.meetingUrl.value)) return toast('رابط الاجتماع يجب أن يبدأ بـ https://');
    const rem = window.ehsanReminders?.read($('#schedRemBox'));
    if (rem?.error) return toast(rem.error);
    const dates = occurrenceDates(v.date.value, repeat, count);
    const rows = dates.map(d => ({
      title: v.title.value.trim(), committee_id: v.committee.value, gregorian_date: d, hijri_date: fHijriFull.format(parseKey(d)),
      start_time: v.time.value, end_time: v.endTime.value || null, mode: v.mode.value, location: v.location.value.trim(),
      platform: v.platform.value, meeting_url: v.meetingUrl.value || null, description: '', created_by: me.uid, status: 'مجدول'
    }));
    await busy(f.querySelector('[type=submit]'), async () => {
      const conflicts = await findConflicts(rows);
      if (conflicts.length && !confirm(`يوجد تعارض مع:\n${conflicts.slice(0, 6).join('\n')}${conflicts.length > 6 ? '\n…' : ''}\n\nهل تريد الجدولة رغم ذلك؟`)) return;
      const {data, error} = await db.from('meetings').insert(rows).select('id,gregorian_date,start_time,end_time');
      if (error) return toast('تعذر حفظ الاجتماعات: ' + error.message);
      const problems = [];
      for (const m of data || []) {
        if (v.hall_id.value) {
          const s = new Date(`${m.gregorian_date}T${hhmm(m.start_time)}:00`);
          const eMin = toMin(m.end_time) ?? toMin(m.start_time) + 120;
          const en = new Date(`${m.gregorian_date}T00:00:00`); en.setMinutes(eMin);
          const r = await db.from('hall_bookings').insert({hall_id: v.hall_id.value, meeting_id: m.id, start_at: s.toISOString(), end_at: en.toISOString()});
          if (r.error) problems.push(`حجز القاعة ${m.gregorian_date}: ${r.error.message}`);
        }
        if (rem && !rem.error) {
          const re = await window.ehsanReminders.save(m.id, rem);
          if (re) problems.push(`التذكير ${m.gregorian_date}: ${re.message}`);
        }
      }
      $('#schedDialog').close();
      toast(problems.length ? `تمت جدولة ${data.length} اجتماع، مع ملاحظات: ${problems[0]}${problems.length > 1 ? ` (+${problems.length - 1})` : ''}` : `تمت جدولة ${data.length === 1 ? 'الاجتماع' : data.length + ' اجتماعات'}`);
      const d0 = parseKey(rows[0].gregorian_date);
      cursor = new Date(d0.getFullYear(), d0.getMonth(), 1);
      loadMonth();
    });
  }

  // ───────────── التفاصيل وتغيير الموعد ─────────────
  function openDetail(id) {
    const m = monthMeetings.find(x => x.id === id);
    if (!m) return;
    const can = me.admin || m.created_by === me.uid;
    $('#schedDetailTitle').textContent = m.title;
    $('#schedDetailBody').innerHTML = `
      <div class="meta"><span>${esc(m.committees?.name || '')}</span><span>${esc(m.mode || '')}</span><span>${esc(m.location || '')}</span>${pill(m.status || '')}</div>
      <div class="meta"><span>${esc(fHijriFull.format(parseKey(m.gregorian_date)))}</span></div>
      ${can ? `<form id="reschedForm" class="form-grid" data-id="${esc(m.id)}"><div class="form-grid cols-2">
        <label>التاريخ<input name="date" type="date" value="${esc(m.gregorian_date)}" required /></label>
        <label>وقت البداية<input name="time" type="time" value="${esc(hhmm(m.start_time))}" required /></label>
        <label>وقت النهاية<input name="endTime" type="time" value="${esc(hhmm(m.end_time))}" /></label></div>
        <div class="form-actions"><button class="btn primary" type="submit">تغيير الموعد</button><button class="btn ghost" type="button" id="reschedRem">🔔 التذكير</button></div></form>`
        : '<p class="meta">تغيير الموعد للمدير أو منظّم الاجتماع.</p>'}`;
    $('#schedDetail').showModal();
  }

  async function submitResched(e) {
    e.preventDefault();
    const f = e.target, id = f.dataset.id, v = f.elements;
    if (v.endTime.value && v.endTime.value <= v.time.value) return toast('وقت النهاية يجب أن يكون بعد وقت البداية');
    const m = monthMeetings.find(x => x.id === id);
    const row = {gregorian_date: v.date.value, hijri_date: fHijriFull.format(parseKey(v.date.value)), start_time: v.time.value, end_time: v.endTime.value || null};
    await busy(f.querySelector('[type=submit]'), async () => {
      const conflicts = await findConflicts([{...row, committee_id: m.committee_id, location: m.location}], id);
      if (conflicts.length && !confirm(`يوجد تعارض مع:\n${conflicts.slice(0, 6).join('\n')}\n\nهل تريد تغيير الموعد رغم ذلك؟`)) return;
      const {error} = await db.from('meetings').update(row).eq('id', id);
      if (error) return toast('تعذر تغيير الموعد: ' + error.message);
      $('#schedDetail').close();
      toast('تم تغيير الموعد. حجوزات القاعات لا تتغير تلقائيًا، عدّلها من "القاعات والامتثال".');
      loadMonth();
    });
  }

  async function start() {
    db = await waitDb();
    if (!db) return;
    me = await session(db);
    if (!me) return;
    const [c, h] = await Promise.all([db.from('committees').select('id,name').order('name'), db.from('halls').select('id,name,capacity').eq('is_active', true).order('name')]);
    committees = c.data || []; halls = h.data || [];
    const opt = (v, t) => Object.assign(document.createElement('option'), {value: v, textContent: t});
    $('#schedCommittee').append(...committees.map(x => opt(x.id, x.name)));
    $('#schedFormCommittee').append(...committees.map(x => opt(x.id, x.name)));
    $('#schedHall').append(...halls.map(x => opt(x.id, `${x.name} (${x.capacity})`)));
    $('#schedPrev').addEventListener('click', () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1); loadMonth(); });
    $('#schedNext').addEventListener('click', () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1); loadMonth(); });
    $('#schedToday').addEventListener('click', () => { const n = new Date(); cursor = new Date(n.getFullYear(), n.getMonth(), 1); loadMonth(); });
    $('#schedCommittee').addEventListener('change', loadMonth);
    $('#schedNewBtn').addEventListener('click', () => openSchedule(null));
    $('#schedForm').addEventListener('submit', submitSchedule);
    ['schedClose', 'schedCancel'].forEach(id => $('#' + id).addEventListener('click', () => $('#schedDialog').close()));
    $('#schedDetailClose').addEventListener('click', () => $('#schedDetail').close());
    $('#schedCal').addEventListener('click', e => {
      const ev = e.target.closest('.sched-ev');
      if (ev) return openDetail(ev.dataset.id);
      const cell = e.target.closest('.sched-cell');
      if (cell) openSchedule(cell.dataset.date);
    });
    $('#schedCal').addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('sched-cell')) { e.preventDefault(); openSchedule(e.target.dataset.date); }
    });
    $('#schedList').addEventListener('click', e => { const b = e.target.closest('.sched-open'); if (b) openDetail(b.dataset.id); });
    $('#schedDetailBody').addEventListener('submit', e => { if (e.target.id === 'reschedForm') submitResched(e); });
    $('#schedDetailBody').addEventListener('click', e => {
      if (e.target.id === 'reschedRem') { const id = e.target.closest('form').dataset.id, m = monthMeetings.find(x => x.id === id); $('#schedDetail').close(); window.ehsanReminders?.openEditor(id, m?.title); }
    });
    onOpen({scheduler: loadMonth});
    if (location.hash === '#scheduler') loadMonth();
  }
  start().catch(err => console.error('scheduler', err));
})();
