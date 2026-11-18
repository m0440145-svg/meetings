// أثناء الاجتماع (الترحيل 019): التفريغ النصي وملاحظات السبورة تُحفظ على الخادم لكل اجتماع، للمدير وأمين السر.
// يستبدل واجهة «أثناء الاجتماع» التجريبية المحلية فقط إن كان الترحيل مطبّقًا والمستخدم مديرًا؛ وإلا تبقى الواجهة القديمة كما هي.
(() => {
  'use strict';
  const ui = window.ehsanUI;
  if (!ui) return;
  const {esc, toast, onOpen, session, waitDb} = ui;
  let db, me, meetings = [], cur = null, expected = null, dirty = false, timer = null, saving = false;
  let spTimer = null, spSec = 0;
  const hhmm = d => new Date(d).toLocaleTimeString('ar-SA-u-ca-gregory-nu-latn', {hour: '2-digit', minute: '2-digit'});
  const mmss = s => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  const $ = id => document.getElementById(id);

  function setStatus(t, bad) { const s = $('lvStatus'); if (s) { s.textContent = t; s.style.color = bad ? '#b64242' : ''; } }

  async function loadMeetings() {
    const {data} = await db.from('meetings').select('id,title,gregorian_date').order('gregorian_date', {ascending: false}).limit(150);
    meetings = data || [];
    const sel = $('lvMeeting'); if (!sel) return;
    const keep = sel.value;
    sel.innerHTML = '<option value="">اختر الاجتماع</option>' + meetings.map(m => `<option value="${esc(m.id)}">${esc(m.title)}${m.gregorian_date ? ' — ' + esc(m.gregorian_date) : ''}</option>`).join('');
    if (keep && meetings.some(m => m.id === keep)) sel.value = keep;
  }

  async function loadNotes() {
    cur = $('lvMeeting').value || null; dirty = false; expected = null;
    const ta = $('liveTranscript'), bd = $('whiteboard');
    if (!cur) { ta.value = ''; bd.textContent = ''; ta.disabled = true; bd.contentEditable = 'false'; setStatus('اختر اجتماعًا لبدء التدوين'); return; }
    ta.disabled = false; bd.contentEditable = 'true';
    const {data, error} = await db.from('meeting_live_notes').select('transcript,board,updated_at').eq('meeting_id', cur).maybeSingle();
    if (error) { setStatus('تعذر تحميل التفريغ', true); return; }
    ta.value = data?.transcript || ''; bd.textContent = data?.board || ''; expected = data?.updated_at || null;
    setStatus(data ? `آخر حفظ ${hhmm(data.updated_at)}` : 'لا تفريغ محفوظ لهذا الاجتماع بعد');
  }

  async function save(manual) {
    if (!cur || saving || (!dirty && !manual)) return;
    saving = true; setStatus('جاري الحفظ…');
    const {data, error} = await db.rpc('live_notes_save', {p_meeting: cur, p_transcript: $('liveTranscript').value, p_board: $('whiteboard').innerText.replace(/ /g, ' ').trimEnd(), p_expected: expected});
    saving = false;
    if (error) {
      const conflict = /conflict|40001/.test((error.message || '') + (error.code || ''));
      setStatus(conflict ? 'تعارض: عُدّل التفريغ من مكان آخر. أعد التحميل قبل المتابعة.' : 'تعذر الحفظ — سيُعاد المحاولة', true);
      if (conflict) toast('عُدّل التفريغ من مكان آخر. اضغط «إعادة التحميل» لرؤية آخر نسخة.');
      return;
    }
    expected = data; dirty = false; setStatus(`تم الحفظ ${hhmm(new Date())}`);
    if (manual) toast('تم حفظ التفريغ');
  }
  const touch = () => { dirty = true; setStatus('تغييرات غير محفوظة…'); clearTimeout(timer); timer = setTimeout(() => save(false), 2500); };

  function sendToAssistant() {
    const text = $('liveTranscript').value.trim();
    if (text.length < 30) return toast('التفريغ قصير جدًا للتحليل');
    const nav = document.querySelector('[data-view="ai-assist"]');
    if (!nav) return toast('شاشة مساعد أمين السر غير متاحة');
    nav.click();
    setTimeout(() => { const t = document.getElementById('aiText'); if (t) { t.value = text.slice(0, 40000); toast('نُقل التفريغ إلى مساعد أمين السر؛ اختر المحضر ثم اضغط «حلّل المحضر»'); } }, 400);
  }

  function logSpeaker() {
    const name = $('speakerName').value.trim();
    if (!spSec) return toast('شغّل المؤقت أولًا');
    const bd = $('whiteboard'); bd.textContent = (bd.textContent ? bd.textContent.trimEnd() + '\n' : '') + `[المتحدث] ${name || 'غير مسمّى'} — ${mmss(spSec)}`;
    spSec = 0; $('speakerTimer').textContent = '00:00'; touch(); toast('سُجّلت مدة المتحدث في السبورة');
  }

  function build() {
    const sec = document.getElementById('view-live'); if (!sec) return false;
    sec.innerHTML = `<div class="section-head"><div><span class="eyebrow">أثناء الاجتماع</span><h2>إدارة الاجتماع المباشر</h2></div></div>
      <div class="ai-note" role="note" style="background:#e9f6ee;border:1px solid #b9dfc6;color:#1f5b35;border-radius:12px;padding:9px 14px;margin:0 0 14px;font-size:13.5px;line-height:1.7">يُحفظ التفريغ وملاحظات السبورة على الخادم لكل اجتماع تلقائيًا، ويراها المدير وأمين السر فقط.</div>
      <div class="ai-bar" style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:14px"><label style="flex:1 1 280px;margin:0">الاجتماع<select id="lvMeeting"></select></label><button type="button" class="btn ghost" id="lvReload">إعادة التحميل</button><span id="lvStatus" class="muted" role="status" aria-live="polite"></span></div>
      <div class="live-layout"><div class="live-stage"><h3>محضر حي وتفريغ الاجتماع</h3>
        <textarea id="liveTranscript" maxlength="100000" placeholder="اكتب أو الصق التفريغ النصي هنا…" disabled></textarea>
        <div class="form-actions"><button class="btn primary" type="button" id="lvSave">حفظ الآن</button><button class="btn ghost" type="button" id="lvAssist">تحليل بمساعد أمين السر</button></div></div>
        <div class="card"><h3>إدارة المتحدثين</h3><div class="timer" id="speakerTimer">00:00</div><input id="speakerName" placeholder="اسم المتحدث" maxlength="80" />
          <div class="form-actions"><button class="btn small primary" type="button" id="lvStart">بدء</button><button class="btn small ghost" type="button" id="lvStop">إيقاف</button><button class="btn small ghost" type="button" id="lvLog">تسجيل المدة</button></div>
          <h3>سبورة الاجتماع</h3><div id="whiteboard" class="whiteboard" contenteditable="false" role="textbox" aria-multiline="true" aria-label="سبورة الاجتماع" style="white-space:pre-wrap"></div></div></div>`;
    return true;
  }

  async function start() {
    db = await waitDb(); if (!db) return;
    me = await session(db); if (!me || !me.admin) return;
    const probe = await db.from('meeting_live_notes').select('meeting_id').limit(1);
    if (probe.error) return; // الترحيل 019 غير مطبّق: تبقى الواجهة القديمة كما هي
    if (!build()) return;
    await loadMeetings();
    $('lvMeeting').addEventListener('change', async () => { if (dirty) await save(false); await loadNotes(); });
    $('lvReload').addEventListener('click', async () => { dirty = false; await loadNotes(); });
    $('lvSave').addEventListener('click', () => save(true));
    $('liveTranscript').addEventListener('input', touch);
    $('whiteboard').addEventListener('input', touch);
    $('lvAssist').addEventListener('click', sendToAssistant);
    $('lvStart').addEventListener('click', () => { if (spTimer) return; spTimer = setInterval(() => { spSec += 1; $('speakerTimer').textContent = mmss(spSec); }, 1000); });
    $('lvStop').addEventListener('click', () => { clearInterval(spTimer); spTimer = null; });
    $('lvLog').addEventListener('click', () => { clearInterval(spTimer); spTimer = null; logSpeaker(); });
    window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
    onOpen({live: loadMeetings});
    await loadNotes();
    document.documentElement.dataset.liveServer = '1'; // يقرؤها وسم الشاشات التجريبية لإخفاء التنبيه
  }
  start().catch(err => console.error('live-meeting', err));
})();
