// Starts its own disposable cluster. Never accepts an existing application database URL.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import net from 'node:net';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {randomBytes} from 'node:crypto';
assert(!process.env.DATABASE_URL&&!process.env.G40_TEST_DATABASE_URL,'DISPOSABLE_CLUSTER_ONLY_UNSET_DATABASE_URL');assert(!process.getuid||process.getuid()!==0,'RUN_POSTGRES_CHECK_AS_NORMAL_USER');
const binary=name=>name+(process.platform==='win32'?'.exe':'');const detect=spawnSync('pg_config',['--bindir'],{encoding:'utf8',windowsHide:true});const bin=process.env.PG_BINDIR||detect.status===0&&detect.stdout.trim();assert(bin&&fs.existsSync(path.join(bin,binary('initdb'))),'PG_BINDIR_REQUIRED_WITH_INITDB_POSTGRES_PG_CTL_CREATEDB');
const env={...process.env,PATH:bin+path.delimiter+process.env.PATH,...(process.env.PG_LIBDIR?{LD_LIBRARY_PATH:process.env.PG_LIBDIR+(process.env.LD_LIBRARY_PATH?':'+process.env.LD_LIBRARY_PATH:'')}:{} )};
const run=(cmd,args,options={})=>spawnSync(cmd,args,{encoding:'utf8',windowsHide:true,env,timeout:30000,maxBuffer:4e6,...options});const pg=(name,args)=>run(path.join(bin,binary(name)),args);
const version=pg('postgres',['--version']);assert.equal(version.status,0,'POSTGRES_EXECUTABLE_UNAVAILABLE');assert(/PostgreSQL\) (1[6-9]|[2-9][0-9])\./.test(version.stdout),'POSTGRES_16_OR_NEWER_REQUIRED');
const work=fs.mkdtempSync(path.join(os.tmpdir(),'ep-pg-check-'));fs.chmodSync(work,0o700);const data=path.join(work,'data'),db='ep_check_'+randomBytes(6).toString('hex'),log=path.join(work,'postgres.log');const evidence=path.resolve('g40/evidence');fs.mkdirSync(evidence,{recursive:true});let started=false,stopped=true;
try{
 const init=pg('initdb',['-D',data,'-U','ep_check','--auth-local=trust','--auth-host=trust','--no-locale','--encoding=UTF8',...(process.env.PG_SHAREDIR?['-L',process.env.PG_SHAREDIR]:[])]);fs.writeFileSync(path.join(evidence,'POSTGRES_INIT.log'),init.stdout+init.stderr);assert.equal(init.status,0,'DISPOSABLE_INITDB_FAILED_SEE_POSTGRES_INIT_LOG');
 const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 const opts='-h 127.0.0.1 -p '+port+' -c shared_buffers=16MB -c max_connections=16 -c jit=off'+(process.platform==='win32'?'':' -c unix_socket_directories=');
 started=true;stopped=false;const start=pg('pg_ctl',['-D',data,'-l',log,'-o',opts,'-w','-t','20','start']);assert.equal(start.status,0,'DISPOSABLE_CLUSTER_START_FAILED');started=true;stopped=false;
 assert.equal(pg('createdb',['-h','127.0.0.1','-p',String(port),'-U','ep_check',db]).status,0,'DISPOSABLE_DATABASE_CREATION_FAILED');
 const testEnv={...env,G40_TEST_DATABASE_URL:'postgres://ep_check@127.0.0.1:'+port+'/'+db,G40_BROWSER:'0'};
 const result=run(process.execPath,['g40/tests/run-production.mjs'],{env:testEnv,timeout:150000});fs.writeFileSync(path.join(evidence,'POSTGRES_TEST.log'),result.stdout+result.stderr);process.stdout.write(result.stdout);assert.equal(result.status,0,'REAL_POSTGRES_INTEGRATION_FAILED_SEE_POSTGRES_TEST_LOG');
 const round=run(process.execPath,['g40/tests/postgres-roundtrip.mjs'],{env:testEnv});fs.writeFileSync(path.join(evidence,'POSTGRES_ROUNDTRIP.log'),round.stdout+round.stderr);process.stdout.write(round.stdout);assert.equal(round.status,0,'POSTGRES_ROUNDTRIP_FAILED');
 const report=JSON.parse(fs.readFileSync(path.join(evidence,'PRODUCTION_POSTGRES.json')));assert.equal(report.database,'REAL_POSTGRESQL');assert.equal(report.postgres_observation.raw_csv_persisted,false);report.postgres_version=version.stdout.trim();report.disposable_cluster=true;report.existing_databases_modified=false;report.jsonb_roundtrip=true;fs.writeFileSync(path.join(evidence,'POSTGRES_VERIFICATION.json'),JSON.stringify(report,null,2));console.log('DISPOSABLE_POSTGRES_VERIFICATION=PASS');
}finally{
 if(started){const stop=pg('pg_ctl',['-D',data,'-m','fast','-w','-t','20','stop']);stopped=stop.status===0||pg('pg_ctl',['-D',data,'status']).status===3;}
 if(fs.existsSync(log))fs.copyFileSync(log,path.join(evidence,'POSTGRES_SERVER.log'));
 if(stopped){assert.equal(path.dirname(work),os.tmpdir());assert(path.basename(work).startsWith('ep-pg-check-')&&!fs.lstatSync(work).isSymbolicLink());fs.rmSync(work,{recursive:true});console.log('DISPOSABLE_POSTGRES_CLEANED=YES');}else{console.error('DISPOSABLE_CLUSTER_STOP_UNCONFIRMED_DATA_RETAINED');process.exitCode=1;}
}
