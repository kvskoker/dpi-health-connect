import { appendFileSync } from 'node:fs';
import { OpenMrs } from '../src/openmrs.js';
for (const prefix of ['OPENMRS','HOSPITAL_OPENMRS']) {
  const api = new OpenMrs(process.env[`${prefix}_BASE_URL`]!, process.env[`${prefix}_USERNAME`]!, process.env[`${prefix}_PASSWORD`]!, prefix);
  const name = 'DPI synthetic hospital outcome';
  const results = await api.request(`concept?q=${encodeURIComponent(name)}&v=full`);
  let concept = results.results.find((c: any) => !c.retired && c.names?.some((n: any) => n.name === name));
  if (!concept) {
    const datatypes = await api.request('conceptdatatype?v=full'), classes = await api.request('conceptclass?v=full');
    concept = await api.request('concept', { names: [{ name, locale: 'en', conceptNameType: 'FULLY_SPECIFIED', localePreferred: true }], datatype: datatypes.results.find((x: any) => x.name === 'Text').uuid, conceptClass: classes.results.find((x: any) => x.name === 'Misc').uuid });
  }
  if (concept.datatype?.display !== 'Text') throw new Error('Outcome concept must be Text');
  appendFileSync('.env', `\n${prefix}_OUTCOME_CONCEPT=${concept.uuid}\n`);
  if (prefix === 'OPENMRS') {
    const types = await api.request('encountertype?v=full');
    let type = types.results.find((t: any) => !t.retired && t.name === 'DPI hospital feedback');
    if (!type) type = await api.request('encountertype', { name: 'DPI hospital feedback', description: 'Hospital outcome returned through HIE; synthetic pilot' });
    appendFileSync('.env', `OPENMRS_FEEDBACK_ENCOUNTER_TYPE=${type.uuid}\n`);
  }
}
console.log('Hospital outcome and PHU return metadata configured. Credentials were not changed.');
