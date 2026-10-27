import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {ComEmr,CommunityDelivery} from '../src/community.js';
import {Store} from '../src/store.js';
const saved=JSON.parse(readFileSync('evidence/comemr-completion.json','utf8'));const store=new Store(process.env.DATABASE_URL!);
try {
 const api=new ComEmr('http://127.0.0.1:3000','mob');await api.login(process.env.COMEMR_USERNAME!,process.env.COMEMR_PASSWORD!,'spice_uat');
 const d=(await store.pool.query('SELECT * FROM community_deliveries WHERE task_id=$1',[saved.taskId])).rows[0];
 const rows=await api.request('/spice-service/follow-up/list',{villageIds:[d.link.villageId],lastSyncTime:'1970-01-01T00:00:00.000Z'});const r=rows.find((x:any)=>x.id===saved.receiverId);
 const worker=new CommunityDelivery(store);
 await assert.rejects(worker.capture(d,{...r,memberId:'wrong'}),/mismatch/);
 await assert.rejects(worker.capture(d,{...r,id:r.id+100}),/ID mismatch/);
 await assert.rejects(worker.capture(d,{...r,visits:2}),/reconciliation/);
 const headers={Authorization:'Bearer '+process.env.API_TOKEN};
 const clients:any=await (await fetch('http://127.0.0.1:4310/clients',{headers})).json();
 const timeline:any=await (await fetch('http://127.0.0.1:4310/clients/'+clients[0].registry_id+'/timeline',{headers})).json();
 assert.equal(timeline.resources.find((x:any)=>x.id===saved.taskId).status,'completed');
 assert.equal(timeline.resources.find((x:any)=>x.id==='2e8a6405-043f-57a6-a63e-90ea65a30b86').status,'requested');
 assert.ok(timeline.resources.some((x:any)=>x.id==='visit-'+saved.taskId && x.meta.source==='urn:dpi-h:source:comemr'));
 writeFileSync('evidence/comemr-completion.json',JSON.stringify({...saved,sharedRecordVerified:true,wrongMemberRejected:true,wrongReceiverRejected:true,changedCompletionRejected:true},null,2));
 console.log('SHR completed rehearsal + pending six-week appointment verified. Identity and changed-outcome guards passed.');
}finally{await store.pool.end();}
