// زر «تسجيل الخروج» ظاهر في الشريط العلوي وأسفل القائمة الجانبية. (كان الخروج بالنقر على اسم المستخدم دون أي إشارة.)
(() => {
  'use strict';
  const ui = window.ehsanUI;
  if (!ui) return;
  async function start() {
    const db = await ui.waitDb(); if (!db) return;
    const s = (await db.auth.getSession()).data.session; if (!s) return;
    const out = async () => { if (!window.confirm('تسجيل الخروج من المنصة؟')) return; try { await db.auth.signOut(); } finally { location.reload(); } };
    if (!document.getElementById('logoutBtnTop')) {
      const top = document.querySelector('.topbar-actions');
      if (top) { const b = document.createElement('button'); b.type = 'button'; b.id = 'logoutBtnTop'; b.className = 'icon-btn'; b.title = 'تسجيل الخروج'; b.setAttribute('aria-label', 'تسجيل الخروج'); b.textContent = '⎋'; b.style.cssText = 'font-size:18px'; b.addEventListener('click', out); top.append(b); }
    }
    if (!document.getElementById('logoutBtnSide')) {
      const foot = document.querySelector('#sidebar .side-foot');
      if (foot) { const b = document.createElement('button'); b.type = 'button'; b.id = 'logoutBtnSide'; b.className = 'btn ghost'; b.style.cssText = 'width:100%;margin-bottom:10px'; b.textContent = '⎋ تسجيل الخروج'; b.addEventListener('click', out); foot.insertAdjacentElement('afterbegin', b); }
    }
  }
  start().catch(err => console.error('logout-button', err));
})();
