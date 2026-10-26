import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mappingV1, sampleV1, sampleV2, expected } from '../src/fixtures.js';

const base = `http://127.0.0.1:${process.env.PORT ?? 4300}`;
async function request(path: string, body?: unknown) {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${process.env.API_TOKEN}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const result: any = await response.json();
  if (!response.ok) throw new Error(`${path}: ${JSON.stringify(result)}`);
  return result;
}
async function approve(mapping: unknown, sample: unknown) {
  const saved = await request('/mappings', mapping);
  const tests = await request(`/mappings/${saved.id}/validate`, { cases: [{ input: sample, expected }] });
  assert.equal(tests.passed, true);
  await request(`/mappings/${saved.id}/approve`, { validationId: tests.validationId, actor: 'local-demo-operator' });
  return saved.id;
}
const unauthorized = await fetch(base + '/records');
assert.equal(unauthorized.status, 401);
const mappingId = await approve(mappingV1, sampleV1);
const sourceEventId = 'DEMO-' + randomUUID();
const event = await request('/simulator/assessments', { sourceEventId, sourceVersion: '1', mappingId, payload: sampleV1 });
assert.equal(event.event.status, 'persisted');
const duplicate = await request('/simulator/assessments', { sourceEventId, sourceVersion: '1', mappingId, payload: sampleV1 });
assert.equal(duplicate.duplicate, true);
const broken = await request('/simulator/assessments', { sourceEventId: sourceEventId + '-v2', sourceVersion: '2', mappingId, payload: sampleV2 });
assert.equal(broken.event.status, 'quarantined');
const repaired = structuredClone(mappingV1);
repaired.sourceVersion = '2';
repaired.fields.systolic = { path: 'vitals.bp', transform: 'bp-systolic' };
repaired.fields.diastolic = { path: 'vitals.bp', transform: 'bp-diastolic' };
const repairedId = await approve(repaired, sampleV2);
const replay = await request(`/events/${broken.event.id}/replay`, { mappingId: repairedId });
assert.equal(replay.status, 'persisted');
console.log(JSON.stringify({ result: 'PASS', event: event.event.id, repairedEvent: replay.id,
  checks: ['API authentication', 'mapping validation and approval', 'durable assessment', 'duplicate prevention', 'schema-change quarantine', 'approved repair and replay'],
  limitation: 'Repair is authored by this test script, not AI. External receiver delivery is a separate verification.' }, null, 2));
