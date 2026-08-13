(function(){
  const loadScript=(src)=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=reject;document.head.appendChild(s)});
  async function start(){
    try{
      await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');
      await loadScript('supabase-config.js');
      await loadScript('supabase-app.js');
    }catch(e){console.error(e);const t=document.getElementById('toast');if(t){t.textContent='تعذر الاتصال بخدمة البيانات المركزية';t.classList.add('show')}}
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start); else start();
})();