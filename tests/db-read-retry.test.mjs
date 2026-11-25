import assert from 'node:assert/strict';
import test from 'node:test';
import { retryDbRead } from '../src/lib/db.js';

test('read retry handles Neon transport errors and returns the successful result', async () => {
  let calls = 0;
  const result = await retryDbRead(async () => {
    calls++;
    if (calls === 1) {
      throw Object.assign(new Error('Neon transport'), { sourceError: new TypeError('fetch failed') });
    }
    return ['row'];
  });

  assert.deepEqual(result, ['row']);
  assert.equal(calls, 2);
});

test('read retry propagates SQL errors immediately', async () => {
  let calls = 0;
  const failure = Object.assign(new Error('missing table'), { code: '42P01' });
  await assert.rejects(retryDbRead(async () => {
    calls++;
    throw failure;
  }), (error) => error === failure);
  assert.equal(calls, 1);
});
