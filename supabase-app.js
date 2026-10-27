(() => {
  const cfg = window.EHSAN_SUPABASE;
  if (!cfg || !window.supabase) return;
  const db = window.supabase.createClient(cfg.url, cfg.publishableKey);
  window.ehsanDB = db;

  const q = s => document.querySelector(s);
  const qa = s => [...document.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const notify = msg => window.showToast ? window.showToast(msg) : alert(msg);
  const setText = (sel, v) => { const el = q(sel); if (el) el.textContent = v; };
  const setHtml = (sel, v) => { const el = q(sel); if (el) el.innerHTML = v; };
  const safeUrl = u => { try { const x = new URL(u); return x.protocol === 'https:' ? x.href : ''; } catch { return ''; } };
  // اسم آمن لمفتاح التخزين: Supabase Storage يرفض غالبًا الأسماء العربية والرموز الخاصة، ويُحفظ الاسم الأصلي في جدول attachments
  const safeFileKey = name => {
    const m = /\.([A-Za-z0-9]{1,10})$/.exec(name || '');
    return crypto.randomUUID() + (m ? '.' + m[1].toLowerCase() : '');
  };
  // خطأ تحميل: نُظهره مرة واحدة لكل مصدر بدل تجاهله فيبدو الجدول فارغًا
  const reported = new Set();
  const loadFailed = (what, error) => {
    console.error(what, error);
    if (reported.has(what)) return;
    reported.add(what);
    notify(`تعذر تحميل ${what}: ${error?.message || 'خطأ في الاتصال'}`);
  };
  const goTo = v => window.ehsanActivateView ? window.ehsanActivateView(v) : window.showView?.(v);

  async function session() { return (await db.auth.getSession()).data.session; }
  async function profile(userId) { const {data} = await db.from('profiles').select('*').eq('id', userId).single(); return data; }

  // رسائل Supabase تصل بالإنجليزية؛ نترجم الشائع منها ونشرح سببه للمستخدم
  function authError(error) {
    const msg = error?.message || '';
    const map = [
      // رسالة موحدة لا تكشف إن كان البريد مسجلًا (تفادي تعداد الحسابات)
      [/invalid login credentials/i, 'البريد الإلكتروني أو كلمة المرور غير صحيحة. إن نسيت كلمة المرور فاستخدم "نسيت كلمة المرور".'],
      [/email not confirmed/i, 'لم يتم تأكيد البريد بعد. افتح رسالة التأكيد في بريدك (وتحقق من مجلد الرسائل غير المرغوبة).'],
      [/user already registered/i, 'يوجد حساب بهذا البريد مسبقًا. سجّل الدخول أو استخدم "نسيت كلمة المرور".'],
      [/signups not allowed|signup is disabled/i, 'إنشاء الحسابات مغلق. تواصل مع مدير المنصة لإضافتك.'],
      [/password should be at least/i, 'كلمة المرور قصيرة جدًا.'],
      [/rate limit|too many requests|security purposes/i, 'محاولات كثيرة خلال وقت قصير. انتظر دقيقة ثم حاول مجددًا.'],
      [/unable to validate email|invalid email/i, 'صيغة البريد الإلكتروني غير صحيحة.']
    ];
    return (map.find(([re]) => re.test(msg)) || [null, msg || 'حدث خطأ غير متوقع'])[1];
  }
  const siteUrl = () => location.origin + location.pathname;

  function loginScreen() {
    if (q('#authGate')) return;
    const gate = document.createElement('div'); gate.id = 'authGate'; gate.innerHTML = `
      <div class="auth-card"><img src="assets/logo.svg" alt="شعار جمعية الإحسان" data-brand-logo><h2 data-brand="platform_name">منصة الاجتماعات</h2><p>تسجيل الدخول إلى حسابك المؤسسي</p>
      <form id="authForm"></form>
      <div class="auth-links"><button class="link-btn" type="button" id="signupToggle">إنشاء حساب جديد</button><button class="link-btn" type="button" id="resetToggle">نسيت كلمة المرور</button><button class="link-btn" type="button" id="loginToggle" hidden>العودة لتسجيل الدخول</button></div><small id="authMsg"></small></div>`;
    document.body.appendChild(gate);
    gate.querySelector('img')?.addEventListener('error', e => e.target.remove());
    const form = q('#authForm'), msg = t => { q('#authMsg').textContent = t; };
    const mode = (name, html, submit) => {
      form.innerHTML = html;
      form.onsubmit = async e => {
        e.preventDefault();
        const btn = form.querySelector('[type=submit]');
        btn.disabled = true;
        try { await submit(new FormData(form)); } finally { btn.disabled = false; }
      };
      q('#signupToggle').hidden = name === 'signup';
      q('#resetToggle').hidden = name === 'reset';
      q('#loginToggle').hidden = name === 'login';
      q('#otpLoginBtn')?.toggleAttribute('hidden', name !== 'login');
      msg('');
    };
    // تبطيء من جهة المتصفح بعد 5 محاولات فاشلة (إرشادي فقط؛ الحماية الفعلية من حدود Supabase ومن CAPTCHA إن فُعّل)
    let fails = 0, lockUntil = 0;
    const login = () => mode('login', `<label>البريد الإلكتروني<input name="email" type="email" required></label><label>كلمة المرور<input name="password" type="password" minlength="6" required></label><button class="btn primary" type="submit">تسجيل الدخول</button>`, async f => {
      const wait = Math.ceil((lockUntil - Date.now()) / 1000);
      if (wait > 0) return msg(`محاولات كثيرة غير صحيحة. انتظر ${wait} ثانية ثم حاول مجددًا.`);
      const {error} = await db.auth.signInWithPassword({email: f.get('email').trim(), password: f.get('password')});
      if (error) {
        if (/invalid login credentials/i.test(error.message) && ++fails >= 5) { fails = 0; lockUntil = Date.now() + 30000; return msg('محاولات كثيرة غير صحيحة. انتظر 30 ثانية ثم حاول مجددًا.'); }
        return msg(authError(error));
      }
      fails = 0;
      msg('تم تسجيل الدخول');
      location.reload();
    });
    q('#loginToggle').onclick = login;
    q('#signupToggle').onclick = () => mode('signup', `<label>الاسم الكامل<input name="full_name" required></label><label>البريد الإلكتروني<input name="email" type="email" required></label><label>كلمة المرور<input name="password" type="password" minlength="8" required></label><button class="btn primary" type="submit">إنشاء الحساب</button>`, async f => {
      const {data, error} = await db.auth.signUp({email: f.get('email').trim(), password: f.get('password'), options: {data: {full_name: f.get('full_name')}, emailRedirectTo: siteUrl()}});
      if (error) return msg(authError(error));
      // عند تفعيل حماية تعداد الحسابات يعيد Supabase مستخدمًا بلا هويات إذا كان البريد مسجلًا مسبقًا
      if (data?.user && !data.user.identities?.length) return msg(authError({message: 'User already registered'}));
      msg(data?.session ? 'تم إنشاء الحساب.' : 'تم إنشاء الحساب. افتح رسالة التأكيد في بريدك ثم سجّل الدخول.');
      if (data?.session) location.reload();
    });
    q('#resetToggle').onclick = () => mode('reset', `<label>البريد الإلكتروني<input name="email" type="email" required></label><button class="btn primary" type="submit">إرسال رابط إعادة التعيين</button>`, async f => {
      const {error} = await db.auth.resetPasswordForEmail(f.get('email').trim(), {redirectTo: siteUrl()});
      msg(error ? authError(error) : 'إذا كان البريد مسجلًا فستصلك رسالة فيها رابط لتعيين كلمة مرور جديدة.');
    });
    login();
  }

  // عند فتح رابط "نسيت كلمة المرور" من البريد يُطلب من المستخدم تعيين كلمة مرور جديدة
  function passwordRecoveryScreen() {
    q('#authGate')?.remove();
    const gate = document.createElement('div'); gate.id = 'authGate'; gate.innerHTML = `
      <div class="auth-card"><h2>تعيين كلمة مرور جديدة</h2>
      <form id="recoveryForm"><label>كلمة المرور الجديدة<input name="password" type="password" minlength="8" required></label><label>تأكيد كلمة المرور<input name="confirm" type="password" minlength="8" required></label><button class="btn primary" type="submit">حفظ كلمة المرور</button></form><small id="authMsg"></small></div>`;
    document.body.appendChild(gate);
    q('#recoveryForm').onsubmit = async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      if (f.get('password') !== f.get('confirm')) { q('#authMsg').textContent = 'كلمتا المرور غير متطابقتين.'; return; }
      const {error} = await db.auth.updateUser({password: f.get('password')});
      if (error) { q('#authMsg').textContent = authError(error); return; }
      q('#authMsg').textContent = 'تم تحديث كلمة المرور.';
      history.replaceState(null, '', siteUrl());
      location.reload();
    };
  }
  let recovering = /type=recovery/.test(location.hash);
  db.auth.onAuthStateChange(event => { if (event === 'PASSWORD_RECOVERY') { recovering = true; passwordRecoveryScreen(); } });

  async function hydrateUser() {
    const s = await session();
    if (!s) { loginScreen(); return false; }
    if (recovering) { passwordRecoveryScreen(); return false; }
    q('#authGate')?.remove();
    const p = await profile(s.user.id);
    const btn = q('.profile-btn');
    if (btn) {
      btn.innerHTML = `<span class="avatar">${esc((p?.full_name || s.user.email)[0])}</span><span>${esc(p?.full_name || s.user.email)}</span>`;
      btn.title = 'انقر لتسجيل الخروج';
      btn.onclick = async () => { await db.auth.signOut(); location.reload(); };
    }
    return true;
  }

  async function loadCommittees() {
    const {data, error} = await db.from('committees').select('*').order('name');
    if (error) return loadFailed('اللجان', error);
    setHtml('#meetingCommittee', (data || []).map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join(''));
    setHtml('#committeesGrid', (data || []).map(x => `<article><div class="committee-head"><div class="member-avatar">◉</div><div><strong>${esc(x.name)}</strong><div class="meta">${esc(x.description || '')}</div></div></div></article>`).join('') || '<article>لا توجد لجان.</article>');
  }

  let profiles = [];
  async function loadProfiles() {
    const {data, error} = await db.from('profiles').select('*').order('created_at');
    if (error) return loadFailed('الأعضاء', error);
    profiles = data || [];
    setText('#statMembers', profiles.length);
    setHtml('#membersGrid', profiles.map(x => `<article><div class="member-head"><div class="member-avatar">${esc((x.full_name || 'ع')[0])}</div><div><strong>${esc(x.full_name || 'عضو')}</strong><div class="meta">${esc(x.job_title || x.role)}</div></div></div><p>${esc(x.phone || '')}</p><div class="meta">الصلاحية: ${esc(x.role_code || x.role || 'member')} • ${x.is_active === false ? 'موقوف' : 'نشط'}</div></article>`).join(''));
    setHtml('#taskAssignee', profiles.map(x => `<option value="${x.id}">${esc(x.full_name || 'عضو')}</option>`).join(''));
  }

  let meetingsCache = [];
  function renderMeetingsTable() {
    const term = (q('#meetingSearch')?.value || '').toLowerCase();
    const status = q('#meetingFilter')?.value || 'all';
    const rows = meetingsCache.filter(m => (status === 'all' || m.status === status) && `${m.title} ${m.committees?.name || ''}`.toLowerCase().includes(term));
    setHtml('#meetingsTable', rows.map(m => {
      const url = safeUrl(m.meeting_url);
      return `<tr><td>${esc(m.title)}</td><td>${esc(m.committees?.name || '')}</td><td>${esc(m.gregorian_date)}</td><td>${esc(m.start_time?.slice(0, 5) || '')}</td><td>${esc(m.mode)}</td><td><span class="status-pill">${esc(m.status)}</span></td><td>${m.attachments?.[0]?.count || 0}</td><td>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">فتح الرابط</a> ` : ''}<button type="button" class="btn small ghost" data-manage-meeting="${esc(m.id)}">إدارة</button></td></tr>`;
    }).join('') || '<tr><td colspan="8">لا توجد اجتماعات مطابقة.</td></tr>');
  }

  window.ehsanMeetings = {reload: () => loadMeetings()}; // يستخدمها meeting-manage.js بعد التعديل والحذف
  async function loadMeetings() {
    const {data, error} = await db.from('meetings').select('*,committees(name),attachments(count)').order('gregorian_date', {ascending: true});
    if (error) return loadFailed('الاجتماعات', error);
    meetingsCache = data || [];
    renderMeetingsTable();
    const future = meetingsCache.filter(m => new Date(m.gregorian_date + 'T23:59:59') >= new Date());
    ['#statMeetings', '#homeMeetings'].forEach(id => setText(id, future.length));
    const listHtml = future.slice(0, 5).map(m => `<div class="list-item"><strong>${esc(m.title)}</strong><div class="meta"><span>${esc(m.gregorian_date)}</span><span>${esc(m.start_time?.slice(0, 5) || '')}</span><span>${esc(m.committees?.name || '')}</span></div></div>`).join('') || '<div class="list-item">لا توجد اجتماعات قادمة.</div>';
    setHtml('#upcomingList', listHtml);
    setHtml('#homeUpcomingList', listHtml);
  }

  async function saveMeeting(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const btn = form.querySelector('[type=submit]');
    if (btn?.disabled) return;
    if (btn) btn.disabled = true;
    try { await doSaveMeeting(form); }
    catch (err) { notify('تعذر حفظ الاجتماع: ' + (err?.message || 'خطأ غير متوقع')); }
    finally { if (btn) btn.disabled = false; }
  }

  async function doSaveMeeting(form) {
    const s = await session();
    if (!s) return notify('انتهت الجلسة، سجّل الدخول من جديد');
    const f = new FormData(form);
    const start = f.get('time'), end = f.get('endTime');
    if (end && start && end <= start) return notify('وقت النهاية يجب أن يكون بعد وقت البداية');
    const rawUrl = f.get('meetingUrl');
    if (rawUrl && !safeUrl(rawUrl)) return notify('رابط الاجتماع يجب أن يبدأ بـ https://');
    // إعدادات التنبيه والتذكير (reminders.js): نتحقق منها قبل إنشاء الاجتماع حتى لا يُحفظ ناقصًا
    const reminder = window.ehsanReminders?.read(q('#meetingReminderBox'));
    if (reminder?.error) return notify(reminder.error);
    const payload = {title: f.get('title'), committee_id: f.get('committee'), gregorian_date: f.get('date'), hijri_date: f.get('hijri'), start_time: f.get('time'), end_time: f.get('endTime') || null, mode: f.get('mode'), location: f.get('location'), platform: f.get('platform'), meeting_url: f.get('meetingUrl') || null, description: f.get('description'), created_by: s.user.id, status: 'مجدول'};
    const {data, error} = await db.from('meetings').insert(payload).select().single();
    if (error) { notify('تعذر حفظ الاجتماع: ' + error.message); return; }
    const failures = [];
    // حقل "المسؤول / الزمن" نص حر؛ نأخذ أول رقم فيه كمدة بالدقائق
    const agenda = qa('#agendaRows .agenda-row').map((r, i) => {
      const title = r.querySelector('.agenda-title')?.value?.trim();
      const minutes = parseInt((r.querySelector('.agenda-owner')?.value || '').match(/\d+/)?.[0], 10);
      return title && {meeting_id: data.id, item_order: i + 1, title, duration_minutes: minutes || 10};
    }).filter(Boolean);
    if (agenda.length) {
      const {error: agErr} = await db.from('agenda_items').insert(agenda);
      if (agErr) failures.push('جدول الأعمال (' + agErr.message + ')');
    }
    for (const file of [...(q('#meetingFiles')?.files || [])]) {
      const path = `${data.id}/${safeFileKey(file.name)}`;
      const up = await db.storage.from('meeting-files').upload(path, file);
      const rec = up.error ? up : await db.from('attachments').insert({meeting_id: data.id, file_name: file.name, storage_path: path, mime_type: file.type, size_bytes: file.size, uploaded_by: s.user.id});
      if (rec.error) failures.push(file.name + ' (' + rec.error.message + ')');
    }
    if (reminder) {
      const remErr = await window.ehsanReminders.save(data.id, reminder);
      if (remErr) failures.push('التذكير (' + remErr.message + ')');
    }
    // بند "متابعة تنفيذ قرارات الاجتماعات السابقة" (وحدة القرارات)؛ يُتجاهل بصمت إن لم تُنفَّذ الترحيلات 007/008 بعد
    if (q('#meetingFollowup')?.checked) {
      const fu = await db.rpc('dm_add_followup_agenda', {p_meeting: data.id});
      if (fu.error && !/does not exist|schema cache|Could not find/i.test(fu.error.message)) failures.push('بند متابعة القرارات (' + fu.error.message + ')');
    }
    // عند فشل جزء نبقي النموذج كما هو حتى لا يضيع ما أدخله المستخدم، والاجتماع نفسه محفوظ مسبقًا
    await loadMeetings();
    if (failures.length) return notify(`تم حفظ الاجتماع، لكن تعذر حفظ: ${failures.join('، ')}. راجع الاجتماع قبل إعادة المحاولة حتى لا يتكرر.`);
    notify('تم حفظ الاجتماع مركزيًا وإتاحته للمستخدمين المخولين');
    form.reset();
    setHtml('#filePreview', '');
    setHtml('#agendaRows', '');
    window.addAgendaRow?.();
    goTo('meetings');
  }

  let tasksCache = [];
  async function loadTasks() {
    const {data, error} = await db.from('tasks').select('*,profiles!tasks_assignee_id_fkey(full_name)').order('created_at', {ascending: false});
    if (error) return loadFailed('المهام', error);
    tasksCache = data || [];
    const open = tasksCache.filter(x => x.status !== 'مكتملة');
    ['#statTasks', '#homeTasks'].forEach(id => setText(id, open.length));
    const cols = {'جديدة': q('#tasks-new'), 'قيد التنفيذ': q('#tasks-progress'), 'مكتملة': q('#tasks-done'), 'متأخرة': q('#tasks-progress')};
    Object.values(cols).forEach(el => { if (el) el.innerHTML = ''; });
    tasksCache.forEach(t => {
      const el = cols[t.status] || cols['جديدة'];
      if (!el) return;
      const actions = (t.status !== 'قيد التنفيذ' && t.status !== 'مكتملة' ? `<button class="btn small ghost task-move" data-id="${t.id}" data-status="قيد التنفيذ">قيد التنفيذ</button>` : '') +
        (t.status !== 'مكتملة' ? `<button class="btn small ghost task-move" data-id="${t.id}" data-status="مكتملة">إكمال</button>` : '');
      el.insertAdjacentHTML('beforeend', `<div class="task-card"><strong>${esc(t.title)}</strong><small>${esc(t.profiles?.full_name || 'غير مسند')} • ${esc(t.due_date || 'بدون موعد')}</small><div class="card-actions">${actions}</div></div>`);
    });
  }

  async function addTask() {
    if (!window.openModal) return;
    const options = profiles.map(x => `<option value="${x.id}">${esc(x.full_name || 'عضو')}</option>`).join('');
    window.openModal('مهمة جديدة', `<label>عنوان المهمة<input id="mf_title" /></label><label>المسؤول<select id="mf_assignee"><option value="">غير مسند</option>${options}</select></label><label>تاريخ الاستحقاق<input id="mf_due" type="date" /></label>`, async () => {
      const title = q('#mf_title').value.trim();
      if (!title) return notify('أدخل عنوان المهمة');
      const s = await session();
      if (!s) return notify('انتهت الجلسة، سجّل الدخول من جديد');
      const {error} = await db.from('tasks').insert({title, assignee_id: q('#mf_assignee').value || null, due_date: q('#mf_due').value || null, status: 'جديدة', priority: 'متوسطة', created_by: s.user.id});
      if (error) return notify('تعذر حفظ المهمة: ' + error.message);
      notify('تمت إضافة المهمة');
      loadTasks();
    });
  }

  async function addCommittee() {
    if (!window.openModal) return;
    window.openModal('لجنة جديدة', '<label>اسم اللجنة<input id="mf_name" /></label><label>الوصف<input id="mf_desc" /></label>', async () => {
      const name = q('#mf_name').value.trim();
      if (!name) return notify('أدخل اسم اللجنة');
      const {error} = await db.from('committees').insert({name, description: q('#mf_desc').value});
      if (error) return notify('تعذر حفظ اللجنة: ' + error.message);
      notify('تمت إضافة اللجنة');
      loadCommittees();
    });
  }

  let notificationsCache = [];
  async function loadNotifications() {
    const s = await session();
    if (!s) return;
    const {data, error} = await db.from('notifications').select('*').eq('user_id', s.user.id).order('created_at', {ascending: false});
    if (error) return loadFailed('الإشعارات', error);
    notificationsCache = data || [];
    const unread = notificationsCache.filter(x => !x.is_read).length;
    setText('#notifBadge', unread);
    setText('#homeNotifications', unread);
    const item = n => `<div class="list-item"><strong>${esc(n.title)}</strong><div>${esc(n.body || '')}</div><div class="meta"><span>${new Date(n.created_at).toLocaleString('ar-SA')}</span>${n.is_read ? '' : `<button class="link-btn notif-read" data-id="${n.id}">تعليم كمقروء</button>`}</div></div>`;
    const empty = '<div class="list-item">لا توجد إشعارات.</div>';
    const recent = notificationsCache.slice(0, 8).map(item).join('') || empty;
    setHtml('#recentNotifications', recent);
    setHtml('#homeRecentNotifications', recent);
    setHtml('#notificationsList', notificationsCache.map(item).join('') || empty);
  }

  let mailCache = [], mailbox = 'inbox', myId = null;
  function renderMail() {
    const inbox = mailCache.filter(m => m.recipient_id === myId), sent = mailCache.filter(m => m.sender_id === myId);
    setText('#inboxCount', inbox.length);
    setText('#sentCount', sent.length);
    const items = mailbox === 'sent' ? sent : inbox;
    setHtml('#mailList', items.map(m => `<div class="mail-item"><strong>${esc(m.subject)}</strong><div>${esc(m.body)}</div><small>${esc(m.sender?.full_name || '')} ← ${esc(m.recipient?.full_name || '')}</small></div>`).join('') || '<div class="mail-item">لا توجد رسائل.</div>');
  }

  async function loadMail() {
    const s = await session();
    if (!s) return;
    myId = s.user.id;
    const {data, error} = await db.from('internal_mail').select('*,sender:profiles!internal_mail_sender_id_fkey(full_name),recipient:profiles!internal_mail_recipient_id_fkey(full_name)').or(`sender_id.eq.${s.user.id},recipient_id.eq.${s.user.id}`).order('created_at', {ascending: false});
    if (error) return loadFailed('البريد', error);
    mailCache = data || [];
    renderMail();
  }

  function composeMail() {
    if (!window.openModal) return;
    const options = profiles.filter(x => x.id !== myId).map(x => `<option value="${x.id}">${esc(x.full_name || 'عضو')}</option>`).join('');
    window.openModal('رسالة جديدة', `<label>إلى<select id="mf_to">${options}</select></label><label>الموضوع<input id="mf_subject" /></label><label>الرسالة<textarea id="mf_body" rows="4"></textarea></label>`, async () => {
      const recipient_id = q('#mf_to').value;
      if (!recipient_id) return notify('اختر المستلم');
      const {error} = await db.from('internal_mail').insert({sender_id: myId, recipient_id, subject: q('#mf_subject').value, body: q('#mf_body').value});
      if (error) return notify('تعذر إرسال الرسالة: ' + error.message);
      notify('تم إرسال الرسالة');
      loadMail();
    });
  }

  let uiBound = false, realtimeStarted = false;
  function bindUI() {
    if (uiBound) return; // منع تسجيل المستمعين مرتين (كل نقرة كانت ستُنفَّذ مرتين)
    uiBound = true;
    q('#meetingForm')?.addEventListener('submit', saveMeeting);
    q('#meetingSearch')?.addEventListener('input', renderMeetingsTable);
    q('#meetingFilter')?.addEventListener('change', renderMeetingsTable);
    q('#addTaskBtn')?.addEventListener('click', addTask);
    q('#addCommitteeBtn')?.addEventListener('click', addCommittee);
    q('#composeBtn')?.addEventListener('click', composeMail);
    q('#addNotifBtn')?.remove();
    qa('[data-mailbox]').forEach(b => b.addEventListener('click', () => { mailbox = b.dataset.mailbox; renderMail(); }));
    document.addEventListener('click', async e => {
      const move = e.target.closest('.task-move');
      if (move) {
        const {error} = await db.from('tasks').update({status: move.dataset.status}).eq('id', move.dataset.id);
        if (error) return notify(error.message);
        return loadTasks();
      }
      const read = e.target.closest('.notif-read');
      if (read) {
        const {error} = await db.from('notifications').update({is_read: true}).eq('id', read.dataset.id);
        if (error) return notify(error.message);
        loadNotifications();
      }
    });
  }

  function realtime() {
    if (realtimeStarted) return;
    realtimeStarted = true;
    db.channel('ehsan-live')
      .on('postgres_changes', {event: '*', schema: 'public', table: 'meetings'}, () => loadMeetings())
      .on('postgres_changes', {event: '*', schema: 'public', table: 'tasks'}, () => loadTasks())
      .on('postgres_changes', {event: '*', schema: 'public', table: 'notifications'}, () => loadNotifications())
      .on('postgres_changes', {event: '*', schema: 'public', table: 'internal_mail'}, () => loadMail())
      .subscribe();
  }

  async function boot() {
    try {
      if (!await hydrateUser()) return;
      bindUI();
      await Promise.all([loadCommittees(), loadProfiles(), loadMeetings(), loadTasks(), loadNotifications(), loadMail()]);
      realtime();
    } catch (err) {
      loadFailed('بيانات المنصة', err);
    }
  }
  // يُحمَّل هذا الملف ديناميكيًا بعد اكتمال الصفحة، لذا لا يمكن الاعتماد على DOMContentLoaded وحده
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
