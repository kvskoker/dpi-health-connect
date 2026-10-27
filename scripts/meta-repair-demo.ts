import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { applyMapping, digest } from '../src/contracts.js';
import { mappingV1, sampleV1, sampleV2, expected } from '../src/fixtures.js';

const base = `http://127.0.0.1:${process.env.DEMO_PORT ?? 4310}`;
async function api(path: string, body?: unknown): Promise<any> {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: {
    Authorization: `Bearer ${process.env.API_TOKEN}`, 'Content-Type': 'application/json'
  }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000) });
  const json = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(json));
  return json;
}
const original = await api('/mappings', mappingV1);
const originalTest = await api(`/mappings/${original.id}/validate`, { cases: [{ input: sampleV1, expected }] });
await api(`/mappings/${original.id}/approve`, { validationId: originalTest.validationId, actor: 'automated-development-test' });
const broken = await api('/simulator/assessments', {
  sourceEventId: 'META-REPAIR-' + randomUUID(), sourceVersion: '2', mappingId: original.id, payload: sampleV2
});
assert.equal(broken.event.status, 'quarantined');
const proposal = await api('/meta/propose-mapping', {
  sourceSystem: 'community-simulator', sourceVersion: '2', syntheticDataConfirmed: true,
  sourceSchema: { clientId: 'stable patient identifier', measuredAt: 'ISO observation timestamp',
    vitals: { bp: 'systolic/diastolic numeric values separated by slash', unit: 'explicit unit, mmHg' } },
  syntheticExample: sampleV2
});
if (!proposal.mapping) throw new Error('Meta requested clarification: ' + proposal.questions.join('; '));
assert.equal(digest(applyMapping(proposal.mapping, sampleV2)), digest(expected));
const nextInput = { ...sampleV2, clientId: 'DEMO-SECOND-002', vitals: { bp: '120/80', unit: 'mmHg' } };
const nextExpected = { ...expected, patientId: 'DEMO-SECOND-002', systolic: 120, diastolic: 80 };
assert.deepEqual(applyMapping(proposal.mapping, nextInput), nextExpected);
assert.throws(() => applyMapping(proposal.mapping, { ...sampleV2, vitals: { bp: '160/106' } }));
const saved = await api('/mappings', proposal.mapping);
const checked = await api(`/mappings/${saved.id}/validate`, { cases: [{ input: sampleV2, expected }, { input: nextInput, expected: nextExpected }] });
assert.equal(checked.passed, true);
// This is an explicitly labeled development test of the approval API, not a human approval claim.
await api(`/mappings/${saved.id}/approve`, { validationId: checked.validationId, actor: 'automated-development-test' });
const replayed = await api(`/events/${broken.event.id}/replay`, { mappingId: saved.id });
assert.equal(replayed.status, 'persisted');
const result = { timestamp: new Date().toISOString(), eventId: broken.event.id, provider: proposal.evidence,
  mapping: proposal.mapping, mappingId: saved.id, validationId: checked.validationId,
  checks: ['original mapping quarantines changed schema', 'real Meta mapping proposal', 'two expected-output cases', 'missing unit rejected', 'development-test approval', 'successful local replay'],
  delivery: 'Pending separate real receiver readback', approvalMode: 'Automated test only; product activation requires operator review' };
mkdirSync('evidence', { recursive: true });
writeFileSync('evidence/meta-repair-run.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
