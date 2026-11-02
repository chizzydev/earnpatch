// Executes the actual compiled WASM offline, with transactional host state.
// This is a deliberately small host simulator, NOT nearcore gas/protocol validation.
// Storage charging model: key bytes + value bytes + 40 bytes per trie record.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const kind=process.argv[2];const wasmPath='g38/artifacts/'+({commitments:'earnpatch_commitments_v1','token-market':'earnpatch_token_market_v1','test-token':'earnpatch_test_usd'}[kind])+'.wasm';const SELF=kind==='test-token'?'test-usd.testnet':'market.testnet';let time=1n;
if (!wasmPath) throw new Error('usage: node G27_WASM_HOST_CHECK.mjs contract.wasm');
const code = readFileSync(wasmPath);
const module = await WebAssembly.compile(code);
const BYTE_COST = 10n ** 19n;
const FUND = 10n ** 24n;
const MAX_BALANCE = 10000n * FUND;
let storage = new Map(), balance = MAX_BALANCE, instance, ctx, registers, returned, logs;
let sequence = 0n, promises;
const bytes = (ptr, len) => Buffer.from(new Uint8Array(instance.exports.memory.buffer, Number(ptr), Number(len)));
const put = (ptr, data) => new Uint8Array(instance.exports.memory.buffer, Number(ptr), data.length).set(data);
const reg = (id, data) => registers.set(id.toString(), Buffer.from(data));
const u128bytes = value => { const b = Buffer.alloc(16); b.writeBigUInt64LE(value & ((1n << 64n)-1n)); b.writeBigUInt64LE(value >> 64n, 8); return b; };
const read128 = ptr => { const b = bytes(ptr, 16); return b.readBigUInt64LE() + (b.readBigUInt64LE(8) << 64n); };
const usage = () => BigInt(code.length) + [...storage].reduce((n, [k,v]) => n + BigInt(k.length/2 + v.length + 40), 0n);
const key = (p,l) => bytes(p,l).toString('hex');
const host = {
    input: r => reg(r, Buffer.from(JSON.stringify(ctx.args))),
    current_account_id: r => reg(r, Buffer.from(SELF)),
    predecessor_account_id: r => reg(r, Buffer.from(ctx.caller)),
    signer_account_id: r => reg(r, Buffer.from(ctx.caller)),
    signer_account_pk: r => reg(r, Buffer.alloc(33)),
    account_balance: p => put(p, u128bytes(balance)),
    account_locked_balance: p => put(p, u128bytes(0n)),
    attached_deposit: p => put(p, u128bytes(ctx.deposit)),
    storage_usage: usage,
    block_timestamp: () => time, block_index: () => 1n, epoch_height: () => 1n,
    prepaid_gas: () => 300000000000000n, used_gas: () => 0n,
    random_seed: r => reg(r, Buffer.alloc(32)),
    register_len: r => registers.has(r.toString()) ? BigInt(registers.get(r.toString()).length) : -1n,
    read_register: (r,p) => put(p, registers.get(r.toString())),
    sha256: (l,p,r) => reg(r, createHash('sha256').update(bytes(p,l)).digest()),
    value_return: (l,p) => { returned = bytes(p,l).toString(); },
    log_utf8: (l,p) => logs.push(bytes(p,l).toString()),
    panic_utf8: (l,p) => { throw new Error(bytes(p,l).toString()); },
    panic: () => { throw new Error('WASM_PANIC'); },
    abort: () => { throw new Error('WASM_ABORT'); },
    storage_read: (l,p,r) => {
        const v = storage.get(key(p,l)); if (!v) return 0n; reg(r,v); return 1n;
    },
    storage_has_key: (l,p) => storage.has(key(p,l)) ? 1n : 0n,
    storage_write: (kl,kp,vl,vp,r) => {
        const k = key(kp,kl), old = storage.get(k); storage.set(k, bytes(vp,vl));
        if (!old) return 0n; reg(r,old); return 1n;
    },
    storage_remove: (l,p,r) => {
        const k = key(p,l), old = storage.get(k); if (!old) return 0n;
        reg(r,old); storage.delete(k); return 1n;
    },
    promise_batch_create: (l,p) => { const id = sequence++; promises.set(id, {to:bytes(p,l).toString()}); return id; },
    promise_batch_then: (_dependency,l,p) => { const id = sequence++; promises.set(id, {to:bytes(p,l).toString()}); return id; },
    promise_batch_action_transfer: (id,p) => { promises.get(id).amount = read128(p); },
    promise_batch_action_function_call_weight: (id,ml,mp,al,ap,dp,gas,weight) => {promises.get(id).call={method:bytes(mp,ml).toString(),args:JSON.parse(bytes(ap,al).toString()),deposit:read128(dp).toString(),gas:gas.toString()};},
    promise_batch_action_function_call: (id,ml,mp,al,ap,dp,gas) => {promises.get(id).call={method:bytes(mp,ml).toString(),args:JSON.parse(bytes(ap,al).toString()),deposit:read128(dp).toString(),gas:gas.toString()};},
    promise_return: () => {},
    promise_results_count: () => BigInt(ctx.results.length),
    promise_result: (i,r) => {
        const result = ctx.results[Number(i)]; if (result === false) return 2n;
        reg(r, result); return 1n;
    },
};
for (const imp of WebAssembly.Module.imports(module)) {
    assert.equal(imp.module, 'env', `unexpected import module ${imp.module}`);
    assert.equal(imp.kind, 'function', `unexpected import kind ${imp.kind}`);
}
const env = new Proxy(host, {get: (o,k) => k in o ? o[k] : () => { throw new Error(`UNIMPLEMENTED_HOST_IMPORT:${String(k)}`); }});

