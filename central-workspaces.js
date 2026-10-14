(() => {
  const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const toast=m=>window.showToast?window.showToast(m):alert(m);
  let d,user,role,meeting='',meetings=[],generation=0;
  async function result(request){const r=await request;if(r.error)throw r.error;return r.data;}
  function requireMeeting(){if(!meeting)throw new Error('اختر الاجتماع المرتبط أولًا');return meeting;}
  const manager=()=>['admin','board_chair','secretary'].includes(role);
  function on(selector,event,fn){$(selector)?.addEventListener(event,async e=>{try{await fn(e)}catch(error){toast('تعذر إكمال العملية: '+error.message)}});}
  function download(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function modal(title,body,save){window.openModal(title,body,async()=>{try{await save();await refresh();toast('تم الحفظ في قاعدة البيانات')}catch(e){toast('لم يكتمل الحفظ: '+e.message)}});}
  async function refresh(){
    const token=++generation;
    if(!meeting)return;
    const [transcripts,boards,files,polls,circulars,events,quorum,roster]=await Promise.all([
      result(d.from('transcripts').select('*').eq('meeting_id',meeting).order('created_at',{ascending:false}).limit(1)),
      result(d.from('whiteboards').select('*').eq('meeting_id',meeting).order('updated_at',{ascending:false}).limit(1)),
      result(d.from('attachments').select('*').eq('meeting_id',meeting)),
      result(d.from('schedule_polls').select('*,schedule_poll_options(*,schedule_poll_responses(user_id))').eq('meeting_id',meeting)),
      result(d.from('circular_decisions').select('*,circular_responses(user_id,choice)').eq('meeting_id',meeting)),
      result(d.from('meeting_events').select('*').eq('meeting_id',meeting).order('id',{ascending:false}).limit(100)),
      result(d.rpc('meeting_quorum',{p_meeting:meeting})),
      result(d.from('meeting_attendees').select('*,profiles(full_name)').eq('meeting_id',meeting))
    ]);
    if(token!==generation)return;
    if($('#liveTranscript'))$('#liveTranscript').value=transcripts[0]?.content||'';
    if($('#whiteboard'))$('#whiteboard').textContent=boards[0]?.content||'';
    if($('#centralQuorum'))$('#centralQuorum').textContent=`النصاب المعتمد: ${quorum.percent??'غير محدد'}% | الحضور: ${quorum.present} من ${quorum.total} | المطلوب: ${quorum.required??'—'} | ${quorum.complete?'مكتمل':'غير مكتمل — ناقص '+quorum.missing}`;
    if($('#attendanceMember'))$('#attendanceMember').innerHTML=roster.map(a=>`<option value="${esc(a.user_id)}">${esc(a.profiles?.full_name||a.user_id)} — ${esc(a.attendance_status)}</option>`).join('');
    const fileHtml=files.map(f=>`<div class="reading-row"><strong>${esc(f.file_name)}</strong><button class="btn small ghost" data-cloud-file="${esc(f.id)}">فتح الملف المحمي</button><small>${esc(f.size_bytes)} بايت</small></div>`).join('')||'<p>لا توجد مرفقات لهذا الاجتماع.</p>';
    if($('#filesList'))$('#filesList').innerHTML=fileHtml;
    if($('#vdrFiles'))$('#vdrFiles').innerHTML=fileHtml;
    if($('#schedulePolls'))$('#schedulePolls').innerHTML=polls.map(p=>`<article><strong>${esc(p.title)}</strong>${p.schedule_poll_options.map(o=>`<p>${esc(new Date(o.option_time).toLocaleString('ar-SA'))} — ${o.schedule_poll_responses.length} رد <button class="btn small ghost" data-cloud-option="${esc(o.id)}" ${p.status!=='مفتوح'?'disabled':''}>مناسب</button></p>`).join('')}</article>`).join('')||'<p>لا توجد استطلاعات.</p>';
    if($('#circularsList'))$('#circularsList').innerHTML=circulars.map(c=>`<article><strong>${esc(c.title)}</strong><p>${esc(c.description)}</p><p>${esc(c.status)} — الردود: ${c.circular_responses.length}</p>${['موافق','غير موافق','ممتنع'].map(choice=>`<button class="btn small ghost" data-cloud-circular="${esc(c.id)}" data-choice="${choice}" ${c.status!=='مفتوح'?'disabled':''}>${choice}</button>`).join('')}<p>التوقيع الرسمي غير مفعل.</p></article>`).join('')||'<p>لا توجد قرارات بالتمرير.</p>';
    if($('#auditList'))$('#auditList').innerHTML=events.map(a=>`<div class="audit-item"><span>${esc(new Date(a.happened_at).toLocaleString('ar-SA'))}</span><strong>${esc(a.action)}</strong><span>${esc(a.actor_id)}</span></div>`).join('')||'<p>لا توجد أحداث.</p>';
    window.meetingWorkspaceRefresh=refresh;
  }
  async function start(){
    for(let i=0;i<40&&!window.ehsanDB;i++)await new Promise(r=>setTimeout(r,250));
    d=window.ehsanDB;if(!d)return;
    user=(await d.auth.getUser()).data.user;if(!user)return;
    const p=await result(d.from('profiles').select('role,is_active').eq('id',user.id).single());if(!p.is_active)return;role=p.role;
    meetings=await result(d.from('meetings').select('id,title,committee_id,status').order('gregorian_date',{ascending:false}));
    for(const id of ['view-live','view-files','view-schedule','view-circulars','view-vdr','view-security','view-settings']){
      const host=$('#'+id);if(!host)continue;
      const label=document.createElement('label');label.textContent='الاجتماع المرتبط';
      const select=document.createElement('select');select.className='central-meeting';select.innerHTML='<option value="">اختر الاجتماع</option>'+meetings.map(m=>`<option value="${esc(m.id)}">${esc(m.title)}</option>`).join('');
      label.append(select);host.prepend(label);
      select.onchange=async()=>{meeting=select.value;$$('.central-meeting').forEach(s=>s.value=meeting);try{await refresh()}catch(e){toast('تعذر قراءة البيانات المركزية: '+e.message)}};
    }
    async function reloadMeetings(){meetings=await result(d.from('meetings').select('id,title,committee_id,status').order('gregorian_date',{ascending:false}));$$('.central-meeting').forEach(s=>{s.innerHTML='<option value="">اختر الاجتماع</option>'+meetings.map(m=>`<option value="${esc(m.id)}">${esc(m.title)}</option>`).join('');s.value=meeting;});}
    document.addEventListener('meetings-changed',()=>reloadMeetings().catch(e=>toast(e.message)));
    const host=$('#view-live');if(host){const panel=document.createElement('article');panel.className='card';panel.innerHTML='<h3>دورة الاجتماع والنصاب الفعلي</h3><p id="centralQuorum">اختر اجتماعًا</p><div class="form-actions"><button id="prepareRoster" class="btn ghost">تحديد الأعضاء المصوّتين</button><button id="startMeeting" class="btn primary">بدء الاجتماع</button><button id="finishMeeting" class="btn ghost">إنهاء الاجتماع</button></div><label>العضو<select id="attendanceMember"></select></label><button id="centralPresent" class="btn ghost">تسجيل حضوره فعليًا</button><button id="centralAbsent" class="btn ghost">تسجيل غيابه</button>';host.prepend(panel);}
    const saveBoard=document.createElement('button');saveBoard.id='saveWhiteboard';saveBoard.className='btn primary';saveBoard.textContent='حفظ نسخة من السبورة';$('#whiteboard')?.after(saveBoard);
    const refreshButton=document.createElement('button');refreshButton.id='refreshWorkspace';refreshButton.className='btn ghost';refreshButton.textContent='تحديث من قاعدة البيانات';$('#centralQuorum')?.after(refreshButton);on('#refreshWorkspace','click',refresh);
    if(!manager())$$('#prepareRoster,#startMeeting,#finishMeeting,#centralPresent,#centralAbsent,#saveTranscript,#saveWhiteboard,#newSchedulePoll,#newCircular,#globalFiles').forEach(e=>e.disabled=true);
    on('#saveTranscript','click',async()=>{await result(d.from('transcripts').insert({meeting_id:requireMeeting(),content:$('#liveTranscript').value,created_by:user.id}));toast('تم حفظ نسخة التفريغ مركزيًا');});
    on('#saveWhiteboard','click',async()=>{await result(d.from('whiteboards').insert({meeting_id:requireMeeting(),content:$('#whiteboard').textContent,updated_by:user.id}));toast('تم حفظ نسخة السبورة مركزيًا');});
    on('#prepareRoster','click',async()=>{
      const mid=requireMeeting(),m=meetings.find(x=>x.id===mid);
      let people;if(m.committee_id){const rows=await result(d.from('committee_members').select('user_id,profiles(id,full_name,is_active,role)').eq('committee_id',m.committee_id));people=rows.map(x=>x.profiles).filter(Boolean)}else people=await result(d.from('profiles').select('id,full_name,is_active,role'));
      people=people.filter(x=>x.is_active&&['admin','member','secretary','board_chair'].includes(x.role));
      modal('تثبيت قائمة المؤهلين للتصويت',people.map(x=>`<label><input type="checkbox" class="roster-choice" value="${esc(x.id)}">${esc(x.full_name)}</label>`).join(''),()=>result(d.rpc('prepare_meeting_roster',{p_meeting:mid,p_members:$$('.roster-choice:checked').map(x=>x.value)})));
    });
    for(const [id,status] of [['#startMeeting','منعقد'],['#finishMeeting','مكتمل']])on(id,'click',async()=>{await result(d.rpc('transition_meeting',{p_meeting:requireMeeting(),p_status:status}));await refresh();toast('تم تحديث حالة الاجتماع: '+status)});
    for(const [id,status] of [['#centralPresent','حاضر'],['#centralAbsent','غائب']])on(id,'click',async()=>{await result(d.rpc('record_meeting_attendance',{p_meeting:requireMeeting(),p_member:$('#attendanceMember').value,p_status:status}));await refresh()});
    on('#newSchedulePoll','click',()=>{const mid=requireMeeting();modal('استطلاع موعد', '<label>العنوان<input id="cloudPollTitle" required></label><label>الموعد الأول<input id="cloudPollOne" type="datetime-local" required></label><label>الموعد الثاني<input id="cloudPollTwo" type="datetime-local" required></label>',()=>result(d.rpc('create_meeting_poll',{p_meeting:mid,p_title:$('#cloudPollTitle').value,p_options:[$('#cloudPollOne').value,$('#cloudPollTwo').value].map(x=>new Date(x).toISOString())})));});
    on('#newCircular','click',()=>{const mid=requireMeeting();modal('قرار بالتمرير','<label>العنوان<input id="cloudCircularTitle"></label><label>نص القرار<textarea id="cloudCircularText"></textarea></label>',()=>result(d.from('circular_decisions').insert({meeting_id:mid,title:$('#cloudCircularTitle').value,description:$('#cloudCircularText').value,status:'مفتوح',created_by:user.id})));});
    on('#globalFiles','change',async e=>{const mid=requireMeeting();for(const file of e.target.files){const path=`${mid}/${crypto.randomUUID()}-${file.name.replace(/[^\p{L}\p{N}._-]/gu,'_')}`;await result(d.storage.from('meeting-files').upload(path,file));await result(d.from('attachments').insert({meeting_id:mid,file_name:file.name,storage_path:path,mime_type:file.type,size_bytes:file.size,uploaded_by:user.id}));}e.target.value='';await refresh();toast('حُفظت الملفات في التخزين المركزي');});
    on('#addVdrDoc','click',()=>{$('#globalFiles')?.click();toast('اختر الملف الفعلي واربطه بالاجتماع؛ لا يتم إنشاء مستندات وهمية')});
    document.addEventListener('click',async e=>{try{
      const file=e.target.closest('[data-cloud-file]');if(file){const f=await result(d.from('attachments').select('storage_path').eq('id',file.dataset.cloudFile).single());const r=await result(d.storage.from('meeting-files').createSignedUrl(f.storage_path,60));const link=document.createElement('a');link.href=r.signedUrl;link.target='_blank';link.rel='noopener noreferrer';link.click();return;}
      const option=e.target.closest('[data-cloud-option]');if(option){await result(d.from('schedule_poll_responses').insert({option_id:option.dataset.cloudOption,user_id:user.id,preference:'مناسب'}));await refresh();return;}
      const circular=e.target.closest('[data-cloud-circular]');if(circular){await result(d.from('circular_responses').insert({circular_id:circular.dataset.cloudCircular,user_id:user.id,choice:circular.dataset.choice}));await refresh();}
    }catch(error){toast('تعذر إكمال العملية: '+error.message)}});
    on('#exportData','click',async()=>{const mid=requireMeeting(),data={kind:'authorized-meeting-export',meeting:mid,exportedAt:new Date().toISOString(),tables:{}};for(const table of ['transcripts','whiteboards','minutes','tasks','attachments','meeting_events','schedule_polls','circular_decisions'])data.tables[table]=await result(d.from(table).select('*').eq('meeting_id',mid));download(data,'meeting-export.json');toast('هذا تصدير للسجلات المسموح بها؛ لا يتضمن الملفات ولا يُعد نسخة استرجاع كاملة');});
    if($('#clearData')){$('#clearData').textContent='تصدير البيانات المحلية القديمة دون حذفها';on('#clearData','click',()=>{download({legacy:localStorage.getItem('ehsan_meetings_v3'),transcript:localStorage.getItem('ehsan_live_transcript')},'legacy-review.json');toast('تحتاج مراجعة الهوية وربط الاجتماعات قبل ترحيل البيانات القديمة');});}
    if($('#settingsBox'))$('#settingsBox').innerHTML='<p>إرسال البريد وواتساب والتوقيع الرسمي غير مفعّل. إعدادات المصادقة والصلاحيات تُدار في الخادم؛ لا تغيّرها مفاتيح محلية.</p>';
    if($('#attendanceManager'))on('#attendanceManager','click',()=>window.ehsanActivateView?.('live'));
  }
  start().catch(e=>toast('تعذر تهيئة الوظائف المركزية: '+e.message));
})();
