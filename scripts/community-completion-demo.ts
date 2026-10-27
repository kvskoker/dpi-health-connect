import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {ComEmr,CommunityDelivery,CommunityLink} from '../src/community.js';
import {Store} from '../src/store.js';
import {uuid} from '../src/openmrs.js';
const store=new Store(process.env.DATABASE_URL!);
const link=CommunityLink.parse(JSON.parse(readFileSync(process.env.COMEMR_LINK_FILE!,'utf8')));
const api=new ComEmr('http://127.0.0.1:3000','mob');
await api.login(process.env.COMEMR_USERNAME!,process.env.COMEMR_PASSWORD!,process.env.COMEMR_PASSWORD_HASH_KEY??'spice_uat');
try {
 const worker=new CommunityDelivery(store);await worker.init();
 const original=(await store.pool.query("SELECT * FROM community_followups WHERE id='2e8a6405-043f-57a6-a63e-90ea65a30b86'")).rows[0];
 const taskId=uuid('community-completion-rehearsal:'+original.id);
 await store.pool.query("INSERT INTO community_followups(id,feedback_id,referral_id,due_date,instruction,purpose) VALUES($1,$2,$3,CURRENT_DATE,$4,'integration-rehearsal') ON CONFLICT DO NOTHING",[taskId,original.feedback_id,original.referral_id,'Synthetic integration rehearsal: record a completed community visit today. Six-week postnatal appointment remains scheduled.']);
 const delivery=await worker.deliver(taskId,link,api);assert.equal(delivery.state,'verified',delivery.error);
 let list=await api.request('/spice-service/follow-up/list',{villageIds:[link.villageId],lastSyncTime:'1970-01-01T00:00:00.000Z'});
 let record=list.find((r:any)=>r.id===delivery.receipt.id);assert.ok(record);
 if(!record.isCompleted) {
  await api.request('/spice-service/follow-up/update',{...delivery.payload,id:record.id,isCompleted:true,visits:1,callOutcome:'Successful',followUpDetails:[{callDate:new Date().toISOString(),status:'SUCCESSFUL',reason:'Synthetic integration rehearsal: Isatu completed a household follow-up visit.',attempts:1}]});
 }
 await worker.poll(api);
 const result=(await store.pool.query('SELECT * FROM community_outcomes WHERE task_id=$1',[taskId])).rows[0];assert.ok(result,'No verified completion returned');
 await worker.poll(api);assert.equal((await store.pool.query('SELECT count(*)::int AS n FROM community_outcomes WHERE task_id=$1',[taskId])).rows[0].n,1);
 assert.equal((await store.pool.query('SELECT status FROM community_followups WHERE id=$1',[original.id])).rows[0].status,'requested');
 writeFileSync('evidence/comemr-completion.json',JSON.stringify({verifiedAt:new Date().toISOString(),synthetic:true,taskId,receiverId:record.id,outcome:result.body,originalAppointmentPreserved:true,repeatPollVerified:true},null,2));
 console.log(JSON.stringify({taskId,receiverId:record.id,completionVerified:true,originalAppointmentPreserved:true}));
}finally{await store.pool.end();}
