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
  const goTo = v => window.ehsanActivateView ? window.ehsanActivateView(v) : window.showView?.(v);

  async function session() { return (await db.auth.getSession()).data.session; }
  async function profile(userId) { const {data} = await db.from('profiles').select('*').eq('id', userId).single(); return data; }

  function loginScreen() {
    if (q('#authGate')) return;
    const gate = document.createElement('div'); gate.id = 'authGate'; gate.innerHTML = `
      <div class="auth-card"><img src="assets/logo.svg" alt="شعار جمعية الإحسان"><h2>منصة الاجتماعات</h2><p>تسجيل الدخول إلى حسابك المؤسسي</p>
      <form id="authForm"><label>البريد الإلكتروني<input name="email" type="email" required></label><label>كلمة المرور<input name="password" type="password" minlength="6" required></label><button class="btn primary" type="submit">تسجيل الدخول</button></form>
      <button class="link-btn" id="signupToggle">إنشاء أول حساب / حساب جديد</button><small id="authMsg"></small></div>`;
    document.body.appendChild(gate);
    q('#authForm').onsubmit = async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const {error} = await db.auth.signInWithPassword({email: f.get('email'), password: f.get('password')});
      q('#authMsg').textContent = error ? error.message : 'تم تسجيل الدخول';
      if (!error) location.reload();
    };
    q('#signupToggle').onclick = () => {
      q('#authForm').innerHTML = `<label>الاسم الكامل<input name="full_name" required></label><label>البريد الإلكتروني<input name="email" type="email" required></label><label>كلمة المرور<input name="password" type="password" minlength="8" required></label><button class="btn primary" type="submit">إنشاء الحساب</button>`;
      q('#authForm').onsubmit = async e => {
        e.preventDefault();
        const f = new FormData(e.target);
        const {error} = await db.auth.signUp({email: f.get('email'), password: f.get('password'), options: {data: {full_name: f.get('full_name')}}});
        q('#authMsg').textContent = error ? error.message : 'تم إنشاء الحساب. إذا كان تأكيد البريد مفعلاً، افتح رسالة التأكيد ثم سجل الدخول.';
      };
    };
  }

  async function hydrateUser() {
    const s = await session();
    if (!s) { loginScreen(); return false; }
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
    if (error) return;
    setHtml('#meetingCommittee', (data || []).map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join(''));
    setHtml('#committeesGrid', (data || []).map(x => `<article><div class="committee-head"><div class="member-avatar">◉</div><div><strong>${esc(x.name)}</strong><div class="meta">${esc(x.description || '')}</div></div></div></article>`).join('') || '<article>لا توجد لجان.</article>');
  }

  let profiles = [];
  async function loadProfiles() {
    const {data} = await db.from('profiles').select('*').order('created_at');
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
      return `<tr><td>${esc(m.title)}</td><td>${esc(m.committees?.name || '')}</td><td>${esc(m.gregorian_date)}</td><td>${esc(m.start_time?.slice(0, 5) || '')}</td><td>${esc(m.mode)}</td><td><span class="status-pill">${esc(m.status)}</span></td><td>${m.attachments?.[0]?.count || 0}</td><td>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">فتح الرابط</a>` : '—'}</td></tr>`;
    }).join('') || '<tr><td colspan="8">لا توجد اجتماعات مطابقة.</td></tr>');
  }

  async function loadMeetings() {
    const {data, error} = await db.from('meetings').select('*,committees(name),attachments(count)').order('gregorian_date', {ascending: true});
    if (error) return;
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
    const s = await session();
    if (!s) return;
    const f = new FormData(form);
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
      if (agErr) failures.push('جدول الأعمال');
    }
    for (const file of [...(q('#meetingFiles')?.files || [])]) {
      const path = `${data.id}/${crypto.randomUUID()}-${file.name}`;
      const up = await db.storage.from('meeting-files').upload(path, file);
      const rec = up.error ? up : await db.from('attachments').insert({meeting_id: data.id, file_name: file.name, storage_path: path, mime_type: file.type, size_bytes: file.size, uploaded_by: s.user.id});
      if (rec.error) failures.push(file.name);
    }
    notify(failures.length ? `تم حفظ الاجتماع، لكن تعذر حفظ: ${failures.join('، ')}` : 'تم حفظ الاجتماع مركزيًا وإتاحته للمستخدمين المخولين');
    form.reset();
    setHtml('#filePreview', '');
    setHtml('#agendaRows', '');
    window.addAgendaRow?.();
    await loadMeetings();
    goTo('meetings');
  }

  let tasksCache = [];
  async function loadTasks() {
    const {data} = await db.from('tasks').select('*,profiles!tasks_assignee_id_fkey(full_name)').order('created_at', {ascending: false});
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
    const {data} = await db.from('notifications').select('*').eq('user_id', s.user.id).order('created_at', {ascending: false});
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
    const {data} = await db.from('internal_mail').select('*,sender:profiles!internal_mail_sender_id_fkey(full_name),recipient:profiles!internal_mail_recipient_id_fkey(full_name)').or(`sender_id.eq.${s.user.id},recipient_id.eq.${s.user.id}`).order('created_at', {ascending: false});
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

  function bindUI() {
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
        await db.from('notifications').update({is_read: true}).eq('id', read.dataset.id);
        loadNotifications();
      }
    });
  }

  function realtime() {
    db.channel('ehsan-live')
      .on('postgres_changes', {event: '*', schema: 'public', table: 'meetings'}, () => loadMeetings())
      .on('postgres_changes', {event: '*', schema: 'public', table: 'tasks'}, () => loadTasks())
      .on('postgres_changes', {event: '*', schema: 'public', table: 'notifications'}, () => loadNotifications())
      .on('postgres_changes', {event: '*', schema: 'public', table: 'internal_mail'}, () => loadMail())
      .subscribe();
  }

  async function boot() {
    if (!await hydrateUser()) return;
    bindUI();
    await Promise.all([loadCommittees(), loadProfiles(), loadMeetings(), loadTasks(), loadNotifications(), loadMail()]);
    realtime();
  }
  // يُحمَّل هذا الملف ديناميكيًا بعد اكتمال الصفحة، لذا لا يمكن الاعتماد على DOMContentLoaded وحده
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
