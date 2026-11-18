// نصاب الحضور (الترحيل 048) وقاعدة الإقرار (الترحيل 049).
// - بطاقة التصويت المفتوح: حالة النصاب (الحاضرون من أعضاء اللجنة مقابل المطلوب) + للمدير زر «قاعدة الإقرار» لهذا التصويت.
// - بطاقة التصويت المغلق: نتيجة الإقرار (مُقَرّ / غير مُقَرّ / متعادل) محسوبة بقاعدة التصويت المثبَّتة عند فتحه. معلومة فقط: لا تغيّر قرارًا ولا صوتًا.
// - صفحة اللجان للمدير/أمين السر: «إعدادات النصاب» و«قاعدة الإقرار».
// ميزة مضافة: إن لم تكن الترحيلات مطبّقة لا يظهر شيء. الحماية الفعلية في قاعدة البيانات لا هنا.
(() => {
  'use strict';
  const ui = window.ehsanUI;
  if (!ui) return;
  const {toast, session, waitDb} = ui;
  let isAdmin = false;

  const BASES = {cast: 'المُدلين بموافق أو غير موافق (الممتنع لا يُحسب)', voters: 'كل المشاركين في التصويت (مع الممتنع)', present: 'الحاضرين في الاجتماع', members: 'أعضاء اللجنة'};
  const BASES_SHORT = {cast: 'مُدلٍ بموافق/غير موافق', voters: 'مشارك', present: 'حاضر', members: 'عضو في اللجنة'};
  const baseOptions = (blank) => [...(blank ? [{value: '', label: 'بلا (الافتراضية)'}] : []), ...Object.entries(BASES).map(([value, label]) => ({value, label}))];
  const pctText = p => { p = Number(p); return p > 50 && p < 50.1 ? 'أكثر من النصف' : Math.abs(p - 66.66) < 0.05 ? 'الثلثان' : p + '%'; };

  const style = document.createElement('style'); style.id = 'quorumStyle';
  style.textContent = '.qd{font-weight:700}.qd-ok{color:#218558}.qd-warn{color:#b8620a}.qd-block{color:#b64242}.qd-rule{margin-inline-start:8px}';
  document.head.append(style);

  async function decorate(db, art) {
    if (art.dataset.qd) return;
    art.dataset.qd = '1';
    const closed = art.querySelector('.tag')?.textContent.trim() === 'مغلق';
    const d = document.createElement('div'); d.className = 'meta qd';
    if (closed) {
      const r = await db.rpc('vote_outcome', {p_vote: art.dataset.vote});
      const o = r.data;
      if (r.error || !o) return;
      const detail = `موافق ${o.approve} مقابل غير موافق ${o.reject}، والمطلوب ${o.required} من ${o.base_count} ${BASES_SHORT[o.base] || ''} (${pctText(o.percent)})`;
      if (o.tied) { d.classList.add('qd-warn'); d.textContent = `النتيجة: متعادل — لا يُقَرّ (${o.approve} مقابل ${o.reject})`; }
      else if (o.passed) { d.classList.add('qd-ok'); d.textContent = 'النتيجة: مُقَرّ — ' + detail; }
      else { d.classList.add('qd-block'); d.textContent = 'النتيجة: غير مُقَرّ — ' + detail; }
    } else {
      const r = await db.rpc('vote_quorum', {p_vote: art.dataset.vote});
      const q = r.data;
      if (!r.error && q && q.applicable && q.mode !== 'off') {
        const base = `حضور النصاب: ${q.present} من ${q.eligible} حاضرًا (المطلوب ${q.required})`;
        if (q.met) { d.classList.add('qd-ok'); d.textContent = base + ' — مكتمل'; }
        else if (q.mode === 'block') { d.classList.add('qd-block'); d.textContent = base + ' — غير مكتمل: لا يُقبل التصويت حتى يكتمل النصاب'; }
        else { d.classList.add('qd-warn'); d.textContent = base + ' — غير مكتمل (تنبيه فقط)'; }
      }
      if (isAdmin) {
        const probe = await db.rpc('vote_rule_get', {p_vote: art.dataset.vote});
        if (!probe.error && probe.data) {
          const b = document.createElement('button'); b.type = 'button'; b.className = 'btn small ghost qd-rule'; b.textContent = 'قاعدة الإقرار لهذا التصويت';
          b.addEventListener('click', () => openVoteRule(db, art.dataset.vote));
          d.append(b);
        }
      }
    }
    if (!d.textContent && !d.children.length) return;
    const m = art.querySelector('.meta');
    if (m) m.after(d); else art.append(d);
  }

  async function openSettings(db) {
    const r = await db.rpc('quorum_settings_get');
    if (r.error) return toast('تعذر تحميل إعدادات النصاب: ' + r.error.message);
    const s = r.data;
    const fields = [
      {type: 'info', text: 'النصاب = نسبة من أعضاء لجنة الاجتماع يجب أن يكونوا «حاضر/عن بعد». المطلوب = عدد الأعضاء × النسبة (مقرَّبًا لأعلى). اكتب 50.01 لـ«أكثر من النصف» و66.66 لـ«الثلثين». الضيف الحاضر يصوّت لكنه لا يُحتسب في النصاب. الأعضاء الموقوفون لا يُحتسبون.'},
      {name: 'mode', label: 'الوضع', type: 'select', value: s.mode, options: [
        {value: 'warn', label: 'تحذير فقط: يظهر ولا يمنع'},
        {value: 'block', label: 'منع: لا يُفتح تصويت ولا يُقبل صوت قبل اكتمال النصاب'},
        {value: 'off', label: 'إيقاف'}]},
      {name: 'def', label: 'النسبة الافتراضية %', type: 'number', min: 1, max: 100, required: true, value: s.default_percent, help: 'تُطبَّق على اللجان بلا نسبة خاصة'},
      ...(s.committees || []).map(c => ({name: 'c_' + c.id, label: `${c.name} (${c.members} عضو): نسبة خاصة %`, type: 'number', min: 1, max: 100, value: c.percent ?? '', help: 'اتركها فارغة لاستخدام الافتراضية'}))
    ];
    await window.DM.form({
      title: 'إعدادات نصاب الحضور', submit: 'حفظ', wide: true, fields,
      onSubmit: async v => {
        const committees = (s.committees || []).map(c => ({id: c.id, percent: v['c_' + c.id]}));
        const res = await db.rpc('quorum_settings_set', {p_mode: v.mode, p_default: v.def, p_committees: committees});
        if (res.error) throw new Error(res.error.message);
        toast('تم حفظ إعدادات النصاب');
        refreshCards(db);
      }
    });
  }

  async function openApprovalSettings(db) {
    const r = await db.rpc('approval_settings_get');
    if (r.error) return toast('تعذر تحميل إعدادات الإقرار: ' + r.error.message);
    const s = r.data;
    const fields = [
      {type: 'info', text: 'قاعدة الإقرار تحدد هل «نجح» القرار بعد إغلاق التصويت: الموافقون ≥ (الأساس × النسبة) ويزيدون على الرافضين. 50.01 = أكثر من النصف، 66.66 = الثلثان. التعادل لا يُقَرّ. تُثبَّت القاعدة على كل تصويت عند فتحه، فتعديلها هنا لا يغيّر نتيجة تصويت سابق. عرض معلوماتي فقط.'},
      {name: 'base', label: 'الأساس الافتراضي', type: 'select', value: s.base, options: baseOptions(false)},
      {name: 'pct', label: 'النسبة الافتراضية %', type: 'number', min: 1, max: 100, required: true, value: s.percent},
      ...(s.committees || []).flatMap(c => [
        {name: 'b_' + c.id, label: `${c.name}: أساس خاص`, type: 'select', value: c.base || '', options: baseOptions(true)},
        {name: 'p_' + c.id, label: `${c.name}: نسبة خاصة %`, type: 'number', min: 1, max: 100, value: c.percent ?? '', help: 'اتركها فارغة لاستخدام الافتراضية'}
      ])
    ];
    await window.DM.form({
      title: 'قاعدة الإقرار (نسبة الإقرار)', submit: 'حفظ', wide: true, fields,
      onSubmit: async v => {
        const committees = (s.committees || []).map(c => ({id: c.id, base: v['b_' + c.id] || null, percent: v['p_' + c.id]}));
        const res = await db.rpc('approval_settings_set', {p_base: v.base, p_percent: v.pct, p_committees: committees});
        if (res.error) throw new Error(res.error.message);
        toast('تم حفظ قاعدة الإقرار');
      }
    });
  }

  async function openVoteRule(db, voteId) {
    const r = await db.rpc('vote_rule_get', {p_vote: voteId});
    if (r.error || !r.data) return toast('تعذر تحميل قاعدة التصويت');
    if (r.data.status !== 'مفتوح') return toast('لا تُعدَّل قاعدة الإقرار بعد إغلاق التصويت');
    await window.DM.form({
      title: 'قاعدة الإقرار لهذا التصويت', submit: 'حفظ',
      fields: [
        {type: 'info', text: 'تنطبق على هذا التصويت وحده وتُقفل عند إغلاقه (مثلًا الثلثان لمسألة خاصة: 66.66).'},
        {name: 'base', label: 'الأساس', type: 'select', value: r.data.base, options: baseOptions(false)},
        {name: 'pct', label: 'النسبة %', type: 'number', min: 1, max: 100, required: true, value: r.data.percent}
      ],
      onSubmit: async v => {
        const res = await db.rpc('vote_set_approval_rule', {p_vote: voteId, p_base: v.base, p_percent: v.pct});
        if (res.error) throw new Error(res.error.message);
        toast('تم حفظ قاعدة هذا التصويت');
      }
    });
  }

  function refreshCards(db) {
    document.querySelectorAll('#votesList article[data-vote]').forEach(a => { delete a.dataset.qd; a.querySelector('.qd')?.remove(); decorate(db, a); });
  }

  async function addButtons(db) {
    if (!isAdmin) return;
    const add = document.getElementById('addCommitteeBtn');
    if (!add) return;
    if (!document.getElementById('quorumSettingsBtn')) {
      const probe = await db.rpc('quorum_settings_get');
      if (!probe.error) {
        const b = document.createElement('button'); b.type = 'button'; b.id = 'quorumSettingsBtn'; b.className = 'btn ghost'; b.textContent = '⚖ إعدادات النصاب';
        b.addEventListener('click', () => openSettings(db));
        add.before(b);
      }
    }
    if (!document.getElementById('approvalSettingsBtn')) {
      const probe = await db.rpc('approval_settings_get');
      if (!probe.error) {
        const b = document.createElement('button'); b.type = 'button'; b.id = 'approvalSettingsBtn'; b.className = 'btn ghost'; b.textContent = '✔ قاعدة الإقرار';
        b.addEventListener('click', () => openApprovalSettings(db));
        add.before(b);
      }
    }
  }

  async function start() {
    const db = await waitDb(); if (!db) return;
    const {data: {session: sess}} = await db.auth.getSession(); if (!sess) return;
    const me = await session(db);
    isAdmin = !!me?.admin;
    addButtons(db);
    const list = document.getElementById('votesList');
    if (list) {
      const run = () => list.querySelectorAll('article[data-vote]').forEach(a => decorate(db, a));
      new MutationObserver(run).observe(list, {childList: true});
      run();
    }
  }
  start().catch(err => console.error('quorum', err));
})();
