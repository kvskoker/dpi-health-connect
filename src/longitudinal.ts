import https from 'node:https';
import { readFileSync } from 'node:fs';
import type { Store } from './store.js';
import { digest } from './contracts.js';

export class Longitudinal {
  constructor(private store: Store) {}
  async init() {
    await this.store.pool.query(`CREATE TABLE IF NOT EXISTS longitudinal_sync (
      source_patient text PRIMARY KEY, registry_id text, snapshot_hash text, status text NOT NULL DEFAULT 'pending',
      error text, synced_at timestamptz, updated_at timestamptz DEFAULT now());`);
  }
  registry(path: string, method = 'GET', body?: unknown): Promise<{ data: any; headers: any }> {
    return new Promise((resolve, reject) => {
      const root = process.env.OPENCR_CERT_DIR ?? '/run/opencr';
      const request = https.request(`${process.env.OPENCR_URL}/${path}`, {
        method, ca: readFileSync(`${root}/server_cert.pem`), cert: readFileSync(`${root}/client_cert.pem`), key: readFileSync(`${root}/client_key.pem`),
        headers: { 'Content-Type': 'application/fhir+json', 'x-openhim-clientid': 'dpi-core' }, timeout: 30000
      }, response => {
        let text = ''; response.on('data', chunk => text += chunk);
        response.on('end', () => {
          if (!response.statusCode || response.statusCode >= 300) return reject(new Error(`Client Registry HTTP ${response.statusCode}: ${text.slice(0, 200)}`));
          try { resolve({ data: JSON.parse(text), headers: response.headers }); } catch { reject(new Error('Client Registry returned invalid JSON')); }
        });
      });
      request.on('timeout', () => request.destroy(new Error('Client Registry timed out'))); request.on('error', reject);
      if (body) request.write(JSON.stringify(body)); request.end();
    });
  }
  async shr(path: string, method = 'GET', body?: unknown) {
    const response = await fetch(`${process.env.SHR_URL}/${path}`, { method, headers: { 'Content-Type': 'application/fhir+json', 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(30000), ...(body ? { body: JSON.stringify(body) } : {}) });
    const result: any = await response.json();
    if (!response.ok) throw new Error(`Shared Health Record HTTP ${response.status}: ${JSON.stringify(result).slice(0, 250)}`);
    return result;
  }
  async sync() {
    const lock = await this.store.pool.connect();
    const acquired = (await lock.query("SELECT pg_try_advisory_lock(hashtext('dpi-longitudinal-sync')) AS acquired")).rows[0].acquired;
    if (!acquired) { lock.release(); return; }
    try { await this.syncPatients(); }
    finally { await lock.query("SELECT pg_advisory_unlock(hashtext('dpi-longitudinal-sync'))"); lock.release(); }
  }
  private async syncPatients() {
    const events = (await this.store.pool.query(`SELECT e.*,o.bundle,o.receipt FROM events e JOIN outbox o ON o.event_id=e.id WHERE e.status IN ('persisted','delivered') ORDER BY e.created_at`)).rows;
    const referrals = (await this.store.pool.query('SELECT * FROM referrals ORDER BY created_at')).rows;
    const feedback = (await this.store.pool.query('SELECT f.*,t.id AS task_id,t.owner,t.due_date,t.instruction,t.status AS visit_status,t.purpose,c.body AS completion,d.state AS community_state,d.link AS community_link,d.receipt AS community_receipt FROM hospital_feedback f JOIN community_followups t ON t.feedback_id=f.id LEFT JOIN community_deliveries d ON d.task_id=t.id LEFT JOIN community_outcomes c ON c.task_id=t.id')).rows;
    const groups = new Map<string, any[]>();
    for (const event of events) {
      const sourcePatient = event.bundle.entry.find((e: any) => e.resource.resourceType === 'Patient').resource;
      const group = groups.get(sourcePatient.id) ?? []; group.push(event); groups.set(sourcePatient.id, group);
    }
    for (const [key, assessments] of groups) {
      const related = referrals.filter(r => assessments.some(e => e.id === r.event_id));
      const outcomes = feedback.filter(f => related.some(r => r.id === f.referral_id));
      const snapshot = digest([outcomes,assessments.map(e => [e.id,e.status,e.canonical,e.receipt]), related.map(r => [r.id,r.status,r.reason,r.urgency,r.receipt,r.updated_at])]);
      const previous = (await this.store.pool.query('SELECT * FROM longitudinal_sync WHERE source_patient=$1', [key])).rows[0];
      if (previous?.status === 'synced' && previous.snapshot_hash === snapshot) continue;
      await this.store.pool.query("INSERT INTO longitudinal_sync(source_patient) VALUES($1) ON CONFLICT(source_patient) DO UPDATE SET status='pending',error=NULL", [key]);
      try {
        const sourcePatient = structuredClone(assessments[0].bundle.entry.find((e: any) => e.resource.resourceType === 'Patient').resource);
        const identifiers = [...sourcePatient.identifier];
        for (const event of assessments) if (event.receipt?.patientUuid) identifiers.push({ system: 'urn:dpi-h:patient:binkolo-phu', value: event.receipt.patientUuid });
        for (const referral of related) if (referral.receipt?.patientUuid) identifiers.push({ system: 'urn:dpi-h:patient:makeni-hospital', value: referral.receipt.patientUuid });
        for (const outcome of outcomes) if (outcome.community_state === 'verified') identifiers.push({ system: 'urn:dpi-h:patient:comemr', value: outcome.community_link.patientId });
        sourcePatient.identifier = [...new Map(identifiers.map(i => [`${i.system}|${i.value}`, i])).values()];
        const existing = await this.registry(`Patient?identifier=${encodeURIComponent(sourcePatient.identifier[0].system + '|' + sourcePatient.identifier[0].value)}`);
        const matches = (existing.data.entry ?? []).filter((e: any) => e.resource?.identifier?.some((i: any) => i.system === sourcePatient.identifier[0].system && i.value === sourcePatient.identifier[0].value));
        if (matches.length > 1) throw new Error('Identity conflict: multiple registry records; manual review required');
        if (matches[0]) sourcePatient.id = matches[0].resource.id;
        const saved = await this.registry(`Patient/${sourcePatient.id}`, 'PUT', sourcePatient);
        const readback = await this.registry(`Patient/${saved.data.id.replace('Patient/', '')}`);
        const golden = String(saved.headers.locationcruid ?? readback.data.link?.find((l: any) => l.type === 'refer')?.other?.reference ?? '').replace('Patient/', '');
        if (!/^[A-Za-z0-9.-]{1,64}$/.test(golden)) throw new Error('Client Registry did not resolve a shared identity');
        for (const identifier of sourcePatient.identifier) if (!readback.data.identifier?.some((i: any) => i.system === identifier.system && i.value === identifier.value)) throw new Error('Registry identifier readback mismatch');
        if (previous?.registry_id && previous.registry_id !== golden) throw new Error('Registry identity changed: manual reconciliation required before updating SHR');
        const patient = { resourceType: 'Patient', id: golden, active: true, identifier: [{ system: 'urn:dpi-h:client-registry', value: golden }, ...sourcePatient.identifier], meta: { source: 'urn:dpi-h:client-registry' } };
        const resources: any[] = [patient];
        for (const event of assessments) {
          const observation = structuredClone(event.bundle.entry.find((e: any) => e.resource.resourceType === 'Observation').resource);
          observation.subject = { reference: `Patient/${golden}` }; observation.meta = { source: `urn:dpi-h:source:${event.source}` };
          resources.push(observation, { resourceType: 'Provenance', id: `prov-${event.id}`, target: [{ reference: `Observation/${observation.id}` }], recorded: new Date(event.created_at).toISOString(), agent: [{ who: { identifier: { system: 'urn:dpi-h:system', value: event.source } } }], entity: [{ role: 'source', what: { identifier: { system: 'urn:dpi-h:event', value: event.id } } }] });
        }
        for (const referral of related) {
          resources.push({ resourceType: 'ServiceRequest', id: referral.id, status: referral.status === 'completed' ? 'completed' : 'active', intent: 'order', priority: referral.urgency === 'emergency' ? 'stat' : referral.urgency,
            subject: { reference: `Patient/${golden}` }, authoredOn: new Date(referral.created_at).toISOString(), code: { text: 'Synthetic hospital referral' }, reasonCode: [{ text: referral.reason }],
            requester: { display: 'Binkolo CHC' }, performer: [{ display: 'Makeni Government Hospital' }], meta: { source: referral.completion_source === 'hospital-openmrs-readback' ? 'urn:dpi-h:source:makeni-hospital' : 'urn:dpi-h:workbench:operator-reported' } });
          resources.push({ resourceType: 'Task', id: `handover-${referral.id}`, status: ({ queued: 'requested', delivered: 'received', accepted: 'accepted', completed: 'completed' } as any)[referral.status], intent: 'order', focus: { reference: `ServiceRequest/${referral.id}` }, for: { reference: `Patient/${golden}` }, lastModified: new Date(referral.updated_at).toISOString(), businessStatus: { text: referral.completion_source === 'hospital-openmrs-readback' ? 'Hospital outcome verified from OpenMRS' : referral.status === 'delivered' ? 'Hospital API readback verified; clinical acceptance not implied' : `${referral.status}; acceptance/completion are workbench operator reports` }, meta: { source: 'urn:dpi-h:care-coordination' } });
        }
        for (const outcome of outcomes) {
          resources.push({ resourceType: 'Observation', id: `outcome-${outcome.id}`, status: 'final', code: { text: 'Hospital care outcome' }, subject: { reference: `Patient/${golden}` }, effectiveDateTime: new Date(outcome.observed_at).toISOString(), valueString: outcome.payload.summary, identifier: [{ system: 'urn:dpi-h:makeni:observation', value: outcome.hospital_obs }], meta: { source: 'urn:dpi-h:source:makeni-hospital' } });
          resources.push({ resourceType: 'Task', id: outcome.task_id, status: outcome.visit_status === 'completed' ? 'completed' : 'requested', intent: 'order', focus: { reference: `ServiceRequest/${outcome.referral_id}` }, for: { reference: `Patient/${golden}` }, owner: { display: outcome.owner }, description: outcome.instruction, restriction: { period: { end: new Date(outcome.due_date).toISOString().slice(0,10) + 'T23:59:59Z' } }, businessStatus: { text: outcome.completion ? 'Synthetic community visit completed; ComEMR API readback verified' : outcome.community_state === 'verified' ? 'ComEMR follow-up persisted; verified by ' + outcome.community_receipt.readbackMethod + '; visit not completed' : outcome.community_state === 'acknowledged' ? 'ComEMR acknowledged; independent readback pending' : 'Community follow-up requested; delivery to ComEMR pending' }, meta: { source: 'urn:dpi-h:care-coordination' } });
          resources.push({ resourceType: 'Provenance', id: `outcome-${outcome.id}`, target: [{ reference: `Observation/outcome-${outcome.id}` }], recorded: new Date(outcome.created_at).toISOString(), agent: [{ who: { display: outcome.payload.author } }], entity: [{ role: 'source', what: { identifier: { system: 'urn:dpi-h:makeni:observation', value: outcome.hospital_obs } } }] });
        }
        for (const outcome of outcomes) if (outcome.completion) resources.push({ resourceType:'Observation', id:`visit-${outcome.task_id}`, status:'final', code:{text:'Synthetic community follow-up completion'}, subject:{reference:`Patient/${golden}`}, effectiveDateTime:new Date(outcome.completion.updatedAt).toISOString(), valueString:`Completed community visit; ${outcome.completion.visits} recorded visit(s). Integration rehearsal; not the six-week postnatal appointment.`, meta:{source:'urn:dpi-h:source:comemr'} });
        const unique = new Map(resources.map(r=>[`${r.resourceType}/${r.id}`,r]));
        resources.splice(0,resources.length,...unique.values());
        for (const resource of resources) if (resource.meta?.source) resource.meta.tag = [{ system: 'urn:dpi-h:record-source', code: resource.meta.source }];
        const response = await this.shr('', 'POST', { resourceType: 'Bundle', type: 'transaction', entry: resources.map(resource => ({ resource, request: { method: 'PUT', url: `${resource.resourceType}/${resource.id}` } })) });
        if (response.type !== 'transaction-response' || response.entry?.length !== resources.length || response.entry.some((e: any) => !/^2\d\d/.test(e.response?.status))) throw new Error('SHR did not confirm transaction');
        const savedPatient = await this.shr(`Patient/${golden}`);
        if (savedPatient.id !== golden) throw new Error('SHR patient readback mismatch');
        for (const resource of resources) {
          const actual = await this.shr(`${resource.resourceType}/${resource.id}`);
          if (resource.meta?.source && actual.meta?.source !== resource.meta.source) throw new Error('SHR source provenance readback mismatch');
          for (const field of ['valueString','description','restriction','identifier','component','subject','effectiveDateTime','reasonCode','status','for','focus','businessStatus','target','entity']) {
            if (resource[field] !== undefined && digest(resource[field]) !== digest(actual[field])) throw new Error(`SHR readback mismatch for ${resource.resourceType}.${field}`);
          }
        }
        await this.store.pool.query("UPDATE longitudinal_sync SET registry_id=$2,snapshot_hash=$3,status='synced',error=NULL,synced_at=now(),updated_at=now() WHERE source_patient=$1", [key, golden, snapshot]);
        await this.store.pool.query('INSERT INTO audit(action,subject,detail) VALUES($1,$2,$3)', ['shared-record-synchronized', golden, { resourceCount: resources.length, snapshot }]);
      } catch (e) { await this.store.pool.query("UPDATE longitudinal_sync SET status='error',error=$2,updated_at=now() WHERE source_patient=$1", [key, (e as Error).message]); }
    }
  }
  async timeline(id: string) {
    const patient = await this.shr(`Patient/${id}`);
    const searches = await Promise.all(['Observation?subject=', 'ServiceRequest?subject=', 'Task?patient='].map(query => this.shr(`${query}Patient/${id}&_count=100`)));
    await this.store.pool.query('INSERT INTO audit(action,subject,detail) VALUES($1,$2,$3)', ['shared-record-read', id, { actor: 'local-workbench-operator' }]);
    return { patient, resources: searches.flatMap(b => (b.entry ?? []).map((e: any) => e.resource)), truncated: searches.some(b => b.link?.some((l: any) => l.relation === 'next')), source: 'Read from the separate HAPI FHIR Shared Health Record' };
  }
}
