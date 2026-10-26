import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMapping, digest, fhirResources, MappingSchema } from '../src/contracts.js';
import { mappingV1, sampleV1, sampleV2, expected } from '../src/fixtures.js';

test('preserves identifiers, values, units and observation time', () => assert.deepEqual(applyMapping(mappingV1, sampleV1), expected));
test('schema drift fails rather than fabricating absent fields', () => assert.throws(() => applyMapping(mappingV1, sampleV2), /Missing source field/));
test('explicit repair handles split blood pressure', () => {
  const repaired = structuredClone(mappingV1);
  repaired.sourceVersion = '2';
  repaired.fields.systolic = { path: 'vitals.bp', transform: 'bp-systolic' };
  repaired.fields.diastolic = { path: 'vitals.bp', transform: 'bp-diastolic' };
  assert.deepEqual(applyMapping(repaired, sampleV2), expected);
});
test('missing or incompatible units are rejected', () => {
  for (const unit of [undefined, 'kPa', '']) assert.throws(() => applyMapping(mappingV1, { ...sampleV1, vitals: { systolic: 160, diastolic: 106, unit } }));
});
test('no executable or prototype traversal transform can be accepted', () => {
  assert.throws(() => MappingSchema.parse({ ...mappingV1, fields: { ...mappingV1.fields, systolic: { path: 'constructor.prototype', transform: 'copy' } } }));
  assert.throws(() => MappingSchema.parse({ ...mappingV1, fields: { ...mappingV1.fields, systolic: { path: 'vitals.systolic', transform: 'eval' } } }));
});
test('null, blank, boolean and reversed values fail', () => {
  for (const systolic of [null, '', true, 90]) assert.throws(() => applyMapping(mappingV1, { ...sampleV1, vitals: { systolic, diastolic: 106, unit: 'mmHg' } }));
});
test('mapping identity is independent of object key order but changes on edits', () => {
  assert.equal(digest({ a: 1, b: 2 }), digest({ b: 2, a: 1 }));
  assert.notEqual(digest(mappingV1), digest({ ...mappingV1, sourceVersion: '2' }));
});
test('FHIR resource identities are stable for safe replay and unique by source event', () => {
  const one = fhirResources(expected, 'community-simulator', 'event-1');
  assert.deepEqual(one, fhirResources(expected, 'community-simulator', 'event-1'));
  assert.notEqual(one.observation.id, fhirResources(expected, 'community-simulator', 'event-2').observation.id);
  assert.equal(one.observation.subject.reference, `Patient/${one.patient.id}`);
  assert.equal(one.observation.component[0].valueQuantity.code, 'mm[Hg]');
});
