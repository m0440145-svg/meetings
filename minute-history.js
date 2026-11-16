// سجل إصدارات المحضر ومسار التعديل بعد الاعتماد (الترحيل 026). يُضيف إلى بطاقات «محاضر الاجتماعات» الموجودة زر «سجل الإصدارات»،
// وللمدير وأمين السر زر «طلب تعديل» للمحضر الموقَّع أو المعتمد (يلزم مدير أو أمين سر آخر للموافقة). لا يغيّر بطاقة المحضر ولا أزرارها.
(() => {
  'use strict';
  const ui = window.ehsanUI;
  if (!ui) return;
  const {esc, toast, session, waitDb} = ui;
  let db, me, pending = new Map(), names = new Map();
  const fDT = s => { const d = new Date(s); return isNaN(d) ? '' : d.toLocaleString('ar-SA-u-ca-gregory-nu-latn', {dateStyle: 'medium', timeStyle: 'short'}); };
  const nm = u => names.get(u) || '—';

  // فرق نصي بالأسطر (أطول تسلسل مشترك): + مضاف، − محذوف
  function diff(a, b) {
    const x = String(a || '').split('\n'), y = String(b || '').split('\n'), n = x.length, m = y.length;
    if (n * m > 250000) return [{t: '=', s: 'النص كبير؛ قارن الإصدارين يدويًا.'}];
    const L = Array.from({length: n + 1}, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const out = []; let i = 0, j = 0;
    while (i < n && j < m) { if (x[i] === y[j]) { out.push({t: '=', s: x[i]}); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) out.push({t: '-', s: x[i++]}); else out.push({t: '+', s: y[j++]}); }
    while (i < n) out.push({t: '-', s: x[i++]}); while (j < m) out.push({t: '+', s: y[j++]});
    return out;
  }
  const diffHtml = d => d.map(r => `<div class="mh-l ${r.t === '+' ? 'add' : r.t === '-' ? 'del' : ''}">${r.t === '+' ? '+ ' : r.t === '-' ? '− ' : '&nbsp;&nbsp;'}${esc(r.s) || '&nbsp;'}</div>`).join('');

  const CSS = `
.mh-btns{display:inline-flex;gap:6px;flex-wrap:wrap}
.mh-dlg{border:0;border-radius:18px;padding:0;width:min(94vw,820px);max-height:92vh;color:var(--ink,#3a332f);background:var(--card,#fff);box-shadow:0 25px 80px rgba(0,0,0,.35)}
.mh-dlg::backdrop{background:rgba(35,28,24,.5)}
.mh-body{padding:16px 20px;display:grid;gap:12px;max-height:88vh;overflow:auto}
.mh-head{display:flex;justify-content:space-between;align-items:center;gap:10px}.mh-head h3{margin:0}
.mh-x{border:1px solid var(--line,#eadfd8);background:transparent;color:inherit;border-radius:9px;width:34px;height:34px;cursor:pointer}
.mh-ver{border:1px solid var(--line,#eadfd8);border-radius:12px;padding:10px 12px;display:grid;gap:6px}
.mh-meta{display:flex;flex-wrap:wrap;gap:8px;font-size:12.5px;color:var(--muted,#6b5f59);align-items:center}
.mh-diff{border:1px solid var(--line,#eadfd8);border-radius:10px;padding:8px;font-size:13.5px;line-height:1.8;max-height:260px;overflow:auto;background:var(--bg,#f9f4ee)}
.mh-l.add{background:#e3f4e8;color:#1f5b35}.mh-l.del{background:#fbe6e6;color:#8a2b2b;text-decoration:line-through}
html[data-theme=dark] .mh-l.add{background:#1c3a27;color:#a8e0bb}html[data-theme=dark] .mh-l.del{background:#431f1f;color:#f0b2b2}
.mh-acts{display:flex;gap:6px;flex-wrap:wrap}
.mh-pend{border:2px solid #f0b46a;border-radius:12px;padding:10px 12px;display:grid;gap:6px;background:#fff7e6;color:#4a3410}
html[data-theme=dark] .mh-pend{background:#3a2a12;color:#f1c47a}
.mh-hash{font-family:monospace;font-size:11.5px;word-break:break-all}`;

  async function loadNames() {
    if (!me.admin || names.size) return;
    const {data} = await db.from('profiles').select('id,full_name'); (data || []).forEach(p => names.set(p.id, p.full_name || '—'));
  }
  async function loadPending() {
    pending = new Map(); if (!me.admin) return;
    const {data} = await db.from('minute_amendments').select('*').eq('status', 'بانتظار الموافقة');
    (data || []).forEach(a => pending.set(a.minute_id, a));
  }

  function openDialog(html) {
    const dlg = document.createElement('dialog'); dlg.className = 'mh-dlg'; dlg.innerHTML = `<div class="mh-body">${html}</div>`;
    dlg.addEventListener('close', () => dlg.remove());
    dlg.addEventListener('click', e => { if (e.target.closest('[data-x]')) dlg.close(); });
    document.body.append(dlg); dlg.showModal(); return dlg;
  }

  async function history(minuteId) {
    await Promise.all([loadNames(), loadPending()]);
    const [v, m] = await Promise.all([
      db.from('minute_versions').select('*').eq('minute_id', minuteId).order('version_no', {ascending: false}),
      db.from('minutes').select('id,content,recommendations,status,meetings(title)').eq('id', minuteId).single()
    ]);
    if (v.error) return toast('تعذر تحميل السجل');
    const vs = v.data || [], a = pending.get(minuteId);
    const items = vs.map((x, i) => {
      const prev = vs[i + 1];
      return `<div class="mh-ver"><div class="mh-meta"><span class="badge ${x.kind === 'تعديل بعد الاعتماد' ? 'warn' : x.kind === 'اعتماد' ? 'good' : ''}">الإصدار ${x.version_no} — ${esc(x.kind)}</span><span>${esc(fDT(x.created_at))}</span>${me.admin ? `<span>بواسطة ${esc(nm(x.changed_by))}</span>` : ''}${x.approved_by && me.admin ? `<span>وافق: ${esc(nm(x.approved_by))}</span>` : ''}</div>
        ${x.reason ? `<div>سبب التعديل: ${esc(x.reason)}</div>` : ''}${x.content_hash ? `<div class="mh-meta">بصمة النص: <span class="mh-hash">${esc(x.content_hash)}</span></div>` : ''}
        ${prev ? `<details><summary>عرض الفرق عن الإصدار السابق</summary><div class="mh-diff">${diffHtml(diff(prev.content, x.content))}</div></details>` : `<details><summary>عرض النص</summary><div class="mh-diff">${esc(x.content || '').replace(/\n/g, '<br>')}</div></details>`}</div>`;
    }).join('') || '<p>لا إصدارات مسجّلة بعد لهذا المحضر (المحاضر القديمة تبدأ سجلها عند أول تعديل أو اعتماد).</p>';
    const pend = a ? `<div class="mh-pend"><strong>طلب تعديل بانتظار الموافقة</strong><div class="mh-meta">قدّمه ${esc(nm(a.requested_by))} — ${esc(fDT(a.requested_at))}</div><div>السبب: ${esc(a.reason)}</div>
      <details open><summary>الفرق المقترح</summary><div class="mh-diff">${diffHtml(diff(m.data?.content, a.proposed_content))}</div></details>
      <div class="mh-acts">${a.requested_by === me.uid ? '<span class="mh-meta">لا يمكنك الموافقة على طلبك؛ يلزم مدير أو أمين سر آخر.</span>' : `<button type="button" class="btn primary small" data-ap="1" data-id="${esc(a.id)}">موافقة وتطبيق</button><button type="button" class="btn secondary small" data-ap="0" data-id="${esc(a.id)}">رفض</button>`}</div></div>` : '';
    const dlg = openDialog(`<div class="mh-head"><h3>سجل إصدارات: ${esc(m.data?.meetings?.title || 'المحضر')}</h3><button type="button" class="mh-x" data-x aria-label="إغلاق">✕</button></div>${pend}${items}`);
    dlg.addEventListener('click', async e => {
      const b = e.target.closest('[data-ap]'); if (!b) return;
      const approve = b.dataset.ap === '1'; let note = null;
      if (!approve) { note = window.prompt('سبب الرفض'); if (!note) return; }
      else if (!window.confirm('تطبيق التعديل على المحضر المعتمد؟ يُحفظ الإصدار السابق في السجل.')) return;
      const {error} = await db.rpc('minute_amend_decide', {p_id: b.dataset.id, p_approve: approve, p_note: note});
      if (error) return toast(error.message || 'تعذر تنفيذ القرار');
      toast(approve ? 'طُبّق التعديل وسُجّل إصدار جديد' : 'رُفض الطلب'); dlg.close(); await refresh(); history(minuteId);
    });
  }

  async function request(minuteId) {
    if (!window.DM?.form) return toast('النموذج غير جاهز بعد، أعد المحاولة');
    const {data: m} = await db.from('minutes').select('id,content,recommendations,status,meetings(title)').eq('id', minuteId).single();
    if (!m) return toast('المحضر غير متاح');
    await window.DM.form({
      title: 'طلب تعديل محضر: ' + (m.meetings?.title || ''), submit: 'إرسال الطلب للموافقة', wide: true,
      intro: 'المحضر موقَّع أو معتمد، فلا يُعدَّل مباشرة. يُرسَل طلب تعديل، ولا يُطبَّق إلا بموافقة مدير أو أمين سر آخر، ويُحفظ الإصدار السابق وبصمته في السجل. التوقيعات السابقة تبقى مرتبطة بالنص الأصلي.',
      fields: [
        {name: 'content', label: 'نص المحضر بعد التعديل', type: 'textarea', rows: 12, required: true, value: m.content || ''},
        {name: 'recs', label: 'التوصيات بعد التعديل', type: 'textarea', rows: 3, value: m.recommendations || ''},
        {name: 'reason', label: 'سبب التعديل', type: 'textarea', rows: 2, required: true, help: '10 أحرف على الأقل'}
      ],
      onSubmit: async v => {
        const {error} = await db.rpc('minute_amend_request', {p_minute: minuteId, p_content: v.content, p_recommendations: v.recs, p_reason: v.reason});
        if (error) throw new Error(error.message);
        toast('أُرسل طلب التعديل للموافقة'); await refresh();
      }
    });
  }

  // يُضيف الأزرار إلى كل بطاقة محضر (التي تحمل زر .dm-extract) مرة واحدة
  function decorate() {
    document.querySelectorAll('#minutesList .dm-extract[data-id]').forEach(ex => {
      const host = ex.parentElement; if (!host || host.querySelector('.mh-btns')) return;
      const id = ex.dataset.id, card = ex.closest('article');
      const status = card?.querySelector('.tag')?.textContent.trim() || '';
      const sigs = Number((card?.querySelector('.meta')?.textContent.match(/التوقيعات:\s*(\d+)/) || [])[1] || 0);
      const wrap = document.createElement('span'); wrap.className = 'mh-btns';
      wrap.innerHTML = `<button class="btn small ghost" type="button" data-mh-hist="${esc(id)}">سجل الإصدارات${pending.has(id) ? ' ●' : ''}</button>${me.admin && (status === 'معتمد' || sigs > 0) ? `<button class="btn small ghost" type="button" data-mh-req="${esc(id)}">طلب تعديل</button>` : ''}`;
      host.append(wrap);
    });
  }
  async function refresh() { await loadPending(); document.querySelectorAll('#minutesList .mh-btns').forEach(e => e.remove()); decorate(); }

  async function start() {
    db = await waitDb(); if (!db) return;
    me = await session(db); if (!me) return;
    const probe = await db.from('minute_versions').select('id').limit(1);
    if (probe.error) return; // الترحيل 026 غير مطبّق: لا يتغير شيء
    const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
    await loadPending();
    document.addEventListener('click', e => {
      const h = e.target.closest('[data-mh-hist]'), r = e.target.closest('[data-mh-req]');
      if (h) history(h.dataset.mhHist); else if (r) request(r.dataset.mhReq);
    });
    const list = document.getElementById('minutesList');
    if (list) { let t = null; new MutationObserver(() => { clearTimeout(t); t = setTimeout(decorate, 150); }).observe(list, {childList: true, subtree: true}); }
    decorate();
  }
  start().catch(err => console.error('minute-history', err));
})();
