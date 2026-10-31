(() => {
  // إدارة بنرات الإعلانات في الصفحة الرئيسية (للمدير) — تظهر داخل صفحة "بيانات المنصة". الجدول: supabase/migrations/006_platform_banners.sql
  const {esc, toast, pill, empty, busy, failed, session, waitDb} = window.ehsanUI;
  const $ = s => document.querySelector(s);
  const LIMITS = {title: 80, body: 200, cta: 30};
  const TYPES = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp'};
  const MAX_BYTES = 2 * 1024 * 1024;
  const safeHttps = u => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };
  const pad = n => String(n).padStart(2, '0');
  const local = v => { if (!v) return ''; const d = new Date(v); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }; // توقيت الجهاز لحقل datetime-local
  const toIso = v => v ? new Date(v).toISOString() : null;
  let db, rows = [];

  function card() {
    const form = $('#brandingForm');
    if (!form || $('#bannersAdmin')) return $('#bannersAdmin');
    const c = document.createElement('div');
    c.id = 'bannersAdmin'; c.className = 'form-card'; c.style.marginTop = '16px';
    c.innerHTML = `<div class="card-head"><h3>إعلانات الصفحة الرئيسية (البنر المتحرك)</h3><button class="btn primary" type="button" id="bannerAdd">＋ إعلان جديد</button></div>
      <p class="meta">تظهر الإعلانات الفعّالة للزوار قبل تسجيل الدخول بالترتيب. مقاس الصورة المقترح 1600×600 بكسل (نسبة 8:3) وحجمها أقل من 2 م.ب، وتُغطّيها طبقة داكنة لضمان قراءة النص. إن لم يوجد إعلان فعّال تظهر شرائح افتراضية.</p>
      <div id="bannerList" class="list"></div>`;
    form.after(c);
    return c;
  }

  async function load() {
    const {data, error} = await db.from('platform_banners').select('*').order('sort_order').order('created_at');
    if (error) { $('#bannerList').innerHTML = empty('تعذر تحميل الإعلانات (نفّذ الترحيل 006 أولًا): ' + error.message); return failed('الإعلانات', error); }
    rows = data || [];
    const now = Date.now();
    $('#bannerList').innerHTML = rows.map(b => {
      const live = b.is_active && (!b.starts_at || new Date(b.starts_at) <= now) && (!b.ends_at || new Date(b.ends_at) >= now);
      return `<div class="list-item"><strong>${esc(b.title)}</strong> ${pill(live ? 'ساري' : b.is_active ? 'مجدول' : 'ملغى')}<div class="meta"><span>الترتيب: ${esc(b.sort_order)}</span>${b.starts_at ? `<span>من ${esc(new Date(b.starts_at).toLocaleDateString('ar-SA'))}</span>` : ''}${b.ends_at ? `<span>إلى ${esc(new Date(b.ends_at).toLocaleDateString('ar-SA'))}</span>` : ''}</div>${b.body ? `<p>${esc(b.body)}</p>` : ''}<div class="item-actions"><button class="btn small ghost banner-edit" data-id="${b.id}">تعديل</button><button class="btn small ghost banner-toggle" data-id="${b.id}">${b.is_active ? 'إيقاف' : 'تفعيل'}</button><button class="btn small ghost banner-del" data-id="${b.id}">حذف</button></div></div>`;
    }).join('') || empty('لا توجد إعلانات؛ تظهر الشرائح الافتراضية للزوار.');
  }

  function openForm(b) {
    window.openModal?.(b ? 'تعديل إعلان' : 'إعلان جديد', `
      <label>العنوان (حتى ${LIMITS.title} حرفًا)<input id="mf_btitle" maxlength="${LIMITS.title}" value="${esc(b?.title || '')}" /></label>
      <label>النص (حتى ${LIMITS.body} حرف)<textarea id="mf_bbody" rows="2" maxlength="${LIMITS.body}">${esc(b?.body || '')}</textarea></label>
      <label>صورة الخلفية: رابط https<input id="mf_bimg" maxlength="500" placeholder="https://..." value="${esc(b?.image_url || '')}" /></label>
      <label>أو ارفع صورة PNG/JPG/WebP<input id="mf_bfile" type="file" accept="image/png,image/jpeg,image/webp" /></label>
      <label>رابط الزر (https، اختياري)<input id="mf_blink" maxlength="500" placeholder="https://..." value="${esc(b?.link_url || '')}" /></label>
      <label>نص الزر (اختياري)<input id="mf_bcta" maxlength="${LIMITS.cta}" value="${esc(b?.cta_label || '')}" /></label>
      <label>الترتيب (0 يظهر أولًا)<input id="mf_bord" type="number" min="0" max="999" value="${esc(b?.sort_order ?? 0)}" /></label>
      <label>يبدأ في (اختياري)<input id="mf_bstart" type="datetime-local" value="${esc(local(b?.starts_at))}" /></label>
      <label>ينتهي في (اختياري)<input id="mf_bend" type="datetime-local" value="${esc(local(b?.ends_at))}" /></label>`,
      async () => {
        // تُقرأ القيم كلها قبل أي await لأن النافذة تُغلق بعد الضغط على حفظ
        const v = id => document.querySelector('#' + id);
        const file = v('mf_bfile').files?.[0];
        const row = {
          title: v('mf_btitle').value.trim(), body: v('mf_bbody').value.trim(), image_url: v('mf_bimg').value.trim() || null,
          link_url: v('mf_blink').value.trim() || null, cta_label: v('mf_bcta').value.trim(),
          sort_order: Math.max(0, Math.min(999, parseInt(v('mf_bord').value, 10) || 0)), starts_at: toIso(v('mf_bstart').value), ends_at: toIso(v('mf_bend').value)
        };
        if (!row.title) return toast('أدخل عنوان الإعلان');
        if (row.image_url && !safeHttps(row.image_url)) return toast('رابط الصورة يجب أن يبدأ بـ https://');
        if (row.link_url && !safeHttps(row.link_url)) return toast('رابط الزر يجب أن يبدأ بـ https://');
        if (row.starts_at && row.ends_at && new Date(row.ends_at) <= new Date(row.starts_at)) return toast('تاريخ الانتهاء يجب أن يكون بعد البداية');
        if (file) {
          const ext = TYPES[file.type];
          if (!ext) return toast('الصيغ المسموحة: PNG أو JPG أو WebP');
          if (file.size > MAX_BYTES) return toast('حجم الصورة يتجاوز 2 م.ب');
          const path = `banner-${Date.now()}.${ext}`;
          const up = await db.storage.from('branding').upload(path, file, {contentType: file.type, cacheControl: '3600'});
          if (up.error) return toast('تعذر رفع الصورة: ' + up.error.message);
          row.image_url = db.storage.from('branding').getPublicUrl(path).data.publicUrl;
        }
        const {error} = b ? await db.from('platform_banners').update(row).eq('id', b.id) : await db.from('platform_banners').insert(row);
        if (error) return toast('تعذر الحفظ: ' + error.message);
        toast('تم حفظ الإعلان'); load();
      });
  }

  async function action(e) {
    const t = e.target.closest('#bannerAdd, .banner-edit, .banner-toggle, .banner-del');
    if (!t) return;
    if (t.id === 'bannerAdd') return openForm(null);
    const b = rows.find(x => x.id === t.dataset.id);
    if (!b) return;
    if (t.classList.contains('banner-edit')) return openForm(b);
    await busy(t, async () => {
      let r;
      if (t.classList.contains('banner-toggle')) r = await db.from('platform_banners').update({is_active: !b.is_active}).eq('id', b.id);
      else { if (!confirm('حذف هذا الإعلان نهائيًا؟')) return; r = await db.from('platform_banners').delete().eq('id', b.id); }
      if (r.error) return toast(r.error.message);
      load();
    });
  }

  async function start() {
    db = await waitDb();
    if (!db) return;
    const me = await session(db);
    if (!me?.admin) return;
    const c = card();
    if (!c) return;
    c.addEventListener('click', action);
    load();
  }
  start().catch(err => console.error('banners-admin', err));
})();
