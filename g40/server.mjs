import {fileURLToPath} from 'node:url';
import {config as configuration} from './config.mjs';import {Database} from './database.mjs';import {durableServer} from './durable-http.mjs';import {staticRoutes} from './static.mjs';
export async function start({config=configuration(),db,port=config.port,host=config.host,transport,live}={}){
 db??=await Database.open(config.databaseUrl,config.role,{mode:config.databaseMode,ca:config.databaseCA,railwayEnvironment:config.railwayEnvironment});
 const app=durableServer({config,db,transport,staticResponse:staticRoutes(config,{live})});try{await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen({port,host,ipv6Only:false},resolve);});return app;}catch(e){await app.close();throw e;}
}
if(process.argv[1]===fileURLToPath(import.meta.url))start().then(app=>{
 console.log('G40 Railway service ready; evaluation finances simulated; Testnet proof read-only');let stopping=false;
 const stop=async code=>{if(stopping)return;stopping=true;const deadline=setTimeout(()=>process.exit(1),25000);deadline.unref();try{await app.close();process.exit(code);}catch{process.exit(1);}};
 for(const s of ['SIGTERM','SIGINT'])process.once(s,()=>stop(0));app.server.on('persistence-fault',()=>stop(1));
 const monitor=setInterval(async()=>{if(!stopping&&!await app.health())stop(1);},30000);monitor.unref();
}).catch(()=>{console.error('G40_START_FAILED: inspect Railway configuration/database availability; secrets omitted');process.exitCode=1;});
