// مستشار المحاضر (المرحلة 3، الترحيل 018): بحث في المحاضر المعتمدة والقرارات بصلاحيات السائل نفسها (RLS)، ونتائجه مقاطع حرفية مع مصدرها.
// وضع تجريبي: ترتيب النتائج بتطابق الكلمات داخل المتصفح بلا أي إرسال خارجي، ولا يولّد المستشار إجابات من عنده؛ يعرض ما قيل وأين، ومعه حالة تنفيذ القرار.
// تسجيل السؤال في سجل التدقيق اختياري: إن لم يكن الترحيل 018 مطبّقًا يعمل البحث دون تسجيل.
(() => {
  'use strict';
  const ui = window.ehsanUI;
  if (!ui) return;
  const {esc, toast, onOpen, session, waitDb} = ui;
  let db, me, corpus = null, loadedAt = 0;

  // ───────── تطبيع العربية والبحث ─────────
  const STOP = new Set('في من على الى إلى عن مع هذا هذه ذلك تلك التي الذي الذين كان كانت يكون تكون ان أن إن او أو ثم قد لا لم لن ما هل كل بعد قبل عند حتى كما لكن هو هي هم'.split(' ').map(w => norm(w)));
  function norm(s) {
    return String(s || '').replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').toLowerCase();
  }
  function stem(w) { // تجريد خفيف للسوابق الشائعة؛ كافٍ للمطابقة التقريبية
    let t = w;
    for (const p of ['وال', 'بال', 'لل', 'كال', 'فال', 'ال', 'و', 'ب', 'ل']) { if (t.startsWith(p) && t.length - p.length >= 3) { t = t.slice(p.length); break; } }
    return t;
  }
  const tokens = s => norm(s).split(/[^ء-يa-z0-9]+/).filter(w => w.length >= 2 && !STOP.has(w)).map(stem);
  const passages = text => {
    const sents = String(text || '').split(/\r?\n|(?<=[.؟!؛])\s+/).map(s => s.replace(/\s+/g, ' ').trim()).filter(s => s.length >= 8);
    const out = [];
    for (let i = 0; i < sents.length; i += 1) out.push(sents[i] + (sents[i + 1] && sents[i].length < 90 ? ' ' + sents[i + 1] : ''));
    return out;
  };

  const DEC_STATUS = {approved: 'معتمد', pending_assignment: 'بانتظار الإسناد', assigned: 'مُسنَد', executing: 'قيد التنفيذ', awaiting_update: 'بانتظار تحديث', pending_verification: 'بانتظار التحقق', completed: 'منجز', closed: 'مغلق'};
  const fmtDate = d => { const x = new Date(d); return isNaN(x) ? '' : x.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn'); };

  async function loadCorpus(force) {
    if (corpus && !force && Date.now() - loadedAt < 120000) return corpus;
    const docs = [];
    const mn = await db.from('minutes').select('id,content,recommendations,status,created_at,meetings(title,gregorian_date)').eq('status', 'معتمد').order('created_at', {ascending: false}).limit(300);
    (mn.data || []).forEach(m => {
      const where = `محضر «${m.meetings?.title || 'اجتماع'}»${m.meetings?.gregorian_date ? ' — ' + fmtDate(m.meetings.gregorian_date) : ''}`;
      [['نص المحضر', m.content], ['التوصيات', m.recommendations]].forEach(([part, txt]) => passages(txt).forEach(p => docs.push({kind: 'محضر', where, part, text: p, tk: new Set(tokens(p))})));
    });
    const dc = await db.from('decisions').select('id,ref_no,title,body_text,status,due_date,progress_pct,decision_date').in('status', Object.keys(DEC_STATUS)).order('created_at', {ascending: false}).limit(500);
    (dc.data || []).forEach(d => {
      const where = `قرار ${d.ref_no}${d.decision_date ? ' — ' + fmtDate(d.decision_date) : ''}`;
      const state = `${DEC_STATUS[d.status] || d.status}${d.due_date ? ' · الموعد ' + fmtDate(d.due_date) : ''}${d.progress_pct ? ' · الإنجاز ' + d.progress_pct + '%' : ''}`;
      const text = `${d.title}. ${d.body_text}`;
      docs.push({kind: 'قرار', where, part: d.title, state, text: d.body_text || d.title, tk: new Set(tokens(text))});
    });
    corpus = docs; loadedAt = Date.now();
    return docs;
  }

  function search(q, docs) {
    const qt = [...new Set(tokens(q))];
    if (!qt.length) return [];
    const phrase = norm(q).trim();
    const scored = [];
    for (const d of docs) {
      let hit = 0;
      for (const t of qt) { if (d.tk.has(t)) hit += 1; else for (const x of d.tk) { if (x.length >= 4 && t.length >= 4 && (x.startsWith(t) || t.startsWith(x))) { hit += .6; break; } } }
      if (!hit) continue;
      let s = hit / qt.length;
      if (norm(d.text).includes(phrase)) s += .5;
      if (d.kind === 'قرار') s += .05;
      scored.push({d, s});
    }
    scored.sort((a, b) => b.s - a.s);
    return scored.slice(0, 8);
  }

  function mark(text, qt) {
    let h = esc(text.length > 420 ? text.slice(0, 417) + '…' : text);
    qt.filter(t => t.length >= 3).forEach(t => { h = h.replace(new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\u0621-\\u064A]*)', 'g'), '<mark>$1</mark>'); });
    return h;
  }

  // ───────── الواجهة ─────────
  const CSS = `
.av-bar{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}
.av-bar input{flex:1 1 320px}
.av-hit{display:grid;gap:8px;margin-bottom:12px}
.av-src{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:12.5px;color:var(--muted,#6b5f59)}
.av-text{margin:0;line-height:1.9}
.av-text mark{background:#ffe3b8;color:inherit;border-radius:4px;padding:0 2px}
html[data-theme=dark] .av-text mark{background:#6b4a07}
.av-state{font-weight:700;color:var(--primary,#cf6028)}
.av-hint{font-size:13px;color:var(--muted,#6b5f59)}`;

  async function ask() {
    const input = document.getElementById('avQ'), box = document.getElementById('avRes');
    const q = input.value.trim();
    if (q.length < 3) return toast('اكتب سؤالك أو كلمات البحث (3 أحرف على الأقل)');
    box.innerHTML = '<div class="card">جاري البحث…</div>';
    let docs;
    try { docs = await loadCorpus(false); } catch { box.innerHTML = '<div class="card">تعذر تحميل المحاضر.</div>'; return; }
    const res = search(q, docs), qt = [...new Set(tokens(q))];
    db.rpc('ai_log_query', {p_query: q, p_results: res.length}).then(() => {}, () => {}); // تسجيل اختياري
    if (!res.length) { box.innerHTML = '<div class="card">لا نتائج في المحاضر المعتمدة والقرارات التي يحق لك الاطلاع عليها. جرّب كلمات أخرى.</div>'; return; }
    box.innerHTML = `<p class="av-hint">${res.length} نتيجة، مرتبة بالأقرب. هذه مقاطع حرفية من السجلات، وليست إجابة مولَّدة؛ ارجع إلى المصدر للتأكد.</p>` +
      res.map(({d}) => `<article class="card av-hit"><div class="av-src"><span class="badge ${d.kind === 'قرار' ? 'good' : ''}">${esc(d.kind)}</span><span>${esc(d.where)}</span>${d.kind === 'محضر' ? `<span>— ${esc(d.part)}</span>` : ''}</div>
        ${d.kind === 'قرار' ? `<strong>${esc(d.part)}</strong>` : ''}<p class="av-text">${mark(d.text, qt)}</p>${d.state ? `<div class="av-state">حالة التنفيذ: ${esc(d.state)}</div>` : ''}</article>`).join('');
  }

  function mount() {
    const main = document.querySelector('.main-area');
    if (!main) return false;
    if (!document.getElementById('view-ai-advisor')) {
      const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
      const sec = document.createElement('section'); sec.className = 'view'; sec.id = 'view-ai-advisor';
      sec.innerHTML = `<div class="section-head"><div><span class="eyebrow">المساعد الذكي</span><h2>مستشار المحاضر</h2></div></div>
        <div class="ai-note" role="note" style="background:#fff7e6;border:1px solid #f0d9a8;color:#6b4a07;border-radius:12px;padding:9px 14px;margin:0 0 14px;font-size:13.5px;line-height:1.7"><b>وضع تجريبي:</b> يبحث في المحاضر المعتمدة والقرارات المعتمدة التي يحق لك الاطلاع عليها فقط، ويعرض المقاطع المطابقة مع مصدرها وحالة تنفيذ القرار. لا يولّد إجابات من عنده ولا تُرسل بياناتك إلى أي جهة خارجية. يُسجَّل نص السؤال في سجل التدقيق.</div>
        <form class="av-bar" id="avForm"><input id="avQ" type="search" maxlength="200" placeholder="مثال: ما قرار المجلس بشأن ميزانية الكفالة؟" aria-label="سؤالك" /><button type="submit" class="btn primary">ابحث</button></form>
        <div id="avRes"></div>`;
      main.append(sec);
    }
    return true;
  }

  async function start() {
    db = await waitDb(); if (!db) return;
    me = await session(db); if (!me) return;
    if (!mount()) return;
    document.getElementById('avForm').addEventListener('submit', e => { e.preventDefault(); ask(); });
    onOpen({'ai-advisor': () => { corpus = null; }});
  }
  window.ehsanAiAdvisor = {search, tokens, norm}; // للاختبار والتطوير
  start().catch(err => console.error('ai-advisor', err));
})();
