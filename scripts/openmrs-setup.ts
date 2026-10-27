import { appendFileSync } from 'node:fs';
import { OpenMrs } from '../src/openmrs.js';

const hospital = process.argv.includes('--hospital');
const prefix = hospital ? 'HOSPITAL_OPENMRS' : 'OPENMRS';
const api = new OpenMrs(process.env[`${prefix}_BASE_URL`]!, process.env[`${prefix}_USERNAME`]!, process.env[`${prefix}_PASSWORD`]!, prefix);
const session = await api.request('session');
if (!session.authenticated) throw new Error('OpenMRS authentication failed');
const types = await api.request('patientidentifiertype?v=full');
let type = types.results.find((r: any) => r.name === 'DPI Health Connect synthetic identifier');
if (!type) type = await api.request('patientidentifiertype', { name: 'DPI Health Connect synthetic identifier', description: 'Synthetic hackathon cross-system identifier', required: false, locationBehavior: 'NOT_USED' });
const locations = await api.request('location?v=default');
const facilityName = process.env[`${prefix}_FACILITY_NAME`] ?? (hospital ? 'Makeni Government Hospital' : 'Binkolo CHC');
let location = locations.results.find((r: any) => r.name === facilityName || r.display === facilityName);
if (!location) location = await api.request('location', { name: facilityName, description: 'Synthetic DPI Health Connect demonstration facility' });
const resolved: string[] = [];
for (const name of ['Systolic blood pressure', 'Diastolic blood pressure']) {
  const candidates = await api.request(`concept?q=${encodeURIComponent(name)}&v=full&limit=100`);
  const exact = candidates.results.filter((r: any) => !r.retired && r.datatype?.display === 'Numeric' && r.names?.some((n: any) => n.name.toLowerCase() === name.toLowerCase()));
  if (exact.length !== 1) throw new Error(`Expected one unambiguous numeric concept for ${name}; found ${exact.length}`);
  if (exact[0].units && !/mm\s*hg/i.test(exact[0].units)) throw new Error(`Unexpected units for ${name}`);
  resolved.push(exact[0].uuid);
}
let referralSettings = '';
if (hospital) {
  const encounterTypes = await api.request('encountertype?v=full');
  let encounterType = encounterTypes.results.find((r: any) => r.name === 'DPI synthetic referral');
  if (!encounterType) encounterType = await api.request('encountertype', { name: 'DPI synthetic referral', description: 'Incoming synthetic PHU referral via HIE' });
  const concepts = await api.request('concept?q=DPI%20synthetic%20referral%20note&v=full');
  let note = concepts.results.find((r: any) => !r.retired && r.names?.some((n: any) => n.name === 'DPI synthetic referral note'));
  if (!note) {
    const datatypes = await api.request('conceptdatatype?v=full'), classes = await api.request('conceptclass?v=full');
    const datatype = datatypes.results.find((r: any) => r.name === 'Text');
    const conceptClass = classes.results.find((r: any) => r.name === 'Misc');
    if (!datatype || !conceptClass) throw new Error('Required text concept metadata missing');
    note = await api.request('concept', { names: [{ name: 'DPI synthetic referral note', locale: 'en', conceptNameType: 'FULLY_SPECIFIED', localePreferred: true }], datatype: datatype.uuid, conceptClass: conceptClass.uuid });
  }
  if (note.datatype?.display !== 'Text') throw new Error('Referral note must use Text datatype');
  referralSettings = `${prefix}_REFERRAL_ENCOUNTER_TYPE=${encounterType.uuid}\n${prefix}_REFERRAL_NOTE_CONCEPT=${note.uuid}\n`;
}
appendFileSync('.env', `\n${prefix}_IDENTIFIER_TYPE=${type.uuid}\n${prefix}_LOCATION=${location.uuid}\n${prefix}_SYSTOLIC_CONCEPT=${resolved[0]}\n${prefix}_DIASTOLIC_CONCEPT=${resolved[1]}\n${referralSettings}`);
console.log('OpenMRS pilot metadata resolved and saved locally. No source patient records were read.');
