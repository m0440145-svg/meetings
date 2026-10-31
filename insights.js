(() => {
  // طبقة مشتركة للتقارير ومؤشرات الامتثال والنضج والأرشفة: تقرأ جداول المنصة الموجودة وتحسب المؤشرات في المتصفح.
  // ما لا تسمح به الصلاحيات للمستخدم الحالي (مثلًا العضو لا يرى كل الدعوات) يُحسب مما يراه فقط، وتُذكر الجداول غير المقروءة في unreadable.
  const DAY = 86400000;
  const PRESENT = ['حاضر', 'عن بعد'];
  let cache = null, cacheAt = 0;

  const TABLES = {
    meetings: {cols: '*', order: ['gregorian_date', false]},
    committees: {cols: 'id,name'},
    agenda_items: {cols: 'meeting_id'},
    meeting_invitations: {cols: 'meeting_id,created_at'},
    meeting_attendees: {cols: 'meeting_id,attendance_status'},
    votes: {cols: '*'},
    minutes: {cols: '*', order: ['created_at', false]},
    tasks: {cols: '*'},
    signatures: {cols: '*'}
  };

  async function load(db, force = false) {
    if (!force && cache && Date.now() - cacheAt < 30000) return cache;
    const names = Object.keys(TABLES);
    const res = await Promise.all(names.map(n => {
      let q = db.from(n).select(TABLES[n].cols).limit(n === 'meetings' || n === 'minutes' ? 500 : 5000);
      if (TABLES[n].order) q = q.order(TABLES[n].order[0], {ascending: TABLES[n].order[1]});
      return q;
    }));
    const data = {unreadable: []};
    res.forEach((r, i) => { data[names[i]] = r.data || []; if (r.error) data.unreadable.push(names[i]); });
    data.by = name => { const m = {}; data[name].forEach(x => { (m[x.meeting_id] ||= []).push(x); }); return m; };
    cache = data; cacheAt = Date.now();
    return data;
  }

  const dayStart = s => new Date(String(s).slice(0, 10) + 'T00:00:00');
  const todayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

  // نتيجة كل فحص: true منجز، false مخالف، null لا ينطبق بعد
  function compliance(data) {
    const inv = data.by('meeting_invitations'), ag = data.by('agenda_items'), vt = data.by('votes'), mn = data.by('minutes');
    const today = todayStart();
    return data.meetings.map(m => {
      const date = dayStart(m.gregorian_date), past = date < today;
      const invs = inv[m.id] || [], minutes = mn[m.id] || [], closed = (vt[m.id] || []).filter(v => v.status === 'مغلق');
      const firstInv = invs.reduce((a, x) => !a || x.created_at < a ? x.created_at : a, null);
      const checks = {
        agenda: (ag[m.id] || []).length > 0,
        early: firstInv ? new Date(firstInv) <= new Date(date.getTime() - 3 * DAY) : (past ? false : null),
        quorum: closed.length ? closed.every(v => v.result?.quorum_met === true) : null,
        onTime: past ? (minutes.length ? new Date(minutes.reduce((a, x) => x.created_at < a ? x.created_at : a, minutes[0].created_at)) <= new Date(date.getTime() + 8 * DAY) : false) : null,
        approved: past ? minutes.some(x => x.status === 'معتمد') : null
      };
      const vals = Object.values(checks).filter(v => v !== null);
      const score = vals.length ? Math.round(100 * vals.filter(Boolean).length / vals.length) : null;
      return {meeting: m, checks, score, past};
    });
  }

  const pct = (a, b) => b ? Math.round(100 * a / b) : null;
  const avg = xs => { const v = xs.filter(x => x !== null && x !== undefined); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };

  function maturity(data) {
    const comp = compliance(data), today = todayStart();
    const past = data.meetings.filter(m => dayStart(m.gregorian_date) < today);
    const mn = data.by('minutes'), inv = data.by('meeting_invitations'), att = data.by('meeting_attendees');
    const approvedPast = past.filter(m => (mn[m.id] || []).some(x => x.status === 'معتمد')).length;
    const attendance = avg(past.map(m => {
      const n = (inv[m.id] || []).length;
      return n ? Math.min(100, pct((att[m.id] || []).filter(a => PRESENT.includes(a.attendance_status)).length, n)) : null;
    }));
    const closedVotes = data.votes.filter(v => v.status === 'مغلق');
    const metrics = [
      {key: 'documentation', label: 'التوثيق (محاضر معتمدة)', value: pct(approvedPast, past.length), tip: 'اعتمد محاضر الاجتماعات المنتهية ووقّعها خلال أسبوع من انعقادها.'},
      {key: 'attendance', label: 'الحضور والمشاركة', value: attendance, tip: 'حسّن نسبة الحضور: أرسل الدعوات مبكرًا واستخدم التذكيرات وخيار الحضور عن بعد.'},
      {key: 'execution', label: 'تنفيذ القرارات والمهام', value: pct(data.tasks.filter(t => t.status === 'مكتملة').length, data.tasks.length), tip: 'تابع المهام المتأخرة في كل اجتماع، وحدّد مسؤولًا وموعدًا لكل قرار.'},
      {key: 'compliance', label: 'الامتثال الإجرائي', value: avg(comp.map(c => c.score)), tip: 'التزم بجدول الأعمال والدعوة قبل 3 أيام وإعداد المحضر خلال 7 أيام (راجع جدول الامتثال).'},
      {key: 'quorum', label: 'اكتمال النصاب في التصويت', value: pct(closedVotes.filter(v => v.result?.quorum_met === true).length, closedVotes.length), tip: 'تأكد من تسجيل الحضور قبل فتح التصويت واحرص على بلوغ الحد الأدنى للنصاب.'}
    ];
    const score = avg(metrics.map(m => m.value));
    const level = score === null ? 'لا توجد بيانات كافية' : score >= 90 ? 'رائد' : score >= 70 ? 'متقدم' : score >= 40 ? 'متنامٍ' : 'مبتدئ';
    return {score, level, metrics, tips: metrics.filter(m => m.value !== null && m.value < 70).sort((a, b) => a.value - b.value).map(m => m.tip)};
  }

  window.ehsanInsights = {load, compliance, maturity, dayStart, pct};
})();

