const fs = require('node:fs');
const path = require('node:path');
const PRODUCTION_REF = 'hmauemcowlaqujeatbaz';
const files = ['index.html', 'styles.css', 'script.js', 'home.js', 'nav-fix.js', 'supabase-app.js', 'advanced-supabase.js', 'production-features.js','central-workspaces.js', '404.html', '.nojekyll'];
function stagingConfig(env) {
  let url;
  try { url = new URL(env.STAGING_SUPABASE_URL); } catch { throw new Error('STAGING_SUPABASE_URL is required'); }
  if (url.protocol !== 'https:' || !/^[a-z]{20}\.supabase\.co$/.test(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use a dedicated Supabase staging project URL');
  if (url.hostname === `${PRODUCTION_REF}.supabase.co`) throw new Error('Production database is forbidden in staging');
  const key = env.STAGING_SUPABASE_PUBLISHABLE_KEY || '';
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) throw new Error('A publishable key is required; never provide a secret/service-role key');
  return { url: url.origin, publishableKey: key, environment: 'staging' };
}
function build(env = process.env, root = path.resolve(__dirname, '..')) {
  const cfg = stagingConfig(env);
  const out = path.join(root, '.staging');
  fs.mkdirSync(out, { recursive: true });
  for (const file of files) fs.copyFileSync(path.join(root, file), path.join(out, file));
  fs.cpSync(path.join(root, 'assets'), path.join(out, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(out, 'supabase-config.js'), `window.EHSAN_SUPABASE = ${JSON.stringify(cfg, null, 2)};\n`);
  return out;
}
module.exports = { stagingConfig, build };
if (require.main === module) {
  try { console.log(build()); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
