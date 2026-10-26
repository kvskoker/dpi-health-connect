import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { applyMapping, digest, fhirResources, MappingSchema, type Mapping } from './contracts.js';

export class Store {
  pool: pg.Pool;
  constructor(url: string) { this.pool = new pg.Pool({ connectionString: url }); }
  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS mappings (id text PRIMARY KEY, spec jsonb NOT NULL, approved boolean NOT NULL DEFAULT false, created_at timestamptz DEFAULT now());
      CREATE TABLE IF NOT EXISTS validations (id uuid PRIMARY KEY, mapping_id text REFERENCES mappings(id), passed boolean NOT NULL, result jsonb NOT NULL, created_at timestamptz DEFAULT now());
      CREATE TABLE IF NOT EXISTS events (id uuid PRIMARY KEY, source text NOT NULL, source_event_id text NOT NULL, source_version text NOT NULL,
        payload jsonb NOT NULL, payload_hash text NOT NULL, mapping_id text REFERENCES mappings(id), status text NOT NULL,
        error text, canonical jsonb, created_at timestamptz DEFAULT now(), UNIQUE(source, source_event_id));
      CREATE TABLE IF NOT EXISTS records (resource_type text NOT NULL, id text NOT NULL, body jsonb NOT NULL, PRIMARY KEY(resource_type,id));
      CREATE TABLE IF NOT EXISTS outbox (event_id uuid PRIMARY KEY REFERENCES events(id), bundle jsonb NOT NULL,
        status text NOT NULL DEFAULT 'pending', attempts int NOT NULL DEFAULT 0, next_attempt timestamptz DEFAULT now(), error text, receipt jsonb);
      CREATE TABLE IF NOT EXISTS audit (id bigserial PRIMARY KEY, action text NOT NULL, subject text NOT NULL, detail jsonb NOT NULL, created_at timestamptz DEFAULT now());
    `);
  }
  async saveMapping(input: unknown) {
    const spec = MappingSchema.parse(input), id = digest(spec);
    await this.pool.query('INSERT INTO mappings(id,spec) VALUES($1,$2) ON CONFLICT DO NOTHING', [id, spec]);
    return { id, spec };
  }
  async validate(id: string, cases: { input: unknown; expected: unknown }[]) {
    const { rows } = await this.pool.query('SELECT spec FROM mappings WHERE id=$1', [id]);
    if (!rows[0]) throw new Error('Mapping not found');
    const result = cases.map(test => {
      try { const actual = applyMapping(rows[0].spec, test.input); return { passed: digest(actual) === digest(test.expected), actual, expected: test.expected }; }
      catch (e) { return { passed: false, error: (e as Error).message }; }
    });
    const passed = result.length > 0 && result.every(r => r.passed), validationId = randomUUID();
    await this.pool.query('INSERT INTO validations(id,mapping_id,passed,result) VALUES($1,$2,$3,$4)', [validationId, id, passed, JSON.stringify(result)]);
    return { validationId, passed, result };
  }
  async approve(id: string, validationId: string, actor: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rowCount } = await client.query(`UPDATE mappings SET approved=true WHERE id=$1 AND EXISTS
        (SELECT 1 FROM validations WHERE id=$2 AND mapping_id=$1 AND passed=true)`, [id, validationId]);
      if (!rowCount) throw new Error('A passing validation for this exact mapping is required');
      await client.query('INSERT INTO audit(action,subject,detail) VALUES($1,$2,$3)', ['mapping-approved', id, { actor, validationId }]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
  async ingest(input: { source: string; sourceEventId: string; sourceVersion: string; payload: unknown; mappingId: string }) {
    const { rows } = await this.pool.query(`INSERT INTO events(id,source,source_event_id,source_version,payload,payload_hash,status)
      VALUES($1,$2,$3,$4,$5,$6,'received') ON CONFLICT(source,source_event_id) DO NOTHING RETURNING id`,
      [randomUUID(), input.source, input.sourceEventId, input.sourceVersion, input.payload, digest([input.sourceVersion, input.payload])]);
    if (!rows[0]) {
      const existing = await this.pool.query('SELECT * FROM events WHERE source=$1 AND source_event_id=$2', [input.source, input.sourceEventId]);
      if (existing.rows[0].payload_hash !== digest([input.sourceVersion, input.payload])) throw new Error('Event ID reused with a different payload or version');
      return { duplicate: true, event: existing.rows[0] };
    }
    return { duplicate: false, event: await this.process(rows[0].id, input.mappingId) };
  }
  async process(id: string, mappingId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM events WHERE id=$1 FOR UPDATE', [id]);
      const event = rows[0];
      if (!event) throw new Error('Event not found');
      if (event.status === 'persisted' || event.status === 'delivered') { await client.query('COMMIT'); return event; }
      const mappings = await client.query('SELECT * FROM mappings WHERE id=$1', [mappingId]);
      const m = mappings.rows[0];
      let canonical;
      try {
        if (!m?.approved) throw new Error('Mapping is not approved');
        const spec = m.spec as Mapping;
        if (spec.sourceSystem !== event.source || spec.sourceVersion !== event.source_version) throw new Error('Source system/version does not match mapping');
        canonical = applyMapping(spec, event.payload);
      } catch (e) {
        await client.query("UPDATE events SET status='quarantined',error=$2 WHERE id=$1", [id, (e as Error).message]);
        await client.query('INSERT INTO audit(action,subject,detail) VALUES($1,$2,$3)', ['event-quarantined', id, { mappingId, reason: (e as Error).message }]);
        await client.query('COMMIT');
        return (await this.pool.query('SELECT * FROM events WHERE id=$1', [id])).rows[0];
      }
      const resources = fhirResources(canonical, event.source, event.source_event_id);
      for (const resource of Object.values(resources)) {
        await client.query('INSERT INTO records(resource_type,id,body) VALUES($1,$2,$3) ON CONFLICT(resource_type,id) DO UPDATE SET body=EXCLUDED.body', [resource.resourceType, resource.id, resource]);
      }
      const bundle = { resourceType: 'Bundle', type: 'transaction', entry: Object.values(resources).map(resource => ({
        resource, request: { method: 'PUT', url: `${resource.resourceType}/${resource.id}` }
      })) };
      await client.query('INSERT INTO outbox(event_id,bundle) VALUES($1,$2) ON CONFLICT DO NOTHING', [id, bundle]);
      await client.query("UPDATE events SET status='persisted',canonical=$2,mapping_id=$3,error=NULL WHERE id=$1", [id, canonical, mappingId]);
      await client.query('INSERT INTO audit(action,subject,detail) VALUES($1,$2,$3)', ['event-persisted', id, { mappingId, resourceIds: Object.values(resources).map(r => r.id) }]);
      await client.query('COMMIT');
      return (await this.pool.query('SELECT * FROM events WHERE id=$1', [id])).rows[0];
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
  async deliver(baseUrl: string, bearer?: string, adapter?: (bundle: unknown) => Promise<unknown>) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query("SELECT * FROM outbox WHERE status='pending' AND next_attempt<=now() ORDER BY next_attempt FOR UPDATE SKIP LOCKED LIMIT 1");
      if (!rows[0]) { await client.query('COMMIT'); return false; }
      const item = rows[0];
      try {
        let receipt: any;
        if (adapter) {
          receipt = await adapter(item.bundle);
        } else {
        const response = await fetch(baseUrl, { method: 'POST', headers: { 'Content-Type': 'application/fhir+json', Accept: 'application/fhir+json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(item.bundle), signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error(`Receiver returned HTTP ${response.status}`);
        receipt = await response.json();
        if (receipt.resourceType !== 'Bundle' || receipt.type !== 'transaction-response' || receipt.entry?.length !== item.bundle.entry.length || !receipt.entry.every((r: any) => /^2\d\d\b/.test(r.response?.status ?? ''))) throw new Error('Receiver did not confirm every transaction entry');
        // A receipt alone is not sufficient proof: verify values at the destination.
        for (const entry of item.bundle.entry) {
          const check = await fetch(`${baseUrl.replace(/\/$/, '')}/${entry.request.url}`, { headers: { Accept: 'application/fhir+json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) }, signal: AbortSignal.timeout(10000) });
          if (!check.ok) throw new Error('Receiver readback failed');
          const saved: any = await check.json();
          if (saved.id !== entry.resource.id || saved.resourceType !== entry.resource.resourceType) throw new Error('Receiver resource identity mismatch');
          if (saved.resourceType === 'Observation' && (digest(saved.component) !== digest(entry.resource.component) || saved.subject?.reference !== entry.resource.subject.reference || saved.effectiveDateTime !== entry.resource.effectiveDateTime)) throw new Error('Receiver observation values differ');
        }
        }
        await client.query("UPDATE outbox SET status='delivered',attempts=attempts+1,receipt=$2,error=NULL WHERE event_id=$1", [item.event_id, receipt]);
        await client.query("UPDATE events SET status='delivered' WHERE id=$1", [item.event_id]);
        await client.query('INSERT INTO audit(action,subject,detail) VALUES($1,$2,$3)', ['delivery-readback-verified', item.event_id, { receiver: new URL(baseUrl).origin }]);
      } catch (e) {
        await client.query("UPDATE outbox SET attempts=attempts+1,error=$2,next_attempt=now()+make_interval(secs=>LEAST(300,power(2,attempts+1)::int)) WHERE event_id=$1", [item.event_id, (e as Error).message]);
      }
      await client.query('COMMIT'); return true;
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
}
