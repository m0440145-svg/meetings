const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {build,hostingConfig}=require('../tools/build-hosting.cjs');
const {createServer}=require('../tools/serve.cjs');
const env={SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'};
test('hosting config rejects missing and secret credentials',()=>{
 assert.throws(()=>hostingConfig({}));
 for(const key of ['sb_secret_abc','eyJ.service_role',''])assert.throws(()=>hostingConfig({...env,SUPABASE_PUBLISHABLE_KEY:key}));
 assert.throws(()=>hostingConfig({...env,SUPABASE_URL:'https://user:pass@abcdefghijklmnopqrst.supabase.co'}));
 assert.deepEqual(hostingConfig(env).externalServices,{email:false,whatsapp:false,signature:false});
});
test('build allowlists public assets and clears stale files',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'meetings-build-'));
 try{
  for(const f of ['index.html','404.html','.nojekyll','styles.css','script.js','home.js','nav-fix.js','supabase-app.js','advanced-supabase.js','production-features.js'])fs.writeFileSync(path.join(dir,f),'fixture');
  fs.mkdirSync(path.join(dir,'assets'));fs.writeFileSync(path.join(dir,'.env'),'secret');
  fs.mkdirSync(path.join(dir,'dist'));fs.writeFileSync(path.join(dir,'dist','stale.txt'),'stale');
  const out=build({...env,SECRET_KEY:'must-not-appear'},dir);
  assert.equal(fs.existsSync(path.join(out,'.env')),false);assert.equal(fs.existsSync(path.join(out,'stale.txt')),false);
  assert.equal(fs.readFileSync(path.join(out,'supabase-config.js'),'utf8').includes('must-not-appear'),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('hosting server serves assets, rejects traversal and does not expose repository',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'meetings-server-'));fs.writeFileSync(path.join(dir,'index.html'),'<h1>meeting</h1>');
 const server=createServer(dir);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const r=await fetch(base);assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/text\/html/);assert.equal(r.headers.get('x-content-type-options'),'nosniff');
  for(const url of ['/package.json','/.env','/%2e%2e%2fpackage.json','/%ZZ'])assert.ok([400,404].includes((await fetch(base+url)).status));
  assert.equal((await fetch(base,{method:'POST'})).status,405);assert.equal(await(await fetch(base,{method:'HEAD'})).text(),'');
 }finally{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true})}
});
test('deferred providers have no dispatch or fake signature path',()=>{
 const code=fs.readFileSync('production-features.js','utf8'),advanced=fs.readFileSync('advanced-supabase.js','utf8');
 assert.doesNotMatch(code,/functions\.invoke\(fn/);assert.match(code,/disabled title=.*id="processEmailJobs"/);
 assert.doesNotMatch(advanced,/SIGNED:/);assert.doesNotMatch(advanced,/from\('delivery_jobs'\)\.insert/);
});
