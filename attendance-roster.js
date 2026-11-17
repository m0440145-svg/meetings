// كشف الحضور لأمين السر/المدير (الترحيل 041): يسجّل أو يعدّل أو يمسح حالة أي عضو، ويرى مصدر كل تسجيل (ذاتي/أمين السر)، ويضبط دقائق نافذة التسجيل الذاتي.
// يظهر زر «كشف الحضور» بجوار «تسجيل حضوري» للمدير فقط. إن لم يكن الترحيل مطبّقًا لا يظهر شيء.
(() => {
  'use strict';
  const ui = window.ehsanUI;
  if (!ui) return;
  const {esc, toast, session, waitDb} = ui;
  let db;
  const STATUSES = ['حاضر', 'عن بعد', 'معتذر', 'غائب'];

  async function roster(meetingId) {
    const m = await db.from('meetings').select('id,title,committee_id').eq('id', meetingId).single();
    if (m.error) throw new Error('تعذر تحميل الاجتماع');
    const [cm, inv, att] = await Promise.all([
      m.data.committee_id ? db.from('committee_members').select('user_id').eq('committee_id', m.data.committee_id) : {data: []},
      db.from('meeting_invitations').select('user_id').eq('meeting_id', meetingId),
      db.from('meeting_attendees').select('user_id,attendance_status,source,attended_at').eq('meeting_id', meetingId)
    ]);
    const ids = [...new Set([...(cm.data || []), ...(inv.data || []), ...(att.data || [])].map(x => x.user_id).filter(Boolean))];
    const pr = ids.length ? await db.from('profiles').select('id,full_name').in('id', ids) : {data: []};
    const nm = new Map((pr.data || []).map(p => [p.id, p.full_name || 'عضو']));
    const at = new Map((att.data || []).map(a => [a.user_id, a]));
    return {title: m.data.title, rows: ids.map(id => ({id, name: nm.get(id) || 'عضو', a: at.get(id)})).sort((x, y) => x.name.localeCompare(y.name, 'ar'))};
  }

  async function open(meetingId) {
    const dlg = document.createElement('dialog'); dlg.style.cssText = 'border:0;border-radius:18px;padding:0;width:min(94vw,760px);max-height:92vh;background:var(--card,#fff);color:inherit';
    document.body.append(dlg); dlg.addEventListener('close', () => dlg.remove());
    const s = await db.from('attendance_settings').select('*').eq('id', 1).maybeSingle();
    const paint = async () => {
      let d; try { d = await roster(meetingId); } catch (e) { toast(e.message); return; }
      const present = d.rows.filter(r => ['حاضر', 'عن بعد'].includes(r.a?.attendance_status)).length;
      dlg.innerHTML = `<div style="padding:16px 20px;display:grid;gap:10px;max-height:88vh;overflow:auto">
        <div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">كشف الحضور — ${esc(d.title)}</h3><button type="button" class="btn ghost small" data-x>✕</button></div>
        <div style="font-size:13px;opacity:.8">حاضرون (حاضر أو عن بعد): <b>${present}</b> من ${d.rows.length}. «غائب» تقفل التسجيل الذاتي، و«مسح» يعيده للعضو.</div>
        ${d.rows.map(r => `<div class="card" data-u="${esc(r.id)}" style="display:grid;gap:6px"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><strong>${esc(r.name)}</strong><span style="font-size:12.5px;opacity:.8">${r.a ? `${esc(r.a.attendance_status)} · ${esc(r.a.source || 'أمين السر')}` : 'لم يُسجَّل'}</span></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">${STATUSES.map(x => `<button type="button" class="btn small ${r.a?.attendance_status === x ? 'primary' : 'ghost'}" data-st="${x}">${x}</button>`).join('')}${r.a ? '<button type="button" class="btn small ghost" data-st="">مسح</button>' : ''}</div></div>`).join('') || '<div class="card">لا أعضاء لهذا الاجتماع.</div>'}
        <fieldset style="border:1px solid var(--line,#eadfd8);border-radius:12px;padding:10px 12px"><legend>نافذة التسجيل الذاتي</legend>
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end"><label>قبل بدء الاجتماع (دقيقة)<input type="number" min="0" max="1440" id="rsBefore" value="${s.data?.before_minutes ?? 30}" style="width:110px"></label><label>بعد نهايته (دقيقة)<input type="number" min="0" max="1440" id="rsAfter" value="${s.data?.after_minutes ?? 60}" style="width:110px"></label><button type="button" class="btn small primary" id="rsSave">حفظ</button></div></fieldset></div>`;
    };
    dlg.addEventListener('click', async e => {
      if (e.target.closest('[data-x]')) return dlg.close();
      const b = e.target.closest('[data-st]'); if (b) {
        const u = b.closest('[data-u]').dataset.u; const {error} = await db.rpc('attendance_set', {p_meeting: meetingId, p_user: u, p_status: b.dataset.st || null});
        if (error) return toast(error.message || 'تعذر الحفظ'); return paint();
      }
      if (e.target.id === 'rsSave') {
        const r = await db.from('attendance_settings').update({before_minutes: Number(dlg.querySelector('#rsBefore').value), after_minutes: Number(dlg.querySelector('#rsAfter').value), updated_at: new Date().toISOString()}).eq('id', 1);
        toast(r.error ? (r.error.message || 'تعذر الحفظ') : 'حُفظت النافذة');
      }
    });
    await paint(); dlg.showModal();
  }

  async function start() {
    db = await waitDb(); if (!db) return;
    const me = await session(db); if (!me?.admin) return;
    const probe = await db.from('attendance_settings').select('id').limit(1);
    if (probe.error) return; // الترحيل 041 غير مطبّق
    const btn = document.getElementById('markAttendance'); if (!btn || document.getElementById('openRoster')) return;
    const b = document.createElement('button'); b.type = 'button'; b.id = 'openRoster'; b.className = 'btn small ghost'; b.textContent = 'كشف الحضور';
    btn.insertAdjacentElement('afterend', b);
    b.addEventListener('click', () => { const id = document.getElementById('attendanceMeeting')?.value; if (!id) return toast('اختر الاجتماع أولًا'); open(id).catch(e => toast(e.message)); });
  }
  start().catch(err => console.error('attendance-roster', err));
})();
