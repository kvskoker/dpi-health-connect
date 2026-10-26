import Fastify from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Store } from './store.js';
import { proposeMapping } from './meta.js';
import { mappingV1, sampleV1, sampleV2, expected } from './fixtures.js';
import { OpenMrs } from './openmrs.js';

if (!process.env.DATABASE_URL || !process.env.API_TOKEN || process.env.API_TOKEN.length < 24) throw new Error('DATABASE_URL and a random API_TOKEN (24+ characters) are required');
const store = new Store(process.env.DATABASE_URL);
await store.init();
const app = Fastify({ bodyLimit: 128 * 1024, logger: false });
app.addHook('onRequest', async (req, reply) => {
  if (req.url === '/health') return;
  const supplied = Buffer.from(req.headers.authorization ?? ''), expectedToken = Buffer.from(`Bearer ${process.env.API_TOKEN}`);
  if (supplied.length !== expectedToken.length || !timingSafeEqual(supplied, expectedToken)) return reply.code(401).send({ error: 'Unauthorized' });
});
app.setErrorHandler((error: Error, _req, reply) => reply.code(400).send({ error: error.message }));
app.get('/health', async () => { await store.pool.query('SELECT 1'); return { status: 'ok', stage: 'connector-foundation', receiverConfigured: !!(process.env.FHIR_BASE_URL || process.env.OPENMRS_BASE_URL), metaConfigured: !!process.env.MODEL_API_KEY }; });
app.get('/fixtures', async () => ({ mappingV1, sampleV1, sampleV2, expected, source: 'Independent synthetic reference contract; ComEMR compatibility not yet verified' }));
app.post('/mappings', async req => store.saveMapping(req.body));
app.post<{ Params: { id: string } }>('/mappings/:id/validate', async req => {
  const body = z.object({ cases: z.array(z.object({ input: z.unknown(), expected: z.unknown() }).strict()).min(1).max(100) }).strict().parse(req.body);
  return store.validate(req.params.id, body.cases);
});
app.post<{ Params: { id: string } }>('/mappings/:id/approve', async req => {
  const body = z.object({ validationId: z.string().uuid(), actor: z.string().min(1).max(100) }).strict().parse(req.body);
  await store.approve(req.params.id, body.validationId, body.actor); return { approved: true, mappingId: req.params.id };
});
app.post('/simulator/assessments', async req => {
  const body = z.object({ sourceEventId: z.string().min(1).max(100), sourceVersion: z.string().min(1).max(30), mappingId: z.string().regex(/^[a-f0-9]{64}$/), payload: z.record(z.string(), z.unknown()) }).strict().parse(req.body);
  return store.ingest({ ...body, source: 'community-simulator' });
});
app.post<{ Params: { id: string } }>('/events/:id/replay', async req => {
  const body = z.object({ mappingId: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(req.body);
  return store.process(z.string().uuid().parse(req.params.id), body.mappingId);
});
app.get('/events', async () => (await store.pool.query('SELECT * FROM events ORDER BY created_at DESC LIMIT 100')).rows);
app.get('/records', async () => (await store.pool.query('SELECT body FROM records ORDER BY resource_type,id LIMIT 200')).rows.map(r => r.body));
app.get('/audit', async () => (await store.pool.query('SELECT * FROM audit ORDER BY id DESC LIMIT 100')).rows);
let modelBusy = false;
app.post('/meta/propose-mapping', async req => {
  if (modelBusy) throw new Error('A mapping request is already running');
  const body = z.object({ sourceSystem: z.literal('community-simulator'), sourceVersion: z.string().min(1).max(30), sourceSchema: z.record(z.string(), z.unknown()), syntheticExample: z.record(z.string(), z.unknown()), syntheticDataConfirmed: z.literal(true) }).strict().parse(req.body);
  modelBusy = true;
  try {
    const { syntheticDataConfirmed, ...request } = body;
    const proposal = await proposeMapping(request);
    await store.pool.query('INSERT INTO audit(action,subject,detail) VALUES($1,$2,$3)', ['meta-proposal', proposal.evidence.requestId ?? 'unknown', proposal.evidence]);
    return proposal;
  } finally { modelBusy = false; }
});
let delivering = false;
const openmrs = process.env.OPENMRS_BASE_URL && process.env.OPENMRS_USERNAME && process.env.OPENMRS_PASSWORD
  ? new OpenMrs(process.env.OPENMRS_BASE_URL, process.env.OPENMRS_USERNAME, process.env.OPENMRS_PASSWORD) : null;
const timer = setInterval(async () => {
  const receiverUrl = openmrs?.base ?? process.env.FHIR_BASE_URL;
  if (delivering || !receiverUrl) return;
  delivering = true;
  try { await store.deliver(receiverUrl, process.env.FHIR_BEARER_TOKEN, openmrs ? bundle => openmrs.deliver(bundle) : undefined); }
  catch { console.error('Delivery worker failed; pending events remain in the database'); }
  finally { delivering = false; }
}, 2000);
timer.unref();
app.addHook('onClose', async () => { clearInterval(timer); await store.pool.end(); });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => { await app.close(); process.exit(0); });
await app.listen({ host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.PORT ?? 4300) });
console.log(`DPI Health Connect API: http://127.0.0.1:${process.env.PORT ?? 4300}`);
