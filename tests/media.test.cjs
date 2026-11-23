'use strict';
// تحويل روابط العرض إلى تضمين آمن: يختبر الدالة النقية toEmbed في meeting-media.js (أمنيًا: https فقط، قائمة مزوّدين محددة، لا انتحال للنطاقات).
const test = require('node:test');
const assert = require('node:assert/strict');
const {toEmbed, allowedFrame, FRAME_HOSTS} = require('../meeting-media.js');

const e = u => toEmbed(u);

test('rejects non-https, credentials and garbage', () => {
  for (const bad of ['http://www.youtube.com/watch?v=dQw4w9WgXcQ', 'javascript:alert(1)', 'data:text/html,<script>1</script>', 'ftp://x.com/a.pptx', 'https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ', '', null, undefined, 'not a url', '//youtube.com/watch?v=dQw4w9WgXcQ']) {
    assert.equal(e(bad), null, 'should reject: ' + bad);
  }
});

test('YouTube variants become the privacy-friendly embed', () => {
  const id = 'dQw4w9WgXcQ';
  for (const u of [`https://www.youtube.com/watch?v=${id}`, `https://youtu.be/${id}`, `https://m.youtube.com/watch?v=${id}&feature=share`, `https://www.youtube.com/shorts/${id}`, `https://www.youtube.com/embed/${id}`, `https://www.youtube-nocookie.com/embed/${id}`]) {
    const r = e(u);
    assert.equal(r.kind, 'frame', u);
    assert.equal(r.embed, `https://www.youtube-nocookie.com/embed/${id}?rel=0`, u);
  }
  assert.equal(e(`https://youtu.be/${id}?t=90`).embed, `https://www.youtube-nocookie.com/embed/${id}?rel=0&start=90`);
  assert.equal(e('https://www.youtube.com/watch?v=short').kind, 'link'); // معرّف غير صالح
  assert.equal(e('https://www.youtube.com/@channel').kind, 'link');
});

test('lookalike hosts are never embedded', () => {
  for (const u of ['https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ', 'https://evilyoutube.com/watch?v=dQw4w9WgXcQ', 'https://www.canva.com.evil.io/design/DAFabc123/xyz789/view', 'https://vimeo.com.attacker.net/123456789', 'https://x.sharepoint.com.evil.com/:p:/s/a/b', 'https://evil-sharepoint.com/:p:/s/a/b', 'https://docs.google.com.evil.com/presentation/d/abcdefghij12/edit']) {
    const r = e(u);
    assert.equal(r.kind, 'link', u);
    assert.equal(r.embed, undefined, u);
  }
});

test('Vimeo, Canva, Loom', () => {
  assert.equal(e('https://vimeo.com/123456789').embed, 'https://player.vimeo.com/video/123456789');
  assert.equal(e('https://vimeo.com/123456789/abcdef1234').embed, 'https://player.vimeo.com/video/123456789?h=abcdef1234');
  assert.equal(e('https://player.vimeo.com/video/123456789?h=abcdef1234').embed, 'https://player.vimeo.com/video/123456789?h=abcdef1234');
  assert.equal(e('https://www.canva.com/design/DAFabc123XYZ/aBcDeF123456/view?utm_content=DAF&utm_campaign=designshare').embed, 'https://www.canva.com/design/DAFabc123XYZ/aBcDeF123456/view?embed');
  assert.equal(e('https://www.canva.com/design/DAFabc123XYZ/watch').embed, 'https://www.canva.com/design/DAFabc123XYZ/view?embed');
  assert.equal(e('https://www.canva.com/folder/abc').kind, 'link');
  assert.equal(e('https://www.loom.com/share/0123456789abcdef0123456789abcdef').embed, 'https://www.loom.com/embed/0123456789abcdef0123456789abcdef');
});

test('Google Slides and Drive', () => {
  assert.equal(e('https://docs.google.com/presentation/d/1AbCdEfGhIjKlMnOp/edit?usp=sharing').embed, 'https://docs.google.com/presentation/d/1AbCdEfGhIjKlMnOp/preview');
  assert.equal(e('https://docs.google.com/presentation/d/e/2PACX-1vTabcdefghijkl/pub?start=false').embed, 'https://docs.google.com/presentation/d/e/2PACX-1vTabcdefghijkl/embed?start=false&loop=false&delayms=3000');
  assert.equal(e('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing').embed, 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/preview');
  assert.equal(e('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp').embed, 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/preview');
  assert.equal(e('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit').kind, 'link'); // مستند لا عرض
});

test('PowerPoint: OneDrive embed, SharePoint, public pptx via Office Online', () => {
  assert.equal(e('https://onedrive.live.com/embed?cid=ABC&resid=ABC%21123&authkey=xyz&em=2').kind, 'frame');
  assert.equal(e('https://onedrive.live.com/redir?resid=ABC').kind, 'link');
  assert.equal(e('https://1drv.ms/p/s!AbCdEf').kind, 'link'); // الروابط المختصرة لا تُضمَّن
  const sp = e('https://contoso.sharepoint.com/:p:/s/team/EabcDEF?e=123');
  assert.equal(sp.kind, 'frame');
  assert.match(sp.embed, /^https:\/\/contoso\.sharepoint\.com\/:p:\/s\/team\/EabcDEF\?e=123&action=embedview$/);
  assert.equal(e('https://contoso-my.sharepoint.com/personal/a/_layouts/15/Doc.aspx?sourcedoc=%7BX%7D&action=embedview').kind, 'frame');
  const pp = e('https://files.example.org/decks/board 1.pptx');
  assert.equal(pp.kind, 'frame');
  assert.equal(pp.embed, 'https://view.officeapps.live.com/op/embed.aspx?src=' + encodeURIComponent('https://files.example.org/decks/board%201.pptx'));
});

test('direct video files and unknown links', () => {
  const v = e('https://cdn.example.org/a/clip.mp4?x=1');
  assert.deepEqual([v.kind, v.src], ['video', 'https://cdn.example.org/a/clip.mp4?x=1']);
  const l = e('https://example.org/page');
  assert.deepEqual([l.kind, l.embed], ['link', undefined]);
});

test('every embed produced is on the frame allow-list (same list as the CSP)', () => {
  const samples = ['https://youtu.be/dQw4w9WgXcQ', 'https://vimeo.com/123456789', 'https://www.canva.com/design/DAFabc123XYZ/aBcDeF123456/view', 'https://docs.google.com/presentation/d/1AbCdEfGhIjKlMnOp/edit',
    'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view', 'https://onedrive.live.com/embed?cid=1', 'https://contoso.sharepoint.com/:p:/s/t/Eabc', 'https://a.org/x.pptx', 'https://www.loom.com/share/0123456789abcdef0123456789abcdef'];
  for (const u of samples) { const r = e(u); assert.equal(r.kind, 'frame', u); assert.ok(allowedFrame(r.embed), u); }
  assert.ok(!allowedFrame('https://evil.com/x'));
  assert.ok(!allowedFrame('https://contoso.sharepoint.com.evil.com/x'));
  assert.ok(!allowedFrame('http://www.youtube-nocookie.com/embed/x'));
  assert.ok(FRAME_HOSTS.length >= 8);
});
