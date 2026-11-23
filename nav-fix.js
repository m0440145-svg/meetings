(()=>{
  function activateView(name){
    if(!name) return;
    const target=document.getElementById('view-'+name);
    if(!target) return;
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    target.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
    const navBtn=document.querySelector(`.nav-item[data-view="${CSS.escape(name)}"]`);
    const h=target.querySelector('h2,h1');
    const pageTitle=document.getElementById('pageTitle');
    const pageSub=document.getElementById('pageSub');
    if(pageTitle) pageTitle.textContent=(navBtn?.querySelector('span')?.textContent||h?.textContent||'منصة الاجتماعات').trim();
    const eyebrow=target.querySelector('.eyebrow');
    if(pageSub && eyebrow) pageSub.textContent=eyebrow.textContent.trim();
    document.getElementById('sidebar')?.classList.remove('open');
    document.querySelector('.main-area')?.scrollTo?.({top:0,behavior:'smooth'});
    window.scrollTo({top:0,behavior:'smooth'});
    try{history.replaceState(null,'','#'+name)}catch{}
  }
  function bind(){
    document.addEventListener('click',e=>{
      const trigger=e.target.closest('[data-view],[data-view-jump]');
      if(!trigger) return;
      const name=trigger.dataset.view||trigger.dataset.viewJump;
      if(!name) return;
      e.preventDefault();
      e.stopPropagation();
      activateView(name);
    },true);
    document.querySelector('.brand-box')?.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();activateView('home')}});
    const menu=document.getElementById('menuBtn');
    if(menu) menu.addEventListener('click',e=>{e.preventDefault();document.getElementById('sidebar')?.classList.toggle('open')});
    const initial=location.hash.replace('#','');
    if(initial && document.getElementById('view-'+initial)) activateView(initial);
    window.ehsanActivateView=activateView;
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
})();