import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { OpenMrs } from '../src/openmrs.js';
import pg from 'pg';
const base = 'http://127.0.0.1:4310';
async function api(path: string, body?: unknown) {
  const response = await fetch(base + path, { headers: { Authorization: `Bearer ${process.env.API_TOKEN}`, 'Content-Type': 'application/json' }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
  const result: any = await response.json(); if (!response.ok) throw new Error(result.error); return result;
}
const source = JSON.parse(readFileSync('evidence/meta-repair-run.json', 'utf8'));
const input = { requestId: `hospital-verification-${source.eventId}`, eventId: source.eventId,
  reason: 'Synthetic scenario: 37-week pregnancy with high BP and bleeding. PHU requests hospital obstetric assessment; operative delivery unavailable at PHU.', urgency: 'emergency', actor: 'Integration QA' };
let referral = await api('/referrals', input);
const duplicate = await api('/referrals', input); assert.equal(duplicate.id, referral.id);
await assert.rejects(api('/referrals', { ...input, reason: 'Changed reason must fail duplicate protection' }));
if (referral.status === 'queued') await assert.rejects(api(`/referrals/${referral.id}/status`, { status: 'accepted', actor: 'Integration QA', note: 'Must reject premature acceptance' }));
for (let attempt = 0; referral.status === 'queued' && attempt < 20; attempt++) {
  await new Promise(resolve => setTimeout(resolve, 1000));
  referral = (await api('/referrals')).find((r: any) => r.id === referral.id);
}
assert.ok(['delivered', 'accepted', 'completed'].includes(referral.status), `Hospital delivery pending: ${referral.error}`);
const hospital = new OpenMrs(process.env.HOSPITAL_OPENMRS_BASE_URL!, process.env.HOSPITAL_OPENMRS_USERNAME!, process.env.HOSPITAL_OPENMRS_PASSWORD!, 'HOSPITAL_OPENMRS');
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const stored = (await db.query('SELECT * FROM referrals WHERE id=$1', [referral.id])).rows[0];
  const patient = await hospital.request(`patient/${referral.receipt.patientUuid}?v=full`);
  const sourcePatient = stored.bundle.entry.find((e: any) => e.resource.resourceType === 'Patient').resource;
  assert.ok(patient.identifiers.some((i: any) => i.identifier === sourcePatient.id && i.identifierType.uuid === process.env.HOSPITAL_OPENMRS_IDENTIFIER_TYPE));
  for (const [index, observation] of referral.receipt.observations.entries()) {
    const saved = await hospital.request(`obs/${observation.uuid}?v=full`);
    assert.equal(saved.value, [160,106][index]); assert.equal(saved.person.uuid, patient.uuid);
  }
  const note = await hospital.request(`obs/${referral.receipt.referralNoteUuid}?v=full`);
  assert.ok(note.value.includes(input.reason)); assert.equal(note.encounter.uuid, referral.receipt.encounterUuid);
  assert.deepEqual(await hospital.deliverReferral(stored.bundle, stored), referral.receipt);
  if (referral.status === 'delivered') {
    await assert.rejects(api(`/referrals/${referral.id}/status`, { status: 'completed', actor: 'Integration QA', note: 'Must reject skipped acceptance' }));
    referral = await api(`/referrals/${referral.id}/status`, { status: 'accepted', actor: 'Integration QA', note: 'Synthetic operator acceptance test; not a hospital callback' });
  }
  if (referral.status === 'accepted') referral = await api(`/referrals/${referral.id}/status`, { status: 'completed', actor: 'Integration QA', note: 'Synthetic workflow completion test; no real care performed' });
  const evidence = { timestamp: new Date().toISOString(), referralId: referral.id, sourceEventId: source.eventId, receiver: 'Makeni hospital OpenMRS',
    checks: ['duplicate request reuses referral', 'conflicting request rejected', 'patient identifier linked', 'BP 160/106 read back', 'referral reason stored in hospital encounter', 'repeat delivery reuses receiver records', 'ordered operator acceptance and completion'],
    workflowStatus: referral.status, statusSource: 'Integration QA operator test, not EMR callback', receipt: referral.receipt };
  writeFileSync('evidence/hospital-referral-readback.json', JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence, null, 2));
} finally { await db.end(); }
