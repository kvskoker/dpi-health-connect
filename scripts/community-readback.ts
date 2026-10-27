import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {Store} from '../src/store.js';
import {verifyFollowup} from '../src/community.js';
const store=new Store(process.env.DATABASE_URL!);
try {
 const taskId=process.argv[2];
 const row=(await store.pool.query('SELECT * FROM community_deliveries WHERE task_id=$1',[taskId])).rows[0];
 assert.ok(row?.receipt?.id && Number.isSafeInteger(row.receipt.id));
 // Read-only inspection of this exact locally acknowledged task. No ComEMR database writes.
 const sql=`SELECT row_to_json(x) FROM (SELECT id,member_id,patient_id,household_id,village_id,type,reason,next_visit_date,is_completed,is_deleted,created_by FROM call_register WHERE id=${row.receipt.id}) x;`;
 const actual=JSON.parse(execFileSync('docker',['exec','comemr-local-postgres-1','psql','-U','postgres','-d','spice','-t','-A','-c',sql],{encoding:'utf8'}).trim());
 verifyFollowup({id:actual.id,memberId:actual.member_id,patientId:actual.patient_id,householdId:actual.household_id,villageId:actual.village_id,type:actual.type,reason:actual.reason,nextVisitDate:actual.next_visit_date},row.payload);
 assert.equal(actual.is_completed,false);assert.equal(actual.is_deleted,false);assert.equal(actual.created_by,row.payload.provenance.spiceUserId);
 const receipt={...row.receipt,readbackVerified:true,readbackMethod:'local-read-only-database',verifiedAt:new Date().toISOString(),mobileVisibility:'Due-list window opens seven days before appointment; mobile display not verified'};
 await store.pool.query("UPDATE community_deliveries SET state='verified',receipt=$2,error=NULL,updated_at=now() WHERE task_id=$1",[taskId,receipt]);
 await store.pool.query('INSERT INTO audit(action,subject,detail) VALUES($1,$2,$3)',['comemr-followup-local-readback',taskId,receipt]);
 writeFileSync('evidence/comemr-followup-readback.json',JSON.stringify({synthetic:true,taskId,receipt,receiver:actual},null,2));
 console.log(JSON.stringify({taskId,receiverId:actual.id,state:'verified',method:receipt.readbackMethod,due:actual.next_visit_date}));
}finally{await store.pool.end();}
