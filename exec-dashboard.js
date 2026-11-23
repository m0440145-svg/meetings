// اللوحة التنفيذية (الترحيل 029): أداء المجلس واللجان والقرارات ومؤشرات الامتثال والنضج، للمدير وأمين السر. قراءة فقط من exec_dashboard.
// تُضاف كشاشة جديدة؛ لا تغيّر شاشة «مؤشرات الأداء» الخاصة بالقرارات. تصدير Excel وطباعة (PDF من المتصفح).
(() => {
  'use strict';
  const ui = window.ehsanUI;
  if (!ui) return;
  const {esc, toast, onOpen, session, waitDb} = ui;
  let db, me, data = null;
  const pct = v => v == null ? '—' : v + '%';
  const n = v => v == null ? '—' : String(v);
  const fD = s => { const d = new Date(s); return isNaN(d) ? '' : d.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn'); };
  const ym = s => { const [y, m] = s.split('-'); return new Date(+y, +m - 1, 1).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', {month: 'short'}); };

  const CSS = `
.ex-bar{display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:14px}
.ex-bar label{margin:0}
.ex-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:16px}
.ex-card{display:grid;gap:2px}.ex-card b{font-size:26px;line-height:1.2}.ex-card span{font-size:13px;color:var(--muted,#6b5f59)}
.ex-grid{display:grid;grid-template-columns:minmax(220px,300px) 1fr;gap:14px;margin-bottom:16px}
@media(max-width:800px){.ex-grid{grid-template-columns:1fr}}
.ex-gauge{display:grid;place-items:center;gap:8px;text-align:center}
.ex-ring{--p:0;width:150px;height:150px;border-radius:50%;background:conic-gradient(#cf6028 calc(var(--p)*1%),var(--line,#eadfd8) 0);display:grid;place-items:center}
.ex-ring i{font-style:normal;width:112px;height:112px;border-radius:50%;background:var(--card,#fff);display:grid;place-items:center;font-size:30px;font-weight:800}
.ex-tbl{width:100%;border-collapse:collapse;font-size:13.5px}
.ex-tbl th,.ex-tbl td{border-bottom:1px solid var(--line,#eadfd8);padding:7px 8px;text-align:start;vertical-align:middle}
.ex-tbl th{font-size:12.5px;color:var(--muted,#6b5f59)}
.ex-wrap{overflow:auto}
.ex-ok{color:#1f7a45;font-weight:700}.ex-bad{color:#b64242;font-weight:700}.ex-na{color:var(--muted,#6b5f59)}
.ex-note{font-size:12.5px;color:var(--muted,#6b5f59);margin:6px 0 0}
.ex-chart{width:100%;height:190px}
.ex-leg{display:flex;gap:14px;flex-wrap:wrap;font-size:12.5px;margin-top:4px}.ex-leg i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-inline-end:5px}
@media print{#sidebar,.topbar,.ex-bar,.sidebar,.app-header,.side-nav{display:none!important}.main-area{margin:0!important}.card{break-inside:avoid;box-shadow:none!important}}`;

  function chart(m) {
    const W = 720, H = 170, pad = 24, bw = (W - pad * 2) / m.length, max = Math.max(1, ...m.map(x => Math.max(x.meetings, x.decisions_created, x.decisions_completed)));
    const y = v => H - 24 - (v / max) * (H - 44);
    const bars = m.map((x, i) => {
      const x0 = pad + i * bw, w = bw / 4;
      return [['meetings', '#cf6028'], ['decisions_created', '#f18927'], ['decisions_completed', '#2f7a57']].map(([k, c], j) => `<rect x="${(x0 + w * (j + .5)).toFixed(1)}" y="${y(x[k]).toFixed(1)}" width="${w.toFixed(1)}" height="${(H - 24 - y(x[k])).toFixed(1)}" fill="${c}" rx="2"><title>${esc(x.month)}: ${x[k]}</title></rect>`).join('')
        + `<text x="${(x0 + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="currentColor">${esc(ym(x.month))}</text>`;
    }).join('');
    return `<svg class="ex-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="اتجاه آخر 12 شهرًا: اجتماعات وقرارات"><line x1="${pad}" y1="${H - 24}" x2="${W - pad}" y2="${H - 24}" stroke="currentColor" opacity=".25"/>${bars}</svg>
      <div class="ex-leg"><span><i style="background:#cf6028"></i>اجتماعات</span><span><i style="background:#f18927"></i>قرارات معتمدة</span><span><i style="background:#2f7a57"></i>قرارات منجزة</span></div>`;
  }

  function paint() {
    const d = data, s = d.summary, mat = d.maturity;
    document.getElementById('exBody').innerHTML = `
      <div class="ex-cards">
        <div class="card ex-card"><b>${n(s.meetings)}</b><span>اجتماعات في الفترة</span></div>
        <div class="card ex-card"><b>${n(s.minutes_approved)}</b><span>محاضر معتمدة${s.avg_days_to_minute_approval != null ? ` — بمتوسط ${s.avg_days_to_minute_approval} يومًا` : ''}</span></div>
        <div class="card ex-card"><b>${pct(s.attendance_rate)}</b><span>نسبة الحضور</span></div>
        <div class="card ex-card"><b>${n(s.decisions)}</b><span>قرارات معتمدة (${n(s.decisions_open)} قيد المتابعة)</span></div>
        <div class="card ex-card"><b>${n(s.decisions_completed)}</b><span>قرارات منجزة${s.avg_exec_days != null ? ` — بمتوسط ${s.avg_exec_days} يومًا` : ''}</span></div>
        <div class="card ex-card"><b class="${s.decisions_overdue ? 'ex-bad' : ''}">${n(s.decisions_overdue)}</b><span>قرارات متأخرة</span></div>
      </div>
      <div class="ex-grid">
        <div class="card ex-gauge"><div class="ex-ring" style="--p:${mat.score ?? 0}"><i>${mat.score == null ? '—' : mat.score + '%'}</i></div><strong>درجة الامتثال والنضج</strong>
          <span class="ex-note">${mat.measurable ? `${mat.met} من ${mat.measurable} مؤشرات محقّقة` : 'لا بيانات كافية للقياس في هذه الفترة'}</span></div>
        <div class="card ex-wrap"><h3 style="margin-top:0">مؤشرات الامتثال والنضج</h3><table class="ex-tbl"><thead><tr><th>المؤشر</th><th>القيمة</th><th>المستهدف</th><th>الحالة</th></tr></thead><tbody>
          ${d.indicators.map(i => `<tr><td>${esc(i.label)}</td><td>${i.value == null ? '<span class="ex-na">لا بيانات</span>' : esc(i.value) + '% <small class="ex-na">(' + i.num + ' من ' + i.den + ')</small>'}</td><td>${i.dir === 'le' ? '≤' : '≥'} ${esc(i.target)}%</td><td>${i.met == null ? '<span class="ex-na">—</span>' : i.met ? '<span class="ex-ok">محقّق</span>' : '<span class="ex-bad">دون المستهدف</span>'}</td></tr>`).join('')}
          </tbody></table><p class="ex-note">${esc(d.targets_note)}. تُراجَع مع الجمعية قبل الاعتماد الرسمي.</p></div>
      </div>
      <div class="card ex-wrap" style="margin-bottom:16px"><h3 style="margin-top:0">حسب المجلس واللجان</h3><table class="ex-tbl"><thead><tr><th>الجهة</th><th>الاجتماعات</th><th>محاضر معتمدة</th><th>الحضور</th><th>القرارات</th><th>المنجزة</th><th>المتأخرة</th></tr></thead><tbody>
        ${d.by_committee.map(c => `<tr><td>${esc(c.name)}</td><td>${c.meetings}</td><td>${c.minutes_approved}</td><td>${pct(c.attendance_rate)}</td><td>${c.decisions}</td><td>${c.completed}</td><td class="${c.overdue ? 'ex-bad' : ''}">${c.overdue}</td></tr>`).join('') || '<tr><td colspan="7" class="ex-na">لا نشاط للجان في هذه الفترة.</td></tr>'}</tbody></table></div>
      <div class="card"><h3 style="margin-top:0">الاتجاه الشهري (آخر 12 شهرًا من نهاية الفترة)</h3>${chart(d.monthly)}</div>`;
    document.getElementById('exSub').textContent = `الفترة: ${fD(d.period.from)} — ${fD(d.period.to)}`;
  }

  async function load() {
    const sel = document.getElementById('exRange').value, today = new Date(), y = today.getFullYear();
    const iso = x => new Date(x.getTime() - x.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
    let from, to = iso(today);
    if (sel === 'year') from = `${y}-01-01`; else if (sel === '6m') from = iso(new Date(y, today.getMonth() - 6, today.getDate())); else if (sel === 'custom') { from = document.getElementById('exFrom').value; to = document.getElementById('exTo').value || to; } else from = iso(new Date(y - 1, today.getMonth(), today.getDate()));
    if (!from) return toast('حدد تاريخ البداية');
    const {data: r, error} = await db.rpc('exec_dashboard', {p_from: from, p_to: to});
    if (error) return toast(error.message || 'تعذر تحميل اللوحة');
    data = r; paint();
  }

  function exportXlsx() {
    if (!data) return;
    const X = window.XlsxLite, d = data, s = d.summary;
    const rows = [['اللوحة التنفيذية'], [`الفترة: ${d.period.from} إلى ${d.period.to}`], [],
      ['الملخص'], ['اجتماعات', s.meetings], ['محاضر معتمدة', s.minutes_approved], ['متوسط أيام اعتماد المحضر', s.avg_days_to_minute_approval ?? ''], ['نسبة الحضور %', s.attendance_rate ?? ''], ['قرارات معتمدة', s.decisions], ['قرارات منجزة', s.decisions_completed], ['قرارات متأخرة', s.decisions_overdue], [],
      ['درجة الامتثال والنضج %', d.maturity.score ?? ''], ['المؤشر', 'القيمة %', 'البسط', 'المقام', 'المستهدف %', 'الاتجاه', 'الحالة'],
      ...d.indicators.map(i => [i.label, i.value ?? '', i.num, i.den, i.target, i.dir === 'le' ? 'أقل أفضل' : 'أعلى أفضل', i.met == null ? 'لا بيانات' : i.met ? 'محقّق' : 'دون المستهدف']), [],
      ['الجهة', 'اجتماعات', 'محاضر معتمدة', 'حضور %', 'قرارات', 'منجزة', 'متأخرة'], ...d.by_committee.map(c => [c.name, c.meetings, c.minutes_approved, c.attendance_rate ?? '', c.decisions, c.completed, c.overdue]), [],
      ['الشهر', 'اجتماعات', 'قرارات معتمدة', 'قرارات منجزة'], ...d.monthly.map(m => [m.month, m.meetings, m.decisions_created, m.decisions_completed]), [], [d.targets_note]];
    if (X) X.download(X.build([{name: 'اللوحة التنفيذية', rows, widths: [46, 14, 14, 14, 14, 14, 14]}]), `اللوحة-التنفيذية-${d.period.to}.xlsx`);
    else { const csv = '﻿' + rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], {type: 'text/csv;charset=utf-8'})); a.download = 'اللوحة-التنفيذية.csv'; document.body.append(a); a.click(); a.remove(); }
  }

  function build() {
    const main = document.querySelector('.main-area'); if (!main) return false;
    if (!document.getElementById('view-exec-dashboard')) {
      const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
      const sec = document.createElement('section'); sec.className = 'view'; sec.id = 'view-exec-dashboard';
      sec.innerHTML = `<div class="section-head"><div><span class="eyebrow">التقارير</span><h2>اللوحة التنفيذية</h2><small id="exSub"></small></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn ghost" id="exXlsx">تصدير Excel</button><button type="button" class="btn ghost" id="exPrint">طباعة / PDF</button></div></div>
        <div class="ex-bar"><label>الفترة<select id="exRange"><option value="12m">آخر 12 شهرًا</option><option value="6m">آخر 6 أشهر</option><option value="year">السنة الحالية</option><option value="custom">فترة مخصصة</option></select></label>
          <label id="exCustom" hidden>من <input type="date" id="exFrom" /></label><label id="exCustom2" hidden>إلى <input type="date" id="exTo" /></label><button type="button" class="btn primary" id="exGo">تحديث</button></div>
        <div id="exBody"><div class="card">جاري التحميل…</div></div>`;
      main.append(sec);
    }
    return true;
  }

  async function start() {
    db = await waitDb(); if (!db) return;
    me = await session(db);
    if (!me || !me.admin) { document.querySelectorAll('[data-view="exec-dashboard"]').forEach(b => { b.hidden = true; }); return; }
    const probe = await db.rpc('exec_dashboard', {});
    if (probe.error) { document.querySelectorAll('[data-view="exec-dashboard"]').forEach(b => { b.hidden = true; }); return; } // الترحيل 029 غير مطبّق: لا يتغير شيء
    if (!build()) return;
    document.getElementById('exRange').addEventListener('change', e => { const c = e.target.value === 'custom'; ['exCustom', 'exCustom2'].forEach(id => { document.getElementById(id).hidden = !c; }); if (!c) load(); });
    document.getElementById('exGo').addEventListener('click', load);
    document.getElementById('exXlsx').addEventListener('click', exportXlsx);
    document.getElementById('exPrint').addEventListener('click', () => window.print());
    onOpen({'exec-dashboard': load});
    data = probe.data; paint();
  }
  start().catch(err => console.error('exec-dashboard', err));
})();
