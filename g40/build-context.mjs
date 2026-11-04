import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
export function validateContext(root){
 root=path.resolve(root);const dockerfile=fs.readFileSync(path.join(root,'Dockerfile'),'utf8'),copies=[];
 for(const [index,line]of dockerfile.split(/\r?\n/).entries()){
  if(!/^COPY\s/i.test(line))continue;const tokens=line.trim().split(/\s+/);assert.equal(tokens.length,3,'UNREVIEWED_DOCKER_COPY_SYNTAX');const name=tokens[1];
  assert(!path.isAbsolute(name)&&!name.includes('..')&&!name.startsWith('-')&&!name.includes('\\'),'DOCKER_COPY_OUTSIDE_CONTEXT');
  const parent=path.resolve(root,path.dirname(name));assert(parent===root||parent.startsWith(root+path.sep),'DOCKER_COPY_OUTSIDE_CONTEXT');
  let matches;if(name.includes('*')){assert(!path.dirname(name).includes('*'),'UNREVIEWED_DOCKER_GLOB');const [prefix,suffix]=path.basename(name).split('*');assert(prefix!==undefined&&suffix!==undefined&&name.split('*').length===2,'UNREVIEWED_DOCKER_GLOB');matches=fs.existsSync(parent)?fs.readdirSync(parent).filter(n=>n.startsWith(prefix)&&n.endsWith(suffix)).map(n=>path.join(parent,n)):[];}else matches=fs.existsSync(path.join(root,name))?[path.join(root,name)]:[];
  assert(matches.length,'DOCKER_COPY_SOURCE_MISSING: '+name);for(const p of matches)assert(!fs.lstatSync(p).isSymbolicLink(),'DOCKER_CONTEXT_SYMLINK');copies.push({line:index+1,source:name,matches:matches.length});
 }
 assert(copies.length>0,'DOCKER_COPY_LIST_REQUIRED');return {status:'PASS',docker_executed:false,copies};
}
