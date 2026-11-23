'use strict';
// فحوصات ثابتة (بلا قاعدة بيانات): تمنع أخطاء نشر وإعداد شائعة. تعمل في CI عبر: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

test('migrations: numbering is unique and sequential, files are not empty', () => {
  const files = fs.readdirSync(path.join(root, 'supabase', 'migrations')).filter(f => f.endsWith('.sql')).sort();
  assert.ok(files.length >= 46, 'expected at least 46 migrations, found ' + files.length);
  files.forEach((f, i) => {
    const m = /^(\d{3})_[\w-]+\.sql$/.exec(f);
    assert.ok(m, 'bad migration file name: ' + f);
    assert.equal(Number(m[1]), i + 1, 'numbering gap or duplicate at ' + f);
    assert.ok(read('supabase/migrations/' + f).trim().length > 50, f + ' is empty');
  });
});

test('every script loaded by home.js exists and is copied by pages.yml', () => {
  const home = read('home.js');
  const line = read('.github/workflows/pages.yml').split('\n').find(l => /cp index\.html /.test(l));
  assert.ok(line, 'cp line not found in pages.yml');
  const published = new Set(line.trim().split(/\s+/).slice(1, -1));
  const loaded = [...home.matchAll(/loadScript\('([^']+\.js)'/g)].map(m => m[1]);
  assert.ok(loaded.length > 30, 'expected many loadScript calls, found ' + loaded.length);
  for (const f of loaded) {
    assert.ok(fs.existsSync(path.join(root, f)), 'file loaded by home.js is missing: ' + f);
    assert.ok(published.has(f), 'file is loaded by home.js but not published by pages.yml: ' + f);
  }
});

test('Content-Security-Policy stays strict', () => {
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(read('index.html'));
  assert.ok(csp, 'CSP meta tag not found');
  const p = csp[1];
  assert.ok(!/script-src[^;]*'unsafe-(inline|eval)'/.test(p), 'script-src must not allow unsafe-inline/unsafe-eval');
  assert.ok(!/img-src[^;]*\shttps:(\s|;|$)/.test(p), 'img-src must not allow any https host');
  assert.match(p, /object-src 'none'/);
  assert.match(p, /base-uri 'self'/);
});

test('no secrets are committed', () => {
  const rules = [
    [/sb_secret_[A-Za-z0-9_-]{10,}/, 'Supabase secret key'],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
    [/eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/, 'JWT'],
    [/service_role['"]?\s*[:=]\s*['"][A-Za-z0-9._-]{30,}/, 'service_role key assignment']
  ];
  const textExt = new Set(['.js', '.cjs', '.html', '.css', '.sql', '.md', '.yml', '.yaml', '.json', '.csv', '.txt']);
  const bad = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (rel === 'tests/static.test.cjs' || rel === 'package-lock.json') continue;
      if (!textExt.has(path.extname(e.name).toLowerCase()) || fs.statSync(full).size > 2 * 1024 * 1024) continue;
      const t = fs.readFileSync(full, 'utf8');
      for (const [re, name] of rules) if (re.test(t)) bad.push(rel + ' (' + name + ')');
    }
  })(root);
  assert.deepEqual(bad, [], 'possible secrets found: ' + bad.join(', '));
});

test('frame-src allows only the media providers used by meeting-media.js (and media-src has no wildcard host)', () => {
  const {FRAME_HOSTS} = require('../meeting-media.js');
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(read('index.html'))[1];
  const tokens = /frame-src ([^;]+)/.exec(csp)[1].trim().split(/\s+/);
  assert.ok(!tokens.includes('https:') && !tokens.includes('*') && !tokens.includes('http:'), 'frame-src must not allow any https/any host');
  const hosts = tokens.filter(t => t.startsWith('https://')).map(t => t.slice(8)).sort();
  assert.deepEqual(hosts, [...FRAME_HOSTS, '*.sharepoint.com'].sort(), 'frame-src and FRAME_HOSTS in meeting-media.js must match');
  const media = /media-src ([^;]+)/.exec(csp);
  assert.ok(media && !media[1].split(/\s+/).includes('*'), 'media-src must exist and not be a bare wildcard');
});