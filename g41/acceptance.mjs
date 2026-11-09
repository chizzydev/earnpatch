// Review-only execution of the pinned SafeShare implementation. No uploaded code runs here.
import {parse,transform} from '../apps/earnpatch/public/csv.mjs';
import {RELEASE,checkRelease,sha,token,requireThat as need} from '../g37/bridge/domain.mjs';
export const REVIEW_LIMITS=Object.freeze({bytes:20000,rows:100,runs:20,minutes:30});
const prefix='/studio/api/review/';
export function acceptanceReview(bridge,session,path,p){
 need(session?.persona==='merchant','MERCHANT_REVIEW_REQUIRED');
 bridge.workspace(session.scope);
 const feature=session.product.features.find(f=>f.id===session.integration);
 need(feature?.status==='submitted'&&feature.terms,'SUBMITTED_RELEASE_REQUIRED');
 need(feature.artifact===RELEASE&&p?.artifact===RELEASE,'REVIEW_ARTIFACT_MISMATCH');
 checkRelease();
 const route=path.slice(prefix.length),fields={open:['artifact'],inspect:['artifact','review_id','csv','delimiter'],run:['artifact','review_id','csv','policy']}[route];
 need(fields&&p&&typeof p==='object'&&!Array.isArray(p)&&Object.keys(p).length===fields.length&&fields.every(k=>Object.hasOwn(p,k)),'UNSUPPORTED_REVIEW_FIELD');
 const binding=sha(JSON.stringify([session.scope,session.integration,feature.artifact,feature.terms]));
 let review=session.acceptance_review;
 if(route==='open'){
  const same=review?.binding===binding;
  if(!same||review.expires<=Date.now()){
   review={id:token(),binding,artifact:RELEASE,feature:feature.id,runs:same?review.runs:0,expires:Date.now()+REVIEW_LIMITS.minutes*60000};
   session.acceptance_review=review;bridge.save();
  }
  return {mode:'MERCHANT_PRE_APPROVAL_REVIEW',review_id:review.id,artifact:RELEASE,feature_id:feature.id,limits:REVIEW_LIMITS,remaining:REVIEW_LIMITS.runs-review.runs,published:false};
 }
 need(review?.binding===binding&&review.id===p.review_id&&review.expires>Date.now(),'REVIEW_CONTEXT_EXPIRED_OR_CHANGED');
 need(typeof p.csv==='string'&&Buffer.byteLength(p.csv)<=REVIEW_LIMITS.bytes,'REVIEW_CSV_LIMIT_20KB');
 const rows=parse(p.csv,route==='inspect'?p.delimiter:p.policy?.delimiter);
 need(rows.length-1<=REVIEW_LIMITS.rows,'REVIEW_ROW_LIMIT_100');
 if(route==='inspect')return {mode:'MERCHANT_PRE_APPROVAL_REVIEW',artifact:RELEASE,columns:rows[0],rows:rows.slice(1),row_count:rows.length-1,formula_candidates:rows.flat().filter(v=>/^[\s\uFEFF]*[=+@-]/.test(v)).length};
 need(review.runs<REVIEW_LIMITS.runs,'REVIEW_RUN_LIMIT_REACHED');
 bridge.validateInput(p.csv,p.policy);
 const result=transform(p.csv,p.policy);
 need(Buffer.byteLength(result.output)<=100000,'REVIEW_OUTPUT_LIMIT');
 review.runs++;bridge.save();
 return {...result,columns:parse(result.output)[0],rows:parse(result.output).slice(1),mode:'MERCHANT_PRE_APPROVAL_REVIEW',artifact:RELEASE,remaining:REVIEW_LIMITS.runs-review.runs,published:false};
}
