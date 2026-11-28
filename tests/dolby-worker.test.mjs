import assert from 'node:assert/strict';
import { resolveObjectURL } from 'node:buffer';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { compileFunction } from 'node:vm';
import { buildDolbyVisionHlsArgs, formatHevcCodec, getDolbyVisionSource, readHevcConfiguration } from '../scripts/dolby-vision.mjs';
import { resolveClientPlaybackSource } from '../src/lib/playbackResolver.js';

// The worker starts a real transcode on import. Load its functions with isolated I/O.
const source = readFileSync(new URL('../scripts/transcode-worker.js', import.meta.url), 'utf8');
function loadWorker(names, dependencies) {
  const functions = names.map((name) => {
    const match = source.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, 'm'));
    assert.ok(match, `Missing worker function ${name}`);
    return match[0];
  });
  const body = `${functions.join('\n')}\nreturn { ${names.join(', ')} };`;
  return compileFunction(body, Object.keys(dependencies))(...Object.values(dependencies));
}

test('the worker distinguishes eligible Dolby sources, dual-layer Profile 4 and ordinary HDR10', () => {
  const { parseProbeMeta } = loadWorker([
    'parseProbeMeta', 'resolveAudioProfile', 'extractHdr10Metadata', 'parseRatioNum',
  ], { getDolbyVisionSource });
  const video = {
    codec_type: 'video', codec_name: 'hevc', profile: 'Main 10',
    width: 3840, height: 2160, pix_fmt: 'yuv420p10le', r_frame_rate: '24000/1001',
    color_primaries: 'bt2020', color_space: 'bt2020nc', color_transfer: 'smpte2084',
  };
  const config = {
    side_data_type: 'DOVI configuration record', dv_profile: 8, dv_level: 6,
    bl_present_flag: 1, el_present_flag: 0, rpu_present_flag: 1, dv_bl_signal_compatibility_id: 1,
  };
  const parse = (changes) => parseProbeMeta({ streams: [{ ...video, ...changes }] });
  const pq = parse({ side_data_list: [config] });
  assert.equal(pq.isHdr, true);
  assert.equal(pq.dolbyVision.supported, true);
  assert.equal(pq.dolbyVision.videoRange, 'PQ');
  const hlg = parse({ color_transfer: 'arib-std-b67', side_data_list: [{ ...config, dv_bl_signal_compatibility_id: 4 }] });
  assert.equal(hlg.dolbyVision.supported, true);
  assert.equal(hlg.hdrType, 'HLG');
  const dualLayer = parse({ side_data_list: [{ ...config, dv_profile: 4, el_present_flag: 1, dv_bl_signal_compatibility_id: 0 }] });
  assert.equal(dualLayer.dolbyVision.supported, false);
  assert.equal(parse({}).dolbyVision, null);
});

test('ineligible sources skip packaging and failed output validation prevents publication', async () => {
  let muxCount = 0;
  const { publishDolbyVisionRendition } = loadWorker(['publishDolbyVisionRendition', 'buildAudioEncodeArgs'], {
    path, buildDolbyVisionHlsArgs, updateLaneProgress: async () => {},
    runFFmpeg: async () => { muxCount += 1; },
    validateDolbyVisionHls: async () => { throw Error('Missing RPU'); },
    uploadBatchFilesAndCleanup: () => assert.fail('Uploaded unverified media'),
    registerQualitiesAndPublishMaster: () => assert.fail('Published unverified media'),
  });
  const ctx = { hlsOutputDir: 'work', rawFilePath: 'source.mkv' };
  await publishDolbyVisionRendition({ ...ctx, meta: { dolbyVision: null } });
  await publishDolbyVisionRendition({ ...ctx, meta: { dolbyVision: { profile: 4, supported: false } } });
  assert.equal(muxCount, 0);
  await assert.rejects(publishDolbyVisionRendition({ ...ctx, meta: {
    srcWidth: 3840, srcHeight: 2160, dolbyVision: { supported: true, compatibilityId: 1 },
  } }), /Missing RPU/);
  assert.equal(muxCount, 1);
});

