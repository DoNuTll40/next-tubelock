import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractContentAdvisory,
  extractWatchMediaCapabilities,
  parseMasterStreamCapabilities,
} from '../src/lib/mediaBadges.mjs';

test('extractWatchMediaCapabilities emits ordered 4K Dolby Vision, HDR, Hi-Res, 5.1, and CC badges with device notes', () => {
  const video = {
    resolution: '3840x2160',
    audio_channels: 6,
    subtitle_tracks: [{ id: 'th', label: 'ไทย' }, { id: 'en', label: 'English' }],
    ready_qualities: [
      {
        name: '144p',
        width: 256,
        height: 144,
        is_hdr: false,
        audio_channels: 6,
        audio_layout: '5.1(side)',
        hires_audio: { file: 'audio_hires.flac', format: 'flac', bits: 24, rate: 96000 },
      },
      {
        name: '2160p_hdr',
        width: 3840,
        height: 2160,
        is_hdr: true,
        hdr_type: 'PQ',
      },
      {
        name: '2160p_dolby_vision',
        width: 3840,
        height: 2160,
        is_hdr: true,
        hdr_type: 'PQ',
        dolby_vision: {
          supplementalCodecs: 'dvh1.08.06/db1p',
          videoRange: 'PQ',
        },
      },
    ],
  };

  const supported = extractWatchMediaCapabilities(video, {
    deviceSupport: { hdr: true, dolbyVision: () => true },
  });
  assert.deepEqual(
    supported.badges.map((b) => b.id),
    ['dolby-vision', 'hdr', 'uhd', 'hires', 'surround', 'cc'],
  );
  assert.equal(supported.badges[0].kind, 'dolby');
  assert.equal(supported.badges[0].sublabel, 'VISION');
  assert.match(supported.badges[0].tooltip, /Dolby Vision Profile 8\.1 \(PQ\)/);
  assert.match(supported.badges[0].tooltip, /อุปกรณ์และเบราว์เซอร์นี้รองรับ/);
  assert.equal(supported.badges[1].label, 'HDR');
  assert.equal(supported.badges[2].label, 'UHD');
  assert.equal(supported.badges[3].label, 'Hi-Res');
  assert.match(supported.badges[3].tooltip, /24-bit \/ 96 kHz FLAC/);
  assert.equal(supported.badges[4].label, '5.1');
  assert.equal(supported.badges[5].label, 'CC');
  assert.match(supported.badges[5].tooltip, /ไทย, English/);

  const unsupported = extractWatchMediaCapabilities(video, {
    deviceSupport: { hdr: false, dolbyVision: () => false },
  });
  assert.equal(unsupported.badges[0].unsupportedOnDevice, true);
  assert.match(unsupported.badges[0].tooltip, /เล่นชั้นภาพมาตรฐานแทน/);
  assert.equal(unsupported.badges[1].unsupportedOnDevice, true);
  assert.match(unsupported.badges[1].tooltip, /เล่นโหมด SDR แทน/);
});

test('extractWatchMediaCapabilities detects ultrawide 4K HDR + Dolby Atmos JOC and reflects browser E-AC-3 support', () => {
  const video = {
    resolution: '3840x1920',
    audio_channels: 6,
    ready_qualities: [
      {
        name: '1080p_hdr',
        width: 1920,
        height: 960,
        is_hdr: true,
        hdr_type: 'PQ',
        audio_channels: 6,
        audio_layout: '5.1(side)',
      },
      {
        name: '1920p_atmos',
        width: 3840,
        height: 1920,
        is_hdr: true,
        hdr_type: 'PQ',
        audio_channels: 6,
        audio_layout: '5.1(side)',
        atmos_audio: { complexity: 16, fps: 23.976, videoCodec: 'hvc1.2.4.L150.B0' },
      },
    ],
  };

  const withAtmos = extractWatchMediaCapabilities(video, {
    deviceSupport: { hdr: true, atmos: (vc) => vc === 'hvc1.2.4.L150.B0' },
  });
  assert.deepEqual(
    withAtmos.badges.map((b) => b.id),
    ['hdr', 'uhd', 'dolby-atmos', 'surround'],
  );
  assert.equal(withAtmos.badges[2].sublabel, 'ATMOS');
  assert.equal(withAtmos.badges[2].unsupportedOnDevice, false);
  assert.match(withAtmos.badges[2].tooltip, /Dolby Atmos \(DD\+ JOC 16-obj\)/);
  assert.match(withAtmos.badges[2].tooltip, /เปิดแทร็ก Atmos ได้ในเมนูคุณภาพเสียง/);

  const withoutAtmos = extractWatchMediaCapabilities(video, {
    deviceSupport: { hdr: true, atmos: () => false },
  });
  assert.equal(withoutAtmos.badges[2].unsupportedOnDevice, true);
  assert.match(withoutAtmos.badges[2].tooltip, /ไม่รองรับ E-AC-3/);
});

