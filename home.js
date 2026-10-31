(function(){
  // supabase-js مثبّت على إصدار محدد مع SRI؛ عند تغيير الإصدار أعد حساب التجزئة:
  // curl -sL <url> | openssl dgst -sha384 -binary | openssl base64 -A
  const SUPABASE_JS={
    src:'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js',
    integrity:'sha384-Rj26LVGvoeRVR6+mwQmFfcR3QOBEwT+ZmuCWpuiqeTzJpCs0ER4ITAWGb4Hiy3Ok'
  };
  // رقم الإصدار يستبدله سير عمل النشر برمز الـcommit فيتجدد الكاش عند كل نشر؛ محليًا نستخدم الوقت فلا يُخزَّن شيء
  const B='8817abd3',BUILD=B.indexOf('__')===0?String(Date.now()):B;
  const loadScript=(src,integrity)=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=integrity?src:src+'?v='+BUILD;if(integrity){s.integrity=integrity;s.crossOrigin='anonymous'}s.onload=resolve;s.onerror=()=>reject(new Error('تعذر تحميل '+src));document.head.appendChild(s)});
  function showLoadError(e){
    document.documentElement.dataset.auth='error'; // لا نُبقي الصفحة مخفية إن تعذر تحميل السكربتات
    console.error(e);
    if(document.getElementById('loadError'))return;
    const d=document.createElement('div');d.id='loadError';d.setAttribute('role','alert');
    d.style.cssText='position:fixed;inset:auto 16px 16px 16px;background:#b3261e;color:#fff;padding:12px 16px;border-radius:12px;z-index:9999;text-align:center';
    d.textContent='تعذر تحميل مكوّنات المنصة. تحقق من الاتصال ثم أعد تحميل الصفحة.';
    document.body.appendChild(d);
  }
  async function start(){try{await loadScript('theme.js');await loadScript('a11y.js');await loadScript('nav-fix.js');await loadScript(SUPABASE_JS.src,SUPABASE_JS.integrity);await loadScript('supabase-config.js');await loadScript('supabase-app.js');await loadScript('landing.js');await loadScript('advanced-supabase.js');await loadScript('production-features.js');await loadScript('platform-settings.js');await loadScript('nav-groups.js');await loadScript('member-space.js');await loadScript('insights.js');await loadScript('governance.js');await loadScript('development.js');await loadScript('archive-reports.js');await loadScript('reminders.js');await loadScript('scheduler.js');await loadScript('banners-admin.js');await loadScript('decisions.js');await loadScript('xlsx-lite.js');await loadScript('dm-core.js');await loadScript('dm-views.js');await loadScript('dm-detail.js');await loadScript('dm-admin.js');await loadScript('meeting-manage.js');await loadScript('members-manage.js');await loadScript('bodies-manage.js');await loadScript('surveys.js');await loadScript('demo-labels.js')}catch(e){showLoadError(e)}}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