test('a valid Dolby track with misaligned adaptive segments is held back', async () => {
  const { publishDolbyVisionRendition } = loadWorker(['publishDolbyVisionRendition', 'buildAudioEncodeArgs'], {
    path, buildDolbyVisionHlsArgs, updateLaneProgress: async () => {}, runFFmpeg: async () => {},
    validateDolbyVisionHls: async () => ({ segmentStarts: [0, 4.41] }),
    fs: { promises: { readFile: async () => '#EXTM3U\n#EXTINF:4.0,\nfirst.m4s\n#EXTINF:4.0,\nsecond.m4s\n' } },
    uploadBatchFilesAndCleanup: () => assert.fail('Uploaded unaligned segments'),
    registerQualitiesAndPublishMaster: () => assert.fail('Advertised an unaligned variant'),
  });
  await assert.rejects(publishDolbyVisionRendition({
    hlsOutputDir: 'work', rawFilePath: 'input.mov',
    meta: { fps: 29.97, srcHeight: 1080, dolbyVision: { supported: true, compatibilityId: 4 } },
  }), /segment 2 start at different times/);
});

for (const settings of [
  { label: 'main upload', versionNum: null, table: 'videos', audioChannels: 2, range: 'PQ', brand: 'db1p' },
  { label: 'Studio version', versionNum: 7, table: 'video_versions', audioChannels: 0, range: 'HLG', brand: 'db4h' },
]) {
  test(`${settings.label} preserves verified Dolby attributes through DB, master and playback resolver`, async (t) => {
    const run = 'run-123';
    const name = '2160p_dolby_vision';
    const base = { width: 3840, height: 2160, audio_channels: settings.audioChannels };
    const fallback = { ...base, name: '2160p_sdr', bitrate: 6000000, is_fmp4: true, run_id: run };
    const videoCodec = 'hvc1.2.4.L153.B0';
    const dolby = {
      codecs: settings.audioChannels ? `${videoCodec},mp4a.40.2` : videoCodec,
      supplementalCodecs: `dvh1.08.06/${settings.brand}`, videoRange: settings.range,
      averageBandwidth: 12800000, fps: 23.976,
    };
    const rows = [fallback];
    let written = '';
    let published = '';
    const sql = (strings, ...values) => {
      const statement = strings.join('?').trim();
      if (statement.startsWith('UPDATE')) {
        assert.match(statement, new RegExp(`^UPDATE ${settings.table}\\b`));
        const payload = values.find((value) => typeof value === 'string' && value.startsWith('[{'));
        rows.push(...JSON.parse(payload));
      } else {
        assert.match(statement, new RegExp(`^SELECT ready_qualities FROM ${settings.table}\\b`));
      }
      return [{ ready_qualities: JSON.stringify(rows) }];
    };
    const worker = loadWorker([
      'normalizeQualitiesList', 'readRunQualitiesFromDb', 'registerQualitiesAndPublishMaster', 'buildMasterM3U8',
    ], {
      sql, path, TRANSCODE_RUN_ID: run, versionNum: settings.versionNum, vidNum: 42,
      ensureDbSchemaOnce: async () => {},
      fs: { writeFileSync: (_file, value) => { written = value; } },
      uploadFileToOneDrive: async () => { published = written; },
    });

    const files = [`init_${name}.mp4`, `stream_${name}_000.m4s`, `${name}.m3u8`];
    const calls = [];
    const { publishDolbyVisionRendition } = loadWorker(['publishDolbyVisionRendition', 'buildAudioEncodeArgs'], {
      path, buildDolbyVisionHlsArgs, updateLaneProgress: async () => {}, logger: { log: async () => {} },
      fs: { promises: { readFile: async () => '#EXTM3U\n#EXTINF:4.0,\nfallback.m4s\n' } },
      runFFmpeg: async () => { calls.push('mux'); },
      validateDolbyVisionHls: async () => {
        calls.push('validate');
        return { files, segmentStarts: [0], bandwidth: 15600000, averageBandwidth: dolby.averageBandwidth,
          codecs: videoCodec, audioCodec: settings.audioChannels ? 'mp4a.40.2' : null,
          videoRange: settings.range, supplementalCodecs: dolby.supplementalCodecs };
      },
      uploadBatchFilesAndCleanup: async (_drive, _folder, _dir, batch) => {
        assert.deepEqual(batch, files);
        calls.push('upload');
      },
      registerQualitiesAndPublishMaster: worker.registerQualitiesAndPublishMaster,
    });
    const meta = {
      srcWidth: base.width, srcHeight: base.height, duration: 4, fps: dolby.fps,
      hasAudio: Boolean(settings.audioChannels), audioChannels: settings.audioChannels,
      audioLayout: settings.audioChannels ? 'stereo' : 'none', audioBitrateK: 192,
      dolbyVision: { supported: true, compatibilityId: settings.range === 'PQ' ? 1 : 4 },
    };
    await publishDolbyVisionRendition({ driveId: 'drive', streamFolderId: 'folder', hlsOutputDir: 'work', rawFilePath: 'source.mkv', meta });
    assert.deepEqual(calls, ['mux', 'validate', 'upload']);
    const merged = await worker.readRunQualitiesFromDb();
    assert.deepEqual(merged.find((item) => item.name === name)?.dolby_vision, dolby);
    assert.equal(published, worker.buildMasterM3U8(merged));
    const lines = published.trim().split(/\r?\n/);
    const info = lines[lines.indexOf(`${name}.m3u8`) - 1];
    assert.ok(info.startsWith('#EXT-X-STREAM-INF:'));
    assert.ok(info.includes(`CODECS="${dolby.codecs}"`));
    assert.ok(info.includes(`SUPPLEMENTAL-CODECS="${dolby.supplementalCodecs}"`));
    assert.ok(info.includes(`VIDEO-RANGE=${settings.range}`));
    assert.match(info, /[:,]BANDWIDTH=15600000(?:,|$)/);
    assert.match(info, /,AVERAGE-BANDWIDTH=12800000(?:,|$)/);
    assert.match(info, /,FRAME-RATE=23\.976(?:,|$)/);
    assert.equal(lines.filter((line) => line.includes('SUPPLEMENTAL-CODECS')).length, 1);

    const media = '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4.0,\nchunk.m4s\n#EXT-X-ENDLIST\n';
    const resolved = await resolveClientPlaybackSource({ type: 'hls', items: [
      { name: 'master.m3u8', content: published },
      { name: `${name}.m3u8`, content: media },
      { name: `${fallback.name}.m3u8`, content: media },
      { name: 'init.mp4', downloadUrl: 'https://example.test/init.mp4' },
      { name: 'chunk.m4s', downloadUrl: 'https://example.test/chunk.m4s' },
    ] });
    t.after(() => resolved.blobUrls.forEach((url) => URL.revokeObjectURL(url)));
    const playback = (await resolveObjectURL(resolved.url).text()).split('\n');
    assert.ok(playback.includes(info));
    const rendition = await resolveObjectURL(playback[playback.indexOf(info) + 1]).text();
    assert.match(rendition, /#EXT-X-MAP:URI="https:\/\/example\.test\/init\.mp4"/);
    assert.match(rendition, /^https:\/\/example\.test\/chunk\.m4s$/m);
  });
}

function makeBox(type, payload) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + payload.length, 0);
  header.write(type, 4, 'ascii');
  return Buffer.concat([header, payload]);
}

