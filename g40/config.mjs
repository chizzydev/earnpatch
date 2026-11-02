import assert from 'node:assert/strict';
export function httpsOrigin(value){const u=new URL(value);assert(u.protocol==='https:'&&u.origin===value&&!u.username&&!u.password,'EXACT_PUBLIC_HTTPS_ORIGIN_REQUIRED');return value;}
export function privateOrigin(value){const u=new URL(value);assert(u.protocol==='http:'&&u.hostname==='earnpatch.railway.internal'&&u.port==='8080'&&u.origin===value&&!u.username&&!u.password,'EXACT_RAILWAY_BRIDGE_ORIGIN_REQUIRED');return value;}
export function config(env=process.env){
 assert(['earnpatch','paperlane'].includes(env.G40_SERVICE),'G40_SERVICE_REQUIRED');
 const earnpatch=httpsOrigin(env.G40_EARNPATCH_ORIGIN),paperlane=httpsOrigin(env.G40_PAPERLANE_ORIGIN);assert.notEqual(earnpatch,paperlane,'INDEPENDENT_PAPERLANE_ORIGIN_REQUIRED');
 assert(/^[a-f0-9]{64}$/.test(env.G40_INTEGRATION_KEY||'')&&new Set(env.G40_INTEGRATION_KEY).size>=8,'RANDOM_SERVER_INTEGRATION_KEY_REQUIRED');
 const port=Number(env.PORT||8080);assert(Number.isInteger(port)&&port>0&&port<=65535,'PORT_REQUIRED');
 assert(!['G30_ENABLE_WRITES','G33_ALLOW_OWNER_WALLET_ACTIONS','G39_ALLOW_OWNER_WALLET_ACTIONS'].some(k=>env[k]&&env[k]!=='0'),'PUBLIC_FINANCIAL_SIGNING_FORBIDDEN');
 return {role:env.G40_SERVICE==='earnpatch'?'bridge':'paperlane',service:env.G40_SERVICE,earnpatch,paperlane,publicOrigin:env.G40_SERVICE==='earnpatch'?earnpatch:paperlane,internalBridge:privateOrigin(env.G40_BRIDGE_INTERNAL_ORIGIN||'http://earnpatch.railway.internal:8080'),key:env.G40_INTEGRATION_KEY,port,host:'::',databaseUrl:env.DATABASE_URL,databaseMode:env.G40_DATABASE_TRANSPORT||'railway-private',databaseCA:env.G40_DATABASE_CA,railwayEnvironment:env.RAILWAY_ENVIRONMENT_ID};
}
export function databaseConfig(url,{mode='railway-private',ca,railwayEnvironment,localTest=false}={}){
 const u=new URL(url);assert(['postgres:','postgresql:'].includes(u.protocol)&&u.hostname&&u.pathname.length>1,'POSTGRES_URL_REQUIRED');if(!localTest)assert(u.username&&u.password,'POSTGRES_PASSWORD_REQUIRED');
 for(const k of u.searchParams.keys())assert(k==='sslmode','UNSUPPORTED_POSTGRES_URL_OPTION');
 const local=['127.0.0.1','localhost','[::1]'].includes(u.hostname);
 if(localTest){assert(local,'LOCAL_DATABASE_ONLY');assert.equal(mode,'local-test');}
 else{assert.equal(u.hostname,'postgres.railway.internal','RAILWAY_PRIVATE_POSTGRES_REQUIRED');assert(railwayEnvironment,'RAILWAY_ENVIRONMENT_REQUIRED');assert(['railway-private','verify-tls'].includes(mode),'DATABASE_TRANSPORT_REQUIRED');}
 const sslmode=u.searchParams.get('sslmode');if(mode==='verify-tls')assert(!sslmode||['verify-full','verify-ca','require'].includes(sslmode),'VERIFIED_TLS_REQUIRED');else assert(!sslmode||sslmode==='disable','CONFLICTING_DATABASE_TRANSPORT');u.searchParams.delete('sslmode');
 return {connectionString:u.toString(),max:2,connectionTimeoutMillis:8000,idleTimeoutMillis:10000,statement_timeout:15000,query_timeout:17000,ssl:mode==='verify-tls'?{rejectUnauthorized:true,...(ca?{ca}:{})}:false};
}
