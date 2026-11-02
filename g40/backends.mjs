// Reuses the accepted finance/CSV engines. Exactly one role is constructed per request.
import fs from 'node:fs';import {fileURLToPath} from 'node:url';import path from 'node:path';
import {FinanceBridge} from '../g38/bridge.mjs';import {FinanceClient} from '../g38/server.mjs';
import {bridgeServer} from '../g37/bridge/server.mjs';import {paperlaneServer} from '../g37/paperlane/server.mjs';
import {read,send,origin,cookie,setCookie} from '../g37/http.mjs';import {token,requireThat as need} from '../g37/bridge/domain.mjs';
export function privateTransport(publicOrigin,internalOrigin,transport=fetch){return async(url,options)=>{
 const u=new URL(url);need(u.origin===publicOrigin&&u.pathname.startsWith('/v1/')&&!u.search,'FIXED_BRIDGE_TARGET_REQUIRED');
 return transport(new URL(u.pathname,internalOrigin),{...options,redirect:'error',signal:AbortSignal.timeout(12000)});
};}
export function createBackend(config,dir,{transport}={}){
 if(config.role==='paperlane'){
  const client=new FinanceClient({url:config.earnpatch,key:config.key,transport:privateTransport(config.earnpatch,config.internalBridge,transport)}),backend=paperlaneServer({client,dir:path.join(dir,'paperlane'),publicOrigin:config.paperlane,bridgeOrigin:config.earnpatch});
  return {handle(req,res){const p=new URL(req.url,config.paperlane).pathname;
   if(req.method==='GET'&&p==='/'){const html=fs.readFileSync(new URL('../g37/paperlane/public/index.html',import.meta.url),'utf8').replace('Simulated payments. Genuine','Evaluation sessions expire after 24 hours. Simulated TestEPUSD payments (6 decimals). Not USDC/USDT. Genuine').replace('Installed upgrade / SafeShare Export','Token checkout upgrade / SafeShare Export');return send(res,200,html,'text/html');}
   if(req.method==='GET'&&p==='/app.mjs'){const js=fs.readFileSync(new URL('../g37/paperlane/public/app.mjs',import.meta.url),'utf8').replaceAll('10n**24n','10n**6n').replaceAll("padStart(24,'0')","padStart(6,'0')").replaceAll(' NEAR',' TestEPUSD').replaceAll('merchant must approve the SafeShare release first.','merchant must import the release and the developer must accept token terms first.');return send(res,200,js,'text/javascript');}
   return backend.emit('request',req,res);
  },close(){backend.emit('close');}};
 }
 const bridge=new FinanceBridge({dir:path.join(dir,'bridge'),key:config.key,hostOrigin:config.paperlane}),backend=bridgeServer({bridge,publicOrigin:config.earnpatch,paperlaneOrigin:config.paperlane});
 return {async handle(req,res){try{
  const p=new URL(req.url,config.earnpatch).pathname;
  if(!p.startsWith('/finance/api/'))return backend.emit('request',req,res);
  need(req.method==='POST','POST_REQUIRED');origin(req,config.earnpatch);const {data}=await read(req,10000);let sid=cookie(req,'g37_studio'),scope=bridge.db.studioSessions?.[sid];
  if(!scope){sid=token();scope=bridge.open().scope;bridge.db.studioSessions??={};bridge.db.studioSessions[sid]=scope;bridge.save();setCookie(res,'g37_studio',sid,config.earnpatch.startsWith('https:'));}
  const route=p.slice(13);if(route==='state')return send(res,200,{finance:bridge.finance(scope),source:bridge.state(scope)});
  if(route==='handoff')return send(res,200,{url:config.paperlane+'/connect?code='+bridge.handoff(scope)});
  if(route==='reset'){bridge.fin.states[scope]=undefined;bridge.finance(scope);bridge.save();return send(res,200,{finance:bridge.finance(scope)});}
  if(route==='action'){
   need(['merchant','developer','alex','avery'].includes(data.actor),'SAMPLE_ACTOR_REQUIRED');need(['create','commit','verify','release','refund','cancel','advance','import_token','accept_token','token_withdraw'].includes(data.action),'ACTION_NOT_AVAILABLE');
   let state=bridge.change(scope,data.action==='advance'?'demo-clock':data.actor,data.action,data.args||{});
   if(['release','refund'].includes(data.action))state=bridge.change(scope,'contract','payment_callback',{buyer:data.actor,nonce:state.claims[data.actor].nonce,outcome:data.simulate_failure?'failed':'success'});
   if(data.action==='token_withdraw')state=bridge.change(scope,'contract','token_callback',{payee:data.actor,nonce:state.ledgers[data.actor].nonce,outcome:data.simulate_failure?'failed':'success'});
   return send(res,200,{finance:state});
  }throw Error('UNKNOWN_ROUTE');
 }catch(e){send(res,400,{error:e.code||e.message,mode:'EVALUATION_ONLY_NO_BLOCKCHAIN_MUTATIONS'});}},close(){bridge.close();}};
}