function makeAtmosInit({ includeDec3 = true, jocFlag = 1, complexity = 16, truncateDec3 = false } = {}) {
  const hvccPayload = Buffer.alloc(23);
  hvccPayload[0] = 1; // configurationVersion
  hvccPayload[1] = 0x02; // general_profile_idc = 2 (Main 10), tier L
  hvccPayload.writeUInt32BE(0x20000000, 2); // compatibility flags
  hvccPayload[6] = 0xB0; // constraint indicator
  hvccPayload[12] = 150; // level 5.0 (L150)

  const hvc1Header = Buffer.alloc(78);
  const hvc1Box = makeBox('hvc1', Buffer.concat([hvc1Header, makeBox('hvcC', hvccPayload)]));
  const stsdHeader = Buffer.alloc(8);
  stsdHeader.writeUInt32BE(1, 4);
  const stsdBox = makeBox('stsd', Buffer.concat([stsdHeader, hvc1Box]));
  const videoMoov = makeBox('moov', makeBox('trak', makeBox('mdia', makeBox('minf', makeBox('stbl', stsdBox)))));

  if (!includeDec3) return videoMoov;

  // dec3: 2-byte header (data_rate + num_ind_sub=0 -> 1 independent stream) + 3-byte substream + 2-byte JOC
  const dec3Payload = truncateDec3
    ? Buffer.from([0x06, 0x00, 0x08])
    : Buffer.from([0x06, 0x00, 0x08, 0x00, 0x00, jocFlag, complexity]);
  return Buffer.concat([videoMoov, makeBox('dec3', dec3Payload)]);
}

