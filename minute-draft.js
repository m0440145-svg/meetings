// مسودة محضر من بيانات الاجتماع (بلا ذكاء اصطناعي ولا خدمة خارجية): تجمع بيانات الاجتماع والحضور وجدول الأعمال وما ثبت من قرارات وتوصيات وتصويتات
// في نص بصيغة محاضر الجمعية (ترويسة، محاور، حضور، قرارات وتوصيات بترقيم المحاور، تصويتات)، تُراجَع وتُكمَّل ثم تُحفظ محضرًا بحالة «مسودة» عبر المسار القائم (فيُسجَّل سجل الإصدارات تلقائيًا).
// لا يُنشأ المحضر إن وُجد محضر للاجتماع نفسه. يُضاف كبطاقة إلى شاشة «مساعد أمين السر» للمدير وأمين السر.
(() => {
  'use strict';
  const ui = window.ehsanUI;
  if (!ui) return;
  const {esc, toast, session, waitDb} = ui;
  let db, me;
  const norm = s => String(s || '').replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[\s.،,:؛]+/g, ' ').trim().toLowerCase();
  const PH = t => `[${t}]`;
  const REC = {decision: 'قرار', recommendation: 'توصية', assignment: 'تكليف'};

  function dateParts(m) {
    const d = new Date(m.gregorian_date + 'T12:00:00');
    if (isNaN(d)) return {day: '', greg: m.gregorian_date || '', hijri: m.hijri_date || ''};
    const day = d.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', {weekday: 'long'});
    const greg = m.gregorian_date.replace(/-/g, '/');
    let hijri = m.hijri_date || '';
    if (!hijri) {
      try { const p = Object.fromEntries(new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(d).map(x => [x.type, x.value])); hijri = `${String(p.year).replace(/\D/g, '')}/${p.month}/${p.day}`; } catch { hijri = ''; }
    }
    return {day, greg, hijri};
  }

  // ctx: {meeting, agenda[], members[{name,role}], attendance[{name,status}], suggestions[{kind,title,agenda_ref,status}], decisions[{title,agenda_item_id,record_type}], votes[{question,agenda_item_id,result}]}
  function build(ctx) {
    const m = ctx.meeting, committee = m.committees?.name || '';
    const {day, greg, hijri} = dateParts(m);
    const num = m.meeting_no && m.meeting_no !== '-' ? m.meeting_no : ((String(m.title || '').match(/(\d+)\s*$/) || [])[1] || PH('رقم الاجتماع'));
    const chair = (ctx.members || []).find(x => /^رئيس/.test(x.role || '') && !/نائب/.test(x.role))?.name || PH('رئيس الاجتماع');
    const time = `${(m.start_time || '').slice(0, 5)}${m.end_time ? ' – ' + m.end_time.slice(0, 5) : ''}`;
    const place = [m.location, m.mode].filter(Boolean).join(' — ') || PH('المكان');
    const L = [];
    L.push(`محضر اجتماع ${committee || PH('الجهة')}`, '');
    L.push(`رقم الاجتماع: ${num}`, `رئيس الاجتماع: ${chair}`, `المقرر: ${PH('المقرر')}`, `اليوم والتاريخ: ${day} ${greg}${hijri ? ' الموافق ' + hijri + ' هـ' : ''}`, `الوقت: ${time || PH('الوقت')}`, `المكان: ${place}`, '');
    L.push('الحمد لله رب العالمين، والصلاة والسلام على أشرف الأنبياء والمرسلين نبينا محمد وعلى آله وصحبه أجمعين، وبعد،',
      `ففي هذا اليوم ${day} الموافق ${greg} عقد اجتماع ${committee || PH('الجهة')} للجمعية بمناقشة المحاور التالية:`, '');
    L.push('محاور الاجتماع');
    (ctx.agenda || []).forEach(a => L.push(`${a.item_order} ${a.title}`));
    if (!(ctx.agenda || []).length) L.push(PH('لم يُسجَّل جدول أعمال لهذا الاجتماع'));
    L.push('');
    // الحضور
    const att = ctx.attendance || [], isIn = s => s === 'حاضر' || s === 'عن بعد';
    L.push('الحضور');
    if (att.length) {
      const present = att.filter(x => isIn(x.status)), apol = att.filter(x => x.status === 'معتذر'), seen = new Set(att.map(x => x.name));
      const missing = (ctx.members || []).filter(x => !seen.has(x.name));
      L.push(`حاضرون (${present.length}): ${present.map(x => x.name + (x.status === 'عن بعد' ? ' (عن بعد)' : '')).join('، ') || '—'}`);
      if (apol.length) L.push(`معتذرون (${apol.length}): ${apol.map(x => x.name).join('، ')}`);
      if (missing.length) L.push(`لم يُسجَّل حضورهم (${missing.length}): ${missing.map(x => x.name).join('، ')}`);
    } else {
      L.push(`${PH('لم يُسجَّل الحضور في المنصة بعد؛ سجّله من «الاجتماعات» ثم أعد إنشاء المسودة، أو أكمل القائمة يدويًا')}`);
      if ((ctx.members || []).length) L.push(`أعضاء الجهة: ${ctx.members.map(x => x.name).join('، ')}`);
    }
    L.push('');
    // القرارات والتوصيات بترقيم المحاور
    const sug = (ctx.suggestions || []).filter(s => s.status === 'معتمد' || s.status === 'محوّل');
    const closedVotes = (ctx.votes || []).filter(v => v.result);
    const voteLine = v => { const r = v.result || {}; const why = (v.reasons || []).length ? ` (أسباب الامتناع: ${v.reasons.map(a => (a.voter ? a.voter + ': ' : '') + a.reason).join('؛ ')})` : ''; return `التصويت على «${v.question}»: موافق ${r.approve ?? 0}، غير موافق ${r.reject ?? 0}، ممتنع ${r.abstain ?? 0}${why} — ${r.quorum_met ? 'اكتمل النصاب' : 'لم يكتمل النصاب'}`; };
    L.push('قرارات وتوصيات الاجتماع');
    (ctx.agenda || []).forEach(a => {
      const lines = [];
      (ctx.decisions || []).filter(d => d.agenda_item_id === a.id).forEach(d => lines.push(`${REC[d.record_type] || 'قرار'}: ${d.title}`));
      sug.filter(s => s.agenda_ref && (norm(s.agenda_ref) === norm(a.title) || norm(a.title).includes(norm(s.agenda_ref)) || norm(s.agenda_ref).includes(norm(a.title)))).forEach(s => lines.push(`${s.kind}: ${s.title}`));
      closedVotes.filter(v => v.agenda_item_id === a.id).forEach(v => lines.push(voteLine(v)));
      L.push(`${a.item_order} ${lines.length ? lines[0] : PH('يُستكمل: ما دار في المحور والقرار أو التوصية')}`);
      lines.slice(1).forEach(x => L.push(`   - ${x}`));
    });
    const loose = closedVotes.filter(v => !v.agenda_item_id || !(ctx.agenda || []).some(a => a.id === v.agenda_item_id));
    if (loose.length) { L.push('', 'التصويتات'); loose.forEach(v => L.push(`- ${voteLine(v)}`)); }
    L.push('', `اعتماد رئيس ${committee || PH('الجهة')}`, chair);
    const recs = sug.filter(s => s.kind === 'توصية').map(s => s.title);
    return {content: L.join('\n'), recommendations: recs.join('\n')};
  }

  async function gather(meetingId) {
    const [m, ag, mem, at, mn] = await Promise.all([
      db.from('meetings').select('id,title,gregorian_date,hijri_date,start_time,end_time,mode,location,meeting_no,committee_id,committees(name)').eq('id', meetingId).single(),
      db.from('agenda_items').select('id,item_order,title').eq('meeting_id', meetingId).order('item_order'),
      db.from('meetings').select('committee_id').eq('id', meetingId).single().then(async r => r.data?.committee_id ? db.from('committee_members').select('user_id,committee_role').eq('committee_id', r.data.committee_id) : {data: []}),
      db.from('meeting_attendees').select('user_id,attendance_status').eq('meeting_id', meetingId),
      db.from('minutes').select('id,status').eq('meeting_id', meetingId)
    ]);
    if (m.error || !m.data) throw new Error('تعذر قراءة بيانات الاجتماع');
    const ids = [...new Set([...(mem.data || []).map(x => x.user_id), ...(at.data || []).map(x => x.user_id)])];
    const pr = ids.length ? await db.from('profiles').select('id,full_name').in('id', ids) : {data: []};
    const name = new Map((pr.data || []).map(p => [p.id, p.full_name || '—']));
    const minuteIds = (mn.data || []).map(x => x.id);
    const [sg, dc, vt] = await Promise.all([
      minuteIds.length ? db.from('ai_suggestions').select('kind,title,agenda_ref,status').in('minute_id', minuteIds).in('status', ['معتمد', 'محوّل']) : {data: []},
      db.from('decisions').select('title,agenda_item_id,record_type,status').eq('meeting_id', meetingId).neq('status', 'cancelled'),
      db.from('votes').select('id,question,agenda_item_id,result,status').eq('meeting_id', meetingId).eq('status', 'مغلق')
    ]);
    // أسباب الامتناع (الترحيل 042): للمدير/المنشئ فقط، وتتجاهل الأخطاء إن لم يكن الترحيل مطبّقًا
    await Promise.all((vt.error ? [] : (vt.data || [])).map(async v => { const r = await db.rpc('vote_abstain_reasons', {p_vote: v.id}); v.reasons = r.error ? [] : (r.data || []); }));
    return {
      existing: mn.data || [],
      ctx: {meeting: m.data, agenda: ag.data || [], members: (mem.data || []).map(x => ({name: name.get(x.user_id) || '—', role: x.committee_role})),
        attendance: (at.data || []).map(x => ({name: name.get(x.user_id) || '—', status: x.attendance_status})),
        suggestions: sg.data || [], decisions: dc.error ? [] : (dc.data || []), votes: vt.error ? [] : (vt.data || [])}
    };
  }

  async function generate() {
    const id = document.getElementById('mdrMeeting').value;
    if (!id) return toast('اختر الاجتماع');
    if (!window.DM?.form) return toast('النموذج غير جاهز بعد، أعد المحاولة');
    let g; try { g = await gather(id); } catch (e) { return toast(e.message); }
    const draft = build(g.ctx), exists = g.existing.length > 0;
    await window.DM.form({
      title: 'مسودة محضر: ' + g.ctx.meeting.title, wide: true, submit: 'حفظ كمسودة محضر',
      intro: exists ? `يوجد محضر لهذا الاجتماع بحالة «${g.existing[0].status || '—'}»؛ لن يُنشأ محضر آخر. يمكنك نسخ النص أدناه إن أردت.` : 'المسودة مجمّعة من بيانات المنصة. أكمل ما بين [ ] وراجع كل ما فيها قبل الحفظ؛ تُحفظ بحالة «مسودة» وتمر بمسار التوقيع والاعتماد المعتاد.',
      fields: [
        {name: 'content', label: 'نص المحضر', type: 'textarea', rows: 24, required: true, value: draft.content},
        {name: 'recs', label: 'التوصيات (اختياري)', type: 'textarea', rows: 3, value: draft.recommendations}
      ],
      onSubmit: async v => {
        const {data: again} = await db.from('minutes').select('id').eq('meeting_id', id).limit(1);
        if (again?.length) throw new Error('يوجد محضر لهذا الاجتماع: عدّله من «محاضر الاجتماعات».');
        if (/\[[^\]]{2,}\]/.test(v.content) && !window.confirm('ما زالت في النص عبارات بين [ ] لم تُستكمل. هل تحفظ المسودة كما هي؟')) throw new Error('أكمل العبارات التي بين [ ] ثم احفظ.');
        const r = await db.from('minutes').insert({meeting_id: id, content: v.content, recommendations: v.recs || '', created_by: me.uid});
        if (r.error) throw new Error(r.error.message);
        toast('حُفظت مسودة المحضر؛ تجدها في «محاضر الاجتماعات»');
      }
    });
  }

  async function mountCard() {
    for (let i = 0; i < 40; i++) { if (document.getElementById('view-ai-assist')) break; await new Promise(r => setTimeout(r, 500)); }
    const view = document.getElementById('view-ai-assist'); if (!view || document.getElementById('mdrCard')) return;
    const {data} = await db.from('meetings').select('id,title,gregorian_date').order('gregorian_date', {ascending: false}).limit(100);
    const card = document.createElement('div'); card.id = 'mdrCard'; card.className = 'card'; card.style.marginBottom = '14px';
    card.innerHTML = `<h3 style="margin-top:0">مسودة محضر من بيانات الاجتماع</h3><p class="muted" style="margin:0 0 10px">تجمع بيانات الاجتماع والحضور وجدول الأعمال وما ثبت من قرارات وتوصيات وتصويتات في مسودة بصيغة محاضر الجمعية، دون أي خدمة خارجية.</p>
      <div class="ai-bar"><label>الاجتماع<select id="mdrMeeting"><option value="">اختر الاجتماع</option>${(data || []).map(m => `<option value="${esc(m.id)}">${esc(m.title)} — ${esc(m.gregorian_date || '')}</option>`).join('')}</select></label><button type="button" class="btn primary" id="mdrGo">إنشاء المسودة</button></div>`;
    const note = view.querySelector('.ai-note'); (note || view.querySelector('.section-head')).after(card);
    document.getElementById('mdrGo').addEventListener('click', generate);
  }

  async function start() {
    db = await waitDb(); if (!db) return;
    me = await session(db); if (!me || !me.admin) return;
    await mountCard();
  }
  window.ehsanMinuteDraft = {build};
  start().catch(err => console.error('minute-draft', err));
})();
