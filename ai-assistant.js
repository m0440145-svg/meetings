// مساعد أمين السر (المرحلة 1، الترحيل 016). وضع تجريبي: التحليل يتم داخل المتصفح بقواعد نصية بسيطة ولا تغادر المحاضر جهازك.
// يستخرج القرارات والتوصيات والمهام مع الجملة المصدر والبند والمسؤول والموعد، ويحفظها «مقترحة» لمراجعة أمين السر.
// لا ينشئ قرارًا رسميًا تلقائيًا: التحويل مسودة قرار تمر بمسار الاعتماد. ميزة مضافة: إن لم يكن الترحيل مطبّقًا أو لم يكن المستخدم مديرًا لا يظهر شيء.
(() => {
  'use strict';
  const ui = window.ehsanUI;
  if (!ui) return;
  const {esc, toast, onOpen, session, waitDb} = ui;
  let db, me, minutes = [];

  // ───────── المحلل التجريبي (قواعد نصية) ─────────
  // مبني على صياغة محاضر الجمعية الفعلية: جدول «محاور» مرقّم، ثم جدول «قرارات وتوصيات» بالترقيم نفسه، فيُربط كل صف بمحوره برقمه.
  // الصف الواحد قد يجمع إحاطة («اطلع / ناقش / أشاد») وتوصية («أكد على أهمية / أوصى») وقرارًا («الموافقة على») وتكليفًا («تفويض … بمتابعة»)،
  // فيُقطع عند أفعال الإجراء ويُصنَّف كل مقطع وحده؛ ومقاطع الإحاطة والشكر لا تُستخرج.
  const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩', FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
  const latinDigits = s => String(s).replace(/[٠-٩۰-۹]/g, d => String(AR_DIGITS.includes(d) ? AR_DIGITS.indexOf(d) : FA_DIGITS.indexOf(d)));
  const ORD = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر'];
  const RE_NUM = /^\s*\(?(\d{1,2})\)?\s*[-–.):|]?\s+(.{3,})$/;
  const RE_ORDINAL = new RegExp('^\\s*(?:البند\\s*)?(' + ORD.join('|') + ')\\s*[:\\-–]\\s*(.+)$');
  const RE_SEC_AGENDA = /^\s*(?:محاور|جدول\s+الأعمال|بنود\s+الاجتماع|جدول\s+أعمال)/;
  const RE_SEC_OUT = /^\s*(?:قرارات|القرارات|توصيات|التوصيات|نتائج|ما\s+تم|مخرجات)/;
  const RE_HEADING = /^\s*(?:محضر|محاور|جدول\s+الأعمال|قرارات|القرارات|التوصيات|توصيات|رقم\s+الاجتماع|الحضور|بسم\s+الله|اعتماد\s+رئيس)/;
  // أفعال الإجراء التي يبدأ عندها مقطع جديد (مسبوقة اختياريًا بـ «، و / كما / ثم / مع»)
  const VERBS = 'أكد|اكد|أكّد|التأكيد|أوصى|اوصى|أوصت|يوصي|توصي(?=\\s)|يُوصى|يوصى|وجّه|وجه|توجيه|قرر|قرّر|تقرر|الموافقة|وافق|اعتمد|اعتماد|إقرار|أقر|تفويض|فوّض|يفوض|تكليف|يكلّف|يكلف|كلّف|كلف|يُكلَّف|يتولى|تتولى|مراعاة|ضرورة';
  const RE_CUT = new RegExp('(?:[،,]\\s*|\\s+)(?:و\\s*|كما\\s+|ثم\\s+|مع\\s+)?(?=(?:' + VERBS + '))');
  const RE_DEC = /^(?:الموافقة|وافق|قرر|قرّر|تقرر|اعتمد|اعتماد|إقرار|أقر|تمت\s+الموافقة|تم\s+اعتماد)/;
  const RE_TASK = /^(?:تفويض|فوّض|يفوض|تكليف|يكلّف|يكلف|كلّف|كلف|يُكلَّف|يتولى|تتولى)/;
  const RE_REC = /^(?:أكد|اكد|أكّد|التأكيد|أوصى|اوصى|أوصت|يوصي|توصي|يُوصى|يوصى|وجّه|وجه|توجيه|مراعاة|ضرورة)/;
  const RE_TASK_ANY = /(?:يكلّ?ف|كلّ?ف|يُكلَّف|تكليف|تفويض|يتولى|تتولى|على\s+(?:الأستاذ|الأستاذة|الدكتور|الدكتورة|المهندس|المهندسة|المدير|مدير|الإدارة|إدارة|لجنة|اللجنة|أمين))/;
  const RE_TITLE_OWNER = /(?:الأستاذ(?:ة)?|أ\.|الدكتور(?:ة)?|د\.|المهندس(?:ة)?|م\.)\s*((?:[ء-ي]+)(?:\s+[ء-ي]+)?)/;
  const RE_DUE = /(خلال\s+\d+\s*(?:يوم(?:ا|ًا)?|أيام|أسبوع(?:ا|ًا)?|أسابيع|شهر(?:ا|ًا)?|أشهر|شهور)|خلال\s+(?:أسبوع|أسبوعين|شهر|شهرين|يومين)|بحلول\s+[^،.؛]{2,30}|قبل\s+(?:نهاية\s+)?[^،.؛]{2,30}|نهاية\s+(?:الشهر|الأسبوع|الربع|العام|السنة)[^،.؛]{0,15}|في\s+موعد\s+أقصاه\s+[^،.؛]{2,30}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{4}-\d{2}-\d{2})/;
  const clean = s => s.replace(/\s+/g, ' ').trim();
  const strip = s => clean(s).replace(/^[-–•*\d.)(\s،,]+/, '').replace(/[،,؛\s]+$/, '');
  const short = (s, n) => s.length > n ? s.slice(0, n - 1).replace(/\s\S*$/, '') + '…' : s;

  // المسؤول: بعد فعل التكليف/التفويض («تفويض المدير التنفيذي بمتابعة» ← «المدير التنفيذي»)، ويتوقف عند كلمة تبدأ بحرف جر؛ وإلا بعد اللقب (أ. / د. / م.)
  function ownerOf(s) {
    const m = s.match(/(?:تفويض|فوّض|يفوض|تكليف|يكلّف|يكلف|كلّف|كلف|يُكلَّف|يتولى|تتولى|على)\s+((?:[ء-ي.]+\s*){1,5})/);
    if (m) {
      const words = [];
      for (const w of m[1].trim().split(/\s+/)) {
        // يتوقف عند حرف جر، أو مصدر يبدأ به نص المهمة («متابعة / إعداد / تنفيذ …»)
        if (words.length && (/^[بل][ء-ي]{2,}/.test(w) || /^(?:في|من|إلى|الى|على|عن|حتى|خلال|قبل)$/.test(w) || /^(?:متابعة|إعداد|اعداد|تنفيذ|التنسيق|تنسيق|رفع|دراسة|استكمال|مراجعة|تقديم|إعادة|تحديث|إنهاء|التواصل|تواصل)$/.test(w))) break;
        words.push(w); if (words.length >= 4) break;
      }
      const o = words.join(' ').replace(/^(?:الأستاذ(?:ة)?|أ\.|الدكتور(?:ة)?|د\.|المهندس(?:ة)?|م\.)\s*/, '');
      if (o && !/^(?:ذلك|ما|أن)$/.test(o)) return o;
    }
    const t = s.match(RE_TITLE_OWNER);
    return t ? t[1] : '';
  }

  function classify(seg) {
    if (/^التصويت\s/.test(seg)) return ''; // سطر نتيجة تصويت (من مسودة المحضر): موضوعه قد يحوي «تفويض» أو «اعتماد» وليس قرارًا ولا مهمة بذاته
    if (RE_DEC.test(seg)) return 'قرار';
    if (RE_TASK.test(seg) || RE_TASK_ANY.test(seg.slice(0, 40))) return 'مهمة';
    if (RE_REC.test(seg)) return 'توصية';
    return '';
  }

  // يستخرج من صف/جملة واحدة كل المقاطع الإجرائية مع ربطها بالمحور
  function fromRow(row, agendaRef, out, seen) {
    // مقطع قصير جدًا («قرر المجلس») يُضم إلى ما بعده حتى لا يُفصل الفعل عن مفعوله («قرر المجلس اعتماد …»)
    const segs = row.split(RE_CUT).map(strip).filter(Boolean).reduce((a, s) => { if (a.length && a[a.length - 1].length < 22) a[a.length - 1] += ' ' + s; else a.push(s); return a; }, []);
    let lastDecision = '';
    for (const seg of segs) {
      const kind = classify(seg); if (!kind || seg.length < 8) continue;
      const key = kind + '|' + seg; if (seen.has(key)) continue; seen.add(key);
      let t = seg;
      if (kind === 'قرار') lastDecision = seg;
      // «تفويض … بمتابعة ذلك» يُكمَّل بموضوع القرار الذي يسبقه في الصف نفسه، أو بالمحور
      if (kind === 'مهمة' && /(?:ذلك|ما\s+سبق|ما\s+تقدم)\s*\.?$/.test(seg)) t = seg.replace(/\.$/, '') + ' — ' + short(lastDecision || agendaRef || '', 90);
      out.push({kind, title: short(t, 150), body: row !== seg ? short(clean(row), 2000) : '', quote: seg.slice(0, 1000), agenda_ref: (agendaRef || '').slice(0, 200),
        owner_hint: kind === 'مهمة' ? ownerOf(seg).slice(0, 120) : '', due_hint: kind === 'مهمة' ? ((seg.match(RE_DUE) || [])[1] || '').slice(0, 120) : ''});
    }
  }

  function analyze(text) {
    const out = [], seen = new Set(), agendaByNum = new Map();
    let section = '', current = '';
    const lines = String(text || '').split(/\r?\n/).map(l => l.replace(/ /g, ' ').trim()).filter(Boolean);
    for (const raw of lines) {
      const line = latinDigits(raw);
      if (RE_SEC_AGENDA.test(line) && line.length < 60) { section = 'agenda'; continue; }
      if (RE_SEC_OUT.test(line) && line.length < 60) { section = 'out'; continue; }
      const ord = line.match(RE_ORDINAL);
      if (ord && line.length < 140) { current = strip(ord[2]); agendaByNum.set(ORD.indexOf(ord[1]) + 1, current); continue; } // «البند الأول: …» عنوان محور دائمًا
      const num = line.match(RE_NUM);
      if (num) {
        const n = Number(num[1]), body = num[2];
        const firstTime = !agendaByNum.has(n);
        const actionable = body.split(RE_CUT).some(s => classify(strip(s)));
        // صف محور: في قسم المحاور، أو أول ظهور للرقم بلا فعل إجرائي (والمحاور قصيرة عادة)
        if (section === 'agenda' || (section !== 'out' && firstTime && !actionable && body.length < 160)) { agendaByNum.set(n, strip(body)); continue; }
        fromRow(body, agendaByNum.get(n) || current, out, seen);
        continue;
      }
      if (RE_HEADING.test(line) && line.length < 80) continue;
      // نص نثري: يُقسم إلى جمل ثم مقاطع
      for (const sent of line.split(/(?<=[.؟!؛])\s+/)) fromRow(sent, current, out, seen);
    }
    return out;
  }

  // ───────── الواجهة ─────────
  const KIND_CLASS = {'قرار': 'good', 'توصية': 'warn', 'مهمة': ''};
  const STATUS_CLASS = {'مقترح': 'warn', 'معتمد': 'good', 'مرفوض': '', 'محوّل': 'good'};
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
      ${x.status === 'مقترح' ? '<div class="ai-acts"><button type="button" class="btn primary" data-ai-ok>اعتماد</button><button type="button" class="btn secondary" data-ai-conv>اعتماد وتحويل إلى مسودة قرار</button><button type="button" class="btn secondary" data-ai-no>رفض</button></div>' : x.status === 'معتمد' ? '<div class="ai-acts"><button type="button" class="btn primary" data-ai-conv>تحويل إلى مسودة قرار</button></div>' : x.status === 'محوّل' ? `<div class="ai-meta">تحوّل إلى مسودة قرار${x.decision_ref ? ' رقم <b>' + esc(x.decision_ref) + '</b>' : ''} — تجدها في «كل القرارات»</div>` : (x.reviewed_at ? `<div class="ai-meta">روجع ${esc(new Date(x.reviewed_at).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn'))}${x.review_note ? ' — ' + esc(x.review_note) : ''}</div>` : '')}
    </article>`;
  }

  async function loadList() {
    const sel = document.getElementById('aiMinute'), box = document.getElementById('aiList');
    if (!sel || !box) return;
    if (!sel.value) { box.innerHTML = '<div class="card">اختر محضرًا لعرض مقترحاته.</div>'; return; }
    const {data, error} = await db.from('ai_suggestions').select('*').eq('minute_id', sel.value).order('created_at').order('kind');
    if (error) { box.innerHTML = '<div class="card">تعذر تحميل المقترحات.</div>'; return; }
    const ids = (data || []).map(x => x.decision_id).filter(Boolean);
    if (ids.length) {
      const {data: ds} = await db.from('decisions').select('id,ref_no').in('id', ids);
      const ref = new Map((ds || []).map(d => [d.id, d.ref_no]));
      (data || []).forEach(x => { x.decision_ref = ref.get(x.decision_id) || ''; });
    }
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

  // تحويل مقترح إلى مسودة قرار عبر dm_create_decision (صلاحياتها وترقيمها)، ثم تسجيل الصلة. تبقى المسودة بانتظار مراجعة واعتماد الجهة المختصة.
  const RECORD = {'قرار': 'decision', 'توصية': 'recommendation', 'مهمة': 'assignment'};
  async function convert(id) {
    if (!window.DM?.form || !window.DM?.rpc) return toast('وحدة القرارات غير جاهزة بعد، أعد المحاولة بعد لحظات');
    const {data: x} = await db.from('ai_suggestions').select('*').eq('id', id).single();
    if (!x || !['مقترح', 'معتمد'].includes(x.status)) return toast('المقترح غير متاح للتحويل');
    const {data: mn} = await db.from('minutes').select('id,meeting_id,meetings(id,committee_id,title,meeting_no)').eq('id', x.minute_id).single();
    const mt = mn?.meetings;
    if (!mt?.committee_id) return toast('اجتماع المحضر غير مرتبط بمجلس أو لجنة؛ اربطه أولًا ثم أعد المحاولة');
    const notes = [x.agenda_ref && `البند: ${x.agenda_ref}`, x.owner_hint && `المسؤول المقترح: ${x.owner_hint}`, x.due_hint && `الموعد المقترح: ${x.due_hint}`, 'أُنشئت المسودة من مقترح مساعد أمين السر'].filter(Boolean).join('\n');
    const opt = (v, l) => ({value: v, label: l});
    await window.DM.form({
      title: 'تحويل إلى مسودة قرار', wide: true,
      intro: `من محضر «${mt.title}». تُنشأ مسودة فقط، وتمر بمسار الاعتماد المعتاد قبل أن تصير قرارًا نافذًا. راجع النص وأكمل ما ينقص.`,
      fields: [
        {name: 'kind', label: 'نوع الجهة', type: 'select', options: [opt('committee', 'لجنة'), opt('board', 'مجلس إدارة')], value: 'committee'},
        {name: 'title', label: 'عنوان القرار', required: true, value: x.title.slice(0, 190), maxlength: 200},
        {name: 'body_text', label: 'نص القرار', type: 'textarea', rows: 5, required: true, value: x.quote},
        {name: 'notes', label: 'ملاحظات', type: 'textarea', rows: 3, value: notes, help: 'المسؤول والموعد يُعيَّنان رسميًا لاحقًا من شاشة القرار بعد اعتماده.'}
      ],
      submit: 'إنشاء المسودة',
      onSubmit: async v => {
        const decision = await window.DM.rpc('dm_create_decision', {p: {committee_id: mt.committee_id, body_kind: v.kind, meeting_id: mt.id, minute_id: mn.id, record_type: RECORD[x.kind] || 'decision', title: v.title, body_text: v.body_text, notes: v.notes}});
        const {error} = await db.rpc('ai_link_decision', {p_id: id, p_decision: decision});
        if (error) toast('أُنشئت المسودة لكن تعذر تسجيل الربط: ' + (error.message || ''));
        else toast('أُنشئت مسودة القرار؛ راجعها من «كل القرارات»');
        await loadList();
      }
    });
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
      if (e.target.closest('[data-ai-conv]')) convert(card.dataset.id);
      else if (e.target.closest('[data-ai-ok]')) review(card.dataset.id, 'معتمد');
      else if (e.target.closest('[data-ai-no]')) review(card.dataset.id, 'مرفوض');
    });
    onOpen({'ai-assist': async () => { await loadMinutes(); await loadList(); }});
    await loadMinutes();
  }
  window.ehsanAiAssist = {analyze}; // للاختبار والتطوير
  start().catch(err => console.error('ai-assist', err));
})();
