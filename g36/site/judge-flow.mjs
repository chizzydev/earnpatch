import {stageCopy} from './copy.mjs';
// Evaluation navigation only. No financial transitions, wallet or network authority.
export function nextJudgeStep(state){
 const f=state.features[0];if(!f)return {role:'merchant',title:'Commission an upgrade',route:'commission'};
 if(f.status==='open')return {role:'developer',title:'Review and accept the commission',route:'agreement/'+f.id};
 if(f.status==='accepted')return {role:'developer',title:'Submit your delivery',route:'agreement/'+f.id};
 if(f.status==='submitted')return {role:'merchant',title:'Review and approve the release',route:'agreement/'+f.id};
 if(f.status==='paused')return {role:'merchant',title:'Resume availability',route:'agreement/'+f.id};
 if((state.credits[f.id]||0)>0)return {role:'customer',title:'Use SafeShare Export',route:'export/'+f.id};
 if(Object.values(state.actions).includes(f.id))return BigInt(state.wallets.developer)>0n?{role:'developer',title:'Inspect royalties & withdraw',route:'developer'}:{role:'developer',title:'See real NEAR proof',route:'proof'};
 return {role:'customer',title:'Purchase access',route:'customer'};
}
export function exampleStage(status){return stageCopy[status]||{label:'Status unavailable',description:'Open the agreement to check its current stage.',next:'Review agreement'};}
