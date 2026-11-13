import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const [source, sample = '0', scratchRoot = tmpdir()] = process.argv.slice(2);
const seconds = Number(sample);
if (!source || !Number.isFinite(seconds) || seconds < 0) {
    throw new Error('Usage: node scripts/benchmark-av1-hls.mjs <local-video> [sample-seconds=0] [scratch-directory]');
}
const input = resolve(source);
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';

function run(command, args, options = {}) {
    const result = spawnSync(command, args, { encoding: 'utf8', ...options });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr?.trim() || `${command} exited with status ${result.status}`);
    return result.stdout;
}

function report(line) {
    console.log(line);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
}

const { streams } = JSON.parse(run(ffprobe, [
    '-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate,duration',
    '-of', 'json', input,
]));
const video = streams.find((stream) => stream.codec_type === 'video');
if (!video?.width || !video?.height) throw new Error('Input has no usable video stream.');
const { width, height } = video;
const [numerator, denominator] = video.r_frame_rate.split('/').map(Number);
const fps = numerator / denominator;
const gop = String(Number.isFinite(fps) && fps > 0 ? Math.max(1, Math.round(fps * 2)) : 60);

// Match the production worker's eligibility, scaling boxes, target bitrates, and SD grouping.
const passes = [
    [[256, 144, 200]],
    [[640, 360, 600, height >= 360], [854, 480, 1000, height >= 480]],
    [[1280, 720, 3500, height >= 720]],
    [[1920, 1080, 8500, height >= 1080]],
    [[2560, 1440, 12000, height >= 1440 || width >= 2560]],
    [[3840, 2160, 20000, height >= 2160 || width >= 3840]],
];

function encode(renditions, directory) {
    const split = renditions.length > 1
        ? `[0:v:0]split=${renditions.length}${renditions.map(([, h]) => `[in${h}]`).join('')};`
        : '';
    const filters = renditions.map(([w, h]) => {
        const sourceLabel = split ? `in${h}` : '0:v:0';
        return `[${sourceLabel}]scale=w=${w}:h=${h}:force_original_aspect_ratio=decrease:force_divisible_by=2[v${h}]`;
    }).join(';');
    const outputArgs = renditions.flatMap(([, h, bitrate]) => [
        ...(seconds ? ['-t', String(seconds)] : []),
        '-map', `[v${h}]`, '-map', '0:a:0?', '-pix_fmt', 'yuv420p',
        '-c:v', 'libsvtav1', '-preset', '8', '-g', gop, '-b:v', `${bitrate}k`,
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
        '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod', '-hls_flags', 'independent_segments',
        '-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', `${h}p-init.mp4`,
        '-hls_segment_filename', `${h}p-%05d.m4s`, `${h}p.m3u8`,
    ]);
    run(ffmpeg, [
        '-hide_banner', '-nostdin', '-loglevel', 'error', '-i', input,
        '-filter_complex', split + filters, ...outputArgs,
    ], { cwd: directory, stdio: 'inherit' });
}

report(`## AV1 preset 8 · source ${width}×${height} · ${seconds ? `first ${seconds}s` : 'full clip'}`);
report('');
report('| Rendition | Encoded size | Pass wall time |');
report('| --- | ---: | ---: |');
let total = 0;
for (const pass of passes) {
    const renditions = pass.filter(([, , , enabled = true]) => enabled);
    if (renditions.length === 0) continue;
    const directory = mkdtempSync(join(resolve(scratchRoot), 'tubelock-av1-'));
    try {
        const started = performance.now();
        encode(renditions, directory);
        const elapsed = (performance.now() - started) / 1000;
        total += elapsed;
        const files = readdirSync(directory);
        for (const [, h] of renditions) {
            const bytes = files.filter((file) => file.startsWith(`${h}p-`) || file === `${h}p.m3u8`)
                .reduce((size, file) => size + statSync(join(directory, file)).size, 0);
            report(`| ${h}p | ${(bytes / 1024 ** 2).toFixed(2)} MiB | ${elapsed.toFixed(2)} s${renditions.length > 1 ? ' (shared pass)' : ''} |`);
        }
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}
report('');
report(`Total encoding and HLS packaging time: **${total.toFixed(2)} s**. Shared passes are counted once.`);
