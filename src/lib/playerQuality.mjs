export function supportsHdrDisplay(matchMedia = globalThis.matchMedia?.bind(globalThis)) {
  return Boolean(
    matchMedia?.('(video-dynamic-range: high)')?.matches ||
      matchMedia?.('(dynamic-range: high)')?.matches
  );
}

export function getHlsVideoRange(level) {
  return String(level.attrs?.['VIDEO-RANGE'] || level.videoRange || 'SDR').toUpperCase();
}

export function isHdrLevel(level) {
  const range = getHlsVideoRange(level);
  return range === 'PQ' || range === 'HLG';
}

export function getSdrFallbackLevel(levels, failedLevelIndex) {
  const failed = levels[failedLevelIndex];
  if (!failed || !isHdrLevel(failed)) return null;

  const sdr = levels.filter((level) => getHlsVideoRange(level) === 'SDR');
  const sameHeight = sdr.find((level) => level.height === failed.height);
  if (sameHeight) return sameHeight;

  sdr.sort((a, b) => a.height - b.height);
  return sdr.findLast((level) => level.height < failed.height) ?? sdr[0] ?? null;
}

export function getVisibleQualityLevels(levels, preferHdr) {
  const byHeight = new Map();
  for (const level of levels) {
    const height = Number(level.height);
    const key = height > 0 ? `height:${height}` : `index:${level.index}`;
    const existing = byHeight.get(key);
    if (!existing || (Boolean(level.isHdr) === preferHdr && Boolean(existing.isHdr) !== preferHdr)) {
      byHeight.set(key, level);
    }
  }
  return [...byHeight.values()].sort((a, b) => (b.height || 0) - (a.height || 0));
}

export function getSavedQualityLevel(levels, savedHeight, preferHdr) {
  if (!Number.isInteger(savedHeight) || savedHeight <= 0) return null;
  return getVisibleQualityLevels(levels, preferHdr).find((level) => Number(level.height) === savedHeight) ?? null;
}
