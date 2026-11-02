// Server-side only. Never bundle the integration key into a browser.
import {randomBytes,createHash,createHmac} from 'node:crypto';
const signature=(key,path,time,nonce,body)=>createHmac('sha256',key).update([path,time,nonce,createHash('sha256').update(body).digest('hex')].join('\n')).digest('hex');
export class BridgeClient{
 constructor({url,key,transport=fetch}){this.url=new URL(url);if(!['http:','https:'].includes(this.url.protocol)||this.url.username||this.url.password||this.url.pathname!=='/')throw Error('Bridge URL must be an origin');if(this.url.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(this.url.hostname))throw Error('HTTPS required');if(!key||key.length<32)throw Error('Server integration key required');this.key=key;this.transport=transport;}
 async request(route,data={}){if(!/^\/v1\/[a-z0-9/-]+$/.test(route))throw Error('Invalid Bridge path');const body=JSON.stringify(data),time=String(Date.now()),nonce=randomBytes(24).toString('hex');const r=await this.transport(new URL(route,this.url),{method:'POST',redirect:'error',signal:AbortSignal.timeout(45000),headers:{'content-type':'application/json','x-bridge-time':time,'x-bridge-nonce':nonce,'x-bridge-signature':signature(this.key,route,time,nonce,body)},body});const result=await r.json();if(!r.ok)throw Object.assign(Error(result.error||'Bridge unavailable'),{code:result.error,status:r.status});return result;}
 open(){return this.request('/v1/demo/open');} exchange(code){return this.request('/v1/demo/exchange',{code});}
 capability(scope){return this.request('/v1/capability',{scope});} access(scope,subject){return this.request('/v1/access',{scope,subject});}
 purchase(scope,subject,request_id){return this.request('/v1/demo/purchase',{scope,subject,request_id});}
 prepare(scope,subject,input){return this.request('/v1/jobs/prepare',{scope,subject,...input});}
 run(scope,subject,job,input){return this.request('/v1/jobs/run',{scope,subject,id:job,...input});}
 live(route,data){return this.request('/v1/live/'+route,data);}
}
