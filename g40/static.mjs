import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {recordedProof,proofReader} from './proof.mjs';
const roots={market:fileURLToPath(new URL('../g36/site/',import.meta.url)),studio:fileURLToPath(new URL('../g37/studio/',import.meta.url)),finance:fileURLToPath(new URL('../g38/public/',import.meta.url)),public:fileURLToPath(new URL('./public/',import.meta.url))};
const content={'.html':'text/html','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.csv':'text/csv'};
function file(root,name,edit){const resolved=path.resolve(root,name);if(!resolved.startsWith(root)||!content[path.extname(resolved)]||!fs.existsSync(resolved)||!fs.statSync(resolved).isFile())return null;const body=fs.readFileSync(resolved);return {body:edit?Buffer.from(edit(body.toString())):body,headers:{'content-type':content[path.extname(resolved)]+'; charset=utf-8'}};}
export function staticRoutes(config,{live=proofReader()}={}){return async(req,url)=>{
 if(req.method!=='GET'&&req.method!=='HEAD')return null;const p=decodeURIComponent(url.pathname);
 if(config.role==='bridge'){
  if(p==='/api/live'){try{return {body:Buffer.from(JSON.stringify(await live())),headers:{'content-type':'application/json'}};}catch{return {status:503,body:Buffer.from(JSON.stringify({error:'FINALIZED_TESTNET_READ_UNAVAILABLE',mutation_mode:false,recorded_evidence:'/api/evidence'}))};}}
  if(p==='/api/evidence')return {body:Buffer.from(JSON.stringify(recordedProof())),headers:{'content-type':'application/json'}};
  if(p==='/verified')return file(roots.public,'proof.html');
  if(p==='/g40-proof.mjs')return file(roots.public,'proof.mjs');
  if(p==='/studio')return file(roots.studio,'index.html',s=>s.replace('src="/app.mjs"','src="/studio-app.mjs"'));
  if(p==='/studio-app.mjs')return file(roots.studio,'app.mjs');if(p==='/bridge.css')return file(roots.studio,'bridge.css');
  if(p==='/finance')return file(roots.finance,'index.html');if(['/finance.mjs','/finance.css'].includes(p))return file(roots.finance,p.slice(1));
  if(p==='/proof')return file(roots.market,'g35-proof.json');
  if(p.startsWith('/assets/'))return file(roots.market,p.slice(8));
  if(p.startsWith('/studio/api/')||p.startsWith('/v1/')||p.startsWith('/finance/api/')||p==='/live/capability')return null;
  return file(roots.market,p==='/'?'index.html':p.slice(1),p==='/'?s=>s.replace('<nav id="global-nav" aria-label="Main navigation">','<nav id="global-nav" aria-label="Main navigation"><a href="/finance">Financial evaluation</a><a href="/verified">Finalized evidence</a>'):undefined)||{status:404,body:Buffer.from('{"error":"NOT_FOUND"}')};
 }
 if(p==='/style.css')return file(fileURLToPath(new URL('../g37/paperlane/public/',import.meta.url)),'style.css');return null;
};}
