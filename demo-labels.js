// وسم الشاشات التجريبية: شاشات من النسخة المحلية القديمة تحفظ بياناتها في المتصفح فقط (localStorage) ولا ترتبط بقاعدة البيانات.
// الوسم يمنع اللبس ولا يغيّر أي وظيفة. عند ربط الشاشة بالخادم تُحذف من هذه القائمة.
(() => {
  'use strict';
  const DEMO = {
    live: 'أثناء الاجتماع (التفريغ يُحفظ في هذا المتصفح فقط)',
    files: 'مركز المرفقات والقراءة',
    circulars: 'القرارات بالتمرير',
    security: 'الحوكمة والأمن (سجل النشاط محلي)',
    vdr: 'غرفة البيانات الآمنة'
  };
  const MSG = 'واجهة تجريبية: ما تدخله هنا يُحفظ في هذا المتصفح فقط، ولا يصل إلى بقية الأعضاء ولا يُخزَّن في قاعدة البيانات. لا تعتمد عليها في أعمال الجمعية الرسمية. للقرارات والمحاضر والتصويت استخدم الشاشات الأخرى في القائمة.';

  const st = document.createElement('style');
  st.textContent = `.demo-tag{font-style:normal;font-size:10.5px;font-weight:700;background:#fff1df;color:#9a5a11;border:1px solid #f0d9a8;border-radius:999px;padding:0 7px;margin-inline-start:6px;white-space:nowrap}
.demo-banner{background:#fff7e6;border:1px solid #f0d9a8;color:#6b4a07;border-radius:12px;padding:9px 14px;margin:0 0 14px;font-size:13.5px;line-height:1.7}
.demo-banner b{color:#9a5a11}
html[data-theme=dark] .demo-tag{background:#4a3414;color:#f1c47a;border-color:#6b4a07}
html[data-theme=dark] .demo-banner{background:#3a2a12;color:#f1c47a;border-color:#6b4a07}`;
  document.head.append(st);

  function apply() {
    for (const view of Object.keys(DEMO)) {
      const btn = document.querySelector(`#sidebar .nav-item[data-view="${view}"]`);
      if (btn && !btn.querySelector('.demo-tag')) {
        const tag = document.createElement('em'); tag.className = 'demo-tag'; tag.textContent = 'تجريبي'; tag.title = 'واجهة تجريبية محلية';
        (btn.querySelector('span:not(.ni)') || btn).append(tag);
      }
      const sec = document.getElementById('view-' + view);
      if (sec && !sec.querySelector('.demo-banner')) {
        const b = document.createElement('div'); b.className = 'demo-banner'; b.setAttribute('role', 'note');
        b.innerHTML = '<b>تنبيه:</b> ' + MSG;
        const head = sec.querySelector('.section-head');
        head ? head.after(b) : sec.prepend(b);
      }
    }
  }

  apply();
  let t = null;
  new MutationObserver(() => { clearTimeout(t); t = setTimeout(apply, 300); }).observe(document.body, {childList: true, subtree: true});
})();
