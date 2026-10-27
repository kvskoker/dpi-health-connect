import assert from 'node:assert/strict';
import test from 'node:test';
import { followupPayload, verifyFollowup, ComEmr } from '../src/community.js';
const link={sourcePatientId:'DEMO-AMINATA-001',patientId:'demo-patient',memberId:'demo-member',householdId:'demo-household',villageId:'demo-village',syntheticConfirmed:true as const};
const task={id:'demo-task',source_patient:link.sourcePatientId,due_date:'2026-12-08',instruction:'Arrange synthetic postnatal follow-up.'};
test('ComEMR mapping preserves linkage, due date and external correlation',()=>{const p=followupPayload(task,link,101);assert.equal(p.nextVisitDate,'2026-12-08T12:00:00.000Z');assert.equal(p.type,'HH_VISIT');assert.equal(p.memberId,link.memberId);assert.match(p.reason,/DPI:demo-task/);assert.equal(verifyFollowup({...p,id:7},p),7);});
test('ComEMR rejects wrong source identity and silently truncated instructions',()=>{assert.throws(()=>followupPayload({...task,source_patient:'other'},link,101),/linkage/);assert.throws(()=>followupPayload({...task,instruction:'x'.repeat(256)},link,101),/255/);});
test('ComEMR readback requires exact identity and due date',()=>{const p=followupPayload(task,link,101);assert.throws(()=>verifyFollowup({...p,id:7,patientId:'other'},p),/patientId/);assert.throws(()=>verifyFollowup({...p,id:7,nextVisitDate:'2026-12-09'},p),/date/);});
test('Pilot ComEMR connector cannot send credentials to remote hosts',()=>{assert.throws(()=>new ComEmr('https://example.com'),/local/);});
