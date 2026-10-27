import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {mapCompletion,proposeCompletionMap} from '../src/completion-mapping.js';
import {digest} from '../src/contracts.js';
import {Store} from '../src/store.js';
import {CommunityDelivery,ComEmr} from '../src/community.js';
const store=new Store(process.env.DATABASE_URL!);
const evidence=JSON.parse(readFileSync('evidence/comemr-completion.json','utf8'));
const api=new ComEmr('http://127.0.0.1:3000','mob');await api.login(process.env.COMEMR_USERNAME!,process.env.COMEMR_PASSWORD!,'spice_uat');
try{
 const delivery=(await store.pool.query('SELECT * FROM community_deliveries WHERE task_id=$1',[evidence.taskId])).rows[0];
 const records=await api.request('/spice-service/follow-up/list',{villageIds:[delivery.link.villageId],lastSyncTime:'1970-01-01T00:00:00.000Z'});
 const record=records.find((r:any)=>r.id===evidence.receiverId);assert.ok(record);
 const expected={receiverId:record.id,patientId:record.patientId,memberId:record.memberId,completed:record.isCompleted,visits:record.visits,updatedAt:record.updatedAt};
 // Deliberate test envelope only. ComEMR's actual API has not changed.
 const changed={taskKey:record.id,person:{patientKey:record.patientId,memberKey:record.memberId},result:{done:record.isCompleted,visitCount:record.visits,changedAt:record.updatedAt}};
 const old={receiverId:'id',patientId:'patientId',memberId:'memberId',completed:'isCompleted',visits:'visits',updatedAt:'updatedAt'};
 assert.throws(()=>mapCompletion(old,changed));
 const subject='completion-repair:'+digest(changed);
 await store.pool.query('INSERT INTO audit(action,subject,detail) VALUES($1,$2,$3)',['completion-envelope-quarantined',subject,{taskId:evidence.taskId,inputHash:digest(changed),simulatedSchemaChange:true}]);
 // Send an independently synthetic contract example, not the local patient identifiers.
 const example={taskKey:7001,person:{patientKey:'DEMO-PATIENT',memberKey:'DEMO-MEMBER'},result:{done:true,visitCount:1,changedAt:1793059200000}};
 const proposal=await proposeCompletionMap(example);writeFileSync('evidence/meta-completion-proposal.json',JSON.stringify(proposal,null,2));assert.ok(proposal.mapping,proposal.questions.join('; '));
 const mapping=proposal.mapping!;
 assert.deepEqual(mapCompletion(mapping,changed),expected);
 const held={taskKey:8002,person:{patientKey:'DEMO-OTHER',memberKey:'DEMO-MEMBER-2'},result:{done:true,visitCount:2,changedAt:1793060200000}};
 assert.deepEqual(mapCompletion(mapping,held),{receiverId:8002,patientId:'DEMO-OTHER',memberId:'DEMO-MEMBER-2',completed:true,visits:2,updatedAt:1793060200000});
 assert.throws(()=>mapCompletion(mapping,{...held,result:{...held.result,done:'true'}}));
 assert.throws(()=>mapCompletion(mapping,{...held,person:{memberKey:'DEMO-MEMBER-2'}}));
 const mappingHash=digest(mapping);
 await store.pool.query('INSERT INTO audit(action,subject,detail) VALUES($1,$2,$3)',['completion-mapping-development-test-approved',subject,{mappingHash,provider:proposal.evidence,actor:'automated-development-test',productActivation:false}]);
 const mapped=mapCompletion(mapping,changed);
 const worker=new CommunityDelivery(store);
 await worker.capture(delivery,{...record,id:mapped.receiverId,patientId:mapped.patientId,memberId:mapped.memberId,isCompleted:mapped.completed,visits:mapped.visits,updatedAt:mapped.updatedAt});
 await worker.capture(delivery,record);
 assert.equal((await store.pool.query('SELECT count(*)::int AS n FROM community_outcomes WHERE task_id=$1',[evidence.taskId])).rows[0].n,1);
 await store.pool.query('INSERT INTO audit(action,subject,detail) VALUES($1,$2,$3)',['completion-envelope-replayed',subject,{mappingHash,taskId:evidence.taskId,duplicateOutcomeCount:1}]);
 const result={timestamp:new Date().toISOString(),taskId:evidence.taskId,simulatedSchemaChange:true,actualComemrApiUnchanged:true,provider:proposal.evidence,mapping,mappingHash,checks:['old mapping rejected changed envelope','real Meta proposal','held-out identity and values preserved','missing identity rejected','string boolean rejected','replay through HIE capture','no duplicate completion'],approval:'automated development test only; no production mapping activated'};
 writeFileSync('evidence/meta-completion-repair.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await store.pool.end();}
