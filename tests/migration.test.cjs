const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {expected,target}=require('../tools/assemble-migration.cjs');
test('CLI-created migration exactly matches tested SQL candidates',()=>assert.equal(fs.readFileSync(target(),'utf8'),expected()));
