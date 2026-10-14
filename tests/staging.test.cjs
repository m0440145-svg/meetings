const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stagingConfig } = require('../tools/build-staging.cjs');
const valid = { STAGING_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', STAGING_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' };
test('staging refuses production even with a different key', () => {
  assert.throws(() => stagingConfig({ ...valid, STAGING_SUPABASE_URL: 'https://hmauemcowlaqujeatbaz.supabase.co' }), /Production/);
});
test('staging refuses private keys and missing configuration', () => {
  for (const key of ['sb_secret_test', 'eyJ.service_role', '', undefined]) assert.throws(() => stagingConfig({ ...valid, STAGING_SUPABASE_PUBLISHABLE_KEY: key }));
  assert.throws(() => stagingConfig({}));
});
test('staging rejects untrusted hosts, insecure URLs and embedded credentials', () => {
  for (const url of ['http://abcdefghijklmnopqrst.supabase.co', 'https://supabase.co.evil.test', 'https://user:pass@abcdefghijklmnopqrst.supabase.co', valid.STAGING_SUPABASE_URL + '/api']) assert.throws(() => stagingConfig({ ...valid, STAGING_SUPABASE_URL: url }));
});
test('staging accepts a separate project and emits only public configuration', () => {
  const cfg = stagingConfig({ ...valid, SERVICE_ROLE_KEY: 'never-emit' });
  assert.equal(cfg.environment, 'staging');
  assert.equal(JSON.stringify(cfg).includes('never-emit'), false);
});
test('all existing browser scripts parse', () => {
  for (const file of fs.readdirSync('.').filter(f => f.endsWith('.js'))) new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file });
});
test('retains cloud mode and the existing stylesheet', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /data-backend="supabase"/);
  assert.match(html, /styles\.css/);
});
