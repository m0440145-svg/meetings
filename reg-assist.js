// مساعد الأنظمة (الترحيل 033): بحث في مواد الأنظمة التي أدخلها المدير، ويعرض نص المادة مع الاستشهاد (النظام + رقم المادة). لا توليد ولا خدمة خارجية، ولا يُجيب إلا بنصوص مُدخلة.
// ميزة مضافة: إن لم يكن الترحيل مطبّقًا لا يظهر شيء.
(() => {
  'use strict';
  const ui = window.ehsanUI;
  if (!ui) return;
  const {esc, toast, onOpen, session, waitDb} = ui;
  let db, me, regs = [], arts = [];

  // تطبيع عربي مبسّط: إزالة التشكيل والتطويل، توحيد الألف والياء والتاء المربوطة، حذف «ال» وحروف الجر الملتصقة
  const norm = s => String(s || '').replace(/[ً-ْـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').toLowerCase();
  const STOP = new Set(['من', 'في', 'على', 'الى', 'عن', 'ما', 'هل', 'هو', 'هي', 'ان', 'او', 'ثم', 'كل', 'عند', 'اذا', 'لا', 'كيف', 'متى', 'ماذا', 'هذا', 'هذه', 'التي', 'الذي', 'مع', 'بين', 'قبل', 'بعد', 'يتم', 'يجب', 'تكون', 'يكون']);
  const stem = w => { let x = w; for (const p of ['وال', 'بال', 'لل', 'ال', 'و', 'ب', 'ل']) if (x.startsWith(p) && x.length - p.length >= 3) { x = x.slice(p.length); break; } for (const sfx of ['ات', 'ون', 'ين', 'ها', 'ه']) if (x.endsWith(sfx) && x.length - sfx.length >= 3) { x = x.slice(0, -sfx.length); break; } return x; };
  const tokens = s => norm(s).split(/[^ء-يa-z0-9]+/).filter(w => w.length > 1 && !STOP.has(w)).map(stem);

  function search(q) {
    const qt = [...new Set(tokens(q))]; if (!qt.length) return [];
    arts.forEach(a => { a._t = a._t || new Set(tokens(a.body + ' ' + a.art_no)); });
    const has = (a, t) => a._t.has(t) || (t.length >= 4 && [...a._t].some(x => x.length >= 4 && (x.startsWith(t) || t.startsWith(x))));
    const N = arts.length, df = new Map(); // الكلمة النادرة أثقل من الشائعة
    qt.forEach(t => df.set(t, arts.reduce((n, a) => n + (has(a, t) ? 1 : 0), 0)));
    const w = t => Math.log(1 + N / (1 + df.get(t))), tot = qt.reduce((s, t) => s + w(t), 0);
    const out = [];
    for (const a of arts) {
      let sc = 0; for (const t of qt) if (has(a, t)) sc += w(t);
      if (sc) out.push({a, score: sc / tot});
    }
    return out.sort((x, y) => y.score - x.score).slice(0, 6);
  }

  // تقسيم نص مُلصق إلى مواد: سطر يبدأ بـ«المادة» أو «مادة» يبدأ مادة جديدة (رقمها ما قبل النقطتين/الشرطة)
  function parse(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n'); const out = []; let cur = null;
    const re = /^\s*(?:ال)?مادة\s*[\(\[]?\s*([^\n:：\-–—.]{1,60}?)\s*[\)\]]?\s*(?:[:：\-–—.]\s*(.*))?$/;
    for (const ln of lines) {
      const m = ln.match(re);
      if (m && ln.trim().length < 140) { cur = {art_no: 'المادة ' + m[1].trim(), body: (m[2] || '').trim()}; out.push(cur); }
      else if (cur && ln.trim()) cur.body += (cur.body ? '\n' : '') + ln.trim();
    }
    return out.filter(a => a.body);
  }

  async function load() {
    const [r, a] = await Promise.all([db.from('regulations').select('id,title,version,status').order('title').limit(500), db.from('regulation_articles').select('id,regulation_id,seq,art_no,body').order('seq').limit(10000)]);
    if (r.error || a.error) { toast('تعذر تحميل مواد الأنظمة'); return; }
    regs = r.data || []; arts = a.data || [];
    const rm = new Map(regs.map(x => [x.id, x])); arts.forEach(x => { x._reg = rm.get(x.regulation_id); });
    const counts = new Map(); arts.forEach(x => counts.set(x.regulation_id, (counts.get(x.regulation_id) || 0) + 1));
    document.getElementById('raInfo').textContent = arts.length ? `${arts.length} مادة من ${counts.size} نظام` : 'لم تُدخل مواد بعد' + (me.admin ? ' — استخدم «إدخال مواد نظام».' : '.');
    const sel = document.getElementById('raRegSel'); if (sel) sel.innerHTML = regs.map(x => `<option value="${esc(x.id)}">${esc(x.title)} (${counts.get(x.id) || 0} مادة)</option>`).join('');
  }

  function ask() {
    const q = document.getElementById('raQ').value.trim(); const box = document.getElementById('raOut');
    if (q.length < 3) { box.innerHTML = ''; return; }
    if (!arts.length) { box.innerHTML = '<div class="card">لا توجد مواد مُدخلة للبحث فيها.</div>'; return; }
    const res = search(q);
    box.innerHTML = res.length ? res.map(({a, score}) => `<article class="card" style="display:grid;gap:6px"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><strong>${esc(a._reg?.title || 'نظام')} — ${esc(a.art_no)}</strong><span class="badge ${score >= .6 ? 'good' : 'warn'}">تطابق ${Math.round(Math.min(score, 1) * 100)}%</span></div><div style="white-space:pre-wrap;line-height:1.9">${esc(a.body)}</div></article>`).join('')
      + '<div class="card" style="font-size:12.5px;opacity:.8">النتائج نصوص النظام كما أُدخلت مع رقم المادة للاستشهاد، وهي بحث بالكلمات لا تفسير قانوني؛ راجع النص الرسمي عند الاعتماد.</div>'
      : '<div class="card">لا نص مطابق في الأنظمة المُدخلة. جرّب كلمات أخرى.</div>';
  }

  async function importDlg() {
    if (!regs.length) return toast('أضف نظامًا أولًا من «مرجع الأنظمة»');
    const dlg = document.createElement('dialog'); dlg.style.cssText = 'border:0;border-radius:18px;padding:0;width:min(94vw,720px);max-height:92vh;background:var(--card,#fff);color:inherit';
    dlg.innerHTML = `<div style="padding:16px 20px;display:grid;gap:10px;max-height:88vh;overflow:auto"><h3 style="margin:0">إدخال مواد نظام</h3>
      <label>النظام<select id="raRegSel2" style="width:100%">${document.getElementById('raRegSel').innerHTML}</select></label>
      <label>الصق نص النظام (كل مادة تبدأ بسطر «المادة ...»)<textarea id="raTxt" rows="10" style="width:100%"></textarea></label>
      <label><input type="checkbox" id="raRep"> استبدال المواد الحالية لهذا النظام</label>
      <div id="raPrev" style="font-size:13px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn ghost" data-x>إغلاق</button><button type="button" class="btn primary" id="raSave" disabled>حفظ المواد</button></div></div>`;
    dlg.addEventListener('close', () => dlg.remove()); document.body.append(dlg); dlg.showModal();
    let parsed = [];
    dlg.querySelector('#raTxt').addEventListener('input', e => { parsed = parse(e.target.value); dlg.querySelector('#raPrev').innerHTML = parsed.length ? `تم التعرف على <b>${parsed.length}</b> مادة. أول مادة: ${esc(parsed[0].art_no)}، وآخر مادة: ${esc(parsed[parsed.length - 1].art_no)}.` : 'لم يُتعرَّف على مواد بعد.'; dlg.querySelector('#raSave').disabled = !parsed.length; });
    dlg.querySelector('[data-x]').onclick = () => dlg.close();
    dlg.querySelector('#raSave').onclick = async () => {
      const rep = dlg.querySelector('#raRep').checked;
      if (rep && !await window.ehsanConfirm('سيُحذف ما أُدخل سابقًا من مواد هذا النظام ويُستبدل. متابعة؟')) return;
      const {data, error} = await db.rpc('regulation_import', {p_regulation: dlg.querySelector('#raRegSel2').value, p_articles: parsed, p_replace: rep});
      if (error) return toast(error.message || 'تعذر الحفظ');
      toast(`أُدخلت ${data} مادة`); dlg.close(); load();
    };
  }

  function build() {
    const main = document.querySelector('.main-area'); if (!main) return false;
    if (!document.getElementById('view-reg-assist')) {
      const sec = document.createElement('section'); sec.className = 'view'; sec.id = 'view-reg-assist';
      sec.innerHTML = `<div class="section-head"><div><span class="eyebrow">الحوكمة</span><h2>مساعد الأنظمة</h2></div>${me.admin ? '<button type="button" class="btn primary" id="raImp">＋ إدخال مواد نظام</button>' : ''}</div>
        <div class="card" style="display:grid;gap:8px"><div id="raInfo" style="font-size:13px;opacity:.8"></div><div style="display:flex;gap:8px;flex-wrap:wrap"><input id="raQ" type="search" placeholder="اكتب سؤالك، مثل: ما نصاب اجتماع مجلس الإدارة؟" style="flex:1;min-width:220px"><button type="button" class="btn primary" id="raGo">بحث</button></div></div>
        <select id="raRegSel" hidden></select><div id="raOut" style="display:grid;gap:10px;margin-top:10px"></div>`;
      main.append(sec);
    }
    return true;
  }

  async function start() {
    db = await waitDb(); if (!db) return;
    me = await session(db); if (!me) return;
    const probe = await db.from('regulation_articles').select('id').limit(1);
    if (probe.error) { document.querySelectorAll('[data-view="reg-assist"]').forEach(b => { b.hidden = true; }); return; }
    if (!build()) return;
    document.getElementById('raGo').addEventListener('click', ask);
    document.getElementById('raQ').addEventListener('keydown', e => { if (e.key === 'Enter') ask(); });
    document.getElementById('raImp')?.addEventListener('click', importDlg);
    onOpen({'reg-assist': load});
    await load();
  }
  window.ehsanRegAssist = {parse, search: (q, a) => { arts = a || arts; return search(q); }};
  start().catch(err => console.error('reg-assist', err));
})();
