(() => {
  // الحوكمة والتوثيق: الترشيحات والانتخابات، التوقيعات، مرجع الأنظمة. الجداول والدوال في supabase/migrations/004_governance_development.sql
  const {esc, toast, fmtDate, pill, empty, busy, failed, onOpen, session, waitDb} = window.ehsanUI;
  const $ = s => document.querySelector(s);
  const safeHttps = u => { try { const x = new URL(u); return x.protocol === 'https:' ? x.href : ''; } catch { return ''; } };
  let db, me;

  // ───────────── الانتخابات ─────────────
  async function loadElections() {
    const [el, cands] = await Promise.all([
      db.from('elections').select('*,committees(name)').order('created_at', {ascending: false}).limit(50),
      db.from('election_candidates').select('*,profiles!election_candidates_user_id_fkey(full_name)').limit(1000)
    ]);
    if (el.error) return failed('الانتخابات', el.error);
    if (cands.error) failed('المرشحين', cands.error);
    const infos = await Promise.all((el.data || []).map(e => db.rpc('election_info', {p_election: e.id})));
    const byEl = {};
    (cands.data || []).forEach(c => { (byEl[c.election_id] ||= []).push(c); });
    $('#electionList').innerHTML = (el.data || []).map((e, i) => {
      const info = infos[i].data || {}, list = byEl[e.id] || [], active = list.filter(c => c.status === 'مرشح');
      const mine = list.find(c => c.user_id === me.uid && c.status === 'مرشح');
      const head = `<strong>${esc(e.title)}</strong> ${pill(e.status)}<div class="meta"><span>${esc(e.committees?.name || 'كل الأعضاء')}</span><span>المقاعد: ${esc(e.seats)}</span></div>`;
      let body = '', acts = '';
      if (e.status === 'ترشيح') {
        body = active.map(c => `<div class="cand"><strong>${esc(c.profiles?.full_name || 'عضو')}</strong><span class="meta">${esc(c.statement || '')}</span></div>`).join('') || '<p class="meta">لا يوجد مرشحون بعد.</p>';
        acts = (mine ? `<button class="btn small ghost el-withdraw" data-id="${mine.id}">سحب ترشحي</button>` : `<button class="btn small primary el-nominate" data-id="${e.id}">ترشيح نفسي</button>`)
          + (me.admin ? `<button class="btn small ghost el-advance" data-id="${e.id}" data-confirm="فتح التصويت؟ يُغلق باب الترشيح.">فتح التصويت</button>` : '');
      } else if (e.status === 'تصويت') {
        const type = e.seats > 1 ? 'checkbox' : 'radio';
        body = info.my_voted ? '<p class="meta">تم تسجيل مشاركتك (الاختيار سري).</p>'
          : info.eligible === false ? '<p class="meta">لست من الناخبين في هذا الانتخاب.</p>'
          : `<div class="el-choices" data-seats="${esc(e.seats)}">${active.map(c => `<label class="cand"><input type="${type}" name="c-${e.id}" value="${c.id}" /> <strong>${esc(c.profiles?.full_name || 'عضو')}</strong> <span class="meta">${esc(c.statement || '')}</span></label>`).join('')}</div>`;
        acts = (!info.my_voted && info.eligible !== false ? `<button class="btn small primary el-vote" data-id="${e.id}">تصويت</button>` : '')
          + (me.admin ? `<button class="btn small ghost el-advance" data-id="${e.id}" data-confirm="إغلاق الانتخاب وإعلان النتيجة؟ لا يمكن التراجع.">إغلاق وإعلان النتيجة</button>` : '');
        body += `<p class="meta">شارك حتى الآن: ${esc(info.voted ?? 0)}</p>`;
      } else {
        const r = e.result?.candidates || [], seats = e.result?.seats || e.seats;
        const cut = r[seats - 1]?.votes, tied = r.length > seats && r[seats]?.votes === cut;
        body = r.map((c, k) => `<div class="cand ${k < seats ? 'winner' : ''}"><strong>${esc(c.name || 'عضو')}</strong><span class="meta">${esc(c.votes)} صوت${k < seats ? ' — فائز' : ''}</span></div>`).join('') + `<p class="meta">عدد المشاركين: ${esc(e.result?.voters ?? 0)}${tied ? ' — تعادل على آخر مقعد، يُحسم بقرار المجلس' : ''}</p>`;
      }
      return `<div class="list-item" data-election="${e.id}">${head}${body}${acts ? `<div class="item-actions">${acts}</div>` : ''}</div>`;
    }).join('') || empty('لا توجد انتخابات.');
  }

  async function createElection(e) {
    e.preventDefault();
    const form = e.currentTarget, f = new FormData(form);
    await busy(form.querySelector('[type=submit]'), async () => {
      const {error} = await db.from('elections').insert({title: String(f.get('title')).trim(), committee_id: f.get('committee_id') || null, seats: Number(f.get('seats')) || 1});
      if (error) return toast('تعذر الإنشاء: ' + error.message);
      form.reset(); toast('تم إنشاء الانتخاب وفتح باب الترشيح'); loadElections();
    });
  }

  async function electionAction(e) {
    const b = e.target.closest('.el-nominate, .el-withdraw, .el-advance, .el-vote');
    if (!b || b.disabled) return;
    const id = b.dataset.id;
    if (b.classList.contains('el-nominate')) {
      return window.openModal?.('الترشح', '<label>كلمة المرشح (اختيارية)<textarea id="mf_stmt" rows="3" maxlength="500"></textarea></label>', async () => {
        const {error} = await db.from('election_candidates').insert({election_id: id, user_id: me.uid, statement: document.querySelector('#mf_stmt').value.trim()});
        if (error) return toast('تعذر الترشح: ' + error.message);
        toast('تم ترشيحك'); loadElections();
      });
    }
    await busy(b, async () => {
      if (b.classList.contains('el-withdraw')) {
        if (!confirm('سحب الترشح؟')) return;
        const {error} = await db.from('election_candidates').update({status: 'منسحب'}).eq('id', id);
        return error ? toast(error.message) : loadElections();
      }
      if (b.classList.contains('el-advance')) {
        if (!confirm(b.dataset.confirm)) return;
        const {error} = await db.rpc('advance_election', {p_election: id});
        return error ? toast(error.message) : loadElections();
      }
      const box = b.closest('[data-election]');
      const picked = [...box.querySelectorAll('.el-choices input:checked')].map(i => i.value);
      const seats = Number(box.querySelector('.el-choices')?.dataset.seats) || 1;
      if (!picked.length) return toast('اختر مرشحًا واحدًا على الأقل');
      if (picked.length > seats) return toast(`الحد الأقصى ${seats} مرشحين`);
      if (!confirm('تأكيد التصويت؟ لا يمكن تغييره بعد الإرسال.')) return;
      const {error} = await db.rpc('cast_election_vote', {p_election: id, p_candidates: picked});
      if (error) return toast(error.message);
      toast('تم تسجيل صوتك'); loadElections();
    });
  }

  // ───────────── التوقيعات ─────────────
  async function loadSignatures() {
    const [mn, sg, at] = await Promise.all([
      db.from('minutes').select('id,status,meeting_id,created_at,meetings(title,gregorian_date)').order('created_at', {ascending: false}).limit(300),
      db.from('signatures').select('*').eq('user_id', me.uid),
      db.from('meeting_attendees').select('meeting_id,attendance_status').eq('user_id', me.uid)
    ]);
    if (mn.error) return failed('المحاضر', mn.error);
    if (sg.error) failed('التوقيعات', sg.error);
    const signed = new Map((sg.data || []).map(s => [s.minute_id, s]));
    const present = new Set((at.data || []).filter(a => ['حاضر', 'عن بعد'].includes(a.attendance_status)).map(a => a.meeting_id));
    const minutes = mn.data || [];
    const pending = minutes.filter(m => m.status !== 'معتمد' && !signed.has(m.id) && (me.admin || present.has(m.meeting_id)));
    const done = minutes.filter(m => signed.has(m.id));
    $('#sigPending').textContent = pending.length;
    $('#sigDone').textContent = done.length;
    $('#sigPendingList').innerHTML = pending.map(m => `<div class="list-item"><strong>${esc(m.meetings?.title || 'محضر')}</strong><div class="meta"><span>${esc(m.meetings?.gregorian_date || '')}</span>${pill(m.status)}</div><div class="item-actions"><button class="btn small primary sig-sign" data-id="${m.id}">توقيع المحضر</button></div></div>`).join('') || empty('لا توجد محاضر بانتظار توقيعك.');
    $('#sigDoneList').innerHTML = done.map(m => {
      const s = signed.get(m.id);
      return `<div class="list-item"><strong>${esc(m.meetings?.title || 'محضر')}</strong><div class="meta"><span>${esc(fmtDate(s.signed_at))}</span>${pill(m.status)}${s.content_hash ? `<span dir="ltr">SHA-256: ${esc(String(s.content_hash).slice(0, 12))}…</span>` : ''}</div></div>`;
    }).join('') || empty('لم توقّع أي محضر بعد.');
  }

  async function signAction(e) {
    const b = e.target.closest('.sig-sign');
    if (!b) return;
    await busy(b, async () => {
      const {error} = await db.rpc('sign_minute', {p_minute: b.dataset.id, p_signature_path: null});
      if (error) return toast(error.message);
      toast('تم توقيع المحضر وربطه ببصمة نصه'); loadSignatures();
    });
  }

  // ───────────── مرجع الأنظمة ─────────────
  let regs = [];
  async function loadRegs() {
    const {data, error} = await db.from('regulations').select('*').order('title').limit(500);
    if (error) return failed('مرجع الأنظمة', error);
    regs = data || [];
    const sel = $('#regCategory'), keep = sel.value;
    const cats = [...new Set(regs.map(r => r.category).filter(Boolean))].sort();
    sel.replaceChildren(sel.options[0], ...cats.map(c => { const o = document.createElement('option'); o.value = c; o.textContent = c; return o; }));
    sel.value = cats.includes(keep) ? keep : '';
    renderRegs();
  }
  function renderRegs() {
    const t = $('#regSearch').value.trim().toLowerCase(), c = $('#regCategory').value;
    const rows = regs.filter(r => (!c || r.category === c) && (!t || `${r.title} ${r.summary} ${r.category}`.toLowerCase().includes(t)));
    $('#regList').innerHTML = rows.map(r => {
      const url = safeHttps(r.url);
      const acts = (url ? `<a class="btn small ghost" href="${esc(url)}" target="_blank" rel="noopener noreferrer">فتح الوثيقة</a>` : '')
        + (me.admin ? `<button class="btn small ghost reg-edit" data-id="${r.id}">تعديل</button><button class="btn small ghost reg-del" data-id="${r.id}">حذف</button>` : '');
      return `<div class="list-item"><strong>${esc(r.title)}</strong> ${pill(r.status)}<div class="meta"><span>${esc(r.category)}</span>${r.version ? `<span>الإصدار ${esc(r.version)}</span>` : ''}${r.effective_date ? `<span>سريان: ${esc(fmtDate(r.effective_date))}</span>` : ''}</div>${r.summary ? `<p>${esc(r.summary)}</p>` : ''}${acts ? `<div class="item-actions">${acts}</div>` : ''}</div>`;
    }).join('') || empty('لا توجد أنظمة مطابقة.');
  }

  function openRegForm(r) {
    const form = $('#regForm');
    form.hidden = false;
    ['id', 'title', 'category', 'version', 'effective_date', 'status', 'url', 'summary'].forEach(k => { form.elements[k].value = r?.[k] ?? (k === 'status' ? 'ساري' : ''); });
    form.elements.title.focus();
  }
  async function saveReg(e) {
    e.preventDefault();
    const form = e.currentTarget, f = new FormData(form);
    const url = String(f.get('url') || '').trim();
    if (url && !safeHttps(url)) return toast('رابط الوثيقة يجب أن يبدأ بـ https://');
    const row = {title: String(f.get('title')).trim(), category: String(f.get('category') || '').trim() || 'عام', version: String(f.get('version') || '').trim(), summary: String(f.get('summary') || '').trim(), url: url || null, effective_date: f.get('effective_date') || null, status: f.get('status')};
    await busy(form.querySelector('[type=submit]'), async () => {
      const id = f.get('id');
      const {error} = id ? await db.from('regulations').update(row).eq('id', id) : await db.from('regulations').insert(row);
      if (error) return toast('تعذر الحفظ: ' + error.message);
      form.hidden = true; form.reset(); toast('تم حفظ النظام'); loadRegs();
    });
  }
  async function regAction(e) {
    const b = e.target.closest('.reg-edit, .reg-del');
    if (!b) return;
    if (b.classList.contains('reg-edit')) return openRegForm(regs.find(r => r.id === b.dataset.id));
    if (!confirm('حذف هذا النظام نهائيًا؟')) return;
    await busy(b, async () => {
      const {error} = await db.from('regulations').delete().eq('id', b.dataset.id);
      return error ? toast(error.message) : loadRegs();
    });
  }

  async function start() {
    db = await waitDb();
    if (!db) return;
    me = await session(db);
    if (!me) return;
    if (me.admin) {
      $('#electionForm').hidden = false;
      $('#regAddBtn').hidden = false;
      db.from('committees').select('id,name').order('name').then(({data}) => {
        const sel = $('#electionCommittee');
        (data || []).forEach(c => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; sel.append(o); });
      });
    }
    $('#electionForm').addEventListener('submit', createElection);
    $('#electionList').addEventListener('click', electionAction);
    $('#sigPendingList').addEventListener('click', signAction);
    $('#regForm').addEventListener('submit', saveReg);
    $('#regAddBtn').addEventListener('click', () => openRegForm(null));
    $('#regCancel').addEventListener('click', () => { $('#regForm').hidden = true; });
    $('#regList').addEventListener('click', regAction);
    $('#regSearch').addEventListener('input', renderRegs);
    $('#regCategory').addEventListener('change', renderRegs);
    const handlers = {elections: loadElections, signatures: loadSignatures, regulations: loadRegs};
    onOpen(handlers);
    const h = location.hash.replace('#', '');
    handlers[h]?.();
  }
  start().catch(err => console.error('governance', err));
})();
