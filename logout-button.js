// زر «تسجيل الخروج» ظاهر في الشريط العلوي وأسفل القائمة الجانبية، بتأكيد داخل الصفحة.
// لا يُستخدم confirm() الأصلي: بعض المتصفحات المدمجة (كنافذة المتصفح في تطبيق Claude) تعيد false فورًا فيمنع الخروج.
(() => {
  'use strict';
  const ui = window.ehsanUI;
  if (!ui) return;
  let db;
  function ask() {
    return new Promise(resolve => {
      const dlg = document.createElement('dialog');
      dlg.style.cssText = 'border:0;border-radius:16px;padding:0;width:min(92vw,360px);background:var(--card,#fff);color:inherit;box-shadow:0 20px 60px rgba(0,0,0,.3)';
      dlg.innerHTML = '<div style="padding:18px 20px;display:grid;gap:14px;text-align:center"><strong style="font-size:17px">تسجيل الخروج من المنصة؟</strong><div style="display:flex;gap:8px;justify-content:center"><button type="button" class="btn primary" data-yes>تسجيل الخروج</button><button type="button" class="btn ghost" data-no>إلغاء</button></div></div>';
      let done = false; const fin = v => { if (done) return; done = true; dlg.close(); dlg.remove(); resolve(v); };
      dlg.addEventListener('click', e => { if (e.target.closest('[data-yes]')) fin(true); else if (e.target.closest('[data-no]')) fin(false); });
      dlg.addEventListener('cancel', () => fin(false));
      document.body.append(dlg); dlg.showModal();
    });
  }
  async function logout() {
    if (!(await ask())) return;
    try { await db.auth.signOut(); } finally { location.reload(); }
  }
  async function start() {
    db = await ui.waitDb(); if (!db) return;
    window.ehsanLogout = logout;
    const s = (await db.auth.getSession()).data.session; if (!s) return;
    if (!document.getElementById('logoutBtnTop')) {
      const top = document.querySelector('.topbar-actions');
      if (top) { const b = document.createElement('button'); b.type = 'button'; b.id = 'logoutBtnTop'; b.className = 'icon-btn'; b.title = 'تسجيل الخروج'; b.setAttribute('aria-label', 'تسجيل الخروج'); b.textContent = '⎋'; b.style.cssText = 'font-size:18px'; b.addEventListener('click', logout); top.append(b); }
    }
    if (!document.getElementById('logoutBtnSide')) {
      const foot = document.querySelector('#sidebar .side-foot');
      if (foot) { const b = document.createElement('button'); b.type = 'button'; b.id = 'logoutBtnSide'; b.className = 'btn ghost'; b.style.cssText = 'width:100%;margin-bottom:10px'; b.textContent = '⎋ تسجيل الخروج'; b.addEventListener('click', logout); foot.insertAdjacentElement('afterbegin', b); }
    }
  }
  start().catch(err => console.error('logout-button', err));
})();
