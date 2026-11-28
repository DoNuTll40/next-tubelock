import test from 'node:test';
import assert from 'node:assert/strict';
import Hls from 'hls.js';
import {
  filterDolbyVisionPlaybackLevels,
  getAudioQualityMenuState,
  getDolbyVisionBufferController,
  getHlsDolbyVisionCodec,
  getHlsTrackColorInfo,
  getSavedQualityLevel,
  getSdrFallbackLevel,
  getVisibleQualityLevels,
  supportsHdrDisplay,
} from '../src/lib/playerQuality.mjs';

const sdr = { index: 4, height: 1080, isHdr: false };
const hdr = { index: 8, height: 1080, isHdr: true };
const lower = { index: 2, height: 720, isHdr: false };

test('restored quality and menu agree on HDR and SDR tracks, regardless of playlist order', () => {
  for (const levels of [[lower, sdr, hdr], [hdr, lower, sdr]]) {
    assert.deepEqual(getVisibleQualityLevels(levels, true), [hdr, lower]);
    assert.deepEqual(getVisibleQualityLevels(levels, false), [sdr, lower]);
    assert.equal(getSavedQualityLevel(levels, 1080, true)?.index, 8);
    assert.equal(getSavedQualityLevel(levels, 1080, false)?.index, 4);
  }
});

test('HDR recovery prefers same-height SDR before dropping resolution', () => {
  const hdr720 = { height: 720, attrs: { 'VIDEO-RANGE': 'PQ' } };
  const sdr480 = { height: 480, videoRange: 'SDR' };
  const sdr720 = { height: 720, videoRange: 'SDR' };
  const sdr1080 = { height: 1080, videoRange: 'SDR' };
  assert.equal(getSdrFallbackLevel([sdr1080, hdr720, sdr480, sdr720], 1), sdr720);
  assert.equal(getSdrFallbackLevel([sdr1080, hdr720, sdr480], 1), sdr480);
  assert.equal(getSdrFallbackLevel([sdr1080, hdr720], 1), sdr1080);
});

test('HDR recovery accepts HLG but skips SDR failures and HDR-only playlists', () => {
  const hlg = { height: 720, videoRange: 'hlg' };
  const untagged = { height: 720 };
  assert.equal(getSdrFallbackLevel([hlg, untagged], 0), untagged);
  assert.equal(getSdrFallbackLevel([hlg, untagged], 1), null);
  assert.equal(getSdrFallbackLevel([hlg], 0), null);
  assert.equal(getSdrFallbackLevel([], -1), null);
});

test('HDR recovery detects a loading HDR level while SDR is still playing', () => {
  const playingSdr = { height: 480, videoRange: 'SDR' };
  const loadingHdr = { height: 720, videoRange: 'PQ' };
  const fallbackSdr = { height: 720, videoRange: 'SDR' };
  const levels = [playingSdr, loadingHdr, fallbackSdr];

  assert.equal(getSdrFallbackLevel(levels, undefined, 0, 1), fallbackSdr);
  assert.equal(getSdrFallbackLevel(levels, 3, 0, 1), fallbackSdr);
});

test('HDR recovery trusts an explicitly reported SDR failure over loading HDR', () => {
  const playingSdr = { height: 480, videoRange: 'SDR' };
  const loadingHdr = { height: 720, videoRange: 'PQ' };

  assert.equal(getSdrFallbackLevel([playingSdr, loadingHdr], 0, 0, 1), null);
});

test('saved quality can fall back to the only available range or keep Auto if the height is missing', () => {
  assert.equal(getSavedQualityLevel([hdr], 1080, false), hdr);
  assert.equal(getSavedQualityLevel([sdr], 1080, true), sdr);
  assert.equal(getSavedQualityLevel([lower], 1080, true), null);
  assert.equal(getSavedQualityLevel([lower], -1, false), null);
});

test('HDR display detection supports either media query', () => {
  assert.equal(supportsHdrDisplay(() => ({ matches: false })), false);
  for (const supported of ['(video-dynamic-range: high)', '(dynamic-range: high)']) {
    assert.equal(supportsHdrDisplay((query) => ({ matches: query === supported })), true);
  }
});

test('detects primary and supplemental Dolby Vision codec strings', () => {
  assert.equal(getHlsDolbyVisionCodec({ attrs: { CODECS: 'dvh1.05.06,mp4a.40.2' } }), 'dvh1.05.06');
  assert.equal(getHlsDolbyVisionCodec({
    videoCodec: 'hvc1.2.4.L153.B0',
    attrs: { 'SUPPLEMENTAL-CODECS': 'DVH1.08.06/db4h' },
  }), 'dvh1.08.06');
  assert.equal(getHlsDolbyVisionCodec({ supplemental: { videoCodec: 'dvh1.08.06' } }), 'dvh1.08.06');
  assert.equal(getHlsDolbyVisionCodec({ videoCodec: 'hvc1.2.4.L153.B0' }), '');
});

