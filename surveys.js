// الاستبيانات واستطلاعات المواعيد (الترحيل 014). ميزة مضافة: إن لم تكن جداولها موجودة لا يظهر شيء ولا يتغير أي جزء قائم.
// الصلاحيات والتحقق الفعلي في قاعدة البيانات (دوال survey_*)؛ الواجهة لا تصل إلى الإجابات مباشرة.
(() => {
  'use strict';
  const ui = window.ehsanUI;
  if (!ui) return;
  const {esc, toast, onOpen, session, waitDb} = ui;
  const QTYPES = {single: 'اختيار واحد', multi: 'اختيار متعدد', rating: 'تقييم من 1 إلى 5', text: 'نص حر'};
  const STATUS_CLASS = {'مسودة': 'warn', 'مفتوح': 'good', 'مغلق': ''};
  const fDT = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'});
  const fmtSlot = s => { const d = new Date(s); return isNaN(d) ? String(s) : fDT.format(d); };
  const fmtWhen = s => { const d = new Date(s); return isNaN(d) ? '' : fDT.format(d); };
  let db, me, committees = [], mine = new Set(), rows = [];

  const CSS = `
.sv-card{display:grid;gap:8px}
.sv-card h3{margin:0;font-size:17px}
.sv-meta{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:12.5px;color:var(--muted,#6b5f59)}
.sv-acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
.sv-dialog{border:0;border-radius:18px;padding:0;width:min(94vw,720px);max-height:92vh;color:var(--ink,#3a332f);background:var(--card,#fff);box-shadow:0 25px 80px rgba(0,0,0,.28)}
.sv-dialog::backdrop{background:rgba(35,28,24,.5)}
.sv-body{padding:18px 20px;display:grid;gap:12px;max-height:88vh;overflow:auto}
.sv-head{display:flex;justify-content:space-between;align-items:center;gap:10px}
.sv-head h3{margin:0}
.sv-x{border:1px solid var(--line,#eadfd8);background:transparent;color:inherit;border-radius:9px;width:34px;height:34px;cursor:pointer}
.sv-q{border:1px solid var(--line,#eadfd8);border-radius:12px;padding:10px 12px;display:grid;gap:8px}
.sv-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.sv-row>*{flex:1 1 160px}
.sv-row .sv-fix{flex:0 0 auto}
.sv-opts label,.sv-fill label.sv-opt{display:flex;gap:8px;align-items:center;font-weight:400;padding:4px 0}
.sv-opts input,.sv-fill input[type=radio],.sv-fill input[type=checkbox]{width:auto}
.sv-fill fieldset{border:1px solid var(--line,#eadfd8);border-radius:12px;padding:10px 14px;margin:0}
.sv-fill legend{font-weight:700;padding:0 6px}
.sv-req{color:#b64242}
.sv-err{color:#b64242;min-height:1.2em;font-size:13px}
.sv-bar{background:var(--line,#eadfd8);border-radius:999px;height:10px;overflow:hidden;min-width:80px}
.sv-bar i{display:block;height:100%;background:linear-gradient(90deg,#cf6028,#f18927)}
.sv-res{display:grid;grid-template-columns:minmax(120px,1.2fr) 3fr 60px;gap:8px;align-items:center;font-size:14px}
.sv-text-list{margin:0;padding-inline-start:20px;max-height:180px;overflow:auto}
.sv-sum{display:flex;gap:10px;flex-wrap:wrap}
.sv-sum span{background:var(--bg,#f9f4ee);border:1px solid var(--line,#eadfd8);border-radius:999px;padding:3px 12px;font-size:13px}
.sv-win{outline:2px solid #218558;border-radius:8px}
html[data-theme=dark] .sv-dialog{background:#2b2521}
html[data-theme=dark] .sv-sum span{background:#241f1c}
`;
  const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);

  const audienceName = s => s.committee_id ? (committees.find(c => c.id === s.committee_id)?.name || 'جهة محددة') : 'جميع الأعضاء';
  const isExpired = s => s.closes_at && new Date(s.closes_at) <= new Date();

  // ───────── القوائم ─────────
  async function load() {
    const [s, p] = await Promise.all([
      db.from('surveys').select('*').order('created_at', {ascending: false}),
      db.from('survey_participation').select('survey_id,user_id').eq('user_id', me.uid)
    ]);
    if (s.error) { toast('تعذر تحميل الاستبيانات: ' + s.error.message); return; }
    rows = s.data || [];
    mine = new Set((p.data || []).map(x => x.survey_id));
    paint();
  }

  function card(s) {
    const done = mine.has(s.id), open = s.status === 'مفتوح' && !isExpired(s);
    const poll = s.kind === 'موعد';
    const acts = [];
    if (open && !done) acts.push(`<button type="button" class="btn small primary" data-sv="fill" data-id="${esc(s.id)}">${poll ? 'اختيار المواعيد المناسبة' : 'المشاركة'}</button>`);
    if (done) acts.push('<span class="status-pill good">شاركت ✓</span>');
    if (me.admin) {
      if (s.status === 'مسودة') acts.push(`<button type="button" class="btn small ghost" data-sv="edit" data-id="${esc(s.id)}">تعديل</button><button type="button" class="btn small primary" data-sv="open" data-id="${esc(s.id)}">نشر</button>`);
      if (s.status === 'مفتوح') acts.push(`<button type="button" class="btn small ghost" data-sv="close" data-id="${esc(s.id)}">إغلاق</button>`);
      if (s.status === 'مغلق' && !s.chosen_option) acts.push(`<button type="button" class="btn small ghost" data-sv="open" data-id="${esc(s.id)}">إعادة فتح</button>`);
      if (s.status !== 'مسودة') acts.push(`<button type="button" class="btn small ghost" data-sv="results" data-id="${esc(s.id)}">النتائج</button>`);
      acts.push(`<button type="button" class="btn small ghost" data-sv="del" data-id="${esc(s.id)}">حذف</button>`);
    }
    return `<article class="sv-card"><div><span class="status-pill ${STATUS_CLASS[s.status] ?? ''}">${esc(s.status)}</span> ${s.anonymous ? '<span class="status-pill">مجهول</span>' : ''}</div>
      <h3>${esc(s.title)}</h3>${s.description ? `<p class="meta">${esc(s.description)}</p>` : ''}
      <div class="sv-meta"><span>الجمهور: ${esc(audienceName(s))}</span>${s.closes_at ? `<span>ينتهي: ${esc(fmtWhen(s.closes_at))}${isExpired(s) ? ' (انتهى)' : ''}</span>` : ''}</div>
      ${s.chosen_option ? `<div class="status-pill good">الموعد المعتمد: ${esc(fmtSlot(s.chosen_option))}</div>` : ''}
      <div class="sv-acts">${acts.join('')}</div></article>`;
  }

  function paint() {
    for (const [root, kind] of [['#svSurveysRoot', 'استبيان'], ['#svPollsRoot', 'موعد']]) {
      const el = document.querySelector(root); if (!el) continue;
      const list = rows.filter(s => s.kind === kind);
      el.querySelector('[data-sv-list]').innerHTML = list.length ? list.map(card).join('') : `<div class="list-item">${kind === 'موعد' ? 'لا توجد استطلاعات مواعيد بعد.' : 'لا توجد استبيانات بعد.'}${me.admin ? ' ابدأ بزر «＋ جديد».' : ''}</div>`;
    }
  }

  // ───────── نافذة عامة ─────────
  function dialog(html) {
    const d = document.createElement('dialog'); d.className = 'sv-dialog';
    d.innerHTML = `<div class="sv-body">${html}</div>`;
    document.body.append(d);
    const close = () => { try { d.close(); } catch { /* مغلق */ } d.remove(); };
    d.addEventListener('cancel', e => { e.preventDefault(); close(); });
    d.addEventListener('click', e => { if (e.target.closest('[data-x]')) close(); });
    d.showModal();
    return {d, close, err: m => { const x = d.querySelector('[data-err]'); if (x) x.textContent = m || ''; }};
  }
  const head = t => `<div class="sv-head"><h3>${esc(t)}</h3><button type="button" class="sv-x" data-x aria-label="إغلاق">✕</button></div>`;
  const rpc = async (name, args) => { const r = await db.rpc(name, args); if (r.error) throw new Error(r.error.message); return r.data; };

  // ───────── الإنشاء والتعديل ─────────
  const qRow = (q = {}) => `<div class="sv-q" data-q>
    <div class="sv-row"><input type="text" data-qtext maxlength="500" placeholder="نص السؤال" aria-label="نص السؤال" value="${esc(q.text || '')}">
      <select data-qtype aria-label="نوع السؤال">${Object.entries(QTYPES).map(([k, v]) => `<option value="${k}"${q.qtype === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
      <label class="sv-fix sv-opt"><input type="checkbox" data-qreq${q.required === false ? '' : ' checked'}> مطلوب</label>
      <button type="button" class="btn small ghost sv-fix" data-rmq>حذف السؤال</button></div>
    <textarea data-qopts rows="3" placeholder="الخيارات: خيار في كل سطر" aria-label="الخيارات"${['single', 'multi'].includes(q.qtype || 'single') ? '' : ' hidden'}>${esc((q.options || []).join('\n'))}</textarea></div>`;
  const slotRow = (v = '') => `<div class="sv-row" data-slot><input type="datetime-local" data-slotv aria-label="موعد مقترح" value="${esc(v)}"><button type="button" class="btn small ghost sv-fix" data-rmslot>حذف</button></div>`;

  async function editor(existing) {
    const poll = existing ? existing.kind === 'موعد' : editor.kind === 'موعد';
    let qs = [];
    if (existing) {
      const r = await db.from('survey_questions').select('*').eq('survey_id', existing.id).order('position');
      if (r.error) return toast('تعذر تحميل الأسئلة: ' + r.error.message);
      qs = r.data || [];
    }
    const s = existing || {};
    const {d, close, err} = dialog(`${head(existing ? 'تعديل ' + (poll ? 'استطلاع الموعد' : 'الاستبيان') : (poll ? 'استطلاع موعد جديد' : 'استبيان جديد'))}
      <form data-form class="sv-fill" style="display:grid;gap:12px" novalidate>
        <label>العنوان<input type="text" name="title" required maxlength="200" value="${esc(s.title || '')}"></label>
        <label>الوصف (اختياري)<textarea name="desc" rows="2" maxlength="2000">${esc(s.description || '')}</textarea></label>
        <div class="sv-row"><label>الجمهور<select name="committee"><option value="">جميع الأعضاء</option>${committees.map(c => `<option value="${esc(c.id)}"${s.committee_id === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
          <label>ينتهي في (اختياري)<input type="datetime-local" name="closes" value="${s.closes_at ? esc(toLocalInput(s.closes_at)) : ''}"></label></div>
        <label class="sv-opt"><input type="checkbox" name="anon"${s.anonymous ? ' checked' : ''}> مجهول (لا يُربط الجواب باسم العضو)</label>
        ${poll ? `<div><strong>المواعيد المقترحة (2 إلى 15)</strong><div data-slots style="display:grid;gap:6px;margin-top:6px">${(qs[0]?.options?.length ? qs[0].options : ['', '']).map(slotRow).join('')}</div><button type="button" class="btn small ghost" data-addslot style="margin-top:6px">＋ موعد</button></div>`
          : `<div><strong>الأسئلة</strong><div data-qs style="display:grid;gap:8px;margin-top:6px">${(qs.length ? qs : [{}]).map(qRow).join('')}</div><button type="button" class="btn small ghost" data-addq style="margin-top:6px">＋ سؤال</button></div>`}
        <p class="sv-err" role="alert" data-err></p>
        <div class="sv-acts"><button type="submit" class="btn primary">حفظ كمسودة</button><button type="button" class="btn ghost" data-x>إلغاء</button></div>
      </form>`);
    d.addEventListener('click', e => {
      if (e.target.closest('[data-addq]')) d.querySelector('[data-qs]').insertAdjacentHTML('beforeend', qRow({}));
      if (e.target.closest('[data-addslot]')) { if (d.querySelectorAll('[data-slot]').length < 15) d.querySelector('[data-slots]').insertAdjacentHTML('beforeend', slotRow('')); }
      const rq = e.target.closest('[data-rmq]'); if (rq && d.querySelectorAll('[data-q]').length > 1) rq.closest('[data-q]').remove();
      const rs = e.target.closest('[data-rmslot]'); if (rs && d.querySelectorAll('[data-slot]').length > 2) rs.closest('[data-slot]').remove();
    });
    d.addEventListener('change', e => {
      const t = e.target.closest('[data-qtype]'); if (!t) return;
      d.querySelectorAll('[data-qopts]').forEach(() => {});
      const ta = t.closest('[data-q]').querySelector('[data-qopts]'); ta.hidden = !['single', 'multi'].includes(t.value);
    });
    d.querySelector('[data-form]').addEventListener('submit', async e => {
      e.preventDefault(); err('');
      const f = new FormData(e.currentTarget);
      let questions;
      if (poll) {
        const slots = [...d.querySelectorAll('[data-slotv]')].map(i => i.value).filter(Boolean);
        if (slots.length < 2) return err('أضف موعدين على الأقل');
        questions = [{text: 'اختر المواعيد المناسبة لك', qtype: 'multi', options: slots, required: true}];
      } else {
        questions = [...d.querySelectorAll('[data-q]')].map(el => {
          const qtype = el.querySelector('[data-qtype]').value;
          return {text: el.querySelector('[data-qtext]').value.trim(), qtype, required: el.querySelector('[data-qreq]').checked,
            options: ['single', 'multi'].includes(qtype) ? el.querySelector('[data-qopts]').value.split('\n').map(x => x.trim()).filter(Boolean) : []};
        });
        if (questions.some(q => !q.text)) return err('نص السؤال مطلوب لكل سؤال');
      }
      const closes = f.get('closes') ? new Date(f.get('closes')).toISOString() : null;
      const btn = e.currentTarget.querySelector('[type=submit]'); btn.disabled = true;
      try {
        await rpc('survey_save', {p_id: existing ? existing.id : null, p_kind: poll ? 'موعد' : 'استبيان', p_title: String(f.get('title') || '').trim(), p_desc: String(f.get('desc') || '').trim() || null,
          p_committee: f.get('committee') || null, p_anonymous: !!f.get('anon'), p_closes: closes, p_questions: questions});
        close(); toast('تم حفظ المسودة. اضغط «نشر» ليصل إلى الأعضاء'); await load();
      } catch (ex) { err(ex.message); btn.disabled = false; }
    });
  }
  function toLocalInput(iso) { const d = new Date(iso); if (isNaN(d)) return ''; const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }

  // ───────── المشاركة ─────────
  async function fill(s) {
    const r = await db.from('survey_questions').select('*').eq('survey_id', s.id).order('position');
    if (r.error) return toast('تعذر تحميل الأسئلة: ' + r.error.message);
    const qs = r.data || [];
    const poll = s.kind === 'موعد';
    const body = qs.map((q, i) => {
      const lg = `<legend>${esc(q.text)}${q.required ? ' <span class="sv-req" aria-hidden="true">*</span>' : ''}</legend>`;
      let inner;
      if (q.qtype === 'single') inner = q.options.map(o => `<label class="sv-opt"><input type="radio" name="q${i}" value="${esc(o)}"> ${esc(o)}</label>`).join('');
      else if (q.qtype === 'multi') inner = q.options.map(o => `<label class="sv-opt"><input type="checkbox" name="q${i}" value="${esc(o)}"> ${esc(poll ? fmtSlot(o) : o)}</label>`).join('');
      else if (q.qtype === 'rating') inner = `<div class="sv-row" style="justify-content:flex-start">${[1, 2, 3, 4, 5].map(n => `<label class="sv-opt sv-fix"><input type="radio" name="q${i}" value="${n}"> ${n}</label>`).join('')}</div><small class="meta">1 = الأدنى، 5 = الأعلى</small>`;
      else inner = `<textarea name="q${i}" rows="3" maxlength="1000" aria-label="${esc(q.text)}"></textarea>`;
      return `<fieldset>${lg}${inner}</fieldset>`;
    }).join('');
    const {d, close, err} = dialog(`${head(s.title)}${s.description ? `<p class="meta">${esc(s.description)}</p>` : ''}
      <p class="meta">${s.anonymous ? 'هذا الاستبيان مجهول: لا يُربط جوابك باسمك.' : 'جوابك مرتبط باسمك.'} يمكنك المشاركة مرة واحدة فقط.</p>
      <form data-form class="sv-fill" style="display:grid;gap:12px" novalidate>${body}<p class="sv-err" role="alert" data-err></p>
        <div class="sv-acts"><button type="submit" class="btn primary">إرسال</button><button type="button" class="btn ghost" data-x>إلغاء</button></div></form>`);
    d.querySelector('[data-form]').addEventListener('submit', async e => {
      e.preventDefault(); err('');
      const answers = qs.map((q, i) => {
        const els = [...d.querySelectorAll(`[name="q${i}"]`)];
        let v;
        if (q.qtype === 'multi') v = els.filter(x => x.checked).map(x => x.value);
        else if (q.qtype === 'single') v = els.find(x => x.checked)?.value ?? null;
        else if (q.qtype === 'rating') { const c = els.find(x => x.checked); v = c ? Number(c.value) : null; }
        else v = (els[0]?.value || '').trim() || null;
        return {q: q.id, v};
      });
      const missing = qs.find((q, i) => q.required && (answers[i].v == null || (Array.isArray(answers[i].v) && !answers[i].v.length)));
      if (missing) return err('السؤال مطلوب: ' + missing.text);
      const btn = e.currentTarget.querySelector('[type=submit]'); btn.disabled = true;
      try { await rpc('survey_submit', {p_id: s.id, p_answers: answers}); close(); toast('تم تسجيل مشاركتك. شكرًا لك'); await load(); }
      catch (ex) { err(ex.message); btn.disabled = false; }
    });
  }

  // ───────── النتائج والتصدير ─────────
  async function results(s) {
    let res;
    try { res = await rpc('survey_results', {p_id: s.id}); } catch (ex) { return toast(ex.message); }
    const poll = res.survey.kind === 'موعد';
    const label = o => poll ? fmtSlot(o) : o;
    const maxOf = c => Math.max(1, ...Object.values(c || {}).map(Number));
    const qHtml = res.questions.map(q => {
      let inner;
      if (q.qtype === 'text') inner = q.texts.length ? `<ul class="sv-text-list">${q.texts.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : '<p class="meta">لا إجابات</p>';
      else {
        const entries = q.qtype === 'rating' ? [1, 2, 3, 4, 5].map(n => [String(n), q.counts[String(n)] || 0]) : q.options.map(o => [o, q.counts[o] || 0]);
        const mx = maxOf(q.counts), top = Math.max(...entries.map(e => Number(e[1])));
        inner = (q.qtype === 'rating' && q.avg != null ? `<p><strong>المتوسط: ${esc(q.avg)}</strong> من 5</p>` : '') +
          entries.map(([o, n]) => `<div class="sv-res${poll && n === top && n > 0 ? ' sv-win' : ''}"><span>${esc(label(o))}</span><span class="sv-bar" aria-hidden="true"><i style="width:${Math.round(Number(n) / mx * 100)}%"></i></span><span>${esc(n)}</span>${poll && me.admin && !res.survey.chosen && s.status !== 'مسودة' ? `<button type="button" class="btn small ghost" data-choose="${esc(o)}" style="grid-column:1/-1;justify-self:start">اعتماد هذا الموعد</button>` : ''}</div>`).join('');
      }
      return `<section class="sv-q"><strong>${esc(q.text)}</strong><small class="meta">أجاب ${esc(q.answered)} من ${esc(res.total)}</small>${inner}</section>`;
    }).join('');
    const who = res.survey.anonymous ? '<p class="meta">استبيان مجهول: لا تظهر أسماء المشاركين.</p>'
      : `<details><summary>المشاركون (${res.respondents.length})</summary><ul class="sv-text-list">${res.respondents.map(r => `<li>${esc(r.name)} — ${esc(fmtWhen(r.at))}</li>`).join('')}</ul></details>`;
    const {d, close} = dialog(`${head('نتائج: ' + res.survey.title)}
      <div class="sv-sum"><span>المشاركون: ${esc(res.total)}</span><span>الجمهور المستهدف: ${esc(res.audience)}</span><span>نسبة المشاركة: ${res.audience ? Math.min(100, Math.round(res.total / res.audience * 100)) : 0}%</span>${res.survey.chosen ? `<span class="sv-win">الموعد المعتمد: ${esc(fmtSlot(res.survey.chosen))}</span>` : ''}</div>
      ${qHtml}${who}<div class="sv-acts"><button type="button" class="btn ghost" data-export>تصدير Excel</button><button type="button" class="btn ghost" data-x>إغلاق</button></div>`);
    d.addEventListener('click', async e => {
      if (e.target.closest('[data-export]')) return exportResults(res);
      const ch = e.target.closest('[data-choose]'); if (!ch) return;
      const ok = await window.DM?.confirm?.({title: 'اعتماد الموعد', confirmLabel: 'اعتماد', message: `سيُعتمد «${fmtSlot(ch.dataset.choose)}» ويُغلق الاستطلاع ويُخطَر الأعضاء.`});
      if (ok && ok.ok === false) return;
      try { await rpc('survey_choose', {p_id: s.id, p_option: ch.dataset.choose}); close(); toast('تم اعتماد الموعد'); await load(); } catch (ex) { toast(ex.message); }
    });
  }

  function exportResults(res) {
    const poll = res.survey.kind === 'موعد';
    const rowsX = [[res.survey.title], ['المشاركون', res.total, 'الجمهور', res.audience], []];
    res.questions.forEach(q => {
      rowsX.push([q.text, QTYPES[q.qtype]]);
      if (q.qtype === 'text') q.texts.forEach(t => rowsX.push(['', t]));
      else (q.qtype === 'rating' ? ['1', '2', '3', '4', '5'] : q.options).forEach(o => rowsX.push(['', poll ? fmtSlot(o) : o, q.counts[o] ?? 0]));
      if (q.avg != null) rowsX.push(['', 'المتوسط', q.avg]);
      rowsX.push([]);
    });
    if (!res.survey.anonymous && res.respondents.length) { rowsX.push(['المشاركون']); res.respondents.forEach(r => rowsX.push(['', r.name, fmtWhen(r.at)])); }
    const name = 'نتائج-' + String(res.survey.title).replace(/[\\/:*?"<>|]/g, '').slice(0, 40);
    const X = window.XlsxLite;
    if (X) { X.download(X.build([{name: 'النتائج', rows: rowsX, widths: [40, 40, 14]}]), name + '.xlsx'); return; }
    const csv = '﻿' + rowsX.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], {type: 'text/csv;charset=utf-8'})); a.download = name + '.csv'; document.body.append(a); a.click(); a.remove();
  }

  // ───────── الإجراءات ─────────
  async function action(e) {
    const b = e.target.closest('[data-sv]'); if (!b) return;
    const s = rows.find(x => x.id === b.dataset.id); if (!s) return;
    const act = b.dataset.sv;
    b.disabled = true;
    try {
      if (act === 'fill') await fill(s);
      else if (act === 'edit') await editor(s);
      else if (act === 'results') await results(s);
      else if (act === 'open') { await rpc('survey_set_status', {p_id: s.id, p_status: 'مفتوح'}); toast(s.status === 'مسودة' ? 'تم النشر وإخطار الأعضاء' : 'أُعيد فتحه'); await load(); }
      else if (act === 'close') { await rpc('survey_set_status', {p_id: s.id, p_status: 'مغلق'}); toast('تم الإغلاق'); await load(); }
      else if (act === 'del') {
        const ok = await window.DM?.confirm?.({title: 'حذف نهائي', danger: true, confirmLabel: 'حذف', message: `سيُحذف «${s.title}» بكل إجاباته. لا يمكن التراجع.`});
        if (ok && ok.ok === false) return;
        if (!window.DM?.confirm && !confirm('حذف نهائي؟')) return;
        await rpc('survey_delete', {p_id: s.id}); toast('تم الحذف'); await load();
      }
    } catch (ex) { toast(ex.message); } finally { b.disabled = false; }
  }

  // ───────── التهيئة ─────────
  function mount() {
    const main = document.querySelector('.main-area');
    if (!main) return false;
    if (!document.getElementById('view-surveys')) {
      const sec = document.createElement('section'); sec.className = 'view'; sec.id = 'view-surveys';
      sec.innerHTML = `<div class="section-head"><div><span class="eyebrow">جمع الآراء</span><h2>الاستبيانات</h2></div><button type="button" class="btn primary" data-sv-new="استبيان" hidden>＋ استبيان جديد</button></div><div id="svSurveysRoot"><div class="cards-grid" data-sv-list></div></div>`;
      main.append(sec);
    }
    const sched = document.getElementById('view-schedule');
    if (sched && !document.getElementById('svPollsRoot')) {
      const old = sched.querySelector('#schedulePolls'); if (old) old.hidden = true;
      const oldBtn = sched.querySelector('#newSchedulePoll'); if (oldBtn) oldBtn.hidden = true;
      const head = sched.querySelector('.section-head');
      if (head) head.insertAdjacentHTML('beforeend', '<button type="button" class="btn primary" data-sv-new="موعد" hidden>＋ استطلاع موعد جديد</button>');
      sched.insertAdjacentHTML('beforeend', '<div id="svPollsRoot"><div class="cards-grid" data-sv-list></div></div>');
    }
    return true;
  }

  async function start() {
    db = await waitDb(); if (!db) return;
    me = await session(db); if (!me) return;
    const probe = await db.from('surveys').select('id').limit(1);
    if (probe.error) { document.querySelectorAll('[data-view="surveys"]').forEach(b => { b.hidden = true; }); return; } // الترحيل 014 غير مطبّق: لا يتغير شيء
    if (!mount()) return;
    const c = await db.from('committees').select('id,name').order('name'); committees = c.data || [];
    document.querySelectorAll('[data-sv-new]').forEach(b => { b.hidden = !me.admin; });
    document.addEventListener('click', e => {
      const n = e.target.closest('[data-sv-new]');
      if (n) { editor.kind = n.dataset.svNew; editor(null); return; }
      if (e.target.closest('#view-surveys, #view-schedule')) action(e);
    });
    onOpen({surveys: load, schedule: load});
    await load();
  }
  start().catch(err => console.error('surveys', err));
})();
