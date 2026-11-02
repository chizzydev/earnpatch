import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
// Derive the archive from the build manifest so a newly added source tree cannot be omitted.
export function packagePostgres(root,archive){
 const build=path.join(root,'g40/build'),evidence=path.join(root,'g40/evidence'),manifest=JSON.parse(fs.readFileSync(path.join(build,'BUILD_MANIFEST.json'))),sha=b=>createHash('sha256').update(b).digest('hex');
 fs.mkdirSync(evidence,{recursive:true});
 const check=fs.mkdtempSync(path.join(evidence,'package-check-')),list=path.join(check,'files.txt');
 const run=args=>{const p=spawnSync('tar',args,{encoding:'utf8',windowsHide:true});assert.equal(p.status,0,p.stderr);};
 try{
  for(const [name,hash]of Object.entries(manifest.files)){assert(!path.isAbsolute(name)&&!name.split('/').includes('..')&&!name.startsWith('-'));assert.equal(sha(fs.readFileSync(path.join(build,name))),hash,'BUILD_CHANGED: '+name);}
  fs.writeFileSync(list,Object.keys(manifest.files).concat('BUILD_MANIFEST.json').join('\n')+'\n');
  const names=Object.keys(manifest.files);assert(names.join(' ').length<20000,'ARCHIVE_ARGUMENT_LIMIT');
  const dependencies=fs.existsSync(path.join(root,'g40/node_modules/pg/package.json'))?'g40/node_modules':'node_modules';
  run(['-czf',archive,'-C',build,...names,'BUILD_MANIFEST.json','-C',root,'g40/tests',dependencies]);
  run(['-xzf',archive,'-C',check]);
  for(const [name,hash]of Object.entries(manifest.files))assert.equal(sha(fs.readFileSync(path.join(check,name))),hash,'ARCHIVE_FILE_MISSING_OR_CHANGED: '+name);
  for(const name of ['g40/tests/local-postgres.py','g40/tests/run-production.mjs','g40/tests/production.mjs',dependencies+'/pg/package.json'])assert(fs.statSync(path.join(check,name)).isFile(),name);
  return {status:'PASS',manifest_files:Object.keys(manifest.files).length,all_extracted_hashes_verified:true};
 }finally{assert.equal(path.dirname(path.resolve(check)),path.resolve(evidence));assert(path.basename(check).startsWith('package-check-')&&!fs.lstatSync(check).isSymbolicLink());fs.rmSync(check,{recursive:true});}
}
