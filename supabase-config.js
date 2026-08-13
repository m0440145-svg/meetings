window.EHSAN_SUPABASE = {
  url: 'https://hmauemcowlaqujeatbaz.supabase.co',
  publishableKey: 'sb_publishable_W-1kxc7usnW6tQmMTtq2wA_bNEEfZD4'
};

(function(){
  if (document.querySelector('script[data-production-features]')) return;
  const s=document.createElement('script');
  s.src='production-features.js';
  s.defer=true;
  s.dataset.productionFeatures='1';
  document.head.appendChild(s);
})();
