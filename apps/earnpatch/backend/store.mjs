import fs from 'node:fs';import path from 'node:path';
export class Store {
 constructor(dir){this.dir=dir;fs.mkdirSync(dir,{recursive:true});this.file=path.join(dir,'state.json');this.value=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{jobs:{},auth:{},registry:[],transactions:[]};const lock=path.join(dir,'server.lock');if(fs.existsSync(lock)){const pid=Number(fs.readFileSync(lock,'utf8'));if(!Number.isSafeInteger(pid)||pid<1)throw Error('Invalid storage lock; inspect before removing');let alive=true;try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')alive=false;else throw e;}if(alive)throw Error('Another marketplace process owns this data directory');fs.unlinkSync(lock);}this.fd=fs.openSync(lock,'wx');fs.writeFileSync(this.fd,String(process.pid));fs.fsyncSync(this.fd);}
 save(){const tmp=this.file+'.tmp',fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(this.value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,this.file);}
 close(){if(this.fd===null)return;fs.closeSync(this.fd);this.fd=null;fs.unlinkSync(path.join(this.dir,'server.lock'));}
}
