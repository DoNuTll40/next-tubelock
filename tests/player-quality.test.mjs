import test from 'node:test';
import assert from 'node:assert/strict';
import { getSavedQualityLevel, getVisibleQualityLevels, supportsHdrDisplay } from '../src/lib/playerQuality.mjs';

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
