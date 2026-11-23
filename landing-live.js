// حيوية الصفحة الرئيسية (إضافة بصرية فقط): دخول متتابع للبطاقات، شريط تقدّم القراءة، تمييز القسم الحالي في القائمة،
// وهج هادئ لزر الدخول، زر العودة للأعلى. لا يغيّر محتوى الصفحة ولا وظائفها، ويحترم «تقليل الحركة».
(() => {
  'use strict';
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const STYLE = `
#landing .lp-prog{position:fixed;top:0;inset-inline:0;height:3px;z-index:60;pointer-events:none;background:linear-gradient(90deg,var(--lp-accent),var(--lp-strong));transform-origin:right center;transform:scaleX(0)}
#landing .lp-header{transition:box-shadow .3s ease,background .3s ease}
#landing .lp-header.lp-scrolled{box-shadow:0 8px 24px rgba(60,30,10,.12)}
#landing .lp-nav a{position:relative}
#landing .lp-nav a.lp-active{background:#fff;color:var(--lp-strong)}
#landing .lp-nav a.lp-active::after{content:"";position:absolute;inset-inline:16px;bottom:3px;height:2px;border-radius:2px;background:var(--lp-accent)}
#landing .lp-sec.reveal:not(.in) .lp-card{opacity:0}
#landing .lp-sec.reveal.in .lp-card{animation:lpPop .65s cubic-bezier(.2,.8,.2,1) backwards;animation-delay:calc(var(--i,0) * 90ms)}
@keyframes lpPop{from{opacity:0;transform:translateY(22px) scale(.96)}to{opacity:1;transform:none}}
#landing .lp-sec>h2::after{content:"";display:block;height:3px;width:0;margin-top:8px;border-radius:3px;background:linear-gradient(90deg,var(--lp-accent),transparent);transition:width .9s ease .25s}
#landing .lp-sec.reveal.in>h2::after{width:64px}
#landing .lp-card:hover .lp-ico{animation:lpWiggle .6s ease}
@keyframes lpWiggle{0%,100%{transform:rotate(0)}25%{transform:rotate(-9deg) scale(1.08)}60%{transform:rotate(7deg) scale(1.08)}}
#landing .lp-step-no{animation:lpPulse 2.6s ease-out infinite}
@keyframes lpPulse{0%{box-shadow:0 0 0 0 rgba(168,70,26,.45)}70%,100%{box-shadow:0 0 0 12px rgba(168,70,26,0)}}
#landing .lp-cta{position:relative;overflow:hidden}
#landing .lp-cta::after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(110deg,transparent 35%,rgba(241,137,39,.14) 50%,transparent 65%);transform:translateX(-130%);animation:lpShine 6s ease-in-out infinite}
@keyframes lpShine{0%,55%{transform:translateX(-130%)}100%{transform:translateX(130%)}}
#landing .lp-cta .lp-btn{position:relative;animation:lpGlow 2.8s ease-in-out infinite}
@keyframes lpGlow{0%,100%{box-shadow:0 0 0 0 rgba(168,70,26,.35)}50%{box-shadow:0 0 0 10px rgba(168,70,26,0)}}
#landing .lp-top{position:fixed;inset-inline-start:18px;bottom:18px;z-index:55;width:44px;height:44px;border-radius:50%;border:1px solid var(--lp-line);background:#fff;color:var(--lp-strong);font-size:20px;line-height:1;cursor:pointer;box-shadow:0 8px 22px rgba(60,30,10,.18);opacity:0;transform:translateY(12px);pointer-events:none;transition:opacity .25s,transform .25s}
#landing .lp-top.show{opacity:1;transform:none;pointer-events:auto}
#landing .lp-top:hover{background:var(--lp-strong);color:#fff}
#landing .lp-foot .lp-credit a{color:#fff;font-weight:800;text-decoration:none;border-bottom:1px dotted rgba(255,255,255,.6);direction:ltr;unicode-bidi:isolate;white-space:nowrap}
#landing .lp-foot .lp-credit a:hover{color:#ffc58a;border-color:#ffc58a}
#landing .tw-v.tw-on{border-inline-end:2px solid var(--lp-accent);margin-inline-end:-2px;animation:twBlink .6s steps(1) infinite}
@keyframes twBlink{50%{border-color:transparent}}
@media(prefers-reduced-motion:reduce){#landing .lp-sec.reveal .lp-card{opacity:1!important}#landing .lp-prog,#landing .lp-top{display:none}}
`;
  // «كتابة حية»: عند تمرير المؤشر على مربع تُكتب عناوينه ونصوصه حرفًا حرفًا (النص نفسه، والتخطيط ثابت لأن المتبقي يبقى مخفيًا).
  const TW_BOX = '.lp-card, .lp-cta';
  function typewriter(lp) {
    const jobs = new WeakMap();
    const finish = box => {
      const j = jobs.get(box); if (!j) return;
      cancelAnimationFrame(j.raf); jobs.delete(box);
      j.els.forEach((e, i) => { e.textContent = j.texts[i]; });
    };
    const begin = box => {
      finish(box);
      const els = [...box.querySelectorAll('h2, h3, p')].filter(e => !e.children.length && e.textContent.trim());
      if (!els.length) return;
      const texts = els.map(e => e.textContent);
      const parts = els.map((e, i) => {
        e.textContent = '';
        const v = document.createElement('span'); v.className = 'tw-v';
        const h = document.createElement('span'); h.style.visibility = 'hidden'; h.textContent = texts[i];
        e.append(v, h); return {v, h};
      });
      const j = {els, texts, raf: 0}; jobs.set(box, j);
      let idx = 0, t0 = performance.now();
      const step = now => {
        if (jobs.get(box) !== j) return;
        const txt = texts[idx], speed = /^H/.test(els[idx].tagName) ? 34 : 14;
        const n = Math.min(txt.length, Math.floor((now - t0) / speed));
        parts[idx].v.textContent = txt.slice(0, n); parts[idx].h.textContent = txt.slice(n);
        parts[idx].v.classList.toggle('tw-on', n < txt.length);
        if (n >= txt.length) { idx++; t0 = now; if (idx >= els.length) { finish(box); return; } }
        j.raf = requestAnimationFrame(step);
      };
      j.raf = requestAnimationFrame(step);
    };
    lp.querySelectorAll(TW_BOX).forEach(box => {
      box.addEventListener('mouseenter', () => begin(box));
      box.addEventListener('mouseleave', () => finish(box));
      box.addEventListener('focusin', () => begin(box));
      box.addEventListener('focusout', () => finish(box));
    });
  }
  function start(lp) {
    if (lp.dataset.live) return; lp.dataset.live = '1';
    const st = document.createElement('style'); st.id = 'lpLiveStyle'; st.textContent = STYLE; document.head.append(st);
    // دخول متتابع: ترتيب البطاقات داخل كل قسم
    lp.querySelectorAll('.lp-sec').forEach(sec => sec.querySelectorAll('.lp-card').forEach((c, i) => c.style.setProperty('--i', i)));
    if (reduced()) return;
    typewriter(lp);
    const bar = document.createElement('div'); bar.className = 'lp-prog'; bar.setAttribute('aria-hidden', 'true'); lp.prepend(bar);
    const top = document.createElement('button'); top.type = 'button'; top.className = 'lp-top'; top.setAttribute('aria-label', 'العودة إلى أعلى الصفحة'); top.textContent = '↑';
    top.onclick = () => window.scrollTo({top: 0, behavior: 'smooth'}); lp.append(top);
    const header = lp.querySelector('.lp-header');
    let ticking = false;
    const update = () => {
      ticking = false;
      const h = document.documentElement, max = h.scrollHeight - h.clientHeight, y = window.scrollY || h.scrollTop;
      bar.style.transform = 'scaleX(' + (max > 0 ? Math.min(1, y / max) : 0) + ')';
      header?.classList.toggle('lp-scrolled', y > 8);
      top.classList.toggle('show', y > 600);
    };
    window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, {passive: true});
    update();
    // تمييز القسم الحالي في قائمة الترويسة
    const links = [...lp.querySelectorAll('.lp-nav a[href^="#"]')];
    const map = new Map(links.map(a => [a.getAttribute('href').slice(1), a]));
    if ('IntersectionObserver' in window && map.size) {
      const io = new IntersectionObserver(es => es.forEach(e => {
        if (!e.isIntersecting) return;
        links.forEach(a => a.classList.remove('lp-active'));
        map.get(e.target.id)?.classList.add('lp-active');
      }), {rootMargin: '-35% 0px -55% 0px'});
      map.forEach((_, id) => { const s = lp.querySelector('#' + CSS_escape(id)); if (s) io.observe(s); });
    }
  }
  const CSS_escape = s => (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/[^\w-]/g, '');
  let tries = 0;
  const t = setInterval(() => {
    const lp = document.getElementById('landing');
    if (lp) { clearInterval(t); try { start(lp); } catch (e) { console.error('landing-live', e); } }
    else if (++tries > 80) clearInterval(t);
  }, 250);
})();
