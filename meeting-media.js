// عرض المحتوى داخل الاجتماع (الترحيل 050): فيديو وعروض PowerPoint وCanva عبر الروابط، تُعرض داخل المنصة بتضمين آمن.
// الأمان: https فقط، ولا يُضمَّن إلا مزوّدون من قائمة محددة (تطابق frame-src في CSP) بتحويل الرابط إلى رابط التضمين الرسمي للمزوّد؛
// وأي رابط آخر يُعرض كرابط يُفتح في تبويب جديد (noopener) بلا تضمين. الإطار معزول (sandbox) ولا يصل لصفحة المنصة.
// ميزة مضافة: إن لم يكن الترحيل مطبّقًا تُخفى الشاشة. لا يمسّ أي ميزة قائمة.
(() => {
  'use strict';

  // ───────────── تحويل الروابط (دالة نقية قابلة للاختبار) ─────────────
  const ID11 = /^[A-Za-z0-9_-]{11}$/;
  const FRAME_HOSTS = ['www.youtube-nocookie.com', 'player.vimeo.com', 'www.canva.com', 'docs.google.com', 'drive.google.com', 'onedrive.live.com', 'view.officeapps.live.com', 'www.loom.com'];
  const parse = raw => { try { const x = new URL(String(raw || '').trim()); return x.protocol === 'https:' && !x.username && !x.password && x.hostname ? x : null; } catch { return null; } };
  const frame = (provider, embed) => ({provider, kind: 'frame', embed});

  function allowedFrame(embed) {
    const u = parse(embed); if (!u) return false;
    const h = u.hostname.toLowerCase();
    return FRAME_HOSTS.includes(h) || h.endsWith('.sharepoint.com');
  }

  // يعيد null لرابط غير صالح (ليس https). وإلا: {provider, kind: 'frame'|'video'|'link', embed?, src?, href}
  function toEmbed(raw) {
    const u = parse(raw); if (!u) return null;
    const h = u.hostname.toLowerCase(), p = u.pathname, q = u.searchParams, href = u.href;
    let r = null, m;
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com', 'youtu.be'].includes(h)) {
      let id = null;
      if (h === 'youtu.be') id = p.slice(1).split('/')[0];
      else if (p === '/watch') id = q.get('v');
      else if ((m = /^\/(?:embed|shorts|live|v)\/([^/?#]+)/.exec(p))) id = m[1];
      if (id && ID11.test(id)) {
        const t = parseInt(q.get('t') || q.get('start') || '0', 10);
        r = frame('يوتيوب', 'https://www.youtube-nocookie.com/embed/' + id + '?rel=0' + (t > 0 && t < 86400 ? '&start=' + t : ''));
      }
    } else if (['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(h)) {
      if ((m = /^\/(?:video\/)?(\d{6,12})(?:\/([0-9a-f]{6,16}))?\/?$/.exec(p))) {
        const hash = m[2] || q.get('h');
        r = frame('فيميو', 'https://player.vimeo.com/video/' + m[1] + (hash && /^[0-9a-f]{6,16}$/.test(hash) ? '?h=' + hash : ''));
      }
    } else if (['canva.com', 'www.canva.com'].includes(h)) {
      if ((m = /^\/design\/([A-Za-z0-9_-]{6,})(?:\/([A-Za-z0-9_-]{6,}))?\/(?:view|watch|edit)\/?$/.exec(p))) {
        r = frame('كانفا', 'https://www.canva.com/design/' + m[1] + (m[2] ? '/' + m[2] : '') + '/view?embed');
      }
    } else if (h === 'docs.google.com') {
      if ((m = /^\/presentation\/d\/e\/([A-Za-z0-9_-]{10,})\/(?:pub|embed)\/?$/.exec(p))) r = frame('قوقل سلايدز', 'https://docs.google.com/presentation/d/e/' + m[1] + '/embed?start=false&loop=false&delayms=3000');
      else if ((m = /^\/presentation\/d\/([A-Za-z0-9_-]{10,})\/(?:edit|view|preview|embed|present)\/?$/.exec(p))) r = frame('قوقل سلايدز', 'https://docs.google.com/presentation/d/' + m[1] + '/preview');
    } else if (h === 'drive.google.com') {
      m = /^\/file\/d\/([A-Za-z0-9_-]{10,})\/(?:view|preview)\/?$/.exec(p);
      const id = m ? m[1] : (p === '/open' && /^[A-Za-z0-9_-]{10,}$/.test(q.get('id') || '') ? q.get('id') : null);
      if (id) r = frame('قوقل درايف', 'https://drive.google.com/file/d/' + id + '/preview');
    } else if (h === 'onedrive.live.com') {
      if (p === '/embed') r = frame('PowerPoint / OneDrive', href);
    } else if (h.endsWith('.sharepoint.com')) {
      if (q.get('action') === 'embedview') r = frame('PowerPoint / SharePoint', href);
      else if (/\/:p:\//.test(p) || /\/_layouts\/15\/Doc\.aspx$/i.test(p)) { const e = new URL(href); e.searchParams.set('action', 'embedview'); r = frame('PowerPoint / SharePoint', e.href); }
    } else if (['loom.com', 'www.loom.com'].includes(h)) {
      if ((m = /^\/(?:share|embed)\/([0-9a-f]{32})\/?$/.exec(p))) r = frame('لوم', 'https://www.loom.com/embed/' + m[1]);
    }
    if (!r && /\.(pptx?|ppsx?|pptm|ppsm)$/i.test(p)) r = frame('PowerPoint (Office Online)', 'https://view.officeapps.live.com/op/embed.aspx?src=' + encodeURIComponent(href));
    if (!r && /\.(mp4|webm|ogv|m4v)$/i.test(p)) return {provider: 'ملف فيديو', kind: 'video', src: href, href};
    if (r && allowedFrame(r.embed)) return {...r, href};
    return {provider: 'رابط خارجي', kind: 'link', href};
  }

  if (typeof module !== 'undefined' && module.exports) { module.exports = {toEmbed, allowedFrame, FRAME_HOSTS}; return; }

  // ───────────── الواجهة ─────────────
  const ui = window.ehsanUI;
  if (!ui) return;
  const {toast, onOpen, session, waitDb} = ui;
  let db, me, meetings = [], rows = [], curMeeting = '', shownId = null, started = false;

  const el = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; };
  const $ = id => document.getElementById(id);
  const canManage = () => { const m = meetings.find(x => x.id === curMeeting); return !!(me && m && (me.admin || m.created_by === me.uid)); };

  const style = document.createElement('style'); style.id = 'mediaStyle';
  style.textContent = `.mm-bar{display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:14px}.mm-bar label{flex:1 1 280px;margin:0}
.mm-layout{display:grid;grid-template-columns:minmax(0,320px) minmax(0,1fr);gap:14px}@media(max-width:900px){.mm-layout{grid-template-columns:1fr}}
.mm-list{display:grid;gap:8px;align-content:start}.mm-item{border:1px solid var(--line,#eadfd8);border-radius:14px;padding:10px 12px;background:var(--card,#fff);display:grid;gap:6px}
.mm-item.on{border-color:var(--primary,#cf6028);box-shadow:0 0 0 2px rgba(207,96,40,.15)}.mm-item h4{margin:0;font-size:15px}.mm-meta{font-size:12.5px;color:var(--muted,#6b5f59)}
.mm-acts{display:flex;gap:6px;flex-wrap:wrap}.mm-live{display:inline-block;background:#b64242;color:#fff;border-radius:999px;padding:1px 9px;font-size:12px;font-weight:700}
.mm-stage{border:1px solid var(--line,#eadfd8);border-radius:16px;background:#111;overflow:hidden;min-height:260px;display:grid}.mm-stage.empty{background:var(--card,#fff);place-items:center;color:var(--muted,#6b5f59);padding:30px;text-align:center}
.mm-frame{position:relative;width:100%;aspect-ratio:16/9;background:#000}.mm-frame iframe,.mm-frame video{position:absolute;inset:0;width:100%;height:100%;border:0}
.mm-head{display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--card,#fff);border-bottom:1px solid var(--line,#eadfd8)}
.mm-link{padding:26px;text-align:center;background:var(--card,#fff);display:grid;gap:10px;justify-items:center}
#mmBanner{position:fixed;inset-inline-start:16px;bottom:16px;z-index:9000;max-width:min(380px,calc(100vw - 32px));background:#2b211c;color:#fff;border-radius:14px;padding:12px 14px;box-shadow:0 12px 34px rgba(0,0,0,.35);display:grid;gap:8px}
#mmBanner .mm-acts button{font:inherit}`;
  document.head.append(style);

  async function loadMeetings() {
    const {data} = await db.from('meetings').select('id,title,gregorian_date,created_by').order('gregorian_date', {ascending: false}).limit(150);
    meetings = data || [];
    const sel = $('mmMeeting'); if (!sel) return;
    const keep = curMeeting || sel.value;
    sel.replaceChildren(new Option('اختر الاجتماع', ''));
    meetings.forEach(m => sel.append(new Option(m.title + (m.gregorian_date ? ' — ' + m.gregorian_date : ''), m.id)));
    if (keep && meetings.some(m => m.id === keep)) sel.value = keep;
    curMeeting = sel.value;
  }

  async function loadItems() {
    const box = $('mmList'); if (!box) return;
    $('mmAdd').hidden = !canManage();
    if (!curMeeting) { rows = []; box.replaceChildren(el('div', 'meta', 'اختر اجتماعًا لعرض محتواه.')); showStage(null); return; }
    const {data, error} = await db.from('meeting_media').select('*').eq('meeting_id', curMeeting).order('sort_order').order('created_at');
    if (error) { box.replaceChildren(el('div', 'meta', 'تعذر تحميل المحتوى')); return; }
    rows = data || [];
    renderList();
    const live = rows.find(r => r.is_live);
    const keep = rows.find(r => r.id === shownId);
    showStage(live && !keep ? live : keep || null);
  }

  function renderList() {
    const box = $('mmList'); box.replaceChildren();
    if (!rows.length) { box.append(el('div', 'meta', canManage() ? 'لا محتوى بعد. أضف رابط فيديو أو عرض تقديمي.' : 'لم يُضف محتوى لهذا الاجتماع.')); return; }
    rows.forEach(r => {
      const info = toEmbed(r.url) || {provider: 'رابط', kind: 'link'};
      const it = el('div', 'mm-item' + (r.id === shownId ? ' on' : ''));
      const h = el('h4', null, r.title); if (r.is_live) { h.append(' '); h.append(el('span', 'mm-live', 'يُعرض الآن')); }
      it.append(h, el('div', 'mm-meta', info.provider + (r.note ? ' • ' + r.note : '')));
      const acts = el('div', 'mm-acts');
      const view = el('button', 'btn small primary', info.kind === 'link' ? 'فتح الرابط' : 'عرض'); view.type = 'button'; view.addEventListener('click', () => showStage(r)); acts.append(view);
      if (canManage()) {
        const lv = el('button', 'btn small ghost', r.is_live ? 'إيقاف العرض للجميع' : 'اعرض للجميع'); lv.type = 'button'; lv.addEventListener('click', () => setLive(r, !r.is_live));
        const del = el('button', 'btn small ghost', 'حذف'); del.type = 'button'; del.addEventListener('click', () => remove(r));
        acts.append(lv, del);
      }
      it.append(acts); box.append(it);
    });
  }

  function showStage(r) {
    const st = $('mmStage'); if (!st) return;
    shownId = r ? r.id : null;
    st.replaceChildren(); st.className = 'mm-stage';
    document.querySelectorAll('#mmList .mm-item').forEach((n, i) => n.classList.toggle('on', rows[i] && rows[i].id === shownId));
    if (!r) { st.classList.add('empty'); st.append(el('div', null, 'اختر عنصرًا من القائمة لعرضه هنا.')); return; }
    const info = toEmbed(r.url);
    const head = el('div', 'mm-head'); head.append(el('strong', null, r.title + ' — ' + (info ? info.provider : '')));
    const bar = el('div', 'mm-acts');
    const open = el('a', 'btn small ghost', 'فتح في تبويب جديد'); open.href = info?.href || '#'; open.target = '_blank'; open.rel = 'noopener noreferrer'; bar.append(open);
    if (info && info.kind !== 'link') { const fs = el('button', 'btn small ghost', 'ملء الشاشة'); fs.type = 'button'; fs.addEventListener('click', () => (st.querySelector('.mm-frame') || st).requestFullscreen?.()); bar.append(fs); }
    head.append(bar); st.append(head);
    if (!info || info.kind === 'link') {
      const b = el('div', 'mm-link'); b.append(el('p', null, 'هذا الرابط لا يمكن تضمينه داخل المنصة. يُفتح في تبويب جديد.'));
      if (info) { const a = el('a', 'btn primary', 'فتح الرابط'); a.href = info.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; b.append(a); }
      st.append(b); return;
    }
    const wrap = el('div', 'mm-frame');
    if (info.kind === 'video') {
      const v = document.createElement('video'); v.controls = true; v.preload = 'metadata'; v.setAttribute('playsinline', ''); v.src = info.src; wrap.append(v);
    } else {
      const f = document.createElement('iframe'); f.src = info.embed; f.title = r.title; f.loading = 'lazy';
      f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox');
      f.setAttribute('allow', 'fullscreen; autoplay; picture-in-picture; encrypted-media');
      f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin'); f.setAttribute('allowfullscreen', ''); wrap.append(f);
    }
    st.append(wrap);
  }

  async function add() {
    const m = meetings.find(x => x.id === curMeeting); if (!m) return toast('اختر الاجتماع أولًا');
    await window.DM.form({
      title: 'إضافة محتوى للعرض', submit: 'إضافة',
      fields: [
        {type: 'info', text: 'ألصق رابطًا من يوتيوب أو فيميو أو كانفا أو قوقل سلايدز/درايف أو PowerPoint (رابط التضمين من OneDrive/SharePoint أو رابط ملف .pptx عام) أو ملف فيديو مباشر. يجب أن يكون الرابط https ومتاحًا لمن سيشاهده. غير ذلك يُفتح في تبويب جديد.'},
        {name: 'title', label: 'العنوان', required: true, maxlength: 150},
        {name: 'url', label: 'الرابط (https)', required: true, maxlength: 800},
        {name: 'note', label: 'ملاحظة (اختياري)', maxlength: 300}
      ],
      onSubmit: async v => {
        if (!toEmbed(v.url)) throw new Error('الرابط يجب أن يبدأ بـ https://');
        const {error} = await db.from('meeting_media').insert({meeting_id: curMeeting, title: v.title, url: v.url.trim(), note: v.note || null});
        if (error) throw new Error(/40/.test(error.message) ? 'بلغ الاجتماع الحد الأقصى من العناصر' : (error.message || 'تعذر الحفظ'));
        toast('أُضيف المحتوى');
        loadItems();
      }
    });
  }

  async function setLive(r, on) {
    const {error} = await db.rpc('media_set_live', {p_id: r.id, p_live: on});
    if (error) return toast('تعذر التغيير: ' + error.message);
    toast(on ? 'يُعرض الآن للحاضرين' : 'أُوقف العرض');
    await loadItems();
    if (on) showStage(rows.find(x => x.id === r.id));
  }

  async function remove(r) {
    const ok = window.ehsanConfirm ? await window.ehsanConfirm(`حذف «${r.title}» من عرض الاجتماع؟`) : false;
    if (!ok) return;
    const {error} = await db.from('meeting_media').delete().eq('id', r.id);
    if (error) return toast('تعذر الحذف: ' + error.message);
    if (shownId === r.id) shownId = null;
    loadItems();
  }

  function banner(r) {
    $('mmBanner')?.remove();
    const b = el('div'); b.id = 'mmBanner'; b.setAttribute('role', 'status');
    b.append(el('strong', null, 'يُعرض الآن في الاجتماع'), el('div', null, r.title));
    const acts = el('div', 'mm-acts');
    const go = el('button', 'btn small primary', 'عرض'); go.type = 'button'; go.addEventListener('click', () => { b.remove(); openView(r.meeting_id, r.id); });
    const x = el('button', 'btn small ghost', 'إخفاء'); x.type = 'button'; x.addEventListener('click', () => b.remove());
    acts.append(go, x); b.append(acts); document.body.append(b);
    setTimeout(() => b.remove(), 60000);
  }

  async function openView(meetingId, itemId) {
    curMeeting = meetingId || curMeeting; shownId = itemId || null;
    document.querySelector('[data-view="meeting-media"]')?.click();
    await loadMeetings();
    await loadItems();
    if (itemId) showStage(rows.find(x => x.id === itemId) || null);
  }

  function build() {
    const main = document.querySelector('.main-area'); if (!main) return false;
    if ($('view-meeting-media')) return true;
    const sec = el('section', 'view'); sec.id = 'view-meeting-media';
    sec.innerHTML = `<div class="section-head"><div><span class="eyebrow">أثناء الاجتماع</span><h2>عرض المحتوى</h2></div><button type="button" class="btn primary" id="mmAdd" hidden>＋ إضافة محتوى</button></div>
      <div class="mm-bar"><label>الاجتماع<select id="mmMeeting"></select></label><button type="button" class="btn ghost" id="mmReload">تحديث</button></div>
      <div class="mm-layout"><div class="mm-list" id="mmList"></div><div class="mm-stage empty" id="mmStage"></div></div>`;
    main.append(sec);
    return true;
  }

  // زر في شاشة «أثناء الاجتماع» (للمدير) ينقل إلى عرض المحتوى للاجتماع نفسه
  function hookLiveView() {
    let tries = 0;
    const t = setInterval(() => {
      const sel = $('lvMeeting'), reload = $('lvReload');
      if (sel && reload && !$('lvMedia')) {
        clearInterval(t);
        const b = el('button', 'btn ghost', '▶ عرض المحتوى'); b.type = 'button'; b.id = 'lvMedia';
        b.addEventListener('click', () => openView(sel.value || curMeeting, null));
        reload.after(b);
      } else if (++tries > 40) clearInterval(t);
    }, 500);
  }

  async function start() {
    if (started) return; started = true;
    db = await waitDb(); if (!db) return;
    me = await session(db); if (!me) return;
    const probe = await db.from('meeting_media').select('id').limit(1);
    if (probe.error) { document.querySelectorAll('[data-view="meeting-media"]').forEach(b => { b.hidden = true; }); return; } // الترحيل 050 غير مطبّق
    if (!build()) return;
    $('mmMeeting').addEventListener('change', () => { curMeeting = $('mmMeeting').value; shownId = null; loadItems(); });
    $('mmReload').addEventListener('click', async () => { await loadMeetings(); await loadItems(); });
    $('mmAdd').addEventListener('click', add);
    onOpen({'meeting-media': async () => { await loadMeetings(); await loadItems(); }});
    await loadMeetings();
    hookLiveView();
    // تحديث فوري: عند «اعرض للجميع» يظهر تنبيه للحاضرين، وتتحدث القائمة المفتوحة
    try {
      db.channel('meeting-media-live').on('postgres_changes', {event: '*', schema: 'public', table: 'meeting_media'}, payload => {
        const r = payload.new || {};
        if (curMeeting && (r.meeting_id === curMeeting || payload.old?.meeting_id === curMeeting) && $('view-meeting-media')?.classList.contains('active')) loadItems();
        if (payload.eventType !== 'DELETE' && r.is_live && r.created_by !== me.uid && shownId !== r.id) banner(r);
      }).subscribe();
    } catch (e) { /* التحديث الفوري اختياري: يبقى زر «تحديث» */ }
  }
  start().catch(err => console.error('meeting-media', err));
})();
