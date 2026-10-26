import { appendFileSync } from 'node:fs';
import { OpenMrs } from '../src/openmrs.js';

const api = new OpenMrs(process.env.OPENMRS_BASE_URL!, process.env.OPENMRS_USERNAME!, process.env.OPENMRS_PASSWORD!);
const session = await api.request('session');
if (!session.authenticated) throw new Error('OpenMRS authentication failed');
const types = await api.request('patientidentifiertype?v=full');
let type = types.results.find((r: any) => r.name === 'DPI Health Connect synthetic identifier');
if (!type) type = await api.request('patientidentifiertype', { name: 'DPI Health Connect synthetic identifier', description: 'Synthetic hackathon cross-system identifier', required: false, locationBehavior: 'NOT_USED' });
const locations = await api.request('location?v=default');
if (!locations.results.length) throw new Error('No OpenMRS location exists');
const resolved: string[] = [];
for (const name of ['Systolic blood pressure', 'Diastolic blood pressure']) {
  const candidates = await api.request(`concept?q=${encodeURIComponent(name)}&v=full&limit=100`);
  const exact = candidates.results.filter((r: any) => !r.retired && r.datatype?.display === 'Numeric' && r.names?.some((n: any) => n.name.toLowerCase() === name.toLowerCase()));
  if (exact.length !== 1) throw new Error(`Expected one unambiguous numeric concept for ${name}; found ${exact.length}`);
  if (exact[0].units && !/mm\s*hg/i.test(exact[0].units)) throw new Error(`Unexpected units for ${name}`);
  resolved.push(exact[0].uuid);
}
appendFileSync('.env', `\nOPENMRS_IDENTIFIER_TYPE=${type.uuid}\nOPENMRS_LOCATION=${locations.results[0].uuid}\nOPENMRS_SYSTOLIC_CONCEPT=${resolved[0]}\nOPENMRS_DIASTOLIC_CONCEPT=${resolved[1]}\n`);
console.log('OpenMRS pilot metadata resolved and saved locally. No source patient records were read.');
