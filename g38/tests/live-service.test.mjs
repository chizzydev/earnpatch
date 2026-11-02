import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {TokenService} from '../live-service.mjs';
import {FEATURE,RELEASE} from '../../g37/bridge/domain.mjs';
import {PROPOSED} from '../adapter.mjs';

function fixture(){
 const store={value:{},saved:[],save(){this.saved.push(structuredClone(this.value));}},state={buyer:'alex.testnet',credits:'0',final:false,fail:false};
 const chain={async call(method){if(method==='block')return {header:{hash:'final-block'}};throw Error('RPC_TIMEOUT');},async verifyDeployment(){},async view(method){if(method==='config')return {token:PROPOSED.token,decimals:6,marketplace:PROPOSED.source};if(method==='get_sku')return {verified:true,accepted:true,artifact:RELEASE,feature:FEATURE,price:'7000'};if(method==='get_credits')return state.credits;if(method==='get_action')return FEATURE;throw Error('UNEXPECTED_VIEW');},async final(op){assert.equal(store.saved.at(-1).financeLive.jobs[Object.keys(store.value.financeLive.jobs)[0]].operation.hash,op.hash);if(state.fail)throw Error('RPC_TIMEOUT');return {state:state.final?'FINALIZED_SUCCESS':'PENDING',block_hash:'final-use'};}};
 const service=new TokenService({chain,store,identity:async()=>state.buyer,inputDigest:(csv,policy)=>createHash('sha256').update(JSON.stringify({csv,policy})).digest('hex')}),p={scope:'workspace',subject:'alex',request_id:randomUUID(),feature:FEATURE,artifact:RELEASE,csv:'name,email,note\nAda,ada@example.test,=1+1',policy:{columns:[1],delimiter:',',patterns:true}};
 return {service,store,state,p};
}
test('new live service requires its own asset credits, persists original use hash before RPC and recovers output',async()=>{
 const {service,store,state,p}=fixture();await assert.rejects(service.handle('jobs/prepare',p),/NO_TOKEN_PAID_USE/);state.credits='1';const j=await service.handle('jobs/prepare',p),hash='B'.repeat(44);state.fail=true;await assert.rejects(service.handle('jobs/run',{...p,id:j.id,hash}),/RPC_TIMEOUT/);assert.equal(store.value.financeLive.jobs[j.id].operation.hash,hash);await assert.rejects(service.handle('jobs/run',{...p,id:j.id,hash:'C'.repeat(44)}),/ORIGINAL_HASH_REQUIRED/);state.fail=false;await assert.rejects(service.handle('jobs/run',{...p,id:j.id,hash}),/TOKEN_CONSUMPTION_NOT_FINAL/);state.final=true;const out=await service.handle('jobs/run',{...p,id:j.id,hash});assert(!out.output.includes('ada@example.test'));assert(out.output.includes("'=1+1"));state.credits='0';assert.equal((await service.handle('jobs/prepare',p)).id,j.id);assert.equal((await service.handle('jobs/run',{...p,id:j.id})).output,out.output);state.buyer='avery.testnet';await assert.rejects(service.handle('jobs/run',{...p,id:j.id}),/JOB_ACCESS_DENIED/);
});
test('live payment intent is stable, asset-specific and blocks duplicate or switched-account signing after uncertainty',async()=>{
 const {service,store,state,p}=fixture();const pay=await service.handle('purchase/prepare',p);assert.equal(pay.intent.receiver,PROPOSED.token);assert.equal(pay.intent.args.receiver_id,PROPOSED.market);assert.equal(pay.intent.args.amount,'7000');assert.equal(pay.intent.deposit,'1');assert.equal((await service.handle('purchase/prepare',p)).intent.args.msg,pay.intent.args.msg);await assert.rejects(service.handle('purchase/reconcile',{...p,hash:'B'.repeat(44)}),/RPC_TIMEOUT/);assert.equal(Object.values(store.saved.at(-1).financeLive.payments)[0].state,'UNKNOWN');await assert.rejects(service.handle('purchase/prepare',{...p,request_id:randomUUID()}),/UNRESOLVED_TOKEN_PAYMENT/);state.buyer='avery.testnet';await assert.rejects(service.handle('purchase/prepare',p),/PAYMENT_SIGNER_CHANGED/);
});
test('live configuration/code mismatch and missing authenticated identity fail closed',async()=>{
 const {service,p}=fixture();service.chain.verifyDeployment=async()=>{throw Error('V3_CODE_IDENTITY_MISMATCH');};await assert.rejects(service.handle('access',p),/V3_CODE_IDENTITY_MISMATCH/);service.identity=async()=>null;await assert.rejects(service.handle('access',p));
});
