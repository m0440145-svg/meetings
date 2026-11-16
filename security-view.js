// الحوكمة والأمن (الترحيل 020): حالة ضوابط فعلية وسجل نشاط حقيقي من الخادم بدل البيانات المحلية التجريبية. للمدير وأمين السر.
// يستبدل واجهة «الضوابط وسجل النشاط» المحلية فقط إن كان الترحيل مطبّقًا والمستخدم مديرًا؛ وإلا تبقى كما هي.
(() => {
  'use strict';
  const ui = window.ehsanUI;
  if (!ui) return;
  const {esc, toast, onOpen, session, waitDb} = ui;
  let db, rows = [];
  const fDT = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});
  const fmt = s => { const d = new Date(s); return isNaN(d) ? '' : fDT.format(d); };

  const CSS = `
.sc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;margin-bottom:16px}
.sc-ctl{display:grid;gap:4px}
.sc-ctl strong{font-size:15px}
.sc-ctl small{color:var(--muted,#6b5f59)}
.sc-bar{display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:10px}
.sc-bar label{margin:0}
.sc-tbl{width:100%;border-collapse:collapse;font-size:13.5px}
.sc-tbl th,.sc-tbl td{border-bottom:1px solid var(--line,#eadfd8);padding:7px 8px;text-align:start;vertical-align:top}
.sc-tbl th{font-size:12.5px;color:var(--muted,#6b5f59)}
.sc-wrap{overflow:auto}
.sc-ext li{margin:4px 0}`;

  function paintStatus(s) {
    const all = Number(s.tables) || 0, rls = Number(s.rls_tables) || 0, gap = s.no_rls || [];
    const ctl = (title, pill, cls, note) => `<div class="card sc-ctl"><strong>${esc(title)}</strong><span class="status-pill ${cls}">${esc(pill)}</span><small>${esc(note)}</small></div>`;
    document.getElementById('scStatus').innerHTML =
      ctl('حماية الصفوف (RLS) على الجداول', `${rls} من ${all}`, gap.length ? 'warn' : 'good', gap.length ? 'جداول بلا حماية: ' + gap.join('، ') : 'كل جداول قاعدة البيانات محمية بسياسات وصول') +
      ctl('الحسابات المميّزة (مدير / أمين سر)', String(s.privileged), s.privileged > 5 ? 'warn' : 'good', 'يُستحسن إبقاؤها في أضيق نطاق') +
      ctl('الحسابات', `${s.active_users} نشط`, 'good', `${s.inactive_users} حساب معطّل`) +
      ctl('نشاط المساعد الذكي آخر 24 ساعة', String(s.ai_events_24h), 'good', 'عمليات التحليل والاعتماد والأسئلة المسجّلة');
  }

  function paintRows() {
    const area = document.getElementById('scArea').value;
    const list = rows.filter(r => !area || r.area === area);
    document.getElementById('scRows').innerHTML = list.map(r => `<tr><td>${esc(fmt(r.happened_at))}</td><td>${esc(r.actor)}</td><td>${esc(r.area)}</td><td>${esc(r.action)}</td><td>${esc(r.detail)}</td></tr>`).join('') || '<tr><td colspan="5">لا نشاط مطابق.</td></tr>';
  }

  async function load() {
    const [st, act] = await Promise.all([db.rpc('platform_security_status'), db.rpc('platform_activity', {p_limit: 200})]);
    if (st.error || act.error) { toast('تعذر تحميل بيانات الحوكمة والأمن'); return; }
    paintStatus(st.data || {});
    rows = act.data || [];
    const areas = [...new Set(rows.map(r => r.area))];
    const sel = document.getElementById('scArea'), keep = sel.value;
    sel.innerHTML = '<option value="">كل المجالات</option>' + areas.map(a => `<option>${esc(a)}</option>`).join('');
    if (areas.includes(keep)) sel.value = keep;
    paintRows();
  }

  function build() {
    const sec = document.getElementById('view-security'); if (!sec) return false;
    const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
    sec.innerHTML = `<div class="section-head"><div><span class="eyebrow">الحوكمة والأمن</span><h2>الضوابط وسجل النشاط</h2></div><button type="button" class="btn ghost" id="scReload">تحديث</button></div>
      <div class="sc-grid" id="scStatus"></div>
      <div class="card"><h3>ضوابط تُراجَع من لوحة Supabase</h3><ul class="sc-ext"><li>التسجيل الذاتي للمستخدمين الجدد (Authentication ← Sign In / Providers): يُفضَّل تعطيله لمنصة أعضاء معتمدين.</li><li>التحقق الثنائي ومدة الجلسة وسياسة كلمات المرور.</li><li>روابط الموقع المسموحة (Site URL / Redirect URLs).</li></ul><small>هذه الإعدادات لا تُقرأ من داخل المنصة، لذلك لا تُعرض لها حالة هنا.</small></div>
      <div class="card" style="margin-top:14px"><h3>سجل النشاط</h3><div class="sc-bar"><label>المجال<select id="scArea"></select></label></div><div class="sc-wrap"><table class="sc-tbl"><thead><tr><th>الوقت</th><th>المنفّذ</th><th>المجال</th><th>الإجراء</th><th>التفاصيل</th></tr></thead><tbody id="scRows"></tbody></table></div><small>آخر 200 إجراء مسجّل: القرارات والمساعد الذكي والاجتماعات. لا يشمل تسجيلات الدخول ولا تعديل الأعضاء.</small></div>`;
    return true;
  }

  async function start() {
    db = await waitDb(); if (!db) return;
    const me = await session(db); if (!me || !me.admin) return;
    const probe = await db.rpc('platform_security_status');
    if (probe.error) return; // الترحيل 020 غير مطبّق: تبقى الواجهة القديمة كما هي
    if (!build()) return;
    document.getElementById('scArea').addEventListener('change', paintRows);
    document.getElementById('scReload').addEventListener('click', load);
    onOpen({security: load});
    document.documentElement.dataset.serverViews = ((document.documentElement.dataset.serverViews || '') + ' security').trim();
    await load();
  }
  start().catch(err => console.error('security-view', err));
})();
