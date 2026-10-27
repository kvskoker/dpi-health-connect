import { mkdirSync, writeFileSync } from 'node:fs';
import { proposeMapping } from '../src/meta.js';
import { sampleV2, expected } from '../src/fixtures.js';
import { applyMapping, digest } from '../src/contracts.js';

const proposal = await proposeMapping({ sourceSystem: 'community-simulator', sourceVersion: '2',
  sourceSchema: { type: 'object', fields: {
    clientId: 'Stable local patient identifier, string', measuredAt: 'Observation timestamp, ISO 8601 with timezone',
    'vitals.bp': 'String containing systolic/diastolic blood pressure, in that order',
    'vitals.unit': 'Explicit measurement unit; mmHg in this schema'
  } }, syntheticExample: sampleV2 });
if (!proposal.mapping) throw new Error(`Meta requested clarification: ${proposal.questions.join('; ')}`);
const actual = applyMapping(proposal.mapping, sampleV2);
if (digest(actual) !== digest(expected)) throw new Error('Meta mapping failed independent expected-value validation');
mkdirSync('evidence', { recursive: true });
const output = { timestamp: new Date().toISOString(), ...proposal, validation: { passed: true, actual },
  note: 'Synthetic example only. Passing one case is not a quality benchmark. This script does not approve or activate the mapping.' };
writeFileSync('evidence/meta-proposal.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
