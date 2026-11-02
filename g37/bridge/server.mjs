import http from 'node:http';import {fileURLToPath} from 'node:url';import {Bridge} from './service.mjs';import {token} from './domain.mjs';import {read,send,staticFile,origin,cookie,setCookie} from '../http.mjs';
const studio=fileURLToPath(new URL('../studio/',import.meta.url)),pub=fileURLToPath(new URL('../../apps/earnpatch/public/',import.meta.url)),marketplace=fileURLToPath(new URL('../../g36/site/',import.meta.url));
export function bridgeServer({bridge,publicOrigin,paperlaneOrigin}){bridge.db.studioSessions??={};const sessions=bridge.db.studioSessions,rates=new Map();return http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost'),p=url.pathname;
 const minute=Math.floor(Date.now()/60000),rk=req.socket.remoteAddress+':'+minute;rates.set(rk,(rates.get(rk)||0)+1);for(const k of rates.keys())if(!k.endsWith(':'+minute))rates.delete(k);if(rates.get(rk)>300)throw Error('RATE_LIMIT');
 if(p.startsWith('/v1/')){if(req.method!=='POST')return send(res,405,{error:'POST_REQUIRED'});const {raw,data}=await read(req);bridge.authenticate(p,req.headers,raw);return send(res,200,await bridge.call(p,data));}
 if(p.startsWith('/studio/api/')){if(req.method!=='POST')return send(res,405,{error:'POST_REQUIRED'});origin(req,publicOrigin);const {data}=await read(req,10000);let sid=cookie(req,'g37_studio'),scope=sessions[sid];if(!scope){sid=token();scope=bridge.open().scope;sessions[sid]=scope;bridge.save();setCookie(res,'g37_studio',sid,publicOrigin.startsWith('https:'));}const action=p.slice(12);if(action==='state')return send(res,200,{state:bridge.state(scope),paperlane:paperlaneOrigin});if(action==='step')return send(res,200,{state:bridge.step(scope,data.action,data.payload)});if(action==='handoff')return send(res,200,{url:paperlaneOrigin+'/connect?code='+bridge.handoff(scope)});if(action==='withdraw')return send(res,200,{state:bridge.withdraw(scope,data.actor)});if(action==='reset'){scope=bridge.open().scope;sessions[sid]=scope;bridge.save();return send(res,200,{state:bridge.state(scope)});}throw Error('UNKNOWN_ROUTE');}
 if(p==='/health')return send(res,200,{ok:true,service:'EarnPatch Bridge',live_mutations:false});
 if(p==='/live/capability'&&req.method==='GET')return send(res,200,await bridge.liveCapability());
 if(req.method!=='GET'&&req.method!=='HEAD')return send(res,405,{error:'METHOD_NOT_ALLOWED'});
 if(p==='/marketplace'){res.writeHead(303,{location:'/marketplace/'});return res.end();}
 if(p.startsWith('/marketplace/'))return staticFile(res,marketplace,p==='/marketplace/'?'index.html':decodeURIComponent(p.slice(13)));
 if(p==='/studio'||p==='/')return staticFile(res,studio,'index.html');
 if(p==='/proof')return staticFile(res,pub,'g35-proof.json');
 if(p.startsWith('/assets/')){const name=p.slice(8);if(!['design.css','commercial.css','style.css','g35-proof.json','proof.json','icon.svg','evidence/safeshare-g35.csv'].includes(name))return send(res,404,{error:'NOT_FOUND'});return staticFile(res,pub,name);}
 if(['/app.mjs','/bridge.css'].includes(p))return staticFile(res,studio,p.slice(1));return send(res,404,{error:'NOT_FOUND'});
 }catch(e){send(res,400,{error:e.code||e.message,financial_result:'NO_AUTOMATIC_RETRY'});}});}
