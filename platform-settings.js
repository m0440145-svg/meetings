(() => {
  // بيانات المنصة (الاسم والشعار والأهداف ومن نحن...) تُحفظ في جدول platform_settings ويعدّلها المدير يدويًا من شاشة "بيانات المنصة".
  // أي حقل فارغ يبقى كما هو في index.html، فلا يتغير شيء حتى يحفظ المدير قيمة.
  const $ = s => document.querySelector(s);
  const toast = m => window.showToast ? window.showToast(m) : alert(m);
  const CACHE_KEY = 'ehsan_platform_settings_v1';
  const IMAGE_KEYS = ['logo_url', 'logo2_url', 'favicon_url'];
  const HTTPS_KEYS = ['contact_website', 'privacy_url', 'terms_url', 'social_x', 'social_linkedin', 'social_instagram', 'social_youtube'];
  const SOCIAL = [['social_x', 'X'], ['social_linkedin', 'LinkedIn'], ['social_instagram', 'Instagram'], ['social_youtube', 'YouTube']];
  const TEXT_KEYS = ['platform_name', 'org_name', 'home_eyebrow', 'home_title', 'home_text', 'about', 'vision', 'mission', 'goals',
    'contact_email', 'contact_phone', 'contact_address', 'contact_whatsapp', 'contact_hours', 'support_email', 'footer_text', 'license_no', 'chair_name', 'chair_title', 'secretary_name', 'secretary_title'];
  const ALL_KEYS = [...TEXT_KEYS, ...HTTPS_KEYS, ...IMAGE_KEYS, 'primary_color', 'accent_color'];
  const MAX = {platform_name: 80, org_name: 120, home_eyebrow: 120, home_title: 160, home_text: 600, about: 2000, vision: 800, mission: 800, goals: 2000,
    contact_email: 120, contact_phone: 40, contact_address: 200, contact_whatsapp: 20, contact_hours: 120, contact_website: 200, privacy_url: 300, terms_url: 300, support_email: 120, footer_text: 160, logo_url: 500, logo2_url: 500, favicon_url: 500,
    license_no: 60, chair_name: 100, chair_title: 100, secretary_name: 100, secretary_title: 100, social_x: 200, social_linkedin: 200, social_instagram: 200, social_youtube: 200};
  const MAX_LOGO_BYTES = 2 * 1024 * 1024;
  const LOGO_TYPES = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp'};

  let settings = {}, db = null, defaults = null;

  const safeHttps = u => { try { const x = new URL(u); return x.protocol === 'https:' ? x.href : ''; } catch { return ''; } };
  const safeLogo = u => u && (u.startsWith('assets/') ? u : safeHttps(u));
  const hex = v => /^#[0-9a-fA-F]{6}$/.test(v || '') ? v : '';
  const readCache = () => { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; } };
  const writeCache = v => { try { localStorage.setItem(CACHE_KEY, JSON.stringify(v)); } catch { /* التخزين المحلي غير متاح */ } };

  // كل النصوص تُكتب بـ textContent فقط، فلا يمكن حقن HTML من هذه الشاشة
  function apply() {
    applyBrand();
    renderAbout();
  }

  // تُستدعى أيضًا من MutationObserver، لذلك لا تكتب في DOM إلا عند اختلاف القيمة (وإلا تدور في حلقة)
  function applyBrand() {
    const s = settings;
    document.querySelectorAll('[data-brand]').forEach(el => {
      const v = s[el.dataset.brand];
      if (el.dataset.defaultText === undefined && v) el.dataset.defaultText = el.textContent;
      const target = v || el.dataset.defaultText; // حذف القيمة يعيد النص الأصلي
      if (target !== undefined && el.textContent !== target) el.textContent = target;
    });
    const logo = safeLogo(s.logo_url);
    document.querySelectorAll('[data-brand-logo]').forEach(img => {
      if (img.dataset.defaultSrc === undefined) img.dataset.defaultSrc = img.getAttribute('src') || '';
      const want = logo || img.dataset.defaultSrc;
      if (want && img.getAttribute('src') !== want) img.src = want;
    });
    const logo2 = safeLogo(s.logo2_url), l2 = document.getElementById('aboutLogo2');
    if (l2) { if (logo2 && l2.getAttribute('src') !== logo2) l2.src = logo2; l2.hidden = !logo2; }
    const fav = safeLogo(s.favicon_url);
    if (fav) {
      let link = document.querySelector('link[rel~="icon"]');
      if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.append(link); }
      if (link.getAttribute('href') !== fav) link.href = fav;
    }
    const root = document.documentElement.style;
    ['primary', 'accent'].forEach(k => { const c = hex(s[k + '_color']); if (c) root.setProperty('--' + k, c); else root.removeProperty('--' + k); });
    if (s.platform_name || s.org_name) document.title = [s.platform_name || 'ميثاق', s.org_name || 'جمعية الإحسان'].join(' | ');
  }

  function renderAbout() {
    const goals = $('#goalsList');
    if (goals) {
      goals.replaceChildren(...String(settings.goals || '').split('\n').map(x => x.trim()).filter(Boolean).map(t => { const li = document.createElement('li'); li.textContent = t; return li; }));
      if (!goals.children.length) { const li = document.createElement('li'); li.textContent = 'لم تُضف أهداف بعد.'; goals.append(li); }
    }
    const item = (label, value, linkable) => {
      const d = document.createElement('div'); d.className = 'list-item';
      const b = document.createElement('strong'); b.textContent = label + ': ';
      d.append(b);
      const url = linkable ? safeHttps(value) : '';
      if (url) { const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = value; d.append(a); } else d.append(document.createTextNode(value));
      return d;
    };
    const fill = (box, rows, empty) => {
      if (!box) return;
      box.replaceChildren(...rows);
      if (!rows.length) { const d = document.createElement('div'); d.className = 'list-item'; d.textContent = empty; box.append(d); }
    };
    const s = settings;
    fill($('#contactList'), [
      ...[['البريد الإلكتروني', s.contact_email], ['الجوال', s.contact_phone], ['واتساب', s.contact_whatsapp], ['ساعات العمل', s.contact_hours], ['العنوان', s.contact_address]].filter(r => r[1]).map(([k, v]) => item(k, v, false)),
      ...[['الموقع الإلكتروني', s.contact_website], ...SOCIAL.map(([key, name]) => [name, s[key]])].filter(r => r[1]).map(([k, v]) => item(k, v, true))
    ], 'لم تُضف بيانات تواصل بعد.');
    fill($('#orgInfoList'), [
      s.license_no && item('رقم الترخيص / السجل', s.license_no, false),
      s.chair_name && item(s.chair_title || 'رئيس مجلس الإدارة', s.chair_name, false),
      s.secretary_name && item(s.secretary_title || 'أمين السر', s.secretary_name, false)
    ].filter(Boolean), 'لم تُضف بيانات الجهة بعد.');
    ['aboutText', 'visionText', 'missionText'].forEach(id => { const el = document.getElementById(id); if (el && !el.textContent) el.textContent = 'لم يُضف نص بعد.'; });
  }

  async function fetchSettings() {
    const {data, error} = await db.from('platform_settings').select('key,value');
    if (error) { console.warn('platform_settings:', error.message); return false; }
    const next = {};
    (data || []).forEach(r => { if (ALL_KEYS.includes(r.key) && r.value) next[r.key] = r.value; });
    settings = next;
    writeCache(next);
    apply();
    return true;
  }

  // يحفظ ما تعرضه الصفحة حاليًا كقيم افتراضية للنموذج عند عدم وجود قيمة محفوظة
  function captureDefaults() {
    if (defaults) return;
    defaults = {};
    document.querySelectorAll('[data-brand]').forEach(el => { defaults[el.dataset.brand] = (el.dataset.defaultText ?? el.textContent).trim(); });
    ['about', 'vision', 'mission'].forEach(k => { defaults[k] = ''; }); // لا نملأ النموذج بنص "لم يُضف نص بعد"
    const logoEl = $('[data-brand-logo]');
    defaults.logo_url = logoEl?.dataset.defaultSrc ?? logoEl?.getAttribute('src') ?? '';
    const cs = getComputedStyle(document.documentElement);
    defaults.primary_color = hex(cs.getPropertyValue('--primary').trim()) || '#cf6028';
    defaults.accent_color = hex(cs.getPropertyValue('--accent').trim()) || '#f18927';
  }

  function fillForm() {
    const form = $('#brandingForm');
    if (!form) return;
    captureDefaults();
    ALL_KEYS.forEach(k => { const el = form.elements[k]; if (el) el.value = settings[k] ?? defaults[k] ?? ''; });
    const prev = $('#logoPreview');
    if (prev) prev.src = safeLogo(form.elements.logo_url.value) || 'assets/logo.svg';
    previewLogo2();
  }

  function previewLogo2() {
    const p = $('#logo2Preview'), u = safeLogo($('#brandingForm')?.elements.logo2_url.value);
    if (p) { p.hidden = !u; if (u) p.src = u; }
  }

  function collect(form) {
    const out = {}, errs = [];
    ALL_KEYS.forEach(k => {
      let v = (form.elements[k]?.value || '').trim();
      if (k === 'contact_whatsapp') { v = v.replace(/[\s-]/g, ''); if (v && !/^\+?[0-9]{9,15}$/.test(v)) errs.push('رقم الواتساب: أرقام فقط مع رمز الدولة (مثل 9665XXXXXXXX)'); }
      if (MAX[k] && v.length > MAX[k]) errs.push(`الحقل "${k}" أطول من ${MAX[k]} حرفًا`);
      if (IMAGE_KEYS.includes(k) && v && !safeLogo(v)) errs.push('روابط الصور يجب أن تبدأ بـ https://');
      if (HTTPS_KEYS.includes(k) && v && !safeHttps(v)) errs.push('روابط المواقع والتواصل يجب أن تبدأ بـ https://');
      if ((k === 'primary_color' || k === 'accent_color') && v && !hex(v)) errs.push('اللون غير صالح');
      out[k] = v;
    });
    return {out, errs};
  }

  async function save(e) {
    e.preventDefault();
    const form = e.currentTarget, btn = form.querySelector('[type=submit]');
    const {out, errs} = collect(form);
    if (errs.length) return toast(errs[0]);
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      captureDefaults();
      // القيمة المطابقة للافتراضي لا تُحفظ، حتى يبقى الحقل "غير معدّل"
      const rows = [], empty = [];
      ALL_KEYS.forEach(k => { const v = out[k]; (v && v !== (defaults[k] ?? '') ? rows : empty).push(k); });
      if (rows.length) {
        const {error} = await db.from('platform_settings').upsert(rows.map(k => ({key: k, value: out[k], updated_at: new Date().toISOString()})));
        if (error) return toast('تعذر الحفظ: ' + error.message);
      }
      if (empty.length) {
        const {error} = await db.from('platform_settings').delete().in('key', empty);
        if (error) return toast('تعذر حذف الحقول الفارغة: ' + error.message);
      }
      await fetchSettings();
      fillForm();
      toast('تم حفظ بيانات المنصة');
    } finally { btn.disabled = false; }
  }

  async function reset() {
    if (!confirm('حذف كل البيانات المخصصة والعودة للنصوص الافتراضية؟')) return;
    const {error} = await db.from('platform_settings').delete().in('key', ALL_KEYS);
    if (error) return toast('تعذر الاستعادة: ' + error.message);
    settings = {}; writeCache({});
    toast('تمت الاستعادة، سيُعاد تحميل الصفحة');
    setTimeout(() => location.reload(), 800);
  }

  async function uploadLogo(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const ext = LOGO_TYPES[file.type];
    if (!ext) return toast('الصيغ المسموحة: PNG أو JPG أو WebP');
    if (file.size > MAX_LOGO_BYTES) return toast('حجم الشعار يتجاوز 2 م.ب');
    const field = e.target.dataset.target;
    if (!IMAGE_KEYS.includes(field)) return;
    const path = `${field.replace('_url', '')}-${Date.now()}.${ext}`;
    const up = await db.storage.from('branding').upload(path, file, {contentType: file.type, cacheControl: '3600'});
    if (up.error) return toast('تعذر رفع الصورة: ' + up.error.message);
    const url = db.storage.from('branding').getPublicUrl(path).data.publicUrl;
    const form = $('#brandingForm');
    form.elements[field].value = url;
    if (field === 'logo_url') $('#logoPreview').src = url;
    if (field === 'logo2_url') previewLogo2();
    toast('تم رفع الصورة، اضغط "حفظ البيانات" لاعتمادها');
  }

  async function isAdmin() {
    const {data, error} = await db.rpc('is_admin');
    return !error && data === true;
  }

  async function start() {
    settings = readCache();
    apply(); // من الكاش فورًا لتجنب وميض النص القديم
    for (let i = 0; i < 40 && !window.ehsanDB; i++) await new Promise(r => setTimeout(r, 250));
    db = window.ehsanDB;
    if (!db) return;
    await fetchSettings();
    // العناصر المنشأة لاحقًا (شاشة الدخول) تأخذ البيانات عند ظهورها
    new MutationObserver(() => applyBrand()).observe(document.body, {childList: true, subtree: true});
    const {data: {session}} = await db.auth.getSession();
    if (!session) return;
    if (!(await isAdmin())) return;
    $('#brandingNav')?.removeAttribute('hidden');
    const form = $('#brandingForm');
    if (!form) return;
    $('#brandingNote').textContent = 'اترك الحقل فارغًا أو بقيمته الافتراضية ليبقى النص الأصلي. التعديلات تظهر لجميع المستخدمين بعد الحفظ.';
    fillForm();
    form.addEventListener('submit', save);
    $('#brandingReset')?.addEventListener('click', reset);
    document.querySelectorAll('.img-upload').forEach(inp => inp.addEventListener('change', uploadLogo));
    form.elements.logo_url?.addEventListener('input', () => { const u = safeLogo(form.elements.logo_url.value); if (u) $('#logoPreview').src = u; });
    form.elements.logo2_url?.addEventListener('input', previewLogo2);
  }
  start().catch(err => console.error('platform-settings', err));
})();
