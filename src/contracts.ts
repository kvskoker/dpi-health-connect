import { z } from 'zod';
import { createHash } from 'node:crypto';

const path = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/)
  .refine(s => !s.split('.').some(p => ['constructor', 'prototype', '__proto__'].includes(p)), 'Unsafe path');
const binding = z.object({ path, transform: z.enum(['copy', 'number', 'bp-systolic', 'bp-diastolic']) }).strict();
export const MappingSchema = z.object({
  name: z.string().min(1).max(100), sourceSystem: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  sourceVersion: z.string().min(1).max(30),
  fields: z.object({ patientId: binding, observedAt: binding, systolic: binding, diastolic: binding, unit: binding }).strict()
}).strict();
export type Mapping = z.infer<typeof MappingSchema>;
export const CanonicalSchema = z.object({
  patientId: z.string().min(1).max(100), observedAt: z.string().datetime({ offset: true }),
  systolic: z.number().finite().positive().max(400), diastolic: z.number().finite().positive().max(300),
  unit: z.literal('mmHg')
}).strict().refine(x => x.systolic > x.diastolic, 'Systolic must exceed diastolic');
export type Canonical = z.infer<typeof CanonicalSchema>;

export function digest(value: unknown): string {
  const stable = (x: any): any => Array.isArray(x) ? x.map(stable) : x && typeof x === 'object'
    ? Object.fromEntries(Object.keys(x).sort().map(k => [k, stable(x[k])])) : x;
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

export function applyMapping(raw: unknown, input: unknown): Canonical {
  const mapping = MappingSchema.parse(raw);
  const output: Record<string, unknown> = {};
  for (const [target, field] of Object.entries(mapping.fields)) {
    let value: any = input;
    for (const segment of field.path.split('.')) {
      if (!value || typeof value !== 'object' || !Object.hasOwn(value, segment)) throw new Error(`Missing source field: ${field.path}`);
      value = value[segment];
    }
    if (field.transform === 'number') {
      if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+(\.\d+)?$/.test(value))) throw new Error(`Invalid number: ${field.path}`);
      value = Number(value);
    } else if (field.transform.startsWith('bp-')) {
      if (typeof value !== 'string' || !/^\d{2,3}\/\d{2,3}$/.test(value)) throw new Error('Expected explicit systolic/diastolic pair');
      value = Number(value.split('/')[field.transform === 'bp-systolic' ? 0 : 1]);
    }
    output[target] = value;
  }
  return CanonicalSchema.parse(output);
}

export function fhirResources(data: Canonical, sourceSystem: string, eventId: string) {
  const patient = `p-${digest([sourceSystem, data.patientId]).slice(0, 32)}`;
  const observation = `o-${digest([sourceSystem, eventId]).slice(0, 32)}`;
  const resource = {
    resourceType: 'Observation', id: observation, status: 'final',
    identifier: [{ system: `urn:dpi-h:event:${sourceSystem}`, value: eventId }],
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs' }] }],
    code: { coding: [{ system: 'http://loinc.org', code: '85354-9', display: 'Blood pressure panel with all children optional' }] },
    subject: { reference: `Patient/${patient}` }, effectiveDateTime: data.observedAt,
    component: [ ['8480-6', data.systolic], ['8462-4', data.diastolic] ].map(([code, value]) => ({
      code: { coding: [{ system: 'http://loinc.org', code }] },
      valueQuantity: { value, unit: 'mmHg', system: 'http://unitsofmeasure.org', code: 'mm[Hg]' }
    }))
  };
  return { patient: { resourceType: 'Patient', id: patient, identifier: [{ system: `urn:dpi-h:patient:${sourceSystem}`, value: data.patientId }] }, observation: resource };
}
