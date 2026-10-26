import type { Mapping, Canonical } from './contracts.js';
export const mappingV1: Mapping = {
  name: 'Community blood pressure v1', sourceSystem: 'community-simulator', sourceVersion: '1',
  fields: {
    patientId: { path: 'clientId', transform: 'copy' }, observedAt: { path: 'measuredAt', transform: 'copy' },
    systolic: { path: 'vitals.systolic', transform: 'number' }, diastolic: { path: 'vitals.diastolic', transform: 'number' },
    unit: { path: 'vitals.unit', transform: 'copy' }
  }
};
export const sampleV1 = { clientId: 'DEMO-AMINATA-001', measuredAt: '2026-10-26T12:00:00Z', vitals: { systolic: 160, diastolic: 106, unit: 'mmHg' } };
export const expected: Canonical = { patientId: 'DEMO-AMINATA-001', observedAt: '2026-10-26T12:00:00Z', systolic: 160, diastolic: 106, unit: 'mmHg' };
export const sampleV2 = { clientId: 'DEMO-AMINATA-001', measuredAt: '2026-10-26T12:00:00Z', vitals: { bp: '160/106', unit: 'mmHg' } };