test('parseProbeMeta detects DD+ JOC Atmos on non-Dolby HEVC and rejects ineligible streams', () => {
  const { parseProbeMeta } = loadWorker([
    'parseProbeMeta', 'resolveAudioProfile', 'extractHdr10Metadata', 'parseRatioNum',
  ], {
    getDolbyVisionSource,
    LOSSLESS_AUDIO_CODEC_RE: /^(?:pcm_|flac|alac|truehd|mlp|wavpack|ape|tta|tak|dsd_|shorten|wmalossless)/i,
  });
  const hevcVideo = {
    codec_type: 'video', codec_name: 'hevc', profile: 'Main 10',
    width: 3840, height: 1920, pix_fmt: 'yuv420p10le', r_frame_rate: '24000/1001',
    color_primaries: 'bt2020', color_space: 'bt2020nc', color_transfer: 'smpte2084',
  };
  const atmosAudio = {
    codec_type: 'audio', codec_name: 'eac3', profile: 'Dolby Digital Plus + Dolby Atmos',
    channels: 6, channel_layout: '5.1(side)',
  };

  assert.equal(parseProbeMeta({ streams: [hevcVideo, atmosAudio] }).hasAtmos, true);
  assert.equal(parseProbeMeta({ streams: [hevcVideo, { ...atmosAudio, codec_name: 'truehd', profile: 'Dolby TrueHD + Dolby Atmos' }] }).hasAtmos, false);
  assert.equal(parseProbeMeta({ streams: [hevcVideo, { ...atmosAudio, profile: 'Dolby Digital Plus' }] }).hasAtmos, false);
  assert.equal(parseProbeMeta({ streams: [{ ...hevcVideo, codec_name: 'h264' }, atmosAudio] }).hasAtmos, false);
  assert.equal(parseProbeMeta({
    streams: [{
      ...hevcVideo,
      side_data_list: [{
        side_data_type: 'DOVI configuration record', dv_profile: 8, dv_level: 6,
        bl_present_flag: 1, el_present_flag: 0, rpu_present_flag: 1, dv_bl_signal_compatibility_id: 1,
      }],
    }, atmosAudio],
  }).hasAtmos, false);
});

test('publishAtmosAudio skips ineligible sources and rejects missing, truncated, or non-JOC dec3', async () => {
  let muxCalls = 0;
  let currentInit = Buffer.alloc(0);
  const { publishAtmosAudio } = loadWorker(['publishAtmosAudio'], {
    path,
    formatHevcCodec,
    readHevcConfiguration,
    updateLaneProgress: async () => {},
    runFFmpeg: async () => { muxCalls += 1; },
    fs: { promises: { readFile: async () => currentInit } },
    uploadBatchFilesAndCleanup: () => assert.fail('Uploaded unverified Atmos media'),
    registerQualitiesAndPublishMaster: () => assert.fail('Published unverified Atmos media'),
  });

  await publishAtmosAudio({ hlsOutputDir: 'work', rawFilePath: 'source.mkv', meta: { hasAtmos: false } });
  assert.equal(muxCalls, 0);

  for (const [initOpts, expectedError] of [
    [{ includeDec3: false }, /Missing Dolby Digital Plus configuration/],
    [{ truncateDec3: true }, /Truncated Dolby Digital Plus substream configuration/],
    [{ jocFlag: 0, complexity: 16 }, /missing Dolby Atmos JOC configuration/i],
    [{ jocFlag: 1, complexity: 0 }, /missing Dolby Atmos JOC configuration/i],
  ]) {
    currentInit = makeAtmosInit(initOpts);
    await assert.rejects(
      publishAtmosAudio({
        hlsOutputDir: 'work',
        rawFilePath: 'source.mkv',
        meta: { hasAtmos: true, srcWidth: 3840, srcHeight: 1920, duration: 48 },
      }),
      expectedError,
    );
  }
  assert.equal(muxCalls, 4);
});

