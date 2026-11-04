// Only this new deployment's fictional evaluation sessions expire. No chain evidence/journals are loaded here.
export function expireEvaluation(state,role,now=Date.now()){
 if(role==='paperlane'){for(const [id,s]of Object.entries(state.sessions||{}))if(s.expires<=now)delete state.sessions[id];return state;}
 const b=state.bridge;if(!b)return state;const expired=new Set(Object.entries(b.workspaces||{}).filter(([,w])=>Number.isFinite(w.created)&&w.created<now-86400000).map(([id])=>id));
 for(const id of expired)delete b.workspaces[id];for(const [id,session]of Object.entries(state.g41?.sessions||{}))if(expired.has(session.scope))delete state.g41.sessions[id];for(const [id,scope]of Object.entries(state.studioSessions||{}))if(expired.has(scope))delete state.studioSessions[id];
 for(const [id,h]of Object.entries(b.handoffs||{}))if(h.expires<=now||expired.has(h.scope))delete b.handoffs[id];
 for(const jobs of [b.jobs,state.financeV1?.jobs])for(const [id,j]of Object.entries(jobs||{}))if(expired.has(j.scope))delete jobs[id];
 for(const id of expired)if(state.financeV1?.states)delete state.financeV1.states[id];return state;
}
