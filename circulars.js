// القرارات بالتمرير (الترحيل 022): فوق الجدولين الموجودين circular_decisions و circular_responses.
// المدير ينشئ القرار لجهة مع موعد نهائي فيُشعَر أعضاؤها؛ العضو يصوّت (موافق / غير موافق / ممتنع) حتى الموعد؛ المدير يغلق ويُحتسب بالأغلبية المطلقة.
// كل القواعد مفروضة في الخادم (circular_*)؛ يستبدل الواجهة المحلية التجريبية فقط إن كان الترحيل مطبّقًا.
(() => {
  'use strict';
  const ui = window.ehsanUI;
  if (!ui) return;
  const {esc, toast, onOpen, session, waitDb} = ui;
  let db, me, rows = [], committees = [], myCommittees = new Set(), mine = new Map(), results = new Map();
  const fDT = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'});
  const fmt = s => { const d = new Date(s); return isNaN(d) ? '' : fDT.format(d); };
  const STATUS = {'مفتوح': 'warn', 'معتمد': 'good', 'غير معتمد': '', 'ملغى': ''};
  const CHOICES = ['موافق', 'غير موافق', 'ممتنع'];

  const CSS = `
.cr-list{display:grid;gap:12px}
.cr-card{display:grid;gap:8px}
.cr-card h3{margin:0;font-size:17px}
.cr-meta{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:12.5px;color:var(--muted,#6b5f59)}
.cr-text{margin:0;white-space:pre-wrap;line-height:1.9}
.cr-acts{display:flex;gap:6px;flex-wrap:wrap}
.cr-res{display:grid;grid-template-columns:90px 1fr 40px;gap:6px 10px;align-items:center;font-size:13.5px}
.cr-bar{background:var(--line,#eadfd8);border-radius:999px;height:9px;overflow:hidden}
.cr-bar i{display:block;height:100%;background:linear-gradient(90deg,#cf6028,#f18927)}
.cr-who{font-size:12.5px;color:var(--muted,#6b5f59);margin:0;padding-inline-start:18px}
.cr-rule{font-size:12.5px;color:var(--muted,#6b5f59)}`;

  const isOpen = c => c.status === 'مفتوح' && (!c.deadline || new Date(c.deadline) > new Date());
  const inAudience = c => !c.committee_id || myCommittees.has(c.committee_id);

  function resultsHtml(c) {
    const r = results.get(c.id); if (!r) return '';
    const bar = (label, n) => `<span>${esc(label)}</span><span class="cr-bar" aria-hidden="true"><i style="width:${r.audience ? Math.round(n / r.audience * 100) : 0}%"></i></span><span>${n}</span>`;
    return `<div class="cr-res">${bar('موافق', r.yes)}${bar('غير موافق', r.no)}${bar('ممتنع', r.abstain)}${bar('لم يصوّت', r.pending)}</div>
      <div class="cr-rule">الأعضاء: ${r.audience} — يلزم للاعتماد ${r.needed} موافقة على الأقل (أكثر من النصف).</div>
      ${r.responses?.length ? `<ul class="cr-who">${r.responses.map(x => `<li>${esc(x.name)}: ${esc(x.choice)}${x.comment ? ' — ' + esc(x.comment) : ''}</li>`).join('')}</ul>` : ''}`;
  }

  function paint() {
    document.getElementById('crList').innerHTML = rows.map(c => {
      const my = mine.get(c.id), open = isOpen(c), cm = committees.find(x => x.id === c.committee_id);
      const expired = c.status === 'مفتوح' && !open;
      return `<article class="card cr-card" data-id="${esc(c.id)}">
        <div class="cr-meta"><span class="badge ${STATUS[c.status] || ''}">${esc(expired ? 'انتهى الموعد — بانتظار الإغلاق' : c.status || '—')}</span><span>${esc(cm?.name || 'كل الأعضاء')}</span>${c.deadline ? `<span>آخر موعد: ${esc(fmt(c.deadline))}</span>` : ''}</div>
        <h3>${esc(c.title)}</h3>${c.description ? `<p class="cr-text">${esc(c.description)}</p>` : ''}
        ${my ? `<div class="cr-meta">رأيك: <b>${esc(my.choice)}</b>${my.comment ? ' — ' + esc(my.comment) : ''}</div>` : ''}
        ${open && inAudience(c) ? `<div class="cr-acts">${CHOICES.map(ch => `<button type="button" class="btn ${ch === 'موافق' ? 'primary' : 'secondary'} small" data-cr-vote="${esc(ch)}">${esc(ch)}${my?.choice === ch ? ' ✓' : ''}</button>`).join('')}</div>` : ''}
        ${resultsHtml(c)}
        <div class="cr-acts">${results.has(c.id) ? '' : '<button type="button" class="btn ghost small" data-cr-res>عرض النتيجة</button>'}${me.admin && c.status === 'مفتوح' ? '<button type="button" class="btn primary small" data-cr-close>إغلاق واحتساب النتيجة</button><button type="button" class="btn ghost small" data-cr-cancel>إلغاء القرار</button>' : ''}</div>
      </article>`;
    }).join('') || '<div class="card">لا قرارات بالتمرير بعد.</div>';
  }

  async function load() {
    const [c, r, cm, my] = await Promise.all([
      db.from('circular_decisions').select('*').order('created_at', {ascending: false}).limit(200),
      db.from('circular_responses').select('circular_id,choice,comment').eq('user_id', me.uid),
      db.from('committees').select('id,name').order('name'),
      db.from('committee_members').select('committee_id').eq('user_id', me.uid)
    ]);
    if (c.error) { toast('تعذر تحميل القرارات بالتمرير'); return; }
    rows = c.data || []; committees = cm.data || [];
    mine = new Map((r.data || []).map(x => [x.circular_id, x]));
    myCommittees = new Set((my.data || []).map(x => x.committee_id));
    results = new Map();
    paint();
  }

  async function showResults(id) {
    const {data, error} = await db.rpc('circular_results', {p_circular: id});
    if (error) return toast(/permission/.test(error.message) ? 'النتيجة متاحة لأعضاء الجهة والمدير فقط' : 'تعذر تحميل النتيجة');
    results.set(id, data); paint();
  }

  async function vote(id, choice) {
    const comment = window.prompt(`رأيك: ${choice}\nتعليق (اختياري):`, mine.get(id)?.comment || '');
    if (comment === null) return;
    const {error} = await db.rpc('circular_respond', {p_circular: id, p_choice: choice, p_comment: comment});
    if (error) return toast(error.message || 'تعذر حفظ رأيك');
    toast('تم حفظ رأيك. يمكنك تعديله حتى الموعد النهائي.');
    await load();
  }

  async function close(id, cancel) {
    const c = rows.find(x => x.id === id); if (!c) return;
    if (!window.confirm(cancel ? `إلغاء القرار «${c.title}»؟ لن يُحتسب.` : `إغلاق التصويت على «${c.title}» واحتساب النتيجة؟ لا يمكن التراجع.`)) return;
    const {data, error} = await db.rpc('circular_close', {p_circular: id, p_cancel: !!cancel});
    if (error) return toast(error.message || 'تعذر الإغلاق');
    toast('النتيجة: ' + data);
    await load(); await showResults(id);
  }

  async function create() {
    if (!window.DM?.form) return toast('النموذج غير جاهز بعد، أعد المحاولة');
    const d = new Date(Date.now() + 3 * 864e5); d.setMinutes(0, 0, 0);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
    await window.DM.form({
      title: 'قرار بالتمرير جديد', submit: 'إنشاء وإشعار الأعضاء', wide: true,
      intro: 'يُشعَر أعضاء الجهة فور الإنشاء، ويصوّتون حتى الموعد النهائي. يُعتمد القرار إذا وافق أكثر من نصف أعضاء الجهة.',
      fields: [
        {name: 'title', label: 'عنوان القرار', required: true, maxlength: 200},
        {name: 'description', label: 'نص القرار', type: 'textarea', rows: 5, maxlength: 8000},
        {name: 'committee', label: 'الجهة', type: 'select', options: [{value: '', label: 'كل الأعضاء'}, ...committees.map(c => ({value: c.id, label: c.name}))]},
        {name: 'deadline', label: 'آخر موعد للتصويت', type: 'datetime-local', required: true, value: local}
      ],
      onSubmit: async v => {
        const {error} = await db.rpc('circular_create', {p_title: v.title, p_description: v.description, p_committee: v.committee || null, p_deadline: new Date(v.deadline).toISOString()});
        if (error) throw new Error(error.message);
        toast('أُنشئ القرار وأُشعر الأعضاء');
        await load();
      }
    });
  }

  function build() {
    const sec = document.getElementById('view-circulars'); if (!sec) return false;
    const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
    sec.innerHTML = `<div class="section-head"><div><span class="eyebrow">حوكمة القرارات</span><h2>القرارات بالتمرير</h2></div>${me.admin ? '<button type="button" class="btn primary" id="crNew">＋ قرار بالتمرير جديد</button>' : ''}</div>
      <div class="cr-list" id="crList"></div>`;
    return true;
  }

  async function start() {
    db = await waitDb(); if (!db) return;
    me = await session(db); if (!me) return;
    const probe = await db.rpc('circular_results', {p_circular: '00000000-0000-0000-0000-000000000000'});
    if (probe.error && /function|schema cache|Could not find/i.test(probe.error.message || '')) return; // الترحيل 022 غير مطبّق: تبقى الواجهة القديمة كما هي
    if (!build()) return;
    document.getElementById('crNew')?.addEventListener('click', create);
    document.getElementById('crList').addEventListener('click', e => {
      const card = e.target.closest('.cr-card'); if (!card) return;
      const v = e.target.closest('[data-cr-vote]');
      if (v) vote(card.dataset.id, v.dataset.crVote);
      else if (e.target.closest('[data-cr-res]')) showResults(card.dataset.id);
      else if (e.target.closest('[data-cr-close]')) close(card.dataset.id, false);
      else if (e.target.closest('[data-cr-cancel]')) close(card.dataset.id, true);
    });
    onOpen({circulars: load});
    document.documentElement.dataset.serverViews = ((document.documentElement.dataset.serverViews || '') + ' circulars').trim();
    await load();
  }
  start().catch(err => console.error('circulars', err));
})();
