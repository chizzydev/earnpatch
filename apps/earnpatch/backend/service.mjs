import fs from 'node:fs';import path from 'node:path';import {randomBytes} from 'node:crypto';
import {Chain} from './chain.mjs';import {Store} from './store.mjs';import {sha,token,verifyMessage} from './security.mjs';
import {FROZEN,account,feature,same,operation} from '../public/contract.mjs';import {parse,transform} from '../public/csv.mjs';
const fail=(ok,message)=>{if(!ok)throw Error(message);};
const root=new URL('../',import.meta.url);
export const releaseText=JSON.stringify({service:'EarnPatch SafeShare server v1',files:Object.fromEntries(['public/g25-engine.mjs','public/csv.mjs','public/contract.mjs','backend/service.mjs','backend/chain.mjs','backend/security.mjs','backend/store.mjs'].map(p=>[p,sha(fs.readFileSync(new URL(p,root)))]))},null,2);
export const releaseHash=sha(releaseText);
export function configuration(env=process.env){const contract=account(env.G30_CONTRACT||FROZEN);return {contract,network:'testnet',writes:env.G30_ENABLE_WRITES==='1'&&contract!==FROZEN,releaseHash,paidService:contract!==FROZEN&&env.G30_ENABLE_WRITES==='1'};}
export class Marketplace {
 constructor({config=configuration(),chain=new Chain(config.contract),store=new Store(new URL('../data/',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')),now=()=>Date.now()}={}){this.config=config;this.chain=chain;this.store=store;this.now=now;this.locks=new Set();this.rates=new Map();}
 cookie(req){return /(?:^|;\s*)g30_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie||'')?.[1];}
 session(req){const key=this.cookie(req);fail(key,'Session cookie required');return sha(key);}
 issueCookie(req,res){let t=this.cookie(req);if(!t){t=token();res.setHeader('Set-Cookie',`g30_session=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`);}return sha(t);}
 guard(req){fail(this.config.writes,'G28 proof profile is read-only; select an isolated G30 contract');fail(/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host||''),'LOCAL_HOST_REQUIRED');const origin=`http://${req.headers.host}`;fail(req.headers.origin===origin,'SAME_ORIGIN_REQUIRED');fail(!req.headers['sec-fetch-site']||req.headers['sec-fetch-site']==='same-origin','CROSS_SITE_BLOCKED');const minute=Math.floor(this.now()/60000);if(this.rateMinute!==minute){this.rateMinute=minute;this.rateCount=0;}fail(++this.rateCount<=120,'Local API rate limit');}
 bounded(){const now=this.now();for(const [id,j] of Object.entries(this.store.value.jobs))if(j.expires<now&&j.status==='ISSUED')delete this.store.value.jobs[id];for(const [id,j] of Object.entries(this.store.value.auth))if(j.expires<now)delete this.store.value.auth[id];}
 async effect(op,block){
 const a=op.args,c={view:(m,args)=>this.chain.view(m,args,op.method==='withdraw'?undefined:block)};if(op.method==='purchase'){const order=await c.view('get_order',{buyer:op.account,order_id:a.order_id});fail(order&&order.buyer===op.account&&same(order.feature,a.feature)&&order.price===op.deposit,'ORDER_EFFECT_MISMATCH');return {order,credits:await c.view('get_credits',{buyer:op.account,feature:a.feature})};}
 if(op.method==='consume_use'){fail(same(await c.view('get_action',{buyer:op.account,action_id:a.action_id}),a.feature),'CONSUMPTION_EFFECT_MISMATCH');return {credits:await c.view('get_credits',{buyer:op.account,feature:a.feature})};}
 if(op.method==='withdraw'){const ledger=await c.view('get_payout',{account_id:op.account});return {ledger,native_payout_verified:true};}
 if(['create_product','fund_storage','update_product'].includes(op.method)){const product=await c.view('get_product',{owner:op.account,product_id:a.product_id});fail(product?.owner===op.account,'PRODUCT_EFFECT_MISMATCH');return {product};}
 const f=await c.view('get_opportunity',{feature:a.feature});fail(f,'Missing opportunity');const expected={open_opportunity:'open',accept:'accepted',submit:'submitted',approve:'live',set_paused:a.paused?'paused':'live'}[op.method];if(expected)fail(f.status===expected,'FEATURE_EFFECT_MISMATCH');if(op.method==='submit')fail(f.submitted_sha256===a.artifact_sha256,'ARTIFACT_EFFECT_MISMATCH');if(op.method==='approve')fail(f.approved_sha256===a.artifact_sha256,'ARTIFACT_EFFECT_MISMATCH');return {feature:f};
 }
 async reconcile(op){fail(op.contract===this.config.contract,'Contract mismatch');operation(op.contract,op.account,op.method,op.args,op.deposit);const verified=await this.chain.final(op);if(verified.state==='FINALIZED_SUCCESS')verified.effect=await this.effect(op,verified.block_hash);else if(verified.payout_restored){const ledger=await this.chain.view('get_payout',{account_id:op.account},verified.block_hash);fail(ledger.pending==='0'&&BigInt(ledger.claimable)>=BigInt(op.args.amount),'PAYOUT_RESTORE_STATE_NOT_VERIFIED');verified.effect={ledger,claimable_restored:true};}return verified;}
 async handle(req,res,send,url,body){const route=url.pathname;if(!route.startsWith('/api/g30/'))return false;
 try{
 if(req.method==='GET'){
 if(route==='/api/g30/config'){await this.chain.verifyDeployment();send(200,this.config);}
 else if(route==='/api/g30/release')send(200,{text:releaseText,sha256:releaseHash});
 else if(route==='/api/g30/registry')send(200,{items:this.store.value.registry.filter(x=>x.contract===this.config.contract),transactions:this.store.value.transactions.filter(x=>x.contract===this.config.contract)});
 else if(route==='/api/g30/balance')send(200,await this.chain.balance(url.searchParams.get('account')));
 else if(route==='/api/g30/artifact'){
 const binding=this.session(req),signed=Object.values(this.store.value.auth).find(ch=>ch.used&&ch.contract===this.config.contract&&ch.binding===binding&&ch.expires>=this.now());fail(signed,'MESSAGE_AUTHENTICATION_REQUIRED');const f=await this.chain.view('get_opportunity',{feature:feature(JSON.parse(url.searchParams.get('feature')))});fail(f&&(signed.account===f.id.owner||signed.account===f.developer),'ARTIFACT_REVIEWER_REQUIRED');const hash=url.searchParams.get('hash');fail(/^[a-f0-9]{64}$/.test(hash||'')&&(f.submitted_sha256===hash||f.approved_sha256===hash),'ARTIFACT_IDENTITY_MISMATCH');const file=path.join(this.store.dir,'artifacts',hash);fail(fs.existsSync(file),'Artifact not hosted: obtain the original file from the developer');const bytes=fs.readFileSync(file);fail(sha(bytes)===hash,'STORED_ARTIFACT_CHANGED');send(200,{hash,base64:bytes.toString('base64')});}
 else if(route==='/api/g30/view'){const args=JSON.parse(url.searchParams.get('args')||'{}');send(200,{value:await this.chain.view(url.searchParams.get('method'),args)});}
 else send(404,{error:'Unknown API'});return true;
 }
 fail(req.method==='POST','Method not allowed');this.guard(req);const data=await body(req);fail(data&&typeof data==='object'&&!Array.isArray(data),'INVALID_JSON_BODY');await this.chain.verifyDeployment();const binding=this.issueCookie(req,res);this.bounded();
 if(route==='/api/g30/reconcile'){send(200,await this.reconcile(data.operation));return true;}
 if(route==='/api/g30/auth/challenge'){
 const id=token(),nonce=randomBytes(32).toString('base64'),recipient=`http://${req.headers.host}`,expires=this.now()+300000;
 const message=`Sign in to EarnPatch G30 on NEAR testnet.\nContract: ${this.config.contract}\nChallenge: ${id}\nExpires: ${expires}`;
 fail(Object.keys(this.store.value.auth).length<100,'Too many authentication challenges');this.store.value.auth[id]={id,nonce,recipient,message,expires,binding,contract:this.config.contract};this.store.save();send(200,{id,nonce,recipient,message,expires});return true;
 }
 if(route==='/api/g30/auth/verify'){
 const ch=this.store.value.auth[data.id];fail(ch&&ch.contract===this.config.contract&&ch.binding===binding&&!ch.used&&ch.expires>=this.now(),'AUTH_CHALLENGE_INVALID');
 account(data.response.accountId);verifyMessage(ch,data.response);
 const access=await this.chain.call('query',{request_type:'view_access_key',account_id:data.response.accountId,public_key:data.response.publicKey,finality:'final'});fail(access.permission==='FullAccess','FULL_ACCESS_MESSAGE_KEY_REQUIRED');
 // Recheck after RPC await: two simultaneous verifies cannot use one challenge.
 fail(!ch.used&&ch.expires>=this.now(),'AUTH_REPLAY_OR_EXPIRED');ch.used=true;ch.account=data.response.accountId;this.store.save();send(200,{account:ch.account,expires:ch.expires});return true;
 }
 if(route==='/api/g30/metadata'){
 const op=data.operation,result=await this.reconcile(op);fail(result.state==='FINALIZED_SUCCESS','FINALIZED_SUCCESS_REQUIRED');
 fail(['create_product','open_opportunity','submit'].includes(op.method),'Metadata requires product/commission/submission proof');
 fail(this.store.value.registry.length<1000,'Registry quota');const metadata=data.metadata||{};fail(JSON.stringify(metadata).length<20000,'Metadata too large');
 const authenticated=Object.values(this.store.value.auth).some(ch=>ch.used&&ch.contract===this.config.contract&&ch.binding===binding&&ch.account===op.account&&ch.expires>=this.now());
 if(!authenticated&&Object.keys(metadata).length){fail(op.method==='open_opportunity'&&Object.keys(metadata).length===1&&typeof metadata.requirements==='string'&&sha(metadata.requirements)===op.args.terms.requirements_sha256,'METADATA_MESSAGE_AUTHENTICATION_REQUIRED');}
 let artifact=null;if(data.artifact){fail(op.method==='submit','Artifact requires verified submission');const bytes=Buffer.from(data.artifact,'base64');fail(bytes.length<=5e6&&sha(bytes)===op.args.artifact_sha256,'ARTIFACT_BYTES_MISMATCH');const dir=path.join(this.store.dir,'artifacts');fs.mkdirSync(dir,{recursive:true});artifact=op.args.artifact_sha256;const file=path.join(dir,artifact);if(fs.existsSync(file))fail(sha(fs.readFileSync(file))===artifact,'STORED_ARTIFACT_CHANGED');else{fail(fs.readdirSync(dir).length<20,'Artifact quota');fs.writeFileSync(file,bytes,{mode:0o600,flag:'wx'});}}
 const row={contract:this.config.contract,account:op.account,method:op.method,args:op.args,hash:op.hash,metadata,artifact};
 const existingRow=this.store.value.registry.find(x=>x.hash===op.hash);if(!existingRow)this.store.value.registry.push(row);else {if(authenticated||(op.method==='open_opportunity'&&Object.hasOwn(metadata,'requirements')))existingRow.metadata=metadata;if(artifact)existingRow.artifact=artifact;}
 if(!this.store.value.transactions.some(x=>x.hash===op.hash))this.store.value.transactions.push({contract:this.config.contract,hash:op.hash,method:op.method,account:op.account});this.store.save();send(200,row);return true;
 }
 if(route==='/api/g30/service/challenge'){
 fail(/^[a-f0-9-]{36}$/.test(data.request_id||''),'Stable service request ID required');
 const existing=()=>Object.values(this.store.value.jobs).find(j=>j.contract===this.config.contract&&j.request_id===data.request_id&&j.binding===binding);
 const respond=j=>{fail(j.buyer===data.buyer&&j.digest===data.digest&&same(j.feature,data.feature),'CHALLENGE_INTENT_CHANGED');send(200,{id:j.id,action:j.action,expires:j.expires,feature:j.feature});};
 if(existing()){respond(existing());return true;}
 feature(data.feature);account(data.buyer);fail(/^[a-f0-9]{64}$/.test(data.digest),'Input digest required');
 const f=await this.chain.view('get_opportunity',{feature:data.feature});fail(f?.status==='live','FEATURE_NOT_LIVE');fail(f.approved_sha256===releaseHash,'SERVICE_ARTIFACT_NOT_APPROVED');
 const credits=await this.chain.view('get_credits',{buyer:data.buyer,feature:data.feature});fail(BigInt(credits)>0n,'NO_PAID_USE');
 if(existing()){respond(existing());return true;}fail(Object.keys(this.store.value.jobs).length<1000,'Local job quota reached; retain existing jobs and archive delivered records before accepting more');const id=token(),action='g30-'+randomBytes(24).toString('hex');this.store.value.jobs[id]={id,action,contract:this.config.contract,request_id:data.request_id,feature:data.feature,buyer:data.buyer,digest:data.digest,binding,expires:this.now()+1800000,status:'ISSUED'};this.store.save();respond(this.store.value.jobs[id]);return true;
 }
 if(route==='/api/g30/service/run'){
 const job=this.store.value.jobs[data.id];fail(job&&job.contract===this.config.contract&&job.binding===binding,'JOB_SESSION_MISMATCH');fail(job.status!=='ISSUED'||job.expires>=this.now(),'JOB_EXPIRED');fail(!this.locks.has(job.id),'JOB_BUSY');
 fail(typeof data.csv==='string'&&Buffer.byteLength(data.csv)<=200000,'CSV_TOO_LARGE');const policy=data.policy||{};fail(same(Object.keys(policy).sort(),['columns','delimiter','patterns']),'Invalid export policy');fail(Array.isArray(policy.columns)&&policy.columns.length<=60&&typeof policy.patterns==='boolean','Invalid export policy');
 const preview=parse(data.csv,policy.delimiter);fail(policy.columns.every(i=>Number.isInteger(i)&&i>=0&&i<preview[0].length),'INVALID_REDACTION_COLUMN');
 fail(sha(JSON.stringify({csv:data.csv,policy}))===job.digest,'INPUT_OR_POLICY_CHANGED');
 this.locks.add(job.id);try{
 if(job.status==='ISSUED'||job.status==='AWAITING_CONSUMPTION'){
 const op={contract:this.config.contract,account:job.buyer,method:'consume_use',args:{feature:job.feature,action_id:job.action},deposit:'0',hash:data.hash};
 const result=await this.reconcile(op);fail(result.state==='FINALIZED_SUCCESS','CONSUMPTION_NOT_FINAL_SUCCESS');job.consumeHash=data.hash;job.status='CONSUMED';this.store.save();
 }else fail(job.status==='CONSUMED'||job.status==='DELIVERED','JOB_STATE_INVALID');
 // Pausing stops new challenges, not delivery of an already consumed job.
 const release=await this.chain.view('get_opportunity',{feature:job.feature});fail(release.approved_sha256===releaseHash,'SERVICE_ARTIFACT_CHANGED');
 const result=transform(data.csv,policy);job.status='DELIVERED';job.delivered=this.now();this.store.save();send(200,{...result,buyer:job.buyer,consumption:job.consumeHash,idempotent_delivery:true});
 }finally{this.locks.delete(job.id);}return true;
 }
 if(route==='/api/g30/service/intent'){
 const job=this.store.value.jobs[data.id];fail(job&&job.contract===this.config.contract&&job.binding===binding,'JOB_SESSION_MISMATCH');fail(job.status==='AWAITING_CONSUMPTION'||(job.status==='ISSUED'&&job.expires>=this.now()),'JOB_EXPIRED_OR_ALREADY_CONSUMED');job.status='AWAITING_CONSUMPTION';this.store.save();send(200,{id:job.id,status:job.status});return true;
 }
 send(404,{error:'Unknown API'});return true;
 }catch(e){send(400,{error:e.message,state:'UNRESOLVED_OR_REJECTED_NO_AUTOMATIC_RETRY'});return true;}
 }
}
