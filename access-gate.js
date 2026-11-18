// شاشة الانتظار للحسابات غير المعتمدة (الترحيل 035). الحماية الفعلية في قاعدة البيانات (سياسة approved_only)؛ هذه الشاشة تشرح الحالة للمستخدم فقط.
// إن لم يكن الترحيل مطبّقًا (لا عمود approval_status) أو كان الحساب معتمدًا فلا يظهر شيء.
(() => {
  'use strict';
  const ui = window.ehsanUI;
  if (!ui) return;
  const {esc, waitDb} = ui;

  async function check(db, uid) {
    const r = await db.from('profiles').select('approval_status,approval_note').eq('id', uid).maybeSingle();
    return r.error || !r.data ? null : r.data;
  }

  async function start() {
    const db = await waitDb(); if (!db) return;
    const {data: {session}} = await db.auth.getSession(); if (!session) return;
    let p = await check(db, session.user.id);
    if (!p || p.approval_status === 'معتمد') return;
    const gate = document.createElement('div'); gate.id = 'accessGate';
    gate.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:20px;background:var(--bg,#fbf7f4);color:var(--ink,#3a332f);font-family:inherit;direction:rtl';
    const paint = () => {
      const rejected = p.approval_status === 'مرفوض', suspended = p.approval_status === 'موقوف';
      const icon = suspended ? '⏸' : rejected ? '⛔' : '⏳';
      const title = suspended ? 'حسابك موقوف' : rejected ? 'لم يُعتمد طلبك' : 'طلبك قيد المراجعة';
      const text = suspended ? 'أوقف مدير المنصة حسابك مؤقتًا، ولا تظهر لك بيانات المنصة حتى يُعاد تفعيله. تواصل مع مدير المنصة.' : rejected ? 'لم يوافق مدير المنصة على طلب الانضمام.' : 'تم استلام طلبك وتأكيد بريدك. سيراجعه مدير المنصة ويحدد صلاحياتك، وتصلك رسالة عند الموافقة.';
      gate.innerHTML = `<div style="max-width:460px;text-align:center;display:grid;gap:14px;background:var(--card,#fff);border:1px solid var(--line,#eadfd8);border-radius:20px;padding:28px 24px;box-shadow:0 20px 60px rgba(0,0,0,.12)">
        <div style="font-size:40px">${icon}</div>
        <h2 style="margin:0">${title}</h2>
        <p style="margin:0;line-height:1.9">${text}${p.approval_note ? `<br><small>${suspended ? 'السبب' : 'ملاحظة المدير'}: ${esc(p.approval_note)}</small>` : ''}</p>
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><button type="button" class="btn primary" id="agRefresh">تحديث الحالة</button><button type="button" class="btn ghost" id="agOut">تسجيل الخروج</button></div></div>`;
      gate.querySelector('#agRefresh').onclick = refresh;
      gate.querySelector('#agOut').onclick = async () => { await db.auth.signOut(); location.reload(); };
    };
    async function refresh() {
      const n = await check(db, session.user.id); if (!n) return;
      if (n.approval_status === 'معتمد') { location.reload(); return; }
      p = n; paint();
    }
    paint(); document.body.append(gate);
    setInterval(refresh, 30000);
  }
  start().catch(err => console.error('access-gate', err));
})();
