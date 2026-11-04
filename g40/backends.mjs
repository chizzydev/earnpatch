// Reuses the accepted finance/CSV engines. Exactly one role is constructed per request.
import fs from 'node:fs';import {fileURLToPath} from 'node:url';import path from 'node:path';
import {FinanceBridge} from '../g38/bridge.mjs';import {FinanceClient} from '../g38/server.mjs';
import {bridgeServer} from '../g37/bridge/server.mjs';import {paperlaneServer} from '../g37/paperlane/server.mjs';
import {evaluationRoute,installEvaluation} from '../g41/evaluation.mjs';
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
   return backend.emit('request',req,res);
  },close(){backend.emit('close');}};
 }
 const bridge=new FinanceBridge({dir:path.join(dir,'bridge'),key:config.key,hostOrigin:config.paperlane}),backend=bridgeServer({bridge,publicOrigin:config.earnpatch,paperlaneOrigin:config.paperlane});
 installEvaluation(bridge);
 return {async handle(req,res){if(new URL(req.url,config.earnpatch).pathname.startsWith('/api/testnet/')){send(res,403,{error:'PUBLIC_FINANCIAL_ACTIONS_DISABLED',automatic_retry:false});return;}if(await evaluationRoute(bridge,req,res,config))return;return backend.emit('request',req,res);},close(){bridge.close();}};
}
