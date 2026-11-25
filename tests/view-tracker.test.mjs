import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recordVerifiedView } from '../src/lib/viewTracker.js';
import { watchTimeThreshold } from '../src/lib/videoUtils.js';

const privateVideo = { id: 21, user_id: 7, visibility: 'private', duration: 100 };
const request = { videoId: privateVideo.id, viewer: { id: privateVideo.user_id }, watchTime: 15 };

test('view thresholds account for short clips and cap at 15 seconds', () => {
  assert.equal(watchTimeThreshold(2), 2);
  assert.equal(watchTimeThreshold(20), 6);
  assert.equal(watchTimeThreshold(100), 15);
});

test('view tracker rejects unauthorized and invalid view submissions before a write', async () => {
  let queries = 0;
  const sql = async () => {
    assert.equal(++queries, 1);
    return [privateVideo];
  };

  const rejected = await recordVerifiedView(sql, { ...request, viewer: { id: 8 } });
  assert.equal(rejected.status, 403);
  queries = 0;
  const excessive = await recordVerifiedView(sql, { ...request, watchTime: 111 });
  assert.equal(excessive.status, 400);
  assert.equal(excessive.body.reason, 'invalid_watch_time');
});

test('view tracker uses approved version duration and interprets a duplicate claim', async () => {
  const supplied = [
    [privateVideo],
    [{ duration: 20 }],
    [{ eligible: true, counted: false }],
  ];
  const sql = async () => supplied.shift();
  const result = await recordVerifiedView(sql, { ...request, versionId: 2, watchTime: 6 });
  assert.deepEqual(result, { status: 200, body: { success: true, counted: false, reason: 'cooldown' } });
  assert.equal(supplied.length, 0);
});
