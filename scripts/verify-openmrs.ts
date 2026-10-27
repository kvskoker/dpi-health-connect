import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import pg from 'pg';
import { OpenMrs } from '../src/openmrs.js';

// Readback and repeat-delivery verification of the synthetic event from the recorded Meta run.
const run = JSON.parse(readFileSync('evidence/meta-repair-run.json', 'utf8'));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const { rows } = await pool.query('SELECT o.status, o.receipt, o.bundle, e.canonical FROM outbox o JOIN events e ON e.id=o.event_id WHERE event_id=$1', [run.eventId]);
  assert.equal(rows[0]?.status, 'delivered', 'Real OpenMRS delivery is not yet verified; check adapter setup and pending retry');
  const receipt = rows[0].receipt;
  assert.equal(receipt.kind, 'openmrs-rest');
  const api = new OpenMrs(process.env.OPENMRS_BASE_URL!, process.env.OPENMRS_USERNAME!, process.env.OPENMRS_PASSWORD!);
  const patient = await api.request(`patient/${receipt.patientUuid}?v=full`);
  assert.equal(patient.uuid, receipt.patientUuid);
  const sourcePatient = rows[0].bundle.entry.find((e: any) => e.resource.resourceType === 'Patient').resource;
  assert.ok(patient.identifiers.some((i: any) => i.identifier === sourcePatient.id && i.identifierType.uuid === process.env.OPENMRS_IDENTIFIER_TYPE));
  assert.equal(receipt.observations.length, 2);
  const expectedValues = [160, 106];
  for (const [index, observation] of receipt.observations.entries()) {
    const saved = await api.request(`obs/${observation.uuid}?v=full`);
    assert.equal(saved.person.uuid, patient.uuid);
    assert.equal(saved.concept.uuid, observation.concept);
    assert.equal(saved.value, expectedValues[index]);
    assert.equal(Date.parse(saved.obsDatetime), Date.parse(rows[0].canonical.observedAt));
    assert.equal(saved.location.uuid, process.env.OPENMRS_LOCATION);
    const concept = await api.request(`concept/${saved.concept.uuid}?v=full`);
    assert.match(concept.units, /mm\s*hg/i);
  }
  // Exercise delivery again against the real receiver. Existing UUIDs must be reused.
  const repeatReceipt = await api.deliver(rows[0].bundle);
  assert.deepEqual(repeatReceipt, receipt);
  const observations = await api.request(`obs?patient=${receipt.patientUuid}&v=full&limit=100`);
  for (const observation of receipt.observations) {
    assert.equal(observations.results.filter((o: any) => o.uuid === observation.uuid).length, 1);
  }
  const evidence = { timestamp: new Date().toISOString(), eventId: run.eventId,
    receiver: 'PHU OpenMRS', independentReadbackVerified: true,
    checks: ['cross-system patient identifier retained', 'systolic 160 and diastolic 106', 'concept units mmHg', 'observation time preserved', 'Binkolo facility location', 'repeat delivery reuses patient and observation UUIDs'], receipt };
  writeFileSync('evidence/openmrs-readback.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally { await pool.end(); }
