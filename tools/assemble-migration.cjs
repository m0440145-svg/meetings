const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const parts=['access-hardening','meeting-lifecycle','central-workspaces'];
function expected(){return '-- Candidate: requires existing application schema. Validate on hosted staging before production.\nBEGIN;\n'+parts.map(p=>fs.readFileSync(path.join(root,`database/proposals/${p}.sql`),'utf8').replace(/^begin;\s*$/gmi,'').replace(/^commit;\s*$/gmi,'')).join('\n')+'\nCOMMIT;\n';}
function target(){const files=fs.readdirSync(path.join(root,'supabase/migrations')).filter(p=>p.endsWith('_central_lifecycle_candidate.sql'));if(files.length!==1)throw new Error('Expected one CLI-created candidate migration');return path.join(root,'supabase/migrations',files[0]);}
module.exports={expected,target};
if(require.main===module){fs.writeFileSync(target(),expected());console.log('Candidate migration assembled');}
