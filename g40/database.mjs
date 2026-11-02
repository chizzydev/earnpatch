import assert from 'node:assert/strict';
import {databaseConfig} from './config.mjs';
import {validateState} from '../g39/persistence.mjs';
export class Database{
 static async open(url,role,options={}){const {Pool}=await import('pg');const db=new Database(new Pool(databaseConfig(url,options)),role);await db.initialize();return db;}
 constructor(pool,role){assert(['bridge','paperlane'].includes(role));this.pool=pool;this.role=role;this.blocked=false;pool.on?.('error',()=>{this.blocked=true;});}
 async initialize(){const c=await this.pool.connect();try{await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtext('earnpatch-g40-schema-v1'))");await c.query('CREATE TABLE IF NOT EXISTS earnpatch_g40_state (role text PRIMARY KEY, version bigint NOT NULL DEFAULT 0, state jsonb NOT NULL)');await c.query('INSERT INTO earnpatch_g40_state(role,state) VALUES($1,$2) ON CONFLICT DO NOTHING',[this.role,{}]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}
 async transaction(fn){assert(!this.blocked,'DATABASE_UNAVAILABLE');const c=await this.pool.connect();let committing=false;try{
  await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='5s'");await c.query("SET LOCAL idle_in_transaction_session_timeout='65s'");
  const r=await c.query('SELECT version,state FROM earnpatch_g40_state WHERE role=$1 FOR UPDATE',[this.role]);assert.equal(r.rows.length,1);const row=r.rows[0],result=await fn(structuredClone(validateState(row.state,this.role)));
  validateState(result.state,this.role);const updated=await c.query('UPDATE earnpatch_g40_state SET state=$1,version=version+1 WHERE role=$2 AND version=$3',[result.state,this.role,row.version]);assert.equal(updated.rowCount,1,'STATE_VERSION_CONFLICT');
  committing=true;await c.query('COMMIT');return result.value;
 }catch(e){await c.query('ROLLBACK').catch(()=>{});if(committing||!['55P03','57014'].includes(e.code))this.blocked=true;throw Error(committing?'PERSISTENCE_COMMIT_UNKNOWN_NO_AUTOMATIC_RETRY':this.blocked?'PERSISTENCE_UNAVAILABLE':'DATABASE_BUSY');}finally{c.release();}}
 async health(){if(this.blocked)return false;try{await this.pool.query({text:'SELECT 1',query_timeout:3000});return true;}catch{this.blocked=true;return false;}}
 async close(){await this.pool.end();}
}
// Deterministic local verification double. Production entry point always opens PostgreSQL.
export class MemoryDatabase{
 constructor(role,shared={}){this.role=role;this.shared=shared;shared[role]??={state:{},tail:Promise.resolve()};this.blocked=false;}
 transaction(fn){const slot=this.shared[this.role],task=slot.tail.then(async()=>{assert(!this.blocked,'DATABASE_UNAVAILABLE');const r=await fn(structuredClone(slot.state));validateState(r.state,this.role);slot.state=structuredClone(r.state);if(this.failAfterCommit){this.blocked=true;throw Error('PERSISTENCE_COMMIT_UNKNOWN_NO_AUTOMATIC_RETRY');}return r.value;});slot.tail=task.catch(()=>{});return task;}
 async health(){return !this.blocked;}async close(){}
}
