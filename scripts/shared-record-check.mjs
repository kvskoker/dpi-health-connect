import assert from 'node:assert/strict';
import { Store } from './src/store.ts';
import { Longitudinal } from './src/longitudinal.ts';
const store = new Store(process.env.DATABASE_URL), service = new Longitudinal(store);
try {
const clients=(await store.pool.query("SELECT * FROM longitudinal_sync WHERE status='synced'")).rows;
assert.ok(clients.length>0);
const client=clients[0];
await store.pool.query('UPDATE longitudinal_sync SET snapshot_hash=NULL WHERE source_patient=$1',[client.source_patient]);await service.sync();
const timeline=await service.timeline(client.registry_id);
assert.ok(timeline.patient.identifier.some(i=>i.system==='urn:dpi-h:patient:community-simulator'));
assert.ok(timeline.patient.identifier.some(i=>i.system==='urn:dpi-h:patient:binkolo-phu'));
assert.ok(timeline.patient.identifier.some(i=>i.system==='urn:dpi-h:patient:makeni-hospital'));
const events=(await store.pool.query("SELECT e.*,o.bundle FROM events e JOIN outbox o ON o.event_id=e.id WHERE e.status IN ('persisted','delivered')")).rows;
for(const event of events){const original=event.bundle.entry.find(e=>e.resource.resourceType==='Observation').resource;
const saved=timeline.resources.find(r=>r.id===original.id);assert.ok(saved);assert.equal(saved.meta.source,'urn:dpi-h:source:community-simulator');assert.deepEqual(saved.component,original.component);assert.equal(saved.effectiveDateTime,original.effectiveDateTime);assert.equal(saved.subject.reference,'Patient/'+client.registry_id);}
assert.ok(timeline.resources.some(r=>r.resourceType==='ServiceRequest'));
assert.ok(timeline.resources.some(r=>r.resourceType==='Task'&&r.status==='completed'));
const clinicalInRegistry=await service.registry('Observation?_summary=count');assert.equal(clinicalInRegistry.data.total,0);
const linked=await service.registry('Patient/'+client.source_patient);
assert.ok(linked.data.link.some(l=>l.other.reference==='Patient/'+client.registry_id));
const before=timeline.resources.map(r=>r.resourceType+'/'+r.id).sort();
await store.pool.query('UPDATE longitudinal_sync SET snapshot_hash=NULL WHERE source_patient=$1',[client.source_patient]);
await service.sync();
const synced=(await store.pool.query('SELECT * FROM longitudinal_sync WHERE source_patient=$1',[client.source_patient])).rows[0];assert.equal(synced.status,'synced',synced.error);assert.equal(synced.registry_id,client.registry_id);
const after=await service.timeline(client.registry_id);assert.deepEqual(after.resources.map(r=>r.resourceType+'/'+r.id).sort(),before);
console.log(JSON.stringify({timestamp:new Date().toISOString(),registry:'OpenCR',sharedRecord:'HAPI FHIR R4',registryId:client.registry_id,resourceCount:timeline.resources.length,checks:['community PHU hospital identifiers linked','assessment values time and source provenance preserved','shared registry identity used across resources','referral and handover timeline retrieved','no clinical observations in registry','repeat synchronization retains stable resource identities']},null,2));
} finally {await store.pool.end();}
