(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const toast = m => window.showToast ? window.showToast(m) : alert(m);
  const wait = () => new Promise(r => setTimeout(r, 500));
  async function DB() { for (let i = 0; i < 20; i++) { if (window.ehsanDB) return window.ehsanDB; await wait(); } return null; }
  const SESSION_MSG = 'انتهت الجلسة، سجّل الدخول من جديد';
  async function U(d) { return (await d.auth.getUser()).data.user; }
  // سجل التدقيق يُكتب من قاعدة البيانات (triggers في supabase/migrations/001_voting_signing_hardening.sql) ولا يُكتب من العميل

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
    const [v, m, inv, docs] = await Promise.all([
      d.from('votes').select('*').order('created_at', {ascending: false}),
      d.from('minutes').select('*,meetings(title),signatures(*)').order('created_at', {ascending: false}),
      d.from('meeting_invitations').select('*,meetings(title)').order('created_at', {ascending: false}),
      d.from('ai_documents').select('*').order('updated_at', {ascending: false}).limit(50)
    ]);
    const bad = [[v, 'التصويتات'], [m, 'المحاضر'], [inv, 'الدعوات']].find(([r]) => r.error);
    if (bad) { console.error(bad[1], bad[0].error); toast(`تعذر تحميل ${bad[1]}: ${bad[0].error.message}`); }
    // الأصوات لا تُقرأ من الجدول مباشرة؛ النتائج تأتي من vote_tally (السري لا تظهر نتائجه الجزئية قبل الإغلاق)
    const votes = v.data || [];
    const tallies = await Promise.all(votes.map(x => d.rpc('vote_tally', {p_vote: x.id})));
    const tallyErr = tallies.find(t => t.error);
    if (tallyErr) toast('تعذر تحميل نتائج التصويت: ' + tallyErr.error.message);
    if ($('#votesList')) $('#votesList').innerHTML = votes.map((x, i) => {
      const t = tallies[i].data || {}, closed = x.status === 'مغلق', secret = x.vote_type === 'سري';
      const res = t.approve == null ? 'النتائج الجزئية مخفية حتى إغلاق التصويت السري.' : `موافق ${t.approve} | غير موافق ${t.reject} | ممتنع ${t.abstain}`;
      const quorum = closed ? ` • النصاب: ${t.quorum_met ? 'مكتمل' : 'غير مكتمل'}` : '';
      const mine = t.my_voted ? `<div class="meta">${secret ? 'تم تسجيل مشاركتك (الاختيار سري)' : 'صوتك: ' + esc(t.my_choice || '')}</div>` : '';
      const buttons = closed ? '<span class="tag">مغلق</span>' : t.my_voted ? '' : ['موافق', 'غير موافق', 'ممتنع'].map((c, k) => `<button class="btn small ${k ? 'ghost' : 'primary'} db-vote" data-id="${x.id}" data-choice="${c}">${c}</button>`).join('');
      const close = !closed && t.can_close ? `<button class="btn small ghost close-vote" data-id="${x.id}">إغلاق التصويت</button>` : '';
      return `<article><h3>${esc(x.question)}</h3><div class="meta">النوع: ${esc(x.vote_type)} • النصاب المطلوب: ${x.quorum_required || '—'} • المشاركون: ${t.voted ?? 0}${quorum}</div><p>${res}</p>${mine}<div class="form-actions">${buttons}${close}</div></article>`;
    }).join('') || '<article>لا توجد تصويتات.</article>';
    if ($('#minutesList')) $('#minutesList').innerHTML = (m.data || []).map(x => {
      const n = (x.signatures || []).length, need = x.required_signatures || 1, approved = x.status === 'معتمد';
      const sign = approved ? '' : `<button class="btn small primary sign-minute" data-id="${x.id}">توقيع المحضر</button>`;
      const approve = !approved && n >= need ? `<button class="btn small ghost approve-minute" data-id="${x.id}">اعتماد المحضر</button>` : '';
      return `<article><h3>${esc(x.meetings?.title || 'محضر')}</h3><span class="tag">${esc(x.status)}</span><p>${esc(String(x.content ?? '').slice(0, 220))}</p><div class="meta">التوقيعات: ${n} من ${need} مطلوبة</div><div class="form-actions">${sign}${approve}<button class="btn small ghost dm-extract" data-id="${x.id}" type="button">استخراج قرارات</button></div></article>`;
    }).join('') || '<article>لا توجد محاضر.</article>';
    const signed = (m.data || []).filter(x => x.status === 'معتمد').length; // "معتمدة" تعني معتمدة فعلًا لا موقّعة من شخص واحد
    ['#statSigned', '#homeMinutes'].forEach(id => { if ($(id)) $(id).textContent = signed; });
    if ($('#invitationsList')) $('#invitationsList').innerHTML = (inv.data || []).map(x => `<div class="list-item"><strong>${esc(x.meetings?.title)}</strong><span>${esc(x.email || x.phone || 'عضو')}</span><span class="tag">${esc(x.status)}</span></div>`).join('') || '<div class="list-item">لا توجد دعوات.</div>';
    window.__ehsanDocs = docs.data || [];
  }

  function canvasIsBlank(c) {
    const blank = document.createElement('canvas');
    blank.width = c.width; blank.height = c.height;
    return c.toDataURL() === blank.toDataURL();
  }

  // التوقيع يُسجَّل في الخادم (sign_minute) مع بصمة SHA-256 لنص المحضر؛ صورة التوقيع اختيارية
  async function signMinute(d, u, minuteId, pngBlob) {
    let path = null;
    if (pngBlob) {
      path = `signatures/${minuteId}/${u.id}-${Date.now()}.png`;
      const up = await d.storage.from('meeting-files').upload(path, pngBlob);
      if (up.error) return up.error;
    }
    const {error} = await d.rpc('sign_minute', {p_minute: minuteId, p_signature_path: path});
    return error || null;
  }

  let bound = false;
  async function bind(d) {
    if (bound) return; // منع تكرار المستمعين (تسجيل صوت/توقيع مرتين)
    bound = true;
    $('#voteForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      const form = e.currentTarget;
      const meeting_id = $('#voteMeeting')?.value, question = $('#voteTitle')?.value?.trim();
      if (!meeting_id || !question) return toast('اختر الاجتماع وأدخل موضوع التصويت');
      const u = await U(d); if (!u) return toast(SESSION_MSG);
      const {error} = await d.from('votes').insert({meeting_id, question, vote_type: $('#voteType')?.value || 'معلن', quorum_required: Number($('#voteQuorum')?.value) || 1, status: 'مفتوح', created_by: u.id});
      if (error) return toast(error.message);
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
      const u = await U(d); if (!u) return toast(SESSION_MSG);
      const {data, error} = await d.from('minutes').insert({meeting_id, content, recommendations: improvements, improvement_opportunities: improvements, status: 'مسودة', created_by: u.id}).select().single();
      if (error) return toast(error.message);
      await d.from('ai_documents').insert({entity_type: 'minute', entity_id: data.id, title: 'محضر اجتماع', content});
      let msg = 'تم حفظ المحضر وأرشفته للبحث';
      const c = $('#signatureCanvas');
      if (c && !canvasIsBlank(c)) {
        const blob = await new Promise(r => c.toBlob(r, 'image/png'));
        const err = await signMinute(d, u, data.id, blob);
        msg = err ? `تم حفظ المحضر، لكن تعذر حفظ التوقيع: ${err.message}` : 'تم حفظ المحضر وتوقيعه';
        c.getContext('2d').clearRect(0, 0, c.width, c.height);
      }
      form.reset();
      toast(msg);
      load(d);
    });

    document.addEventListener('click', async e => {
      let b = e.target.closest('.db-vote');
      if (b) {
        if (b.disabled) return;
        b.disabled = true; // الصوت لا يتغير بعد تسجيله؛ نمنع النقر المزدوج
        const {error} = await d.rpc('cast_vote', {p_vote: b.dataset.id, p_choice: b.dataset.choice});
        if (error) { b.disabled = false; return toast(error.message); }
        toast('تم توثيق صوتك');
        load(d);
        return;
      }
      b = e.target.closest('.close-vote');
      if (b) {
        if (b.disabled || !confirm('إغلاق التصويت واحتساب النتيجة؟ لا يمكن التراجع.')) return;
        b.disabled = true;
        const {data, error} = await d.rpc('close_vote', {p_vote: b.dataset.id});
        if (error) { b.disabled = false; return toast(error.message); }
        toast(data?.quorum_met ? 'تم إغلاق التصويت' : 'تم إغلاق التصويت، لكن النصاب لم يكتمل');
        load(d);
        return;
      }
      b = e.target.closest('.sign-minute');
      if (b) {
        if (b.disabled) return;
        const u = await U(d); if (!u) return toast(SESSION_MSG);
        b.disabled = true;
        const err = await signMinute(d, u, b.dataset.id, null);
        if (err) { b.disabled = false; return toast(err.message); }
        toast('تم توقيع المحضر وربطه ببصمة نصه');
        load(d);
        return;
      }
      b = e.target.closest('.approve-minute');
      if (b) {
        if (b.disabled || !confirm('اعتماد المحضر؟ بعد الاعتماد لا يمكن تعديله ولا إضافة توقيعات.')) return;
        b.disabled = true;
        const {error} = await d.rpc('approve_minute', {p_minute: b.dataset.id});
        if (error) { b.disabled = false; return toast(error.message); }
        toast('تم اعتماد المحضر');
        load(d);
        return;
      }
      b = e.target.closest('.open-secure-file');
      if (b) {
        const u = await U(d); if (!u) return toast(SESSION_MSG);
        const p = (await d.from('profiles').select('full_name').eq('id', u.id).single()).data;
        const wm = `${p?.full_name || u.email} • ${new Date().toLocaleString('ar-SA')}`;
        await d.from('document_watermarks').upsert({attachment_id: b.dataset.id, user_id: u.id, watermark_text: wm});
        b.title = 'علامة مائية: ' + wm;
      }
    });

    $('#markAttendance')?.addEventListener('click', async () => {
      const meeting_id = $('#attendanceMeeting')?.value;
      if (!meeting_id) return toast('اختر الاجتماع');
      const u = await U(d); if (!u) return toast(SESSION_MSG);
      const status = $('#attendanceStatus')?.value || 'حاضر';
      const {error} = await d.from('meeting_attendees').upsert({meeting_id, user_id: u.id, attendance_status: status, attended_at: new Date().toISOString()});
      if (error) return toast(error.message);
      toast('تم تسجيل الحالة');
    });

    $('#sendInvitations')?.addEventListener('click', async e => {
      const meeting_id = $('#attendanceMeeting')?.value;
      if (!meeting_id) return toast('اختر الاجتماع');
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        // الدعوات والإشعارات وطابور الإرسال تُنشأ في الخادم (send_meeting_invitations) بعد التحقق من الصلاحية، وبلا تكرار
        const {data: n, error} = await d.rpc('send_meeting_invitations', {p_meeting: meeting_id});
        if (error) return toast(error.message);
        toast(n ? `تم إنشاء ${n} دعوة جديدة وإضافتها لطابور الإرسال` : 'تمت دعوة جميع الأعضاء مسبقًا، أو لا يوجد أعضاء في لجنة هذا الاجتماع');
        load(d);
      } finally {
        btn.disabled = false;
      }
    });

    $('#semanticSearch')?.addEventListener('click', async () => {
      // الفاصلة والأقواس و% لها معنى في صيغة فلتر PostgREST، فنحذفها من عبارة البحث
      const term = ($('#semanticQuery')?.value || '').replace(/[,()%*\\]/g, ' ').trim().slice(0, 100);
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
      .on('postgres_changes', {event: '*', schema: 'public', table: 'vote_participation'}, () => load(d))
      .on('postgres_changes', {event: '*', schema: 'public', table: 'minutes'}, () => load(d))
      .on('postgres_changes', {event: '*', schema: 'public', table: 'signatures'}, () => load(d))
      .on('postgres_changes', {event: '*', schema: 'public', table: 'meeting_invitations'}, () => load(d))
      .subscribe();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
