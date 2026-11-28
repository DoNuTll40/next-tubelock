import assert from 'node:assert/strict';
import { resolveObjectURL } from 'node:buffer';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { compileFunction } from 'node:vm';
import { buildDolbyVisionHlsArgs, getDolbyVisionSource } from '../scripts/dolby-vision.mjs';
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
