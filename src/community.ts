import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { digest } from './contracts.js';
import type { Store } from './store.js';

export const CommunityLink = z.object({ sourcePatientId: z.string().min(1), patientId: z.string().min(1), memberId: z.string().min(1), householdId: z.string().min(1), villageId: z.string().min(1), syntheticConfirmed: z.literal(true) }).strict();
export type Link = z.infer<typeof CommunityLink>;
export interface CommunityTransport { request(path: string, body?: unknown): Promise<any>; userId: number; }
export class ComEmr implements CommunityTransport {
  userId = 0;
  private cookie = '';
  private authorization = '';
  private tenant = '0';
  constructor(private base: string, private client = 'web') {
    const url = new URL(base);
    if (!['127.0.0.1','localhost','host.docker.internal'].includes(url.hostname) || url.protocol !== 'http:') throw new Error('This pilot connector only accepts local ComEMR endpoints');
  }
  async login(username: string, password: string, hashKey: string) {
    const form = new FormData(); form.set('username', username); form.set('password', createHmac('sha512', hashKey).update(password).digest('hex'));
    const response = await fetch(this.base + '/auth-service/session', { method: 'POST', headers: { client: this.client, 'App-Version': '3.0.0' }, body: form, redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`ComEMR login HTTP ${response.status}`);
    this.cookie = response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    this.tenant = response.headers.get('tenantid') ?? '0';
    this.authorization = response.headers.get('authorization') ?? '';
    if (!this.cookie && !this.authorization) throw new Error('ComEMR did not return a session');
    const profile = await this.request('/user-service/user/profile');
    this.userId = z.number().int().positive().parse(profile.entity?.id);
    this.tenant = String(profile.entity.tenantId ?? this.tenant);
  }
  async request(path: string, body?: unknown) {
    const response = await fetch(this.base + path, { method: 'POST', redirect: 'error', headers: { Cookie: this.cookie, ...(this.authorization ? { Authorization: this.authorization } : {}), client: this.client, tenantId: this.tenant, 'App-Version': '3.0.0', 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`ComEMR ${path} HTTP ${response.status}`);
    return response.json();
  }
}
export function followupPayload(task: any, link: Link, userId: number) {
  CommunityLink.parse(link);
  if (task.source_patient !== link.sourcePatientId) throw new Error('Community source patient linkage mismatch');
  z.number().int().positive().parse(userId);
  const day = new Date(task.due_date).toISOString().slice(0,10);
  const reason = `[DPI:${task.id}] ${task.instruction}`;
  if (reason.length > 255) throw new Error('ComEMR reason exceeds 255 characters; review instruction without silently truncating it');
  return { memberId: link.memberId, patientId: link.patientId, householdId: link.householdId, villageId: link.villageId, type: 'HH_VISIT', nextVisitDate: day + 'T12:00:00.000Z', reason, provenance: { spiceUserId: userId }, isCompleted: false };
}
export function verifyFollowup(actual: any, expected: any) {
  if (!Number.isSafeInteger(actual?.id) || actual.id < 1) throw new Error('ComEMR returned no follow-up ID');
  for (const key of ['memberId','patientId','householdId','villageId','type','reason']) if (actual[key] !== expected[key]) throw new Error(`ComEMR readback mismatch: ${key}`);
  if (new Date(actual.nextVisitDate).toISOString() !== expected.nextVisitDate) throw new Error('ComEMR due date mismatch');
  return actual.id;
}
export class CommunityDelivery {
  constructor(private store: Store) {}
  async init() {
    await this.store.pool.query(`CREATE TABLE IF NOT EXISTS community_deliveries (
      task_id uuid PRIMARY KEY REFERENCES community_followups(id), state text NOT NULL,
      link jsonb NOT NULL, payload jsonb NOT NULL, receipt jsonb, error text,
      created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      ALTER TABLE community_followups DROP CONSTRAINT IF EXISTS community_followups_feedback_id_key;
      ALTER TABLE community_followups ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'discharge-followup';
      CREATE TABLE IF NOT EXISTS community_outcomes(task_id uuid PRIMARY KEY REFERENCES community_followups(id), receiver_id bigint NOT NULL, body jsonb NOT NULL, body_hash text NOT NULL, received_at timestamptz DEFAULT now());`);
  }
  async poll(api: CommunityTransport) {
    const deliveries = (await this.store.pool.query("SELECT * FROM community_deliveries WHERE receipt IS NOT NULL")).rows;
    for (const delivery of deliveries) {
      try {
        const records = await api.request('/spice-service/follow-up/list', { villageIds: [delivery.link.villageId], lastSyncTime: '1970-01-01T00:00:00.000Z' });
        const record = records.find((r:any) => r.id === delivery.receipt.id);
        if (!record) continue;
        await this.capture(delivery,record);
      } catch(e) { await this.store.pool.query('UPDATE community_deliveries SET error=$2 WHERE task_id=$1',[delivery.task_id,(e as Error).message]); }
    }
  }
  async capture(delivery:any, record:any) {
    verifyFollowup(record,delivery.payload);
    if (record.id !== delivery.receipt.id) throw new Error('ComEMR receiver ID mismatch');
    if (record.isCompleted !== true) return;
    if (record.isDeleted === true || !Number.isSafeInteger(record.visits) || record.visits < 1 || !Number.isFinite(record.updatedAt) || record.updatedAt <= 0) throw new Error('Completion lacks valid visit evidence');
    const body={receiverId:record.id,patientId:record.patientId,memberId:record.memberId,completed:true,visits:record.visits,updatedAt:record.updatedAt,details:record.followUpDetails ?? []};
    const hash=digest(body), db=await this.store.pool.connect();
    try {
      await db.query('BEGIN');
      await db.query('SELECT task_id FROM community_deliveries WHERE task_id=$1 FOR UPDATE',[delivery.task_id]);
      const previous=(await db.query('SELECT body_hash FROM community_outcomes WHERE task_id=$1',[delivery.task_id])).rows[0];
      if(previous) { if(previous.body_hash!==hash) throw new Error('Completed outcome changed; reconciliation required'); await db.query('COMMIT');return; }
      await db.query('INSERT INTO community_outcomes(task_id,receiver_id,body,body_hash) VALUES($1,$2,$3,$4)',[delivery.task_id,record.id,body,hash]);
      await db.query("UPDATE community_followups SET status='completed' WHERE id=$1",[delivery.task_id]);
      await db.query("UPDATE community_deliveries SET error=NULL,updated_at=now() WHERE task_id=$1",[delivery.task_id]);
      await db.query('INSERT INTO audit(action,subject,detail) VALUES($1,$2,$3)',['comemr-visit-completion-readback',delivery.task_id,{receiverId:record.id,hash,method:'ComEMR follow-up list API'}]);
      await db.query('COMMIT');
    }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
  }
  async deliver(taskId: string, link: Link, api: CommunityTransport) {
    const task = (await this.store.pool.query(`SELECT t.*,e.canonical->>'patientId' AS source_patient FROM community_followups t JOIN referrals r ON r.id=t.referral_id JOIN events e ON e.id=r.event_id WHERE t.id=$1`, [z.string().uuid().parse(taskId)])).rows[0];
    if (!task) throw new Error('Unknown community follow-up');
    const payload = followupPayload(task, link, api.userId);
    const previous = (await this.store.pool.query('SELECT * FROM community_deliveries WHERE task_id=$1', [taskId])).rows[0];
    if (previous) {
      if (digest(previous.link) !== digest(link) || digest(previous.payload) !== digest(payload)) throw new Error('Existing task has different ComEMR linkage or payload; review required');
      return previous; // Never replay a non-idempotent create after a response loss.
    }
    const members = await api.request('/spice-service/household/member/list', { villageIds: [link.villageId] });
    const matches = Array.isArray(members) ? members.filter((m:any) => m.id === link.memberId && m.patientId === link.patientId && m.householdId === link.householdId && m.villageId === link.villageId && m.isActive === true) : [];
    if (matches.length !== 1) throw new Error('ComEMR patient/member/household/village link could not be verified');
    const claimed = await this.store.pool.query("INSERT INTO community_deliveries(task_id,state,link,payload) VALUES($1,'sending',$2,$3) ON CONFLICT DO NOTHING RETURNING task_id", [taskId, link, payload]);
    if (!claimed.rowCount) return (await this.store.pool.query('SELECT * FROM community_deliveries WHERE task_id=$1', [taskId])).rows[0];
    try {
      const created = await api.request('/spice-service/follow-up/create', payload);
      const id = verifyFollowup(created, payload);
      await this.store.pool.query("UPDATE community_deliveries SET state='acknowledged',receipt=$2,updated_at=now() WHERE task_id=$1", [taskId, { id, createAcknowledged: true, readbackVerified: false }]);
      const list = await api.request('/spice-service/follow-up/list', { villageIds: [link.villageId] });
      const record = Array.isArray(list) ? list.find((r:any) => r.id === id) : undefined;
      if (record) {
        verifyFollowup(record, payload);
        await this.store.pool.query("UPDATE community_deliveries SET state='verified',receipt=$2,updated_at=now() WHERE task_id=$1", [taskId,{id,createAcknowledged:true,readbackVerified:true}]);
      }
      await this.store.pool.query('INSERT INTO audit(action,subject,detail) VALUES($1,$2,$3)', ['comemr-followup-acknowledged',taskId,{receiverId:id,actor:api.userId}]);
    } catch (e) {
      await this.store.pool.query("UPDATE community_deliveries SET state=CASE WHEN receipt IS NULL THEN 'needs-review' ELSE state END,error=$2,updated_at=now() WHERE task_id=$1", [taskId,(e as Error).message]);
    }
    return (await this.store.pool.query('SELECT * FROM community_deliveries WHERE task_id=$1',[taskId])).rows[0];
  }
}
