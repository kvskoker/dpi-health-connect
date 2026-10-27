import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {Store} from '../src/store.js';
import {Referrals} from '../src/referrals.js';
import {Feedback} from '../src/feedback.js';
import {CommunityDelivery} from '../src/community.js';
import {mappingV1,sampleV1,expected} from '../src/fixtures.js';
const schema='test_community_'+randomUUID().replaceAll('-','');
const admin=new pg.Pool({connectionString:process.env.DATABASE_URL});
await admin.query(`CREATE SCHEMA ${schema}`);
const url=new URL(process.env.DATABASE_URL!);url.searchParams.set('options',`-csearch_path=${schema}`);
const store=new Store(url.href);
try {
 await store.init(); const refs=new Referrals(store);await refs.init();await new Feedback(store).init();const worker=new CommunityDelivery(store);await worker.init();
 const mapping=await store.saveMapping(mappingV1);const validation=await store.validate(mapping.id,[{input:sampleV1,expected}]);await store.approve(mapping.id,validation.validationId,'QA');
 const {event}=await store.ingest({source:'community-simulator',sourceEventId:'community-test',sourceVersion:'1',mappingId:mapping.id,payload:sampleV1});
 await store.deliver('http://test.invalid',undefined,async()=>({kind:'openmrs-rest'}));
 const ref=await refs.create({requestId:'community-test',eventId:event.id,reason:'Synthetic follow-up transport test',urgency:'routine',actor:'QA'});
 const fid=randomUUID(),tid=randomUUID();
 await store.pool.query('INSERT INTO hospital_feedback(id,referral_id,hospital_obs,hospital_encounter,observed_at,payload,payload_hash) VALUES($1,$2,$3,$4,now(),$5,$6)',[fid,ref.id,'test-observation','test-encounter',{},'test']);
 await store.pool.query('INSERT INTO community_followups(id,feedback_id,referral_id,due_date,instruction) VALUES($1,$2,$3,$4,$5)',[tid,fid,ref.id,'2026-12-08','Arrange synthetic postnatal follow-up.']);
 const link={sourcePatientId:expected.patientId,patientId:'demo-p',memberId:'demo-m',householdId:'demo-h',villageId:'demo-v',syntheticConfirmed:true as const};
 let creates=0;
 const adapter={userId:101,request:async(path:string,payload?:any)=>{
  if(path.includes('member/list'))return [{id:link.memberId,patientId:link.patientId,householdId:link.householdId,villageId:link.villageId,isActive:true}];
  if(path.endsWith('/create')){creates++;throw new Error('Simulated response loss after receiver write');}
  return [];
 }};
 await Promise.all([worker.deliver(tid,link,adapter),worker.deliver(tid,link,adapter)]);
 assert.equal(creates,1);let record=await worker.deliver(tid,link,adapter);assert.equal(creates,1);assert.equal(record.state,'needs-review');
 await assert.rejects(worker.deliver(tid,{...link,patientId:'wrong'},adapter),/different/);
 const tid2=randomUUID(),fid2=randomUUID();
 await store.pool.query('INSERT INTO hospital_feedback(id,referral_id,hospital_obs,hospital_encounter,observed_at,payload,payload_hash) VALUES($1,$2,$3,$4,now(),$5,$6)',[fid2,ref.id,'test-observation-2','test-encounter',{},'test']);
 await store.pool.query('INSERT INTO community_followups(id,feedback_id,referral_id,due_date,instruction) VALUES($1,$2,$3,$4,$5)',[tid2,fid2,ref.id,'2026-12-08','Arrange synthetic postnatal follow-up.']);
 record=await worker.deliver(tid2,link,{...adapter,request:async(path:string,payload?:any)=>path.endsWith('/create')?{...payload,id:42}:adapter.request(path,payload)});
 assert.equal(record.state,'acknowledged');assert.equal(record.receipt.readbackVerified,false);
 console.log('Explicit test transport: concurrent submission and response-loss recovery never duplicate writes; future tasks remain acknowledged, not falsely verified.');
}finally{await store.pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}