async function call(method, caller, args = {}, deposit = 0n, results = []) {
    const snapshot = new Map(storage), oldBalance = balance;
    ctx = {caller, args, deposit, results}; registers = new Map(); returned = undefined; logs = []; promises = new Map();
    instance = await WebAssembly.instantiate(module, {env}); balance += deposit;
    const before = usage();
    try {
        assert.equal(typeof instance.exports[method], 'function', `missing WASM export ${method}`);
        instance.exports[method]();
        for(const log of logs)if(log.startsWith('EVENT_JSON:'))JSON.parse(log.slice(11));
        const transfers = [...promises.values()].filter(p => p.amount);
        return {value:returned ? JSON.parse(returned) : undefined, delta:usage()-before, transfers,promises:[...promises.values()]};
    } catch (error) { storage = snapshot; balance = oldBalance; throw error; }
}
async function reject(pattern, method, caller, args, deposit = 0n, results = []) {
    const before = [...storage].map(([k,v])=>[k,v.toString('hex')]); const old = balance;
    await assert.rejects(call(method,caller,args,deposit,results), pattern);
    assert.deepEqual([...storage].map(([k,v])=>[k,v.toString('hex')]),before); assert.equal(balance,old);
}
const owner='merchant.testnet',dev='dev.testnet',alice='alice.testnet',bob='bob.testnet',feature={owner,product:'app',feature:'safeshare',version:1};
const proof=Buffer.from(JSON.stringify({id:feature,developer:dev,terms_hash:'a'.repeat(64),accepted_hash:'a'.repeat(64),approved_sha256:'b'.repeat(64),submitted_sha256:'b'.repeat(64),status:'live'}));
let summary;
if(kind==='commitments'){
 await call('new',owner,{marketplace:'source.testnet'});
 const campaign={campaign_id:'build',feature,developer:dev,source_terms_hash:'a'.repeat(64),target:'200',funding_deadline:'10',delivery_deadline:'30'};
 await reject(/STORAGE_UNFUNDED/,'create_campaign',owner,campaign);
 await call('create_campaign',owner,campaign,FUND);const id={merchant:owner,campaign_id:'build'};const solventBalance=balance;balance=0n;await reject(/INSOLVENT/,'commit',alice,id,100n);balance=solventBalance;
 await call('commit',alice,id,100n);await call('commit',bob,id,100n);await reject(/FUNDING_CLOSED/,'commit',alice,id,1n);
 const v=await call('verify_delivery',alice,id);assert(v.promises.some(p=>p.to==='source.testnet'&&p.call?.method==='get_release'));
 assert.equal((await call('on_delivery',SELF,{...id,nonce:'1'},0n,[proof])).value,true);
 await reject(/UNKNOWN_CLAIM/,'release',owner,{...id,expected_artifact_sha256:'b'.repeat(64)});
 const payout=await call('release',alice,{...id,expected_artifact_sha256:'b'.repeat(64)});assert.equal(payout.transfers[0].to,dev);assert.equal(payout.transfers[0].amount,100n);balance-=100n;
 await call('on_payment',SELF,{...id,buyer:alice,nonce:'1'},0n,[Buffer.alloc(0)]);
 time=30n;await call('refund',bob,id);await call('on_payment',SELF,{...id,buyer:bob,nonce:'1'},0n,[false]);
 await call('refund',bob,id);balance-=100n;await call('on_payment',SELF,{...id,buyer:bob,nonce:'2'},0n,[Buffer.alloc(0)]);
 await reject(/STALE_PAYMENT/,'on_payment',SELF,{...id,buyer:bob,nonce:'2'},0n,[Buffer.alloc(0)]);
 summary=(await call('accounting',owner)).value;assert.equal(summary.released,'100');assert.equal(summary.refunded,'100');assert.equal(summary.held,'0');assert(summary.conserved);
}else if(kind==='token-market'){
 await call('new',owner,{marketplace:'source.testnet',token:'test-usd.testnet',decimals:6,symbol:'TestEPUSD'});
 await call('import_release',owner,{feature,developer:dev,source_terms_hash:'a'.repeat(64),artifact_sha256:'b'.repeat(64),price:'7000',bps:2500,cap:'3000'},FUND);
 await call('on_import',SELF,{feature},0n,[proof]);const sku=(await call('get_sku',owner,{feature})).value;
 await reject(/NOT_DEVELOPER/,'accept_token_terms',alice,{feature,expected_terms_hash:sku.terms_hash});
 await call('accept_token_terms',dev,{feature,expected_terms_hash:sku.terms_hash});
 const buy=(order,amount='7000')=>({sender_id:alice,amount,msg:JSON.stringify({feature,order_id:order})});const solventBalance=balance;balance=0n;await reject(/NATIVE_STORAGE_INSOLVENT/,'ft_on_transfer','test-usd.testnet',buy('insolvent'));balance=solventBalance;
 await reject(/TOKEN_NOT_ALLOWED/,'ft_on_transfer','fake.testnet',buy('one'));
 assert.equal((await call('ft_on_transfer','test-usd.testnet',buy('wrong','6999'))).value,'6999');
 for(const [order,r]of [['one','1750'],['two','1250'],['three','0']]){assert.equal((await call('ft_on_transfer','test-usd.testnet',buy(order))).value,'0');assert.equal((await call('get_order',owner,{buyer:alice,order_id:order})).value.developer_share,r);}
 assert.equal((await call('ft_on_transfer','test-usd.testnet',buy('one'))).value,'7000');
 await reject(/NO_PAID_USE/,'consume_use',bob,{feature,action_id:'one'});await call('consume_use',alice,{feature,action_id:'one'});await reject(/ACTION_REPLAY/,'consume_use',alice,{feature,action_id:'one'});
 const w=await call('withdraw_tokens',owner,{amount:'18000'},1n);assert(w.promises.some(p=>p.to==='test-usd.testnet'&&p.call?.method==='ft_transfer'&&p.call.args.amount==='18000'&&p.call.args.receiver_id===owner));
 await call('on_withdraw',SELF,{account_id:owner,nonce:'1'},0n,[false]);await call('withdraw_tokens',owner,{amount:'18000'},1n);await call('on_withdraw',SELF,{account_id:owner,nonce:'2'},0n,[Buffer.from('null')]);
 summary=(await call('accounting',owner)).value;assert.equal(summary.sales,'21000');assert.equal(summary.withdrawn,'18000');assert.equal(summary.claimable,'3000');assert(summary.conserved);
}else if(kind==='test-token'){
 await call('new',alice,{owner_id:alice,total_supply:'1000000'});const m=(await call('ft_metadata',alice)).value;assert.equal(m.decimals,6);assert.equal(m.symbol,'TestEPUSD');
 for(const account_id of [bob,'market.testnet'])await call('storage_deposit',alice,{account_id,registration_only:true},FUND);
 await call('ft_transfer',alice,{receiver_id:bob,amount:'7000',memo:null},1n);assert.equal((await call('ft_balance_of',alice,{account_id:bob})).value,'7000');
 await reject(/balance/,'ft_transfer',alice,{receiver_id:bob,amount:'1000001',memo:null},1n);
 const args={receiver_id:'market.testnet',amount:'7000',memo:null,msg:'rejected-purchase'};const sent=await call('ft_transfer_call',alice,args,1n);assert(sent.promises.some(p=>p.call?.method==='ft_on_transfer'));
 const resolved=await call('ft_resolve_transfer',SELF,{sender_id:alice,receiver_id:'market.testnet',amount:'7000'},0n,[Buffer.from('"7000"')]);assert.equal(resolved.value,'0');assert.equal((await call('ft_balance_of',alice,{account_id:'market.testnet'})).value,'0');
 await call('ft_transfer_call',alice,{...args,msg:'accepted-purchase'},1n);assert.equal((await call('ft_resolve_transfer',SELF,{sender_id:alice,receiver_id:'market.testnet',amount:'7000'},0n,[Buffer.from('"0"')])).value,'7000');
 summary={metadata:m,receiver_balance:(await call('ft_balance_of',alice,{account_id:'market.testnet'})).value,unused_refund_verified:true};assert.equal(summary.receiver_balance,'7000');
}else throw Error('Unknown artifact');
console.log(JSON.stringify({status:'PASS',kind,wasm_sha256:createHash('sha256').update(code).digest('hex'),wasm_bytes:code.length,actual_compiled_wasm_executed:true,protocol_gas_metering:false,model:'transactional offline host, key+value+40 storage; manually injected cross-contract results',summary},null,2));