test('identifies the active Dolby Vision profile from the compatibility brand', () => {
  for (const [brand, profile, range] of [['db1p', '8.1', 'PQ'], ['db4h', '8.4', 'HLG']]) {
    const level = {
      attrs: { CODECS: 'hvc1.2.4.L153.B0,mp4a.40.2', 'SUPPLEMENTAL-CODECS': `dvh1.08.09/${brand}`, 'VIDEO-RANGE': range },
      supplemental: { videoCodec: 'dvh1.08.09' },
    };
    assert.equal(getHlsTrackColorInfo(level), `แทร็ก Dolby Vision ${profile} (${range})`);
  }
  assert.doesNotMatch(getHlsTrackColorInfo({ videoRange: 'PQ' }), /Dolby/);
  assert.doesNotMatch(getHlsTrackColorInfo(null), /Dolby|HDR|SDR/);
});

test('keeps a standard rendition available when Dolby Vision is unsupported', () => {
  const profile5 = { videoCodec: 'dvh1.05.06' };
  const profile8 = { videoCodec: 'hvc1.2.4.L153.B0', supplemental: { videoCodec: 'dvh1.08.06' } };
  const levels = [sdr, profile5, profile8, hdr];
  assert.deepEqual(filterDolbyVisionPlaybackLevels(levels, () => false), [sdr, hdr]);
  assert.deepEqual(filterDolbyVisionPlaybackLevels(levels, (codec) => codec === 'dvh1.08.06'), [sdr, profile8, hdr]);
  assert.deepEqual(filterDolbyVisionPlaybackLevels([profile8], () => false), [profile8]);
});

test('hls.js switches the decoder when an adaptive stream enters and leaves Dolby Vision', (t) => {
  const previousSelf = globalThis.self;
  globalThis.self = { MediaSource: { isTypeSupported: () => true } };
  t.after(() => {
    if (previousSelf === undefined) delete globalThis.self;
    else globalThis.self = previousSelf;
  });

  const hevc = 'hvc1.2.4.L150.B0';
  const dolby = 'dvh1.08.09';
  for (const supported of [true, false]) {
    for (const trackName of ['audiovideo', 'video']) {
      const hls = new Hls({ bufferController: getDolbyVisionBufferController(Hls, () => supported) });
      const changes = [];
      // Observe the real buffer controller at the boundary with the browser's SourceBuffer.
      t.mock.method(hls.bufferController, 'appendChangeType', (_name, _container, codec) => changes.push(codec));
      const audio = trackName === 'audiovideo' ? 'mp4a.40.2,' : '';
      try {
        for (const supplemental of [undefined, dolby, undefined]) {
          hls.trigger(Hls.Events.BUFFER_CODECS, {
            [trackName]: { codec: audio + hevc, supplemental, container: 'video/mp4', id: 'main' },
          });
        }
        assert.deepEqual(changes, supported ? [audio + dolby, audio + hevc] : []);
      } finally {
        hls.destroy();
      }
    }
  }
});

test('prefers compatible Dolby Vision at the same HDR quality height', () => {
  const dolby = { index: 9, height: 1080, isHdr: true, isDolbyVision: true };
  for (const levels of [[hdr, sdr, dolby], [dolby, hdr, sdr]]) {
    assert.deepEqual(getVisibleQualityLevels(levels, true), [dolby]);
    assert.deepEqual(getVisibleQualityLevels(levels, false), [sdr]);
    assert.equal(getSavedQualityLevel(levels, 1080, true), dolby);
  }
});

test('audio quality menu keeps Dolby Atmos summary and recovery access accurate', () => {
  assert.deepEqual(
    getAudioQualityMenuState({
      hasHiResAudio: false,
      isHiResActive: false,
      hiResQualityLabel: 'Hi-Res FLAC',
      atmosAvailable: true,
      isAtmosSelected: false,
    }),
    {
      hasAudioOptions: true,
      showAtmosOption: true,
      standardSelected: true,
      isSpecialAudioSelected: false,
      summaryBadge: null,
    },
  );

  assert.deepEqual(
    getAudioQualityMenuState({
      hasHiResAudio: false,
      isHiResActive: false,
      hiResQualityLabel: 'Hi-Res FLAC',
      atmosAvailable: true,
      isAtmosSelected: true,
    }),
    {
      hasAudioOptions: true,
      showAtmosOption: true,
      standardSelected: false,
      isSpecialAudioSelected: true,
      summaryBadge: 'Dolby Atmos',
    },
  );

  assert.deepEqual(
    getAudioQualityMenuState({
      hasHiResAudio: false,
      isHiResActive: false,
      hiResQualityLabel: 'Hi-Res FLAC',
      atmosAvailable: false,
      isAtmosSelected: true,
    }),
    {
      hasAudioOptions: true,
      showAtmosOption: true,
      standardSelected: false,
      isSpecialAudioSelected: true,
      summaryBadge: 'Dolby Atmos',
    },
  );

  assert.deepEqual(
    getAudioQualityMenuState({
      hasHiResAudio: true,
      isHiResActive: true,
      hiResQualityLabel: 'Hi-Res FLAC',
      atmosAvailable: true,
      isAtmosSelected: false,
    }),
    {
      hasAudioOptions: true,
      showAtmosOption: true,
      standardSelected: false,
      isSpecialAudioSelected: true,
      summaryBadge: 'Hi-Res FLAC',
    },
  );
});
