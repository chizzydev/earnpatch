import {operationName} from './copy.mjs';
import {display,money} from './model.mjs';
export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const amount=(v,unit='NEAR')=>`${esc(display(v))} <span class="unit">${esc(unit)}</span>`;
export const label=s=>({open:'Awaiting acceptance',accepted:'In development',submitted:'Ready for review',live:'Published',paused:'Sales paused',FINALIZED_SUCCESS:'Finalized',FINALIZED_REJECTED:'Contract rejected',UNRESOLVED:'Needs reconciliation',PENDING:'Confirming',AWAITING_WALLET:'Awaiting wallet',WALLET_REJECTED:'Wallet declined',PRE_SUBMISSION_BLOCKED:'Not submitted'}[s]||String(s).replaceAll('_',' ').toLowerCase());
export function scenario(price,percent,cap,sales=1){
 const p=BigInt(money(price)),c=BigInt(money(cap));
 if(!/^\d+(\.\d{1,2})?$/.test(String(percent)))throw Error('Use a percentage with at most two decimal places');
 const b=BigInt(Math.round(Number(percent)*100));if(p<=0n||c<=0n||b<1n||b>10000n||!Number.isSafeInteger(sales)||sales<0||sales>1000000)throw Error('Use a positive price/cap, 0.01–100% and a whole number of sales');
 const each=p*b/10000n,raw=each*BigInt(sales),developer=raw<c?raw:c,gross=p*BigInt(sales);
 return {gross:String(gross),developer:String(developer),merchant:String(gross-developer),perSale:String(each<c?each:c),remaining:String(c-developer)};
}
export const summary=s=>`<div class="export-stats">${[['Rows processed',s.rows??s.rowsProcessed??0],['Selected cells redacted',s.selectedRedactions??0],['Pattern redactions',s.redactedCells??0],['Formulas neutralized',s.formulaNeutralized??0]].map(([k,v])=>`<div><strong>${esc(v)}</strong><span>${k}</span></div>`).join('')}</div>`;
export const lifecycle=f=>`<ol class="lifecycle" aria-label="Commission progress">${['open','accepted','submitted','live'].map((s,i)=>{const n=['open','accepted','submitted','live'].indexOf(f.status==='paused'?'live':f.status);return `<li class="${i<n?'complete':i===n?'current':''}" ${i===n?'aria-current="step"':''}><span>${i<n?'✓':i+1}</span>${['Commission','Agreement','Delivery','Published'][i]}</li>`;}).join('')}</ol>`;
export function polishLive(container){
 container.classList.add('live-workspace');
 const verify=container.querySelector('#live-session'),auth=container.querySelector('#live-auth');
 if(verify&&!verify.closest('.wallet-tools')){const tools=document.createElement('details');tools.className='wallet-tools';const heading=document.createElement('summary');heading.textContent='Account verification';tools.append(heading);verify.closest('section').append(tools);if(auth)tools.append(auth);tools.append(verify);const diagnostic=container.querySelector('#live-session-details');if(diagnostic)tools.append(diagnostic);}
 for(const b of container.querySelectorAll('[data-live-jump]'))b.onclick=()=>container.querySelector('#'+b.dataset.liveJump)?.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
 for(const n of container.querySelectorAll('[data-live-role]'))n.setAttribute('aria-pressed',String(!n.classList.contains('secondary')));
 for(const [id,title] of [['live-feature','Agreement & delivery'],['live-history','Operation history'],['live-service','SafeShare workspace']]){const node=container.querySelector('#'+id);if(node)node.setAttribute('aria-label',title);}
 for(const n of container.querySelectorAll('#live-history article strong')){if(n.dataset.polished)continue;const [method,state]=n.textContent.split(' · ');n.innerHTML=`<span>${esc(operationName(method))}</span><span class="status status-${esc(state?.toLowerCase())}">${esc(label(state))}</span>`;n.dataset.polished='1';}
}
