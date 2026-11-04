// Allowlisted Railway artifact; never packages credentials, journals, node_modules or raw customer inputs.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {validateContext} from './build-context.mjs';
import {checkRelease} from '../g37/bridge/domain.mjs';
checkRelease();
const root=fileURLToPath(new URL('../',import.meta.url)),destination=path.join(root,'g40/build'),out=fs.existsSync(destination)?fs.mkdtempSync(path.join(root,'g40/.build-')):destination,files={},seen=new Set(),sha=b=>createHash('sha256').update(b).digest('hex');
fs.mkdirSync(out,{recursive:true});
function copy(name,bytes){assert(!name.split('/').includes('..'));bytes??=fs.readFileSync(path.join(root,name));const dest=path.join(out,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes,{flag:'wx'});files[name]=sha(bytes);}
function module(name){name=name.replaceAll('\\','/');if(seen.has(name))return;seen.add(name);assert(/^(g41|g40|g39|g38|g37|g36|apps\/earnpatch)\//.test(name)&&name.endsWith('.mjs'),'SOURCE_IMPORT_OUTSIDE_ALLOWLIST');const text=fs.readFileSync(path.join(root,name),'utf8');const checked=spawnSync(process.execPath,['--check',path.join(root,name)],{encoding:'utf8',windowsHide:true});assert.equal(checked.status,0,checked.stderr);copy(name,Buffer.from(text));for(const match of text.matchAll(/(?:from\s*|import\s*\(\s*)['"](\.[^'"]+\.mjs)['"]/g))module(path.posix.normalize(path.posix.join(path.posix.dirname(name),match[1])));}
module('g40/server.mjs');
for(const dir of ['g36/site','g37/studio','g37/paperlane/public','g38/public','g40/public','g41/ui']){
 const walk=d=>{for(const e of fs.readdirSync(path.join(root,d),{withFileTypes:true})){const name=d+'/'+e.name;if(e.isDirectory())walk(name);else if(/\.(mjs|js|txt|html|css|svg|json|csv)$/.test(name)&&name!=='g40/public/testnet-proof.json'&&!name.endsWith('BUILD_MANIFEST.json')&&!files[name])copy(name);}};walk(dir);
}
// The approved CSV release hash includes these exact source files.
for(const name of ['public/g25-engine.mjs','public/csv.mjs','public/contract.mjs','backend/service.mjs','backend/chain.mjs','backend/security.mjs','backend/store.mjs'])if(!files['apps/earnpatch/'+name])copy('apps/earnpatch/'+name);
for(const name of ['package.json','package-lock.json'])copy('g40/'+name);
copy('g41/live/profile.json');
// Public accepted evidence is checked in; rebuilding never reads private operational journals.
const proofBytes=fs.readFileSync(path.join(root,'g40/public/testnet-proof.json'));const proof=JSON.parse(proofBytes);assert.equal(proof.network,'testnet');assert.equal(proof.transactions.length,42);copy('g40/public/testnet-proof.json',proofBytes);
for(const name of ['Dockerfile','railway.json','.dockerignore'])copy(name,fs.readFileSync(path.join(root,'g40',name)));
const size=Object.keys(files).reduce((n,f)=>n+fs.statSync(path.join(out,f)).size,0);assert(!Object.keys(files).some(n=>/node_modules|\/data\/|\.env|credential|keychain|operations\/|runs\//i.test(n)),'PRIVATE_FILE_IN_BUILD');
fs.writeFileSync(path.join(out,'BUILD_MANIFEST.json'),JSON.stringify({status:'LOCAL_RAILWAY_ARTIFACT_NOT_DEPLOYED',files,bytes:size},null,2));validateContext(out);console.log(JSON.stringify({status:'G40_BUILD_PASS',files:Object.keys(files).length,bytes:size,path:out}));
if(out!==destination){assert(path.resolve(destination)===path.join(root,'g40/build')&&!fs.lstatSync(destination).isSymbolicLink(),'UNSAFE_BUILD_TARGET');const archive=path.join(root,'g40/evidence/build-prior-'+Date.now());assert(archive.startsWith(path.join(root,'g40/evidence')));fs.mkdirSync(path.dirname(archive),{recursive:true});fs.renameSync(destination,archive);fs.renameSync(out,destination);}
