(() => {
  // الأرشفة والقياس: التقارير والقياس، الأرشفة والذاكرة المؤسسية. القراءة فقط من جداول المنصة.
  const {esc, toast, fmtDate, pill, empty, failed, onOpen, session, waitDb} = window.ehsanUI;
  const $ = s => document.querySelector(s);
  const I = window.ehsanInsights;
  let db, me, data;

  const monthKey = d => String(d).slice(0, 7);
  const cname = (id) => data.committees.find(c => c.id === id)?.name || 'بدون لجنة';

  // ───────────── التقارير والقياس ─────────────
  async function loadReports() {
    data = await I.load(db, true);
    if (data.unreadable.length) failed('بعض بيانات التقارير (' + data.unreadable.join('، ') + ')', {message: 'قد تمنعها الصلاحيات'});
    const m = I.maturity(data), today = new Date().toISOString().slice(0, 10);
    const tasksDone = data.tasks.filter(t => t.status === 'مكتملة').length, open = data.tasks.length - tasksDone;
    const approved = data.minutes.filter(x => x.status === 'معتمد').length;
    const att = m.metrics.find(x => x.key === 'attendance').value;
    const kpis = [
      ['الاجتماعات', data.meetings.length, `${data.meetings.filter(x => x.gregorian_date >= today).length} قادمة`],
      ['محاضر معتمدة', approved, `من ${data.minutes.length} محضر`],
      ['إنجاز المهام', (I.pct(tasksDone, data.tasks.length) ?? '—') + (data.tasks.length ? '%' : ''), `${open} مفتوحة`],
      ['متوسط الحضور', att === null ? '—' : att + '%', 'من المدعوين'],
      ['مؤشر النضج', m.score === null ? '—' : m.score + '%', m.level]
    ];
    $('#reportKpis').innerHTML = kpis.map(([a, b, c]) => `<article><span>${esc(a)}</span><strong>${esc(b)}</strong><small>${esc(c)}</small></article>`).join('');

    // آخر 12 شهرًا
    const months = [], now = new Date();
    for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
    const counts = months.map(k => data.meetings.filter(x => monthKey(x.gregorian_date) === k).length), max = Math.max(1, ...counts);
    $('#reportMonths').innerHTML = months.map((k, i) => `<div class="bar-row"><span>${esc(k)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.round(100 * counts[i] / max)}%"></div></div><strong>${counts[i]}</strong></div>`).join('');

    // حسب اللجنة
    const mt = {};
    data.meetings.forEach(x => { (mt[x.committee_id || ''] ||= []).push(x); });
    const minutesBy = data.by('minutes'), tasksBy = data.by('tasks');
    $('#reportCommittees').innerHTML = Object.entries(mt).map(([cid, list]) => {
      const ap = list.filter(x => (minutesBy[x.id] || []).some(y => y.status === 'معتمد')).length;
      const op = list.reduce((a, x) => a + (tasksBy[x.id] || []).filter(t => t.status !== 'مكتملة').length, 0);
      return `<tr><td>${esc(cid ? cname(cid) : 'بدون لجنة')}</td><td>${list.length}</td><td>${ap}</td><td>${op}</td></tr>`;
    }).join('') || '<tr><td colspan="4">لا توجد بيانات.</td></tr>';
  }

  // تصدير CSV: نمنع تنفيذ المعادلات في إكسل بإضافة apostrophe للخلايا التي تبدأ برموز المعادلات
  const cell = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  function download(name, rows) {
    const csv = '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], {type: 'text/csv;charset=utf-8'}));
    a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function exportMeetings() {
    data = await I.load(db, true);
    download('meetings.csv', [['العنوان', 'التاريخ', 'اللجنة', 'الحالة', 'النمط'], ...data.meetings.map(m => [m.title, m.gregorian_date, cname(m.committee_id), m.status, m.mode])]);
  }
  async function exportTasks() {
    data = await I.load(db, true);
    download('tasks.csv', [['العنوان', 'الحالة', 'الاستحقاق', 'الأولوية'], ...data.tasks.map(t => [t.title, t.status, t.due_date, t.priority])]);
  }

  // ───────────── الأرشفة والذاكرة ─────────────
  async function loadArchive() {
    data = await I.load(db, true);
    const years = [...new Set([...data.meetings.map(m => String(m.gregorian_date).slice(0, 4))])].sort().reverse();
    const ys = $('#arcYear'), yk = ys.value;
    ys.replaceChildren(ys.options[0], ...years.map(y => { const o = document.createElement('option'); o.value = y; o.textContent = y; return o; })); ys.value = years.includes(yk) ? yk : '';
    const cs = $('#arcCommittee'), ck = cs.value;
    cs.replaceChildren(cs.options[0], ...data.committees.map(c => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; return o; })); cs.value = data.committees.some(c => c.id === ck) ? ck : '';
    renderArchive();
  }
  function renderArchive() {
    const t = $('#arcSearch').value.trim().toLowerCase(), y = $('#arcYear').value, c = $('#arcCommittee').value;
    const meetingOf = id => data.meetings.find(m => m.id === id);
    const ok = (m, text) => m && (!y || String(m.gregorian_date).startsWith(y)) && (!c || m.committee_id === c) && (!t || `${m.title} ${text}`.toLowerCase().includes(t));
    const sigCount = id => data.signatures.filter(s => s.minute_id === id).length;
    const mins = data.minutes.filter(x => x.status === 'معتمد' && ok(meetingOf(x.meeting_id), x.content || ''));
    $('#arcMinutes').innerHTML = mins.map(x => { const m = meetingOf(x.meeting_id); return `<div class="list-item"><strong>${esc(m.title)}</strong><div class="meta"><span>${esc(m.gregorian_date)}</span><span>${esc(cname(m.committee_id))}</span><span>التوقيعات: ${sigCount(x.id)}</span></div><p>${esc(String(x.content || '').slice(0, 160))}…</p><div class="item-actions"><button class="btn small ghost arc-view" data-id="${x.id}">عرض</button><button class="btn small ghost arc-dl" data-id="${x.id}">تنزيل نصي</button></div></div>`; }).join('') || empty('لا توجد محاضر معتمدة مطابقة.');
    const votes = data.votes.filter(v => v.status === 'مغلق' && ok(meetingOf(v.meeting_id), v.question || ''));
    $('#arcVotes').innerHTML = votes.map(v => { const m = meetingOf(v.meeting_id), r = v.result || {}; return `<div class="list-item"><strong>${esc(v.question)}</strong><div class="meta"><span>${esc(m.title)}</span><span>${esc(m.gregorian_date)}</span>${r.quorum_met === false ? pill('النصاب غير مكتمل') : ''}</div><p>موافق ${esc(r.approve ?? '—')} | غير موافق ${esc(r.reject ?? '—')} | ممتنع ${esc(r.abstain ?? '—')}</p></div>`; }).join('') || empty('لا توجد تصويتات مغلقة مطابقة.');
  }
  function minuteText(x) {
    const m = data.meetings.find(y => y.id === x.meeting_id) || {};
    return `${m.title || 'محضر اجتماع'}\nالتاريخ: ${m.gregorian_date || ''}\nاللجنة: ${cname(m.committee_id)}\nالحالة: ${x.status}\nبصمة المحضر (SHA-256): ${x.content_hash || 'غير متاحة'}\n\n${x.content || ''}\n`;
  }
  function archiveAction(e) {
    const b = e.target.closest('.arc-view, .arc-dl');
    if (!b) return;
    const x = data.minutes.find(y => y.id === b.dataset.id);
    if (!x) return;
    if (b.classList.contains('arc-view')) return window.openModal?.('المحضر', `<pre class="pre-wrap" style="white-space:pre-wrap;margin:0;font-family:inherit;max-height:60vh;overflow:auto">${esc(minuteText(x))}</pre>`, null, false);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([minuteText(x)], {type: 'text/plain;charset=utf-8'}));
    a.download = 'minute-' + x.id.slice(0, 8) + '.txt'; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function start() {
    db = await waitDb();
    if (!db) return;
    me = await session(db);
    if (!me) return;
    $('#exportMeetings').addEventListener('click', () => exportMeetings().catch(err => toast(err.message)));
    $('#exportTasks').addEventListener('click', () => exportTasks().catch(err => toast(err.message)));
    ['arcSearch', 'arcYear', 'arcCommittee'].forEach(id => $('#' + id).addEventListener(id === 'arcSearch' ? 'input' : 'change', () => data && renderArchive()));
    $('#view-archive').addEventListener('click', archiveAction);
    const handlers = {reports: loadReports, archive: loadArchive};
    onOpen(handlers);
    handlers[location.hash.replace('#', '')]?.();
  }
  start().catch(err => console.error('archive-reports', err));
})();
