const fs = require('node:fs');
const path = require('node:path');
const files = ['index.html','404.html','.nojekyll','styles.css','script.js','home.js','nav-fix.js','supabase-app.js','advanced-supabase.js','production-features.js','central-workspaces.js'];
function hostingConfig(env) {
  let url;
  try { url = new URL(env.SUPABASE_URL); } catch { throw new Error('SUPABASE_URL is required'); }
  if (url.protocol !== 'https:' || !/^[a-z]{20}\.supabase\.co$/.test(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid Supabase project URL');
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(env.SUPABASE_PUBLISHABLE_KEY || '')) throw new Error('Use a publishable key only');
  return {url: url.origin, publishableKey: env.SUPABASE_PUBLISHABLE_KEY, environment:'hosting-preview', externalServices:{email:false,whatsapp:false,signature:false}};
}
function build(env=process.env,root=path.resolve(__dirname,'..')) {
 const config=hostingConfig(env);
 const out=path.join(root,'dist');
 fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
 for(const file of files) fs.copyFileSync(path.join(root,file),path.join(out,file));
 fs.cpSync(path.join(root,'assets'),path.join(out,'assets'),{recursive:true});
 fs.writeFileSync(path.join(out,'supabase-config.js'),`window.EHSAN_SUPABASE = ${JSON.stringify(config,null,2)};\n`);
 return out;
}
module.exports={build,hostingConfig};
if(require.main===module){try{console.log(build())}catch(e){console.error(e.message);process.exitCode=1}}
