// صحة الإشعارات (الترحيل 030): للمدير وأمين السر. تعرض حالة طابور الإرسال والمجدول الدوري والتذكيرات وتفضيلات الأعضاء وحالة دوال الإرسال المنشورة، مع إعادة جدولة الفاشل.
// فحص الدوال يعرف فقط هل الدالة منشورة (طلب GET بلا صلاحية: 404 غير منشورة، وغير ذلك منشورة). لا يستطيع المتصفح معرفة إن كانت مفاتيح المزوّد مضبوطة، ولا يقرأ أي أسرار؛ الجاهزية تُتحقق بإرسال رسالة تجريبية.
(() => {
  'use strict';
  const ui = window.ehsanUI;
  if (!ui) return;
  const {esc, toast, onOpen, session, waitDb} = ui;
  let db, h = null, probes = [];
  const FUNCS = [
    {name: 'process-delivery-jobs', label: 'معالج الإرسال الموحّد (بريد، واتساب، رسائل نصية)', note: 'الدالة الموصى بها في المستودع'},
    {name: 'send-email-job', label: 'إرسال البريد (دالة أقدم)', note: 'منشورة سابقًا'},
    {name: 'send-whatsapp-job', label: 'إرسال واتساب (دالة أقدم)', note: 'منشورة سابقًا'}
  ];
  const fDT = s => { const d = new Date(s); return isNaN(d) ? '' : d.toLocaleString('ar-SA-u-ca-gregory-nu-latn', {dateStyle: 'medium', timeStyle: 'short'}); };
  const CH = {email: 'بريد', whatsapp: 'واتساب', sms: 'رسائل نصية'};
  const ST = {pending: 'بانتظار الإرسال', sent: 'أُرسلت', failed: 'فشلت'};

  const CSS = `
.dh-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:14px}
.dh-card b{font-size:24px;display:block;line-height:1.2}.dh-card span{font-size:13px;color:var(--muted,#6b5f59)}
.dh-tbl{width:100%;border-collapse:collapse;font-size:13.5px}
.dh-tbl th,.dh-tbl td{border-bottom:1px solid var(--line,#eadfd8);padding:7px 8px;text-align:start;vertical-align:top}
.dh-tbl th{font-size:12.5px;color:var(--muted,#6b5f59)}
.dh-wrap{overflow:auto;margin-bottom:14px}
.dh-ok{color:#1f7a45;font-weight:700}.dh-bad{color:#b64242;font-weight:700}.dh-warn{color:#9a5a11;font-weight:700}
.dh-note{font-size:12.5px;color:var(--muted,#6b5f59);margin:6px 0 0}
.dh-todo{border:2px solid #f0b46a;background:#fff7e6;color:#4a3410;border-radius:12px;padding:10px 14px;margin-bottom:14px;line-height:1.8}
html[data-theme=dark] .dh-todo{background:#3a2a12;color:#f1c47a}`;

  async function probe() {
    const base = db.supabaseUrl || '';
    probes = await Promise.all(FUNCS.map(async f => {
      try { const r = await fetch(`${base}/functions/v1/${f.name}`, {method: 'GET'}); return {...f, code: r.status}; }
      catch { return {...f, code: 0}; }
    }));
  }
  const probeState = c => c === 404 ? ['dh-bad', 'غير منشورة'] : c === 0 ? ['dh-warn', 'تعذر الفحص'] : ['dh-ok', 'منشورة (جاهزية المفاتيح تُتحقق بإرسال تجريبي)'];

  function paint() {
    const q = h.queue || [], count = (ch, st) => q.filter(x => x.channel === ch && x.status === st).reduce((s, x) => s + x.n, 0);
    const channels = [...new Set(q.map(x => x.channel))];
    const noProc = probes.find(p => p.name === 'process-delivery-jobs')?.code === 404;
    const todo = [];
    if (noProc) todo.push('معالج الإرسال الموحّد (process-delivery-jobs) غير منشور: لن تخرج رسائل بريد أو واتساب أو نصية حتى يُنشر وتُضبط مفاتيح المزوّد وتُفعَّل جدولته. الخطوات في <code>supabase/functions/process-delivery-jobs/README.md</code>.');
    if (h.due_pending > 0) todo.push(`${h.due_pending} رسالة حان موعدها وما زالت بانتظار الإرسال${h.oldest_due_minutes ? ` (أقدمها منذ ${h.oldest_due_minutes} دقيقة)` : ''}.`);
    if (h.failed_total > 0) todo.push(`${h.failed_total} رسالة فاشلة؛ راجع الأسباب أدناه ثم أعد جدولتها بعد المعالجة.`);
    if (h.members_no_phone > 0) todo.push(`${h.members_no_phone} من ${h.members_active} عضوًا نشطًا بلا رقم جوال، فلن تصلهم رسائل الواتساب أو النصية.`);
    document.getElementById('dhBody').innerHTML = `
      ${todo.length ? `<div class="dh-todo" role="note"><strong>يحتاج انتباهك</strong><ul style="margin:6px 0 0;padding-inline-start:20px">${todo.map(t => `<li>${t}</li>`).join('')}</ul></div>` : '<div class="card" style="margin-bottom:14px"><span class="dh-ok">لا ملاحظات حرجة على الإرسال.</span></div>'}
      <div class="dh-grid">
        <div class="card dh-card"><b>${h.due_pending}</b><span>رسائل حان موعدها وبانتظار الإرسال</span></div>
        <div class="card dh-card"><b>${h.sent_24h}</b><span>أُرسلت آخر 24 ساعة</span></div>
        <div class="card dh-card"><b class="${h.failed_total ? 'dh-bad' : ''}">${h.failed_total}</b><span>فاشلة</span></div>
        <div class="card dh-card"><b>${h.reminders_24h}</b><span>تذكيرات وُلِّدت آخر 24 ساعة</span></div>
      </div>
      <div class="card dh-wrap"><h3 style="margin-top:0">دوال الإرسال المنشورة</h3><table class="dh-tbl"><thead><tr><th>الدالة</th><th>الحالة</th><th>ملاحظة</th></tr></thead><tbody>
        ${probes.map(p => { const [c, t] = probeState(p.code); return `<tr><td>${esc(p.label)}<br><small>${esc(p.name)}</small></td><td class="${c}">${esc(t)}</td><td>${esc(p.note)}</td></tr>`; }).join('')}</tbody></table>
        <p class="dh-note">يعرف الفحص هل الدالة منشورة فقط، ولا يقرأ أي أسرار ولا يعرف إن كانت مفاتيح المزوّد مضبوطة؛ التأكد النهائي بإرسال رسالة تجريبية لنفسك.</p></div>
      <div class="card dh-wrap"><h3 style="margin-top:0">طابور الإرسال حسب القناة</h3><table class="dh-tbl"><thead><tr><th>القناة</th><th>بانتظار</th><th>أُرسلت</th><th>فشلت</th></tr></thead><tbody>
        ${channels.map(ch => `<tr><td>${esc(CH[ch] || ch)}</td><td>${count(ch, 'pending')}</td><td>${count(ch, 'sent')}</td><td class="${count(ch, 'failed') ? 'dh-bad' : ''}">${count(ch, 'failed')}</td></tr>`).join('') || '<tr><td colspan="4">الطابور فارغ: لم تُنشأ أي رسالة إرسال بعد.</td></tr>'}</tbody></table></div>
      <div class="card dh-wrap"><h3 style="margin-top:0">المجدول الدوري (pg_cron)</h3><table class="dh-tbl"><thead><tr><th>المهمة</th><th>الجدول</th><th>آخر تشغيل</th><th>النتيجة</th></tr></thead><tbody>
        ${(h.cron || []).map(c => `<tr><td>${esc(c.job)}</td><td><code>${esc(c.schedule)}</code></td><td>${c.last_run ? esc(fDT(c.last_run)) + ` <small>(قبل ${c.minutes_ago} دقيقة)</small>` : '—'}</td><td class="${c.last_status === 'succeeded' ? 'dh-ok' : 'dh-bad'}">${esc(c.last_status || '—')}${c.active === false ? ' (متوقفة)' : ''}</td></tr>`).join('') || '<tr><td colspan="4">لا مهام مجدولة ظاهرة.</td></tr>'}</tbody></table></div>
      <div class="card dh-wrap"><h3 style="margin-top:0">تفضيلات الأعضاء</h3><p style="margin:0">مفعّلو البريد: <b>${h.prefs.email}</b> — واتساب: <b>${h.prefs.whatsapp}</b> — رسائل نصية: <b>${h.prefs.sms}</b> — من ${h.members_active} عضوًا نشطًا.</p></div>
      <div class="card dh-wrap"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><h3 style="margin:0">آخر الرسائل الفاشلة</h3>${h.failed_total ? '<button type="button" class="btn secondary small" id="dhRequeue">إعادة جدولة الفاشل</button>' : ''}</div>
        <table class="dh-tbl" style="margin-top:8px"><thead><tr><th>الوقت</th><th>القناة</th><th>إلى (مقنَّع)</th><th>القالب</th><th>المحاولات</th><th>السبب</th></tr></thead><tbody>
        ${(h.failed_recent || []).map(f => `<tr><td>${esc(fDT(f.at))}</td><td>${esc(CH[f.channel] || f.channel)}</td><td>${esc(f.to)}</td><td>${esc(f.template)}</td><td>${f.attempts ?? 0}</td><td>${esc(f.error || '—')}</td></tr>`).join('') || '<tr><td colspan="6">لا رسائل فاشلة.</td></tr>'}</tbody></table></div>`;
    document.getElementById('dhRequeue')?.addEventListener('click', requeue);
  }

  async function requeue() {
    if (!window.confirm('إعادة الرسائل الفاشلة إلى الانتظار؟ لا تُمَس المرسَلة. تأكد أولًا أن سبب الفشل عولج حتى لا تفشل ثانية.')) return;
    const {data, error} = await db.rpc('delivery_requeue', {p_channel: null});
    if (error) return toast(error.message || 'تعذر التنفيذ');
    toast(`أُعيدت ${data} رسالة إلى الانتظار`); await load();
  }

  async function load() {
    const {data, error} = await db.rpc('delivery_health');
    if (error) return toast(error.message || 'تعذر تحميل صحة الإشعارات');
    h = data; await probe(); paint();
  }

  function build() {
    const main = document.querySelector('.main-area'); if (!main) return false;
    if (!document.getElementById('view-delivery-health')) {
      const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
      const sec = document.createElement('section'); sec.className = 'view'; sec.id = 'view-delivery-health';
      sec.innerHTML = `<div class="section-head"><div><span class="eyebrow">الإشعارات</span><h2>صحة الإرسال</h2></div><button type="button" class="btn ghost" id="dhReload">تحديث</button></div><div id="dhBody"><div class="card">جاري التحميل…</div></div>`;
      main.append(sec);
    }
    return true;
  }

  async function start() {
    db = await waitDb(); if (!db) return;
    const me = await session(db);
    const hide = () => document.querySelectorAll('[data-view="delivery-health"]').forEach(b => { b.hidden = true; });
    if (!me || !me.admin) return hide();
    const probeRes = await db.rpc('delivery_health');
    if (probeRes.error) return hide(); // الترحيل 030 غير مطبّق: لا يتغير شيء
    if (!build()) return;
    document.getElementById('dhReload').addEventListener('click', load);
    onOpen({'delivery-health': load});
    h = probeRes.data; await probe(); paint();
  }
  start().catch(err => console.error('delivery-health', err));
})();
