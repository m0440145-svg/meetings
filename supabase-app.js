(() => {
  const cfg = window.EHSAN_SUPABASE;
  if (!cfg || !window.supabase) return;
  const db = window.supabase.createClient(cfg.url, cfg.publishableKey);
  window.ehsanDB = db;

  const q = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const notify = msg => window.showToast ? window.showToast(msg) : alert(msg);

  async function session() { return (await db.auth.getSession()).data.session; }
  async function profile(userId) { const {data}=await db.from('profiles').select('*').eq('id',userId).single(); return data; }

  function loginScreen() {
    if (q('#authGate')) return;
    const gate=document.createElement('div'); gate.id='authGate'; gate.innerHTML=`
      <div class="auth-card"><img src="assets/logo.svg" alt="شعار جمعية الإحسان"><h2>منصة الاجتماعات</h2><p>تسجيل الدخول إلى حسابك المؤسسي</p>
      <form id="authForm"><label>البريد الإلكتروني<input name="email" type="email" required></label><label>كلمة المرور<input name="password" type="password" minlength="6" required></label><button class="btn primary" type="submit">تسجيل الدخول</button></form>
      <button class="link-btn" id="signupToggle">إنشاء أول حساب / حساب جديد</button><small id="authMsg"></small></div>`;
    document.body.appendChild(gate);
    q('#authForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);const {error}=await db.auth.signInWithPassword({email:f.get('email'),password:f.get('password')});q('#authMsg').textContent=error?error.message:'تم تسجيل الدخول';if(!error) location.reload();};
    q('#signupToggle').onclick=()=>{q('#authForm').innerHTML=`<label>الاسم الكامل<input name="full_name" required></label><label>البريد الإلكتروني<input name="email" type="email" required></label><label>كلمة المرور<input name="password" type="password" minlength="8" required></label><button class="btn primary" type="submit">إنشاء الحساب</button>`;q('#authForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);const {error}=await db.auth.signUp({email:f.get('email'),password:f.get('password'),options:{data:{full_name:f.get('full_name')}}});q('#authMsg').textContent=error?error.message:'تم إنشاء الحساب. إذا كان تأكيد البريد مفعلاً، افتح رسالة التأكيد ثم سجل الدخول.';};};
  }

  async function hydrateUser() {
    const s=await session(); if(!s){loginScreen();return false;}
    q('#authGate')?.remove(); const p=await profile(s.user.id);
    const btn=q('.profile-btn'); if(btn){btn.innerHTML=`<span class="avatar">${esc((p?.full_name||s.user.email)[0])}</span><span>${esc(p?.full_name||s.user.email)}</span>`;btn.title='انقر لتسجيل الخروج';btn.onclick=async()=>{await db.auth.signOut();location.reload();};}
    return true;
  }

  async function loadCommittees(){const {data,error}=await db.from('committees').select('*').order('name');if(error)return;const sel=q('#meetingCommittee');if(sel)sel.innerHTML=(data||[]).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('');const grid=q('#committeesGrid');if(grid)grid.innerHTML=(data||[]).map(x=>`<article><div class="committee-head"><div class="member-avatar">◉</div><div><strong>${esc(x.name)}</strong><div class="meta">${esc(x.description||'')}</div></div></div></article>`).join('');}

  async function loadProfiles(){const {data}=await db.from('profiles').select('*').order('created_at');const grid=q('#membersGrid');if(grid)grid.innerHTML=(data||[]).map(x=>`<article><div class="member-head"><div class="member-avatar">${esc((x.full_name||'ع')[0])}</div><div><strong>${esc(x.full_name||'عضو')}</strong><div class="meta">${esc(x.job_title||x.role)}</div></div></div><p>${esc(x.phone||'')}</p></article>`).join('');const assignee=q('#taskAssignee');if(assignee)assignee.innerHTML=(data||[]).map(x=>`<option value="${x.id}">${esc(x.full_name||'عضو')}</option>`).join('');}

  async function loadMeetings(){const {data,error}=await db.from('meetings').select('*,committees(name),attachments(count)').order('gregorian_date',{ascending:true});if(error)return;const tbody=q('#meetingsTable');if(tbody)tbody.innerHTML=(data||[]).map(m=>`<tr><td>${esc(m.title)}</td><td>${esc(m.committees?.name||'')}</td><td>${esc(m.gregorian_date)}</td><td>${esc(m.start_time?.slice(0,5)||'')}</td><td>${esc(m.mode)}</td><td><span class="status-pill">${esc(m.status)}</span></td><td>${m.attachments?.[0]?.count||0}</td><td>${m.meeting_url?`<a href="${esc(m.meeting_url)}" target="_blank">فتح الرابط</a>`:'—'}</td></tr>`).join('');const future=(data||[]).filter(m=>new Date(m.gregorian_date+'T23:59:59')>=new Date());['#statMeetings','#homeMeetings'].forEach(id=>{if(q(id))q(id).textContent=future.length});const listHtml=future.slice(0,5).map(m=>`<div class="list-item"><strong>${esc(m.title)}</strong><div class="meta"><span>${esc(m.gregorian_date)}</span><span>${esc(m.start_time?.slice(0,5)||'')}</span><span>${esc(m.committees?.name||'')}</span></div></div>`).join('')||'<div class="list-item">لا توجد اجتماعات قادمة.</div>';if(q('#upcomingList'))q('#upcomingList').innerHTML=listHtml;if(q('#homeUpcomingList'))q('#homeUpcomingList').innerHTML=listHtml;}

  async function saveMeeting(e){e.preventDefault();const s=await session();if(!s)return;const f=new FormData(e.target);const payload={title:f.get('title'),committee_id:f.get('committee'),gregorian_date:f.get('date'),hijri_date:f.get('hijri'),start_time:f.get('time'),end_time:f.get('endTime')||null,mode:f.get('mode'),location:f.get('location'),platform:f.get('platform'),meeting_url:f.get('meetingUrl')||null,description:f.get('description'),created_by:s.user.id,status:'مجدول'};const {data,error}=await db.from('meetings').insert(payload).select().single();if(error){notify('تعذر حفظ الاجتماع: '+error.message);return;}const rows=[...document.querySelectorAll('#agendaRows .agenda-row')];for(let i=0;i<rows.length;i++){const inputs=rows[i].querySelectorAll('input');const title=inputs[0]?.value;if(title)await db.from('agenda_items').insert({meeting_id:data.id,item_order:i+1,title,duration_minutes:Number(inputs[1]?.value)||10});}const files=[...(q('#meetingFiles')?.files||[])];for(const file of files){const path=`${data.id}/${crypto.randomUUID()}-${file.name}`;const up=await db.storage.from('meeting-files').upload(path,file);if(!up.error)await db.from('attachments').insert({meeting_id:data.id,file_name:file.name,storage_path:path,mime_type:file.type,size_bytes:file.size,uploaded_by:s.user.id});}notify('تم حفظ الاجتماع مركزيًا وإتاحته للمستخدمين المخولين');e.target.reset();await loadMeetings();}

  async function loadTasks(){const {data}=await db.from('tasks').select('*,profiles!tasks_assignee_id_fkey(full_name)').order('created_at',{ascending:false});const open=(data||[]).filter(x=>x.status!=='مكتملة');['#statTasks','#homeTasks'].forEach(id=>{if(q(id))q(id).textContent=open.length});const cols={جديدة:q('#tasksTodo'), 'قيد التنفيذ':q('#tasksDoing'), مكتملة:q('#tasksDone'), متأخرة:q('#tasksDoing')};Object.values(cols).forEach(el=>{if(el)el.innerHTML=''});(data||[]).forEach(t=>{const el=cols[t.status]||cols['جديدة'];if(el)el.insertAdjacentHTML('beforeend',`<div class="task-card"><strong>${esc(t.title)}</strong><small>${esc(t.profiles?.full_name||'غير مسند')} • ${esc(t.due_date||'بدون موعد')}</small></div>`)});}

  async function loadNotifications(){const s=await session();if(!s)return;const {data}=await db.from('notifications').select('*').eq('user_id',s.user.id).order('created_at',{ascending:false});const unread=(data||[]).filter(x=>!x.is_read).length;if(q('#notifBadge'))q('#notifBadge').textContent=unread;if(q('#homeNotifications'))q('#homeNotifications').textContent=unread;const html=(data||[]).slice(0,8).map(n=>`<div class="list-item"><strong>${esc(n.title)}</strong><div>${esc(n.body||'')}</div><div class="meta">${new Date(n.created_at).toLocaleString('ar-SA')}</div></div>`).join('')||'<div class="list-item">لا توجد إشعارات.</div>';if(q('#recentNotifications'))q('#recentNotifications').innerHTML=html;if(q('#homeRecentNotifications'))q('#homeRecentNotifications').innerHTML=html;const list=q('#notificationsList');if(list)list.innerHTML=html;}

  async function loadMail(){const s=await session();if(!s)return;const {data}=await db.from('internal_mail').select('*,sender:profiles!internal_mail_sender_id_fkey(full_name),recipient:profiles!internal_mail_recipient_id_fkey(full_name)').or(`sender_id.eq.${s.user.id},recipient_id.eq.${s.user.id}`).order('created_at',{ascending:false});const list=q('#mailList');if(list)list.innerHTML=(data||[]).map(m=>`<div class="mail-item"><strong>${esc(m.subject)}</strong><div>${esc(m.body)}</div><small>${esc(m.sender?.full_name||'')} ← ${esc(m.recipient?.full_name||'')}</small></div>`).join('')||'<div class="mail-item">لا توجد رسائل.</div>';}

  async function realtime(){db.channel('ehsan-live').on('postgres_changes',{event:'*',schema:'public',table:'meetings'},loadMeetings).on('postgres_changes',{event:'*',schema:'public',table:'tasks'},loadTasks).on('postgres_changes',{event:'*',schema:'public',table:'notifications'},loadNotifications).on('postgres_changes',{event:'*',schema:'public',table:'internal_mail'},loadMail).subscribe();}

  async function boot(){if(!await hydrateUser())return;const form=q('#meetingForm');if(form){form.onsubmit=saveMeeting;}await Promise.all([loadCommittees(),loadProfiles(),loadMeetings(),loadTasks(),loadNotifications(),loadMail()]);realtime();}
  window.addEventListener('DOMContentLoaded',boot);
})();
