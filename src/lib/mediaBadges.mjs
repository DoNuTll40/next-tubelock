import { classifyResolution, isMatureVideo } from './videoUtils.js';

function safeJsonParse(raw) {
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeReadyQualities(raw) {
  const parsed = typeof raw === 'string' ? safeJsonParse(raw) : raw;
  return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object') : [];
}

function resolveRateKhz(rate) {
  const num = Number(rate) || 48000;
  return (num / 1000).toFixed(num % 1000 === 0 ? 0 : 1);
}

/**
 * Parse master.m3u8 capabilities as a live fallback when DB ready_qualities is unavailable.
 */
export function parseMasterStreamCapabilities(masterText = '') {
  if (typeof masterText !== 'string' || !masterText.trim()) {
    return { maxWidth: 0, maxHeight: 0, dolbyVision: null, hdrType: null, atmos: null };
  }

  let maxWidth = 0;
  let maxHeight = 0;
  for (const match of masterText.matchAll(/RESOLUTION=(\d+)x(\d+)/gi)) {
    const w = Number(match[1]) || 0;
    const h = Number(match[2]) || 0;
    if (w * h > maxWidth * maxHeight || h > maxHeight) {
      maxWidth = w;
      maxHeight = h;
    }
  }

  let dolbyVision = null;
  const dvSuppMatch = masterText.match(/SUPPLEMENTAL-CODECS="[^"]*(dvh1\.08\.(\d+))\/(db1p|db4h)[^"]*"/i);
  if (dvSuppMatch) {
    const brand = dvSuppMatch[3].toLowerCase();
    dolbyVision = {
      codec: dvSuppMatch[1].toLowerCase(),
      profile: brand === 'db4h' ? '8.4' : '8.1',
      videoRange: brand === 'db4h' ? 'HLG' : 'PQ',
    };
  } else {
    const dvPrimaryMatch = masterText.match(/CODECS="[^"]*(dvh1\.(\d{2})\.\d+)[^"]*"/i);
    if (dvPrimaryMatch) {
      const rangeMatch = masterText.match(/VIDEO-RANGE=(PQ|HLG)/i);
      dolbyVision = {
        codec: dvPrimaryMatch[1].toLowerCase(),
        profile: String(Number(dvPrimaryMatch[2]) || 8),
        videoRange: rangeMatch ? rangeMatch[1].toUpperCase() : 'PQ',
      };
    }
  }

  const hasHlg = /VIDEO-RANGE=HLG/i.test(masterText);
  const hasPq = /VIDEO-RANGE=PQ/i.test(masterText);
  const hdrType = hasHlg && !hasPq ? 'HLG' : (hasPq || hasHlg ? 'PQ' : null);

  let atmos = null;
  if (/GROUP-ID="tubelock-atmos"/i.test(masterText) || /AUDIO="tubelock-atmos"/i.test(masterText)) {
    const complexityMatch = masterText.match(/GROUP-ID="tubelock-atmos"[^\r\n]*CHANNELS="(\d+)\/JOC"/i);
    const atmosStreamMatch = masterText.match(/#EXT-X-STREAM-INF:[^\r\n]*AUDIO="tubelock-atmos"[^\r\n]*/i);
    const videoCodecMatch = atmosStreamMatch?.[0]?.match(/CODECS="([^",]+),ec-3"/i);
    atmos = {
      complexity: complexityMatch ? Number(complexityMatch[1]) || 16 : 16,
      videoCodec: videoCodecMatch ? videoCodecMatch[1] : '',
    };
  }

  return {
    maxWidth,
    maxHeight,
    dolbyVision,
    hdrType,
    atmos,
  };
}

function getEffectiveReadyQualities(video, activeVersion) {
  const versionQualities = normalizeReadyQualities(
    activeVersion?.readyQualities ?? activeVersion?.ready_qualities
  );
  if (versionQualities.length > 0) return versionQualities;

  const hasMultipleVersions = Array.isArray(video?.versions) && video.versions.length > 0;
  if (!hasMultipleVersions || !activeVersion || activeVersion.isDefault || activeVersion.is_default) {
    return normalizeReadyQualities(video?.ready_qualities);
  }
  return [];
}

function parseDolbyVisionBadgeInfo(qualities, streamCapabilities) {
  const dvQuality = qualities.find((q) => q.dolby_vision && typeof q.dolby_vision === 'object');
  if (dvQuality) {
    const supp = String(dvQuality.dolby_vision.supplementalCodecs || '');
    const codec = supp.split('/')[0]?.toLowerCase() || '';
    const brand = supp.split('/')[1]?.toLowerCase() || '';
    const profile = brand === 'db4h' ? '8.4' : brand === 'db1p' ? '8.1' : '8';
    const videoRange = String(dvQuality.dolby_vision.videoRange || dvQuality.hdr_type || (brand === 'db4h' ? 'HLG' : 'PQ')).toUpperCase();
    return { codec, profile, videoRange };
  }
  return streamCapabilities?.dolbyVision || null;
}

/**
 * Extract structured streaming capability badges and truthful tooltips for a Watch video/version.
 */
export function extractWatchMediaCapabilities(
  video,
  { activeVersion = null, streamMeta = null, deviceSupport = null } = {}
) {
  const qualities = getEffectiveReadyQualities(video, activeVersion);
  const caps = streamMeta?.capabilities || null;

  let maxW = Number(video?.width) || caps?.maxWidth || 0;
  let maxH = Number(video?.height) || caps?.maxHeight || 0;
  for (const q of qualities) {
    const qw = Number(q.width) || 0;
    const qh = Number(q.height) || 0;
    if (qw * qh > maxW * maxH || qh > maxH) {
      maxW = qw;
      maxH = qh;
    }
  }

  const rawResolution = activeVersion?.resolution || video?.resolution || '';
  if (!maxW && !maxH && typeof rawResolution === 'string' && rawResolution.includes('x')) {
    const [rw, rh] = rawResolution.split('x').map(Number);
    if (rw > 0 && rh > 0) {
      maxW = rw;
      maxH = rh;
    }
  }

  const resLabel = classifyResolution(maxW, maxH, rawResolution);
  const resBadge = (() => {
    if (resLabel === '4K') {
      return { id: 'uhd', kind: 'text', label: 'UHD', tone: 'orange', tooltip: 'ความละเอียดสูงสุด 4K Ultra HD (2160p)' };
    }
    if (resLabel === '2K') {
      return { id: 'resolution', kind: 'text', label: '2K', tone: 'orange', tooltip: 'ความละเอียดสูงสุด 2K Quad HD (1440p)' };
    }
    if (resLabel === '1080p') {
      return { id: 'resolution', kind: 'text', label: 'FHD', tone: 'orange', tooltip: 'ความละเอียดสูงสุด Full HD (1080p)' };
    }
    if (resLabel === '720p') {
      return { id: 'resolution', kind: 'text', label: 'HD', tone: 'slate', tooltip: 'ความละเอียดสูงสุด HD (720p)' };
    }
    if (resLabel) {
      return { id: 'resolution', kind: 'text', label: resLabel, tone: 'slate', tooltip: `ความละเอียดสูงสุด ${resLabel}` };
    }
    return null;
  })();

  const dvInfo = parseDolbyVisionBadgeInfo(qualities, caps);
  let dvBadge = null;
  if (dvInfo) {
    const dvSupported = typeof deviceSupport?.dolbyVision === 'function'
      ? deviceSupport.dolbyVision(dvInfo.codec || 'dvh1.08.06')
      : typeof deviceSupport?.dolbyVision === 'boolean'
        ? deviceSupport.dolbyVision
        : null;
    const deviceNote = dvSupported === true
      ? ' • อุปกรณ์และเบราว์เซอร์นี้รองรับ'
      : dvSupported === false
        ? ' • เบราว์เซอร์หรือจอนี้เล่นชั้นภาพมาตรฐานแทน'
        : '';
    dvBadge = {
      id: 'dolby-vision',
      kind: 'dolby',
      sublabel: 'VISION',
      tone: 'dolby',
      unsupportedOnDevice: dvSupported === false,
      tooltip: `แทร็กภาพ Dolby Vision Profile ${dvInfo.profile} (${dvInfo.videoRange})${deviceNote}`,
    };
  }

  const hdrQualities = qualities.filter((q) => q.is_hdr);
  const hasHlg = hdrQualities.some((q) => String(q.hdr_type || '').toUpperCase() === 'HLG') || caps?.hdrType === 'HLG';
  const hasPq = hdrQualities.some((q) => String(q.hdr_type || 'PQ').toUpperCase() !== 'HLG') || caps?.hdrType === 'PQ';
  let hdrBadge = null;
  if (hdrQualities.length > 0 || caps?.hdrType) {
    const hdrType = hasHlg && !hasPq ? 'HLG' : 'PQ';
    const hdrSupported = typeof deviceSupport?.hdr === 'boolean' ? deviceSupport.hdr : null;
    const deviceNote = hdrSupported === true
      ? ' • จอแสดงผลนี้รองรับ HDR'
      : hdrSupported === false
        ? ' • จอแสดงผลนี้เล่นโหมด SDR แทน'
        : '';
    hdrBadge = {
      id: 'hdr',
      kind: 'text',
      label: hdrType === 'HLG' ? 'HLG' : 'HDR',
      tone: 'cyan',
      unsupportedOnDevice: hdrSupported === false,
      tooltip: `${hdrType === 'HLG' ? 'ภาพช่วงไดนามิกสูง HLG (10-bit)' : 'ภาพช่วงไดนามิกสูง HDR10 (PQ 10-bit)'}${deviceNote}`,
    };
  }

  const atmosQuality = qualities.find((q) => q.atmos_audio && typeof q.atmos_audio === 'object');
  const atmosInfo = atmosQuality?.atmos_audio || caps?.atmos || null;
  let atmosBadge = null;
  if (atmosInfo) {
    const atmosSupported = typeof deviceSupport?.atmos === 'function'
      ? deviceSupport.atmos(atmosInfo.videoCodec || '')
      : typeof deviceSupport?.atmos === 'boolean'
        ? deviceSupport.atmos
        : null;
    const deviceNote = atmosSupported === true
      ? ' • เบราว์เซอร์นี้เปิดแทร็ก Atmos ได้ในเมนูคุณภาพเสียง'
      : atmosSupported === false
        ? ' • เบราว์เซอร์นี้ไม่รองรับ E-AC-3 (เล่นเสียง AAC แทน)'
        : '';
    const complexityPart = atmosInfo.complexity ? ` ${atmosInfo.complexity}-obj` : '';
    atmosBadge = {
      id: 'dolby-atmos',
      kind: 'dolby',
      sublabel: 'ATMOS',
      tone: 'dolby',
      unsupportedOnDevice: atmosSupported === false,
      tooltip: `เสียงรอบทิศทางเชิงวัตถุ Dolby Atmos (DD+ JOC${complexityPart})${deviceNote}`,
    };
  }

  const hiResQuality = qualities.find((q) => q.hires_audio && q.hires_audio.file)?.hires_audio || streamMeta?.hiRes || null;
  let hiResBadge = null;
  if (hiResQuality) {
    const format = String(hiResQuality.format || 'wav').toLowerCase() === 'flac' ? 'FLAC' : 'PCM WAV';
    const bits = Number(hiResQuality.bits) || 24;
    const rateKhz = resolveRateKhz(hiResQuality.rate ?? hiResQuality.sampleRate);
    hiResBadge = {
      id: 'hires',
      kind: 'text',
      label: 'Hi-Res',
      tone: 'amber',
      tooltip: `เสียงต้นฉบับไม่สูญเสียรายละเอียด Hi-Res Lossless (${bits}-bit / ${rateKhz} kHz ${format}) • เลือกฟังได้ในเมนูคุณภาพเสียง`,
    };
  }

  const qualityAudioSample = qualities.find((q) => q.audio_channels != null || q.audio_layout);
  const channels = Number(
    streamMeta?.channels ??
    activeVersion?.audioChannels ??
    activeVersion?.audio_channels ??
    video?.audio_channels ??
    qualityAudioSample?.audio_channels ??
    0
  );
  const layout = String(streamMeta?.layout ?? qualityAudioSample?.audio_layout ?? '').toLowerCase();
  let surroundBadge = null;
  if (channels >= 7 || layout.includes('7.1')) {
    surroundBadge = {
      id: 'surround',
      kind: 'text',
      label: '7.1',
      tone: 'slate',
      tooltip: 'ระบบเสียงรอบทิศทาง 7.1 Surround',
    };
  } else if (channels >= 5 || layout.includes('5.1')) {
    surroundBadge = {
      id: 'surround',
      kind: 'text',
      label: '5.1',
      tone: 'slate',
      tooltip: 'ระบบเสียงรอบทิศทาง 5.1 Surround',
    };
  }

  const tracks = Array.isArray(video?.subtitle_tracks) ? video.subtitle_tracks : [];
  const hasInlineSub = Boolean(String(video?.subtitle_vtt || '').trim() || String(video?.subtitle_srt || '').trim());
  const hasSubtitles = tracks.length > 0 || hasInlineSub || video?.subtitle_status === 'ready';
  let ccBadge = null;
  if (hasSubtitles) {
    const trackNames = tracks.map((t) => t?.label || t?.lang).filter(Boolean);
    ccBadge = {
      id: 'cc',
      kind: 'text',
      label: 'CC',
      tone: 'slate',
      tooltip: trackNames.length ? `มีคำบรรยาย (CC): ${trackNames.join(', ')}` : 'มีคำบรรยาย (Closed Captions) พร้อมใช้งาน',
    };
  }

  const badges = [dvBadge, hdrBadge, resBadge, atmosBadge, hiResBadge, surroundBadge, ccBadge].filter(Boolean);
  return { badges, resLabel };
}

function getSafetyLevel(scores, pattern) {
  if (!Array.isArray(scores)) return 'SAFE';
  const entry = scores.find((item) => pattern.test(String(item?.name || '')));
  const status = String(entry?.status || '').toUpperCase();
  if (!status || status.includes('SAFE') || status.includes('NEGLIGIBLE') || status.includes('NONE')) {
    return 'SAFE';
  }
  if (status.includes('HIGH')) return 'HIGH';
  if (status.includes('MEDIUM')) return 'MEDIUM';
  if (status.includes('CAUTION')) return 'CAUTION';
  if (status.includes('LOW')) return 'LOW';
  return 'SAFE';
}

/**
 * Extract age rating badge, photosensitive bolt flag, and Thai content advisory lines from existing DB data.
 */
export function extractContentAdvisory(video) {
  const rawRating = String(video?.content_rating || 'all').trim().toLowerCase();
  const effectiveRating = rawRating === 'all' && isMatureVideo(video) ? '18+' : rawRating;

  const ratingBadge = (() => {
    if (effectiveRating === 'mature' || effectiveRating === 'restricted' || effectiveRating === 'nsfw') {
      return {
        code: 'mature',
        label: 'R 18+',
        tone: 'rose',
        tooltip: 'เรตเนื้อหาจำกัดเฉพาะผู้ชมอายุ 18 ปีขึ้นไป (Restricted / Mature)',
      };
    }
    if (effectiveRating === '18+') {
      return {
        code: '18+',
        label: '18+',
        tone: 'rose',
        tooltip: 'เรตเนื้อหาสำหรับผู้ชมอายุ 18 ปีขึ้นไป',
      };
    }
    if (effectiveRating === '16+') {
      return {
        code: '16+',
        label: '16+',
        tone: 'amber',
        tooltip: 'เรตเนื้อหาสำหรับผู้ชมอายุ 16 ปีขึ้นไป',
      };
    }
    if (effectiveRating === '13+') {
      return {
        code: '13+',
        label: '13+',
        tone: 'amber',
        tooltip: 'เรตเนื้อหาสำหรับผู้ชมอายุ 13 ปีขึ้นไป',
      };
    }
    return {
      code: 'all',
      label: 'ทั่วไป',
      tone: 'slate',
      tooltip: 'เรตเนื้อหาทั่วไป เหมาะสำหรับทุกวัย',
    };
  })();

  const rawVision = video?.vision_analysis;
  const vision = typeof rawVision === 'string'
    ? safeJsonParse(rawVision)
    : (rawVision && typeof rawVision === 'object' ? rawVision : null);

  const descriptors = [];
  const addDescriptor = (text) => {
    if (text && !descriptors.includes(text)) descriptors.push(text);
  };

  const scores = vision?.safetyScores;
  const sexLevel = getSafetyLevel(scores, /sex|adult|nud/i);
  if (sexLevel === 'HIGH') addDescriptor('ภาพเปลือยหรือเนื้อหาทางเพศชัดเจน');
  else if (sexLevel === 'MEDIUM' || sexLevel === 'LOW') addDescriptor('เนื้อหาหรือการแต่งกายล่อแหลม');

  const violenceLevel = getSafetyLevel(scores, /violence|gore/i);
  if (violenceLevel === 'HIGH' || violenceLevel === 'MEDIUM') addDescriptor('ความรุนแรง');
  else if (violenceLevel === 'LOW') addDescriptor('ฉากต่อสู้หรือความรุนแรงเล็กน้อย');

  const hateLevel = getSafetyLevel(scores, /hate/i);
  const hasHate = hateLevel === 'HIGH' || hateLevel === 'MEDIUM' || hateLevel === 'LOW';
  if (hasHate) addDescriptor('ถ้อยคำรุนแรงหรือภาษาหยาบคาย');

  const dangerLevel = getSafetyLevel(scores, /danger/i);
  if (dangerLevel === 'HIGH' || dangerLevel === 'MEDIUM' || dangerLevel === 'CAUTION') {
    addDescriptor('พฤติกรรมเสี่ยงหรือเป็นอันตราย');
  }

  const textCorpus = [
    vision?.summary || '',
    ...(Array.isArray(vision?.recommendedTags) ? vision.recommendedTags : []),
  ].join(' ');

  if (/แอลกอฮอล์|สุรา|เหล้า|เบียร์|ดื่มไวน์|\balcohol\b/i.test(textCorpus)) {
    addDescriptor('มีการดื่มแอลกอฮอล์');
  }
  if (/สูบบุหรี่|บุหรี่|ควันบุหรี่|ซิการ์|\bsmok(?:e|ing)\b/i.test(textCorpus)) {
    addDescriptor('มีการสูบบุหรี่');
  }
  if (!hasHate && /คำหยาบ|ภาษาหยาบคาย|ด่าทอ|\bprofanit/i.test(textCorpus)) {
    addDescriptor('ภาษาหยาบคาย');
  }

  const hasFlashingWarning = /ไฟกะพริบ|แสงกะพริบ|แสงแฟลช|สโตรบ|\bstrobe\b|\bflashing\s+light|\bphotosensitiv/i.test(textCorpus);
  if (hasFlashingWarning) {
    addDescriptor('ไฟกะพริบและรูปแบบการสโตรบิงอาจส่งผลต่อผู้ดูที่ไวแสงได้');
  }

  if (descriptors.length === 0 && ratingBadge.code !== 'all') {
    const fallbackByCode = {
      mature: 'เนื้อหาสำหรับผู้ใหญ่ จำกัดเฉพาะผู้ชมที่มีอายุ 18 ปีขึ้นไป',
      '18+': 'เนื้อหาเหมาะสำหรับผู้ชมที่มีอายุ 18 ปีขึ้นไป',
      '16+': 'เนื้อหาเหมาะสำหรับผู้ชมที่มีอายุ 16 ปีขึ้นไป',
      '13+': 'เนื้อหาเหมาะสำหรับผู้ชมที่มีอายุ 13 ปีขึ้นไป',
    };
    addDescriptor(fallbackByCode[ratingBadge.code]);
  }

  return {
    ratingBadge,
    headerBadge: ratingBadge.code !== 'all' ? ratingBadge : null,
    hasFlashingWarning,
    flashingTooltip: 'คำเตือนความไวต่อแสง: อาจมีไฟกะพริบหรือแสงสโตรบิง',
    descriptors,
    descriptorText: descriptors.join(', '),
    shouldShowExpanded: Boolean(ratingBadge.code !== 'all' || descriptors.length > 0 || hasFlashingWarning),
  };
}
