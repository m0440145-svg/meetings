(() => {
  // الصفحة الرئيسية العامة (للزائر غير المسجل): بنر إعلانات متحرك، الأهداف، الرؤية، الرسالة، وتواصل،
  // ولوحة تسجيل الدخول مثبتة على يسار الشاشة وقابلة للطي. بعد تسجيل الدخول تظهر المنصة كالمعتاد.
  // المحتوى من platform_settings (بيانات المنصة) وplatform_banners (الإعلانات)، وتبقى نصوص افتراضية إن لم يُضبط شيء.
  // التنسيق مُدمج هنا لضمان الاتساق حتى لو كان styles.css قديمًا في الكاش. دليل التصميم: docs/تصميم-الصفحة-الرئيسية.md
  const db = window.ehsanDB, cfg = window.EHSAN_SUPABASE || {};
  const root = document.documentElement;
  if (!db) { root.dataset.auth = 'in'; return; }

  const SETTINGS_CACHE = 'ehsan_platform_settings_v1';
  const AUTOPLAY_MS = 7000;
  const wide = () => window.matchMedia('(min-width: 900px)').matches;
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const safeHttps = u => { try { return new URL(u).protocol === 'https:' ? new URL(u).href : ''; } catch { return ''; } };
  const safeImg = u => u && (u.startsWith('assets/') ? u : safeHttps(u));
  let inApp = false, lastView = 'home', siteBuilt = false; // inApp: مستخدم مسجّل يعرض الصفحة العامة من داخل المنصة
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  // نصوص افتراضية (مسودة)؛ تظهر فقط إن لم يحفظ المدير نصًا في "بيانات المنصة". راجعها قبل الإطلاق
  const DEFAULT_GOALS = ['رفع كفاءة إدارة اجتماعات المجلس واللجان وتنظيمها', 'توثيق المحاضر والقرارات وأرشفتها بصورة موثوقة', 'تعزيز الشفافية والمساءلة ومتابعة تنفيذ القرارات', 'تسهيل التواصل والمشاركة بين أعضاء المجلس واللجان'];
  const DEFAULT_VISION = 'أن تكون الجمعية نموذجًا في العمل الاجتماعي المؤسسي، تقوم حوكمتها على قرارات موثّقة وشفافة تضاعف أثرها في المجتمع.';
  const DEFAULT_MISSION = 'إدارة اجتماعات المجلس واللجان وقراراتها بكفاءة وشفافية عبر منصة رقمية موحدة وآمنة، تدعم العمل الخيري وتخدم المستفيدين.';
  const GOAL_ICONS = ['◎', '▤', '⚖', '♙', '✦', '◫'];
  const DEFAULT_SLIDES = [
    {title: 'منصة الاجتماعات والحوكمة الرقمية', body: 'بوابة واحدة لإدارة الاجتماعات والقرارات والمحاضر لمجالس الجمعية ولجانها.', cta: 'تسجيل الدخول', link: ''},
    {title: 'اجتماعات أكثر كفاءة وقرارات أوضح', body: 'من الدعوة وجدول الأعمال إلى التصويت والتوقيع ومتابعة التنفيذ.', cta: 'تعرّف على أهدافنا', link: '#lp-goals'},
    {title: 'الأمان والتوثيق أولًا', body: 'صلاحيات محكمة، وتصويت سري، وتوقيع موثّق بسجل تدقيق كامل.', cta: 'الرؤية والرسالة', link: '#lp-vision'}
  ];

  const CSS = `
html[data-auth=pending] .app-shell{visibility:hidden}
html[data-auth=out] .app-shell,html[data-auth=home] .app-shell{display:none}
html[data-auth=in] #landing,html[data-auth=error] #landing{display:none}
html[data-auth=home] body{background:#f9f4ee}
html[data-auth=out] body{background:#f9f4ee}
.lp{--lp-ink:#3a332f;--lp-muted:#6b5f59;--lp-brand:#cf6028;--lp-accent:#f18927;--lp-strong:#a8461a;--lp-bg:#f9f4ee;--lp-line:#eadfd8;--lp-dark:#2b211c;--login-w:400px;
  color:var(--lp-ink);background:var(--lp-bg);min-height:100vh;font-family:"Segoe UI",Tahoma,Arial,sans-serif;line-height:1.8;transition:margin .3s ease}
.lp *{box-sizing:border-box}
.lp a{color:var(--lp-strong)}
.lp :focus-visible,#authGate :focus-visible{outline:3px solid var(--lp-accent);outline-offset:2px;border-radius:6px}
.lp-skip{position:absolute;inset-inline-start:12px;top:-60px;background:#fff;color:var(--lp-strong);padding:8px 14px;border-radius:10px;z-index:100;font-weight:800;text-decoration:none}
.lp-skip:focus{top:10px}
@media(min-width:900px){html[data-auth=out][data-login=open] .lp{margin-left:var(--login-w)}}
/* الترويسة */
.lp-header{position:sticky;top:0;z-index:40;display:flex;align-items:center;gap:18px;padding:10px clamp(16px,4vw,40px);background:rgba(249,244,238,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--lp-line)}
.lp-brand{display:flex;align-items:center;gap:12px;text-decoration:none;color:var(--lp-ink)}
.lp-brand img{width:84px;height:48px;object-fit:contain;background:#fff;border:1px solid var(--lp-line);border-radius:10px;padding:3px}
.lp-brand .lp-h1{display:block;margin:0;font-size:17px;line-height:1.3}
.lp-brand small{display:block;font-size:12px;color:var(--lp-muted)}
.lp-nav{display:flex;gap:4px;margin-inline-start:auto}
.lp-nav a{padding:8px 14px;border-radius:999px;color:var(--lp-ink);text-decoration:none;font-weight:700;font-size:14px;transition:background .2s,color .2s}
.lp-nav a:hover{background:#fff;color:var(--lp-strong)}
.lp-login-btn{border:0;cursor:pointer;background:var(--lp-strong);color:#fff;font:inherit;font-weight:800;font-size:14px;padding:10px 18px;border-radius:12px;transition:transform .15s,background .2s;margin-inline-start:auto}
.lp-nav + .lp-login-btn{margin-inline-start:0}
.lp-login-btn:hover{background:#8f3a14}
.lp-login-btn:active{transform:scale(.97)}
@media(min-width:900px){html[data-login=open] .lp-login-btn{display:none}}
@media(max-width:899px){.lp-nav{display:none}}
@media(max-width:560px){.lp-header{gap:10px;padding:8px 14px}.lp-brand{gap:8px;min-width:0}.lp-brand img{width:60px;height:38px}.lp-brand .lp-h1{font-size:15px}.lp-brand small{display:none}.lp-login-btn{padding:9px 14px;font-size:13px;white-space:nowrap}.lp-hero{margin-inline:12px;border-radius:18px;min-height:340px}.lp-ctrl{gap:6px;flex-wrap:wrap}.lp-arrow,.lp-pause{min-width:36px;height:36px;padding:0 10px;font-size:13px}}
/* البنر المتحرك */
.lp-hero{position:relative;margin:clamp(12px,2vw,24px) clamp(16px,4vw,40px) 0;border-radius:24px;overflow:hidden;background:#2b211c;color:#fff;aspect-ratio:16/6;min-height:300px;isolation:isolate}
.lp-slide{position:absolute;inset:0;display:flex;align-items:center;padding:clamp(20px,5vw,64px);opacity:0;visibility:hidden;transition:opacity .7s ease,visibility .7s;background:linear-gradient(135deg,#2b211c 0%,#7a3412 55%,#a8461a 100%)}
.lp-slide::before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 85% 20%,rgba(241,137,39,.28),transparent 45%);z-index:0}
.lp-slide.on{opacity:1;visibility:visible;z-index:1}
.lp-slide img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0}
.lp-slide .lp-shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(43,33,28,.92) 0%,rgba(43,33,28,.78) 45%,rgba(43,33,28,.35) 100%);z-index:0}
.lp-slide-body{position:relative;z-index:1;max-width:640px;display:grid;gap:12px;justify-items:start}
.lp-kicker{color:#ffc58a;font-weight:800;font-size:13px;letter-spacing:.02em}
.lp-slide h2{margin:0;font-size:clamp(22px,3.4vw,40px);line-height:1.35}
.lp-slide p{margin:0;font-size:clamp(14px,1.5vw,18px);color:#f9f4ee;max-width:56ch}
.lp-btn{display:inline-flex;align-items:center;gap:8px;border:0;cursor:pointer;font:inherit;font-weight:800;font-size:15px;padding:12px 22px;border-radius:14px;text-decoration:none;background:#fff;color:var(--lp-strong);transition:transform .15s,box-shadow .2s}
.lp-btn:hover{transform:translateY(-2px);box-shadow:0 10px 24px rgba(0,0,0,.2)}
.lp-btn:active{transform:scale(.98)}
.lp-btn.solid{background:var(--lp-strong);color:#fff}
.lp-ctrl{position:absolute;z-index:5;inset-inline:0;bottom:14px;display:flex;align-items:center;justify-content:center;gap:10px;pointer-events:none}
.lp-ctrl > *{pointer-events:auto}
.lp-dots{display:flex;gap:8px;align-items:center}
.lp-dot{width:12px;height:12px;border-radius:999px;border:2px solid #fff;background:transparent;padding:0;cursor:pointer;transition:width .25s,background .25s}
.lp-dot[aria-current=true]{width:30px;background:#fff}
.lp-arrow,.lp-pause{border:1px solid rgba(255,255,255,.7);background:rgba(43,33,28,.55);color:#fff;border-radius:999px;min-width:40px;height:40px;padding:0 12px;cursor:pointer;font:inherit;font-weight:700;transition:background .2s}
.lp-arrow:hover,.lp-pause:hover{background:rgba(43,33,28,.85)}
@media(max-width:899px){.lp-hero{aspect-ratio:auto;min-height:380px}.lp-slide{align-items:flex-start;padding-bottom:70px}.lp-slide .lp-shade{background:linear-gradient(180deg,rgba(43,33,28,.9),rgba(43,33,28,.7))}}
/* الأقسام */
.lp-sec{padding:clamp(40px,7vw,80px) clamp(16px,4vw,40px) 0;max-width:1240px;margin-inline:auto}
.lp-sec > h2{margin:0 0 6px;font-size:clamp(22px,2.6vw,32px)}
.lp-lead{margin:0 0 24px;color:var(--lp-muted);max-width:60ch}
.lp-goals{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:16px}
.lp-card{background:#fff;border:1px solid var(--lp-line);border-radius:20px;padding:22px;box-shadow:0 8px 24px rgba(68,46,31,.06);transition:transform .2s,box-shadow .2s}
.lp-card:hover{transform:translateY(-4px);box-shadow:0 16px 32px rgba(68,46,31,.12)}
.lp-ico{width:48px;height:48px;border-radius:14px;display:grid;place-items:center;background:#fbeee4;color:var(--lp-strong);font-size:22px;margin-bottom:12px}
.lp-card h3{margin:0 0 6px;font-size:17px}
.lp-card p{margin:0;color:var(--lp-muted)}
.lp-goals .lp-card p{color:var(--lp-ink);font-weight:600}
.lp-vm{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.lp-vm .lp-card{padding:30px}
.lp-vm .big{font-size:clamp(18px,2vw,24px);line-height:1.7;margin:0;color:var(--lp-ink);font-weight:700}
.lp-vm .lp-card.vision{background:linear-gradient(135deg,#2b211c,#7a3412);color:#fff;border:0}
.lp-vm .lp-card.vision h3,.lp-vm .lp-card.vision .big{color:#fff}
.lp-vm .lp-card.vision .lp-ico{background:rgba(255,255,255,.14);color:#ffc58a}
@media(max-width:700px){.lp-vm{grid-template-columns:1fr}}
.lp-cta{margin:clamp(40px,7vw,80px) clamp(16px,4vw,40px) 0;padding:clamp(24px,4vw,44px);border-radius:24px;background:#fff;border:1px solid var(--lp-line);display:flex;gap:18px;align-items:center;justify-content:space-between;flex-wrap:wrap;max-width:1240px;margin-inline:auto}
.lp-cta h2{margin:0 0 4px;font-size:clamp(20px,2.4vw,28px)}
.lp-cta p{margin:0;color:var(--lp-muted)}
.lp-foot{margin-top:clamp(40px,7vw,80px);background:var(--lp-dark);color:#f9f4ee;padding:32px clamp(16px,4vw,40px)}
.lp-foot-in{max-width:1240px;margin-inline:auto;display:flex;gap:24px;flex-wrap:wrap;justify-content:space-between}
.lp-foot h3{margin:0 0 8px;font-size:16px;color:#ffc58a}
.lp-foot a{color:#fff}
.lp-foot ul{list-style:none;margin:0;padding:0;display:grid;gap:4px}
.lp-foot small{display:block;margin-top:18px;color:#d7c9c2;text-align:center;width:100%}
.lp-foot .lp-credit{margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.14);color:#ffc58a;font:600 14px/1.7 "Amiri","Noto Naskh Arabic","Sakkal Majalla","Traditional Arabic",serif;letter-spacing:.01em}
.lp-foot .lp-credit::before{content:"✦ ";font-size:10px;opacity:.85}
.lp-foot .lp-lbl{color:#d7c9c2}
.lp-foot li{overflow-wrap:anywhere}
.lp .reveal{opacity:0;transform:translateY(14px);transition:opacity .5s ease,transform .5s ease}
.lp .reveal.in{opacity:1;transform:none}
/* حيوية البنر: كل الحركات بـ transform/opacity فقط، وتتوقف خارج الشاشة وعند التثبيت وعند تقليل الحركة */
.lp-bg{position:absolute;inset:-2%;z-index:0;transform-origin:70% 40%;will-change:transform}
.lp-bg.v0{background:linear-gradient(135deg,#2b211c 0%,#7a3412 55%,#a8461a 100%)}
.lp-bg.v1{background:linear-gradient(135deg,#3a1f10 0%,#8a3b14 58%,#a8461a 100%)}
.lp-bg.v2{background:linear-gradient(135deg,#2b211c 0%,#6b2d10 50%,#9a3f16 100%)}
.lp-slide.on .lp-bg{animation:lp-kb 18s ease-out forwards}
@keyframes lp-kb{from{transform:scale(1)}to{transform:scale(1.09)}}
.lp-deco{position:absolute;inset:0;z-index:0;pointer-events:none;transform:translate3d(calc(var(--px,0)*-18px),calc(var(--py,0)*-12px),0);transition:transform .25s ease-out}
.lp-orb{position:absolute;border-radius:50%;will-change:transform}
.lp-orb.o1{width:38%;aspect-ratio:1;left:-6%;top:-18%;background:radial-gradient(circle at 35% 35%,rgba(241,137,39,.42),rgba(241,137,39,0) 70%);animation:lp-float 9s ease-in-out infinite alternate}
.lp-orb.o2{width:22%;aspect-ratio:1;left:24%;bottom:-14%;background:radial-gradient(circle at 40% 40%,rgba(255,197,138,.35),rgba(255,197,138,0) 70%);animation:lp-float 12s ease-in-out -4s infinite alternate-reverse}
.lp-orb.o3{width:16%;aspect-ratio:1;left:10%;top:36%;border:2px solid rgba(255,255,255,.16);animation:lp-spin 40s linear infinite}
.lp-orb.o3::after{content:"";position:absolute;width:12%;aspect-ratio:1;border-radius:50%;background:#ffc58a;top:-6%;left:44%;opacity:.9}
@keyframes lp-float{from{transform:translate3d(0,0,0) scale(1)}to{transform:translate3d(4%,6%,0) scale(1.12)}}
@keyframes lp-spin{to{transform:rotate(360deg)}}
.lp-slide.on .lp-slide-body > *{animation:lp-up .75s cubic-bezier(.2,.7,.2,1) both}
.lp-slide.on .lp-slide-body > :nth-child(2){animation-delay:.12s}
.lp-slide.on .lp-slide-body > :nth-child(3){animation-delay:.24s}
.lp-slide.on .lp-slide-body > :nth-child(4){animation-delay:.36s}
@keyframes lp-up{from{opacity:0;transform:translate3d(0,22px,0)}to{opacity:1;transform:none}}
.lp-slide.on .lp-btn{position:relative}
.lp-slide.on .lp-btn::after{content:"";position:absolute;inset:0;border-radius:inherit;border:2px solid #fff;opacity:0;animation:lp-ring 2.6s ease-out 1.4s infinite;pointer-events:none}
@keyframes lp-ring{0%{opacity:.7;transform:scale(1)}100%{opacity:0;transform:scale(1.18,1.4)}}
.lp-count{position:absolute;z-index:4;top:14px;inset-inline-end:22px;color:#fff;font-weight:700;font-size:14px;letter-spacing:.08em;direction:ltr;opacity:.92}
.lp-count b{display:inline-block;font-size:24px;line-height:1;animation:lp-up .5s ease both}
.lp-progress{position:absolute;z-index:6;inset-inline:0;bottom:0;height:4px;background:rgba(255,255,255,.18)}
.lp-progress i{display:block;height:100%;width:100%;background:linear-gradient(90deg,#f18927,#ffc58a);transform:scaleX(0);transform-origin:100% 50%;transition:transform .12s linear}
.lp-hero.lp-off *,.lp-hero.lp-off *::after,.lp-hero.lp-still .lp-orb,.lp-hero.lp-still .lp-bg{animation-play-state:paused!important}
@media(max-width:560px){.lp-orb.o3{display:none}.lp-count{top:10px;inset-inline-end:14px}}
/* ═══ وضع ثلاثي الأبعاد (تجريبي): CSS 3D فقط بلا مكتبات، يُفعَّل على الشاشات الواسعة وبلا تقليل حركة، وله زر إيقاف ═══ */
.lp-stack{display:none}
.lp-3dbtn{border:1px solid rgba(255,255,255,.7);background:rgba(43,33,28,.55);color:#fff;border-radius:999px;height:40px;padding:0 14px;cursor:pointer;font:inherit;font-weight:700;transition:background .2s}
.lp-3dbtn:hover{background:rgba(43,33,28,.85)}
.lp-3dbtn[aria-pressed=true]{background:#fff;color:#a8461a}
@media(max-width:899px){.lp-3dbtn{display:none}}
.lp-hero.lp-3d{perspective:1400px;perspective-origin:60% 45%}
.lp-3d .lp-slide{transform-style:preserve-3d;backface-visibility:hidden;transform:rotateY(34deg) translateZ(-260px) scale(.92);transition:opacity .8s ease,visibility .8s,transform .95s cubic-bezier(.2,.7,.2,1)}
.lp-3d .lp-slide.on{transform:translateZ(0)}
.lp-3d .lp-slide.out{transform:rotateY(-34deg) translateZ(-260px) scale(.92)}
.lp-3d .lp-bg{transform:translateZ(-90px) scale(1.14)}
.lp-3d .lp-slide.on .lp-bg{animation-name:lp-kb3}
@keyframes lp-kb3{from{transform:translateZ(-90px) scale(1.14)}to{transform:translateZ(-90px) scale(1.22)}}
.lp-3d .lp-deco{transform:translateZ(-40px) translate3d(calc(var(--px,0)*-26px),calc(var(--py,0)*-16px),0)}
.lp-3d .lp-slide-body{transform:translateZ(70px) scale(.95) rotateY(calc(var(--px,0)*-2.5deg)) rotateX(calc(var(--py,0)*2deg));transition:transform .25s ease-out}
.lp-3d .lp-stack{display:block;position:absolute;z-index:1;left:8%;top:57%;width:min(270px,24%);aspect-ratio:3/2.3;pointer-events:none;transform-style:preserve-3d;transform:translateY(-50%) rotateX(calc(12deg + var(--py,0)*-7deg)) rotateY(calc(-26deg + var(--px,0)*9deg));transition:transform .25s ease-out}
.lp-stack-in{position:absolute;inset:0;transform-style:preserve-3d;animation:lp-bob 6s ease-in-out infinite alternate}
@keyframes lp-bob{from{transform:translate3d(0,-8px,0)}to{transform:translate3d(0,10px,0)}}
.lp-sheet{position:absolute;inset:0;border-radius:18px;border:1px solid rgba(255,255,255,.38);background:linear-gradient(150deg,rgba(255,255,255,.24),rgba(255,255,255,.07));box-shadow:0 18px 40px rgba(0,0,0,.28);padding:16px;display:flex;flex-direction:column;gap:9px;justify-content:center}
.lp-sheet.s1{transform:translateZ(0)}
.lp-sheet.s2{transform:translateZ(70px) translate(20px,-13px)}
.lp-sheet.s3{transform:translateZ(140px) translate(40px,-26px);background:linear-gradient(150deg,rgba(255,255,255,.34),rgba(255,255,255,.12))}
.lp-sheet i{width:34px;height:34px;border-radius:11px;display:grid;place-items:center;background:#f18927;color:#2b211c;font-style:normal;font-weight:800;font-size:17px}
.lp-sheet b{display:block;height:8px;border-radius:99px;background:rgba(255,255,255,.55);width:82%}
.lp-sheet b.m{width:62%}.lp-sheet b.k{width:44%}
.lp-hero.lp-still .lp-stack-in{animation-play-state:paused}
.lp-3d .lp-stack.lp-logo3d{width:min(330px,28%);aspect-ratio:1;top:52%}
.lp-logo-l{position:absolute;inset:0;overflow:hidden;border-radius:6px}
.lp-logo-l img{position:absolute;width:320%;height:auto;max-width:none;object-fit:fill;left:-112%;top:-8%;right:auto;bottom:auto;filter:drop-shadow(0 10px 18px rgba(0,0,0,.35))}
.lp-logo-l.l0{transform:translateZ(0);opacity:.28}
.lp-logo-l.l1{transform:translateZ(26px);opacity:.4}
.lp-logo-l.l2{transform:translateZ(52px);opacity:.55}
.lp-logo-l.l3{transform:translateZ(78px);opacity:.75}
.lp-logo-l.l4{transform:translateZ(104px);opacity:1}
@media(prefers-reduced-motion:reduce){.lp,.lp *{transition:none!important;animation:none!important}.lp .reveal{opacity:1;transform:none}html{scroll-behavior:auto!important}}
/* لوحة تسجيل الدخول: يسار الشاشة، قابلة للطي */
html body #authGate{position:fixed;inset:0 auto 0 0;width:var(--login-w,400px);max-width:100vw;z-index:60;display:block;padding:0;background:#fff;border-right:1px solid #eadfd8;box-shadow:12px 0 40px rgba(68,46,31,.12);overflow-y:auto;overscroll-behavior:contain;transition:transform .3s ease}
html[data-auth=out][data-login=closed] body #authGate{transform:translateX(-102%);visibility:hidden;transition:transform .3s ease,visibility 0s .3s}
html body #authGate .auth-card{width:100%;max-width:none;border:0;border-radius:0;box-shadow:none;padding:28px 28px 20px;min-height:100%;display:flex;flex-direction:column;justify-content:center;text-align:center;position:relative}
html body #authGate .auth-card img{width:150px;height:auto;max-height:80px;margin:0 auto}
html body #authGate .auth-card h2{color:#a8461a;margin:6px 0 2px;font-size:22px}
html body #authGate .auth-card p{color:#6b5f59;margin:0}
html body #authGate .auth-card label{font-weight:700;font-size:13px;color:#3a332f}
html body #authGate .auth-card input{padding:12px 14px;border:1px solid #cdbfb6;border-radius:12px;font-size:15px;background:#fff;color:#3a332f;transition:border-color .2s,box-shadow .2s}
html body #authGate .auth-card input:focus{outline:none;border-color:#a8461a;box-shadow:0 0 0 3px rgba(241,137,39,.35)}
html body #authGate .auth-card .btn.primary{background:#a8461a;color:#fff;padding:12px;font-size:15px;transition:transform .15s,background .2s}
html body #authGate .auth-card .btn.primary:hover{background:#8f3a14}
html body #authGate .auth-card .btn.primary:active{transform:scale(.98)}
html body #authGate .auth-card .btn.primary[disabled]{opacity:.6;cursor:not-allowed}
html body #authGate .auth-card .btn.secondary{background:#fff;color:#a8461a;border:1px solid #a8461a;padding:11px;width:100%;transition:background .2s}
html body #authGate .auth-card .btn.secondary:hover{background:#fdf1e8}
html body #authGate .auth-links{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}
html body #authGate .link-btn{color:#a8461a;font-weight:700}
html body #authGate #authMsg{color:#a32626;min-height:1.4em;font-weight:600}
.lp-pw{position:relative;display:block}
.lp-pw input{padding-inline-end:76px!important}
.lp-pw button{position:absolute;inset-inline-end:8px;top:50%;transform:translateY(-50%);border:0;background:transparent;color:#a8461a;font:inherit;font-weight:700;font-size:13px;cursor:pointer;padding:6px 8px;border-radius:8px}
.lp-caps{color:#8a5a00;font-size:12px;font-weight:700;margin:-6px 0 0}
.lp-oauth{display:grid;gap:10px;margin:14px 0 4px}
.lp-oauth .sep{display:flex;align-items:center;gap:10px;color:#6b5f59;font-size:12px}
.lp-oauth .sep::before,.lp-oauth .sep::after{content:"";height:1px;background:#eadfd8;flex:1}
.lp-oauth button{border:1px solid #cdbfb6;background:#fff;color:#3a332f;border-radius:12px;padding:11px;font:inherit;font-weight:700;cursor:pointer;transition:background .2s,transform .15s}
.lp-oauth button:hover{background:#fdf6f0}
.lp-oauth button:active{transform:scale(.98)}
.lp-secure{font-size:12px;color:#6b5f59;margin-top:10px}
.lp-gate-close{position:absolute;inset-inline-start:12px;top:12px;border:1px solid #eadfd8;background:#fff;border-radius:10px;width:36px;height:36px;cursor:pointer;font-size:16px;color:#3a332f}
.lp-gate-tab{position:fixed;left:0;top:50%;transform:translateY(-50%);z-index:59;border:0;background:#a8461a;color:#fff;font:inherit;font-weight:800;padding:14px 10px;border-radius:0 12px 12px 0;writing-mode:vertical-rl;cursor:pointer;box-shadow:4px 4px 16px rgba(0,0,0,.18);transition:background .2s,padding .2s}
.lp-gate-tab:hover{background:#8f3a14;padding-inline:14px}
html[data-auth=out][data-login=open] .lp-gate-tab{display:none}
html[data-auth=in] .lp-gate-tab{display:none}
@media(min-width:900px){.lp-gate-close{inset-inline-start:auto;inset-inline-end:12px}}
@media(max-width:899px){
  html body #authGate{inset:auto 0 0 0;width:auto;max-height:92vh;border-radius:22px 22px 0 0;border-right:0;box-shadow:0 -12px 40px rgba(68,46,31,.25)}
  html[data-auth=out][data-login=closed] body #authGate{transform:translateY(105%);visibility:hidden;transition:transform .3s ease,visibility 0s .3s}
  html body #authGate .auth-card{padding:56px 22px 22px}
  .lp-gate-tab{display:none!important}
}
/* استعادة كلمة المرور بعد تسجيل الدخول: تبقى نافذة وسطية */
html[data-auth=in] body #authGate{inset:0;width:auto;background:rgba(43,33,28,.55);display:grid;place-items:center;box-shadow:none;border:0}
html[data-auth=in] body #authGate .auth-card{background:#fff;width:min(430px,94vw);min-height:0;border-radius:24px;padding:28px}
html[data-auth=in] .lp-gate-close{display:none}
`;

  function injectCss() {
    if (document.getElementById('landing-style')) return;
    const st = document.createElement('style'); st.id = 'landing-style'; st.textContent = CSS; document.head.appendChild(st);
  }

  // ───────────── البيانات ─────────────
  const readCache = () => { try { return JSON.parse(localStorage.getItem(SETTINGS_CACHE) || '{}'); } catch { return {}; } };
  async function loadSettings() {
    const {data, error} = await db.from('platform_settings').select('key,value');
    if (error) return null;
    const s = {}; (data || []).forEach(r => { if (r.value) s[r.key] = r.value; });
    return s;
  }
  async function loadBanners() {
    const {data, error} = await db.from('platform_banners').select('title,body,image_url,link_url,cta_label').order('sort_order').order('created_at').limit(8);
    if (error || !data?.length) return null; // جدول غير موجود أو لا إعلانات فعّالة: نعرض الافتراضي
    return data.map(b => ({title: b.title, body: b.body, image: safeImg(b.image_url), link: safeHttps(b.link_url), cta: b.cta_label}));
  }

  // ───────────── البناء ─────────────
  function goalsFrom(s) { const l = String(s.goals || '').split('\n').map(x => x.trim()).filter(Boolean); return l.length ? l : DEFAULT_GOALS; }

  function build(s) {
    const el = mk('div', 'lp'); el.id = 'landing';
    el.innerHTML = `
      <a class="lp-skip" href="#lp-main">تخطي إلى المحتوى</a>
      <header class="lp-header">
        <a class="lp-brand" href="#top"><img src="assets/logo.svg" alt="" data-brand-logo /><span><h1 class="lp-h1" data-brand="platform_name">منصة الاجتماعات</h1><small data-brand="org_name">جمعية الإحسان للخدمات الاجتماعية</small></span></a>
        <nav class="lp-nav" aria-label="أقسام الصفحة"><a href="#lp-goals">الأهداف</a><a href="#lp-vision">الرؤية</a><a href="#lp-mission">الرسالة</a><a href="#lp-contact">تواصل معنا</a></nav>
        ${inApp ? '<button class="lp-login-btn" id="lpLoginBtn" type="button">الدخول إلى المنصة</button>' : '<button class="lp-login-btn" id="lpLoginBtn" type="button" aria-controls="authGate" aria-expanded="false">تسجيل الدخول</button>'}
      </header>
      <main id="lp-main">
        <section class="lp-hero" id="top" aria-roledescription="carousel" aria-label="الإعلانات والأخبار"></section>
        <section class="lp-sec reveal" id="lp-goals" aria-labelledby="lp-goals-h"><h2 id="lp-goals-h">أهدافنا</h2><p class="lp-lead">ما نعمل على تحقيقه عبر هذه المنصة.</p><div class="lp-goals" id="lpGoals"></div></section>
        <section class="lp-sec reveal" id="lp-vision" aria-label="الرؤية والرسالة"><div class="lp-vm">
          <article class="lp-card vision"><div class="lp-ico" aria-hidden="true">◉</div><h3>رؤيتنا</h3><p class="big" id="lpVision"></p></article>
          <article class="lp-card" id="lp-mission"><div class="lp-ico" aria-hidden="true">➜</div><h3>رسالتنا</h3><p class="big" id="lpMission"></p></article>
        </div></section>
        <section class="lp-cta reveal" aria-label="الدخول إلى المنصة"><div><h2>${inApp ? 'مساحة عملك بانتظارك' : 'هل أنت عضو في المجلس أو إحدى اللجان؟'}</h2><p>${inApp ? 'ارجع إلى المنصة لمتابعة اجتماعاتك ومحاضرك ومهامك.' : 'سجّل دخولك لتصل إلى اجتماعاتك ومحاضرك ومهامك.'}</p></div><button class="lp-btn solid" id="lpCta" type="button">${inApp ? 'الدخول إلى المنصة' : 'تسجيل الدخول'}</button></section>
      </main>
      <footer class="lp-foot" id="lp-contact"><div class="lp-foot-in" id="lpFoot"></div><small>© <span id="lpYear"></span> <span data-brand="org_name">جمعية الإحسان للخدمات الاجتماعية</span></small><small class="lp-credit">تصميم الموقع من إعداد محمد ناجي</small></footer>`;
    document.body.prepend(el);
    el.querySelector('#lpYear').textContent = new Date().getFullYear();
    paintContent(s);
    return el;
  }

  function paintContent(s) {
    $('#lpVision').textContent = s.vision || DEFAULT_VISION;
    $('#lpMission').textContent = s.mission || DEFAULT_MISSION;
    $('#lpGoals').replaceChildren(...goalsFrom(s).map((g, i) => {
      const c = mk('article', 'lp-card'); const ic = mk('div', 'lp-ico', GOAL_ICONS[i % GOAL_ICONS.length]); ic.setAttribute('aria-hidden', 'true');
      c.append(ic, mk('p', '', g)); return c;
    }));
    const f = $('#lpFoot'), parts = [];
    const about = mk('div'); about.style.maxWidth = '420px'; about.append(mk('h3', '', 'من نحن'), mk('p', '', s.about || 'منصة لإدارة اجتماعات المجالس واللجان وتوثيق قراراتها.'));
    parts.push(about);
    // بيانات التواصل (يتحكم بها المدير من "بيانات المنصة")؛ تُعرض روابط قابلة للنقر وبنصوص آمنة فقط
    const digits = v => String(v || '').replace(/[^\d+]/g, '');
    const web = safeHttps(s.contact_website);
    const contact = [];
    const add = (label, text, href, ext) => contact.push({label, text, href, ext});
    if (s.contact_phone && digits(s.contact_phone)) add('الجوال', s.contact_phone, 'tel:' + digits(s.contact_phone));
    if (s.contact_whatsapp && /^\+?\d{9,15}$/.test(digits(s.contact_whatsapp))) add('واتساب', digits(s.contact_whatsapp).replace(/^\+/, ''), 'https://wa.me/' + digits(s.contact_whatsapp).replace(/^\+/, ''), true);
    if (s.contact_email && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s.contact_email)) add('البريد', s.contact_email, 'mailto:' + s.contact_email);
    if (web) add('الموقع', s.contact_website, web, true);
    if (s.contact_address) add('العنوان', s.contact_address);
    if (s.contact_hours) add('ساعات العمل', s.contact_hours);
    if (s.license_no) add('رقم الترخيص', s.license_no);
    if (contact.length) {
      const c = mk('div'); c.append(mk('h3', '', 'تواصل معنا'));
      const ul = mk('ul');
      contact.forEach(({label, text, href, ext}) => {
        const li = mk('li'); li.append(mk('span', 'lp-lbl', label + ': '));
        if (href) { const a = mk('a', '', text); a.href = href; if (ext) { a.target = '_blank'; a.rel = 'noopener noreferrer'; } if (label === 'الجوال' || label === 'واتساب') a.dir = 'ltr'; li.append(a); } else li.append(document.createTextNode(text));
        ul.append(li);
      });
      c.append(ul); parts.push(c);
    }
    const social = [['social_x', 'X'], ['social_linkedin', 'LinkedIn'], ['social_instagram', 'Instagram'], ['social_youtube', 'YouTube']].filter(([k]) => safeHttps(s[k]));
    if (social.length) {
      const c = mk('div'); c.append(mk('h3', '', 'تابعنا')); const ul = mk('ul');
      social.forEach(([k, n]) => { const li = mk('li'), a = mk('a', '', n); a.href = safeHttps(s[k]); a.target = '_blank'; a.rel = 'noopener noreferrer'; li.append(a); ul.append(li); });
      c.append(ul); parts.push(c);
    }
    f.replaceChildren(...parts);
  }

  const $ = s => document.querySelector(s);

  // ───────────── البنر ─────────────
  let prevIdx = -1, slides = [], idx = 0, elapsed = 0, ticker = null, userPaused = false, hovering = false, offscreen = false, hero = null, heroBound = false;
  const two = n => String(n).padStart(2, '0');

  // ───────────── وضع ثلاثي الأبعاد (تجريبي) ─────────────
  // الافتراضي: يعمل على الشاشات الواسعة لمن لا يفضّلون تقليل الحركة؛ زر 3D يوقفه ويحفظ الاختيار في المتصفح
  const KEY_3D = 'ehsan_banner_3d';
  const can3d = () => wide() && !reduced();
  function want3d() {
    let v = null; try { v = localStorage.getItem(KEY_3D); } catch { /* غير متاح */ }
    return can3d() && v !== 'off';
  }
  function set3d(on, remember) {
    on = on && can3d();
    hero.classList.toggle('lp-3d', on);
    const b = document.getElementById('lp3d'); if (b) b.setAttribute('aria-pressed', String(on));
    if (remember) { try { localStorage.setItem(KEY_3D, on ? 'on' : 'off'); } catch { /* غير متاح */ } }
  }
  const SHEET_ICONS = [['▤', '⚖', '✓'], ['◫', '▤', '✓'], ['✦', '⚖', '✓']];
  function buildStack(i) {
    const st = mk('div', 'lp-stack'); st.setAttribute('aria-hidden', 'true');
    const inner = mk('div', 'lp-stack-in');
    if (i === 0) { // الشريحة الأولى: شعار الجمعية بطبقات متراكبة في العمق
      st.classList.add('lp-logo3d');
      [0, 1, 2, 3, 4].forEach(k => {
        const l = mk('div', 'lp-logo-l l' + k), im = mk('img'); im.src = 'assets/logo-mark.webp'; im.alt = ''; im.decoding = 'async';
        l.append(im); inner.append(l);
      });
      st.append(inner); return st;
    }
    SHEET_ICONS[i % SHEET_ICONS.length].forEach((g, k) => {
      const sh = mk('div', 'lp-sheet s' + (k + 1));
      sh.append(mk('i', '', g), mk('b'), mk('b', 'm'), mk('b', 'k'));
      inner.append(sh);
    });
    st.append(inner); return st;
  }
  try { window.matchMedia('(min-width: 900px)').addEventListener('change', () => { if (hero) set3d(want3d(), false); }); } catch { /* متصفح قديم */ }

  function paintSlides(list, s) {
    slides = list.map(x => ({...x}));
    if (!list.length) slides = DEFAULT_SLIDES.map(x => ({...x}));
    // إن ضبط المدير عبارة ترحيبية في بيانات المنصة فهي عنوان الشريحة الأولى الافتراضية
    if (!list.length && s.home_title) { slides[0].title = s.home_title; if (s.home_text) slides[0].body = s.home_text; }
    idx = Math.min(idx, slides.length - 1); elapsed = 0;
    hero.replaceChildren();
    slides.forEach((sl, i) => {
      const a = mk('article', 'lp-slide' + (i === idx ? ' on' : '')); a.setAttribute('role', 'group'); a.setAttribute('aria-roledescription', 'slide'); a.setAttribute('aria-label', `${i + 1} من ${slides.length}`);
      // طبقة الخلفية (تدرج أو صورة) تتحرك ببطء (Ken Burns)، وفوقها أشكال عائمة تتأثر بحركة المؤشر
      const bg = mk('div', 'lp-bg v' + (i % 3));
      if (sl.image) {
        const img = mk('img'); img.alt = ''; img.decoding = 'async';
        img.dataset.src = sl.image; if (i === idx || i === 0) img.src = sl.image; // الصورة الحالية فورًا والبقية قبل ظهورها بشريحة
        bg.append(img);
      }
      a.append(bg);
      if (sl.image) a.append(mk('div', 'lp-shade'));
      const deco = mk('div', 'lp-deco'); deco.setAttribute('aria-hidden', 'true');
      ['o1', 'o2', 'o3'].forEach(c => deco.append(mk('i', 'lp-orb ' + c)));
      a.append(deco);
      a.append(buildStack(i)); // مجسّم أوراق ثلاثي الأبعاد زخرفي (يظهر في وضع 3D فقط)
      const body = mk('div', 'lp-slide-body');
      body.append(mk('span', 'lp-kicker', i === 0 && !list.length ? 'مرحبًا بكم' : ''), mk('h2', '', sl.title));
      if (sl.body) body.append(mk('p', '', sl.body));
      // في وضع المستخدم المسجّل يتحول زر "تسجيل الدخول" الافتراضي إلى "الدخول إلى المنصة"
      const label = (inApp && sl.cta === 'تسجيل الدخول' ? 'الدخول إلى المنصة' : sl.cta) || (sl.link ? 'اعرف المزيد' : '');
      if (label) {
        const link = sl.link;
        const b = link && !link.startsWith('#') ? Object.assign(mk('a', 'lp-btn', label), {href: link, target: '_blank', rel: 'noopener noreferrer'}) : Object.assign(mk('a', 'lp-btn', label), {href: link || '#authGate'});
        if (!link || link === '#authGate') b.addEventListener('click', e => { e.preventDefault(); if (inApp) showApp(); else setLogin('open', true); });
        body.append(b);
      }
      a.append(body); hero.append(a);
    });
    if (slides.length > 1) {
      const count = mk('div', 'lp-count'); count.setAttribute('aria-hidden', 'true'); hero.append(count);
      const prog = mk('div', 'lp-progress'); prog.setAttribute('aria-hidden', 'true'); prog.append(mk('i')); hero.append(prog);
      const ctrl = mk('div', 'lp-ctrl');
      const prev = mk('button', 'lp-arrow', 'السابق'); prev.type = 'button'; prev.setAttribute('aria-label', 'الإعلان السابق');
      const dots = mk('div', 'lp-dots');
      slides.forEach((_, i) => { const d = mk('button', 'lp-dot'); d.type = 'button'; d.setAttribute('aria-label', `الانتقال إلى الإعلان ${i + 1}`); d.addEventListener('click', () => go(i)); dots.append(d); });
      const next = mk('button', 'lp-arrow', 'التالي'); next.type = 'button'; next.setAttribute('aria-label', 'الإعلان التالي');
      userPaused = reduced(); // لمن يفضّلون تقليل الحركة: لا تشغيل تلقائي حتى يطلبوه
      const pause = mk('button', 'lp-pause', userPaused ? 'تشغيل' : 'إيقاف'); pause.type = 'button'; pause.id = 'lpPause'; pause.setAttribute('aria-label', 'إيقاف أو تشغيل التبديل التلقائي');
      prev.addEventListener('click', () => go(idx - 1)); next.addEventListener('click', () => go(idx + 1));
      pause.addEventListener('click', () => { userPaused = !userPaused; pause.textContent = userPaused ? 'تشغيل' : 'إيقاف'; hero.classList.toggle('lp-still', userPaused); });
      const b3 = mk('button', 'lp-3dbtn', '3D'); b3.type = 'button'; b3.id = 'lp3d'; b3.setAttribute('aria-label', 'تشغيل أو إيقاف المؤثرات ثلاثية الأبعاد');
      b3.addEventListener('click', () => { set3d(!hero.classList.contains('lp-3d'), true); });
      ctrl.append(prev, dots, next, pause, b3); hero.append(ctrl);
      hero.classList.toggle('lp-still', userPaused);
      set3d(want3d(), false);
      bindHeroOnce();
      startTicker();
    }
    mark();
  }

  // مؤقّت واحد بخطوة 100ms: يتقدّم فقط حين لا يكون البنر موقوفًا أو مُحوَّمًا عليه أو خارج الشاشة، فيتزامن شريط التقدم مع التبديل
  function setProg(r) { const i = hero?.querySelector('.lp-progress i'); if (i) i.style.transform = `scaleX(${Math.min(1, r)})`; }
  function startTicker() {
    clearInterval(ticker); elapsed = 0; setProg(0);
    ticker = setInterval(() => {
      if (userPaused || hovering || offscreen || document.hidden) return;
      elapsed += 100; setProg(elapsed / AUTOPLAY_MS);
      if (elapsed >= AUTOPLAY_MS) go(idx + 1);
    }, 100);
  }

  // مستمعات البنر تُربط مرة واحدة فقط (يُعاد رسم الشرائح بعد وصول الإعلانات من القاعدة)
  function bindHeroOnce() {
    if (heroBound) return;
    heroBound = true;
    hero.addEventListener('mouseenter', () => { hovering = true; hero.classList.add('lp-hover'); }); hero.addEventListener('mouseleave', () => { hovering = false; hero.classList.remove('lp-hover'); });
    hero.addEventListener('focusin', () => { hovering = true; }); hero.addEventListener('focusout', () => { hovering = false; });
    let x0 = null;
    hero.addEventListener('pointerdown', e => { if (!e.target.closest('button,a')) x0 = e.clientX; });
    hero.addEventListener('pointerup', e => { if (x0 === null) return; const dx = e.clientX - x0; x0 = null; if (Math.abs(dx) > 60) go(idx + (dx < 0 ? 1 : -1)); });
    // تأثير بارالاكس خفيف للأشكال العائمة مع حركة المؤشر (سطح المكتب فقط وبلا تقليل حركة)
    if (!reduced() && wide()) {
      let raf = 0, nx = 0, ny = 0;
      hero.addEventListener('pointermove', e => {
        const r = hero.getBoundingClientRect(); nx = ((e.clientX - r.left) / r.width - .5) * 2; ny = ((e.clientY - r.top) / r.height - .5) * 2;
        if (!raf) raf = requestAnimationFrame(() => { raf = 0; hero.style.setProperty('--px', nx.toFixed(3)); hero.style.setProperty('--py', ny.toFixed(3)); });
      });
      hero.addEventListener('pointerleave', () => { hero.style.setProperty('--px', '0'); hero.style.setProperty('--py', '0'); });
    }
    // خارج الشاشة: توقف التبديل والحركات (توفير للمعالج والبطارية)
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([en]) => { offscreen = !en.isIntersecting; hero.classList.toggle('lp-off', offscreen); }, {threshold: .05}).observe(hero);
    }
  }

  function mark() {
    const els = hero.querySelectorAll('.lp-slide');
    els.forEach((s, i) => {
      s.classList.toggle('on', i === idx);
      s.classList.toggle('out', i === prevIdx && prevIdx !== idx); // الشريحة السابقة تدور للخارج في وضع 3D
      s.setAttribute('aria-hidden', String(i !== idx));
      s.querySelectorAll('a,button').forEach(b => { b.tabIndex = i === idx ? 0 : -1; });
    });
    hero.querySelectorAll('.lp-dot').forEach((d, i) => { d.setAttribute('aria-current', String(i === idx)); });
    const c = hero.querySelector('.lp-count');
    if (c) c.innerHTML = `<b>${two(idx + 1)}</b> / ${two(slides.length)}`; // أرقام فقط، آمن
    // نحمّل صورة الشريحة الحالية والتالية فقط، لتقليل استهلاك الشبكة
    [els[idx], els[(idx + 1) % slides.length]].forEach(el => { const im = el?.querySelector('img[data-src]'); if (im && !im.src) im.src = im.dataset.src; });
  }
  function go(n) {
    prevIdx = idx; idx = (n + slides.length) % slides.length; elapsed = 0; setProg(0); mark();
  }

  // ───────────── لوحة الدخول ─────────────
  function setLogin(state, focus) {
    root.dataset.login = state;
    $('#lpLoginBtn')?.setAttribute('aria-expanded', String(state === 'open'));
    try { sessionStorage.setItem('ehsan_login_panel', state); } catch { /* غير متاح */ }
    if (state === 'open' && focus) setTimeout(() => document.querySelector('#authGate input')?.focus(), 320);
  }

  function enhanceGate(gate) {
    if (!gate.querySelector('.lp-gate-close')) {
      const close = mk('button', 'lp-gate-close', '✕'); close.type = 'button'; close.setAttribute('aria-label', 'إغلاق لوحة الدخول');
      close.addEventListener('click', () => setLogin('closed'));
      gate.querySelector('.auth-card')?.prepend(close);
    }
    const form = gate.querySelector('#authForm');
    if (!form) return;
    // إظهار/إخفاء كلمة المرور + تنبيه Caps Lock + autocomplete صحيح
    form.querySelectorAll('input[type=password]').forEach(inp => {
      if (inp.closest('.lp-pw')) return;
      const signup = !!form.querySelector('input[name=full_name]');
      inp.autocomplete = signup || inp.name === 'confirm' ? 'new-password' : 'current-password';
      const wrap = mk('span', 'lp-pw'); inp.replaceWith(wrap); wrap.append(inp);
      const t = mk('button', '', 'إظهار'); t.type = 'button'; t.setAttribute('aria-label', 'إظهار كلمة المرور');
      t.addEventListener('click', () => { const show = inp.type === 'password'; inp.type = show ? 'text' : 'password'; t.textContent = show ? 'إخفاء' : 'إظهار'; t.setAttribute('aria-label', show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'); });
      const caps = mk('p', 'lp-caps'); caps.hidden = true; caps.textContent = 'مفتاح Caps Lock مفعّل';
      inp.addEventListener('keyup', e => { caps.hidden = !(e.getModifierState && e.getModifierState('CapsLock')); });
      inp.addEventListener('blur', () => { caps.hidden = true; });
      wrap.append(t); wrap.after(caps);
    });
    form.querySelectorAll('input[type=email]').forEach(i => { i.autocomplete = 'username'; i.autocapitalize = 'off'; i.spellcheck = false; });
    // الدخول الاجتماعي: يظهر فقط للمزوّدين المفعّلين في supabase-config.js (oauthProviders) وفي لوحة Supabase
    const card = gate.querySelector('.auth-card');
    if (card && !card.querySelector('.lp-oauth') && Array.isArray(cfg.oauthProviders) && cfg.oauthProviders.length) {
      const names = {google: 'Google', azure: 'Microsoft', apple: 'Apple', github: 'GitHub'};
      const box = mk('div', 'lp-oauth'); box.append(mk('div', 'sep', 'أو'));
      cfg.oauthProviders.filter(p => names[p]).forEach(p => {
        const b = mk('button', '', `المتابعة عبر ${names[p]}`); b.type = 'button';
        b.addEventListener('click', async () => {
          b.disabled = true;
          const {error} = await db.auth.signInWithOAuth({provider: p, options: {redirectTo: location.origin + location.pathname}});
          if (error) { const m = card.querySelector('#authMsg'); if (m) m.textContent = 'تعذر الدخول عبر ' + names[p] + '. تأكد أن حسابك مصرّح له.'; b.disabled = false; }
        });
        box.append(b);
      });
      card.insertBefore(box, card.querySelector('.auth-links'));
    }
    if (card && !card.querySelector('.lp-secure')) card.append(Object.assign(mk('p', 'lp-secure'), {textContent: 'للأعضاء المصرّح لهم فقط. لا تشارك كلمة المرور مع أحد، وتأكد من عنوان الموقع قبل الدخول.'}));
    const msg = card?.querySelector('#authMsg');
    if (msg) { msg.setAttribute('role', 'alert'); msg.setAttribute('aria-live', 'assertive'); }
  }

  function dockLoginPanel() {
    let saved = null; try { saved = sessionStorage.getItem('ehsan_login_panel'); } catch { /* غير متاح */ }
    setLogin(saved || (wide() ? 'open' : 'closed'));
    const tab = mk('button', 'lp-gate-tab', 'تسجيل الدخول'); tab.type = 'button'; tab.setAttribute('aria-controls', 'authGate');
    tab.addEventListener('click', () => setLogin('open', true));
    document.body.append(tab);
    const toggle = () => setLogin(root.dataset.login === 'open' ? 'closed' : 'open', true);
    $('#lpLoginBtn').addEventListener('click', toggle);
    $('#lpCta').addEventListener('click', () => setLogin('open', true));
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !wide() && root.dataset.login === 'open') setLogin('closed'); });
    const watch = () => { const g = $('#authGate'); if (g) enhanceGate(g); };
    new MutationObserver(watch).observe(document.body, {childList: true, subtree: true});
    watch();
  }

  function reveal() {
    const els = document.querySelectorAll('.lp .reveal');
    if (!('IntersectionObserver' in window) || reduced()) { els.forEach(e => e.classList.add('in')); return; }
    const io = new IntersectionObserver(es => es.forEach(x => { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); } }), {threshold: .12});
    els.forEach(e => io.observe(e));
  }

  // ───────────── المستخدم المسجّل: "الصفحة الرئيسية" تفتح الصفحة العامة ─────────────
  // الزر الجانبي المعلَّم data-site-home وشعار المنصة يفتحان الصفحة العامة (بنر، أهداف، رؤية، رسالة، تواصل)،
  // وزر "الدخول إلى المنصة" يرجع لآخر صفحة كان فيها. ملخص المستخدم القديم يبقى في "مساحة العضو ◂ ملخصي".
  function currentView() { return document.querySelector('.view.active')?.id.replace(/^view-/, '') || 'home'; }

  async function openSiteHome() {
    if (!siteBuilt) {
      siteBuilt = true;
      const cached = readCache();
      build(cached);
      hero = $('#top');
      paintSlides([], cached);
      reveal();
      $('#lpLoginBtn').addEventListener('click', showApp);
      $('#lpCta').addEventListener('click', showApp);
      Promise.all([loadSettings(), loadBanners()]).then(([s, banners]) => {
        const settings = s || cached;
        paintContent(settings);
        paintSlides(banners || [], settings);
      }).catch(err => console.error('landing', err));
    }
    root.dataset.auth = 'home';
    window.scrollTo(0, 0);
  }

  function showApp() {
    root.dataset.auth = 'in';
    window.ehsanActivateView?.(lastView);
    window.scrollTo(0, 0);
  }

  function bindSiteHome() {
    // نسجّل الصفحة الحالية قبل أن يعالج nav-fix.js النقرة (pointerdown/keydown يسبقان click)
    const rec = () => { const v = currentView(); if (root.dataset.auth === 'in' && v) lastView = v; };
    document.addEventListener('pointerdown', rec, true);
    document.addEventListener('keydown', rec, true);
    document.addEventListener('click', e => {
      if (root.dataset.auth !== 'in') return;
      if (!e.target.closest('[data-site-home], .brand-box')) return;
      e.preventDefault(); e.stopPropagation();
      // زر القائمة لا يغيّر الصفحة الداخلية (nav-fix يتجاهله)، فالصفحة الحالية هي التي نعود إليها
      if (e.target.closest('[data-site-home]')) lastView = currentView();
      openSiteHome();
    }, true);
    document.addEventListener('keydown', e => {
      if (root.dataset.auth !== 'in' || (e.key !== 'Enter' && e.key !== ' ')) return;
      if (!e.target.closest('.brand-box')) return;
      e.preventDefault(); e.stopPropagation();
      openSiteHome();
    }, true);
    window.ehsanShowSiteHome = openSiteHome;
  }

  async function start() {
    injectCss();
    const {data: {session}} = await db.auth.getSession();
    if (session) { inApp = true; root.dataset.auth = 'in'; bindSiteHome(); return; }
    root.dataset.auth = 'out';
    const cached = readCache();
    build(cached);
    hero = $('#top');
    paintSlides([], cached);
    reveal();
    dockLoginPanel();
    const [s, banners] = await Promise.all([loadSettings(), loadBanners()]);
    const settings = s || cached;
    paintContent(settings);
    paintSlides(banners || [], settings);
  }
  start().catch(err => { console.error('landing', err); root.dataset.auth = 'in'; });
})();