// أدوات واجهة مشتركة لصفحات الحوكمة والتطوير والتقارير
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const toast = m => window.showToast ? window.showToast(m) : alert(m);
  const fmtDate = d => { try { return new Date(d).toLocaleDateString('ar-SA'); } catch { return d || ''; } };
  const GOOD = ['معتمدة', 'منفذة', 'ساري', 'مغلقة', 'تم الحل', 'مرشح'], BAD = ['مرفوضة', 'ملغى', 'منسحب'];
  const pill = t => `<span class="status-pill ${GOOD.includes(t) ? 'good' : BAD.includes(t) ? 'danger' : 'warn'}">${esc(t)}</span>`;
  const empty = t => `<div class="list-item">${esc(t)}</div>`;
  const busy = async (btn, fn) => { if (btn.disabled) return; btn.disabled = true; try { await fn(); } finally { btn.disabled = false; } };
  const warned = new Set();
  const failed = (what, error) => { console.error(what, error); if (warned.has(what)) return; warned.add(what); toast(`تعذر تحميل ${what}: ${error?.message || 'خطأ'}`); };
  // نقرات التنقل يوقفها nav-fix.js في مرحلة الالتقاط، لذلك نستمع في هذه المرحلة
  const onOpen = (handlers) => document.addEventListener('click', e => {
    const v = e.target.closest('[data-view],[data-view-jump]');
    const name = v?.dataset.view || v?.dataset.viewJump;
    if (name && handlers[name]) handlers[name]();
  }, true);
  async function session(db) {
    const {data: {session: s}} = await db.auth.getSession();
    if (!s) return null;
    const r = await db.rpc('is_admin');
    return {uid: s.user.id, admin: !r.error && r.data === true};
  }
  async function waitDb() { for (let i = 0; i < 40 && !window.ehsanDB; i++) await new Promise(r => setTimeout(r, 250)); return window.ehsanDB; }
  window.ehsanUI = {esc, toast, fmtDate, pill, empty, busy, failed, onOpen, session, waitDb};
})();
