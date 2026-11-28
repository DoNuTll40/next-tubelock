import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { connectHiResAudio, getMediaBufferAhead } from '../src/lib/hiResAudio.mjs';

function ranges(items) {
  return {
    length: items.length,
    start: (index) => items[index][0],
    end: (index) => items[index][1],
  };
}

class FakeMedia extends EventTarget {
  paused = true;
  muted = false;
  ended = false;
  seeking = false;
  readyState = 4;
  playbackRate = 1;
  duration = 60;
  src = '';
  buffered = ranges([]);
  playCalls = 0;
  seeks = [];
  time = 0;

  get currentTime() {
    return this.time;
  }

  set currentTime(value) {
    this.seeks.push(value);
    this.time = value;
  }

  emit(type) {
    this.dispatchEvent(new Event(type));
  }

  play() {
    this.playCalls++;
    this.paused = false;
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
  }

  getAttribute(name) {
    return name === 'src' ? this.src : null;
  }

  load() {}
}

function makePlayer(t, { duration = 60, time = 10, buffered = [], startPlaying = false } = {}) {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const video = Object.assign(new FakeMedia(), { duration, time });
  const audio = Object.assign(new FakeMedia(), {
    paused: true,
    duration,
    time,
    buffered: ranges(buffered),
  });
  const statuses = [];
  const controller = connectHiResAudio(video, audio, {
    url: 'https://example.test/audio.wav',
    isActive: () => true,
    onStatus: (status) => { statuses.push(status); },
    onPlayBlocked: () => {},
    startPlaying,
  });
  t.after(() => controller.disconnect());
  return { video, audio, controller, status: () => statuses.at(-1) };
}

test('counts only contiguous media buffer at the playhead', () => {
  const media = { currentTime: 3, buffered: ranges([[0, 4], [10, 20]]) };
  assert.equal(getMediaBufferAhead(media, 3), 1);
  assert.equal(getMediaBufferAhead(media, 6), 0);
  assert.equal(getMediaBufferAhead(media, 12), 8);
});

test('holds video and leaves its AAC muted until Hi-Res has a continuous buffer', async (t) => {
  const { video, audio, controller, status } = makePlayer(t, { buffered: [[0, 11], [20, 60]] });
  controller.play();
  assert.equal(controller.isPlayRequested(), true);
  assert.equal(status(), 'loading');
  assert.equal(video.paused, true);
  assert.equal(video.muted, true);

  audio.emit('canplay');
  assert.equal(video.paused, true);
  audio.buffered = ranges([[0, 16]]);
  audio.emit('progress');
  await setImmediate();
  assert.equal(status(), 'ready');
  assert.equal(video.paused, false);
  assert.equal(audio.paused, false);
  assert.equal(video.muted, true);
});

test('an audio stall pauses both streams and resumes once Hi-Res refills', async (t) => {
  const { video, audio, controller, status } = makePlayer(t, {
    buffered: [[0, 16]],
    startPlaying: true,
  });
  await setImmediate();
  assert.equal(status(), 'ready');
  video.time = audio.time = 15.7;
  audio.readyState = 2;
  audio.emit('waiting');
  assert.equal(status(), 'loading');
  assert.equal(controller.isPlayRequested(), true);
  assert.equal(video.paused, true);
  assert.equal(audio.paused, true);
  assert.equal(video.muted, true);
  const seeksBeforeStall = audio.seeks.length;
  t.mock.timers.tick(1000);
  assert.equal(audio.seeks.length, seeksBeforeStall);

  audio.readyState = 4;
  audio.buffered = ranges([[15, 17]]);
  audio.emit('canplay');
  assert.equal(video.paused, true);
  audio.buffered = ranges([[15, 24]]);
  audio.emit('progress');
  await setImmediate();
  assert.equal(status(), 'ready');
  assert.equal(video.paused, false);
  assert.equal(audio.paused, false);
  assert.equal(video.muted, true);
});

test('manual pause during audio buffering cancels the automatic resume', async (t) => {
  const { video, audio, controller, status } = makePlayer(t, { startPlaying: true });
  assert.equal(status(), 'loading');
  controller.pause();
  assert.equal(controller.isPlayRequested(), false);
  audio.buffered = ranges([[0, 30]]);
  audio.emit('progress');
  await setImmediate();
  assert.equal(video.paused, true);
  assert.equal(audio.paused, true);
  assert.equal(video.muted, true);
});

test('waits for video data before restarting Hi-Res', async (t) => {
  const { video, audio, status } = makePlayer(t, { buffered: [[0, 30]], startPlaying: true });
  await setImmediate();
  assert.equal(status(), 'ready');
  video.readyState = 2;
  video.emit('waiting');
  assert.equal(audio.paused, true);
  const playCallsWhileWaiting = audio.playCalls;
  t.mock.timers.tick(1000);
  assert.equal(audio.playCalls, playCallsWhileWaiting);

  video.readyState = 4;
  video.emit('canplay');
  await setImmediate();
  assert.equal(audio.paused, false);
  assert.equal(video.muted, true);
});

test('an explicit video seek can request audio outside its previous buffer', (t) => {
  const { video, audio } = makePlayer(t, { buffered: [[0, 20]], startPlaying: true });
  video.time = 35;
  video.seeking = true;
  video.emit('seeking');
  video.seeking = false;
  video.emit('seeked');
  assert.equal(audio.seeks.at(-1), 35);
});

test('starts a short clip once its remaining Hi-Res audio is buffered', async (t) => {
  const { video, audio, status } = makePlayer(t, {
    duration: 2,
    time: 0,
    buffered: [[0, 2]],
    startPlaying: true,
  });
  await setImmediate();
  assert.equal(status(), 'ready');
  assert.equal(audio.paused, false);
  assert.equal(video.muted, true);
});

test('a failed Hi-Res source stops playback with AAC still muted', async (t) => {
  const { video, audio, controller, status } = makePlayer(t, { buffered: [[0, 30]], startPlaying: true });
  await setImmediate();
  audio.error = { code: 2 };
  audio.emit('error');
  assert.equal(status(), 'error');
  assert.equal(controller.isPlayRequested(), false);
  assert.equal(video.paused, true);
  assert.equal(audio.paused, true);
  assert.equal(video.muted, true);
});
