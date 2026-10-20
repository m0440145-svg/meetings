(() => {
  // الذكاء والتطوير: الأفكار والأثر، القاعات والامتثال، المؤسسي المتقدم (مؤشر النضج).
  const {esc, toast, fmtDate, pill, empty, busy, failed, onOpen, session, waitDb} = window.ehsanUI;
  const $ = s => document.querySelector(s);
  const I = window.ehsanInsights;
  let db, me;

  // ───────────── الأفكار والأثر ─────────────
  let ideas = [];
  async function loadIdeas() {
    const {data, error} = await db.from('ideas').select('*,profiles!ideas_author_id_fkey(full_name),idea_votes(user_id)').order('created_at', {ascending: false}).limit(300);
    if (error) return failed('الأفكار', error);
    ideas = data || [];
    renderIdeas();
  }
  function renderIdeas() {
    const f = $('#ideaFilter').value;
    const rows = ideas.filter(i => !f || i.status === f).sort((a, b) => b.idea_votes.length - a.idea_votes.length || b.created_at.localeCompare(a.created_at));
    $('#ideaList').innerHTML = rows.map(i => {
      const voted = i.idea_votes.some(v => v.user_id === me.uid);
      const acts = `<button class="btn small ${voted ? 'primary' : 'ghost'} idea-vote" data-id="${i.id}" data-voted="${voted}">▲ ${i.idea_votes.length} ${voted ? 'تم التأييد' : 'تأييد'}</button>`
        + (me.admin ? ['قيد الدراسة', 'معتمدة', 'منفذة', 'مرفوضة'].filter(s => s !== i.status).map(s => `<button class="btn small ghost idea-status" data-id="${i.id}" data-status="${s}">${s}</button>`).join('') : '')
        + (me.admin && ['معتمدة', 'منفذة'].includes(i.status) ? `<button class="btn small ghost idea-impact" data-id="${i.id}">تسجيل الأثر</button>` : '')
        + ((i.author_id === me.uid && i.status === 'مقترحة') || me.admin ? `<button class="btn small ghost idea-del" data-id="${i.id}">حذف</button>` : '');
      const impact = i.impact_note || i.impact_score ? `<p class="meta">الأثر المحقق${i.impact_score ? ` (${esc(i.impact_score)}/5)` : ''}: ${esc(i.impact_note)}</p>` : '';
      return `<div class="list-item"><strong>${esc(i.title)}</strong> ${pill(i.status)}<div class="meta"><span>${esc(i.category)}</span><span>${esc(i.profiles?.full_name || '')}</span><span>${esc(fmtDate(i.created_at))}</span></div>${i.description ? `<p>${esc(i.description)}</p>` : ''}${impact}<div class="item-actions">${acts}</div></div>`;
    }).join('') || empty('لا توجد أفكار.');
  }
  async function submitIdea(e) {
    e.preventDefault();
    const form = e.currentTarget, f = new FormData(form);
    await busy(form.querySelector('[type=submit]'), async () => {
      const {error} = await db.from('ideas').insert({title: String(f.get('title')).trim(), category: String(f.get('category') || '').trim() || 'عام', description: String(f.get('description') || '').trim()});
      if (error) return toast('تعذر الإرسال: ' + error.message);
      form.reset(); toast('تم إرسال الفكرة'); loadIdeas();
    });
  }
  async function ideaAction(e) {
    const b = e.target.closest('.idea-vote, .idea-status, .idea-impact, .idea-del');
    if (!b) return;
    const id = b.dataset.id;
    if (b.classList.contains('idea-impact')) {
      const i = ideas.find(x => x.id === id);
      return window.openModal?.('تسجيل الأثر المحقق', `<label>وصف الأثر<textarea id="mf_note" rows="3" maxlength="500">${esc(i?.impact_note || '')}</textarea></label><label>التقييم (1 إلى 5)<input id="mf_score" type="number" min="1" max="5" value="${esc(i?.impact_score || '')}" /></label>`, async () => {
        const score = parseInt(document.querySelector('#mf_score').value, 10);
        const {error} = await db.from('ideas').update({impact_note: document.querySelector('#mf_note').value.trim(), impact_score: score >= 1 && score <= 5 ? score : null}).eq('id', id);
        if (error) return toast(error.message);
        toast('تم تسجيل الأثر'); loadIdeas();
      });
    }
    await busy(b, async () => {
      let r;
      if (b.classList.contains('idea-vote')) {
        r = b.dataset.voted === 'true' ? await db.from('idea_votes').delete().eq('idea_id', id).eq('user_id', me.uid) : await db.from('idea_votes').insert({idea_id: id, user_id: me.uid});
      } else if (b.classList.contains('idea-status')) {
        r = await db.from('ideas').update({status: b.dataset.status}).eq('id', id);
      } else {
        if (!confirm('حذف هذه الفكرة؟')) return;
        r = await db.from('ideas').delete().eq('id', id);
      }
      if (r.error) return toast(r.error.message);
      loadIdeas();
    });
  }

  // ───────────── القاعات والحجز ─────────────
  let halls = [];
  const fmtDT = d => new Date(d).toLocaleString('ar-SA', {dateStyle: 'medium', timeStyle: 'short'});
  async function loadHalls() {
    const nowIso = new Date().toISOString();
    const [h, b] = await Promise.all([
      db.from('halls').select('*').order('name'),
      db.from('hall_bookings').select('*,halls(name),meetings(title),profiles!hall_bookings_booked_by_fkey(full_name)').eq('status', 'مؤكد').gte('end_at', nowIso).order('start_at').limit(100)
    ]);
    if (h.error) return failed('القاعات', h.error);
    if (b.error) failed('الحجوزات', b.error);
    halls = h.data || [];
    $('#hallList').innerHTML = halls.map(x => `<div class="list-item"><strong>${esc(x.name)}</strong> ${x.is_active ? '' : pill('ملغى')}<div class="meta"><span>السعة: ${esc(x.capacity)}</span>${(x.features || []).map(f => `<span>${esc(f)}</span>`).join('')}</div>${x.notes ? `<p>${esc(x.notes)}</p>` : ''}${me.admin ? `<div class="item-actions"><button class="btn small ghost hall-edit" data-id="${x.id}">تعديل</button><button class="btn small ghost hall-toggle" data-id="${x.id}">${x.is_active ? 'إيقاف' : 'تفعيل'}</button></div>` : ''}</div>`).join('') || empty('لا توجد قاعات مضافة.');
    const sel = $('#bookHall'), keep = sel.value;
    sel.replaceChildren(sel.options[0], ...halls.filter(x => x.is_active).map(x => { const o = document.createElement('option'); o.value = x.id; o.textContent = `${x.name} (${x.capacity})`; return o; }));
    sel.value = keep;
    $('#bookList').innerHTML = (b.data || []).map(x => `<div class="list-item"><strong>${esc(x.halls?.name || 'قاعة')}</strong><div class="meta"><span>${esc(fmtDT(x.start_at))} ← ${esc(fmtDT(x.end_at))}</span><span>${esc(x.meetings?.title || '')}</span><span>${esc(x.profiles?.full_name || '')}</span></div>${me.admin || x.booked_by === me.uid ? `<div class="item-actions"><button class="btn small ghost book-cancel" data-id="${x.id}">إلغاء الحجز</button></div>` : ''}</div>`).join('') || empty('لا توجد حجوزات قادمة.');
  }
  function hallModal(h) {
    window.openModal?.(h ? 'تعديل قاعة' : 'قاعة جديدة', `<label>الاسم<input id="mf_hname" maxlength="100" value="${esc(h?.name || '')}" /></label><label>السعة<input id="mf_hcap" type="number" min="1" max="2000" value="${esc(h?.capacity || 10)}" /></label><label>التجهيزات (افصل بينها بفاصلة)<input id="mf_hfeat" value="${esc((h?.features || []).join('، '))}" /></label><label>ملاحظات<input id="mf_hnote" maxlength="300" value="${esc(h?.notes || '')}" /></label>`, async () => {
      const name = document.querySelector('#mf_hname').value.trim();
      if (!name) return toast('أدخل اسم القاعة');
      const row = {name, capacity: Number(document.querySelector('#mf_hcap').value) || 10, features: document.querySelector('#mf_hfeat').value.split(/[,،]/).map(x => x.trim()).filter(Boolean), notes: document.querySelector('#mf_hnote').value.trim()};
      const {error} = h ? await db.from('halls').update(row).eq('id', h.id) : await db.from('halls').insert(row);
      if (error) return toast('تعذر الحفظ: ' + error.message);
      toast('تم حفظ القاعة'); loadHalls();
    });
  }
  async function submitBooking(e) {
    e.preventDefault();
    const form = e.currentTarget, f = new FormData(form);
    const start = new Date(f.get('start_at')), end = new Date(f.get('end_at'));
    if (!(end > start)) return toast('وقت النهاية يجب أن يكون بعد البداية');
    await busy(form.querySelector('[type=submit]'), async () => {
      const {error} = await db.from('hall_bookings').insert({hall_id: f.get('hall_id'), meeting_id: f.get('meeting_id'), start_at: start.toISOString(), end_at: end.toISOString()});
      if (error) return toast('تعذر الحجز: ' + error.message);
      form.reset(); toast('تم تأكيد الحجز'); loadHalls();
    });
  }
  async function hallAction(e) {
    const b = e.target.closest('.hall-edit, .hall-toggle, .book-cancel');
    if (!b) return;
    if (b.classList.contains('hall-edit')) return hallModal(halls.find(x => x.id === b.dataset.id));
    await busy(b, async () => {
      let r;
      if (b.classList.contains('hall-toggle')) {
        const h = halls.find(x => x.id === b.dataset.id);
        r = await db.from('halls').update({is_active: !h.is_active}).eq('id', h.id);
      } else {
        if (!confirm('إلغاء هذا الحجز؟')) return;
        r = await db.from('hall_bookings').update({status: 'ملغي'}).eq('id', b.dataset.id);
      }
      if (r.error) return toast(r.error.message);
      loadHalls();
    });
  }

  const mark = v => v === null ? '<span class="cell-na">—</span>' : v ? '<span class="cell-ok">✓</span>' : '<span class="cell-bad">✗</span>';
  async function loadCompliance() {
    const data = await I.load(db, true);
    if (data.unreadable.length) failed('بعض الجداول للامتثال (' + data.unreadable.join('، ') + ')', {message: 'قد تمنعها الصلاحيات'});
    const rows = I.compliance(data).slice(0, 100);
    $('#complianceTable').innerHTML = rows.map(({meeting: m, checks: c, score}) => `<tr><td>${esc(m.title)}</td><td>${esc(m.gregorian_date)}</td><td>${mark(c.agenda)}</td><td>${mark(c.early)}</td><td>${mark(c.quorum)}</td><td>${mark(c.onTime)}</td><td>${mark(c.approved)}</td><td><strong class="${score === null ? 'cell-na' : score >= 80 ? 'cell-ok' : score < 50 ? 'cell-bad' : ''}">${score === null ? '—' : score + '%'}</strong></td></tr>`).join('') || '<tr><td colspan="8">لا توجد اجتماعات.</td></tr>';
  }

  // ───────────── المؤسسي المتقدم: مؤشر النضج ─────────────
  async function loadMaturity() {
    const data = await I.load(db, true);
    const m = I.maturity(data);
    $('#maturityScore').textContent = m.score === null ? '—' : m.score + '%';
    $('#maturityLevel').textContent = m.level;
    $('#maturityBars').innerHTML = m.metrics.map(x => `<div class="bar-row" style="grid-template-columns:170px 1fr 44px"><span>${esc(x.label)}</span><div class="bar-track"><div class="bar-fill ${x.value === null ? '' : x.value < 40 ? 'low' : x.value < 70 ? 'mid' : ''}" style="width:${x.value ?? 0}%"></div></div><strong>${x.value === null ? '—' : x.value + '%'}</strong></div>`).join('');
    $('#maturityTips').innerHTML = (m.tips.length ? m.tips : [m.score === null ? 'لا توجد بيانات كافية بعد؛ ابدأ بتسجيل الاجتماعات والمحاضر والمهام.' : 'المؤشرات جيدة؛ حافظ على الانتظام وراجع المؤشر دوريًا.']).map(t => `<li>${esc(t)}</li>`).join('');
  }

  async function start() {
    db = await waitDb();
    if (!db) return;
    me = await session(db);
    if (!me) return;
    if (me.admin) $('#addHallBtn').hidden = false;
    $('#ideaForm').addEventListener('submit', submitIdea);
    $('#ideaFilter').addEventListener('change', renderIdeas);
    $('#ideaList').addEventListener('click', ideaAction);
    $('#bookForm').addEventListener('submit', submitBooking);
    $('#addHallBtn').addEventListener('click', () => hallModal(null));
    $('#hallList').addEventListener('click', hallAction);
    $('#bookList').addEventListener('click', hallAction);
    const handlers = {ideas: loadIdeas, halls: () => { loadHalls(); loadCompliance(); }, maturity: loadMaturity};
    onOpen(handlers);
    handlers[location.hash.replace('#', '')]?.();
  }
  start().catch(err => console.error('development', err));
})();
