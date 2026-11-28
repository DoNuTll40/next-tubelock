import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { compileFunction } from 'node:vm';
import test from 'node:test';

const source = await fs.readFile(new URL('../src/components/VideoPlayer.jsx', import.meta.url), 'utf8');
const callback = source.split('const attemptAutoPlay = useCallback(')[1].split(', [shouldAutoplay, restoreAudioAfterTransition]);')[0];

function player(play) {
  const media = { paused: true, readyState: 2, currentTime: 0, duration: 60, play };
  const dependencies = {
    video: { current: media }, isActiveRef: { current: true }, shouldAutoplay: true,
    isUserPausedRef: { current: false }, isSwitchingVideoRef: { current: false },
    autoplayAttemptRef: { current: null }, isEndedRef: { current: false },
    hiResPlaybackRef: { current: null },
    isTransitioningStreamRef: { current: false }, restoreAudioAfterTransition: () => {},
    setIsMuted: value => { media.muted = value; }, setIsPlaying: () => {}, setIsBuffering: () => {},
  };
  const attempt = compileFunction(`return (${callback});`, Object.keys(dependencies))(...Object.values(dependencies));
  return { ...dependencies, attempt, media };
}

test('canplay retries an aborted autoplay without marking it as a user pause', async () => {
  let calls = 0;
  const fixture = player(async () => { if (++calls === 1) throw { name: 'AbortError' }; });
  await fixture.attempt(true);
  assert.equal(fixture.isUserPausedRef.current, false);
  assert.equal(fixture.autoplayAttemptRef.current, null);
  await fixture.attempt(); // same callback invoked by onCanPlay
  assert.equal(calls, 2);
});

test('autoplay delegates to the selected Hi-Res track while both elements buffer', async () => {
  const fixture = player(async () => assert.fail('The video element started independently'));
  let requested = false;
  fixture.hiResPlaybackRef.current = {
    isPlayRequested: () => requested,
    play: () => { requested = true; },
  };
  await fixture.attempt();
  assert.equal(requested, true);
});

test('a real user pause during an interrupted play prevents the canplay retry', async () => {
  let calls = 0;
  const fixture = player(async () => { calls++; fixture.isUserPausedRef.current = true; throw { name: 'AbortError' }; });
  await fixture.attempt();
  await fixture.attempt();
  assert.equal(calls, 1);
  assert.equal(fixture.isUserPausedRef.current, true);
});

test('an obsolete play attempt cannot clear the next source attempt or apply muted fallback', async () => {
  let reject;
  let calls = 0;
  const fixture = player(() => { calls++; return new Promise((_, fail) => { reject = fail; }); });
  const pending = fixture.attempt();
  const nextSourceAttempt = {};
  fixture.autoplayAttemptRef.current = nextSourceAttempt; // stream effect cleanup/init
  reject({ name: 'NotAllowedError' });
  await pending;
  assert.equal(calls, 1);
  assert.equal(fixture.autoplayAttemptRef.current, nextSourceAttempt);
  assert.equal(fixture.media.muted, undefined);
  assert.equal(fixture.isUserPausedRef.current, false);
});

test('browser autoplay blocking still retries muted and stops after a second policy rejection', async () => {
  for (const failMuted of [false, true]) {
    let calls = 0;
    const fixture = player(async () => { if (++calls === 1 || failMuted) throw { name: 'NotAllowedError' }; });
    await fixture.attempt();
    assert.equal(calls, 2);
    assert.equal(fixture.media.muted, true);
    assert.equal(fixture.isUserPausedRef.current, failMuted);
  }
});

test('an abort during muted fallback also remains retryable', async () => {
  let calls = 0;
  const fixture = player(async () => {
    calls++;
    if (calls === 1) throw { name: 'NotAllowedError' };
    if (calls === 2) throw { name: 'AbortError' };
  });
  await fixture.attempt();
  await fixture.attempt();
  assert.equal(calls, 3);
  assert.equal(fixture.isUserPausedRef.current, false);
});
