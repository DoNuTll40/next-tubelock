export function supportsHdrDisplay(matchMedia = globalThis.matchMedia?.bind(globalThis)) {
  return Boolean(
    matchMedia?.('(video-dynamic-range: high)')?.matches ||
      matchMedia?.('(dynamic-range: high)')?.matches
  );
}

export function getHlsVideoRange(level) {
  return String(level?.attrs?.['VIDEO-RANGE'] || level?.videoRange || 'SDR').toUpperCase();
}

export function getHlsDolbyVisionCodec(level) {
  for (const codecs of [
    level?.supplemental?.videoCodec,
    level?.attrs?.['SUPPLEMENTAL-CODECS'],
    level?.videoCodec,
    level?.attrs?.CODECS,
  ]) {
    const codec = codecs?.match(/(?:^|,)\s*((?:dvh1|dvhe|dav1)\.\d{2}\.\d{2})(?=$|[,/\s])/i)?.[1];
    if (codec) return codec.toLowerCase();
  }
  return '';
}

export function getHlsTrackColorInfo(level) {
  if (!level) return 'ไม่มีข้อมูลแทร็กที่กำลังเล่น';
  const range = getHlsVideoRange(level);
  const codec = getHlsDolbyVisionCodec(level);
  if (codec) {
    const profile = Number(codec.split('.')[1]);
    const brands = String(level.attrs?.['SUPPLEMENTAL-CODECS'] || '').toLowerCase()
      .split(/[\s,]+/).find((entry) => entry.startsWith(codec + '/'))?.split('/').slice(1) || [];
    const subprofile = profile === 8 && brands.includes('db1p') ? '.1'
      : profile === 8 && brands.includes('db4h') ? '.4' : '';
    return `แทร็ก Dolby Vision ${profile}${subprofile} (${range})`;
  }
  if (range === 'PQ') return 'bt2020 / smpte2084 (HDR10)';
  if (range === 'HLG') return 'bt2020 / arib-std-b67 (HLG)';
  return 'bt709 / bt709 (SDR)';
}

export function filterDolbyVisionPlaybackLevels(levels, supportsDolbyVision) {
  const available = levels.filter((level) => {
    const codec = getHlsDolbyVisionCodec(level);
    return !codec || supportsDolbyVision(codec);
  });
  // A supplemental Dolby Vision stream can still provide a backward-compatible base layer.
  return available.length ? available : levels;
}

export function getDolbyVisionBufferController(Hls, supportsDolbyVision) {
  return class extends Hls.DefaultConfig.bufferController {
    constructor(hls, fragmentTracker) {
      // hls.js 1.7 uses the supplemental codec at creation, but compares track.codec
      // for SourceBuffer.changeType(). Apply the parsed init-segment codec before both.
      hls.on(Hls.Events.BUFFER_CODECS, (event, tracks) => {
        const track = tracks.video || tracks.audiovideo;
        const dolby = track?.supplemental;
        if (track?.codec && dolby?.startsWith('dvh1.') && supportsDolbyVision(dolby)) {
          track.codec = track.codec.replace(/(^|,)(?:hvc1|hev1)[^,]*/, `$1${dolby}`);
        }
      });
      super(hls, fragmentTracker);
    }
  };
}

export function isHdrLevel(level) {
  const range = getHlsVideoRange(level);
  return range === 'PQ' || range === 'HLG';
}

export function getSdrFallbackLevel(levels, reportedLevelIndex, ...candidateLevelIndexes) {
  const failed = levels[reportedLevelIndex] ?? candidateLevelIndexes
    .map((index) => levels[index])
    .find((level) => level && isHdrLevel(level));
  if (!failed || !isHdrLevel(failed)) return null;

  const sdr = levels.filter((level) => getHlsVideoRange(level) === 'SDR');
  const sameHeight = sdr.find((level) => level.height === failed.height);
  if (sameHeight) return sameHeight;

  sdr.sort((a, b) => a.height - b.height);
  return sdr.findLast((level) => level.height < failed.height) ?? sdr[0] ?? null;
}

export function getVisibleQualityLevels(levels, preferHdr) {
  const preference = (level) => {
    if (Boolean(level.isHdr) !== preferHdr) return 0;
    return preferHdr && level.isDolbyVision ? 2 : 1;
  };
  const byHeight = new Map();
  for (const level of levels) {
    const height = Number(level.height);
    const key = height > 0 ? `height:${height}` : `index:${level.index}`;
    const existing = byHeight.get(key);
    if (!existing || preference(level) > preference(existing)) {
      byHeight.set(key, level);
    }
  }
  return [...byHeight.values()].sort((a, b) => (b.height || 0) - (a.height || 0));
}

export function getSavedQualityLevel(levels, savedHeight, preferHdr) {
  if (!Number.isInteger(savedHeight) || savedHeight <= 0) return null;
  return getVisibleQualityLevels(levels, preferHdr).find((level) => Number(level.height) === savedHeight) ?? null;
}
