import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SAFE_FILE = /^[a-z\d][a-z\d_.-]*$/i;
const PROFILE_8_COMPATIBILITY = new Map([
    [1, { videoRange: 'PQ', transfer: 'smpte2084', brand: 'db1p' }],
    [4, { videoRange: 'HLG', transfer: 'arib-std-b67', brand: 'db4h' }],
]);

export function getDolbyVisionSource(videoStream) {
    const config = videoStream?.side_data_list?.find(
        (sideData) => sideData.side_data_type === 'DOVI configuration record',
    );
    if (!config) return null;

    const profile = Number(config.dv_profile);
    const level = Number(config.dv_level);
    const compatibilityId = Number(config.dv_bl_signal_compatibility_id);
    const compatibility = PROFILE_8_COMPATIBILITY.get(compatibilityId);
    const supported = videoStream.codec_name === 'hevc'
        && videoStream.profile === 'Main 10'
        && profile === 8 && Number.isInteger(level) && level >= 1 && level <= 13
        && Number(config.bl_present_flag) === 1 && Number(config.el_present_flag) === 0
        && Number(config.rpu_present_flag) === 1
        && Boolean(compatibility) && videoStream.color_transfer === compatibility.transfer;
    return {
        profile,
        level,
        compatibilityId,
        supported,
        videoRange: supported ? compatibility.videoRange : null,
        supplementalCodecs: supported ? `dvh1.08.${String(level).padStart(2, '0')}/${compatibility.brand}` : null,
    };
}

export function buildDolbyVisionHlsArgs(inputPath, outputPlaylistPath, {
    initSegmentName, segmentPattern, audioArgs, dolbyVision,
}) {
    if (!dolbyVision?.supported) throw new Error('Unsupported Dolby Vision source for HLS');
    return [
        '-y', '-i', inputPath,
        '-map', '0:v:0', '-map', '0:a:0?',
        '-c:v', 'copy', '-tag:v', 'hvc1',
        ...audioArgs,
        '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod',
        '-hls_flags', 'independent_segments', '-hls_segment_type', 'fmp4',
        '-hls_segment_options', 'strict=unofficial',
        '-hls_fmp4_init_filename', initSegmentName,
        '-hls_segment_filename', segmentPattern,
        outputPlaylistPath,
    ];
}

function* mp4Boxes(bytes, start = 0, end = bytes.length) {
    for (let offset = start; offset < end;) {
        if (offset + 8 > end) throw new Error('Invalid MP4 box header');
        const type = bytes.toString('ascii', offset + 4, offset + 8);
        let size = bytes.readUInt32BE(offset);
        let headerSize = 8;
        if (size === 1) {
            headerSize = 16;
            if (offset + headerSize > end) throw new Error('Invalid extended MP4 box header');
            size = Number(bytes.readBigUInt64BE(offset + 8));
        } else if (size === 0) {
            size = end - offset;
        }
        if (size < headerSize || offset + size > end) throw new Error('Invalid MP4 box length');
        yield { type, start: offset + headerSize, end: offset + size };
        offset += size;
    }
}

function findMp4Box(bytes, parent, type) {
    if (!parent) return null;
    return [...mp4Boxes(bytes, parent.start, parent.end)].find((box) => box.type === type);
}

function readHevcConfiguration(bytes) {
    const movie = findMp4Box(bytes, { start: 0, end: bytes.length }, 'moov');
    if (movie) {
        for (const track of mp4Boxes(bytes, movie.start, movie.end)) {
            if (track.type !== 'trak') continue;
            const media = findMp4Box(bytes, track, 'mdia');
            const info = findMp4Box(bytes, media, 'minf');
            const table = findMp4Box(bytes, info, 'stbl');
            const descriptions = findMp4Box(bytes, table, 'stsd');
            if (!descriptions) continue;
            // stsd has version/flags and entry count. A visual sample entry has 78 bytes before its child boxes.
            const entry = findMp4Box(bytes, { ...descriptions, start: descriptions.start + 8 }, 'hvc1');
            if (!entry) continue;
            const config = findMp4Box(bytes, { ...entry, start: entry.start + 78 }, 'hvcC');
            if (config) return bytes.subarray(config.start, config.end);
        }
    }
    throw new Error('Dolby Vision init segment has no hvc1 decoder configuration');
}

export function formatHevcCodec(config) {
    if (config.length < 23 || config[0] !== 1) throw new Error('Invalid HEVC decoder configuration');
    const profileSpace = ['', 'A', 'B', 'C'][config[1] >> 6];
    const profile = config[1] & 31;
    const tier = config[1] & 32 ? 'H' : 'L';
    const compatibilityFlags = config.readUInt32BE(2);
    let reversedCompatibilityFlags = 0;
    for (let bit = 0; bit < 32; bit++) {
        reversedCompatibilityFlags = (reversedCompatibilityFlags << 1) | ((compatibilityFlags >>> bit) & 1);
    }
    const constraints = [...config.subarray(6, 12)];
    while (constraints.at(-1) === 0) constraints.pop();
    const level = config[12];
    return [
        'hvc1', `${profileSpace}${profile}`, (reversedCompatibilityFlags >>> 0).toString(16).toUpperCase(),
        `${tier}${level}`, ...constraints.map((value) => value.toString(16).toUpperCase().padStart(2, '0')),
    ].join('.');
}

