import test from 'node:test';
import assert from 'node:assert/strict';
import { getSavedQualityLevel, getSdrFallbackLevel, getVisibleQualityLevels, supportsHdrDisplay } from '../src/lib/playerQuality.mjs';

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
