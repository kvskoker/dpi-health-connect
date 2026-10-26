import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposeMapping } from '../src/meta.js';

test('an absent Meta key produces a clear error, never a simulated AI response', async () => {
  const previous = process.env.MODEL_API_KEY;
  delete process.env.MODEL_API_KEY;
  try {
    await assert.rejects(proposeMapping({ sourceSystem: 'community-simulator', sourceVersion: '1', sourceSchema: {}, syntheticExample: {} }), /no model call was made/);
  } finally { if (previous !== undefined) process.env.MODEL_API_KEY = previous; }
});
