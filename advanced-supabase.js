(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const toast = m => window.showToast ? window.showToast(m) : alert(m);
  const wait = () => new Promise(r => setTimeout(r, 500));
  async function DB() { for (let i = 0; i < 20; i++) { if (window.ehsanDB) return window.ehsanDB; await wait(); } return null; }
  async function U(d) { return (await d.auth.getUser()).data.user; }
  async function log(d, a, t, id = null, x = {}) { const u = await U(d); if (u) await d.from('audit_logs').insert({user_id: u.id, action: a, entity_type: t, entity_id: id, metadata: x}); }

  async function populate(d) {
    const ms = (await d.from('meetings').select('id,title,committee_id,gregorian_date,start_time').order('gregorian_date', {ascending: false})).data || [];
    ['#minutesMeeting', '#voteMeeting', '#attendanceMeeting'].forEach(id => {
      const e = $(id);
      if (!e) return;
      const current = e.value;
      e.innerHTML = '<option value="">اختر الاجتماع</option>' + ms.map(m => `<option value="${m.id}">${esc(m.title)} — ${esc(m.gregorian_date)}</option>`).join('');
      e.value = current;
    });
  }

  async function load(d) {
    const viewer=await U(d);
    const permission=viewer?(await d.from('profiles').select('role,is_active').eq('id',viewer.id).single()).data:null;
    const canManage=permission?.is_active&&['admin','board_chair','secretary'].includes(permission.role);
    const canVote=permission?.is_active&&['admin','board_chair','secretary','member'].includes(permission.role);
    if($('#voteForm'))$('#voteForm').hidden=!canManage;
    if($('#minutesForm'))$('#minutesForm').hidden=!canManage;
    const [v, m, inv, docs] = await Promise.all([
      d.from('votes').select('*').order('created_at', {ascending: false}),
      d.from('minutes').select('*,meetings(title),signatures(*)').order('created_at', {ascending: false}),
      d.from('meeting_invitations').select('*,meetings(title)').order('created_at', {ascending: false}),
      d.from('ai_documents').select('*').order('updated_at', {ascending: false}).limit(50)
    ]);
    const tally = {};
    for(const vote of v.data || []) { if(vote.status==='مغلق') { const r=await d.rpc('meeting_vote_results',{p_vote:vote.id}); if(!r.error)tally[vote.id]=r.data; } }
    if ($('#votesList')) $('#votesList').innerHTML = (v.data || []).map(x => {
      const r=tally[x.id];
      return `<article><h3>${esc(x.question)}</h3><div class="meta">النوع: ${esc(x.vote_type)} • الحالة: ${esc(x.status)} • النصاب: ${x.quorum_required}</div><p>${r?`موافق ${r.yes} | غير موافق ${r.no} | ممتنع ${r.abstain}`:'تظهر النتيجة بعد إغلاق التصويت'}</p><div class="form-actions">${x.status==='مفتوح'&&canVote?['موافق','غير موافق','ممتنع'].map(choice=>`<button class="btn small ghost db-vote" data-id="${x.id}" data-choice="${choice}">${choice}</button>`).join('')+(canManage?`<button class="btn small ghost close-vote" data-id="${x.id}">إغلاق التصويت</button>`:''):''}</div></article>`;
    }).join('') || '<article>لا توجد تصويتات.</article>';
    if ($('#minutesList')) $('#minutesList').innerHTML = (m.data || []).map(x => `<article><h3>${esc(x.meetings?.title || 'محضر')}</h3><span class="tag">${esc(x.status)}</span><p>${esc(String(x.content ?? '').slice(0, 220))}</p><div class="meta">التوقيعات: ${(x.signatures || []).length}</div>${x.status==='مسودة'&&canManage?`<button class="btn small ghost transition-minute" data-id="${x.id}" data-status="معروض للاعتماد">رفع للاعتماد</button>`:''}${x.status==='معروض للاعتماد'&&permission?.role==='board_chair'?`<button class="btn small ghost transition-minute" data-id="${x.id}" data-status="معتمد داخليًا">اعتماد داخلي وقفل النسخة</button>`:''}<button class="btn small primary sign-minute" data-id="${x.id}">التوقيع الرسمي — متطلبات التفعيل</button></article>`).join('') || '<article>لا توجد محاضر.</article>';
    const signed = (m.data || []).filter(x => (x.signatures || []).length).length;
    ['#statSigned', '#homeMinutes'].forEach(id => { if ($(id)) $(id).textContent = signed; });
    if ($('#invitationsList')) $('#invitationsList').innerHTML = (inv.data || []).map(x => `<div class="list-item"><strong>${esc(x.meetings?.title)}</strong><span>${esc(x.email || x.phone || 'عضو')}</span><span class="tag">${esc(x.status)}</span></div>`).join('') || '<div class="list-item">لا توجد دعوات.</div>';
    window.__ehsanDocs = docs.data || [];
  }

  function canvasIsBlank(c) {
    const blank = document.createElement('canvas');
    blank.width = c.width; blank.height = c.height;
    return c.toDataURL() === blank.toDataURL();
  }

  async function bind(d) {
    $('#voteForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      const form = e.currentTarget;
      const meeting_id = $('#voteMeeting')?.value, question = $('#voteTitle')?.value?.trim();
      if (!meeting_id || !question) return toast('اختر الاجتماع وأدخل موضوع التصويت');
      const u = await U(d);
      const {data, error} = await d.rpc('open_meeting_vote',{p_meeting:meeting_id,p_question:question,p_secret:$('#voteType')?.value==='سري'});
      if (error) return toast(error.message);
      // The transaction records the authoritative audit event.
      form.reset();
      toast('تم فتح التصويت');
      load(d);
    });

    $('#minutesForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      const form = e.currentTarget;
      const meeting_id = $('#minutesMeeting')?.value;
      if (!meeting_id) return toast('اختر الاجتماع');
      const content = $('#minutesText')?.value?.trim() || $('#liveTranscript')?.value?.trim();
      if (!content) return toast('أدخل نص المحضر');
      const improvements = $('#minutesImprovement')?.value || '';
      const u = await U(d);
      const {data, error} = await d.from('minutes').insert({meeting_id, content, recommendations: improvements, improvement_opportunities: improvements, status: 'مسودة', created_by: u.id}).select().single();
      if (error) return toast(error.message);
      await d.from('ai_documents').insert({entity_type: 'minute', entity_id: data.id, title: 'محضر اجتماع', content});
      await log(d, 'حفظ محضر', 'minute', data.id);
      let msg = 'تم حفظ المحضر كمسودة؛ لم يتم توقيعه رسميًا';
      const c = $('#signatureCanvas');
      if (c && !canvasIsBlank(c)) {
        msg += '. الرسم اليدوي ليس توقيعًا رسميًا ولم يُرسل للاعتماد';
      }
      form.reset();
      toast(msg);
      load(d);
    });

    document.addEventListener('click', async e => {
      let b = e.target.closest('.db-vote');
      if (b) {
        const u = await U(d);
        const {error} = await d.rpc('cast_meeting_vote',{p_vote:b.dataset.id,p_choice:b.dataset.choice});
        if (error) return toast(error.message);
        // Never send ballot choice to the audit log.
        toast('تم توثيق صوتك');
        load(d);
        return;
      }
      b=e.target.closest('.close-vote');
      if(b){const r=await d.rpc('close_meeting_vote',{p_vote:b.dataset.id});if(r.error)return toast(r.error.message);await load(d);return;}
      b=e.target.closest('.transition-minute');
      if(b){const r=await d.rpc('transition_meeting_minute',{p_minute:b.dataset.id,p_status:b.dataset.status});if(r.error)return toast(r.error.message);await load(d);return;}
      b = e.target.closest('.sign-minute');
      if (b) {
        toast('التوقيع الرسمي غير مربوط بعد. يتطلب تفعيل API آمن مع ehsan.parq.sa والتحقق من نتيجة التوقيع. لم يتم توقيع المحضر.');
        return;
      }
      b = e.target.closest('.open-secure-file');
      if (b) {
        const u = await U(d);
        const p = (await d.from('profiles').select('full_name').eq('id', u.id).single()).data;
        const wm = `${p?.full_name || u.email} • ${new Date().toLocaleString('ar-SA')}`;
        await d.from('document_watermarks').upsert({attachment_id: b.dataset.id, user_id: u.id, watermark_text: wm});
        b.title = 'علامة مائية: ' + wm;
      }
    });

    $('#markAttendance')?.addEventListener('click', async () => {
      const meeting_id = $('#attendanceMeeting')?.value;
      if (!meeting_id) return toast('اختر الاجتماع');
      const u = await U(d);
      const status = $('#attendanceStatus')?.value || 'حاضر';
      const {error} = await d.rpc('record_meeting_attendance',{p_meeting:meeting_id,p_member:u.id,p_status:status});
      if (error) return toast(error.message);
      await log(d, 'تسجيل حضور', 'meeting', meeting_id, {status});
      toast('تم تسجيل الحالة');
    });

    $('#sendInvitations')?.addEventListener('click', async e => {
      const meeting_id = $('#attendanceMeeting')?.value;
      if (!meeting_id) return toast('اختر الاجتماع');
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const ms = (await d.from('meetings').select('committee_id,title,gregorian_date,start_time').eq('id', meeting_id).single()).data;
        if (!ms) return toast('تعذر قراءة بيانات الاجتماع');
        const members = (await d.from('committee_members').select('user_id,profiles(id,phone)').eq('committee_id', ms.committee_id)).data || [];
        const u = await U(d);
        for (const x of members) {
          const invitation = await d.from('meeting_invitations').insert({meeting_id, user_id: x.user_id, phone: x.profiles?.phone, status: 'مجدولة', created_by: u.id});
          if (invitation.error) throw invitation.error;
          const notification = await d.from('notifications').insert({user_id: x.user_id, title: 'دعوة اجتماع', body: `${ms.title} — ${ms.gregorian_date} ${ms.start_time || ''}`});
          if (notification.error) throw notification.error;
        }
        await log(d, 'إنشاء دعوات الاجتماع', 'meeting', meeting_id, {count: members.length});
        toast(`تم إنشاء ${members.length} دعوة داخلية. البريد وواتساب غير مفعّلين`);
        load(d);
      } catch (error) {
        toast('تعذر إكمال الدعوات؛ قد تكون بعض الدعوات حُفظت. راجع السجل قبل إعادة المحاولة: ' + error.message);
      } finally {
        btn.disabled = false;
      }
    });

    $('#semanticSearch')?.addEventListener('click', async () => {
      // الفاصلة والأقواس و% لها معنى في صيغة فلتر PostgREST، فنحذفها من عبارة البحث
      const term = ($('#semanticQuery')?.value || '').replace(/[,()%*\\]/g, ' ').trim();
      if (!term) return toast('أدخل عبارة البحث');
      const {data, error} = await d.from('ai_documents').select('*').or(`title.ilike.%${term}%,content.ilike.%${term}%`).limit(20);
      if (error) return toast(error.message);
      const box = $('#aiOutput');
      if (box) box.innerHTML = (data || []).map(x => `<div class="list-item"><strong>${esc(x.title || x.entity_type)}</strong><p>${esc(String(x.content ?? '').slice(0, 350))}</p></div>`).join('') || 'لا توجد نتائج.';
    });
  }

  async function start() {
    const d = await DB();
    if (!d) return;
    await populate(d);
    await bind(d);
    await load(d);
    d.channel('prod-live')
      .on('postgres_changes', {event: '*', schema: 'public', table: 'meetings'}, () => populate(d))
      .on('postgres_changes', {event: '*', schema: 'public', table: 'votes'}, () => load(d))
      .on('postgres_changes', {event: '*', schema: 'public', table: 'vote_responses'}, () => load(d))
      .on('postgres_changes', {event: '*', schema: 'public', table: 'minutes'}, () => load(d))
      .on('postgres_changes', {event: '*', schema: 'public', table: 'signatures'}, () => load(d))
      .on('postgres_changes', {event: '*', schema: 'public', table: 'meeting_invitations'}, () => load(d))
      .subscribe();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

