// نافذة تأكيد داخل الصفحة: window.ehsanConfirm(message) ترجع Promise<boolean>.
// تحلّ محل confirm() الأصلي الذي تُرجع false فورًا في بعض المتصفحات المدمجة (كنافذة المتصفح في تطبيق Claude) فتتعطل الإجراءات المؤكَّدة.
(() => {
  'use strict';
  window.ehsanConfirm = message => new Promise(resolve => {
    if (!document.body || typeof HTMLDialogElement === 'undefined') { resolve(window.confirm(String(message))); return; }
    const dlg = document.createElement('dialog');
    dlg.setAttribute('aria-label', 'تأكيد');
    dlg.style.cssText = 'border:0;border-radius:16px;padding:0;width:min(92vw,420px);background:var(--card,#fff);color:inherit;box-shadow:0 20px 60px rgba(0,0,0,.3)';
    const wrap = document.createElement('div'); wrap.style.cssText = 'padding:18px 20px;display:grid;gap:16px';
    const msg = document.createElement('div'); msg.style.cssText = 'white-space:pre-line;line-height:1.9;font-weight:600'; msg.textContent = String(message);
    const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap';
    const yes = document.createElement('button'); yes.type = 'button'; yes.className = 'btn primary'; yes.textContent = 'تأكيد';
    const no = document.createElement('button'); no.type = 'button'; no.className = 'btn ghost'; no.textContent = 'إلغاء';
    row.append(yes, no); wrap.append(msg, row); dlg.append(wrap);
    let done = false; const fin = v => { if (done) return; done = true; try { dlg.close(); } catch (e) { /* مغلقة */ } dlg.remove(); resolve(v); };
    yes.addEventListener('click', () => fin(true)); no.addEventListener('click', () => fin(false));
    dlg.addEventListener('cancel', e => { e.preventDefault(); fin(false); });
    document.body.append(dlg); dlg.showModal(); no.focus();
  });
})();
