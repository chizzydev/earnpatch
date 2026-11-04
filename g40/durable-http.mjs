import {randomBytes} from 'node:crypto';import http from 'node:http';import {Readable} from 'node:stream';import {EventEmitter} from 'node:events';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {restore,snapshot} from '../g39/persistence.mjs';import {createBackend} from './backends.mjs';
import {expireEvaluation} from './retention.mjs';
export const SECURITY={'cache-control':'no-store','strict-transport-security':'max-age=31536000','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer','permissions-policy':'camera=(), microphone=(), geolocation=()','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://storage.herewallet.app; connect-src 'self' https://rpc.testnet.fastnear.com https://archival-rpc.testnet.fastnear.com; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"};
class Capture extends EventEmitter{
 constructor(resolve,reject){super();this.statusCode=200;this.headers={};this.parts=[];this.size=0;this.resolve=resolve;this.reject=reject;}
 setHeader(k,v){this.headers[k.toLowerCase()]=v;}getHeader(k){return this.headers[k.toLowerCase()];}
 writeHead(status,headers={}){this.statusCode=status;for(const[k,v]of Object.entries(headers))this.setHeader(k,v);return this;}
 write(chunk){const b=Buffer.from(chunk);this.size+=b.length;if(this.size>2000000)throw Error('RESPONSE_LIMIT');this.parts.push(b);return true;}
 end(chunk){if(this.writableEnded)return;if(chunk!==undefined)this.write(chunk);this.writableEnded=true;this.resolve({status:this.statusCode,headers:this.headers,body:Buffer.concat(this.parts)});}
 destroy(error){this.reject(error||Error('BACKEND_ABORTED'));}
}
export function durableServer({config,db,staticResponse=()=>null,backend=createBackend,transport}){
 const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'earnpatch-g40-'));let tail=Promise.resolve(),queued=0,closing=false,poisoned=false;const buckets=new Map();
 const respond=(res,status,value,headers={})=>{if(res.destroyed)return;const html=(headers['content-type']||'').startsWith('text/html'),nonce=randomBytes(18).toString('base64'),security={...SECURITY};if(html){security['content-security-policy']=security['content-security-policy'].replace("script-src 'self'", "script-src 'self' 'nonce-"+nonce+"'");value=Buffer.from((Buffer.isBuffer(value)?value.toString():String(value)).replace('</head>','<meta name="wallet-csp-nonce" content="'+nonce+'"></head>'));}res.writeHead(status,{...headers,...security,'content-type':headers['content-type']||'application/json; charset=utf-8'});res.end(Buffer.isBuffer(value)?value:JSON.stringify(value));};
 const server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://local');if(!req.url.startsWith('/')||req.url.startsWith('//')||req.url.includes('\\'))return respond(res,400,{error:'INVALID_TARGET'});
  const publicHost=new URL(config.publicOrigin).host,privateHost=config.role==='bridge'?new URL(config.internalBridge).host:'paperlane.railway.internal:8080',health=['/health','/readyz','/livez'].includes(url.pathname)&&!url.search&&req.method==='GET';
  if(![publicHost,privateHost,...(health?['healthcheck.railway.app']:[])].includes(req.headers.host))return respond(res,403,{error:'HOST_NOT_ALLOWED'});
  if(req.headers.host===privateHost&&!url.pathname.startsWith('/v1/')&&!health)return respond(res,403,{error:'PRIVATE_API_ONLY'});
  if(health){const ready=!closing&&!poisoned&&(url.pathname==='/livez'||await db.health());return respond(res,ready?200:503,{ready,service:config.service,mode:'EVALUATION_WITH_READ_ONLY_TESTNET_PROOF',blockchain_mutations:false});}
  if(closing)return respond(res,503,{error:'DRAINING'});
  const minute=Math.floor(Date.now()/60000),key=req.socket.remoteAddress+':'+minute;for(const k of buckets.keys())if(!k.endsWith(':'+minute))buckets.delete(k);buckets.set(key,(buckets.get(key)||0)+1);if(buckets.get(key)>300)return respond(res,429,{error:'RATE_LIMIT'});
  const staticValue=await staticResponse(req,url);if(staticValue)return respond(res,staticValue.status||200,staticValue.body,staticValue.headers);
  if(poisoned||db.blocked)return respond(res,503,{error:'PERSISTENCE_UNAVAILABLE_RESTART_REQUIRED',automatic_retry:false});
  if(queued>=16)return respond(res,503,{error:'BUSY',automatic_retry:false});queued++;const chunks=[];let size=0;
  try{for await(const chunk of req){size+=chunk.length;if(size>230000)throw Error('BODY_TOO_LARGE');chunks.push(chunk);}}catch{queued--;return respond(res,413,{error:'BODY_TOO_LARGE_OR_INCOMPLETE'});}
  const execute=async()=>{try{
   const result=await db.transaction(async state=>{
    const stateFile=path.join(runtime,config.role,'state.json');if(state[config.role+'/state.json'])expireEvaluation(state[config.role+'/state.json'],config.role);if(!state[config.role+'/state.json']&&fs.existsSync(stateFile))fs.unlinkSync(stateFile);restore(runtime,state);let handler,timer;try{
     handler=backend(config,runtime,{transport});
     const captured=await new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('BACKEND_TIMEOUT')),45000);const input=Readable.from(chunks);Object.assign(input,{method:req.method,url:req.url,headers:{...req.headers},socket:req.socket});const output=new Capture(resolve,reject);Promise.resolve(handler.handle(input,output)).catch(reject);});
     return {state:snapshot(runtime,config.role),value:captured};
    }finally{clearTimeout(timer);handler?.close();}
   });respond(res,result.status,result.body,result.headers);
  }catch(e){poisoned=!!db.blocked||e.message!=='DATABASE_BUSY';respond(res,503,{error:e.message==='DATABASE_BUSY'?'DATABASE_BUSY':'PERSISTENCE_UNCERTAIN_NO_AUTOMATIC_RETRY',automatic_retry:false});if(poisoned)server.emit('persistence-fault');}finally{queued--;}};
  tail=tail.then(execute,execute);
 }catch{respond(res,400,{error:'REQUEST_REJECTED',automatic_retry:false});}});
 server.headersTimeout=15000;server.requestTimeout=30000;server.maxConnections=48;
 return {server,runtime,health:()=>db.health(),async close(){closing=true;const stopped=new Promise(r=>server.close(r));server.closeIdleConnections();await tail;await stopped;await db.close();for(const name of ['bridge','paperlane']){const d=path.join(runtime,name);if(fs.existsSync(d)){for(const f of fs.readdirSync(d))fs.unlinkSync(path.join(d,f));fs.rmdirSync(d);}}fs.rmdirSync(runtime);}};
}
