import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    buildDolbyVisionHlsArgs, formatHevcCodec, getDolbyVisionSource, hasVerifiedAacLcTrack, validateDolbyVisionHls,
} from '../scripts/dolby-vision.mjs';

const record = {
    side_data_type: 'DOVI configuration record', dv_profile: 8, dv_level: 6,
    dv_bl_signal_compatibility_id: 1, bl_present_flag: 1, el_present_flag: 0, rpu_present_flag: 1,
};

function videoStream(config = {}, stream = {}) {
    return { codec_name: 'hevc', profile: 'Main 10', color_transfer: 'smpte2084', side_data_list: [{ ...record, ...config }], ...stream };
}

test('Dolby packaging requires a single HEVC layer, an RPU and its matching PQ or HLG base', () => {
    assert.equal(getDolbyVisionSource({ codec_name: 'hevc', color_transfer: 'smpte2084' }), null);
    assert.equal(getDolbyVisionSource(videoStream()).supplementalCodecs, 'dvh1.08.06/db1p');
    const hlg = getDolbyVisionSource(videoStream({ dv_bl_signal_compatibility_id: 4 }, { color_transfer: 'arib-std-b67' }));
    assert.equal(hlg.videoRange, 'HLG');
    assert.equal(hlg.supplementalCodecs, 'dvh1.08.06/db4h');
    for (const unsupported of [
        videoStream({ dv_profile: 4, dv_bl_signal_compatibility_id: 0, el_present_flag: 1 }),
        videoStream({ dv_profile: 5 }), videoStream({ dv_profile: 7 }),
        videoStream({ rpu_present_flag: 0 }), videoStream({ bl_present_flag: 0 }),
        videoStream({ el_present_flag: 1 }), videoStream({ dv_level: 14 }),
        videoStream({}, { profile: 'Main' }),
        videoStream({ dv_bl_signal_compatibility_id: 4 }), videoStream({}, { codec_name: 'h264' }),
    ]) {
        const source = getDolbyVisionSource(unsupported);
        assert.equal(source.supported, false);
        assert.equal(source.supplementalCodecs, null);
        assert.throws(() => buildDolbyVisionHlsArgs('source', 'out', { dolbyVision: source }), /Unsupported/);
    }
});

test('HEVC codec strings reflect the actual hvcC profile, tier, compatibility and constraints', () => {
    const config = Buffer.alloc(23);
    config.set([1, 2, 0x20, 0, 0, 0, 0xB0, 0, 0, 0, 0, 0, 153]);
    assert.equal(formatHevcCodec(config), 'hvc1.2.4.L153.B0');
    config[1] = 0x62;
    config[7] = 0x0C;
    assert.equal(formatHevcCodec(config), 'hvc1.A2.4.H153.B0.0C');
});

async function testDirectory(t) {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'tubelock-dv-test-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    return dir;
}

test('a truncated or incomplete local Dolby playlist is rejected before publication', async (t) => {
    const playlistPath = path.join(await testDirectory(t), 'dv.m3u8');
    await writeFile(playlistPath, '#EXTM3U\n#EXT-X-ENDLIST\n');
    await assert.rejects(validateDolbyVisionHls({ playlistPath, dolbyVision: getDolbyVisionSource(videoStream()) }), /playlist/);
});

function makeMp4Box(type, payload) {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(8 + payload.length, 0);
    header.write(type, 4, 'ascii');
    return Buffer.concat([header, payload]);
}

function makeEsdsInit({ objectTypeIndication = 0x40, ascBytes = [0x11, 0x90], omitEsds = false } = {}) {
    const dsi = Buffer.from([0x05, ascBytes.length, ...ascBytes]);
    const decConfigPayload = Buffer.concat([
        Buffer.from([objectTypeIndication, 0x15, 0x00, 0x00, 0x00, 0x00, 0x07, 0xd0, 0x00, 0x00, 0x07, 0xd0, 0x00]),
        dsi,
    ]);
    const decConfig = Buffer.concat([Buffer.from([0x04, decConfigPayload.length]), decConfigPayload]);
    const esPayload = Buffer.concat([Buffer.from([0x00, 0x02, 0x00]), decConfig]);
    const esdsBox = makeMp4Box('esds', Buffer.concat([Buffer.from([0, 0, 0, 0, 0x03, esPayload.length]), esPayload]));
    const mp4aBox = makeMp4Box('mp4a', omitEsds ? Buffer.alloc(28) : Buffer.concat([Buffer.alloc(28), esdsBox]));
    const stsdBox = makeMp4Box('stsd', Buffer.concat([Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]), mp4aBox]));
    return makeMp4Box('moov', makeMp4Box('trak', makeMp4Box('mdia', makeMp4Box('minf', makeMp4Box('stbl', stsdBox)))));
}

