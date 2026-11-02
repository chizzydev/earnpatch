import fs from 'node:fs';import {Chain} from '../apps/earnpatch/backend/chain.mjs';
const contract='g28-rc6f2ff75-0.nearprep-058b1b4f8cf8.testnet';
export function proofReader({chain=new Chain(contract),now=()=>Date.now()}={}){let cached,inflight;return async()=>{
 if(cached&&now()-cached.at<60000)return cached.value;
 if(inflight)return inflight;
 inflight=(async()=>{const h=(await chain.call('block',{finality:'final'})).header;await chain.verifyDeployment(h.hash);const accounting=await chain.view('accounting',{},h.hash);const value={network:'testnet',contract,height:h.height,block_hash:h.hash,observed_at:new Date(now()).toISOString(),accounting,mutation_mode:false};cached={at:now(),value};return value;})();
 try{return await inflight;}finally{inflight=null;}
};}
export function recordedProof(){return JSON.parse(fs.readFileSync(new URL('./public/testnet-proof.json',import.meta.url)));}