for (const settings of [
  { label: 'main upload', versionNum: null, table: 'videos' },
  { label: 'Studio version', versionNum: 7, table: 'video_versions' },
]) {
  test(`${settings.label} publishes verified Dolby Atmos attributes through DB, master, and playback resolver`, async (t) => {
    const run = 'run-atmos-1';
    const base = { width: 3840, height: 1920, audio_channels: 6, audio_layout: '5.1(side)' };
    const fallback = { ...base, name: '1080p', width: 1920, height: 960, bitrate: 4500000, is_fmp4: true, is_hdr: true, hdr_type: 'PQ', run_id: run };
    const rows = [fallback];
    let written = '';
    let published = '';

    const sql = (strings, ...values) => {
      const statement = strings.join('?').trim();
      if (statement.startsWith('UPDATE')) {
        assert.match(statement, new RegExp(`^UPDATE ${settings.table}\\b`));
        const payload = values.find((value) => typeof value === 'string' && value.startsWith('[{'));
        rows.push(...JSON.parse(payload));
      } else {
        assert.match(statement, new RegExp(`^SELECT ready_qualities FROM ${settings.table}\\b`));
      }
      return [{ ready_qualities: JSON.stringify(rows) }];
    };

    const worker = loadWorker([
      'normalizeQualitiesList', 'readRunQualitiesFromDb', 'registerQualitiesAndPublishMaster', 'buildMasterM3U8',
    ], {
      sql, path, TRANSCODE_RUN_ID: run, versionNum: settings.versionNum, vidNum: 42,
      ensureDbSchemaOnce: async () => {},
      fs: { writeFileSync: (_file, value) => { written = value; } },
      uploadFileToOneDrive: async () => { published = written; },
    });

    const initBuffer = makeAtmosInit({ complexity: 16 });
    const expectedVideoCodec = formatHevcCodec(readHevcConfiguration(initBuffer));
    const playlistName = '1920p_atmos.m3u8';
    const mediaPlaylist = '#EXTM3U\n#EXT-X-MAP:URI="init_atmos.mp4"\n#EXTINF:4.0,\natmos_000.m4s\n#EXT-X-ENDLIST\n';
    const progressEvents = [];
    const calls = [];

    const { publishAtmosAudio } = loadWorker(['publishAtmosAudio'], {
      path,
      formatHevcCodec,
      readHevcConfiguration,
      updateLaneProgress: async (evt) => { progressEvents.push(evt); },
      logger: { log: async () => {} },
      runFFmpeg: async () => { calls.push('mux'); },
      fs: {
        promises: {
          readFile: async (filePath) => (filePath.endsWith('init_atmos.mp4') ? initBuffer : mediaPlaylist),
          stat: async () => ({ size: 2500000 }),
        },
      },
      uploadBatchFilesAndCleanup: async (_drive, _folder, _dir, batch) => {
        assert.deepEqual(batch, ['init_atmos.mp4', 'atmos_000.m4s', playlistName]);
        calls.push('upload');
      },
      registerQualitiesAndPublishMaster: worker.registerQualitiesAndPublishMaster,
    });

    await publishAtmosAudio({
      driveId: 'drive',
      streamFolderId: 'folder',
      hlsOutputDir: 'work',
      rawFilePath: 'EAC3-JOC ATMOS.mkv',
      meta: {
        hasAtmos: true,
        srcWidth: base.width,
        srcHeight: base.height,
        duration: 48,
        fps: 23.976,
        isHdr: true,
        hdrType: 'PQ',
        audioChannels: base.audio_channels,
        audioLayout: base.audio_layout,
      },
    });

    assert.deepEqual(calls, ['mux', 'upload']);
    assert.equal(progressEvents[0].lanePct, 98);
    assert.equal(progressEvents.at(-1).lanePct, 100);
    assert.equal(progressEvents.at(-1).invalidateCache, true);

    const merged = await worker.readRunQualitiesFromDb();
    assert.deepEqual(merged.find((item) => item.name === '1920p_atmos')?.atmos_audio, {
      complexity: 16,
      fps: 23.976,
      videoCodec: expectedVideoCodec,
    });
    assert.equal(published, worker.buildMasterM3U8(merged));

    const lines = published.trim().split(/\r?\n/);
    const mediaTag = '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="tubelock-atmos",NAME="Dolby Atmos",DEFAULT=YES,AUTOSELECT=YES,CHANNELS="16/JOC"';
    const streamTag = `#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=3840x1920,FRAME-RATE=23.976,CODECS="${expectedVideoCodec},ec-3",VIDEO-RANGE=PQ,AUDIO="tubelock-atmos"`;
    assert.ok(lines.includes(mediaTag));
    assert.ok(!mediaTag.includes('URI='));
    assert.equal(lines[lines.indexOf(playlistName) - 1], streamTag);

    const resolved = await resolveClientPlaybackSource({
      type: 'hls',
      items: [
        { name: 'master.m3u8', content: published },
        { name: playlistName, content: mediaPlaylist },
        { name: `${fallback.name}.m3u8`, content: mediaPlaylist },
        { name: 'init_atmos.mp4', downloadUrl: 'https://example.test/init_atmos.mp4' },
        { name: 'atmos_000.m4s', downloadUrl: 'https://example.test/atmos_000.m4s' },
      ],
    });
    t.after(() => resolved.blobUrls.forEach((url) => URL.revokeObjectURL(url)));
    const playback = (await resolveObjectURL(resolved.url).text()).split('\n');
    assert.ok(playback.includes(mediaTag));
    assert.ok(playback.includes(streamTag));
    const rendition = await resolveObjectURL(playback[playback.indexOf(streamTag) + 1]).text();
    assert.match(rendition, /#EXT-X-MAP:URI="https:\/\/example\.test\/init_atmos\.mp4"/);
    assert.match(rendition, /^https:\/\/example\.test\/atmos_000\.m4s$/m);
  });
}

test('registerQualitiesAndPublishMaster recovers from concurrent 409 resourceModified and publishes merged master.m3u8', async () => {
  const run = 'run-409';
  const base = { width: 1280, height: 720, bitrate: 3500000, is_fmp4: true, audio_channels: 2, run_id: run };
  const competing = { name: '1080p', width: 1920, height: 1080, bitrate: 8500000, is_fmp4: true, audio_channels: 2, run_id: run };
  const rows = [];
  let uploadCalls = 0;
  let writtenMaster = '';
  let publishedMaster = '';

  const sql = (strings, ...values) => {
    const statement = strings.join('?').trim();
    if (statement.startsWith('UPDATE')) {
      const payload = values.find((value) => typeof value === 'string' && value.startsWith('[{'));
      rows.push(...JSON.parse(payload));
      return [{ ready_qualities: JSON.stringify(rows) }];
    }
    return [{ ready_qualities: JSON.stringify(rows) }];
  };

  const { registerQualitiesAndPublishMaster } = loadWorker([
    'normalizeQualitiesList', 'readRunQualitiesFromDb', 'registerQualitiesAndPublishMaster', 'buildMasterM3U8',
  ], {
    sql,
    path,
    TRANSCODE_RUN_ID: run,
    versionNum: null,
    vidNum: 906,
    ensureDbSchemaOnce: async () => {},
    fs: { writeFileSync: (_file, content) => { writtenMaster = content; } },
    uploadFileToOneDrive: async () => {
      uploadCalls += 1;
      if (uploadCalls === 1) {
        rows.push(competing);
        throw new Error('Failed to upload master.m3u8 (409): {"error":{"code":"resourceModified"}}');
      }
      publishedMaster = writtenMaster;
    },
  });

  const merged = await registerQualitiesAndPublishMaster('drive', 'folder', 'work', [{ ...base, name: '720p' }]);
  assert.equal(uploadCalls, 2);
  assert.deepEqual(merged.map((q) => q.name), ['720p', '1080p']);
  assert.match(publishedMaster, /^720p\.m3u8$/m);
  assert.match(publishedMaster, /^1080p\.m3u8$/m);
});
