/* تحسينات الوصولية (a11y) غير تدخّلية: تضيف أسماء مقروءة لقارئات الشاشة حيث تغيب فقط، ولا تغيّر المظهر ولا السلوك. */
(function () {
  const txt = e => (e.textContent || '').replace(/\s+/g, ' ').trim();
  const has = e => e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || e.getAttribute('title');
  const ICON_NAMES = {homeMenuBtn: 'قائمة الصفحة الرئيسية', menuBtn: 'القائمة', themeToggle: 'تبديل الوضع الداكن'};

  function labelOf(i) {
    if (i.id && document.querySelector('label[for="' + CSS.escape(i.id) + '"]')) return '';
    const wrap = i.closest('label');
    if (wrap) { const t = txt(wrap); return t ? '' : ''; }
    const prev = i.previousElementSibling;
    if (prev && /^(LABEL|SPAN|STRONG|SMALL)$/.test(prev.tagName) && txt(prev) && txt(prev).length < 60) return txt(prev);
    const fs = i.closest('fieldset'); const lg = fs && fs.querySelector('legend');
    if (lg && i.type === 'checkbox') return txt(lg) + ' - ' + (txt(i.parentElement) || i.value || '');
    if (i.placeholder) return i.placeholder;
    if (i.tagName === 'SELECT') { const o = i.options && i.options[0]; if (o && txt(o)) return txt(o); }
    if (i.type === 'checkbox' && i.parentElement && txt(i.parentElement)) return txt(i.parentElement);
    return i.name || i.id || '';
  }

  function patch(root) {
    const r = root && root.querySelectorAll ? root : document;
    r.querySelectorAll('button,[role=button]').forEach(b => {
      if (has(b)) return;
      const t = txt(b);
      if (ICON_NAMES[b.id]) { b.setAttribute('aria-label', ICON_NAMES[b.id]); return; }
      if (!t || /^[✕×✖xX]$/.test(t)) { b.setAttribute('aria-label', /^[✕×✖xX]$/.test(t) ? 'إغلاق' : (b.dataset.viewJump ? 'فتح ' + b.dataset.viewJump : 'زر')); return; }
      if (b.classList.contains('icon-btn') && /🔔/.test(t)) b.setAttribute('aria-label', 'الإشعارات');
    });
    r.querySelectorAll('.icon-btn').forEach(b => { if (!b.getAttribute('aria-label') && /🔔/.test(txt(b))) b.setAttribute('aria-label', 'الإشعارات'); });
    r.querySelectorAll('input:not([type=hidden]),select,textarea').forEach(i => {
      if (has(i)) return;
      const l = labelOf(i);
      if (l) i.setAttribute('aria-label', l);
    });
    r.querySelectorAll('dialog').forEach(d => {
      if (has(d)) return;
      const h = d.querySelector('h2,h3,h1'); if (h && txt(h)) d.setAttribute('aria-label', txt(h));
    });
    const toast = document.getElementById('toast');
    if (toast && !toast.hasAttribute('role')) { toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite'); }
  }

  let t = null;
  function schedule() { clearTimeout(t); t = setTimeout(() => patch(document), 250); }
  function start() {
    patch(document);
    new MutationObserver(schedule).observe(document.body, {childList: true, subtree: true});
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
