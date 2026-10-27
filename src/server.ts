import Fastify from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Store } from './store.js';
import { proposeMapping } from './meta.js';
import { mappingV1, sampleV1, sampleV2, expected } from './fixtures.js';
import { OpenMrs } from './openmrs.js';
import { installWorkbench } from './workbench.js';
import { Referrals } from './referrals.js';
import { CompletionRepairs } from './completion-repairs.js';
import { proposeCompletionMap } from './completion-mapping.js';
import { CommunityDelivery, ComEmr } from './community.js';
import { Feedback } from './feedback.js';
import { Longitudinal } from './longitudinal.js';

if (!process.env.DATABASE_URL || !process.env.API_TOKEN || process.env.API_TOKEN.length < 24) throw new Error('DATABASE_URL and a random API_TOKEN (24+ characters) are required');
const store = new Store(process.env.DATABASE_URL);
await store.init();
const referrals = new Referrals(store);
await referrals.init();
const feedback = new Feedback(store);
await feedback.init();
const community = new CommunityDelivery(store);
await community.init();
const completionRepairs = new CompletionRepairs(store);
await completionRepairs.init();
const longitudinal = new Longitudinal(store);
await longitudinal.init();
const app = Fastify({ bodyLimit: 128 * 1024, logger: false });
const workbench = await installWorkbench(app, store);
app.addHook('onRequest', async (req, reply) => {
  if (workbench.publicPath(req.url)) return;
  if (workbench.authorized(req)) return;
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
app.get('/mappings', async () => (await store.pool.query('SELECT * FROM mappings ORDER BY created_at DESC LIMIT 100')).rows);
app.get('/deliveries', async () => (await store.pool.query('SELECT event_id,status,attempts,next_attempt,error,receipt FROM outbox ORDER BY next_attempt DESC LIMIT 100')).rows);
app.get('/referrals', async () => (await store.pool.query('SELECT id,request_id,event_id,source,destination,reason,urgency,actor,status,completion_source,attempts,next_attempt,error,receipt,created_at,updated_at FROM referrals ORDER BY created_at DESC LIMIT 100')).rows);
app.get('/feedback', async () => ({ communityOutcomes: (await store.pool.query('SELECT task_id,receiver_id,body,received_at FROM community_outcomes ORDER BY received_at DESC LIMIT 100')).rows, communityDeliveries: (await store.pool.query('SELECT task_id,state,receipt,error,updated_at FROM community_deliveries ORDER BY created_at DESC LIMIT 100')).rows, outcomes: (await store.pool.query('SELECT * FROM hospital_feedback ORDER BY created_at DESC LIMIT 100')).rows, followups: (await store.pool.query('SELECT * FROM community_followups ORDER BY created_at DESC LIMIT 100')).rows, errors: (await store.pool.query('SELECT * FROM feedback_poll_errors')).rows }));
app.post('/referrals', async req => referrals.create(req.body));
app.get('/clients', async () => (await store.pool.query('SELECT * FROM longitudinal_sync ORDER BY updated_at DESC')).rows);
app.get<{ Params: { id: string } }>('/clients/:id/timeline', async req => longitudinal.timeline(z.string().regex(/^[A-Za-z0-9.-]{1,64}$/).parse(req.params.id)));
app.post<{ Params: { id: string } }>('/referrals/:id/status', async req => {
  const body = z.object({ status: z.enum(['accepted', 'completed']), actor: z.string().trim().min(1).max(100), note: z.string().trim().min(3).max(2000) }).strict().parse(req.body);
  return referrals.transition(z.string().uuid().parse(req.params.id), body.status, body.actor, body.note);
});
app.get('/completion-repairs', async () => (await store.pool.query('SELECT * FROM completion_repairs ORDER BY created_at DESC LIMIT 50')).rows);
app.get('/completion-repairs/tasks', async () => (await store.pool.query('SELECT o.task_id,o.receiver_id,t.purpose FROM community_outcomes o JOIN community_followups t ON t.id=o.task_id ORDER BY o.received_at DESC')).rows);
app.post('/completion-repairs', async req => completionRepairs.create(z.object({taskId:z.string().uuid()}).strict().parse(req.body).taskId));
app.post<{Params:{id:string}}>('/completion-repairs/:id/validate', async req => {const b=z.object({mapping:z.unknown()}).strict().parse(req.body);return completionRepairs.validate(z.string().uuid().parse(req.params.id),b.mapping);});
app.post<{Params:{id:string}}>('/completion-repairs/:id/approve', async req => {const b=z.object({mapping:z.unknown(),validationId:z.string().uuid(),actor:z.string().trim().min(1).max(100)}).strict().parse(req.body);return completionRepairs.approve(z.string().uuid().parse(req.params.id),b.validationId,b.mapping,b.actor);});
app.post<{Params:{id:string}}>('/completion-repairs/:id/replay', async req => {const b=z.object({mapping:z.unknown(),validationId:z.string().uuid()}).strict().parse(req.body);return completionRepairs.replay(z.string().uuid().parse(req.params.id),b.validationId,b.mapping,async delivery=>{
 const api=new ComEmr(process.env.COMEMR_BASE_URL!,'mob');await api.login(process.env.COMEMR_USERNAME!,process.env.COMEMR_PASSWORD!,process.env.COMEMR_PASSWORD_HASH_KEY??'spice_uat');
 const records=await api.request('/spice-service/follow-up/list',{villageIds:[delivery.link.villageId],lastSyncTime:'1970-01-01T00:00:00.000Z'});const record=records.find((r:any)=>r.id===delivery.receipt.id);if(!record)throw new Error('Completion not available from ComEMR');return record;
});});
app.post<{Params:{id:string}}>('/completion-repairs/:id/propose', async req => {
 const id=z.string().uuid().parse(req.params.id);await completionRepairs.get(id);
 if(modelBusy)throw new Error('A Meta request is already running');modelBusy=true;
 try {const result=await proposeCompletionMap({taskKey:7001,person:{patientKey:'DEMO-PATIENT',memberKey:'DEMO-MEMBER'},result:{done:true,visitCount:1,changedAt:1793059200000}});
 await store.pool.query('UPDATE completion_repairs SET proposal=$2 WHERE id=$1',[id,result]);return result;
 }finally{modelBusy=false;}
});
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
let communityBusy = false;
let communityApi: ComEmr | null = null;
const communityTimer = setInterval(async () => {
  if (communityBusy || !process.env.COMEMR_USERNAME || !process.env.COMEMR_PASSWORD || !process.env.COMEMR_BASE_URL) return;
  communityBusy = true;
  try {
    if (!communityApi) { communityApi = new ComEmr(process.env.COMEMR_BASE_URL, process.env.COMEMR_CLIENT ?? 'mob'); await communityApi.login(process.env.COMEMR_USERNAME,process.env.COMEMR_PASSWORD,process.env.COMEMR_PASSWORD_HASH_KEY ?? 'spice_uat'); }
    await community.poll(communityApi);
  } catch { communityApi = null; console.error('Community outcome polling deferred'); }
  finally { communityBusy = false; }
},30000);
communityTimer.unref();
let delivering = false;
let syncing = false;
const sharedTimer = setInterval(async () => {
  if (syncing || !process.env.OPENCR_URL || !process.env.SHR_URL) return;
  syncing = true;
  try { await longitudinal.sync(); } catch { console.error('Shared record synchronization deferred'); } finally { syncing = false; }
}, 10000);
sharedTimer.unref();
const openmrs = process.env.OPENMRS_BASE_URL && process.env.OPENMRS_USERNAME && process.env.OPENMRS_PASSWORD
  ? new OpenMrs(process.env.OPENMRS_BASE_URL, process.env.OPENMRS_USERNAME, process.env.OPENMRS_PASSWORD) : null;
const hospital = process.env.HOSPITAL_OPENMRS_BASE_URL && process.env.HOSPITAL_OPENMRS_USERNAME && process.env.HOSPITAL_OPENMRS_PASSWORD
  ? new OpenMrs(process.env.HOSPITAL_OPENMRS_BASE_URL, process.env.HOSPITAL_OPENMRS_USERNAME, process.env.HOSPITAL_OPENMRS_PASSWORD, 'HOSPITAL_OPENMRS') : null;
let feedbackBusy = false;
const feedbackTimer = setInterval(async () => {
  if (feedbackBusy || !hospital || !openmrs) return;
  feedbackBusy = true;
  try { await feedback.poll(hospital); await feedback.returnToPhu(openmrs); }
  catch { console.error('Hospital feedback worker deferred; records retained'); }
  finally { feedbackBusy = false; }
}, 10000);
feedbackTimer.unref();
let referring = false;
const referralTimer = setInterval(async () => {
  if (referring || !hospital) return;
  referring = true;
  try { await referrals.deliver((bundle, referral) => hospital.deliverReferral(bundle, referral)); }
  catch { console.error('Referral worker failed; queued referrals are retained'); }
  finally { referring = false; }
}, 2000);
referralTimer.unref();
const timer = setInterval(async () => {
  const receiverUrl = openmrs?.base ?? process.env.FHIR_BASE_URL;
  if (delivering || !receiverUrl) return;
  delivering = true;
  try { await store.deliver(receiverUrl, process.env.FHIR_BEARER_TOKEN, openmrs ? bundle => openmrs.deliver(bundle) : undefined); }
  catch { console.error('Delivery worker failed; pending events remain in the database'); }
  finally { delivering = false; }
}, 2000);
timer.unref();
app.addHook('onClose', async () => { clearInterval(timer); clearInterval(communityTimer); clearInterval(referralTimer); clearInterval(sharedTimer); clearInterval(feedbackTimer); await store.pool.end(); });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => { await app.close(); process.exit(0); });
await app.listen({ host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.PORT ?? 4300) });
console.log(`DPI Health Connect API: http://127.0.0.1:${process.env.PORT ?? 4300}`);
