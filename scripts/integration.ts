import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import pg from 'pg';
import { Store } from '../src/store.js';
import { mappingV1, sampleV1, sampleV2, expected } from '../src/fixtures.js';

// Each run gets its own schema; no application tables or existing records are deleted.
const schema = `test_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await admin.query(`CREATE SCHEMA ${schema}`);
const url = new URL(process.env.DATABASE_URL!);
url.searchParams.set('options', `-csearch_path=${schema}`);
let store = new Store(url.href);
const receiverRecords = new Map<string, any>();
let unavailable = true;
const receiver = createServer(async (req, res) => {
  if (unavailable) { res.writeHead(503).end(); return; }
  if (req.method === 'POST') {
    let body = ''; for await (const chunk of req) body += chunk;
    const bundle = JSON.parse(body);
    for (const entry of bundle.entry) receiverRecords.set('/' + entry.request.url, entry.resource);
    res.setHeader('Content-Type', 'application/fhir+json');
    res.end(JSON.stringify({ resourceType: 'Bundle', type: 'transaction-response', entry: bundle.entry.map((e: any) => ({ response: { status: '200 OK', location: e.request.url } })) }));
  } else {
    const data = receiverRecords.get(req.url!);
    if (!data) res.writeHead(404).end(); else { res.setHeader('Content-Type', 'application/fhir+json'); res.end(JSON.stringify(data)); }
  }
});
await new Promise<void>(resolve => receiver.listen(0, '127.0.0.1', resolve));
const address = receiver.address() as { port: number };
try {
  await store.init();
  const m = await store.saveMapping(mappingV1);
  await assert.rejects(store.approve(m.id, randomUUID(), 'test'), /passing validation/);
  const failed = await store.validate(m.id, [{ input: sampleV1, expected: { ...expected, systolic: 150 } }]);
  assert.equal(failed.passed, false);
  await assert.rejects(store.approve(m.id, failed.validationId, 'test'), /passing validation/);
  const good = await store.validate(m.id, [{ input: sampleV1, expected }]);
  await store.approve(m.id, good.validationId, 'test-operator');
  const envelope = { source: 'community-simulator', sourceEventId: 'first', sourceVersion: '1', payload: sampleV1, mappingId: m.id };
  const responses = await Promise.all(Array.from({ length: 5 }, () => store.ingest(envelope)));
  assert.equal(responses.filter(r => !r.duplicate).length, 1);
  assert.equal((await store.pool.query('SELECT * FROM records')).rowCount, 2);
  await assert.rejects(store.ingest({ ...envelope, payload: sampleV2 }), /reused/);
  const drifted = await store.ingest({ ...envelope, sourceEventId: 'second', sourceVersion: '2', payload: sampleV2 });
  assert.equal(drifted.event.status, 'quarantined');
  const repair = structuredClone(mappingV1);
  repair.sourceVersion = '2';
  repair.fields.systolic = { path: 'vitals.bp', transform: 'bp-systolic' };
  repair.fields.diastolic = { path: 'vitals.bp', transform: 'bp-diastolic' };
  const m2 = await store.saveMapping(repair);
  await assert.rejects(store.approve(m2.id, good.validationId, 'test'), /passing validation/);
  const valid2 = await store.validate(m2.id, [{ input: sampleV2, expected }]);
  await store.approve(m2.id, valid2.validationId, 'test-operator');
  assert.equal((await store.process(drifted.event.id, m2.id)).status, 'persisted');
  await store.process(drifted.event.id, m2.id);
  assert.equal((await store.pool.query("SELECT * FROM records WHERE resource_type='Observation'")).rowCount, 2);
  await store.deliver(`http://127.0.0.1:${address.port}`);
  assert.equal((await store.pool.query('SELECT sum(attempts)::int AS count FROM outbox')).rows[0].count, 1);
  assert.equal((await store.pool.query("SELECT * FROM outbox WHERE status='delivered'")).rowCount, 0);
  await store.pool.end(); store = new Store(url.href); await store.init();
  assert.equal((await store.pool.query('SELECT * FROM records')).rowCount, 3);
  unavailable = false;
  await store.pool.query('UPDATE outbox SET next_attempt=now()');
  await store.deliver(`http://127.0.0.1:${address.port}`);
  await store.deliver(`http://127.0.0.1:${address.port}`);
  assert.equal((await store.pool.query("SELECT * FROM events WHERE status='delivered'")).rowCount, 2);
  assert.equal(receiverRecords.size, 3);
  // Simulate receipt loss: the receiver already committed, but the sender retries.
  await store.pool.query("UPDATE outbox SET status='pending',next_attempt=now()");
  await store.deliver(`http://127.0.0.1:${address.port}`);
  await store.deliver(`http://127.0.0.1:${address.port}`);
  assert.equal(receiverRecords.size, 3);
  console.log('PASS: PostgreSQL approval gates, concurrent duplicate submissions, conflict detection, schema repair, replay, restart persistence, receiver outage and response-loss retry. Receiver here is an explicit HTTP test double, not OpenMRS.');
} finally {
  receiver.closeAllConnections();
  await new Promise<void>(resolve => receiver.close(() => resolve()));
  await store.pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
}