function parseMediaPlaylist(content) {
    const lines = content.trim().split(/\r?\n/).map((line) => line.trim());
    const init = lines.find((line) => line.startsWith('#EXT-X-MAP:'))?.match(/^#EXT-X-MAP:URI="([^"]+)"$/)?.[1];
    const targetDuration = Number(lines.find((line) => line.startsWith('#EXT-X-TARGETDURATION:'))?.split(':')[1]);
    if (lines[0] !== '#EXTM3U' || lines.at(-1) !== '#EXT-X-ENDLIST'
        || !lines.includes('#EXT-X-INDEPENDENT-SEGMENTS')
        || !SAFE_FILE.test(init ?? '') || !init.endsWith('.mp4') || !(targetDuration > 0)) {
        throw new Error('Invalid Dolby Vision VOD media playlist');
    }
    const segments = [];
    let duration = null;
    for (const line of lines) {
        if (line.startsWith('#EXTINF:')) {
            duration = Number(line.slice('#EXTINF:'.length).split(',')[0]);
        } else if (line && !line.startsWith('#')) {
            if (!SAFE_FILE.test(line) || !line.endsWith('.m4s') || !(duration > 0)) {
                throw new Error('Invalid Dolby Vision media segment');
            }
            segments.push({ name: line, duration });
            duration = null;
        }
    }
    if (segments.length === 0 || duration !== null) throw new Error('Dolby Vision media playlist is incomplete');
    return { init, segments, targetDuration };
}

function measureBandwidth(segments, targetDuration) {
    const totalBytes = segments.reduce((sum, segment) => sum + segment.size, 0);
    const duration = segments.reduce((sum, segment) => sum + segment.duration, 0);
    let peak = 0;
    for (let start = 0; start < segments.length; start++) {
        let length = 0;
        let bytes = 0;
        for (let index = start; index < segments.length; index++) {
            length += segments[index].duration;
            bytes += segments[index].size;
            if (length > targetDuration * 1.5) break;
            if (length >= targetDuration * 0.5) peak = Math.max(peak, bytes * 8 / length);
        }
    }
    const averageBandwidth = Math.ceil(totalBytes * 8 / duration);
    return { bandwidth: Math.max(Math.ceil(peak), averageBandwidth), averageBandwidth, duration };
}

export async function validateDolbyVisionHls({ playlistPath, dolbyVision, ffprobePath = 'ffprobe' }) {
    if (!dolbyVision?.supported) throw new Error('Unsupported Dolby Vision source for HLS');
    const cwd = path.dirname(path.resolve(playlistPath));
    const playlist = path.basename(playlistPath);
    const { init, segments, targetDuration } = parseMediaPlaylist(await readFile(playlistPath, 'utf8'));
    const probe = (args) => execFileAsync(ffprobePath, ['-v', 'error', ...args], {
        cwd, timeout: 30_000, maxBuffer: 1024 * 1024,
    });
    const fragmentUrl = (segment) => `concat:${init}|${segment.name}`;
    const firstFragment = fragmentUrl(segments[0]);
    const [initData, initProbe, streamProbe] = await Promise.all([
        readFile(path.join(cwd, init)),
        probe(['-show_streams', '-of', 'json', init]),
        // An empty fragmented MP4 init does not always expose the AAC profile.
        probe(['-protocol_whitelist', 'file,concat', '-show_streams', '-of', 'json', firstFragment]),
    ]);
    const streams = JSON.parse(initProbe.stdout).streams;
    const video = streams.find((stream) => stream.codec_type === 'video');
    const actual = getDolbyVisionSource(video);
    if (video?.codec_tag_string !== 'hvc1' || !actual?.supported || actual.supplementalCodecs !== dolbyVision.supplementalCodecs) {
        throw new Error('Packaged Dolby Vision init segment is missing a matching profile or base layer');
    }
    const audio = JSON.parse(streamProbe.stdout).streams.find((stream) => stream.codec_type === 'audio');
    if (audio && (audio.codec_name !== 'aac' || audio.profile !== 'LC')) {
        throw new Error('Unsupported audio codec in Dolby Vision rendition');
    }
    const codecs = formatHevcCodec(readHevcConfiguration(initData));
    const inspectSegment = async (segment) => {
        const file = await stat(path.join(cwd, segment.name));
        if (!file.isFile() || !file.size) throw new Error('Missing Dolby Vision media segment');
        const { stdout } = await probe([
            '-protocol_whitelist', 'file,concat', '-threads', '1', '-select_streams', 'v:0', '-read_intervals', '%+#1',
            '-show_frames', '-show_entries', 'frame=key_frame:frame_side_data=side_data_type',
            '-of', 'json', fragmentUrl(segment),
        ]);
        const frame = JSON.parse(stdout).frames?.[0];
        const hasDecodedRpu = frame?.side_data_list?.some(({ side_data_type: type }) => type === 'Dolby Vision Metadata');
        if (frame?.key_frame !== 1 || !hasDecodedRpu) {
            throw new Error(`Dolby Vision segment ${segment.name} must start with a key frame carrying RPU data`);
        }
        segment.size = file.size;
    };
    // Bound the number of HEVC decoder processes even for feature-length uploads.
    for (let index = 0; index < segments.length; index += 2) {
        await Promise.all(segments.slice(index, index + 2).map(inspectSegment));
    }
    let offset = 0;
    const segmentStarts = segments.map((segment) => {
        const start = offset;
        offset += segment.duration;
        return start;
    });
    return {
        codecs,
        audioCodec: audio ? 'mp4a.40.2' : null,
        files: [init, ...segments.map((segment) => segment.name), playlist],
        videoRange: actual.videoRange,
        supplementalCodecs: actual.supplementalCodecs,
        segmentStarts,
        ...measureBandwidth(segments, targetDuration),
    };
}
