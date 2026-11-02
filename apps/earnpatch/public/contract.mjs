export const FROZEN='g28-rc6f2ff75-0.nearprep-058b1b4f8cf8.testnet';
export const METHODS=['create_product','fund_storage','update_product','open_opportunity','accept','submit','approve','set_paused','close','purchase','consume_use','withdraw'];
export function basisPoints(s){if(!/^\d{1,3}(\.\d{1,2})?$/.test(s))throw Error('Percentage needs at most two decimal places');const [a,b='']=s.split('.'),n=Number(BigInt(a)*100n+BigInt(b.padEnd(2,'0')));if(n>10000)throw Error('Percentage exceeds 100');return n;}
export function account(s){if(typeof s!=='string'||!(/^[a-z0-9][a-z0-9_-]*(\.[a-z0-9_-]+)*\.testnet$/.test(s)||/^[a-f0-9]{64}$/.test(s))||s.length>64)throw Error('A testnet account is required');return s;}
export function feature(f){if(!f||Object.keys(f).sort().join()!=='feature,owner,product,version')throw Error('Invalid feature identity');account(f.owner);for(const x of [f.product,f.feature])if(!/^[A-Za-z0-9_-]{1,64}$/.test(x))throw Error('Invalid feature slug');if(!Number.isInteger(f.version)||f.version<1||f.version>4294967295)throw Error('Invalid version');return f;}
export const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
function canonical(v){return v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):Array.isArray(v)?v.map(canonical):v;}
export function operation(contract,buyer,method,args,deposit='0'){
 account(contract);account(buyer);if(contract===FROZEN)throw Error('G28 is read-only. Configure a separate G30 acceptance deployment.');if(!METHODS.includes(method))throw Error('Unsupported contract action');
 if(!/^\d+$/.test(deposit))throw Error('Invalid deposit');if(args.feature)feature(args.feature);
 const keys={create_product:['name','product_id'],fund_storage:['product_id'],update_product:['name','product_id'],open_opportunity:['developer','feature','terms'],accept:['expected_terms_hash','feature'],submit:['artifact_sha256','expected_terms_hash','feature'],approve:['artifact_sha256','expected_terms_hash','feature'],set_paused:['feature','paused'],close:['feature'],purchase:['feature','order_id'],consume_use:['action_id','feature'],withdraw:['amount']};
 if(!same(Object.keys(args).sort(),keys[method].sort()))throw Error('Unexpected contract arguments');
 for(const key of ['product_id','order_id','action_id'])if(key in args&&!/^[A-Za-z0-9_-]{1,64}$/.test(args[key]))throw Error('Invalid operation ID');
 if('name' in args&&(!args.name||new TextEncoder().encode(args.name).length>128||/[\x00-\x1f\x7f]/.test(args.name)))throw Error('Product name must be 1–128 UTF-8 bytes with no control characters');
 for(const key of ['expected_terms_hash','artifact_sha256'])if(key in args&&!/^[a-f0-9]{64}$/.test(args[key]))throw Error('Invalid SHA-256 digest');
 if(method==='withdraw'&&(!/^\d+$/.test(args.amount)||BigInt(args.amount)<=0n||BigInt(args.amount)>=(1n<<128n)))throw Error('Invalid withdrawal amount');
 if(method==='set_paused'&&typeof args.paused!=='boolean')throw Error('Pause value must be boolean');
 if(method==='open_opportunity'){account(args.developer);const t=args.terms;if(!t||!same(Object.keys(t).sort(),['cap','deadline_ns','price','requirements_sha256','royalty_bps'])||!/^\d+$/.test(t.price)||BigInt(t.price)<=0n||BigInt(t.price)>=(1n<<128n)||!/^\d+$/.test(t.cap)||BigInt(t.cap)>=(1n<<128n)||!Number.isInteger(t.royalty_bps)||t.royalty_bps<0||t.royalty_bps>10000||!/^[a-f0-9]{64}$/.test(t.requirements_sha256))throw Error('Invalid immutable commercial terms');}
 if(['open_opportunity','approve','set_paused','close'].includes(method)&&args.feature.owner!==buyer)throw Error('Merchant ownership required');
 if(!['create_product','fund_storage','purchase'].includes(method)&&deposit!=='0')throw Error('Non-payable method');
 return {id:crypto.randomUUID(),contract,account:buyer,method,args,deposit,gas:method==='withdraw'?'60000000000000':'65000000000000',state:'PREPARING',created:new Date().toISOString(),hash:null};
}
export const terminal=s=>['FINALIZED_SUCCESS','FINALIZED_REJECTED','WALLET_REJECTED','PRE_SUBMISSION_BLOCKED'].includes(s);
