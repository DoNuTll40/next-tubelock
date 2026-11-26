export function supportsHdrDisplay(matchMedia = globalThis.matchMedia?.bind(globalThis)) {
  return Boolean(
    matchMedia?.('(video-dynamic-range: high)')?.matches ||
      matchMedia?.('(dynamic-range: high)')?.matches
  );
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