test('hasVerifiedAacLcTrack accepts stereo and 7.1 AAC-LC AudioSpecificConfig and rejects non-LC profiles', () => {
    assert.equal(hasVerifiedAacLcTrack(makeEsdsInit({ ascBytes: [0x11, 0x90] })), true);
    assert.equal(hasVerifiedAacLcTrack(makeEsdsInit({ ascBytes: [0x11, 0xb8, 0x56, 0xe5, 0x00] })), true);
    assert.equal(hasVerifiedAacLcTrack(makeEsdsInit({ ascBytes: [0x2b, 0x92, 0x08, 0x00] })), false);
    assert.equal(hasVerifiedAacLcTrack(makeEsdsInit({ ascBytes: [0x11, 0x90, 0x56, 0xe5, 0x80] })), false);
    assert.equal(hasVerifiedAacLcTrack(makeEsdsInit({ ascBytes: [0x09, 0x90] })), false);
    assert.equal(hasVerifiedAacLcTrack(makeEsdsInit({ objectTypeIndication: 0x6b, ascBytes: [0x11, 0x90] })), false);
    assert.equal(hasVerifiedAacLcTrack(makeEsdsInit({ omitEsds: true })), false);
});

// Optional real-media regression. The fixtures are distributed separately by Chromium
// (glass-blowing2-dolby-vision-profile-8-1-frag.mp4) and FFmpeg FATE (hevc/dv84.mov).
for (const sample of [
    { file: process.env.TUBELOCK_DV81_SAMPLE, profile: '8.1', supplemental: 'dvh1.08.05/db1p', range: 'PQ', audio: null },
    { file: process.env.TUBELOCK_DV84_SAMPLE, profile: '8.4', supplemental: 'dvh1.08.04/db4h', range: 'HLG', audio: 'mp4a.40.2' },
]) {
    test(`Profile ${sample.profile} HLS preserves every RPU and rejects a later segment with stripped metadata`, {
        skip: !sample.file,
    }, async (t) => {
        const dir = await testDirectory(t);
        const input = path.resolve(sample.file);
        const source = JSON.parse(execFileSync('ffprobe', [
            '-v', 'error', '-select_streams', 'v:0', '-show_streams', '-of', 'json', input,
        ]));
        const dolbyVision = getDolbyVisionSource(source.streams[0]);
        const playlist = 'test.m3u8';
        const params = buildDolbyVisionHlsArgs(input, playlist, {
            initSegmentName: 'init_test.mp4', segmentPattern: 'stream_%03d.m4s', audioArgs: ['-c:a', 'aac'], dolbyVision,
        });
        // Repeat these short samples to cover multiple real segment boundaries.
        params.splice(params.indexOf('-i'), 0, '-stream_loop', '2');
        execFileSync('ffmpeg', ['-v', 'error', ...params], { cwd: dir });
        const playlistPath = path.join(dir, playlist);
        const packaged = await validateDolbyVisionHls({ playlistPath, dolbyVision });
        assert.equal(packaged.supplementalCodecs, sample.supplemental);
        assert.equal(packaged.videoRange, sample.range);
        assert.equal(packaged.audioCodec, sample.audio);
        assert.match(packaged.codecs, /^hvc1\.2\.4\./);
        assert.ok(packaged.bandwidth >= packaged.averageBandwidth && packaged.averageBandwidth > 0);
        assert.ok(packaged.segmentStarts.length > 1);
        assert.ok(packaged.files.includes('stream_001.m4s'));
        assert.equal(packaged.files.at(-1), playlist);

        const rpuBytes = (file) => execFileSync('ffmpeg', [
            '-v', 'error', '-i', file, '-map', '0:v:0', '-c:v', 'copy',
            '-bsf:v', 'hevc_mp4toannexb,filter_units=pass_types=62', '-f', 'hevc', 'pipe:1',
        ], { cwd: dir });
        const originalRpus = rpuBytes(input);
        assert.ok(originalRpus.length > 0);
        assert.deepEqual(rpuBytes(playlist), Buffer.concat([originalRpus, originalRpus, originalRpus]));

        const stripped = path.join(dir, 'stripped');
        await mkdir(stripped);
        params.splice(params.indexOf('-f'), 0, '-bsf:v', 'filter_units=remove_types=62');
        execFileSync('ffmpeg', ['-v', 'error', ...params], { cwd: stripped });
        await copyFile(path.join(stripped, 'stream_001.m4s'), path.join(dir, 'stream_001.m4s'));
        await assert.rejects(validateDolbyVisionHls({ playlistPath, dolbyVision }), /stream_001.*RPU/);
    });
}
