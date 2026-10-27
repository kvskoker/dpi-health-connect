import { z } from 'zod';
import { digest } from './contracts.js';
import { uuid, OpenMrs } from './openmrs.js';
import type { Store } from './store.js';
export const Outcome = z.object({ version: z.literal(1), referralId: z.string().uuid(), status: z.literal('completed'),
  summary: z.string().trim().min(10).max(2000), author: z.string().trim().min(1).max(100),
  followUp: z.object({ due: z.string().date(), instruction: z.string().trim().min(5).max(1000) }).strict() }).strict();

export class Feedback {
  constructor(private store: Store) {}
  async init() {
    await this.store.pool.query(`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS completion_source text;
      CREATE TABLE IF NOT EXISTS hospital_feedback (
        id uuid PRIMARY KEY, referral_id uuid NOT NULL REFERENCES referrals(id), hospital_obs text UNIQUE NOT NULL,
        hospital_encounter text NOT NULL, observed_at timestamptz NOT NULL, payload jsonb NOT NULL, payload_hash text NOT NULL,
        status text NOT NULL DEFAULT 'received', attempts int NOT NULL DEFAULT 0, next_attempt timestamptz DEFAULT now(),
        error text, phu_receipt jsonb, created_at timestamptz DEFAULT now());
      CREATE TABLE IF NOT EXISTS community_followups (
        id uuid PRIMARY KEY, feedback_id uuid UNIQUE NOT NULL REFERENCES hospital_feedback(id), referral_id uuid NOT NULL REFERENCES referrals(id),
        status text NOT NULL DEFAULT 'requested', owner text NOT NULL DEFAULT 'Kamanka community team', due_date date NOT NULL,
        instruction text NOT NULL, created_at timestamptz DEFAULT now());
      CREATE TABLE IF NOT EXISTS feedback_poll_errors (referral_id uuid PRIMARY KEY REFERENCES referrals(id), error text NOT NULL, updated_at timestamptz DEFAULT now());`);
  }
  async capture(referral: any, observation: any) {
    if (observation.voided || observation.person?.uuid !== referral.receipt?.patientUuid || observation.encounter?.uuid !== referral.receipt?.encounterUuid || observation.concept?.uuid !== process.env.HOSPITAL_OPENMRS_OUTCOME_CONCEPT) throw new Error('Hospital feedback identity, encounter or concept mismatch');
    if (!observation.uuid || !Number.isFinite(Date.parse(observation.obsDatetime))) throw new Error('Invalid hospital observation identity/time');
    const payload = Outcome.parse(JSON.parse(observation.value));
    if (payload.referralId !== referral.id) throw new Error('Hospital feedback referral mismatch');
    const hash = digest([payload, observation.obsDatetime]), id = uuid(`hospital-feedback:${observation.uuid}`);
    const client = await this.store.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM referrals WHERE id=$1 FOR UPDATE', [referral.id]);
      const previous = (await client.query('SELECT payload_hash FROM hospital_feedback WHERE hospital_obs=$1', [observation.uuid])).rows[0];
      if (previous) {
        if (previous.payload_hash !== hash) throw new Error('Hospital feedback changed: manual reconciliation required');
        await client.query('COMMIT'); return id;
      }
      await client.query('INSERT INTO hospital_feedback(id,referral_id,hospital_obs,hospital_encounter,observed_at,payload,payload_hash) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, referral.id, observation.uuid, observation.encounter.uuid, observation.obsDatetime, payload, hash]);
      await client.query('INSERT INTO community_followups(id,feedback_id,referral_id,due_date,instruction) VALUES($1,$2,$3,$4,$5)', [uuid(`followup:${id}`), id, referral.id, payload.followUp.due, payload.followUp.instruction]);
      await client.query("UPDATE referrals SET status='completed',completion_source='hospital-openmrs-readback',updated_at=now() WHERE id=$1", [referral.id]);
      await client.query('INSERT INTO audit(action,subject,detail) VALUES($1,$2,$3)', ['hospital-outcome-readback-verified', referral.id, { feedbackId: id, observationUuid: observation.uuid, encounterUuid: observation.encounter.uuid, author: payload.author }]);
      await client.query('COMMIT'); return id;
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
  async poll(hospital: OpenMrs) {
    const concept = process.env.HOSPITAL_OPENMRS_OUTCOME_CONCEPT; if (!concept) return;
    const referrals = (await this.store.pool.query("SELECT * FROM referrals WHERE receipt IS NOT NULL ORDER BY created_at")).rows;
    for (const referral of referrals) {
      try {
        const encounter = await hospital.request(`encounter/${referral.receipt.encounterUuid}?v=full`);
        if (encounter.voided || encounter.patient?.uuid !== referral.receipt.patientUuid) throw new Error('Hospital encounter identity mismatch or voided encounter');
        const known = (await this.store.pool.query('SELECT hospital_obs FROM hospital_feedback WHERE referral_id=$1', [referral.id])).rows;
        for (const previous of known) {
          const existing = await hospital.request(`obs/${previous.hospital_obs}?v=full`);
          await this.capture(referral, existing);
        }
        for (const item of encounter.obs ?? []) if (item.concept?.uuid === concept && !item.voided) {
          const observation = await hospital.request(`obs/${item.uuid}?v=full`); await this.capture(referral, observation);
        }
        await this.store.pool.query('DELETE FROM feedback_poll_errors WHERE referral_id=$1', [referral.id]);
      } catch (e) {
        await this.store.pool.query('INSERT INTO feedback_poll_errors(referral_id,error) VALUES($1,$2) ON CONFLICT(referral_id) DO UPDATE SET error=EXCLUDED.error,updated_at=now()', [referral.id, (e as Error).message]);
      }
    }
  }
  async returnToPhu(phu: OpenMrs) {
    const client = await this.store.pool.connect();
    try {
      await client.query('BEGIN');
      const feedback = (await client.query("SELECT f.*,o.receipt->>'patientUuid' AS patient_uuid FROM hospital_feedback f JOIN referrals r ON r.id=f.referral_id JOIN outbox o ON o.event_id=r.event_id WHERE f.status='received' AND f.next_attempt<=now() ORDER BY f.created_at FOR UPDATE OF f SKIP LOCKED LIMIT 1")).rows[0];
      if (!feedback) { await client.query('COMMIT'); return; }
      try {
        const encounterUuid = uuid(`return-feedback:${feedback.id}`), noteUuid = uuid(`return-note:${feedback.id}`);
        const encounterType = process.env.OPENMRS_FEEDBACK_ENCOUNTER_TYPE, concept = process.env.OPENMRS_OUTCOME_CONCEPT, location = process.env.OPENMRS_LOCATION;
        if (!encounterType || !concept || !location) throw new Error('PHU feedback metadata is not configured');
        const note = JSON.stringify({ source: 'Makeni Government Hospital OpenMRS', hospitalObservation: feedback.hospital_obs, outcome: feedback.payload });
        let encounter = await phu.request(`encounter/${encounterUuid}?v=full`, undefined, true);
        if (!encounter) {
          await phu.request('encounter', { uuid: encounterUuid, patient: feedback.patient_uuid, encounterType, location, encounterDatetime: new Date(feedback.observed_at).toISOString(), obs: [{ uuid: noteUuid, concept, value: note }] });
          encounter = await phu.request(`encounter/${encounterUuid}?v=full`);
        }
        const saved = await phu.request(`obs/${noteUuid}?v=full`);
        if (encounter.voided || saved.voided || encounter.patient?.uuid !== feedback.patient_uuid || encounter.encounterType?.uuid !== encounterType || saved.encounter?.uuid !== encounterUuid || saved.person?.uuid !== feedback.patient_uuid || saved.concept?.uuid !== concept || saved.value !== note) throw new Error('PHU return feedback readback mismatch');
        const receipt = { encounterUuid, noteUuid, patientUuid: feedback.patient_uuid, readbackVerified: true };
        await client.query("UPDATE hospital_feedback SET status='returned',attempts=attempts+1,error=NULL,phu_receipt=$2 WHERE id=$1", [feedback.id, receipt]);
        await client.query('INSERT INTO audit(action,subject,detail) VALUES($1,$2,$3)', ['hospital-feedback-returned-to-phu', feedback.id, receipt]);
      } catch (e) {
        await client.query('UPDATE hospital_feedback SET attempts=attempts+1,error=$2,next_attempt=now()+make_interval(secs=>LEAST(300,power(2,LEAST(attempts+1,8))::int)) WHERE id=$1', [feedback.id, (e as Error).message]);
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
}
