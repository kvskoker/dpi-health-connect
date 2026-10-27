import {randomUUID} from 'node:crypto';
import {CompletionMap,mapCompletion} from './completion-mapping.js';
import {digest} from './contracts.js';
import {CommunityDelivery,verifyFollowup} from './community.js';
import type {Store} from './store.js';
export class CompletionRepairs {
 constructor(private store:Store){}
 async init(){await this.store.pool.query(`CREATE TABLE IF NOT EXISTS completion_repairs(id uuid PRIMARY KEY,task_id uuid NOT NULL REFERENCES community_followups(id),input jsonb NOT NULL,expected jsonb NOT NULL,state text NOT NULL DEFAULT 'held',mapping jsonb,mapping_hash text,validation_id uuid,validation jsonb,approved_by text,approved_at timestamptz,proposal jsonb,receipt jsonb,created_at timestamptz DEFAULT now());`);}
 async get(id:string){const row=(await this.store.pool.query('SELECT * FROM completion_repairs WHERE id=$1',[id])).rows[0];if(!row)throw new Error('Repair not found');return row;}
 async create(taskId:string){
  const outcome=(await this.store.pool.query('SELECT body FROM community_outcomes WHERE task_id=$1',[taskId])).rows[0]?.body;
  if(!outcome)throw new Error('Select a completion verified from ComEMR first');
  const expected={receiverId:outcome.receiverId,patientId:outcome.patientId,memberId:outcome.memberId,completed:outcome.completed,visits:outcome.visits,updatedAt:outcome.updatedAt};
  const input={taskKey:outcome.receiverId,person:{patientKey:outcome.patientId,memberKey:outcome.memberId},result:{done:outcome.completed,visitCount:outcome.visits,changedAt:outcome.updatedAt}};
  const id=randomUUID();await this.store.pool.query('INSERT INTO completion_repairs(id,task_id,input,expected) VALUES($1,$2,$3,$4)',[id,taskId,input,expected]);
  await this.store.pool.query('INSERT INTO audit(action,subject,detail) VALUES($1,$2,$3)',['completion-repair-held',id,{taskId,simulatedSchemaChange:true,inputHash:digest(input)}]);return this.get(id);
 }
 async validate(id:string,raw:unknown){
  const mapping=CompletionMap.parse(raw), row=await this.get(id);const results:any[]=[];
  const example={taskKey:8102,person:{patientKey:'DEMO-OTHER',memberKey:'MEMBER-OTHER'},result:{done:true,visitCount:2,changedAt:1793060200000}};
  for(const [name,input,expected] of [['Captured completion',row.input,row.expected],['Independent example',example,{receiverId:8102,patientId:'DEMO-OTHER',memberId:'MEMBER-OTHER',completed:true,visits:2,updatedAt:1793060200000}]] as any[]){try{const actual=mapCompletion(mapping,input);results.push({name,passed:digest(actual)===digest(expected),actual,expected});}catch(e){results.push({name,passed:false,error:(e as Error).message});}}
  for(const [name,input] of [['Missing identity',{...example,person:{memberKey:'MEMBER-OTHER'}}],['String completion flag',{...example,result:{...example.result,done:'true'}}],['No completed visit',{...example,result:{...example.result,visitCount:0}}]] as any[]){let rejected=false;try{mapCompletion(mapping,input);}catch{rejected=true;}results.push({name,passed:rejected});}
  const passed=results.every(r=>r.passed), validationId=randomUUID(), hash=digest(mapping);
  const updated=await this.store.pool.query("UPDATE completion_repairs SET mapping=$2,mapping_hash=$3,validation_id=$4,validation=$5,state=$6,approved_by=NULL,approved_at=NULL WHERE id=$1 AND state!='replayed' RETURNING id",[id,mapping,hash,validationId,{passed,results},passed?'validated':'held']);
  if(!updated.rowCount)throw new Error('Replayed repairs cannot be changed; prepare a new rehearsal');return this.get(id);
 }
 async approve(id:string,validationId:string,mapping:unknown,actor:string){
  const hash=digest(CompletionMap.parse(mapping));
  const db=await this.store.pool.connect();try{await db.query('BEGIN');const row=(await db.query('SELECT * FROM completion_repairs WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(!row||row.validation_id!==validationId||row.mapping_hash!==hash||!row.validation?.passed||row.state!=='validated')throw new Error('Validate this exact mapping before approval');
   await db.query("UPDATE completion_repairs SET state='approved',approved_by=$2,approved_at=now() WHERE id=$1",[id,actor]);await db.query('INSERT INTO audit(action,subject,detail) VALUES($1,$2,$3)',['completion-repair-approved',id,{actor,validationId,mappingHash:hash}]);await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}return this.get(id);
 }
 async replay(id:string,validationId:string,mapping:unknown,readLive:(delivery:any)=>Promise<any>){
  const hash=digest(CompletionMap.parse(mapping)),db=await this.store.pool.connect();
  try{await db.query('BEGIN');const row=(await db.query('SELECT * FROM completion_repairs WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(!row||row.validation_id!==validationId||row.mapping_hash!==hash||!row.approved_by||!row.validation?.passed||!['approved','replayed'].includes(row.state))throw new Error('Exact validated mapping approval is required');
   if(row.state==='replayed'){await db.query('COMMIT');return row;}
   const delivery=(await db.query('SELECT * FROM community_deliveries WHERE task_id=$1',[row.task_id])).rows[0];const live=await readLive(delivery);verifyFollowup(live,delivery.payload);
   const actual={receiverId:live.id,patientId:live.patientId,memberId:live.memberId,completed:live.isCompleted,visits:live.visits,updatedAt:live.updatedAt};
   const mapped=mapCompletion(row.mapping,row.input);if(digest(actual)!==digest(row.expected)||digest(mapped)!==digest(actual))throw new Error('Source completion changed or mapping mismatch; prepare a fresh repair');
   await new CommunityDelivery(this.store).capture(delivery,{...live,id:mapped.receiverId,patientId:mapped.patientId,memberId:mapped.memberId,isCompleted:mapped.completed,visits:mapped.visits,updatedAt:mapped.updatedAt});
   const count=(await db.query('SELECT count(*)::int AS n FROM community_outcomes WHERE task_id=$1',[row.task_id])).rows[0].n;
   if(count!==1)throw new Error('Expected exactly one persisted completion');
   const receipt={receiverId:live.id,taskId:row.task_id,completionCount:count,liveReadbackVerified:true,replayedAt:new Date().toISOString()};
   await db.query("UPDATE completion_repairs SET state='replayed',receipt=$2 WHERE id=$1",[id,receipt]);await db.query('INSERT INTO audit(action,subject,detail) VALUES($1,$2,$3)',['completion-repair-replayed',id,{...receipt,mappingHash:hash,actor:row.approved_by}]);await db.query('COMMIT');return {...row,state:'replayed',receipt};
  }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
 }
}
