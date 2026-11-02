// Executes the actual compiled WASM offline, with transactional host state.
// This is a deliberately small host simulator, NOT nearcore gas/protocol validation.
// Storage charging model: key bytes + value bytes + 40 bytes per trie record.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const wasmPath = process.argv[2];
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
    current_account_id: r => reg(r, Buffer.from('market.testnet')),
    predecessor_account_id: r => reg(r, Buffer.from(ctx.caller)),
    signer_account_id: r => reg(r, Buffer.from(ctx.caller)),
    signer_account_pk: r => reg(r, Buffer.alloc(33)),
    account_balance: p => put(p, u128bytes(balance)),
    account_locked_balance: p => put(p, u128bytes(0n)),
    attached_deposit: p => put(p, u128bytes(ctx.deposit)),
    storage_usage: usage,
    block_timestamp: () => 1n, block_index: () => 1n, epoch_height: () => 1n,
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
    promise_batch_action_function_call_weight: () => {},
    promise_batch_action_function_call: () => {},
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
        for (const log of logs) { const e = JSON.parse(log.replace(/^EVENT_JSON:/,'')); assert.equal(e.standard, 'earnpatch'); }
        const transfers = [...promises.values()].filter(p => p.amount);
        return {value:returned ? JSON.parse(returned) : undefined, delta:usage()-before, transfers};
    } catch (error) { storage = snapshot; balance = oldBalance; throw error; }
}
async function reject(pattern, method, caller, args, deposit = 0n) {
    const before = [...storage].map(([k,v])=>[k,v.toString('hex')]); const old = balance;
    await assert.rejects(call(method,caller,args,deposit), pattern);
    assert.deepEqual([...storage].map(([k,v])=>[k,v.toString('hex')]),before); assert.equal(balance,old);
}
const owner = 'm'.repeat(56)+'.testnet'; // maximum account length, maximum identifiers
const dev = 'd'.repeat(56)+'.testnet';
const buyer = 'b'.repeat(56)+'.testnet';
const product_id = 'p'.repeat(64);
const feature = {owner, product:product_id, feature:'f'.repeat(64), version:1};
const terms = {requirements_sha256:'a'.repeat(64), price:'11', royalty_bps:2500, cap:'3', deadline_ns:null};
const measurements = {};
await call('new',owner);
await reject(/STORAGE_UNFUNDED/,'create_product',owner,{product_id,name:'App'});
measurements.create = (await call('create_product',owner,{product_id,name:'N'.repeat(128)},FUND)).delta.toString();
await reject(/NOT_OWNER/,'open_opportunity','attacker.testnet',{feature,developer:dev,terms});
const opened = await call('open_opportunity',owner,{feature,developer:dev,terms}); measurements.open = opened.delta.toString();
const expected_terms_hash = opened.value.terms_hash;
measurements.accept = (await call('accept',dev,{feature,expected_terms_hash})).delta.toString();
measurements.submit = (await call('submit',dev,{feature,expected_terms_hash,artifact_sha256:'b'.repeat(64)})).delta.toString();
await reject(/ARTIFACT_MISMATCH/,'approve',owner,{feature,expected_terms_hash,artifact_sha256:'c'.repeat(64)});
measurements.approve = (await call('approve',owner,{feature,expected_terms_hash,artifact_sha256:'b'.repeat(64)})).delta.toString();
const rootBytes = storage.get(Buffer.from('STATE').toString('hex')).length;
await reject(/EXACT_PRICE_REQUIRED/,'purchase',buyer,{feature,order_id:'wrong-price'},10n);
await reject(/NOT_DEVELOPER/,'submit','attacker.testnet',{feature,expected_terms_hash,artifact_sha256:'c'.repeat(64)});
for (let i=0;i<3;i++) {
    const order_id = String(i).padEnd(64,'o');
    const result = await call('purchase',buyer,{feature,order_id},11n);
    assert.equal(result.value.developer_share, ['2','1','0'][i]);
    if (!i) measurements.purchase = result.delta.toString();
}
await reject(/ORDER_REPLAY/,'purchase',buyer,{feature,order_id:'0'.padEnd(64,'o')},11n);
await call('set_paused',owner,{feature,paused:true});
measurements.consume = (await call('consume_use',buyer,{feature,action_id:'r'.repeat(64)})).delta.toString();
await reject(/ACTION_REPLAY/,'consume_use',buyer,{feature,action_id:'r'.repeat(64)});
const beforePayout = await call('accounting',owner);
assert.equal(beforePayout.value.sales,'33'); assert.equal(beforePayout.value.claimable,'33');
const withdrawal = await call('withdraw',dev,{amount:'3'}); assert.equal(withdrawal.transfers[0].amount,3n);
await reject(/PAYOUT_PENDING/,'withdraw',dev,{amount:'1'});
// Failed transfer returns no money out of the account, callback restores once.
await call('on_withdraw_complete','market.testnet',{account_id:dev,nonce:'1'},0n,[false]);
await reject(/UNKNOWN_OR_SETTLED_PAYOUT/,'on_withdraw_complete','market.testnet',{account_id:dev,nonce:'1'});
await call('withdraw',dev,{amount:'3'}); balance -= 3n;
await call('on_withdraw_complete','market.testnet',{account_id:dev,nonce:'2'},0n,[Buffer.alloc(0)]);
const summary = (await call('accounting',owner)).value;
assert.equal(summary.withdrawn,'3'); assert.equal(summary.claimable,'30');
assert.equal(rootBytes,storage.get(Buffer.from('STATE').toString('hex')).length);
const trieGrowth = usage() - BigInt(code.length);
// Bootstrap includes initial STATE allocation; operation deltas are charged after map flush.
assert(BigInt(summary.storage_spent) > 0n);
assert(BigInt(summary.storage_spent) + BigInt(summary.bootstrap_backing) >= usage()*BYTE_COST);
console.log(JSON.stringify({check:'G27_COMPILED_WASM_HOST_SIMULATION',status:'PASS',
    model:'key+value+40 bytes/record; no protocol gas metering',wasm_sha256:createHash('sha256').update(code).digest('hex'),
    wasm_bytes:code.length,root_bytes:rootBytes,operation_bytes:measurements,trie_bytes:trieGrowth.toString(),accounting:summary},null,2));
