// مساعد أمين السر (المرحلة 1، الترحيل 016). وضع تجريبي: التحليل يتم داخل المتصفح بقواعد نصية بسيطة ولا تغادر المحاضر جهازك.
// يستخرج القرارات والتوصيات والمهام مع الجملة المصدر والبند والمسؤول والموعد، ويحفظها «مقترحة» لمراجعة أمين السر.
// لا ينشئ قرارًا أو مهمة رسمية تلقائيًا. ميزة مضافة: إن لم يكن الترحيل مطبّقًا أو لم يكن المستخدم مديرًا لا يظهر شيء.
(() => {
  'use strict';
  const ui = window.ehsanUI;
  if (!ui) return;
  const {esc, toast, onOpen, session, waitDb} = ui;
  let db, me, minutes = [];

  // ───────── المحلل التجريبي (قواعد نصية) ─────────
  const RE_AGENDA = /^\s*(?:البند\s*)?(?:\(?\d{1,2}\)?\s*[-–.):]|(?:الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر)\s*[:\-–])\s*(.+)$/;
  const RE_DECISION = /(قرر(?:ت)?\s+(?:المجلس|اللجنة|الأعضاء)|تقرر|وافق(?:ت)?\s+(?:المجلس|اللجنة|الأعضاء)|اعتمد(?:ت)?\s+(?:المجلس|اللجنة)|أقر(?:ت)?\s+(?:المجلس|اللجنة)|تمت الموافقة|تم اعتماد)/;
  const RE_RECOMMEND = /(يوصي|أوصى|أوصت|توصي|توصية|يُوصى|يوصى)/;
  const RE_TASK = /(يكلّ?ف|كلّ?ف|كُلّ?ف|يُكلَّف|تكليف|يتولى|تتولى|تولّى|يلتزم|تلتزم|على\s+(?:الأستاذ|الأستاذة|الأخ|الأخت|الدكتور|الدكتورة|المهندس|المهندسة|مدير|رئيس|أمين))/;
  const RE_OWNER = /(?:الأستاذ(?:ة)?|الأخ|الأخت|الدكتور(?:ة)?|د\.|م\.|المهندس(?:ة)?|مدير(?:ة)?|رئيس|أمين(?: السر| الصندوق)?)\s+((?:[ء-ي]+)(?:\s+[ء-ي]+){0,2})/;
  const RE_DUE = /(خلال\s+\d+\s*(?:يوم(?:ا|ًا)?|أيام|أسبوع(?:ا|ًا)?|أسابيع|شهر(?:ا|ًا)?|أشهر|شهور)|خلال\s+(?:أسبوع|أسبوعين|شهر|شهرين|يومين)|بحلول\s+[^،.؛]{2,30}|قبل\s+(?:نهاية\s+)?[^،.؛]{2,30}|نهاية\s+(?:الشهر|الأسبوع|الربع|العام|السنة)[^،.؛]{0,15}|في\s+موعد\s+أقصاه\s+[^،.؛]{2,30}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{4}-\d{2}-\d{2})/;
  const clean = s => s.replace(/\s+/g, ' ').trim();
  const title = s => { const t = clean(s).replace(/^[-–•*\d.)(\s]+/, ''); return t.length > 150 ? t.slice(0, 147) + '…' : t; };

  // المسؤول: بعد اللقب كلمتان كحد أقصى للشخص، وللمنصب (مدير/رئيس/أمين) كلمة واحدة؛ ويتوقف عند كلمة تبدأ بحرف جر (ب/ل) لأنها غالبًا المهمة
  function ownerOf(s) {
    const m = s.match(RE_OWNER); if (!m) return '';
    const role = /^(?:مدير|رئيس|أمين)/.test(m[0].trim());
    const words = [];
    for (const w of m[1].split(' ')) { if (words.length && /^[بل]/.test(w)) break; words.push(w); }
    const text = words.slice(0, role ? 1 : 2).join(' ');
    return role ? clean(m[0].split(/\s+/)[0] + ' ' + text) : text;
  }
  function analyze(text) {
    const out = [], seen = new Set();
    let agenda = '';
    const sentences = String(text || '').split(/\r?\n|(?<=[.؟!؛])\s+/).map(s => s.trim()).filter(Boolean);
    for (const raw of sentences) {
      const am = raw.match(RE_AGENDA);
      if (am && raw.length < 140 && !RE_DECISION.test(raw) && !RE_TASK.test(raw)) { agenda = clean(am[1]); continue; }
      const s = clean(raw);
      if (s.length < 12 || seen.has(s)) continue;
      const isTask = RE_TASK.test(s), isDec = RE_DECISION.test(s), isRec = RE_RECOMMEND.test(s);
      if (!isTask && !isDec && !isRec) continue;
      seen.add(s);
      const owner = ownerOf(s), due = (s.match(RE_DUE) || [])[1] || '';
      // التكليف الصريح مهمة؛ وإلا القرار ثم التوصية. الجملة الواحدة تُصنَّف مرة واحدة حتى لا تتكرر
      const kind = isTask ? 'مهمة' : isDec ? 'قرار' : 'توصية';
      out.push({kind, title: title(s), body: '', quote: s.slice(0, 1000), agenda_ref: agenda.slice(0, 200), owner_hint: kind === 'مهمة' ? clean(owner) : '', due_hint: kind === 'مهمة' ? clean(due) : ''});
    }
    return out;
  }

  // ───────── الواجهة ─────────
  const KIND_CLASS = {'قرار': 'good', 'توصية': 'warn', 'مهمة': ''};
  const STATUS_CLASS = {'مقترح': 'warn', 'معتمد': 'good', 'مرفوض': ''};
  const CSS = `
.ai-note{background:#fff7e6;border:1px solid #f0d9a8;color:#6b4a07;border-radius:12px;padding:9px 14px;margin:0 0 14px;font-size:13.5px;line-height:1.7}
html[data-theme=dark] .ai-note{background:#3a2a12;color:#f1c47a;border-color:#6b4a07}
.ai-bar{display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:14px}
.ai-bar label{flex:1 1 280px;margin:0}
.ai-list{display:grid;gap:12px}
.ai-card{display:grid;gap:8px}
.ai-card h3{margin:0;font-size:16px}
.ai-quote{margin:0;padding:8px 12px;border-inline-start:4px solid var(--primary,#cf6028);background:var(--bg,#f9f4ee);border-radius:8px;font-size:13.5px;color:var(--muted,#6b5f59)}
.ai-meta{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:12.5px;color:var(--muted,#6b5f59)}
.ai-miss{color:#b64242;font-weight:700}
.ai-acts{display:flex;gap:6px;flex-wrap:wrap}
.ai-text{width:100%;min-height:120px}`;

  function paintCard(x) {
    const miss = [];
    if (x.kind === 'مهمة') { if (!x.owner_hint) miss.push('المسؤول غير محدد'); if (!x.due_hint) miss.push('الموعد غير محدد'); }
    return `<article class="card ai-card" data-id="${esc(x.id)}">
      <div class="ai-meta"><span class="badge ${KIND_CLASS[x.kind] || ''}">${esc(x.kind)}</span><span class="badge ${STATUS_CLASS[x.status] || ''}">${esc(x.status)}</span>${x.agenda_ref ? `<span>البند: ${esc(x.agenda_ref)}</span>` : ''}${x.source === 'mock' ? '<span>تحليل تجريبي</span>' : ''}</div>
      <h3>${esc(x.title)}</h3>
      <blockquote class="ai-quote">${esc(x.quote)}</blockquote>
      ${x.kind === 'مهمة' ? `<div class="ai-meta"><span>المسؤول: <b>${esc(x.owner_hint || '—')}</b></span><span>الموعد: <b>${esc(x.due_hint || '—')}</b></span>${miss.length ? `<span class="ai-miss">⚠ ${esc(miss.join('، '))} — أكمله يدويًا عند الاعتماد</span>` : ''}</div>` : ''}
      ${x.status === 'مقترح' ? '<div class="ai-acts"><button type="button" class="btn primary" data-ai-ok>اعتماد</button><button type="button" class="btn secondary" data-ai-no>رفض</button></div>' : (x.reviewed_at ? `<div class="ai-meta">روجع ${esc(new Date(x.reviewed_at).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn'))}${x.review_note ? ' — ' + esc(x.review_note) : ''}</div>` : '')}
    </article>`;
  }

  async function loadList() {
    const sel = document.getElementById('aiMinute'), box = document.getElementById('aiList');
    if (!sel || !box) return;
    if (!sel.value) { box.innerHTML = '<div class="card">اختر محضرًا لعرض مقترحاته.</div>'; return; }
    const {data, error} = await db.from('ai_suggestions').select('*').eq('minute_id', sel.value).order('created_at').order('kind');
    if (error) { box.innerHTML = '<div class="card">تعذر تحميل المقترحات.</div>'; return; }
    box.innerHTML = (data || []).map(paintCard).join('') || '<div class="card">لا مقترحات لهذا المحضر بعد. اضغط «حلّل المحضر».</div>';
  }

  async function loadMinutes() {
    const {data} = await db.from('minutes').select('id,content,created_at,meetings(title)').order('created_at', {ascending: false}).limit(200);
    minutes = data || [];
    const sel = document.getElementById('aiMinute'); if (!sel) return;
    const keep = sel.value;
    sel.innerHTML = '<option value="">اختر المحضر</option>' + minutes.map(m => `<option value="${esc(m.id)}">${esc(m.meetings?.title || 'محضر اجتماع')} — ${esc(new Date(m.created_at).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn'))}</option>`).join('');
    if (keep && minutes.some(m => m.id === keep)) sel.value = keep;
  }

  async function run() {
    const sel = document.getElementById('aiMinute'), pasted = document.getElementById('aiText');
    const m = minutes.find(x => x.id === sel.value);
    if (!m) return toast('اختر المحضر أولًا');
    const text = (pasted.value.trim() || m.content || '').trim();
    if (text.length < 30) return toast('نص المحضر قصير أو فارغ. ألصق النص في الحقل أو أكمل المحضر.');
    const items = analyze(text);
    if (!items.length) { toast('لم يُعثر على قرارات أو توصيات أو مهام صريحة في النص'); }
    const btn = document.getElementById('aiRun'); btn.disabled = true;
    const {error} = await db.rpc('ai_save_suggestions', {p_minute: m.id, p_items: items, p_source: 'mock'});
    btn.disabled = false;
    if (error) return toast(error.message || 'تعذر حفظ المقترحات');
    toast(`تم استخراج ${items.length} مقترح. راجعها قبل الاعتماد.`);
    await loadList();
  }

  async function review(id, status) {
    let note = null;
    if (status === 'مرفوض') { note = window.prompt('سبب الرفض (اختياري)') ; if (note === null) return; }
    const {error} = await db.rpc('ai_review_suggestion', {p_id: id, p_status: status, p_note: note});
    if (error) return toast(error.message || 'تعذر حفظ المراجعة');
    toast(status === 'معتمد' ? 'تم اعتماد المقترح' : 'تم رفض المقترح');
    await loadList();
  }

  function mount() {
    const main = document.querySelector('.main-area');
    if (!main) return false;
    if (!document.getElementById('view-ai-assist')) {
      const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
      const sec = document.createElement('section'); sec.className = 'view'; sec.id = 'view-ai-assist';
      sec.innerHTML = `<div class="section-head"><div><span class="eyebrow">المساعد الذكي</span><h2>مساعد أمين السر</h2></div></div>
        <div class="ai-note" role="note"><b>وضع تجريبي:</b> يستخرج المساعد القرارات والتوصيات والمهام من نص المحضر بقواعد نصية بسيطة داخل متصفحك، ولا تُرسل المحاضر إلى أي جهة خارجية. المخرجات <b>مقترحات فقط</b>: تحقق من الجملة المصدر، وأكمل المسؤول والموعد الناقصين، ثم اعتمد. الاعتماد هنا لا ينشئ قرارًا أو مهمة رسمية؛ سجّلها يدويًا في شاشة القرارات.</div>
        <div class="ai-bar"><label>المحضر<select id="aiMinute"></select></label><button type="button" class="btn primary" id="aiRun">حلّل المحضر</button></div>
        <label>نص للتحليل (اختياري، وإلا يُستخدم نص المحضر المحفوظ)<textarea id="aiText" class="ai-text" maxlength="40000" placeholder="ألصق هنا نص المحضر أو ملاحظات أمين السر"></textarea></label>
        <div class="ai-list" id="aiList" style="margin-top:14px"></div>`;
      main.append(sec);
    }
    return true;
  }

  async function start() {
    db = await waitDb(); if (!db) return;
    me = await session(db); if (!me || !me.admin) { document.querySelectorAll('[data-view="ai-assist"]').forEach(b => { b.hidden = true; }); return; }
    const probe = await db.from('ai_suggestions').select('id').limit(1);
    if (probe.error) { document.querySelectorAll('[data-view="ai-assist"]').forEach(b => { b.hidden = true; }); return; } // الترحيل 016 غير مطبّق: لا يتغير شيء
    if (!mount()) return;
    document.querySelectorAll('[data-view="ai-assist"]').forEach(b => { b.hidden = false; });
    document.getElementById('aiRun').addEventListener('click', run);
    document.getElementById('aiMinute').addEventListener('change', loadList);
    document.getElementById('aiList').addEventListener('click', e => {
      const card = e.target.closest('.ai-card'); if (!card) return;
      if (e.target.closest('[data-ai-ok]')) review(card.dataset.id, 'معتمد');
      else if (e.target.closest('[data-ai-no]')) review(card.dataset.id, 'مرفوض');
    });
    onOpen({'ai-assist': async () => { await loadMinutes(); await loadList(); }});
    await loadMinutes();
  }
  window.ehsanAiAssist = {analyze}; // للاختبار والتطوير
  start().catch(err => console.error('ai-assist', err));
})();
