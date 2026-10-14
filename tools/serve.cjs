// Serves only the generated allowlisted distribution, never source/configuration files.
const http=require('node:http'), fs=require('node:fs'), path=require('node:path');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.woff2':'font/woff2'};
function createServer(root=path.resolve(__dirname,'../dist')){
 root=path.resolve(root);
 return http.createServer((req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('Cache-Control','no-store');
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'});return res.end();}
  let pathname;try{pathname=decodeURIComponent((req.url||'/').split('?')[0]);}catch{res.writeHead(400);return res.end();}
  if(pathname.includes('\0')||pathname.includes('\\')||pathname.split('/').some(s=>s==='..'||s.startsWith('.'))){res.writeHead(404);return res.end();}
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(404);return res.end();}
  fs.stat(file,(error,stat)=>{
   if(error||!stat.isFile()){res.writeHead(404);return res.end('Not found');}
   res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Length':stat.size});
   if(req.method==='HEAD')return res.end();
   const stream=fs.createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res);
  });
 });
}
module.exports={createServer};
if(require.main===module){const root=path.resolve(__dirname,'../dist');if(!fs.existsSync(path.join(root,'index.html')))throw new Error('Run npm run build first');createServer(root).listen(Number(process.env.PORT)||3000,'0.0.0.0');}
