import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { OpenMrs, uuid } from '../src/openmrs.js';
import { Feedback } from '../src/feedback.js';
import { Store } from '../src/store.js';
async function api(path: string) { const r = await fetch('http://127.0.0.1:4310'+path,{headers:{Authorization:`Bearer ${process.env.API_TOKEN}`}}); const result:any=await r.json(); if(!r.ok) throw new Error(JSON.stringify(result)); return result; }
const referrals=await api('/referrals');
const referral=referrals.find((r:any)=>r.completion_source==='hospital-openmrs-readback') || referrals.find((r:any)=>r.status==='delivered');
assert.ok(referral,'A delivered synthetic referral is required');
const hospital=new OpenMrs(process.env.HOSPITAL_OPENMRS_BASE_URL!,process.env.HOSPITAL_OPENMRS_USERNAME!,process.env.HOSPITAL_OPENMRS_PASSWORD!,'HOSPITAL_OPENMRS');
const phu=new OpenMrs(process.env.OPENMRS_BASE_URL!,process.env.OPENMRS_USERNAME!,process.env.OPENMRS_PASSWORD!);
const obsId=uuid(`synthetic-outcome:${referral.id}`);
let saved=await hospital.request(`obs/${obsId}?v=full`,undefined,true);
if(!saved) {
 const due=new Date(); due.setUTCDate(due.getUTCDate()+42);
 const outcome={version:1,referralId:referral.id,status:'completed',summary:'Synthetic case: hospital delivery care completed; mother and baby discharged for community follow-up.',author:'Hospital integration QA',followUp:{due:due.toISOString().slice(0,10),instruction:'Synthetic discharge plan: community team to arrange the six-week postnatal follow-up for mother and baby.'}};
 await hospital.request('obs',{uuid:obsId,person:referral.receipt.patientUuid,encounter:referral.receipt.encounterUuid,concept:process.env.HOSPITAL_OPENMRS_OUTCOME_CONCEPT,obsDatetime:new Date().toISOString(),location:process.env.HOSPITAL_OPENMRS_LOCATION,value:JSON.stringify(outcome)});
 saved=await hospital.request(`obs/${obsId}?v=full`);
}
const store=new Store(process.env.DATABASE_URL!); const feedback=new Feedback(store);
try {
 await assert.rejects(feedback.capture(referral,{...saved,person:{uuid:'wrong-person'}}),/mismatch/);
 await assert.rejects(feedback.capture(referral,{...saved,value:JSON.stringify({...JSON.parse(saved.value),referralId:uuid('wrong')})}),/referral mismatch/);
 await feedback.poll(hospital); await feedback.returnToPhu(phu);
 let status:any;
 for(let i=0;i<40;i++) {status=await api('/feedback'); if(status.outcomes.find((f:any)=>f.hospital_obs===obsId)?.status==='returned') break; await new Promise(r=>setTimeout(r,1000));}
 const outcome=status.outcomes.find((f:any)=>f.hospital_obs===obsId); assert.equal(outcome.status,'returned',outcome.error);
 const note=await phu.request(`obs/${outcome.phu_receipt.noteUuid}?v=full`); assert.deepEqual(JSON.parse(note.value).outcome,JSON.parse(saved.value));
 await feedback.poll(hospital); await feedback.poll(hospital);
 const again=await api('/feedback'); assert.equal(again.outcomes.filter((f:any)=>f.hospital_obs===obsId).length,1);assert.equal(again.followups.filter((t:any)=>t.feedback_id===outcome.id && t.purpose==='discharge-followup').length,1);
 await assert.rejects(feedback.capture(referral,{...saved,value:JSON.stringify({...JSON.parse(saved.value),summary:'Changed outcome requires reconciliation'})}),/reconciliation/);
 let timeline:any;
 for(let i=0;i<45;i++) {const clients=await api('/clients'); const client=clients.find((c:any)=>c.registry_id);timeline=await api(`/clients/${client.registry_id}/timeline`); if(timeline.resources.some((r:any)=>r.id===`outcome-${outcome.id}`)) break; await new Promise(r=>setTimeout(r,1000));}
 assert.ok(timeline.resources.some((r:any)=>r.id===`outcome-${outcome.id}` && r.valueString===JSON.parse(saved.value).summary));
 assert.ok(timeline.resources.some((r:any)=>r.id===again.followups.find((t:any)=>t.feedback_id===outcome.id && t.purpose==='discharge-followup').id && r.status==='requested'));
 const updated=(await api('/referrals')).find((r:any)=>r.id===referral.id);assert.equal(updated.completion_source,'hospital-openmrs-readback');
 writeFileSync('evidence/hospital-feedback-readback.json',JSON.stringify({verifiedAt:new Date().toISOString(),synthetic:true,referralId:referral.id,hospitalObservation:obsId,phuReceipt:outcome.phu_receipt,followup:again.followups.find((t:any)=>t.feedback_id===outcome.id && t.purpose==='discharge-followup'),sharedOutcome:`outcome-${outcome.id}`,duplicatePollingVerified:true,wrongPatientRejected:true,wrongReferralRejected:true,changedOutcomeRejected:true},null,2));
 console.log('Verified hospital outcome -> HIE -> PHU readback -> shared record and one community follow-up. Identity and duplicate guards passed.');
} finally {await store.pool.end();}
