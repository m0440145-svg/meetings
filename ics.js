// تنزيل الاجتماع كملف تقويم (ICS، RFC 5545) ليُضاف إلى Outlook وGoogle وApple. توليد محلي في المتصفح بلا أي خدمة خارجية.
// التوقيت: يُفترض أن وقت الاجتماع المخزَّن بتوقيت الرياض (UTC+3 بلا توقيت صيفي)، ويُكتب في الملف بالتوقيت العالمي.
// الواجهة: window.ehsanIcs.download(meeting, agendaItems) و window.ehsanIcs.build(meeting, agendaItems).
(() => {
  'use strict';
  const TZ_OFFSET_H = 3;
  const pad = n => String(n).padStart(2, '0');
  const esc = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const stamp = d => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  // طي الأسطر على 75 بايت (UTF-8) دون قطع حرف
  const fold = line => {
    const enc = new TextEncoder(); const out = []; let cur = '', bytes = 0;
    for (const ch of line) {
      const n = enc.encode(ch).length;
      if (bytes + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
      cur += ch; bytes += n;
    }
    out.push(cur);
    return out.map((l, i) => (i ? ' ' : '') + l).join('\r\n');
  };
  const safeUrl = u => { try { const x = new URL(u); return x.protocol === 'https:' ? x.href : ''; } catch { return ''; } };

  function build(m, agenda = []) {
    if (!m?.gregorian_date || !m?.start_time) throw new Error('بيانات الاجتماع ناقصة (التاريخ أو وقت البداية)');
    const [y, mo, d] = m.gregorian_date.split('-').map(Number), [h, mi] = m.start_time.split(':').map(Number);
    const start = new Date(Date.UTC(y, mo - 1, d, h - TZ_OFFSET_H, mi, 0));
    let end;
    if (m.end_time) { const [eh, em] = m.end_time.split(':').map(Number); end = new Date(Date.UTC(y, mo - 1, d, eh - TZ_OFFSET_H, em, 0)); if (end <= start) end = new Date(start.getTime() + 36e5); }
    else end = new Date(start.getTime() + 36e5);
    const url = safeUrl(m.meeting_url);
    const lines = [];
    if (m.committees?.name) lines.push(`الجهة: ${m.committees.name}`);
    if (m.mode) lines.push(`نمط الانعقاد: ${m.mode}`);
    if (url) lines.push(`رابط الاجتماع: ${url}`);
    if (agenda.length) { lines.push('', 'جدول الأعمال:'); agenda.forEach(a => lines.push(`${a.item_order}. ${a.title}`)); }
    const ev = ['BEGIN:VEVENT', `UID:${m.id}@mithaq`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, `SUMMARY:${esc(m.title)}`,
      `DESCRIPTION:${esc(lines.join('\n'))}`, `LOCATION:${esc(m.location || (url ? 'اجتماع عن بعد' : ''))}`, ...(url ? [`URL:${url}`] : []), 'STATUS:CONFIRMED', 'END:VEVENT'];
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mithaq//Meetings//AR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', ...ev, 'END:VCALENDAR'].map(fold).join('\r\n') + '\r\n';
  }

  function download(m, agenda) {
    let text;
    try { text = build(m, agenda); } catch (e) { window.ehsanUI?.toast?.(e.message); return false; }
    const blob = new Blob([text], {type: 'text/calendar;charset=utf-8'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = String(m.title || 'اجتماع').replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 60) + '.ics';
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return true;
  }
  window.ehsanIcs = {build, download};
})();
