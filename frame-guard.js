// حماية من التأطير (Clickjacking): GitHub Pages لا يتيح ترويسة frame-ancestors، فنكسر الإطار برمجيًا.
// إن وُضعت الصفحة داخل إطار في موقع آخر: نحاول الخروج منه، وإن مُنع ذلك (iframe بصندوق رمل) تُخفى الصفحة فلا يُخدع المستخدم بالنقر.
(() => {
  'use strict';
  let framed = false;
  try { framed = window.top !== window.self; } catch (e) { framed = true; }
  if (!framed) return;
  try { window.top.location.href = window.self.location.href; } catch (e) { /* ممنوع من المتصفح */ }
  document.documentElement.style.display = 'none';
})();
