(() => {
  // كاتب ملفات Excel (.xlsx) مصغّر بلا مكتبات: أوراق متعددة، نصوص وأرقام، رأس مميز، التفاف نص، واتجاه الورقة من اليمين لليسار.
  // الملف حزمة ZIP بطريقة STORE (بلا ضغط) مع CRC32. لم يُفتح في Excel الفعلي هنا؛ بُنيته مطابقة لمواصفة OOXML الأساسية واختُبر تفكيكه وقراءة XML.
  const enc = new TextEncoder();
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = u8 => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const xml = s => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const colName = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

  function zipStore(files) {
    const parts = [], central = []; let offset = 0;
    const dosTime = 0x6000, dosDate = 0x5A21; // 2025-01-01 00:00 (ثابت)
    const u16 = n => [n & 255, (n >> 8) & 255], u32 = n => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
    for (const f of files) {
      const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
      const local = new Uint8Array([0x50, 0x4B, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosTime), ...u16(dosDate), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)]);
      parts.push(local, name, data);
      central.push({name, crc, size: data.length, offset});
      offset += local.length + name.length + data.length;
    }
    const cdStart = offset;
    for (const c of central) {
      const h = new Uint8Array([0x50, 0x4B, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosTime), ...u16(dosDate), ...u32(c.crc), ...u32(c.size), ...u32(c.size), ...u16(c.name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(c.offset)]);
      parts.push(h, c.name); offset += h.length + c.name.length;
    }
    const end = new Uint8Array([0x50, 0x4B, 5, 6, ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length), ...u32(offset - cdStart), ...u32(cdStart), ...u16(0)]);
    parts.push(end);
    const total = parts.reduce((a, p) => a + p.length, 0), out = new Uint8Array(total); let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  const sheetName = (n, i) => (String(n || 'ورقة ' + (i + 1)).replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 31).trim() || 'ورقة ' + (i + 1));
  function sheetXml(rows, widths, headerRows = 1) {
    const cols = widths?.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
      if (v === null || v === undefined || v === '') return '';
      const ref = colName(ci) + (ri + 1), s = ri < headerRows ? 1 : 2;
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
      // حماية من تنفيذ المعادلات في إكسل: نص يبدأ برمز معادلة يُخزَّن كنص صريح (inlineStr لا يُفسَّر كمعادلة)
      return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
    }).join('')}</row>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${body}</sheetData></worksheet>`;
  }
  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFA8461A"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1" readingOrder="2"/></xf></cellXfs></styleSheet>`;

  window.XlsxLite = {
    // sheets: [{name, rows: [[...]], widths?: [..], headerRows?: 1}]
    build(sheets) {
      const n = sheets.length;
      const files = [
        {name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`},
        {name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`},
        {name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView rightToLeft="1"/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${xml(sheetName(s.name, i))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`},
        {name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`},
        {name: 'xl/styles.xml', data: STYLES},
        ...sheets.map((s, i) => ({name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.rows, s.widths, s.headerRows ?? 1)}))
      ];
      return new Blob([zipStore(files)], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    },
    // لاختبار الحزمة: يقرأ مدخلات ZIP (STORE) ويتحقق من CRC
    async inspect(blob) {
      const u8 = new Uint8Array(await blob.arrayBuffer()), dv = new DataView(u8.buffer), dec = new TextDecoder(), out = [];
      let eocd = u8.length - 22; if (dv.getUint32(eocd, true) !== 0x06054b50) throw new Error('نهاية الحزمة غير صالحة');
      const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
      for (let i = 0; i < count; i++) {
        if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('سجل مركزي تالف');
        const crc = dv.getUint32(p + 16, true), size = dv.getUint32(p + 24, true), nl = dv.getUint16(p + 28, true), off = dv.getUint32(p + 42, true), name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
        const lnl = dv.getUint16(off + 26, true), data = u8.subarray(off + 30 + lnl, off + 30 + lnl + size);
        out.push({name, size, crcOk: crc32(data) === crc, text: dec.decode(data)}); p += 46 + nl;
      }
      return out;
    },
    // قارئ xlsx مصغّر: يعيد [{name, rows: [[نص...]]}] . يدعم STORE وDEFLATE (عبر DecompressionStream) ونصوص sharedStrings وinlineStr.
    // لا يدعم الملفات المشفّرة ولا ZIP64 ولا صيغة xls القديمة. يُقيَّد بـ 5000 صف و100 عمود لكل ورقة.
    async read(buf) {
      const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), dec = new TextDecoder('utf-8');
      let e = -1; for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
      if (e < 0) throw new Error('الملف ليس بصيغة xlsx صالحة (احفظه من Excel بصيغة .xlsx أو استخدم CSV)');
      const count = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const entries = {};
      for (let i = 0; i < count; i++) {
        if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('الملف تالف');
        const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
        entries[dec.decode(u8.subarray(p + 46, p + 46 + nl))] = {method, csize, off}; p += 46 + nl + el + cl;
      }
      const get = async name => {
        const en = entries[name]; if (!en) return null;
        const start = en.off + 30 + dv.getUint16(en.off + 26, true) + dv.getUint16(en.off + 28, true), raw = u8.subarray(start, start + en.csize);
        if (en.method === 0) return dec.decode(raw);
        if (en.method !== 8) throw new Error('طريقة ضغط غير مدعومة في الملف');
        if (typeof DecompressionStream === 'undefined') throw new Error('هذا المتصفح لا يدعم قراءة xlsx؛ استخدم متصفحًا أحدث أو احفظ الملف بصيغة CSV');
        return dec.decode(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      };
      const parse = s => { const d = new DOMParser().parseFromString(s, 'application/xml'); if (d.getElementsByTagName('parsererror').length) throw new Error('محتوى الملف غير صالح'); return d; };
      const textOf = el => [...el.getElementsByTagName('t')].filter(t => !t.closest('rPh')).map(t => t.textContent).join('');
      const wbXml = await get('xl/workbook.xml'); if (!wbXml) throw new Error('الملف ليس مصنّف Excel');
      const RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
      const rels = {}; const relXml = await get('xl/_rels/workbook.xml.rels');
      if (relXml) [...parse(relXml).getElementsByTagName('Relationship')].forEach(r => { rels[r.getAttribute('Id')] = r.getAttribute('Target'); });
      const ssXml = await get('xl/sharedStrings.xml'); const shared = ssXml ? [...parse(ssXml).getElementsByTagName('si')].map(textOf) : [];
      const colIdx = ref => { let n = 0; for (const ch of ref.replace(/[0-9]/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
      const out = [];
      for (const sh of [...parse(wbXml).getElementsByTagName('sheet')]) {
        const rid = sh.getAttributeNS(RNS, 'id') || sh.getAttribute('r:id'); let target = rels[rid]; if (!target) continue;
        target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
        const sx = await get(target); if (!sx) continue;
        const rows = [];
        for (const row of [...parse(sx).getElementsByTagName('row')].slice(0, 5000)) {
          const r = []; let fallback = 0;
          for (const c of [...row.getElementsByTagName('c')]) {
            const ci = c.getAttribute('r') ? colIdx(c.getAttribute('r')) : fallback; fallback = ci + 1; if (ci > 99) continue;
            const t = c.getAttribute('t'), v = c.getElementsByTagName('v')[0]?.textContent ?? '';
            let val;
            if (t === 's') val = shared[parseInt(v, 10)] ?? '';
            else if (t === 'inlineStr') val = textOf(c);
            else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
            else if (t === 'str' || t === 'e') val = v;
            else val = /^-?\d+(\.\d+)?[eE][+-]?\d+$/.test(v) ? String(Math.round(Number(v))) : v;   // أرقام كبيرة (جوال) بصيغة علمية
            r[ci] = String(val).trim();
          }
          const rn = parseInt(row.getAttribute('r'), 10); while (rn > 0 && rows.length < rn - 1 && rows.length < 5000) rows.push([]);   // الصفوف الفارغة المحذوفة من الملف
          rows.push(Array.from(r, x => x ?? ''));
        }
        out.push({name: sh.getAttribute('name'), rows});
      }
      if (!out.length) throw new Error('لا توجد أوراق في الملف');
      return out;
    },
    // CSV بسيط (UTF-8، الفاصل , أو ; ، علامات الاقتباس)
    readCsv(text) {
      text = String(text).replace(/^﻿/, ''); const first = text.split(/\r?\n/)[0] || ''; const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
      const rows = []; let row = [], cur = '', q = false;
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
        else if (ch === '"') q = true;
        else if (ch === sep) { row.push(cur.trim()); cur = ''; }
        else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur.trim()); cur = ''; rows.push(row); row = []; }
        else cur += ch;
      }
      if (cur !== '' || row.length) { row.push(cur.trim()); rows.push(row); }
      return [{name: 'CSV', rows: rows.slice(0, 5000)}];
    },
    download(blob, filename) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
  };
})();
