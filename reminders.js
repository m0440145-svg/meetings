(() => {
  // التنبيه والتذكير بالاجتماعات: حقول الضبط (تُستخدم في اجتماع جديد وفي نافذة التعديل)، وصفحة تفضيلات العضو.
  // الجداول والدوال: supabase/migrations/005_meeting_reminders.sql. الإرسال الفعلي: supabase/functions/process-delivery-jobs.
  const {esc, toast, busy, failed, onOpen, session, waitDb} = window.ehsanUI;
  const $ = s => document.querySelector(s);
  const CHANNELS = [['whatsapp', 'واتساب'], ['sms', 'رسالة نصية'], ['email', 'البريد الإلكتروني']];
  const REPEATS = [['', 'بدون تكرار'], ['1', 'يوميًا'], ['2', 'كل يومين'], ['3', 'كل ثلاثة أيام'], ['7', 'أسبوعيًا']];
  const HOURS = [1, 2, 3, 6, 12, 24, 48];
  let db, me;

  const fieldsHtml = () => `
    <h3>التنبيه والتذكير بالاجتماع</h3>
    <p class="meta">تُرسل التنبيهات للمدعوين بتوقيت الرياض. التذكير المتكرر يصل الساعة 9 صباحًا حتى يوم الاجتماع، ويستطيع كل عضو إيقاف أي قناة من "تفضيلات التنبيه".</p>
    <fieldset class="check-grid"><legend>قنوات التنبيه</legend>${CHANNELS.map(([v, t]) => `<label><input type="checkbox" data-rem="channel" value="${v}" /> ${t}</label>`).join('')}</fieldset>
    <label>تكرار التذكير<select data-rem="repeat">${REPEATS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>
    <fieldset class="check-grid"><legend>تذكير قبل الموعد بعدد ساعات (حتى 4 خيارات)</legend>${HOURS.map(h => `<label><input type="checkbox" data-rem="hours" value="${h}" /> ${h === 24 ? 'يوم (24 ساعة)' : h === 48 ? 'يومان (48 ساعة)' : h + ' ' + (h === 1 ? 'ساعة' : h === 2 ? 'ساعتان' : h <= 10 ? 'ساعات' : 'ساعة')}</label>`).join('')}</fieldset>`;

  function render(box, rule) {
    box.innerHTML = fieldsHtml();
    if (!rule) return;
    box.querySelectorAll('[data-rem=channel]').forEach(i => { i.checked = (rule.channels || []).includes(i.value); });
    box.querySelectorAll('[data-rem=hours]').forEach(i => { i.checked = (rule.hours_before || []).includes(Number(i.value)); });
    box.querySelector('[data-rem=repeat]').value = rule.repeat_days ? String(rule.repeat_days) : '';
  }

  // يعيد null إن لم تُحدَّد قناة (لا تذكير)، أو {error} عند اختيار ناقص، أو القاعدة
  function read(box) {
    const channels = [...box.querySelectorAll('[data-rem=channel]:checked')].map(i => i.value);
    const repeat = box.querySelector('[data-rem=repeat]').value;
    const hours = [...box.querySelectorAll('[data-rem=hours]:checked')].map(i => Number(i.value));
    if (!channels.length) return (repeat || hours.length) ? {error: 'اختر قناة تنبيه واحدة على الأقل'} : null;
    if (!repeat && !hours.length) return {error: 'اختر تكرارًا أو تذكيرًا قبل الموعد بالساعات'};
    if (hours.length > 4) return {error: 'الحد الأقصى 4 تذكيرات بالساعات'};
    return {channels, repeat_days: repeat ? Number(repeat) : null, hours_before: hours};
  }

  async function save(meetingId, rule) {
    const {error} = await db.rpc('set_meeting_reminders', {p_meeting: meetingId, p_channels: rule.channels, p_repeat_days: rule.repeat_days, p_hours: rule.hours_before, p_enabled: true});
    return error;
  }

  async function openEditor(meetingId, title) {
    const {data} = await db.from('meeting_reminder_rules').select('*').eq('meeting_id', meetingId).maybeSingle();
    window.openModal?.('تذكير: ' + (title || 'الاجتماع'), '<div id="remModalBox" class="form-grid"></div>', async () => {
      const box = $('#remModalBox'); // تُقرأ القيم قبل أي await لأن النافذة تُغلق بعد الحفظ مباشرة
      const rule = read(box);
      if (!rule) {
        if (!data) return toast('لم تُحدد أي تذكير');
        const {error} = await db.rpc('set_meeting_reminders', {p_meeting: meetingId, p_channels: [], p_repeat_days: null, p_hours: [], p_enabled: false});
        return toast(error ? error.message : 'تم إيقاف التذكير لهذا الاجتماع');
      }
      if (rule.error) return toast(rule.error);
      const error = await save(meetingId, rule);
      toast(error ? 'تعذر الحفظ: ' + error.message : 'تم حفظ إعدادات التذكير');
    });
    render($('#remModalBox'), data);
  }

  // ───────────── تفضيلات العضو ─────────────
  async function loadPrefs() {
    const [pr, pf] = await Promise.all([
      db.from('notification_preferences').select('*').eq('user_id', me.uid).maybeSingle(),
      db.from('profiles').select('phone').eq('id', me.uid).maybeSingle()
    ]);
    if (pr.error) return failed('تفضيلات التنبيه', pr.error);
    const p = pr.data || {email: true, whatsapp: true, sms: true};
    const f = $('#prefsForm');
    CHANNELS.forEach(([k]) => { f.elements['pref_' + k].checked = p[k] !== false; });
    f.elements.phone.value = pf.data?.phone || '';
  }

  async function savePrefs(e) {
    e.preventDefault();
    const f = e.currentTarget;
    const phone = f.elements.phone.value.trim();
    if (phone && !/^\+?[0-9\s-]{9,16}$/.test(phone)) return toast('رقم الجوال غير صالح (مثال: 05XXXXXXXX أو 9665XXXXXXXX)');
    await busy(f.querySelector('[type=submit]'), async () => {
      const row = {user_id: me.uid, updated_at: new Date().toISOString()};
      CHANNELS.forEach(([k]) => { row[k] = f.elements['pref_' + k].checked; });
      const r1 = await db.from('notification_preferences').upsert(row);
      if (r1.error) return toast('تعذر حفظ التفضيلات: ' + r1.error.message);
      const r2 = await db.from('profiles').update({phone: phone || null}).eq('id', me.uid);
      if (r2.error) return toast('حُفظت القنوات، لكن تعذر تحديث الجوال: ' + r2.error.message);
      toast('تم حفظ تفضيلات التنبيه');
    });
  }

  window.ehsanReminders = {render, read, save, openEditor, fieldsHtml, summary: rule => {
    if (!rule || !rule.enabled) return '';
    const ch = (rule.channels || []).map(c => CHANNELS.find(x => x[0] === c)?.[1] || c).join('، ');
    const rep = rule.repeat_days ? REPEATS.find(x => x[0] === String(rule.repeat_days))?.[1] : '';
    const hrs = (rule.hours_before || []).length ? 'قبل الموعد بـ ' + rule.hours_before.join('، ') + ' س' : '';
    return [ch, rep, hrs].filter(Boolean).join(' — ');
  }};

  // الحقول في نموذج اجتماع جديد
  const box = $('#meetingReminderBox');
  if (box) render(box, null);
  $('#meetingForm')?.addEventListener('reset', () => setTimeout(() => box && render(box, null), 0));

  async function start() {
    db = await waitDb();
    if (!db) return;
    me = await session(db);
    if (!me) return;
    $('#prefsForm')?.addEventListener('submit', savePrefs);
    onOpen({'notify-prefs': loadPrefs});
    if (location.hash === '#notify-prefs') loadPrefs();
  }
  start().catch(err => console.error('reminders', err));
})();
