import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { digest } from './contracts.js';
import type { Store } from './store.js';

export const ReferralInput = z.object({ requestId: z.string().min(1).max(100), eventId: z.string().uuid(),
  reason: z.string().trim().min(10).max(2000), urgency: z.enum(['routine', 'urgent', 'emergency']),
  actor: z.string().trim().min(1).max(100) }).strict();
export class Referrals {
  constructor(private store: Store) {}
  async init() {
    await this.store.pool.query(`CREATE TABLE IF NOT EXISTS referrals (
      id uuid PRIMARY KEY, request_id text UNIQUE NOT NULL, payload_hash text NOT NULL, event_id uuid NOT NULL REFERENCES events(id),
      source text NOT NULL DEFAULT 'binkolo-phu', destination text NOT NULL DEFAULT 'makeni-hospital',
      reason text NOT NULL, urgency text NOT NULL, actor text NOT NULL, status text NOT NULL DEFAULT 'queued',
      bundle jsonb NOT NULL, attempts int NOT NULL DEFAULT 0, next_attempt timestamptz DEFAULT now(), error text, receipt jsonb,
      created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());`);
  }
  async create(raw: unknown) {
    const input = ReferralInput.parse(raw), hash = digest(input), client = await this.store.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = (await client.query('SELECT * FROM referrals WHERE request_id=$1', [input.requestId])).rows[0];
      if (existing) {
        if (existing.payload_hash !== hash) throw new Error('Referral request ID reused with different content');
        await client.query('COMMIT'); return existing;
      }
      const assessment = (await client.query("SELECT o.bundle FROM outbox o JOIN events e ON e.id=o.event_id WHERE e.id=$1 AND e.status='delivered' AND o.status='delivered' AND o.receipt->>'kind'='openmrs-rest'", [input.eventId])).rows[0];
      if (!assessment) throw new Error('PHU delivery must be verified before referral');
      const result = await client.query(`INSERT INTO referrals(id,request_id,payload_hash,event_id,reason,urgency,actor,bundle)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(request_id) DO NOTHING RETURNING *`,
        [randomUUID(), input.requestId, hash, input.eventId, input.reason, input.urgency, input.actor, assessment.bundle]);
      let referral = result.rows[0];
      if (!referral) {
        referral = (await client.query('SELECT * FROM referrals WHERE request_id=$1', [input.requestId])).rows[0];
        if (referral.payload_hash !== hash) throw new Error('Referral request ID reused with different content');
      } else await client.query('INSERT INTO audit(action,subject,detail) VALUES($1,$2,$3)', ['referral-created', referral.id, { actor: input.actor, eventId: input.eventId, destination: 'makeni-hospital' }]);
      await client.query('COMMIT'); return referral;
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
  async transition(id: string, status: 'accepted' | 'completed', actor: string, note: string) {
    const client = await this.store.pool.connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query('SELECT * FROM referrals WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!row) throw new Error('Referral not found');
      if (row.status === status) { await client.query('COMMIT'); return row; }
      const previous = status === 'accepted' ? 'delivered' : 'accepted';
      if (row.status !== previous) throw new Error(`Referral must be ${previous} before ${status}`);
      const result = (await client.query('UPDATE referrals SET status=$2,updated_at=now() WHERE id=$1 RETURNING *', [id, status])).rows[0];
      await client.query('INSERT INTO audit(action,subject,detail) VALUES($1,$2,$3)', [`referral-${status}`, id, { actor, note, source: 'operator-reported in workbench; not an EMR callback' }]);
      await client.query('COMMIT'); return result;
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
  async deliver(adapter: (bundle: unknown, referral: any) => Promise<unknown>) {
    const client = await this.store.pool.connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query("SELECT * FROM referrals WHERE status='queued' AND next_attempt<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];
      if (!row) { await client.query('COMMIT'); return false; }
      try {
        const receipt = await adapter(row.bundle, row);
        await client.query("UPDATE referrals SET status='delivered',receipt=$2,error=NULL,attempts=attempts+1,updated_at=now() WHERE id=$1", [row.id, receipt]);
        await client.query('INSERT INTO audit(action,subject,detail) VALUES($1,$2,$3)', ['referral-hospital-readback-verified', row.id, { destination: row.destination, receipt }]);
      } catch (e) {
        await client.query('UPDATE referrals SET attempts=attempts+1,error=$2,next_attempt=now()+make_interval(secs=>LEAST(300,power(2,LEAST(attempts+1,8))::int)),updated_at=now() WHERE id=$1', [row.id, (e as Error).message]);
      }
      await client.query('COMMIT'); return true;
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
}
