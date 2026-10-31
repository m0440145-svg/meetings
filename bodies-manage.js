// إدارة الجهات (مجلس إدارة / لجنة / جمعية عمومية): تعديل الاسم والنوع وتاريخ البداية، ونماذج Excel، واستيراد الأعضاء من Excel أو CSV.
// الصلاحية يفرضها الخادم (is_admin) عبر دوال الترحيل 012؛ بدونه تبقى شاشة اللجان كما كانت.
(() => {
  'use strict';
  const ui = window.ehsanUI, DM = window.DM, X = window.XlsxLite;
  if (!ui || !DM || !X) return;
  const {esc, toast} = ui;
  const TYPES = ['مجلس إدارة', 'لجنة', 'جمعية عمومية'];
  const ROLES = {'مجلس إدارة': 'رئيس المجلس، نائب الرئيس، أمين السر، عضو', 'لجنة': 'رئيس اللجنة، مقرر، عضو', 'جمعية عمومية': 'رئيس الجمعية، عضو جمعية عمومية'};
  const MAX_ROWS = 500;
  let feat = null, lastProbe = 0; // feat: هل الترحيل 012 مطبّق؟

  const st = document.createElement('style');
  st.textContent = `.bm-table{width:100%;border-collapse:collapse;font-size:.88rem}.bm-table th,.bm-table td{padding:6px 8px;border-bottom:1px solid var(--line,#e7ddd2);text-align:start;vertical-align:top}
  .bm-wrap{max-height:42vh;overflow:auto;border:1px solid var(--line,#e7ddd2);border-radius:10px;margin-top:8px}.bm-bad{background:rgba(190,40,40,.08)}.bm-ok{color:#2d7a5a}.bm-err{color:#b64242}
  .bm-sum{display:flex;gap:10px;flex-wrap:wrap;margin:8px 0}.bm-sum span{padding:4px 10px;border-radius:999px;background:var(--surface-2,#f4ede6);font-size:.85rem}
  .bm-imp-btn{display:none}html[data-mm-admin="1"] .bm-imp-btn{display:inline-flex}`;
  document.head.append(st);

  const db = () => ui.waitDb();
  const bodies = () => (window.ehsanCommittees?.rows || []);
  const bodyById = id => bodies().find(b => b.id === id);
  const reload = async () => { await window.ehsanCommittees?.reload?.(); await window.ehsanMembers?.reload?.(); };
  const rpc = async (name, args) => { const c = await db(); const {data, error} = await c.rpc(name, args); if (error) throw new Error(error.message); return data; };

  async function probe() {
    if (feat === true) return true;
    if (lastProbe && Date.now() - lastProbe < 5000) return feat; // تخفيف الاستعلامات عند تكرار تغيّرات الصفحة
    lastProbe = Date.now();
    const r = bodies()[0];
    if (r) { feat = 'type' in r; return feat; }
    const c = await db(); const {error} = await c.from('committees').select('type,start_date').limit(1);
    feat = !error; return feat; // لا نخزّن الفشل نهائيًا: قد يكون المستخدم لم يسجّل الدخول بعد
  }

  // ───────── إضافة / تعديل جهة ─────────
  async function bodyForm(b) {
    return DM.form({
      title: b ? 'تعديل الجهة' : 'جهة جديدة', submit: b ? 'حفظ التعديل' : 'إضافة', wide: true,
      fields: [
        {name: 'name', label: 'الاسم', required: true, maxlength: 160, value: b?.name || ''},
        {name: 'type', label: 'نوع الجهة', type: 'select', options: TYPES.map(t => ({value: t, label: t})), value: b?.type || 'لجنة'},
        {name: 'start', label: 'تاريخ البداية', type: 'date', value: b?.start_date || ''},
        {name: 'desc', label: 'الوصف', type: 'textarea', rows: 2, value: b?.description || ''}
      ],
      onSubmit: async v => {
        if (b) await rpc('update_committee', {p_id: b.id, p_name: v.name, p_type: v.type, p_start: v.start || null, p_description: v.desc});
        else await rpc('add_committee', {p_name: v.name, p_type: v.type, p_start: v.start || null, p_description: v.desc});
      }
    });
  }

  // ───────── نموذج Excel لكل جهة ─────────
  function downloadTemplate(b) {
    const role = 'الصفة في ' + b.type;
    const blob = X.build([
      {name: 'الأعضاء', headerRows: 1, widths: [28, 24, 22, 18, 28, 20], rows: [['الاسم الكامل *', 'المسمى الوظيفي', 'الجهة', 'الجوال', 'البريد الإلكتروني', role]]},
      {name: 'تعليمات', headerRows: 1, widths: [28, 70], rows: [
        ['البند', 'القيمة / الشرح'],
        ['الجهة', b.name], ['النوع', b.type], ['معرّف الجهة (لا تغيّره)', b.id],
        ['الاسم الكامل *', 'مطلوب.'],
        ['المسمى الوظيفي', 'اختياري.'],
        ['الجهة', 'اختياري: جهة عمل العضو.'],
        ['الجوال', 'أرقام فقط. يُقبل 9665XXXXXXXX أو 05XXXXXXXX.'],
        ['البريد الإلكتروني', 'اختياري. يُستخدم لمطابقة الأعضاء المسجّلين مسبقًا فلا يتكرر العضو.'],
        [role, 'اختياري. أمثلة: ' + (ROLES[b.type] || 'عضو')],
        ['ملاحظات', `اكتب الأعضاء في ورقة «الأعضاء» بدءًا من الصف الثاني، حتى ${MAX_ROWS} صفًا في كل استيراد. العضو الموجود مسبقًا (بنفس البريد أو الجوال) يُضاف إلى هذه الجهة ولا يتكرر. لا تغيّر عناوين الأعمدة.`]
      ]}
    ]);
    X.download(blob, `نموذج-أعضاء-${b.name.replace(/[\\/:*?"<>|]/g, ' ').trim()}.xlsx`);
  }

  // ───────── قراءة الملف وتحويله لصفوف أعضاء ─────────
  const norm = s => String(s || '').replace(/[ً-ٟـ]/g, '').replace(/[\s*()（）:：_\-.،]/g, '').toLowerCase();
  const col = (H, keys) => H.findIndex(h => keys.some(k => norm(h).includes(k)));
  const normPhone = p => { const d = String(p || '').replace(/[^0-9]/g, ''); if (!d) return ''; if (/^05\d{8}$/.test(d)) return '966' + d.slice(1); if (/^5\d{8}$/.test(d)) return '966' + d; if (/^00/.test(d)) return d.slice(2); return d; };
  const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  function parseMembers(sheets) {
    const metaSheet = sheets.find(s => norm(s.name).includes('تعليمات'));
    let fileBody = null;
    if (metaSheet) for (const r of metaSheet.rows) if (norm(r[0]).includes('معرفالجهة')) fileBody = (r[1] || '').trim();
    const sheet = sheets.find(s => norm(s.name) === norm('الأعضاء')) || sheets.find(s => s !== metaSheet) || sheets[0];
    let hi = sheet.rows.findIndex(r => r.some(c => norm(c).includes('الاسم'))); if (hi < 0) throw new Error('لم أجد عمود «الاسم الكامل» في الملف. استخدم النموذج الصادر من المنصة.');
    const H = sheet.rows[hi], ix = {name: col(H, ['الاسم']), job: col(H, ['المسمى', 'الوظيفة']), org: col(H, ['الجهة']), phone: col(H, ['الجوال', 'الهاتف', 'الموبايل']), email: col(H, ['البريد', 'الايميل', 'email']), role: col(H, ['الصفة', 'الدور', 'المنصب'])};
    const get = (r, i) => (i >= 0 ? String(r[i] ?? '').trim() : '');
    const out = [], seen = new Map();
    sheet.rows.slice(hi + 1).forEach((r, k) => {
      const o = {rowNo: hi + k + 2, name: get(r, ix.name), job: get(r, ix.job), org: get(r, ix.org), phone: get(r, ix.phone), email: get(r, ix.email), role: get(r, ix.role)};
      if (!o.name && !o.job && !o.org && !o.phone && !o.email && !o.role) return;
      const errs = [];
      if (!o.name) errs.push('الاسم مطلوب');
      if (o.email && !EMAIL.test(o.email)) errs.push('بريد غير صحيح');
      const np = normPhone(o.phone); if (o.phone && !/^[0-9]{8,15}$/.test(np)) errs.push('جوال غير صحيح');
      // تكرار داخل الملف نفسه (بريد أو جوال): نعتمد الصف الأول فقط حتى لا تتضارب الصفات
      for (const key of [o.email && 'e:' + o.email.toLowerCase(), np && 'p:' + np].filter(Boolean)) {
        if (seen.has(key)) { errs.push(`مكرر مع الصف ${seen.get(key)}`); break; }
      }
      if (!errs.length) { if (o.email) seen.set('e:' + o.email.toLowerCase(), o.rowNo); if (np) seen.set('p:' + np, o.rowNo); }
      o.phoneN = np; o.errs = errs; out.push(o);
    });
    return {rows: out, fileBody};
  }

  // ───────── نافذة الاستيراد ─────────
  function importDialog(preId) {
    if (!bodies().length) return toast('لا توجد جهات لاستيراد أعضاء إليها');
    const dlg = document.createElement('dialog'); dlg.className = 'dm-dialog wide mm-dialog'; document.body.append(dlg);
    const close = () => { try { dlg.close(); } catch { /* مغلق */ } dlg.remove(); };
    dlg.addEventListener('cancel', e => { e.preventDefault(); close(); });
    dlg.innerHTML = `<div class="dm-form"><div class="dm-dlg-head"><h3>استيراد أعضاء من Excel</h3><button type="button" class="dm-x" data-close aria-label="إغلاق">✕</button></div>
      <p class="dm-intro">اختر الجهة، نزّل النموذج الخاص بها واملأه، ثم ارفعه هنا. العضو الموجود مسبقًا (نفس البريد أو الجوال) يُضاف للجهة ولا يتكرر.</p>
      <label class="dm-field"><span class="dm-lab">الجهة</span><select data-body>${bodies().map(b => `<option value="${esc(b.id)}">${esc(b.name)}${b.type ? ' — ' + esc(b.type) : ''}</option>`).join('')}</select></label>
      <div class="dm-acts mm-top"><button type="button" class="dm-btn ghost sm" data-tpl>تنزيل نموذج Excel لهذه الجهة</button></div>
      <label class="dm-field"><span class="dm-lab">ملف Excel (.xlsx) أو CSV</span><input type="file" data-file accept=".xlsx,.csv,text/csv"></label>
      <div data-preview></div><p class="dm-err" role="alert" data-err></p>
      <div class="dm-acts"><button type="button" class="dm-btn primary" data-go disabled>استيراد</button><button type="button" class="dm-btn ghost" data-close>إغلاق</button></div></div>`;
    const q = s => dlg.querySelector(s), sel = q('[data-body]'), go = q('[data-go]'), err = q('[data-err]'), prev = q('[data-preview]');
    if (preId && bodyById(preId)) sel.value = preId;
    let parsed = null;
    const label = {created: 'جديد', linked: 'مطابق لقائم', exists: 'عضو مسبقًا', error: 'خطأ'};
    const table = (rows, res) => `<div class="bm-wrap"><table class="bm-table"><thead><tr><th>صف</th><th>الاسم</th><th>الوظيفة</th><th>الجوال</th><th>البريد</th><th>الصفة</th><th>الحالة</th></tr></thead><tbody>${rows.map(r => {
      const x = res?.find(y => y.row === rows.indexOf(r) + 1);
      const status = x ? `<span class="${x.status === 'error' ? 'bm-err' : 'bm-ok'}">${label[x.status] || x.status}</span>${x.message ? '<br><small>' + esc(x.message) + '</small>' : ''}` : (r.errs.length ? `<span class="bm-err">${esc(r.errs.join('، '))}</span>` : '<span class="bm-ok">جاهز</span>');
      return `<tr class="${r.errs.length || x?.status === 'error' ? 'bm-bad' : ''}"><td>${r.rowNo}</td><td>${esc(r.name)}</td><td>${esc(r.job)}</td><td>${esc(r.phoneN || r.phone)}</td><td>${esc(r.email)}</td><td>${esc(r.role)}</td><td>${status}</td></tr>`;
    }).join('')}</tbody></table></div>`;

    dlg.addEventListener('click', async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-close')) return close();
      if (b.hasAttribute('data-tpl')) { const body = bodyById(sel.value); if (body) downloadTemplate(body); return; }
      if (b.hasAttribute('data-go')) {
        err.textContent = ''; const body = bodyById(sel.value); const valid = parsed.rows.filter(r => !r.errs.length);
        if (!valid.length) return;
        go.disabled = true; go.textContent = 'جارٍ الاستيراد…';
        try {
          const results = [];
          for (let i = 0; i < valid.length; i += 200) {
            const chunk = valid.slice(i, i + 200);
            const res = await rpc('import_members', {p_committee: body.id, p_rows: chunk.map(r => ({name: r.name, job: r.job, org: r.org, phone: r.phone, email: r.email, role: r.role}))});
            res.forEach(x => results.push({...x, row: i + x.row}));
          }
          const cnt = s => results.filter(x => x.status === s).length;
          prev.innerHTML = `<div class="bm-sum"><span>تمت إضافة ${cnt('created')} عضو جديد</span><span>${cnt('linked')} مطابق لأعضاء قائمين وأُضيفوا للجهة</span><span>${cnt('exists')} موجودون مسبقًا في الجهة</span><span class="${cnt('error') ? 'bm-err' : ''}">${cnt('error')} بأخطاء</span></div>` + table(valid, results);
          go.textContent = 'تم'; toast('اكتمل استيراد الأعضاء'); await reload();
        } catch (ex) { err.textContent = ex.message; go.disabled = false; go.textContent = 'استيراد'; }
      }
    });
    q('[data-file]').addEventListener('change', async e => {
      err.textContent = ''; prev.innerHTML = ''; go.disabled = true; parsed = null; const f = e.target.files[0]; if (!f) return;
      try {
        if (f.size > 5 * 1024 * 1024) throw new Error('حجم الملف أكبر من 5 م.ب');
        const sheets = /\.csv$/i.test(f.name) ? X.readCsv(await f.text()) : await X.read(await f.arrayBuffer());
        parsed = parseMembers(sheets);
        if (!parsed.rows.length) throw new Error('لا توجد صفوف أعضاء في الملف');
        if (parsed.rows.length > MAX_ROWS) throw new Error(`عدد الصفوف ${parsed.rows.length} يتجاوز الحد ${MAX_ROWS} في الاستيراد الواحد`);
        let note = '';
        if (parsed.fileBody && parsed.fileBody !== sel.value) {
          const fb = bodyById(parsed.fileBody);
          if (fb) { sel.value = fb.id; note = `<p class="meta">اختيرت الجهة «${esc(fb.name)}» تلقائيًا لأن الملف صادر من نموذجها.</p>`; }
          else note = '<p class="meta">تنبيه: معرّف الجهة في الملف لا يطابق أي جهة حالية؛ تأكد من اختيار الجهة الصحيحة.</p>';
        }
        const bad = parsed.rows.filter(r => r.errs.length).length, ok = parsed.rows.length - bad;
        prev.innerHTML = note + `<div class="bm-sum"><span>${parsed.rows.length} صف</span><span class="bm-ok">${ok} جاهز</span><span class="${bad ? 'bm-err' : ''}">${bad} به خطأ (سيُتجاهل)</span></div>` + table(parsed.rows);
        go.disabled = ok === 0; go.textContent = ok ? `استيراد ${ok} عضو` : 'استيراد';
      } catch (ex) { err.textContent = ex.message; }
    });
    sel.addEventListener('change', () => { if (parsed) { prev.innerHTML = ''; go.disabled = true; parsed = null; q('[data-file]').value = ''; } });
    dlg.showModal();
  }

  // ───────── ربط الواجهة ─────────
  document.addEventListener('click', async e => {
    const ed = e.target.closest('[data-edit-body]'), im = e.target.closest('[data-import-body]'), tp = e.target.closest('[data-tpl-body]'), imAll = e.target.closest('.bm-imp-btn');
    if (!ed && !im && !tp && !imAll) return;
    if (ed) { const b = bodyById(ed.dataset.editBody); if (b && await bodyForm(b)) { toast('تم حفظ التعديل'); await reload(); } return; }
    if (im) return importDialog(im.dataset.importBody);
    if (tp) { const b = bodyById(tp.dataset.tplBody); if (b) downloadTemplate(b); return; }
    importDialog(null);
  });
  // زر «لجنة جديدة» الحالي: عند توفر الترحيل 012 نفتح نموذجًا يضيف النوع وتاريخ البداية، وإلا يعمل الزر القديم كما هو
  document.addEventListener('click', async e => {
    const b = e.target.closest('#addCommitteeBtn'); if (!b) return;
    if (feat !== true) { probe(); return; } // قرار متزامن: يعمل الزر القديم كما هو حتى يتأكد وجود الترحيل 012
    e.stopImmediatePropagation(); e.preventDefault();
    if (await bodyForm(null)) { toast('تمت إضافة الجهة'); await reload(); }
  }, true);

  function addImportButton() {
    if (feat !== true) { probe().then(() => { if (feat === true) addImportButton(); }); return; }
    const head = document.querySelector('#view-members .section-head'); if (!head || head.querySelector('.bm-imp-btn')) return;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ghost bm-imp-btn'; b.textContent = 'استيراد من Excel'; head.append(b);
  }
  (async () => { await probe(); addImportButton(); new MutationObserver(addImportButton).observe(document.body, {childList: true, subtree: true}); })();
})();
