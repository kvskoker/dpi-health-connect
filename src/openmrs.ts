import { digest } from './contracts.js';

// Pilot REST adapter for the explicitly supported synthetic blood-pressure exchange.
// It is not a general OpenMRS or FHIR connector.
function uuid(seed: string) {
  const h = digest(seed);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export class OpenMrs {
  constructor(public base: string, private username: string, private password: string) {}
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
    const identifierType = process.env.OPENMRS_IDENTIFIER_TYPE;
    const location = process.env.OPENMRS_LOCATION;
    const concepts = [process.env.OPENMRS_SYSTOLIC_CONCEPT, process.env.OPENMRS_DIASTOLIC_CONCEPT];
    if (!identifierType || !location || concepts.some(c => !c)) throw new Error('OpenMRS adapter metadata is not configured');
    const patientUuid = uuid(patient.id);
    let savedPatient = await this.request(`patient/${patientUuid}?v=full`, undefined, true);
    if (!savedPatient) {
      await this.request('patient', { uuid: patientUuid, person: { uuid: patientUuid,
        names: [{ givenName: 'Synthetic', familyName: 'Patient' }], gender: 'U' },
        identifiers: [{ identifier: patient.id, identifierType, location, preferred: true }] });
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
}
