import { digest } from './contracts.js';

// Pilot REST adapter for the explicitly supported synthetic blood-pressure exchange.
// It is not a general OpenMRS or FHIR connector.
export function uuid(seed: string) {
  const h = digest(seed);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export class OpenMrs {
  constructor(public base: string, private username: string, private password: string, private prefix = 'OPENMRS') {}
  async request(path: string, body?: unknown, optional = false): Promise<any> {
    const response = await fetch(`${this.base.replace(/\/$/, '')}/${path}`, {
      method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    if (optional && response.status === 404) return null;
    if (!response.ok) throw new Error(`OpenMRS ${path.split('?')[0]} returned HTTP ${response.status}: ${(await response.text()).slice(0, 350)}`);
    return response.json();
  }
  async deliver(bundle: any) {
    const patient = bundle.entry.find((e: any) => e.resource.resourceType === 'Patient')?.resource;
    const observation = bundle.entry.find((e: any) => e.resource.resourceType === 'Observation')?.resource;
    if (!patient || !observation) throw new Error('Expected a patient and observation');
    const identifierType = process.env[`${this.prefix}_IDENTIFIER_TYPE`];
    const location = process.env[`${this.prefix}_LOCATION`];
    const concepts = [process.env[`${this.prefix}_SYSTOLIC_CONCEPT`], process.env[`${this.prefix}_DIASTOLIC_CONCEPT`]];
    if (!identifierType || !location || concepts.some(c => !c)) throw new Error('OpenMRS adapter metadata is not configured');
    const patientUuid = uuid(patient.id);
    let savedPatient = await this.request(`patient/${patientUuid}?v=full`, undefined, true);
    if (!savedPatient) {
      const identifiers = [{ identifier: patient.id, identifierType, location, preferred: false }];
      const types = await this.request('patientidentifiertype?v=full');
      const required = types.results.filter((t: any) => t.required && !t.retired && t.uuid !== identifierType);
      if (required.length) {
        const sources = await this.request('idgen/identifiersource?v=full');
        for (const type of required) {
          const matches = sources.results.filter((s: any) => s.identifierType?.uuid === type.uuid);
          if (matches.length !== 1) throw new Error('Required OpenMRS identifier has no unambiguous generator');
          const generated = await this.request('idgen/identifiersource', { generateIdentifiers: true, sourceUuid: matches[0].uuid, numberToGenerate: 1 });
          if (generated.identifiers?.length !== 1 || typeof generated.identifiers[0] !== 'string') throw new Error('OpenMRS identifier generation failed');
          identifiers.push({ identifier: generated.identifiers[0], identifierType: type.uuid, location, preferred: false });
        }
      }
      identifiers[identifiers.length - 1].preferred = true;
      await this.request('patient', { uuid: patientUuid, person: { uuid: patientUuid,
        names: [{ givenName: 'Synthetic', familyName: 'Patient' }], gender: 'U' },
        identifiers });
      savedPatient = await this.request(`patient/${patientUuid}?v=full`);
    }
    if (!savedPatient.identifiers?.some((i: any) => i.identifier === patient.id && i.identifierType?.uuid === identifierType)) throw new Error('OpenMRS identity collision');
    const receipts = [];
    for (let index = 0; index < 2; index++) {
      const component = observation.component[index];
      const expectedCode = index === 0 ? '8480-6' : '8462-4';
      if (component.code.coding[0].code !== expectedCode || component.valueQuantity.code !== 'mm[Hg]') throw new Error('Unapproved concept or unit mapping');
      const obsUuid = uuid(observation.id + ':' + expectedCode);
      let saved = await this.request(`obs/${obsUuid}?v=full`, undefined, true);
      if (!saved) {
        await this.request('obs', { uuid: obsUuid, person: patientUuid, concept: concepts[index],
          obsDatetime: observation.effectiveDateTime, location, value: component.valueQuantity.value,
          comment: `DPI Health Connect synthetic event ${observation.id}` });
        saved = await this.request(`obs/${obsUuid}?v=full`);
      }
      if (saved.person?.uuid !== patientUuid || saved.concept?.uuid !== concepts[index] || saved.value !== component.valueQuantity.value || Date.parse(saved.obsDatetime) !== Date.parse(observation.effectiveDateTime)) throw new Error('OpenMRS readback mismatch');
      receipts.push({ uuid: obsUuid, value: saved.value, concept: saved.concept.uuid });
    }
    return { kind: 'openmrs-rest', patientUuid, observations: receipts, readbackVerified: true };
  }
  async deliverReferral(bundle: any, referral: { id: string; reason: string; urgency: string; actor: string; created_at: string | Date }) {
    const receipt = await this.deliver(bundle);
    const encounterId = uuid(`referral:${referral.id}`);
    const noteId = uuid(`referral-note:${referral.id}`);
    const encounterType = process.env[`${this.prefix}_REFERRAL_ENCOUNTER_TYPE`];
    const concept = process.env[`${this.prefix}_REFERRAL_NOTE_CONCEPT`];
    const location = process.env[`${this.prefix}_LOCATION`];
    if (!encounterType || !concept || !location) throw new Error('Hospital referral metadata is not configured');
    const note = `Synthetic referral ${referral.id}\nFrom: Binkolo CHC\nTo: Makeni Government Hospital\nUrgency: ${referral.urgency}\nReferring operator: ${referral.actor}\nReason: ${referral.reason}`;
    let encounter = await this.request(`encounter/${encounterId}?v=full`, undefined, true);
    if (!encounter) {
      await this.request('encounter', { uuid: encounterId, patient: receipt.patientUuid, encounterType, location,
        encounterDatetime: new Date(referral.created_at).toISOString(),
        obs: [{ uuid: noteId, concept, value: note }] });
      encounter = await this.request(`encounter/${encounterId}?v=full`);
    }
    const savedNote = await this.request(`obs/${noteId}?v=full`);
    if (encounter.patient?.uuid !== receipt.patientUuid || encounter.encounterType?.uuid !== encounterType || encounter.location?.uuid !== location || savedNote.encounter?.uuid !== encounterId || savedNote.person?.uuid !== receipt.patientUuid || savedNote.concept?.uuid !== concept || savedNote.value !== note) throw new Error('Hospital referral readback mismatch');
    return { ...receipt, encounterUuid: encounterId, referralNoteUuid: noteId, referralReadbackVerified: true };
  }
}