test('extractWatchMediaCapabilities isolates activeVersion capabilities on multi-version videos', () => {
  const video = {
    resolution: '3840x2160',
    ready_qualities: [
      { name: '2160p_dolby_vision', width: 3840, height: 2160, is_hdr: true, hdr_type: 'PQ', dolby_vision: { supplementalCodecs: 'dvh1.08.06/db1p', videoRange: 'PQ' } },
    ],
    versions: [
      { id: 1, versionKey: 'imax', isDefault: true, resolution: '3840x2160' },
      { id: 2, versionKey: 'standard', isDefault: false, resolution: '1920x1080' },
    ],
  };

  const standardVersion = {
    id: 2,
    versionKey: 'standard',
    isDefault: false,
    resolution: '1920x1080',
    audio_channels: 2,
    ready_qualities: [{ name: '1080p', width: 1920, height: 1080, is_hdr: false, audio_channels: 2 }],
  };

  const result = extractWatchMediaCapabilities(video, { activeVersion: standardVersion });
  assert.deepEqual(result.badges.map((b) => b.label), ['FHD']);
});

test('parseMasterStreamCapabilities provides live fallback for Dolby Vision, HLG, Dolby Atmos, and UHD', () => {
  const master = [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="tubelock-atmos",NAME="Dolby Atmos",DEFAULT=YES,AUTOSELECT=YES,CHANNELS="16/JOC"',
    '#EXT-X-STREAM-INF:BANDWIDTH=12000000,RESOLUTION=3840x2160,CODECS="hvc1.2.4.L153.B0,mp4a.40.2",SUPPLEMENTAL-CODECS="dvh1.08.09/db4h",VIDEO-RANGE=HLG',
    '2160p_dolby_vision.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=3840x1920,CODECS="hvc1.2.4.L150.B0,ec-3",VIDEO-RANGE=HLG,AUDIO="tubelock-atmos"',
    '1920p_atmos.m3u8',
  ].join('\n');

  const caps = parseMasterStreamCapabilities(master);
  assert.equal(caps.maxWidth, 3840);
  assert.equal(caps.maxHeight, 2160);
  assert.deepEqual(caps.dolbyVision, { codec: 'dvh1.08.09', profile: '8.4', videoRange: 'HLG' });
  assert.equal(caps.hdrType, 'HLG');
  assert.deepEqual(caps.atmos, { complexity: 16, videoCodec: 'hvc1.2.4.L150.B0' });

  const fallback = extractWatchMediaCapabilities(
    { resolution: '' },
    { streamMeta: { channels: 6, layout: '5.1', capabilities: caps } },
  );
  assert.deepEqual(
    fallback.badges.map((b) => b.id),
    ['dolby-vision', 'hdr', 'uhd', 'dolby-atmos', 'surround'],
  );
  assert.equal(fallback.badges[1].label, 'HLG');
});

test('extractContentAdvisory maps age rating, AI safety scores, and flashing-lights warning accurately', () => {
  const advisory18 = extractContentAdvisory({
    content_rating: '18+',
    vision_analysis: {
      safetyScores: [
        { name: 'Sexual Content', status: 'HIGH' },
        { name: 'Violence / Gore', status: 'MEDIUM' },
        { name: 'Hate Speech', status: 'NONE' },
        { name: 'Dangerous Content', status: 'SAFE' },
      ],
      recommendedTags: ['alcohol', 'smoking', 'คำหยาบ'],
      summary: 'มีฉากดื่มแอลกอฮอล์ สูบบุหรี่ และไฟกะพริบสโตรบิงตลอดฉากคอนเสิร์ต',
    },
  });

  assert.equal(advisory18.headerBadge?.label, '18+');
  assert.equal(advisory18.hasFlashingWarning, true);
  assert.equal(advisory18.shouldShowExpanded, true);
  assert.match(advisory18.descriptorText, /ภาพเปลือยหรือเนื้อหาทางเพศชัดเจน/);
  assert.match(advisory18.descriptorText, /ความรุนแรง/);
  assert.match(advisory18.descriptorText, /มีการดื่มแอลกอฮอล์/);
  assert.match(advisory18.descriptorText, /มีการสูบบุหรี่/);
  assert.match(advisory18.descriptorText, /ภาษาหยาบคาย/);
  assert.ok(advisory18.descriptors.at(-1) === 'ไฟกะพริบและรูปแบบการสโตรบิงอาจส่งผลต่อผู้ดูที่ไวแสงได้');

  const cleanAll = extractContentAdvisory({
    content_rating: 'all',
    vision_analysis: {
      safetyScores: [
        { name: 'Sexual Content', status: 'SAFE (Negligible)' },
        { name: 'Violence / Gore', status: 'SAFE (Negligible)' },
        { name: 'Hate Speech', status: 'NONE' },
        { name: 'Dangerous Content', status: 'SAFE' },
      ],
      summary: 'วิดีโอสารคดีธรรมชาติเหมาะสำหรับทุกวัย',
    },
  });
  assert.equal(cleanAll.headerBadge, null);
  assert.equal(cleanAll.hasFlashingWarning, false);
  assert.equal(cleanAll.shouldShowExpanded, false);

  const matureFallback = extractContentAdvisory({ content_rating: 'mature' });
  assert.equal(matureFallback.headerBadge?.label, 'R 18+');
  assert.equal(matureFallback.shouldShowExpanded, true);
  assert.ok(matureFallback.descriptorText.length > 0);
});
