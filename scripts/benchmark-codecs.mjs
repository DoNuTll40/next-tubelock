import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

// node scripts/benchmark-codecs.mjs <local-video> [seconds=30]
const [source, sampleSeconds = '30'] = process.argv.slice(2);
const seconds = Number(sampleSeconds);
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
const scale = 'scale=w=1920:h=1080:force_original_aspect_ratio=decrease:force_divisible_by=2';

function run(command, args, cwd) {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr.trim() || `${command} exited with status ${result.status}`);
    return result;
}

function benchmark(input, directory, gop, { label, encoder, options, container, extension }) {
    mkdirSync(directory);
    console.log(`Encoding ${label}...`);
    const started = performance.now();
    run(ffmpeg, [
        '-hide_banner', '-nostdin', '-loglevel', 'error', '-i', input, '-t', String(seconds),
        '-map', '0:v:0', '-map', '0:a:0?', '-vf', scale, '-pix_fmt', 'yuv420p',
        '-c:v', encoder, ...options, '-g', gop,
        '-b:v', '8500k',
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
        '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod',
        '-hls_flags', 'independent_segments', '-hls_segment_type', container,
        '-hls_segment_filename', `segment_%03d.${extension}`, 'video.m3u8',
    ], directory);
    const elapsed = (performance.now() - started) / 1000;
    const bytes = readdirSync(directory).reduce((sum, name) => sum + statSync(join(directory, name)).size, 0);

    // Compare frames by index so MPEG-TS and fMP4 timestamp offsets do not skew PSNR.
    const { stderr } = run(ffmpeg, [
        '-hide_banner', '-nostdin', '-nostats', '-i', 'video.m3u8', '-i', input,
        '-filter_complex', `[0:v]format=yuv420p,settb=AVTB,setpts=N[encoded];[1:v]${scale},format=yuv420p,settb=AVTB,setpts=N[ref];[encoded][ref]psnr=shortest=1[comparison]`,
        '-map', '[comparison]', '-an', '-f', 'null', '-',
    ], directory);
    const psnr = stderr.match(/average:(\S+) min:/)?.[1];
    if (!psnr) throw new Error(`No PSNR result for ${label}`);
    return { Codec: label, 'Encode (s)': elapsed.toFixed(2), 'HLS size (MiB)': (bytes / 1024 ** 2).toFixed(2), 'PSNR (dB)': psnr };
}

try {
    if (!source || !Number.isFinite(seconds) || seconds <= 0) {
        throw new Error('Usage: node scripts/benchmark-codecs.mjs <local-video> [positive seconds, default 30]');
    }
    const input = resolve(source);
    if (!statSync(input).isFile()) throw new Error('The input must be a local video file.');
    const { stdout: encoders } = run(ffmpeg, ['-hide_banner', '-encoders']);
    for (const encoder of ['libx264', 'libsvtav1']) {
        if (!encoders.split(/\s+/).includes(encoder)) throw new Error(`FFmpeg is missing ${encoder}. Set FFMPEG_PATH to a build with both encoders.`);
    }
    const { stdout: frameRate } = run(ffprobe, [
        '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=avg_frame_rate',
        '-of', 'default=noprint_wrappers=1:nokey=1', input,
    ]);
    const [numerator, denominator] = frameRate.trim().split('/').map(Number);
    const fps = numerator / denominator;
    const gop = String(Number.isFinite(fps) && fps > 0 ? Math.max(1, Math.round(fps * 2)) : 60);
    const scratch = mkdtempSync(join(tmpdir(), 'tubelock-codecs-'));
    try {
        console.log(`First ${seconds}s (or whole clip if shorter), up to 1920×1080, target 8.5 Mb/s.`);
        console.table([
            benchmark(input, join(scratch, 'h264'), gop, {
                label: 'H.264 veryfast', encoder: 'libx264', container: 'mpegts', extension: 'ts',
                options: [
                    '-preset', 'veryfast', '-profile:v', 'high', '-level', '4.2',
                    '-keyint_min', gop, '-sc_threshold', '0', '-maxrate', '11000k', '-bufsize', '16000k',
                ],
            }),
            benchmark(input, join(scratch, 'av1'), gop, {
                label: 'AV1 preset 8', encoder: 'libsvtav1', container: 'fmp4', extension: 'm4s',
                options: ['-preset', '8'],
            }),
        ]);
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
