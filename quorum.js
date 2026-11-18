// نصاب الحضور (الترحيل 048): يعرض على كل بطاقة تصويت حالة النصاب (الحاضرون من أعضاء اللجنة مقابل المطلوب)،
// ويتيح للمدير/أمين السر «إعدادات النصاب» (الوضع: تحذير/منع/إيقاف، والنسبة الافتراضية، ونسبة خاصة لكل لجنة) من صفحة اللجان.
// ميزة مضافة: إن لم يكن الترحيل مطبّقًا (لا دالة vote_quorum) لا يظهر شيء. الحماية الفعلية في قاعدة البيانات لا هنا.
(() => {
  'use strict';
  const ui = window.ehsanUI;
  if (!ui) return;
  const {toast, session, waitDb} = ui;

  const style = document.createElement('style'); style.id = 'quorumStyle';
  style.textContent = '.qd{font-weight:700}.qd-ok{color:#218558}.qd-warn{color:#b8620a}.qd-block{color:#b64242}';
  document.head.append(style);

  async function decorate(db, art) {
    if (art.dataset.qd) return;
    art.dataset.qd = '1';
    const r = await db.rpc('vote_quorum', {p_vote: art.dataset.vote});
    const q = r.data;
    if (r.error || !q || !q.applicable || q.mode === 'off') return;
    const d = document.createElement('div'); d.className = 'meta qd';
    const base = `حضور النصاب: ${q.present} من ${q.eligible} حاضرًا (المطلوب ${q.required})`;
    if (q.met) { d.classList.add('qd-ok'); d.textContent = base + ' — مكتمل'; }
    else if (q.mode === 'block') { d.classList.add('qd-block'); d.textContent = base + ' — غير مكتمل: لا يُقبل التصويت حتى يكتمل النصاب'; }
    else { d.classList.add('qd-warn'); d.textContent = base + ' — غير مكتمل (تنبيه فقط)'; }
    const m = art.querySelector('.meta');
    if (m) m.after(d); else art.append(d);
  }

  async function openSettings(db) {
    const r = await db.rpc('quorum_settings_get');
    if (r.error) return toast('تعذر تحميل إعدادات النصاب: ' + r.error.message);
    const s = r.data;
    const fields = [
      {type: 'info', text: 'النصاب = نسبة من أعضاء لجنة الاجتماع يجب أن يكونوا «حاضر/عن بعد». المطلوب = عدد الأعضاء × النسبة (مقرَّبًا لأعلى). اكتب 50.01 لـ«أكثر من النصف» و66.66 لـ«الثلثين». الضيف الحاضر يصوّت لكنه لا يُحتسب في النصاب.'},
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
        document.querySelectorAll('#votesList article[data-vote]').forEach(a => { delete a.dataset.qd; a.querySelector('.qd')?.remove(); decorate(db, a); });
      }
    });
  }

  async function addButton(db) {
    const me = await session(db);
    if (!me?.admin) return;
    const add = document.getElementById('addCommitteeBtn');
    if (!add || document.getElementById('quorumSettingsBtn')) return;
    const probe = await db.rpc('quorum_settings_get');
    if (probe.error) return; // الترحيل غير مطبّق
    const b = document.createElement('button'); b.type = 'button'; b.id = 'quorumSettingsBtn'; b.className = 'btn ghost'; b.textContent = '⚖ إعدادات النصاب';
    b.addEventListener('click', () => openSettings(db));
    add.before(b);
  }

  async function start() {
    const db = await waitDb(); if (!db) return;
    const {data: {session: sess}} = await db.auth.getSession(); if (!sess) return;
    addButton(db);
    const list = document.getElementById('votesList');
    if (list) {
      const run = () => list.querySelectorAll('article[data-vote]').forEach(a => decorate(db, a));
      new MutationObserver(run).observe(list, {childList: true});
      run();
    }
  }
  start().catch(err => console.error('quorum', err));
})();
