// Pure presentation helpers; atomic values are never rounded before financial construction.
export function exact(n,d=24){const v=BigInt(n||'0'),base=10n**BigInt(d);return String(v/base)+'.'+((v%base).toString().padStart(d,'0').replace(/0+$/,'')||'0');}
export function balance(n,d=24,places=4){const v=BigInt(n||'0'),scale=10n**BigInt(Math.max(0,d-places)),rounded=(v+scale/2n)/scale,base=10n**BigInt(Math.min(d,places));return String(rounded/base)+'.'+(rounded%base).toString().padStart(Math.min(d,places),'0');}
export function authenticated(session,account,now=Date.now()){return !!(account&&session?.identity?.account===account&&session.identity.expires>now);}
export function operationView(op){return {...op.intent,state:op.state,hash:op.intent.hash||null};}
export function walletState(session,account,pending,now=Date.now()){return pending||(!account?'disconnected':authenticated(session,account,now)?'authenticated':'connected');}