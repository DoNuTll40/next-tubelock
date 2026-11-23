/**
 * TubeLock Progressive Cloud Transcoder Worker (5x Parallel Lanes + Dedicated 4K + Sharpness Tuned)
 * Optimized for GitHub Actions Public Repo Runner (5x 4 vCPU / 16GB RAM / Freed NVMe + RAM Disk)
 *
 * Parallel Multi-Lane Architecture (100% Output & API Compatible):
 * - Lane 1 (`fast_sd`):  poster.jpg + Pass 1 (144p + Storyboard SD/HD -> instant READY) + Pass 2/3 (360p + 480p) + Smart Hi-Res WAV/FLAC
 * - Lane 2 (`hd`):       Pass 4 (720p HD dedicated)
 * - Lane 3 (`fhd`):      Pass 5 (1080p Full HD dedicated)
 * - Lane 4 (`qhd`):      Pass 6 (1440p 2K dedicated — skips download via remote ffprobe if < 1440p)
 * - Lane 5 (`uhd`):      Pass 7 (2160p 4K dedicated — full 4 Cores / 16GB RAM, skips download if < 2160p)
 * - Finalize (`finalize`): Authoritative master.m3u8 sync + /raw/ cleanup (when AI workers idle) + 100% READY
 * - Legacy (`all`):      Runs all 5 lanes + finalize sequentially in one process (local CLI fallback)
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import os from 'node:os';
import { neon } from '@neondatabase/serverless';
import {
    ensureWorkerLogsColumn,
    createWorkerLogger,
    downloadFileWithProgress,
    formatDurationShort,
} from './worker-utils.js';

// 1. Environment & Inputs
const VIDEO_ID = process.env.VIDEO_ID || process.argv[2];
const RAW_FILE_NAME = process.env.RAW_FILE_NAME || process.argv[3];
const VIDEO_TITLE = process.env.VIDEO_TITLE || process.argv[4] || 'Untitled Video';
const VERSION_ID = (process.env.VERSION_ID || '').trim();

const VALID_LANES = new Set(['all', 'fast_sd', 'hd', 'fhd', 'qhd', 'uhd', 'finalize']);
const RAW_LANE = (process.env.TRANSCODE_LANE || 'all').trim().toLowerCase();
const TRANSCODE_LANE = VALID_LANES.has(RAW_LANE) ? RAW_LANE : 'all';
const IS_PARALLEL_LANE = ['fast_sd', 'hd', 'fhd', 'qhd', 'uhd'].includes(TRANSCODE_LANE);
const TRANSCODE_RUN_ID = (
    process.env.TRANSCODE_RUN_ID ||
    process.env.GITHUB_RUN_ID ||
    `local_${Date.now()}`
).trim();

// โหมดขนาน 5 เครื่องใช้เครื่องละ 3 (รวม 15 concurrent PUTs สูงสุด) ป้องกัน Microsoft Graph 429 Throttle
const UPLOAD_CONCURRENCY = IS_PARALLEL_LANE ? 3 : 8;

const LANE_DISPLAY_LABELS = {
    fast_sd: 'HLS Lane 1 (SD + Hi-Res)',
    hd: 'HLS Lane 2 (720p HD)',
    fhd: 'HLS Lane 3 (1080p FHD)',
    qhd: 'HLS Lane 4 (1440p 2K)',
    uhd: 'HLS Lane 5 (2160p 4K)',
    finalize: 'HLS Finalize',
    all: 'HLS Engine',
};

const DATABASE_URL = process.env.DATABASE_URL || '';
const AZURE_TENANT_ID = (process.env.AZURE_TENANT_ID || '').replace(/['"]/g, '').trim();
const AZURE_CLIENT_ID = (process.env.AZURE_CLIENT_ID || '').replace(/['"]/g, '').trim();
const AZURE_CLIENT_SECRET = (process.env.AZURE_CLIENT_SECRET || '').replace(/['"]/g, '').trim();
let ONEDRIVE_USER_ID = (process.env.ONEDRIVE_USER_ID || '').replace(/['"]/g, '').trim();
ONEDRIVE_USER_ID = ONEDRIVE_USER_ID.replace('@donuttll40.', '@donutll40.');

if (!VIDEO_ID || (!RAW_FILE_NAME && TRANSCODE_LANE !== 'finalize')) {
    console.error('❌ Missing required parameters: VIDEO_ID and RAW_FILE_NAME must be provided.');
    process.exit(1);
}

const vidNum = Number(VIDEO_ID);
if (!Number.isFinite(vidNum) || vidNum <= 0) {
    console.error(`❌ Invalid VIDEO_ID: "${VIDEO_ID}". Expected a positive integer.`);
    process.exit(1);
}

let versionNum = null;
if (VERSION_ID) {
    versionNum = Number(VERSION_ID);
    if (!Number.isFinite(versionNum) || versionNum <= 0) {
        console.error(`❌ Invalid VERSION_ID: "${VERSION_ID}". Expected a positive integer.`);
        process.exit(1);
    }
}

if (!DATABASE_URL || !AZURE_TENANT_ID || !AZURE_CLIENT_ID || !AZURE_CLIENT_SECRET || !ONEDRIVE_USER_ID) {
    console.error('❌ Missing required environment secrets. Check GitHub Actions secrets configuration.');
    process.exit(1);
}

// 2. Initialize Database Client
const dbUrl = (DATABASE_URL || '').trim();
const sql = neon(dbUrl);
const logger = createWorkerLogger(sql, vidNum, 'hls', LANE_DISPLAY_LABELS[TRANSCODE_LANE] || 'HLS Engine', {
    versionId: versionNum,
});
let schemaChecked = false;

function getRunnerSpecs() {
    try {
        const cpus = os.cpus() || [];
        const cpuModel = cpus[0]?.model?.trim() || 'GitHub Actions Runner CPU';
        const cpuCores = cpus.length || 1;
        const totalRamGb = (os.totalmem() / (1024 ** 3)).toFixed(1);
        const freeRamGb = (os.freemem() / (1024 ** 3)).toFixed(1);

        let osName = `${os.type()} ${os.release()}`;
        try {
            if (fs.existsSync('/etc/os-release')) {
                const osRel = fs.readFileSync('/etc/os-release', 'utf8');
                const prettyMatch = osRel.match(/PRETTY_NAME="([^"]+)"/);
                if (prettyMatch) osName = prettyMatch[1];
            }
        } catch (_) { }

        let diskSpace = 'N/A';
        try {
            if (fs.statfsSync) {
                const stats = fs.statfsSync('.');
                const freeGb = ((stats.bavail * stats.bsize) / (1024 ** 3)).toFixed(1);
                const totalGb = ((stats.blocks * stats.bsize) / (1024 ** 3)).toFixed(1);
                diskSpace = `${freeGb} GB / ${totalGb} GB`;
            }
        } catch (_) { }

        return {
            cpuModel,
            cpuCores,
            totalRamGb: `${totalRamGb} GB`,
            freeRamGb: `${freeRamGb} GB`,
            osName,
            arch: os.arch(),
            diskSpace,
            hostname: os.hostname(),
            nodeVersion: process.version,
            parallelLanes: IS_PARALLEL_LANE ? 5 : 1,
        };
    } catch {
        return {
            cpuModel: 'Virtual CPU',
            cpuCores: os.cpus()?.length || 4,
            totalRamGb: '16.0 GB',
            freeRamGb: 'N/A',
            osName: 'Linux Ubuntu',
            arch: 'x64',
            diskSpace: 'N/A',
            hostname: 'gh-runner',
            nodeVersion: process.version,
            parallelLanes: IS_PARALLEL_LANE ? 5 : 1,
        };
    }
}

// เลือกใช้ RAM Disk (/dev/shm) เฉพาะเมื่อขนาดไฟล์และผลลัพธ์จะไม่ล้น 12GB แน่นอน
// นอกนั้นใช้ NVMe SSD ของ Runner ที่เคลียร์พื้นที่ไว้แล้ว (~50GB+) เพื่อป้องกัน ENOSPC สำหรับคลิปยาว/ไฟล์ใหญ่
function selectOptimalWorkDir(workKey, requiredBytes = 0, lane = 'all') {
    const shmPath = '/dev/shm';
    try {
        if (process.platform === 'linux' && fs.existsSync(shmPath) && fs.statfsSync) {
            const stats = fs.statfsSync(shmPath);
            const freeBytes = stats.bavail * stats.bsize;
            const maxRawForShm =
                lane === 'fast_sd'
                    ? 4.0 * 1024 ** 3
                    : (lane === 'qhd' || lane === 'uhd')
                        ? 1.5 * 1024 ** 3
                        : 2.5 * 1024 ** 3;
            const safetyMultiplier =
                lane === 'fast_sd'
                    ? 2.5
                    : (lane === 'qhd' || lane === 'uhd')
                        ? 4.0
                        : 3.0;
            if (
                requiredBytes <= maxRawForShm &&
                freeBytes > Math.max(requiredBytes * safetyMultiplier, 2.5 * 1024 ** 3)
            ) {
                console.log(
                    `🚀 [RAM Disk Enabled] Using /dev/shm (${(freeBytes / (1024 ** 3)).toFixed(1)} GB free) for lane=${lane}`
                );
                return path.join(shmPath, 'tubelock_transcode', `${workKey}_${lane}`);
            }
        }
    } catch (_) { }
    return path.resolve('./temp_transcode', `${workKey}_${lane}`);
}

// Concurrency Pool Helper สำหรับอัปโหลดไฟล์ขนานกัน
async function runWithConcurrency(items, concurrency, taskFn) {
    const results = [];
    const executing = new Set();
    for (const item of items) {
        const p = Promise.resolve().then(() => taskFn(item));
        results.push(p);
        executing.add(p);
        const clean = () => executing.delete(p);
        p.then(clean, clean);
        if (executing.size >= concurrency) {
            await Promise.race(executing);
        }
    }
    return Promise.all(results);
}

async function ensureDbSchemaOnce() {
    if (schemaChecked) return;
    schemaChecked = true;
    const alters = [
        () => sql`ALTER TABLE videos ALTER COLUMN fps TYPE NUMERIC(7, 3);`,
        () => sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS bitrate INTEGER;`,
        () => sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS runner_specs JSONB;`,
        () => sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS m3u8_cache_br TEXT;`,
        () => sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS ready_qualities JSONB DEFAULT '[]'::jsonb;`,
        () => sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS lane_progress JSONB DEFAULT '{}'::jsonb;`,
        () => sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS audio_channels INTEGER;`,
        () => sql`ALTER TABLE video_versions ADD COLUMN IF NOT EXISTS m3u8_cache_br TEXT;`,
        () => sql`ALTER TABLE video_versions ADD COLUMN IF NOT EXISTS ready_qualities JSONB DEFAULT '[]'::jsonb;`,
        () => sql`ALTER TABLE video_versions ADD COLUMN IF NOT EXISTS lane_progress JSONB DEFAULT '{}'::jsonb;`,
        () => sql`ALTER TABLE video_versions ADD COLUMN IF NOT EXISTS audio_channels INTEGER;`,
    ];
    for (const fn of alters) {
        try { await fn(); } catch (_) { }
    }
    await ensureWorkerLogsColumn(sql);
}

// Network Resilience: รองรับ Retry เมื่อเจอ Rate Limit (429), Lock (423) หรือ Timeout (503/504)
async function fetchWithRetry(url, options = {}, retries = 6, delay = 2000) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url, {
                ...options,
                signal: AbortSignal.timeout(90000),
            });
            if ((res.status === 423 || res.status === 429 || res.status === 503 || res.status === 504) && i < retries - 1) {
                const retryAfterSec = parseInt(res.headers.get('Retry-After') || '3', 10);
                const waitMs = Math.max(delay, (Number.isFinite(retryAfterSec) ? retryAfterSec : 3) * 1000);
                console.warn(`⏳ [HTTP ${res.status}] Rate limited/locked. Waiting ${(waitMs / 1000).toFixed(1)}s before retry ${i + 1}/${retries}...`);
                await new Promise((r) => setTimeout(r, waitMs));
                delay = Math.min(delay * 1.5, 20000);
                continue;
            }
            return res;
        } catch (err) {
            const isLast = i === retries - 1;
            if (isLast) throw err;
            console.warn(`⚠️ [Network Retry] ${err.message} -> ลองใหม่รอบที่ ${i + 1}/${retries} ในอีก ${(delay / 1000).toFixed(1)} วิ...`);
            await new Promise((r) => setTimeout(r, delay));
            delay = Math.min(delay * 1.5, 20000);
        }
    }
}

function sanitizeExtra(extra = {}) {
    return {
        safeDuration:
            extra.duration != null && Number.isFinite(Number(extra.duration))
                ? Math.max(0, Math.round(Number(extra.duration)))
                : null,
        safeFps:
            extra.fps != null && Number.isFinite(Number(extra.fps)) && Number(extra.fps) > 0
                ? Math.round(Number(extra.fps) * 1000) / 1000
                : null,
        safeBitrate:
            extra.bitrate != null && Number.isFinite(Number(extra.bitrate))
                ? Math.max(0, Math.round(Number(extra.bitrate)))
                : null,
        safeFileSize:
            extra.file_size_bytes != null && Number.isFinite(Number(extra.file_size_bytes))
                ? Math.max(0, Math.round(Number(extra.file_size_bytes)))
                : null,
        safeAudioChannels:
            extra.audio_channels != null && Number.isFinite(Number(extra.audio_channels))
                ? Math.max(0, Math.round(Number(extra.audio_channels)))
                : null,
    };
}

/**
 * Atomic, Monotonic, Race-Free Lane Progress & Metadata Update.
 * - Uses direct column expressions inside UPDATE SET (no CTE reading the same table)
 *   so PostgreSQL row locks serialize concurrent lanes cleanly.
 * - Never downgrades status once 'READY' is reached.
 * - Computes weighted transcode_progress across fast_sd (25%), hd (15%), fhd (15%), qhd (15%), uhd (15%) + base 10% (cap 95%).
 */
async function updateLaneProgress({
    lane = TRANSCODE_LANE,
    lanePct = 0,
    status = 'TRANSCODING',
    stageDetail = '',
    errorMsg = '',
    extra = {},
    invalidateCache = false,
}) {
    await ensureDbSchemaOnce();
    const clampedPct = Math.max(0, Math.min(100, Math.round(Number(lanePct) || 0)));
    const { safeDuration, safeFps, safeBitrate, safeFileSize, safeAudioChannels } = sanitizeExtra(extra);
    const laneKey = ['fast_sd', 'hd', 'fhd', 'qhd', 'uhd'].includes(lane) ? lane : 'fast_sd';

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const targetTag = versionNum ? `Video #${vidNum} (v${versionNum})` : `Video #${vidNum}`;
            let resultRows;

            if (versionNum) {
                resultRows = await sql`
                    UPDATE video_versions
                    SET
                      lane_progress = jsonb_build_object(
                        'run_id', CAST(${TRANSCODE_RUN_ID} AS TEXT),
                        'lanes',
                        (
                          CASE
                            WHEN COALESCE(lane_progress->>'run_id', '') = CAST(${TRANSCODE_RUN_ID} AS TEXT)
                              THEN COALESCE(lane_progress->'lanes', '{}'::jsonb)
                            ELSE '{}'::jsonb
                          END
                        ) || jsonb_build_object(
                          CAST(${laneKey} AS TEXT),
                          GREATEST(
                            CASE
                              WHEN COALESCE(lane_progress->>'run_id', '') = CAST(${TRANSCODE_RUN_ID} AS TEXT)
                                THEN COALESCE((lane_progress->'lanes'->>CAST(${laneKey} AS TEXT))::int, 0)
                              ELSE 0
                            END,
                            CAST(${clampedPct} AS INTEGER)
                          )
                        )
                      ),
                      transcode_progress = CASE
                        WHEN COALESCE(lane_progress->>'run_id', '') = CAST(${TRANSCODE_RUN_ID} AS TEXT) THEN
                          GREATEST(
                            COALESCE(transcode_progress, 0),
                            LEAST(
                              95,
                              10 + ROUND(
                                (CASE WHEN CAST(${laneKey} AS TEXT) = 'fast_sd'
                                  THEN GREATEST(COALESCE((lane_progress->'lanes'->>'fast_sd')::int, 0), CAST(${clampedPct} AS INTEGER))
                                  ELSE COALESCE((lane_progress->'lanes'->>'fast_sd')::int, 0) END) * 0.25 +
                                (CASE WHEN CAST(${laneKey} AS TEXT) = 'hd'
                                  THEN GREATEST(COALESCE((lane_progress->'lanes'->>'hd')::int, 0), CAST(${clampedPct} AS INTEGER))
                                  ELSE COALESCE((lane_progress->'lanes'->>'hd')::int, 0) END) * 0.15 +
                                (CASE WHEN CAST(${laneKey} AS TEXT) = 'fhd'
                                  THEN GREATEST(COALESCE((lane_progress->'lanes'->>'fhd')::int, 0), CAST(${clampedPct} AS INTEGER))
                                  ELSE COALESCE((lane_progress->'lanes'->>'fhd')::int, 0) END) * 0.15 +
                                (CASE WHEN CAST(${laneKey} AS TEXT) = 'qhd'
                                  THEN GREATEST(COALESCE((lane_progress->'lanes'->>'qhd')::int, 0), CAST(${clampedPct} AS INTEGER))
                                  ELSE COALESCE((lane_progress->'lanes'->>'qhd')::int, 0) END) * 0.15 +
                                (CASE WHEN CAST(${laneKey} AS TEXT) = 'uhd'
                                  THEN GREATEST(COALESCE((lane_progress->'lanes'->>'uhd')::int, 0), CAST(${clampedPct} AS INTEGER))
                                  ELSE COALESCE((lane_progress->'lanes'->>'uhd')::int, 0) END) * 0.15
                              )::int
                            )
                          )
                        ELSE
                          GREATEST(
                            10,
                            LEAST(
                              95,
                              10 + ROUND(
                                (CASE WHEN CAST(${laneKey} AS TEXT) = 'fast_sd' THEN CAST(${clampedPct} AS INTEGER) ELSE 0 END) * 0.25 +
                                (CASE WHEN CAST(${laneKey} AS TEXT) = 'hd' THEN CAST(${clampedPct} AS INTEGER) ELSE 0 END) * 0.15 +
                                (CASE WHEN CAST(${laneKey} AS TEXT) = 'fhd' THEN CAST(${clampedPct} AS INTEGER) ELSE 0 END) * 0.15 +
                                (CASE WHEN CAST(${laneKey} AS TEXT) = 'qhd' THEN CAST(${clampedPct} AS INTEGER) ELSE 0 END) * 0.15 +
                                (CASE WHEN CAST(${laneKey} AS TEXT) = 'uhd' THEN CAST(${clampedPct} AS INTEGER) ELSE 0 END) * 0.15
                              )::int
                            )
                          )
                      END,
                      status = CASE
                        WHEN status = 'READY' THEN 'READY'
                        ELSE CAST(${status} AS TEXT)
                      END,
                      stage_detail = COALESCE(CAST(${stageDetail || null} AS TEXT), stage_detail),
                      error_message = CASE
                        WHEN CAST(${errorMsg} AS TEXT) <> '' THEN CAST(${errorMsg} AS TEXT)
                        WHEN COALESCE(lane_progress->>'run_id', '') <> CAST(${TRANSCODE_RUN_ID} AS TEXT) THEN ''
                        ELSE error_message
                      END,
                      source_cache_br = CASE WHEN CAST(${invalidateCache} AS BOOLEAN) THEN NULL ELSE source_cache_br END,
                      m3u8_cache_br = CASE WHEN CAST(${invalidateCache} AS BOOLEAN) THEN NULL ELSE m3u8_cache_br END,
                      source_cache_items_count = CASE WHEN CAST(${invalidateCache} AS BOOLEAN) THEN 0 ELSE source_cache_items_count END,
                      source_cache_expires_at = CASE WHEN CAST(${invalidateCache} AS BOOLEAN) THEN 0 ELSE source_cache_expires_at END,
                      thumbnail_url = COALESCE(CAST(${extra.thumbnail_url ?? null} AS TEXT), thumbnail_url),
                      onedrive_folder_id = COALESCE(CAST(${extra.onedrive_folder_id ?? null} AS TEXT), onedrive_folder_id),
                      hls_folder_path = COALESCE(CAST(${extra.hls_folder_path ?? null} AS TEXT), hls_folder_path),
                      master_playlist_path = COALESCE(CAST(${extra.master_playlist_path ?? null} AS TEXT), master_playlist_path),
                      storyboard_vtt_path = COALESCE(CAST(${extra.storyboard_vtt_path ?? null} AS TEXT), storyboard_vtt_path),
                      duration = COALESCE(CAST(${safeDuration} AS INTEGER), duration),
                      resolution = COALESCE(CAST(${extra.resolution ?? null} AS TEXT), resolution),
                      fps = COALESCE(CAST(${safeFps} AS NUMERIC), fps),
                      codec = COALESCE(CAST(${extra.codec ?? null} AS TEXT), codec),
                      bitrate = COALESCE(CAST(${safeBitrate} AS INTEGER), bitrate),
                      audio_channels = COALESCE(CAST(${safeAudioChannels} AS INTEGER), audio_channels),
                      file_size_bytes = COALESCE(CAST(${safeFileSize} AS BIGINT), file_size_bytes),
                      updated_at = NOW()
                    WHERE id = ${versionNum} AND video_id = ${vidNum}
                    RETURNING transcode_progress, status;
                `;
                if (extra.runner_specs) {
                    try {
                        await sql`UPDATE video_versions SET runner_specs = ${JSON.stringify(extra.runner_specs)}::jsonb WHERE id = ${versionNum} AND video_id = ${vidNum};`;
                    } catch (_) { }
                }
            } else {
                resultRows = await sql`
                    UPDATE videos
                    SET
                      lane_progress = jsonb_build_object(
                        'run_id', CAST(${TRANSCODE_RUN_ID} AS TEXT),
                        'lanes',
                        (
                          CASE
                            WHEN COALESCE(lane_progress->>'run_id', '') = CAST(${TRANSCODE_RUN_ID} AS TEXT)
                              THEN COALESCE(lane_progress->'lanes', '{}'::jsonb)
                            ELSE '{}'::jsonb
                          END
                        ) || jsonb_build_object(
                          CAST(${laneKey} AS TEXT),
                          GREATEST(
                            CASE
                              WHEN COALESCE(lane_progress->>'run_id', '') = CAST(${TRANSCODE_RUN_ID} AS TEXT)
                                THEN COALESCE((lane_progress->'lanes'->>CAST(${laneKey} AS TEXT))::int, 0)
                              ELSE 0
                            END,
                            CAST(${clampedPct} AS INTEGER)
                          )
                        )
                      ),
                      transcode_progress = CASE
                        WHEN COALESCE(lane_progress->>'run_id', '') = CAST(${TRANSCODE_RUN_ID} AS TEXT) THEN
                          GREATEST(
                            COALESCE(transcode_progress, 0),
                            LEAST(
                              95,
                              10 + ROUND(
                                (CASE WHEN CAST(${laneKey} AS TEXT) = 'fast_sd'
                                  THEN GREATEST(COALESCE((lane_progress->'lanes'->>'fast_sd')::int, 0), CAST(${clampedPct} AS INTEGER))
                                  ELSE COALESCE((lane_progress->'lanes'->>'fast_sd')::int, 0) END) * 0.25 +
                                (CASE WHEN CAST(${laneKey} AS TEXT) = 'hd'
                                  THEN GREATEST(COALESCE((lane_progress->'lanes'->>'hd')::int, 0), CAST(${clampedPct} AS INTEGER))
                                  ELSE COALESCE((lane_progress->'lanes'->>'hd')::int, 0) END) * 0.15 +
                                (CASE WHEN CAST(${laneKey} AS TEXT) = 'fhd'
                                  THEN GREATEST(COALESCE((lane_progress->'lanes'->>'fhd')::int, 0), CAST(${clampedPct} AS INTEGER))
                                  ELSE COALESCE((lane_progress->'lanes'->>'fhd')::int, 0) END) * 0.15 +
                                (CASE WHEN CAST(${laneKey} AS TEXT) = 'qhd'
                                  THEN GREATEST(COALESCE((lane_progress->'lanes'->>'qhd')::int, 0), CAST(${clampedPct} AS INTEGER))
                                  ELSE COALESCE((lane_progress->'lanes'->>'qhd')::int, 0) END) * 0.15 +
                                (CASE WHEN CAST(${laneKey} AS TEXT) = 'uhd'
                                  THEN GREATEST(COALESCE((lane_progress->'lanes'->>'uhd')::int, 0), CAST(${clampedPct} AS INTEGER))
                                  ELSE COALESCE((lane_progress->'lanes'->>'uhd')::int, 0) END) * 0.15
                              )::int
                            )
                          )
                        ELSE
                          GREATEST(
                            10,
                            LEAST(
                              95,
                              10 + ROUND(
                                (CASE WHEN CAST(${laneKey} AS TEXT) = 'fast_sd' THEN CAST(${clampedPct} AS INTEGER) ELSE 0 END) * 0.25 +
                                (CASE WHEN CAST(${laneKey} AS TEXT) = 'hd' THEN CAST(${clampedPct} AS INTEGER) ELSE 0 END) * 0.15 +
                                (CASE WHEN CAST(${laneKey} AS TEXT) = 'fhd' THEN CAST(${clampedPct} AS INTEGER) ELSE 0 END) * 0.15 +
                                (CASE WHEN CAST(${laneKey} AS TEXT) = 'qhd' THEN CAST(${clampedPct} AS INTEGER) ELSE 0 END) * 0.15 +
                                (CASE WHEN CAST(${laneKey} AS TEXT) = 'uhd' THEN CAST(${clampedPct} AS INTEGER) ELSE 0 END) * 0.15
                              )::int
                            )
                          )
                      END,
                      status = CASE
                        WHEN status = 'READY'::video_status THEN 'READY'::video_status
                        ELSE CAST(${status} AS video_status)
                      END,
                      stage_detail = COALESCE(CAST(${stageDetail || null} AS TEXT), stage_detail),
                      error_message = CASE
                        WHEN CAST(${errorMsg} AS TEXT) <> '' THEN CAST(${errorMsg} AS TEXT)
                        WHEN COALESCE(lane_progress->>'run_id', '') <> CAST(${TRANSCODE_RUN_ID} AS TEXT) THEN ''
                        ELSE error_message
                      END,
                      source_cache = CASE WHEN CAST(${invalidateCache} AS BOOLEAN) THEN NULL ELSE source_cache END,
                      source_cache_br = CASE WHEN CAST(${invalidateCache} AS BOOLEAN) THEN NULL ELSE source_cache_br END,
                      m3u8_cache_br = CASE WHEN CAST(${invalidateCache} AS BOOLEAN) THEN NULL ELSE m3u8_cache_br END,
                      source_cache_items_count = CASE WHEN CAST(${invalidateCache} AS BOOLEAN) THEN 0 ELSE source_cache_items_count END,
                      source_cache_expires_at = CASE WHEN CAST(${invalidateCache} AS BOOLEAN) THEN 0 ELSE source_cache_expires_at END,
                      thumbnail_url = COALESCE(CAST(${extra.thumbnail_url ?? null} AS TEXT), thumbnail_url),
                      onedrive_folder_id = COALESCE(CAST(${extra.onedrive_folder_id ?? null} AS TEXT), onedrive_folder_id),
                      hls_folder_path = COALESCE(CAST(${extra.hls_folder_path ?? null} AS TEXT), hls_folder_path),
                      master_playlist_path = COALESCE(CAST(${extra.master_playlist_path ?? null} AS TEXT), master_playlist_path),
                      storyboard_vtt_path = COALESCE(CAST(${extra.storyboard_vtt_path ?? null} AS TEXT), storyboard_vtt_path),
                      duration = COALESCE(CAST(${safeDuration} AS INTEGER), duration),
                      resolution = COALESCE(CAST(${extra.resolution ?? null} AS TEXT), resolution),
                      fps = COALESCE(CAST(${safeFps} AS NUMERIC), fps),
                      codec = COALESCE(CAST(${extra.codec ?? null} AS TEXT), codec),
                      bitrate = COALESCE(CAST(${safeBitrate} AS INTEGER), bitrate),
                      audio_channels = COALESCE(CAST(${safeAudioChannels} AS INTEGER), audio_channels),
                      file_size_bytes = COALESCE(CAST(${safeFileSize} AS BIGINT), file_size_bytes),
                      updated_at = NOW()
                    WHERE id = ${vidNum}
                    RETURNING transcode_progress, status;
                `;
                if (extra.runner_specs) {
                    try {
                        await sql`UPDATE videos SET runner_specs = ${JSON.stringify(extra.runner_specs)}::jsonb WHERE id = ${vidNum};`;
                    } catch (_) {
                        try {
                            await sql`UPDATE videos SET runner_specs = ${JSON.stringify(extra.runner_specs)} WHERE id = ${vidNum};`;
                        } catch (_) { }
                    }
                }
            }

            const row = resultRows?.[0];
            console.log(
                `[DB UPDATE] ${targetTag} [${laneKey}:${clampedPct}%] Status: ${row?.status || status} | Overall: ${row?.transcode_progress ?? '?'}% | ${stageDetail}`
            );
            break;
        } catch (err) {
            if (attempt === 2) {
                console.error(`[DB UPDATE ERROR for #${vidNum}${versionNum ? ` v${versionNum}` : ''}]:`, err.message);
            }
            await new Promise((r) => setTimeout(r, 1500));
        }
    }
}

/**
 * Authoritative Final DB Status Update (used only by finalize / complete failure).
 */
async function setFinalDbStatus({ status, progress, stageDetail, errorMsg = '', extra = {} }) {
    await ensureDbSchemaOnce();
    const safeProgress = Number.isFinite(Number(progress)) ? Math.max(0, Math.min(100, Math.round(Number(progress)))) : 0;
    const { safeAudioChannels } = sanitizeExtra(extra);

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const targetTag = versionNum ? `Video #${vidNum} (v${versionNum})` : `Video #${vidNum}`;
            console.log(`[DB FINAL] ${targetTag} Status: ${status} | Progress: ${safeProgress}% | ${stageDetail}`);

            if (versionNum) {
                const updatedRows = await sql`
                    UPDATE video_versions
                    SET
                      status = CAST(${status} AS TEXT),
                      transcode_progress = CAST(${safeProgress} AS INTEGER),
                      stage_detail = CAST(${stageDetail} AS TEXT),
                      error_message = CAST(${errorMsg} AS TEXT),
                      source_cache_br = NULL,
                      m3u8_cache_br = NULL,
                      source_cache_items_count = 0,
                      source_cache_expires_at = 0,
                      thumbnail_url = COALESCE(CAST(${extra.thumbnail_url ?? null} AS TEXT), thumbnail_url),
                      onedrive_folder_id = COALESCE(CAST(${extra.onedrive_folder_id ?? null} AS TEXT), onedrive_folder_id),
                      hls_folder_path = COALESCE(CAST(${extra.hls_folder_path ?? null} AS TEXT), hls_folder_path),
                      master_playlist_path = COALESCE(CAST(${extra.master_playlist_path ?? null} AS TEXT), master_playlist_path),
                      codec = COALESCE(CAST(${extra.codec ?? null} AS TEXT), codec),
                      audio_channels = COALESCE(CAST(${safeAudioChannels} AS INTEGER), audio_channels),
                      updated_at = NOW()
                    WHERE id = ${versionNum} AND video_id = ${vidNum}
                    RETURNING is_default, duration, resolution, fps, codec, bitrate, audio_channels, file_size_bytes;
                `;

                if (status === 'READY' && safeProgress === 100 && updatedRows?.[0]?.is_default) {
                    const dv = updatedRows[0];
                    await sql`
                        UPDATE videos
                        SET duration = COALESCE(CAST(${dv.duration ?? null} AS INTEGER), duration),
                            resolution = COALESCE(CAST(${dv.resolution ?? null} AS TEXT), resolution),
                            fps = COALESCE(CAST(${dv.fps ?? null} AS NUMERIC), fps),
                            codec = COALESCE(CAST(${dv.codec ?? null} AS TEXT), codec),
                            bitrate = COALESCE(CAST(${dv.bitrate ?? null} AS INTEGER), bitrate),
                            audio_channels = COALESCE(CAST(${dv.audio_channels ?? null} AS INTEGER), audio_channels),
                            file_size_bytes = COALESCE(CAST(${dv.file_size_bytes ?? null} AS BIGINT), file_size_bytes),
                            source_cache = NULL,
                            source_cache_br = NULL,
                            m3u8_cache_br = NULL,
                            source_cache_items_count = 0,
                            source_cache_expires_at = 0,
                            updated_at = NOW()
                        WHERE id = ${vidNum};
                    `.catch(() => { });
                }
            } else {
                await sql`
                    UPDATE videos
                    SET
                      status = CAST(${status} AS video_status),
                      transcode_progress = CAST(${safeProgress} AS INTEGER),
                      stage_detail = CAST(${stageDetail} AS TEXT),
                      error_message = CAST(${errorMsg} AS TEXT),
                      source_cache = NULL,
                      source_cache_br = NULL,
                      m3u8_cache_br = NULL,
                      source_cache_items_count = 0,
                      source_cache_expires_at = 0,
                      thumbnail_url = COALESCE(CAST(${extra.thumbnail_url ?? null} AS TEXT), thumbnail_url),
                      onedrive_folder_id = COALESCE(CAST(${extra.onedrive_folder_id ?? null} AS TEXT), onedrive_folder_id),
                      hls_folder_path = COALESCE(CAST(${extra.hls_folder_path ?? null} AS TEXT), hls_folder_path),
                      master_playlist_path = COALESCE(CAST(${extra.master_playlist_path ?? null} AS TEXT), master_playlist_path),
                      codec = COALESCE(CAST(${extra.codec ?? null} AS TEXT), codec),
                      audio_channels = COALESCE(CAST(${safeAudioChannels} AS INTEGER), audio_channels),
                      updated_at = NOW()
                    WHERE id = ${vidNum};
                `;
            }
            break;
        } catch (err) {
            if (attempt === 2) {
                console.error(`[DB FINAL ERROR for #${vidNum}${versionNum ? ` v${versionNum}` : ''}]:`, err.message);
            }
            await new Promise((r) => setTimeout(r, 1500));
        }
    }
}

async function recordLaneError(errorMsg) {
    await ensureDbSchemaOnce();
    try {
        if (versionNum) {
            await sql`
                UPDATE video_versions
                SET error_message = CASE
                  WHEN COALESCE(error_message, '') = '' THEN CAST(${errorMsg} AS TEXT)
                  ELSE error_message || chr(10) || CAST(${errorMsg} AS TEXT)
                END,
                updated_at = NOW()
                WHERE id = ${versionNum} AND video_id = ${vidNum};
            `;
        } else {
            await sql`
                UPDATE videos
                SET error_message = CASE
                  WHEN COALESCE(error_message, '') = '' THEN CAST(${errorMsg} AS TEXT)
                  ELSE error_message || chr(10) || CAST(${errorMsg} AS TEXT)
                END,
                updated_at = NOW()
                WHERE id = ${vidNum};
            `;
        }
    } catch (_) { }
}

function normalizeQualitiesList(rawList) {
    let arr = rawList;
    if (typeof arr === 'string') {
        try { arr = JSON.parse(arr); } catch { arr = []; }
    }
    if (!Array.isArray(arr)) return [];
    const byName = new Map();
    for (const item of arr) {
        if (!item || !item.name) continue;
        if (item.run_id && item.run_id !== TRANSCODE_RUN_ID) continue;
        byName.set(String(item.name), {
            name: String(item.name),
            width: Number(item.width) || 0,
            height: Number(item.height) || 0,
            bitrate: Number(item.bitrate) || 0,
            is_hdr: Boolean(item.is_hdr),
            is_fmp4: Boolean(item.is_fmp4 || item.is_hdr),
            hdr_type: item.hdr_type || null,
            audio_channels: item.audio_channels != null ? Number(item.audio_channels) : null,
            audio_layout: item.audio_layout || null,
            hires_audio: item.hires_audio && typeof item.hires_audio === 'object' ? item.hires_audio : null,
        });
    }
    return Array.from(byName.values()).sort((a, b) => a.bitrate - b.bitrate);
}

async function readRunQualitiesFromDb() {
    await ensureDbSchemaOnce();
    const rows = versionNum
        ? await sql`SELECT ready_qualities FROM video_versions WHERE id = ${versionNum} AND video_id = ${vidNum} LIMIT 1;`
        : await sql`SELECT ready_qualities FROM videos WHERE id = ${vidNum} LIMIT 1;`;
    return normalizeQualitiesList(rows?.[0]?.ready_qualities);
}

/**
 * Atomically registers newly completed qualities in Neon DB for this run,
 * builds the merged master.m3u8, uploads it to OneDrive, and verifies no
 * concurrent lane added a quality while our upload was in flight.
 */
async function registerQualitiesAndPublishMaster(driveId, streamFolderId, hlsOutputDir, newQualities) {
    await ensureDbSchemaOnce();
    const withRun = newQualities.map((q) => ({
        name: q.name,
        width: q.width,
        height: q.height,
        bitrate: q.bitrate,
        is_hdr: Boolean(q.is_hdr),
        is_fmp4: Boolean(q.is_fmp4 || q.is_hdr),
        hdr_type: q.hdr_type || null,
        audio_channels: q.audio_channels != null ? Number(q.audio_channels) : null,
        audio_layout: q.audio_layout || null,
        ...(q.hires_audio ? { hires_audio: q.hires_audio } : {}),
        run_id: TRANSCODE_RUN_ID,
    }));
    const namesToReplace = withRun.map((q) => q.name);
    const payloadJson = JSON.stringify(withRun);

    let mergedQualities = [];
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const rows = versionNum
                ? await sql`
                    UPDATE video_versions
                    SET
                      ready_qualities = COALESCE(
                        (
                          SELECT jsonb_agg(elem)
                          FROM jsonb_array_elements(COALESCE(video_versions.ready_qualities, '[]'::jsonb)) elem
                          WHERE elem->>'run_id' = ${TRANSCODE_RUN_ID}
                            AND NOT (elem->>'name' = ANY(${namesToReplace}::text[]))
                        ),
                        '[]'::jsonb
                      ) || ${payloadJson}::jsonb,
                      source_cache_br = NULL,
                      m3u8_cache_br = NULL,
                      source_cache_items_count = 0,
                      source_cache_expires_at = 0,
                      updated_at = NOW()
                    WHERE id = ${versionNum} AND video_id = ${vidNum}
                    RETURNING ready_qualities;
                `
                : await sql`
                    UPDATE videos
                    SET
                      ready_qualities = COALESCE(
                        (
                          SELECT jsonb_agg(elem)
                          FROM jsonb_array_elements(COALESCE(videos.ready_qualities, '[]'::jsonb)) elem
                          WHERE elem->>'run_id' = ${TRANSCODE_RUN_ID}
                            AND NOT (elem->>'name' = ANY(${namesToReplace}::text[]))
                        ),
                        '[]'::jsonb
                      ) || ${payloadJson}::jsonb,
                      source_cache = NULL,
                      source_cache_br = NULL,
                      m3u8_cache_br = NULL,
                      source_cache_items_count = 0,
                      source_cache_expires_at = 0,
                      updated_at = NOW()
                    WHERE id = ${vidNum}
                    RETURNING ready_qualities;
                `;
            mergedQualities = normalizeQualitiesList(rows?.[0]?.ready_qualities);
            break;
        } catch (err) {
            if (attempt === 2) throw err;
            await new Promise((r) => setTimeout(r, 1200));
        }
    }

    const masterPath = path.join(hlsOutputDir, 'master.m3u8');
    const buildSyncKey = (list) => {
        const namesKey = list.map((q) => q.name).join(',');
        const hr = list.find((q) => q.hires_audio)?.hires_audio;
        return hr ? `${namesKey}|hires:${hr.file}:${hr.bytes || 0}` : namesKey;
    };
    let publishedKey = '';
    for (let syncTry = 0; syncTry < 3; syncTry++) {
        const key = buildSyncKey(mergedQualities);
        if (key && key !== publishedKey) {
            fs.writeFileSync(masterPath, buildMasterM3U8(mergedQualities));
            await uploadFileToOneDrive(driveId, streamFolderId, 'master.m3u8', masterPath);
            publishedKey = key;
        }
        // Re-check DB once in case another lane registered a new quality during our PUT
        const latest = await readRunQualitiesFromDb();
        const latestKey = buildSyncKey(latest);
        if (!latestKey || latestKey === publishedKey) {
            return latest.length > 0 ? latest : mergedQualities;
        }
        mergedQualities = latest;
    }

    return mergedQualities;
}

// 3. Microsoft Graph API Helpers (Auto-refresh Token ป้องกัน Token หมดอายุกลางคัน)
let cachedToken = null;
let tokenExpiresAt = 0;

async function getGraphToken() {
    const now = Date.now();
    if (cachedToken && tokenExpiresAt > now + 120000) {
        return cachedToken;
    }

    const res = await fetchWithRetry(`https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: AZURE_CLIENT_ID,
            client_secret: AZURE_CLIENT_SECRET,
            scope: 'https://graph.microsoft.com/.default',
        }),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Failed to obtain Graph token (${res.status}): ${err}`);
    }

    const data = await res.json();
    cachedToken = data.access_token;
    tokenExpiresAt = now + (data.expires_in || 3600) * 1000;
    return cachedToken;
}

async function getUserDriveId() {
    const token = await getGraphToken();
    const res = await fetchWithRetry(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(ONEDRIVE_USER_ID)}/drive`, {
        headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Failed to get OneDrive Drive ID (${res.status}): ${err}`);
    }

    const data = await res.json();
    return data.id;
}

async function ensureFolderExists(driveId, folderPath) {
    const token = await getGraphToken();
    const cleanPath = folderPath.replace(/^\/+|\/+$/g, '');
    if (!cleanPath) return 'root';

    const checkRes = await fetchWithRetry(
        `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodeURIComponent(cleanPath)}`,
        { headers: { Authorization: `Bearer ${token}` } }
    );

    if (checkRes.ok) {
        const data = await checkRes.json();
        return data.id;
    }

    const segments = cleanPath.split('/').filter(Boolean);
    let currentParentId = 'root';

    for (const seg of segments) {
        const checkSegUrl = currentParentId === 'root'
            ? `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodeURIComponent(seg)}`
            : `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${currentParentId}:/${encodeURIComponent(seg)}`;

        const segRes = await fetchWithRetry(checkSegUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (segRes.ok) {
            const segData = await segRes.json();
            currentParentId = segData.id;
        } else {
            const createUrl = currentParentId === 'root'
                ? `https://graph.microsoft.com/v1.0/drives/${driveId}/root/children`
                : `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${currentParentId}/children`;

            const createRes = await fetchWithRetry(createUrl, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    name: seg,
                    folder: {},
                    '@microsoft.graph.conflictBehavior': 'fail',
                }),
            });

            if (createRes.status === 409 || createRes.status === 423) {
                // Concurrent lane created this folder at the exact same moment -> retry lookup cleanly
                let resolvedId = null;
                let lastErrText = '';
                for (let retry = 0; retry < 4; retry++) {
                    await new Promise((r) => setTimeout(r, 400 * (retry + 1)));
                    const fetchRes = await fetchWithRetry(checkSegUrl, {
                        headers: { Authorization: `Bearer ${await getGraphToken()}` },
                    });
                    if (fetchRes.ok) {
                        const fetched = await fetchRes.json();
                        resolvedId = fetched.id;
                        break;
                    }
                    lastErrText = await fetchRes.text();
                }
                if (!resolvedId) {
                    throw new Error(`Failed to resolve existing folder "${seg}" after conflict: ${lastErrText}`);
                }
                currentParentId = resolvedId;
            } else if (!createRes.ok) {
                const err = await createRes.text();
                throw new Error(`Failed to create folder "${seg}" (${createRes.status}): ${err}`);
            } else {
                const created = await createRes.json();
                currentParentId = created.id;
            }
        }
    }

    return currentParentId;
}

async function uploadFileToOneDrive(driveId, folderId, fileName, filePath) {
    const token = await getGraphToken();
    const stat = await fs.promises.stat(filePath);
    const fileSize = stat.size;

    if (fileSize < 4 * 1024 * 1024) {
        const fileBuffer = await fs.promises.readFile(filePath);
        const lowerName = fileName.toLowerCase();
        const contentType = lowerName.endsWith('.m3u8')
            ? 'application/vnd.apple.mpegurl'
            : lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')
                ? 'image/jpeg'
                : lowerName.endsWith('.vtt')
                    ? 'text/vtt'
                    : lowerName.endsWith('.m4s')
                        ? 'video/iso.segment'
                        : lowerName.endsWith('.mp4')
                            ? 'video/mp4'
                            : lowerName.endsWith('.wav')
                                ? 'audio/wav'
                                : lowerName.endsWith('.flac')
                                    ? 'audio/flac'
                                    : 'video/mp2t';

        const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}:/${encodeURIComponent(fileName)}:/content`;
        const res = await fetchWithRetry(url, {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Length': fileSize.toString(),
                'Content-Type': contentType,
            },
            body: fileBuffer,
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Failed to upload ${fileName} (${res.status}): ${err}`);
        }
        return await res.json();
    }

    // Files >= 4MB use chunked upload session streamed directly from disk (low RAM even for 1.5GB WAV)
    const sessionUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}:/${encodeURIComponent(fileName)}:/createUploadSession`;
    const sessionRes = await fetchWithRetry(sessionUrl, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            item: {
                '@microsoft.graph.conflictBehavior': 'replace',
                name: fileName,
            },
        }),
    });

    if (!sessionRes.ok) {
        const err = await sessionRes.text();
        throw new Error(`Failed to create upload session for ${fileName} (${sessionRes.status}): ${err}`);
    }

    const { uploadUrl } = await sessionRes.json();
    const CHUNK_SIZE = 10 * 1024 * 1024;
    const chunkBuf = Buffer.allocUnsafe(CHUNK_SIZE);
    let offset = 0;
    let uploadResult = null;
    const fh = await fs.promises.open(filePath, 'r');

    try {
        while (offset < fileSize) {
            const toRead = Math.min(CHUNK_SIZE, fileSize - offset);
            const { bytesRead } = await fh.read(chunkBuf, 0, toRead, offset);
            if (bytesRead <= 0) break;
            const end = offset + bytesRead;
            const chunk = chunkBuf.subarray(0, bytesRead);

            const putRes = await fetchWithRetry(uploadUrl, {
                method: 'PUT',
                headers: {
                    'Content-Length': bytesRead.toString(),
                    'Content-Range': `bytes ${offset}-${end - 1}/${fileSize}`,
                },
                body: chunk,
            });

            if (putRes.status === 200 || putRes.status === 201) {
                uploadResult = await putRes.json();
                break;
            } else if (putRes.status === 202) {
                offset = end;
            } else {
                const err = await putRes.text();
                throw new Error(`Failed to upload chunk for ${fileName} (${putRes.status}): ${err}`);
            }
        }
    } finally {
        await fh.close().catch(() => { });
    }

    return uploadResult;
}

// อัปโหลดไฟล์ทั้งหมดใน Pass แบบ Parallel Concurrency โดยอัปโหลด .ts/.jpg/.vtt ก่อน แล้วค่อยอัปโหลด variant .m3u8 ปิดท้ายเสมอ
// (master.m3u8 จะอัปโหลดแยกผ่าน registerQualitiesAndPublishMaster เพื่อกัน race condition ข้าม Lane)
async function uploadBatchFilesAndCleanup(driveId, folderId, hlsOutputDir, fileNames, cleanupTsAfterUpload = true, passLabel = '') {
    const filtered = fileNames.filter((f) => f !== 'master.m3u8');
    const segmentAndAssetFiles = filtered.filter((f) => !f.endsWith('.m3u8'));
    const playlistFiles = filtered.filter((f) => f.endsWith('.m3u8'));

    if (passLabel) {
        await logger.log(
            `⬆️ ${passLabel}: กำลังอัปโหลด ${segmentAndAssetFiles.length} เซกเมนต์ + ${playlistFiles.length} playlist ขึ้น OneDrive (${UPLOAD_CONCURRENCY}x parallel)...`,
            { toDb: false }
        );
    }

    let uploadedCount = 0;
    let lastUploadLogAt = Date.now();
    await runWithConcurrency(segmentAndAssetFiles, UPLOAD_CONCURRENCY, async (f) => {
        const fullPath = path.join(hlsOutputDir, f);
        await uploadFileToOneDrive(driveId, folderId, f, fullPath);
        uploadedCount++;
        if (Date.now() - lastUploadLogAt > 5000 && segmentAndAssetFiles.length > 10) {
            lastUploadLogAt = Date.now();
            console.log(`   📤 Upload progress${passLabel ? ` (${passLabel})` : ''}: ${uploadedCount}/${segmentAndAssetFiles.length} files`);
        }
        if (
            cleanupTsAfterUpload &&
            (f.endsWith('.ts') || f.endsWith('.m4s') || f.startsWith('init_') || f.startsWith('sprite_'))
        ) {
            try { fs.unlinkSync(fullPath); } catch (_) { }
        }
    });

    for (const f of playlistFiles) {
        await uploadFileToOneDrive(driveId, folderId, f, path.join(hlsOutputDir, f));
    }
}

function formatTime(sec) {
    if (!sec || isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function probeVideo(inputTarget, timeoutMs = 30000) {
    return new Promise((resolve) => {
        let settled = false;
        const done = (val) => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                resolve(val);
            }
        };

        const proc = spawn('ffprobe', [
            '-v', 'error',
            '-show_streams',
            '-show_format',
            '-of', 'json',
            inputTarget,
        ]);

        const timer = setTimeout(() => {
            try { proc.kill('SIGKILL'); } catch (_) { }
            done({});
        }, timeoutMs);

        let out = '';
        proc.stdout.on('data', (d) => { out += d.toString(); });
        proc.on('close', () => {
            try { done(JSON.parse(out)); } catch { done({}); }
        });
        proc.on('error', () => done({}));
    });
}

const LOSSLESS_AUDIO_CODEC_RE = /^(?:pcm_|flac|alac|truehd|mlp|wavpack|ape|tta|tak|dsd_|shorten|wmalossless)/i;
const MAX_HIRES_WAV_BYTES = 1.5 * 1024 * 1024 * 1024; // 1.5 GB cap -> auto-fallback to bit-perfect FLAC

function resolveAudioProfile(aStream, durationSec = 0) {
    if (!aStream) {
        return {
            hasAudio: false,
            srcAudioCodec: 'none',
            srcAudioChannels: 0,
            srcAudioLayout: 'none',
            srcSampleRate: 0,
            srcBitDepth: 0,
            audioChannels: 0,
            audioLayout: 'none',
            audioBitrateK: 0,
            audioLabel: 'No Audio',
            hiResEligible: false,
            hiResFormat: null,
            hiResFileName: null,
            hiResBitDepth: 0,
            hiResSampleRate: 0,
            hiResEstimatedBytes: 0,
            hiResFallbackReason: null,
        };
    }

    const srcCodec = String(aStream.codec_name || '').toLowerCase();
    const srcProfile = String(aStream.profile || '');
    const srcChannels = Number(aStream.channels) || 2;
    const srcLayout = String(aStream.channel_layout || '').trim();
    const srcSampleRate = Number(aStream.sample_rate) || 48000;
    const sampleFmt = String(aStream.sample_fmt || '').toLowerCase();
    const rawBits = Number(aStream.bits_per_raw_sample) || Number(aStream.bits_per_sample) || 0;
    const inferredBits = rawBits > 0
        ? rawBits
        : /(?:s24|s32|flt|dbl)/i.test(sampleFmt)
            ? 24
            : 16;

    let baseProfile;
    if (srcChannels === 1) {
        baseProfile = {
            audioChannels: 1,
            audioLayout: 'mono',
            audioBitrateK: 128,
            audioLabel: '1.0 Mono',
        };
    } else if (srcChannels === 2) {
        baseProfile = {
            audioChannels: 2,
            audioLayout: 'stereo',
            audioBitrateK: 192,
            audioLabel: '2.0 Stereo',
        };
    } else if (srcChannels >= 3 && srcChannels <= 6) {
        baseProfile = {
            audioChannels: 6,
            audioLayout: '5.1',
            audioBitrateK: 384,
            audioLabel: '5.1 Surround',
        };
    } else {
        baseProfile = {
            audioChannels: 8,
            audioLayout: '7.1',
            audioBitrateK: 512,
            audioLabel: '7.1 Surround',
        };
    }

    // Smart Auto-Detect: Export Hi-Res Lossless track ONLY when source is genuine Lossless or Hi-Res (>48kHz / >=24-bit)
    const isLosslessCodec =
        LOSSLESS_AUDIO_CODEC_RE.test(srcCodec) ||
        (srcCodec === 'dts' && /(?:ma|lossless|hd)/i.test(srcProfile));
    const hiResEligible = isLosslessCodec || srcSampleRate > 48000 || rawBits >= 24;

    const hiResBitDepth = inferredBits >= 24 ? 24 : 16;
    const hiResSampleRate = Math.min(192000, Math.max(44100, srcSampleRate));
    const bytesPerSample = hiResBitDepth === 24 ? 3 : 2;
    const hiResEstimatedBytes = hiResEligible
        ? Math.round(hiResSampleRate * bytesPerSample * baseProfile.audioChannels * Math.max(1, Number(durationSec) || 0))
        : 0;
    const shouldFallbackFlac = hiResEligible && hiResEstimatedBytes > MAX_HIRES_WAV_BYTES;
    const hiResFormat = hiResEligible ? (shouldFallbackFlac ? 'flac' : 'wav') : null;
    const hiResFileName = hiResFormat ? `audio_hires.${hiResFormat}` : null;

    return {
        hasAudio: true,
        srcAudioCodec: srcCodec || 'unknown',
        srcAudioChannels: srcChannels,
        srcAudioLayout: srcLayout || baseProfile.audioLayout,
        srcSampleRate,
        srcBitDepth: rawBits || inferredBits,
        ...baseProfile,
        hiResEligible,
        hiResFormat,
        hiResFileName,
        hiResBitDepth: hiResEligible ? hiResBitDepth : 0,
        hiResSampleRate: hiResEligible ? hiResSampleRate : 0,
        hiResEstimatedBytes,
        hiResFallbackReason: shouldFallbackFlac ? 'wav_exceeds_1.5gb' : null,
    };
}

function buildAudioEncodeArgs(meta) {
    if (!meta?.hasAudio || !meta.audioChannels) {
        return ['-an'];
    }
    return [
        '-filter:a', `aformat=channel_layouts=${meta.audioLayout}`,
        '-c:a', 'aac',
        '-b:a', `${meta.audioBitrateK}k`,
        '-ar', '48000',
        '-ac', String(meta.audioChannels),
    ];
}

function buildHiResAudioEncodeArgs(meta, inputPath, outputPath) {
    if (meta.hiResFormat === 'flac') {
        const is24 = meta.hiResBitDepth >= 24;
        return [
            '-y', '-threads', '0', '-i', inputPath,
            '-vn', '-map', '0:a:0',
            '-filter:a', `aformat=channel_layouts=${meta.audioLayout}`,
            '-c:a', 'flac', '-compression_level', '5',
            '-sample_fmt', is24 ? 's32' : 's16',
            ...(is24 ? ['-bits_per_raw_sample', '24'] : []),
            '-ar', String(meta.hiResSampleRate),
            '-ac', String(meta.audioChannels),
            outputPath,
        ];
    }
    const pcmCodec = meta.hiResBitDepth >= 24 ? 'pcm_s24le' : 'pcm_s16le';
    return [
        '-y', '-threads', '0', '-i', inputPath,
        '-vn', '-map', '0:a:0',
        '-filter:a', `aformat=channel_layouts=${meta.audioLayout}`,
        '-c:a', pcmCodec,
        '-ar', String(meta.hiResSampleRate),
        '-ac', String(meta.audioChannels),
        '-rf64', 'auto',
        outputPath,
    ];
}

async function exportAndUploadHiResAudio({ driveId, streamFolderId, hlsOutputDir, rawFilePath, meta }) {
    if (!meta?.hiResEligible || !meta.hiResFileName) return null;

    const outPath = path.join(hlsOutputDir, meta.hiResFileName);
    const rateKhz = (meta.hiResSampleRate / 1000).toFixed(meta.hiResSampleRate % 1000 === 0 ? 0 : 1);
    const fmtUpper = meta.hiResFormat === 'flac' ? 'FLAC Lossless' : 'Full PCM WAV';
    const fallbackNote = meta.hiResFallbackReason === 'wav_exceeds_1.5gb' ? ' (WAV > 1.5GB → Auto-FLAC)' : '';

    try {
        await logger.log(
            `🎧 Hi-Res Audio: กำลังสกัดเสียง ${fmtUpper} (${meta.hiResBitDepth}-bit / ${rateKhz} kHz • ${meta.audioLabel})${fallbackNote}...`
        );
        const args = buildHiResAudioEncodeArgs(meta, rawFilePath, outPath);
        await runFFmpeg(args, null, `Hi-Res Audio (${fmtUpper})`, meta.duration);

        const stat = await fs.promises.stat(outPath);
        const sizeMb = (stat.size / (1024 * 1024)).toFixed(1);
        await logger.log(`⬆️ Hi-Res Audio: กำลังอัปโหลด ${meta.hiResFileName} (${sizeMb} MB) ขึ้น OneDrive...`);
        await uploadFileToOneDrive(driveId, streamFolderId, meta.hiResFileName, outPath);

        const hiResInfo = {
            format: meta.hiResFormat,
            file: meta.hiResFileName,
            bits: meta.hiResBitDepth,
            rate: meta.hiResSampleRate,
            channels: meta.audioChannels,
            layout: meta.audioLayout,
            bytes: stat.size,
        };
        await logger.log(
            `✅ อัปโหลดเสียง Hi-Res Lossless สำเร็จ: ${meta.hiResFileName} (${meta.hiResBitDepth}-bit/${rateKhz}kHz • ${meta.audioLabel} • ${sizeMb} MB)`,
            { level: 'success' }
        );
        return hiResInfo;
    } catch (err) {
        await logger.log(`⚠️ ข้ามการสกัดเสียง Hi-Res Lossless (${err.message}) — สตรีม AAC หลักยังทำงานปกติ`, {
            level: 'warn',
        });
        return null;
    } finally {
        if (fs.existsSync(outPath)) {
            try { fs.unlinkSync(outPath); } catch (_) { }
        }
    }
}

function parseRatioNum(val, fallback = 0) {
    if (val == null) return fallback;
    if (typeof val === 'number') return Number.isFinite(val) ? val : fallback;
    const str = String(val).trim();
    if (!str) return fallback;
    if (str.includes('/')) {
        const [n, d] = str.split('/').map(Number);
        return d && Number.isFinite(n / d) ? n / d : fallback;
    }
    const num = Number(str);
    return Number.isFinite(num) ? num : fallback;
}

function extractHdr10Metadata(vStream, isHdr, hdrType) {
    if (!isHdr || hdrType === 'HLG') {
        return {
            hdrMasteringDisplay: null,
            hdrContentLight: null,
            hdrMaxNits: 0,
            hdrMaxCll: 0,
        };
    }
    const sideList = Array.isArray(vStream?.side_data_list) ? vStream.side_data_list : [];
    const mdcv = sideList.find((sd) => /mastering display/i.test(String(sd?.side_data_type || '')));
    const cll = sideList.find((sd) => /content light level/i.test(String(sd?.side_data_type || '')));

    let hdrMasteringDisplay = 'G(0.2650,0.6900)B(0.1500,0.0600)R(0.6800,0.3200)WP(0.3127,0.3290)L(1000.0000,0.0001)';
    let hdrMaxNits = 1000;
    if (mdcv) {
        const gx = parseRatioNum(mdcv.green_x, 0.265);
        const gy = parseRatioNum(mdcv.green_y, 0.69);
        const bx = parseRatioNum(mdcv.blue_x, 0.15);
        const by = parseRatioNum(mdcv.blue_y, 0.06);
        const rx = parseRatioNum(mdcv.red_x, 0.68);
        const ry = parseRatioNum(mdcv.red_y, 0.32);
        const wpx = parseRatioNum(mdcv.white_point_x, 0.3127);
        const wpy = parseRatioNum(mdcv.white_point_y, 0.329);
        const maxLum = Math.max(100, parseRatioNum(mdcv.max_luminance, 1000));
        const minLum = Math.max(0.0001, parseRatioNum(mdcv.min_luminance, 0.0001));
        hdrMaxNits = Math.round(maxLum);
        hdrMasteringDisplay = `G(${gx.toFixed(4)},${gy.toFixed(4)})B(${bx.toFixed(4)},${by.toFixed(4)})R(${rx.toFixed(4)},${ry.toFixed(4)})WP(${wpx.toFixed(4)},${wpy.toFixed(4)})L(${maxLum.toFixed(4)},${minLum.toFixed(4)})`;
    }

    let hdrMaxCll = 1000;
    let hdrMaxFall = 400;
    if (cll) {
        const mc = Number(cll.max_content) || 0;
        const ma = Number(cll.max_average) || 0;
        if (mc > 0) hdrMaxCll = Math.round(mc);
        if (ma > 0) hdrMaxFall = Math.round(ma);
    }
    const hdrContentLight = `${hdrMaxCll},${hdrMaxFall}`;
    return { hdrMasteringDisplay, hdrContentLight, hdrMaxNits, hdrMaxCll };
}

let cachedHasZscale = null;
function hasZscaleFilter() {
    if (cachedHasZscale !== null) return cachedHasZscale;
    try {
        const out = execFileSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8', timeout: 5000 });
        cachedHasZscale = /\bzscale\b/.test(out) && /\btonemap\b/.test(out);
    } catch {
        cachedHasZscale = false;
    }
    return cachedHasZscale;
}

function buildHdrToSdrToneMapChain(meta) {
    if (hasZscaleFilter()) {
        const tin = meta.hdrColorTrc || 'smpte2084';
        return `zscale=tin=${tin}:pin=bt2020:min=bt2020nc:t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv`;
    }
    return 'colorspace=all=bt709:iall=bt2020:fast=1';
}

function buildSvtAv1Params(meta, targetHeight) {
    const tileCols = targetHeight >= 2160 ? 2 : targetHeight >= 720 ? 1 : 0;
    const tileRows = targetHeight >= 1080 ? 1 : 0;
    const trcCode = meta.hdrType === 'HLG' ? 18 : 16;
    const parts = [
        'enable-hdr=1',
        'color-primaries=9',
        `transfer-characteristics=${trcCode}`,
        'matrix-coefficients=9',
        'color-range=0',
        'fast-decode=1',
    ];
    if (tileCols > 0) parts.push(`tile-columns=${tileCols}`);
    if (tileRows > 0) parts.push(`tile-rows=${tileRows}`);
    if (meta.hdrType !== 'HLG') {
        if (meta.hdrMasteringDisplay) parts.push(`mastering-display=${meta.hdrMasteringDisplay}`);
        if (meta.hdrContentLight) parts.push(`content-light=${meta.hdrContentLight}`);
    }
    return parts.join(':');
}

function parseProbeMeta(probeData) {
    const streams = probeData.streams || [];
    const vStream = streams.find((s) => s.codec_type === 'video') || streams[0] || {};
    const aStream = streams.find((s) => s.codec_type === 'audio') || null;
    const srcWidth = Number(vStream.width) || 1920;
    const srcHeight = Number(vStream.height) || 1080;
    const hasDimensions = Number(vStream.width) > 0 && Number(vStream.height) > 0;
    const duration = Math.round(parseFloat(probeData.format?.duration || vStream.duration || '0')) || 0;
    const audioProfile = resolveAudioProfile(aStream, duration);

    let fps = 30;
    if (vStream.r_frame_rate) {
        const [num, den] = String(vStream.r_frame_rate).split('/').map(Number);
        fps = den ? Math.round((num / den) * 1000) / 1000 : Math.round((num || 30) * 1000) / 1000;
    }
    const colorTransfer = String(vStream.color_transfer || '').toLowerCase();
    const colorPrimaries = String(vStream.color_primaries || '').toLowerCase();
    const colorSpace = String(vStream.color_space || '').toLowerCase();
    const pixFmt = String(vStream.pix_fmt || 'yuv420p').toLowerCase();
    const isHdr =
        colorTransfer === 'smpte2084' ||
        colorTransfer === 'arib-std-b67' ||
        (colorPrimaries === 'bt2020' && pixFmt.includes('10'));
    const hdrType = colorTransfer === 'arib-std-b67' ? 'HLG' : isHdr ? 'PQ' : null;
    const hdrColorTrc = hdrType === 'HLG' ? 'arib-std-b67' : 'smpte2084';
    const hdr10Meta = extractHdr10Metadata(vStream, isHdr, hdrType);
    const sourceCodec = vStream.codec_name || 'h264';
    const codec = isHdr ? 'av01' : 'h264';
    const bitrate = probeData.format?.bit_rate
        ? Math.round(parseInt(probeData.format.bit_rate, 10))
        : (vStream.bit_rate ? Math.round(parseInt(vStream.bit_rate, 10)) : 0);

    const maxDim = Math.max(srcWidth, srcHeight);
    const minDim = Math.min(srcWidth, srcHeight) || maxDim;
    let resolutionLabel = '360p';
    if (srcWidth >= 3840 || srcHeight >= 2160 || maxDim >= 3840 || minDim >= 2160) {
        resolutionLabel = '4K';
    } else if (srcWidth >= 2560 || srcHeight >= 1440 || maxDim >= 2560 || minDim >= 1440) {
        resolutionLabel = '2K';
    } else if (srcWidth >= 1920 || srcHeight >= 1080 || maxDim >= 1920 || minDim >= 1080) {
        resolutionLabel = '1080p';
    } else if (srcWidth >= 1280 || srcHeight >= 720 || maxDim >= 1280 || minDim >= 720) {
        resolutionLabel = '720p';
    } else if (srcWidth >= 854 || srcHeight >= 480 || maxDim >= 854 || minDim >= 480) {
        resolutionLabel = '480p';
    }

    const gopSize = String(fps > 0 ? Math.round(fps * 2) : 60);
    return {
        srcWidth,
        srcHeight,
        hasDimensions,
        duration,
        fps,
        codec,
        sourceCodec,
        bitrate,
        resolutionLabel,
        gopSize,
        pixFmt,
        colorSpace,
        colorTransfer,
        colorPrimaries,
        isHdr,
        hdrType,
        hdrColorTrc,
        ...hdr10Meta,
        ...audioProfile,
    };
}

function runFFmpeg(args, onProgress, stepLabel = '', durationSec = 0, options = {}) {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        let lastConsoleLogAt = 0;
        if (stepLabel) {
            console.log(`🎞️ [FFmpeg Start] ${stepLabel}...`);
        }
        const spawnOpts = options?.cwd ? { cwd: options.cwd } : undefined;
        const proc = spawn('ffmpeg', args, spawnOpts);
        let stderr = '';
        proc.stderr.on('data', (d) => {
            const str = d.toString();
            stderr += str;
            if (stderr.length > 10000) stderr = stderr.slice(-5000);
            const timeMatch = str.match(/time=(\d+):(\d+):(\d+\.\d+)/);
            if (timeMatch) {
                const sec = parseInt(timeMatch[1], 10) * 3600 + parseInt(timeMatch[2], 10) * 60 + parseFloat(timeMatch[3]);
                const speedMatch = str.match(/speed=\s*([\d.]+x)/);
                const speedText = speedMatch ? ` (${speedMatch[1]})` : '';
                if (stepLabel && Date.now() - lastConsoleLogAt >= 6000) {
                    lastConsoleLogAt = Date.now();
                    const pctText = durationSec > 0 ? `${Math.min(99, Math.round((sec / durationSec) * 100))}% ` : '';
                    console.log(
                        `   ⏱️ [${stepLabel}] ${pctText}${formatDurationShort(sec)}${durationSec > 0 ? ` / ${formatDurationShort(durationSec)}` : ''}${speedText}`
                    );
                }
                if (onProgress) onProgress(sec);
            }
        });
        proc.on('close', (code) => {
            const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
            if (code === 0) {
                if (stepLabel) console.log(`✅ [FFmpeg Done] ${stepLabel} (${elapsedSec}s)`);
                resolve();
            } else {
                reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`));
            }
        });
        proc.on('error', reject);
    });
}

function buildMasterM3U8(qualities) {
    const sorted = [...qualities].sort((a, b) => a.bitrate - b.bitrate);
    const hasHdr = sorted.some((q) => q.is_hdr);
    const hasFmp4 = hasHdr || sorted.some((q) => q.is_fmp4);
    const audioSample = sorted.find((q) => q.audio_channels != null) || null;
    const hiResSample = sorted.find((q) => q.hires_audio && q.hires_audio.file)?.hires_audio || null;
    const lines = ['#EXTM3U', `#EXT-X-VERSION:${hasFmp4 ? 7 : 3}`];
    if (audioSample) {
        lines.push(
            `#EXT-X-TUBELOCK-AUDIO:CHANNELS=${audioSample.audio_channels},LAYOUT=${audioSample.audio_layout || 'stereo'}`
        );
    }
    if (hiResSample) {
        lines.push(
            `#EXT-X-TUBELOCK-HIRES:FORMAT=${hiResSample.format || 'wav'},FILE=${hiResSample.file},BITS=${hiResSample.bits || 24},RATE=${hiResSample.rate || 48000},CHANNELS=${hiResSample.channels || 2},LAYOUT=${hiResSample.layout || 'stereo'},BYTES=${hiResSample.bytes || 0}`
        );
    }
    const hasAudioTrack = !audioSample || audioSample.audio_channels > 0;
    for (const q of sorted) {
        if (q.is_hdr) {
            const videoRange = q.hdr_type === 'HLG' ? 'HLG' : 'PQ';
            const trcCode = q.hdr_type === 'HLG' ? '18' : '16';
            const av1Level = q.height >= 1440 ? '12' : q.height >= 1080 ? '08' : q.height >= 720 ? '05' : '04';
            const codecs = hasAudioTrack
                ? `av01.0.${av1Level}M.10.0.110.09.${trcCode}.09.0,mp4a.40.2`
                : `av01.0.${av1Level}M.10.0.110.09.${trcCode}.09.0`;
            lines.push(
                `#EXT-X-STREAM-INF:BANDWIDTH=${q.bitrate},RESOLUTION=${q.width}x${q.height},CODECS="${codecs}",VIDEO-RANGE=${videoRange}`
            );
        } else if (hasFmp4) {
            // Dual-tier SDR H.264 rendition inside an fMP4 master playlist (seamless SourceBuffer.changeType)
            const avcHex = q.height >= 1080 ? '2a' : q.height >= 720 ? '1f' : q.height >= 360 ? '1e' : '15';
            const codecs = hasAudioTrack ? `avc1.6400${avcHex},mp4a.40.2` : `avc1.6400${avcHex}`;
            lines.push(
                `#EXT-X-STREAM-INF:BANDWIDTH=${q.bitrate},RESOLUTION=${q.width}x${q.height},CODECS="${codecs}",VIDEO-RANGE=SDR`
            );
        } else {
            lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${q.bitrate},RESOLUTION=${q.width}x${q.height}`);
        }
        lines.push(`${q.name}.m3u8`);
    }
    return lines.join('\n') + '\n';
}

function formatVttTime(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

function generateWebVTT({ duration, interval = 5, cols = 10, rows = 10, width = 160, height = 90, prefix = 'sprite_' }) {
    const totalFrames = Math.max(1, Math.ceil(duration / interval));
    const tilesPerSheet = cols * rows;
    let vtt = 'WEBVTT\n\n';

    for (let i = 0; i < totalFrames; i++) {
        const startSec = i * interval;
        const endSec = Math.min((i + 1) * interval, duration);
        const sheetIdx = Math.floor(i / tilesPerSheet) + 1;
        const sheetName = `${prefix}${String(sheetIdx).padStart(3, '0')}.jpg`;
        const indexInSheet = i % tilesPerSheet;
        const col = indexInSheet % cols;
        const row = Math.floor(indexInSheet / cols);
        const x = col * width;
        const y = row * height;

        vtt += `${formatVttTime(startSec)} --> ${formatVttTime(endSec)}\n`;
        vtt += `${sheetName}#xywh=${x},${y},${width},${height}\n\n`;
    }

    return vtt;
}

/**
 * Shared High-Sharpness Quality Pass for 720p / 1080p / 1440p / 2160p.
 * Preserves exact streaming bitrates while upgrading sharpness:
 * - `-preset fast` (subme=6, trellis=1, ref=2 -> active psy-rd)
 * - `flags=lanczos` + `-sws_flags lanczos`
 * - `-x264-params deblock=-1,-1` (prevents double-deblocking softness)
 * - `-force_key_frames expr:gte(t,n_forced*4)` (4s HLS segment alignment with scenecut I-frames enabled)
 */
async function runHighQualityPass({
    lane,
    passLabel,
    qualityName,
    width,
    height,
    level,
    bitrateK,
    maxrateK,
    bufsizeK,
    manifestBitrate,
    rawFilePath,
    hlsOutputDir,
    driveId,
    streamFolderId,
    streamFolderName,
    masterPlaylistPath,
    meta,
    lanePctStart,
    lanePctEnd,
    stagePrefix,
}) {
    const {
        duration,
        gopSize,
        resolutionLabel,
        fps,
        codec,
        bitrate,
        isHdr,
        hdrType,
        hdrColorTrc,
        audioChannels,
        audioLayout,
        audioLabel,
    } = meta;
    const audioArgs = buildAudioEncodeArgs(meta);
    // YouTube-style Smart Dual-Range Tiering:
    // - 1080p / 1440p / 2160p on HDR source (or 720p when source itself < 1080p) -> True AV1 10-bit HDR10 (MDCV/CLL + Multi-Tile fast-decode)
    // - 720p on >= 1080p HDR source -> Hable Tone-Mapped H.264 8-bit SDR in fMP4 (0% drop-frame smooth fallback for SDR monitors / older devices!)
    const encodeAsHdr = Boolean(isHdr && (height >= 1080 || meta.srcHeight < 1080));
    const useFmp4 = Boolean(isHdr);
    const svtParams = encodeAsHdr ? buildSvtAv1Params(meta, height) : null;
    const toneMapSuffix = isHdr && !encodeAsHdr ? `,${buildHdrToSdrToneMapChain(meta)}` : '';

    await logger.log(
        encodeAsHdr
            ? `⚡ ${passLabel}: กำลังหั่น ${qualityName} True HDR (${hdrType} • AV1 10-bit fMP4 + Multi-Tile fast-decode + ${bitrateK}k • เสียง ${audioLabel})...`
            : isHdr
                ? `⚡ ${passLabel}: กำลังหั่น ${qualityName} SDR (H.264 fMP4 + Hable HDR→SDR Tone-Map + ${bitrateK}k • เสียง ${audioLabel})...`
                : `⚡ ${passLabel}: กำลังหั่น ${qualityName} (preset fast + lanczos + ${bitrateK}k • เสียง ${audioLabel})...`
    );

    const ffmpegArgs = encodeAsHdr
        ? [
            '-y', '-threads', '0', '-i', rawFilePath,
            '-vf', `scale=w=${width}:h=${height}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos`,
            '-sws_flags', 'lanczos',
            '-pix_fmt', 'yuv420p10le',
            '-c:v', 'libsvtav1', '-preset', '8',
            '-svtav1-params', svtParams,
            '-g', gopSize,
            '-b:v', `${bitrateK}k`,
            '-color_primaries', 'bt2020',
            '-color_trc', hdrColorTrc,
            '-colorspace', 'bt2020nc',
            '-color_range', 'tv',
            ...audioArgs,
            '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod',
            '-hls_flags', 'independent_segments', '-hls_segment_type', 'fmp4',
            '-hls_fmp4_init_filename', `init_${qualityName}.mp4`,
            '-hls_segment_filename', `stream_${qualityName}_%03d.m4s`,
            `${qualityName}.m3u8`,
        ]
        : [
            '-y', '-threads', '0', '-i', rawFilePath,
            '-vf', `scale=w=${width}:h=${height}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos${toneMapSuffix},format=yuv420p`,
            '-sws_flags', 'lanczos',
            '-pix_fmt', 'yuv420p',
            '-c:v', 'libx264', '-preset', 'fast',
            '-profile:v', 'high', '-level', level,
            '-g', gopSize,
            '-force_key_frames', 'expr:gte(t,n_forced*4)',
            '-x264-params', 'deblock=-1,-1',
            '-b:v', `${bitrateK}k`, '-maxrate', `${maxrateK}k`, '-bufsize', `${bufsizeK}k`,
            ...(isHdr ? ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv'] : []),
            ...audioArgs,
            '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod',
            '-hls_flags', 'independent_segments',
            ...(useFmp4
                ? [
                    '-hls_segment_type', 'fmp4',
                    '-hls_fmp4_init_filename', `init_${qualityName}.mp4`,
                    '-hls_segment_filename', `stream_${qualityName}_%03d.m4s`,
                ]
                : [
                    '-hls_segment_type', 'mpegts',
                    '-hls_segment_filename', `stream_${qualityName}_%03d.ts`,
                ]),
            `${qualityName}.m3u8`,
        ];

    let lastProgressUpdate = 0;
    let progressInFlight = false;
    await runFFmpeg(
        ffmpegArgs,
        (sec) => {
            if (!progressInFlight && Date.now() - lastProgressUpdate > 4000 && duration > 0) {
                lastProgressUpdate = Date.now();
                progressInFlight = true;
                const pct = Math.min(99, Math.round((sec / duration) * 100));
                const lanePct = Math.min(
                    lanePctEnd - 2,
                    lanePctStart + Math.round((pct / 100) * Math.max(1, lanePctEnd - lanePctStart - 2))
                );
                updateLaneProgress({
                    lane,
                    lanePct,
                    status: 'TRANSCODING',
                    stageDetail: `${stagePrefix}${encodeAsHdr ? ' [HDR AV1]' : isHdr ? ' [SDR Tone-Map]' : ''}: ${pct}% (${formatTime(sec)} / ${formatTime(duration)} นาที)`,
                }).finally(() => {
                    progressInFlight = false;
                });
            }
        },
        passLabel,
        duration,
        { cwd: hlsOutputDir }
    );

    const passFiles = fs
        .readdirSync(hlsOutputDir)
        .filter((f) => f.includes(qualityName) && f !== 'master.m3u8');

    await uploadBatchFilesAndCleanup(driveId, streamFolderId, hlsOutputDir, passFiles, true, passLabel);

    const merged = await registerQualitiesAndPublishMaster(driveId, streamFolderId, hlsOutputDir, [
        {
            name: qualityName,
            width,
            height,
            bitrate: manifestBitrate,
            is_hdr: encodeAsHdr,
            is_fmp4: useFmp4,
            hdr_type: encodeAsHdr ? hdrType : null,
            audio_channels: audioChannels,
            audio_layout: audioLayout,
        },
    ]);

    const readyNames = merged.map((q) => q.name).join(', ');
    await updateLaneProgress({
        lane,
        lanePct: lanePctEnd,
        status: 'READY',
        stageDetail: `⚡ พร้อมรับชม (${readyNames}) • กำลังหั่นความละเอียดอื่นขนานกัน...`,
        invalidateCache: true,
        extra: {
            onedrive_folder_id: streamFolderId,
            hls_folder_path: `/streams/${streamFolderName}`,
            master_playlist_path: masterPlaylistPath,
            duration,
            resolution: resolutionLabel,
            fps,
            codec,
            bitrate,
            audio_channels: audioChannels,
        },
    });
    await logger.log(`✅ อัปโหลด ${qualityName} และซิงก์ master.m3u8 เรียบร้อย (พร้อมแล้ว: ${readyNames})`, {
        level: 'success',
    });
}

/**
 * LANE 1 (`fast_sd`): Poster + Pass 1 (144p + Storyboards SD/HD -> instant READY) + Pass 2/3 (360p + 480p)
 */
async function runLaneFastSd({
    driveId,
    streamFolderId,
    streamFolderName,
    masterPlaylistPath,
    rawFilePath,
    hlsOutputDir,
    meta,
    runnerSpecs,
}) {
    const {
        srcWidth,
        srcHeight,
        duration,
        fps,
        codec,
        bitrate,
        resolutionLabel,
        gopSize,
        isHdr,
        hdrType,
        hdrColorTrc,
        hasAudio,
        audioChannels,
        audioLayout,
    } = meta;
    const audioArgs = buildAudioEncodeArgs(meta);
    const mapAudioArgs = hasAudio ? ['-map', '0:a?'] : [];
    const posterPath = path.join(hlsOutputDir, 'poster.jpg');
    const thumbnailUrl = `/streams/${streamFolderName}/poster.jpg`;
    const seekTime = duration > 3 ? '00:00:03' : '00:00:01';

    const existingThumbRows = await (versionNum
        ? sql`SELECT thumbnail_url FROM video_versions WHERE id = ${versionNum} AND video_id = ${vidNum} LIMIT 1;`.catch(() => [])
        : sql`SELECT thumbnail_url FROM videos WHERE id = ${vidNum} LIMIT 1;`.catch(() => []));

    const existingThumbnailUrl = (existingThumbRows?.[0]?.thumbnail_url || '').trim();
    const dataImageMatch = existingThumbnailUrl.match(/^data:image\/(?:jpe?g|png|webp|gif|avif);base64,(.+)$/i);
    let shouldSetThumbUrl = false;

    if (dataImageMatch) {
        await fs.promises.writeFile(posterPath, Buffer.from(dataImageMatch[1], 'base64'));
    } else if (!existingThumbnailUrl) {
        shouldSetThumbUrl = true;
        const rawPosterPath = path.join(hlsOutputDir, 'poster_raw.jpg');
        const posterVf = isHdr
            ? `scale=w=1280:h=720:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,${buildHdrToSdrToneMapChain(meta)},format=yuvj420p`
            : 'format=yuvj420p';
        try {
            await runFFmpeg([
                '-y', '-threads', '0', '-ss', seekTime, '-i', rawFilePath,
                '-vf', posterVf,
                '-vframes', '1', '-update', '1', '-q:v', '2', rawPosterPath,
            ]);
            const posterDims = await new Promise((resolve) => {
                const p = spawn('ffprobe', [
                    '-v', 'error', '-select_streams', 'v:0',
                    '-show_entries', 'stream=width,height', '-of', 'json', rawPosterPath,
                ]);
                let sOut = '';
                p.stdout.on('data', (d) => { sOut += d.toString(); });
                p.on('close', () => {
                    try {
                        const st = (JSON.parse(sOut).streams || [])[0] || {};
                        resolve({ w: Number(st.width || 0), h: Number(st.height || 0) });
                    } catch {
                        resolve({ w: 0, h: 0 });
                    }
                });
                p.on('error', () => resolve({ w: 0, h: 0 }));
            });
            if (posterDims.w > 0 && posterDims.h > 0 && posterDims.w < posterDims.h) {
                const portraitFilter =
                    '[0:v]scale=960:540:force_original_aspect_ratio=increase,crop=960:540,setsar=1,gblur=sigma=40,eq=brightness=-0.20:saturation=0.85[bg];' +
                    '[0:v]scale=960:540:force_original_aspect_ratio=decrease,setsar=1[fg];' +
                    '[bg][fg]overlay=(W-w)/2:(H-h)/2';
                await runFFmpeg([
                    '-y', '-i', rawPosterPath,
                    '-filter_complex', portraitFilter,
                    '-frames:v', '1', '-update', '1', '-q:v', '2', posterPath,
                ]);
            } else {
                await fs.promises.rename(rawPosterPath, posterPath);
            }
        } finally {
            if (fs.existsSync(rawPosterPath)) {
                try { fs.unlinkSync(rawPosterPath); } catch (_) { }
            }
        }
    }

    const shouldPromotePosterUrl = shouldSetThumbUrl || Boolean(dataImageMatch);
    console.log('⬆️ Syncing poster.jpg & video metadata...');
    const uploadPosterPromise = fs.existsSync(posterPath)
        ? uploadFileToOneDrive(driveId, streamFolderId, 'poster.jpg', posterPath)
        : Promise.resolve();

    await Promise.all([
        uploadPosterPromise,
        updateLaneProgress({
            lane: 'fast_sd',
            lanePct: 15,
            status: 'PROCESSING',
            stageDetail: `วิเคราะห์สเปกสำเร็จ: ${srcWidth}x${srcHeight} (${resolutionLabel}), ${duration}s, ${fps}fps • เริ่มหั่นขนาน 5 เครื่อง`,
            invalidateCache: shouldPromotePosterUrl,
            extra: {
                duration,
                resolution: resolutionLabel,
                fps,
                codec,
                bitrate,
                audio_channels: audioChannels,
                thumbnail_url: shouldPromotePosterUrl ? thumbnailUrl : null,
                onedrive_folder_id: streamFolderId,
                hls_folder_path: `/streams/${streamFolderName}`,
                runner_specs: runnerSpecs,
            },
        }),
    ]);

    // PASS 1: Single-Pass (144p H.264 SDR + Two-Tier Storyboards SD & HD Simultaneously!)
    // On HDR sources, 144p/360p/480p/720p are Hable tone-mapped H.264 SDR in fMP4 so 144p unlocks in ~30s and SDR displays have zero lag!
    const sdToneMapChain = isHdr ? `,${buildHdrToSdrToneMapChain(meta)}` : '';
    const sdColorArgs = isHdr ? ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv'] : [];
    const buildSdHlsOutputArgs = (qName) =>
        isHdr
            ? [
                '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod',
                '-hls_flags', 'independent_segments', '-hls_segment_type', 'fmp4',
                '-hls_fmp4_init_filename', `init_${qName}.mp4`,
                '-hls_segment_filename', `stream_${qName}_%03d.m4s`,
                `${qName}.m3u8`,
            ]
            : [
                '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod',
                '-hls_flags', 'independent_segments', '-hls_segment_type', 'mpegts',
                '-hls_segment_filename', `stream_${qName}_%03d.ts`,
                `${qName}.m3u8`,
            ];

    await logger.log(
        isHdr
            ? '⚡ Pass 1: กำลังหั่น HLS 144p SDR (H.264 fMP4 + Hable Tone-Map ปลดล็อกไว) + Storyboard SD/HD...'
            : '⚡ Pass 1: กำลังหั่น HLS 144p + Storyboard SD/HD (Ultra-fast unlock)...'
    );
    let lastProgressUpdate = 0;
    let progressInFlight = false;
    let hasStoryboard = false;

    const pass1CombinedArgs = [
        '-y', '-threads', '0',
        '-i', rawFilePath,
        '-filter_complex',
        '[0:v]split=3[v144][vsd][vhd];' +
        `[v144]scale=w=256:h=144:force_original_aspect_ratio=decrease:force_divisible_by=2${sdToneMapChain},format=yuv420p[out144];` +
        `[vsd]fps=1/5,scale=160:90${sdToneMapChain},format=yuvj420p,tile=10x10[outsd];` +
        `[vhd]fps=1/5,scale=320:180${sdToneMapChain},format=yuvj420p,tile=5x5[outhd]`,
        // Output 1: 144p HLS (H.264 ultra-fast unlock — fMP4 when HDR source, MPEG-TS when SDR source)
        '-map', '[out144]', ...mapAudioArgs,
        '-pix_fmt', 'yuv420p',
        '-c:v', 'libx264', '-preset', 'ultrafast',
        '-profile:v', 'high', '-level', '2.1',
        '-g', gopSize, '-keyint_min', gopSize, '-sc_threshold', '0',
        '-b:v', '200k', '-maxrate', '250k', '-bufsize', '400k',
        ...sdColorArgs,
        ...audioArgs,
        ...buildSdHlsOutputArgs('144p'),
        // Output 2: SD Storyboard Sprites
        '-map', '[outsd]', '-q:v', '3', 'sprite_sd_%03d.jpg',
        // Output 3: HD Storyboard Sprites
        '-map', '[outhd]', '-q:v', '2', 'sprite_hd_%03d.jpg',
    ];

    const pass1FallbackArgs = [
        '-y', '-threads', '0', '-i', rawFilePath,
        '-vf', `scale=w=256:h=144:force_original_aspect_ratio=decrease:force_divisible_by=2${sdToneMapChain},format=yuv420p`,
        '-pix_fmt', 'yuv420p',
        '-c:v', 'libx264', '-preset', 'ultrafast',
        '-profile:v', 'high', '-level', '2.1',
        '-g', gopSize, '-keyint_min', gopSize, '-sc_threshold', '0',
        '-b:v', '200k', '-maxrate', '250k', '-bufsize', '400k',
        ...sdColorArgs,
        ...audioArgs,
        ...buildSdHlsOutputArgs('144p'),
    ];

    try {
        await runFFmpeg(
            pass1CombinedArgs,
            (sec) => {
                if (!progressInFlight && Date.now() - lastProgressUpdate > 4000 && duration > 0) {
                    lastProgressUpdate = Date.now();
                    progressInFlight = true;
                    const pct = Math.min(99, Math.round((sec / duration) * 100));
                    updateLaneProgress({
                        lane: 'fast_sd',
                        lanePct: Math.min(43, 15 + Math.round(pct * 0.28)),
                        status: 'TRANSCODING',
                        stageDetail: `กำลังหั่น 144p${isHdr ? ' HDR' : ''} + Storyboard (เร็วสุด): ${pct}% (${formatTime(sec)} / ${formatTime(duration)})`,
                    }).finally(() => {
                        progressInFlight = false;
                    });
                }
            },
            'Pass 1: 144p + Storyboard',
            duration,
            { cwd: hlsOutputDir }
        );
        hasStoryboard = true;
    } catch (combinedErr) {
        await logger.log(`⚠️ Combined pass fallback -> หั่น 144p เดี่ยว: ${combinedErr.message}`, { level: 'warn' });
        await runFFmpeg(
            pass1FallbackArgs,
            null,
            'Pass 1 Fallback: 144p',
            duration,
            { cwd: hlsOutputDir }
        );
    }

    if (hasStoryboard) {
        const vttSD = generateWebVTT({ duration, interval: 5, cols: 10, rows: 10, width: 160, height: 90, prefix: 'sprite_sd_' });
        const vttHD = generateWebVTT({ duration, interval: 5, cols: 5, rows: 5, width: 320, height: 180, prefix: 'sprite_hd_' });
        const vttStd = generateWebVTT({ duration, interval: 5, cols: 10, rows: 10, width: 160, height: 90, prefix: 'sprite_' });
        fs.writeFileSync(path.join(hlsOutputDir, 'thumbnails_sd.vtt'), vttSD);
        fs.writeFileSync(path.join(hlsOutputDir, 'thumbnails_hd.vtt'), vttHD);
        fs.writeFileSync(path.join(hlsOutputDir, 'thumbnails.vtt'), vttStd);

        const sdSprites = fs.readdirSync(hlsOutputDir).filter((f) => f.startsWith('sprite_sd_'));
        for (const f of sdSprites) {
            const stdName = f.replace('sprite_sd_', 'sprite_');
            fs.copyFileSync(path.join(hlsOutputDir, f), path.join(hlsOutputDir, stdName));
        }
    }

    const pass1Files = fs.readdirSync(hlsOutputDir).filter(
        (f) => f !== 'master.m3u8' && (f.includes('144p') || f.includes('thumbnails') || f.startsWith('sprite_'))
    );
    await uploadBatchFilesAndCleanup(driveId, streamFolderId, hlsOutputDir, pass1Files, true, 'Pass 1 (144p)');

    const mergedAfter144 = await registerQualitiesAndPublishMaster(driveId, streamFolderId, hlsOutputDir, [
        {
            name: '144p',
            width: 256,
            height: 144,
            bitrate: 200000,
            is_hdr: false,
            is_fmp4: isHdr,
            hdr_type: null,
            audio_channels: audioChannels,
            audio_layout: audioLayout,
        },
    ]);
    const readyAfter144Text = mergedAfter144.map((q) => q.name).join(', ');

    await logger.log(`🎉 144p + Storyboard พร้อมเล่นแล้ว! (พร้อมแล้ว: ${readyAfter144Text})`, { level: 'success' });
    await updateLaneProgress({
        lane: 'fast_sd',
        lanePct: 45,
        status: 'READY',
        stageDetail: `⚡ พร้อมรับชมทันที (${readyAfter144Text})! กำลังหั่น 360p-4K ขนานกันในพื้นหลัง...`,
        invalidateCache: true,
        extra: {
            onedrive_folder_id: streamFolderId,
            hls_folder_path: `/streams/${streamFolderName}`,
            master_playlist_path: masterPlaylistPath,
            storyboard_vtt_path: hasStoryboard ? `/streams/${streamFolderName}/thumbnails.vtt` : null,
            duration,
            resolution: resolutionLabel,
            fps,
            codec,
            bitrate,
            audio_channels: audioChannels,
            thumbnail_url: shouldPromotePosterUrl ? thumbnailUrl : null,
        },
    });

    // PASS 2 & 3 COMBINED: 360p + 480p in a SINGLE Decode Pass (H.264 SDR — Hable tone-mapped fMP4 on HDR sources, MPEG-TS on SDR sources)
    if (srcHeight >= 480) {
        await logger.log(
            isHdr
                ? '⚡ Pass 2/3: กำลังหั่น 360p + 480p SDR (H.264 fMP4 + Hable Tone-Map) พร้อมกัน...'
                : '⚡ Pass 2/3: กำลังหั่น 360p + 480p SD พร้อมกัน...'
        );
        const pass23Args = [
            '-y', '-threads', '0',
            '-i', rawFilePath,
            '-filter_complex',
            '[0:v]split=2[v360][v480];' +
            `[v360]scale=w=640:h=360:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos${sdToneMapChain},format=yuv420p[out360];` +
            `[v480]scale=w=854:h=480:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos${sdToneMapChain},format=yuv420p[out480]`,
            '-sws_flags', 'lanczos',
            // 360p Output (H.264 SDR)
            '-map', '[out360]', ...mapAudioArgs,
            '-pix_fmt', 'yuv420p',
            '-c:v', 'libx264', '-preset', 'veryfast',
            '-profile:v', 'high', '-level', '3.0',
            '-g', gopSize, '-keyint_min', gopSize, '-sc_threshold', '0',
            '-b:v', '600k', '-maxrate', '700k', '-bufsize', '1200k',
            ...sdColorArgs,
            ...audioArgs,
            ...buildSdHlsOutputArgs('360p'),
            // 480p Output (H.264 SDR)
            '-map', '[out480]', ...mapAudioArgs,
            '-pix_fmt', 'yuv420p',
            '-c:v', 'libx264', '-preset', 'veryfast',
            '-profile:v', 'high', '-level', '3.0',
            '-g', gopSize, '-keyint_min', gopSize, '-sc_threshold', '0',
            '-b:v', '1000k', '-maxrate', '1200k', '-bufsize', '2000k',
            ...sdColorArgs,
            ...audioArgs,
            ...buildSdHlsOutputArgs('480p'),
        ];

        await runFFmpeg(
            pass23Args,
            (sec) => {
                if (!progressInFlight && Date.now() - lastProgressUpdate > 4000 && duration > 0) {
                    lastProgressUpdate = Date.now();
                    progressInFlight = true;
                    const pct = Math.min(99, Math.round((sec / duration) * 100));
                    updateLaneProgress({
                        lane: 'fast_sd',
                        lanePct: Math.min(98, 45 + Math.round(pct * 0.53)),
                        status: 'READY',
                        stageDetail: `⚡ เปิดดูได้แล้ว • กำลังหั่น 360p & 480p${isHdr ? ' [SDR Tone-Map]' : ' SD'}: ${pct}% (${formatTime(sec)} / ${formatTime(duration)} นาที)`,
                    }).finally(() => {
                        progressInFlight = false;
                    });
                }
            },
            'Pass 2/3: 360p + 480p',
            duration,
            { cwd: hlsOutputDir }
        );

        const sdFiles = fs.readdirSync(hlsOutputDir).filter(
            (f) => f !== 'master.m3u8' && (f.includes('360p') || f.includes('480p'))
        );
        await uploadBatchFilesAndCleanup(driveId, streamFolderId, hlsOutputDir, sdFiles, true, '360p & 480p');

        const merged = await registerQualitiesAndPublishMaster(driveId, streamFolderId, hlsOutputDir, [
            {
                name: '360p',
                width: 640,
                height: 360,
                bitrate: 600000,
                is_hdr: false,
                is_fmp4: isHdr,
                hdr_type: null,
                audio_channels: audioChannels,
                audio_layout: audioLayout,
            },
            {
                name: '480p',
                width: 854,
                height: 480,
                bitrate: 1000000,
                is_hdr: false,
                is_fmp4: isHdr,
                hdr_type: null,
                audio_channels: audioChannels,
                audio_layout: audioLayout,
            },
        ]);
        const readyNames = merged.map((q) => q.name).join(', ');
        await updateLaneProgress({
            lane: 'fast_sd',
            lanePct: meta.hiResEligible ? 96 : 100,
            status: 'READY',
            stageDetail: meta.hiResEligible
                ? `⚡ พร้อมรับชม (${readyNames}) • กำลังสกัดเสียง Hi-Res Lossless (${meta.hiResFormat?.toUpperCase()})...`
                : `⚡ พร้อมรับชม (${readyNames}) • Lane 1 (SD) เสร็จสมบูรณ์`,
            invalidateCache: true,
        });
        await logger.log(`✅ อัปโหลด 360p + 480p และซิงก์ master.m3u8 เรียบร้อย (พร้อมแล้ว: ${readyNames})`, {
            level: 'success',
        });
    } else if (srcHeight >= 360) {
        await logger.log(isHdr ? '⚡ Pass 2: กำลังหั่น 360p SDR (H.264 fMP4 + Hable Tone-Map)...' : '⚡ Pass 2: กำลังหั่น 360p SD...');
        const pass2OnlyArgs = [
            '-y', '-threads', '0', '-i', rawFilePath,
            '-vf', `scale=w=640:h=360:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos${sdToneMapChain},format=yuv420p`,
            '-sws_flags', 'lanczos',
            '-pix_fmt', 'yuv420p',
            '-c:v', 'libx264', '-preset', 'veryfast',
            '-profile:v', 'high', '-level', '3.0',
            '-g', gopSize, '-keyint_min', gopSize, '-sc_threshold', '0',
            '-b:v', '600k', '-maxrate', '700k', '-bufsize', '1200k',
            ...sdColorArgs,
            ...audioArgs,
            ...buildSdHlsOutputArgs('360p'),
        ];
        await runFFmpeg(
            pass2OnlyArgs,
            null,
            'Pass 2: 360p',
            duration,
            { cwd: hlsOutputDir }
        );

        const pass2Files = fs.readdirSync(hlsOutputDir).filter((f) => f !== 'master.m3u8' && f.includes('360p'));
        await uploadBatchFilesAndCleanup(driveId, streamFolderId, hlsOutputDir, pass2Files, true, '360p');

        const merged = await registerQualitiesAndPublishMaster(driveId, streamFolderId, hlsOutputDir, [
            {
                name: '360p',
                width: 640,
                height: 360,
                bitrate: 600000,
                is_hdr: false,
                is_fmp4: isHdr,
                hdr_type: null,
                audio_channels: audioChannels,
                audio_layout: audioLayout,
            },
        ]);
        const readyNames = merged.map((q) => q.name).join(', ');
        await updateLaneProgress({
            lane: 'fast_sd',
            lanePct: meta.hiResEligible ? 96 : 100,
            status: 'READY',
            stageDetail: meta.hiResEligible
                ? `⚡ พร้อมรับชม (${readyNames}) • กำลังสกัดเสียง Hi-Res Lossless (${meta.hiResFormat?.toUpperCase()})...`
                : `⚡ พร้อมรับชม (${readyNames}) • Lane 1 (SD) เสร็จสมบูรณ์`,
            invalidateCache: true,
        });
        await logger.log(`✅ อัปโหลด 360p สำเร็จ (พร้อมแล้ว: ${readyNames})`, { level: 'success' });
    } else if (!meta.hiResEligible) {
        await updateLaneProgress({
            lane: 'fast_sd',
            lanePct: 100,
            status: 'READY',
            stageDetail: `⚡ พร้อมรับชม (${readyAfter144Text}) • Lane 1 (SD) เสร็จสมบูรณ์`,
        });
    }

    // SMART HI-RES LOSSLESS AUDIO EXPORT (Runs after SD passes so 144p instant READY is never delayed!)
    if (meta.hiResEligible) {
        const hiResInfo = await exportAndUploadHiResAudio({
            driveId,
            streamFolderId,
            hlsOutputDir,
            rawFilePath,
            meta,
        });
        if (hiResInfo) {
            const mergedWithHiRes = await registerQualitiesAndPublishMaster(driveId, streamFolderId, hlsOutputDir, [
                {
                    name: '144p',
                    width: 256,
                    height: 144,
                    bitrate: 200000,
                    is_hdr: false,
                    is_fmp4: isHdr,
                    hdr_type: null,
                    audio_channels: audioChannels,
                    audio_layout: audioLayout,
                    hires_audio: hiResInfo,
                },
            ]);
            const readyNames = mergedWithHiRes.map((q) => q.name).join(', ');
            await updateLaneProgress({
                lane: 'fast_sd',
                lanePct: 100,
                status: 'READY',
                stageDetail: `⚡ พร้อมรับชม (${readyNames}) + 🎧 Hi-Res ${hiResInfo.format.toUpperCase()} • Lane 1 เสร็จสมบูรณ์`,
                invalidateCache: true,
            });
        } else {
            await updateLaneProgress({
                lane: 'fast_sd',
                lanePct: 100,
                status: 'READY',
                stageDetail: `⚡ พร้อมรับชม • Lane 1 (SD) เสร็จสมบูรณ์`,
            });
        }
    }
}

/**
 * LANE 2 (`hd`): Dedicated 720p HD Runner (Pass 4)
 */
async function runLaneHd({
    driveId,
    streamFolderId,
    streamFolderName,
    masterPlaylistPath,
    rawFilePath,
    hlsOutputDir,
    meta,
}) {
    const has720 = meta.srcHeight >= 720;

    if (!has720) {
        await logger.log(`⏭️ ข้าม Lane 2 (720p HD) เนื่องจากต้นฉบับ ${meta.srcWidth}x${meta.srcHeight} ต่ำกว่า 720p`);
        await updateLaneProgress({
            lane: 'hd',
            lanePct: 100,
            status: 'PROCESSING',
            stageDetail: null,
        });
        return;
    }

    await runHighQualityPass({
        lane: 'hd',
        passLabel: 'Pass 4: 720p HD',
        qualityName: '720p',
        width: 1280,
        height: 720,
        level: '3.1',
        bitrateK: 3500,
        maxrateK: 4500,
        bufsizeK: 6000,
        manifestBitrate: 3500000,
        rawFilePath,
        hlsOutputDir,
        driveId,
        streamFolderId,
        streamFolderName,
        masterPlaylistPath,
        meta,
        lanePctStart: 10,
        lanePctEnd: 100,
        stagePrefix: '⚡ กำลังหั่น 720p HD (คมชัด)',
    });
}

/**
 * LANE 3 (`fhd`): Dedicated 1080p Full HD Runner (Pass 5)
 */
async function runLaneFhd({
    driveId,
    streamFolderId,
    streamFolderName,
    masterPlaylistPath,
    rawFilePath,
    hlsOutputDir,
    meta,
}) {
    const has1080 = meta.srcHeight >= 1080;

    if (!has1080) {
        await logger.log(`⏭️ ข้าม Lane 3 (1080p FHD) เนื่องจากต้นฉบับ ${meta.srcWidth}x${meta.srcHeight} ต่ำกว่า 1080p`);
        await updateLaneProgress({
            lane: 'fhd',
            lanePct: 100,
            status: 'PROCESSING',
            stageDetail: null,
        });
        return;
    }

    await runHighQualityPass({
        lane: 'fhd',
        passLabel: 'Pass 5: 1080p Full HD',
        qualityName: '1080p',
        width: 1920,
        height: 1080,
        level: '4.2',
        bitrateK: 8500,
        maxrateK: 11000,
        bufsizeK: 16000,
        manifestBitrate: 8500000,
        rawFilePath,
        hlsOutputDir,
        driveId,
        streamFolderId,
        streamFolderName,
        masterPlaylistPath,
        meta,
        lanePctStart: 10,
        lanePctEnd: 100,
        stagePrefix: '⚡ กำลังหั่น 1080p Full HD (คมชัด)',
    });
}

/**
 * LANE 4 (`qhd`): Dedicated 1440p 2K Runner (Pass 6)
 */
async function runLaneQhd({
    driveId,
    streamFolderId,
    streamFolderName,
    masterPlaylistPath,
    rawFilePath,
    hlsOutputDir,
    meta,
}) {
    const has1440 = meta.srcHeight >= 1440 || meta.srcWidth >= 2560;

    if (!has1440) {
        await logger.log(`⏭️ ข้าม Lane 4 (1440p 2K) เนื่องจากต้นฉบับ ${meta.srcWidth}x${meta.srcHeight} ต่ำกว่า 1440p`);
        await updateLaneProgress({
            lane: 'qhd',
            lanePct: 100,
            status: 'PROCESSING',
            stageDetail: null,
        });
        return;
    }

    await runHighQualityPass({
        lane: 'qhd',
        passLabel: 'Pass 6: 1440p 2K',
        qualityName: '1440p',
        width: 2560,
        height: 1440,
        level: '5.1',
        bitrateK: 12000,
        maxrateK: 16000,
        bufsizeK: 24000,
        manifestBitrate: 12000000,
        rawFilePath,
        hlsOutputDir,
        driveId,
        streamFolderId,
        streamFolderName,
        masterPlaylistPath,
        meta,
        lanePctStart: 10,
        lanePctEnd: 100,
        stagePrefix: '⚡ กำลังหั่น 2K Quad HD (1440p)',
    });
}

/**
 * LANE 5 (`uhd`): Dedicated 2160p 4K UHD Runner (Pass 7 — Full 4 Cores / 16GB RAM exclusively for 4K!)
 */
async function runLaneUhd({
    driveId,
    streamFolderId,
    streamFolderName,
    masterPlaylistPath,
    rawFilePath,
    hlsOutputDir,
    meta,
}) {
    const has2160 = meta.srcHeight >= 2160 || meta.srcWidth >= 3840;

    if (!has2160) {
        await logger.log(`⏭️ ข้าม Lane 5 (2160p 4K) เนื่องจากต้นฉบับ ${meta.srcWidth}x${meta.srcHeight} ต่ำกว่า 2160p`);
        await updateLaneProgress({
            lane: 'uhd',
            lanePct: 100,
            status: 'PROCESSING',
            stageDetail: null,
        });
        return;
    }

    await runHighQualityPass({
        lane: 'uhd',
        passLabel: 'Pass 7: 2160p 4K',
        qualityName: '2160p',
        width: 3840,
        height: 2160,
        level: '5.2',
        bitrateK: 20000,
        maxrateK: 24000,
        bufsizeK: 36000,
        manifestBitrate: 20000000,
        rawFilePath,
        hlsOutputDir,
        driveId,
        streamFolderId,
        streamFolderName,
        masterPlaylistPath,
        meta,
        lanePctStart: 10,
        lanePctEnd: 100,
        stagePrefix: '⚡ กำลังหั่น 4K UHD (2160p)',
    });
}

/**
 * FINALIZE JOB (`finalize`):
 * - Publishes authoritative final master.m3u8 from all completed qualities of this run
 * - Deletes /raw/{RAW_FILE_NAME} ONLY if all 5 lanes succeeded AND AI workers are idle
 * - Marks 100% READY (or FAILED if zero qualities succeeded)
 */
async function runFinalize({ driveId, streamFolderName, masterPlaylistPath, tempDir }) {
    await ensureDbSchemaOnce();

    const laneResults = {
        fast_sd: (process.env.LANE_FAST_SD_RESULT || 'success').trim().toLowerCase(),
        hd: (process.env.LANE_HD_RESULT || 'success').trim().toLowerCase(),
        fhd: (process.env.LANE_FHD_RESULT || 'success').trim().toLowerCase(),
        qhd: (process.env.LANE_QHD_RESULT || 'success').trim().toLowerCase(),
        uhd: (process.env.LANE_UHD_RESULT || 'success').trim().toLowerCase(),
    };
    const failedLanes = Object.entries(laneResults)
        .filter(([, res]) => res !== 'success' && res !== 'skipped')
        .map(([name, res]) => `${name}(${res})`);
    const allLanesSucceeded = failedLanes.length === 0;

    const dbRows = versionNum
        ? await sql`SELECT onedrive_folder_id, ready_qualities, error_message FROM video_versions WHERE id = ${versionNum} AND video_id = ${vidNum} LIMIT 1;`
        : await sql`SELECT onedrive_folder_id, ready_qualities, error_message FROM videos WHERE id = ${vidNum} LIMIT 1;`;

    const row = dbRows?.[0] || {};
    const readyQualities = normalizeQualitiesList(row.ready_qualities);
    const existingError = (row.error_message || '').trim();

    if (readyQualities.length === 0) {
        const failReason = existingError || `ไม่มีความละเอียดใดแปลงสำเร็จ (Lanes failed: ${failedLanes.join(', ') || 'unknown'})`;
        await logger.log(`❌ Finalize: การแปลง HLS ล้มเหลวทุกความละเอียด — ${failReason}`, { level: 'error' });
        await setFinalDbStatus({
            status: 'FAILED',
            progress: 0,
            stageDetail: 'การแปลงไฟล์ล้มเหลว',
            errorMsg: failReason,
        });
        process.exit(1);
    }

    const streamFolderId = row.onedrive_folder_id || (await ensureFolderExists(driveId, `streams/${streamFolderName}`));
    const hlsOutputDir = path.join(tempDir, 'hls');
    fs.mkdirSync(hlsOutputDir, { recursive: true });

    const finalMasterPath = path.join(hlsOutputDir, 'master.m3u8');
    fs.writeFileSync(finalMasterPath, buildMasterM3U8(readyQualities));
    await uploadFileToOneDrive(driveId, streamFolderId, 'master.m3u8', finalMasterPath);

    const finalQualitiesText = readyQualities.map((q) => q.name).join(', ');
    await logger.log(`📋 Finalize: อัปโหลด master.m3u8 ฉบับสมบูรณ์ (${finalQualitiesText}) เรียบร้อยแล้ว`);

    if (allLanesSucceeded && RAW_FILE_NAME) {
        try {
            const checkRows = versionNum
                ? await sql`
                    SELECT audio_status, sprite_status, rating_check_status
                    FROM videos
                    WHERE id = ${vidNum} AND raw_file_name = ${RAW_FILE_NAME}
                    LIMIT 1;
                `.catch(() => [])
                : await sql`
                    SELECT audio_status, sprite_status, rating_check_status
                    FROM videos
                    WHERE id = ${vidNum}
                    LIMIT 1;
                `.catch(() => []);
            const st = checkRows?.[0] || {};
            const otherWorkersBusy =
                st.audio_status === 'extracting' ||
                st.audio_status === 'queued' ||
                st.sprite_status === 'generating' ||
                st.sprite_status === 'queued' ||
                st.rating_check_status === 'analyzing';

            if (otherWorkersBusy) {
                await logger.log(`ℹ️ เก็บไฟล์ดิบ /raw/${RAW_FILE_NAME} ไว้ชั่วคราวเพราะ AI Audio/Vision Worker กำลังใช้งานอยู่`);
            } else {
                const token = await getGraphToken();
                const itemRes = await fetchWithRetry(
                    `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/raw/${encodeURIComponent(RAW_FILE_NAME)}?select=id`,
                    { headers: { Authorization: `Bearer ${token}` } }
                );
                if (itemRes.ok) {
                    const itemData = await itemRes.json();
                    await logger.log(`🗑️ กำลังลบไฟล์ต้นฉบับ /raw/${RAW_FILE_NAME} หลังหั่น HLS ครบถ้วน...`, { toDb: false });
                    await fetchWithRetry(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemData.id}`, {
                        method: 'DELETE',
                        headers: { Authorization: `Bearer ${await getGraphToken()}` },
                    });
                    console.log('✅ Raw file deleted.');
                }
            }
        } catch (delErr) {
            console.warn('⚠️ Could not delete raw file:', delErr.message);
        }
    } else if (!allLanesSucceeded) {
        await logger.log(
            `⚠️ เก็บไฟล์ต้นฉบับ /raw/${RAW_FILE_NAME} ไว้เนื่องจากมี Lane ล้มเหลว (${failedLanes.join(', ')}) — สามารถกด Re-run failed jobs ได้`,
            { level: 'warn' }
        );
    }

    const finalAudioSample = readyQualities.find((q) => q.audio_channels != null) || null;
    const finalExtra = {
        onedrive_folder_id: streamFolderId,
        hls_folder_path: `/streams/${streamFolderName}`,
        master_playlist_path: masterPlaylistPath,
        codec: readyQualities.some((q) => q.is_hdr) ? 'av01' : null,
        audio_channels: finalAudioSample ? finalAudioSample.audio_channels : null,
    };

    if (allLanesSucceeded) {
        await setFinalDbStatus({
            status: 'READY',
            progress: 100,
            stageDetail: `เสร็จสมบูรณ์ทุกความละเอียด (${finalQualitiesText}) พร้อมรับชมแบบเต็มประสิทธิภาพ`,
            errorMsg: '',
            extra: finalExtra,
        });
        await logger.log(`🎉 เสร็จสมบูรณ์ 100% (${finalQualitiesText}) พร้อมรับชมแล้ว!`, { level: 'success' });
    } else {
        const partialWarn = `บาง Lane ล้มเหลว (${failedLanes.join(', ')})${existingError ? `: ${existingError}` : ''}`;
        await setFinalDbStatus({
            status: 'READY',
            progress: 100,
            stageDetail: `พร้อมรับชมบางความละเอียด (${finalQualitiesText}) • บาง Lane ล้มเหลว (เก็บไฟล์ต้นฉบับไว้ให้ลองใหม่)`,
            errorMsg: partialWarn,
            extra: finalExtra,
        });
        await logger.log(`⚠️ Finalize: พร้อมรับชม (${finalQualitiesText}) แต่ ${partialWarn}`, { level: 'warn' });
        process.exit(1);
    }
}

// 4. Main Entrypoint
async function main() {
    const streamWorkKey = versionNum ? `${vidNum}_v${versionNum}` : String(vidNum);
    const streamFolderName = versionNum ? `stream_vid_${vidNum}_v${versionNum}` : `stream_vid_${vidNum}`;
    const masterPlaylistPath = `/streams/${streamFolderName}/master.m3u8`;
    let tempDir = path.resolve('./temp_transcode', `${streamWorkKey}_${TRANSCODE_LANE}`);

    try {
        await ensureDbSchemaOnce();
        const driveId = await getUserDriveId();

        // Finalize mode needs no raw download or FFmpeg
        if (TRANSCODE_LANE === 'finalize') {
            fs.mkdirSync(tempDir, { recursive: true });
            await runFinalize({ driveId, streamFolderName, masterPlaylistPath, tempDir });
            return;
        }

        const runnerSpecs = getRunnerSpecs();
        console.log(`🖥️ Runner Machine Specs [${TRANSCODE_LANE}]:`, JSON.stringify(runnerSpecs, null, 2));
        await logger.log(
            `🎬 เริ่ม ${LANE_DISPLAY_LABELS[TRANSCODE_LANE]} #${vidNum}${versionNum ? ` (Version #${versionNum})` : ''} บน ${runnerSpecs.cpuModel} (${runnerSpecs.cpuCores} Cores, Disk ${runnerSpecs.diskSpace})`
        );

        if (TRANSCODE_LANE === 'fast_sd' || TRANSCODE_LANE === 'all') {
            await updateLaneProgress({
                lane: 'fast_sd',
                lanePct: 5,
                status: 'PROCESSING',
                stageDetail: `GitHub Actions (5x Parallel • Dedicated 4K) พร้อมทำงาน: ${runnerSpecs.cpuModel} (${runnerSpecs.cpuCores} Cores × 5)`,
                extra: { runner_specs: runnerSpecs },
            });
        }

        // Locate raw file on OneDrive
        console.log(`🔍 Locating /raw/${RAW_FILE_NAME} on OneDrive...`);
        const token = await getGraphToken();
        const itemUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/raw/${encodeURIComponent(RAW_FILE_NAME)}?select=id,name,size,@microsoft.graph.downloadUrl`;
        const itemRes = await fetchWithRetry(itemUrl, { headers: { Authorization: `Bearer ${token}` } });

        if (!itemRes.ok) {
            const err = await itemRes.text();
            throw new Error(`ไม่พบไฟล์ /raw/${RAW_FILE_NAME} บน OneDrive (${itemRes.status}): ${err}`);
        }

        const itemData = await itemRes.json();
        const rawFileSize = itemData.size || 0;
        const downloadUrl = itemData['@microsoft.graph.downloadUrl'];

        // Fast remote ffprobe pre-check for Lane 2 (720p), Lane 3 (1080p), Lane 4 (2K) & Lane 5 (4K):
        // Avoid downloading multi-GB raw files when source resolution is below this lane's threshold!
        if (['hd', 'fhd', 'qhd', 'uhd'].includes(TRANSCODE_LANE)) {
            const remoteProbe = await probeVideo(downloadUrl, 15000);
            const remoteMeta = parseProbeMeta(remoteProbe);
            if (remoteMeta.hasDimensions) {
                if (TRANSCODE_LANE === 'hd' && remoteMeta.srcHeight < 720) {
                    await logger.log(
                        `⏭️ ข้าม Lane 2 (720p HD) โดยไม่ต้องดาวน์โหลด (ต้นฉบับ ${remoteMeta.srcWidth}x${remoteMeta.srcHeight} ต่ำกว่า 720p)`
                    );
                    await updateLaneProgress({ lane: 'hd', lanePct: 100, status: 'PROCESSING', stageDetail: null });
                    return;
                }
                if (TRANSCODE_LANE === 'fhd' && remoteMeta.srcHeight < 1080) {
                    await logger.log(
                        `⏭️ ข้าม Lane 3 (1080p FHD) โดยไม่ต้องดาวน์โหลด (ต้นฉบับ ${remoteMeta.srcWidth}x${remoteMeta.srcHeight} ต่ำกว่า 1080p)`
                    );
                    await updateLaneProgress({ lane: 'fhd', lanePct: 100, status: 'PROCESSING', stageDetail: null });
                    return;
                }
                if (TRANSCODE_LANE === 'qhd' && remoteMeta.srcHeight < 1440 && remoteMeta.srcWidth < 2560) {
                    await logger.log(
                        `⏭️ ข้าม Lane 4 (1440p 2K) โดยไม่ต้องดาวน์โหลด (ต้นฉบับ ${remoteMeta.srcWidth}x${remoteMeta.srcHeight} ต่ำกว่า 1440p)`
                    );
                    await updateLaneProgress({ lane: 'qhd', lanePct: 100, status: 'PROCESSING', stageDetail: null });
                    return;
                }
                if (TRANSCODE_LANE === 'uhd' && remoteMeta.srcHeight < 2160 && remoteMeta.srcWidth < 3840) {
                    await logger.log(
                        `⏭️ ข้าม Lane 5 (2160p 4K) โดยไม่ต้องดาวน์โหลด (ต้นฉบับ ${remoteMeta.srcWidth}x${remoteMeta.srcHeight} ต่ำกว่า 2160p)`
                    );
                    await updateLaneProgress({ lane: 'uhd', lanePct: 100, status: 'PROCESSING', stageDetail: null });
                    return;
                }
            }
        }

        // Select work directory (/dev/shm for small files, freed NVMe SSD for large files)
        tempDir = selectOptimalWorkDir(streamWorkKey, rawFileSize, TRANSCODE_LANE);
        const rawFilePath = path.join(tempDir, 'raw_' + RAW_FILE_NAME);
        const hlsOutputDir = path.join(tempDir, 'hls');
        fs.mkdirSync(tempDir, { recursive: true });
        fs.mkdirSync(hlsOutputDir, { recursive: true });
        await logger.log(
            `📂 โฟลเดอร์ทำงาน: ${tempDir.startsWith('/dev/shm') ? '/dev/shm (RAM Disk)' : tempDir} | ขนาดต้นฉบับ ${(rawFileSize / (1024 * 1024)).toFixed(1)} MB`,
            { toDb: false }
        );

        await downloadFileWithProgress(downloadUrl, rawFilePath, {
            label: `ไฟล์ต้นฉบับ (${RAW_FILE_NAME})`,
            expectedSizeBytes: rawFileSize,
            logger,
            stallTimeoutMs: 120000,
        });

        // Probe locally & ensure destination folder in parallel (409/423 conflict-safe across 3 lanes)
        const [probeData, streamFolderId] = await Promise.all([
            probeVideo(rawFilePath, 30000),
            ensureFolderExists(driveId, `streams/${streamFolderName}`),
        ]);

        const meta = parseProbeMeta(probeData);
        const hdrTag = meta.isHdr
            ? ` | 🌈 True HDR (${meta.hdrType} • ${meta.pixFmt}${meta.hdrMaxNits ? ` • ${meta.hdrMaxNits}nit / MaxCLL ${meta.hdrMaxCll}` : ''}) -> 144p–720p H.264 SDR + 1080p–4K AV1 10-bit HDR10 fMP4`
            : ` | SDR (${meta.pixFmt}) -> H.264`;
        const hiResTag = meta.hiResEligible
            ? ` + 🎧 Hi-Res ${meta.hiResBitDepth}-bit/${(meta.hiResSampleRate / 1000).toFixed(meta.hiResSampleRate % 1000 === 0 ? 0 : 1)}kHz ${meta.hiResFormat.toUpperCase()}${meta.hiResFallbackReason ? ' (Auto-FLAC >1.5GB)' : ''}`
            : '';
        const audioTag = meta.hasAudio
            ? ` | 🔊 Audio: ${meta.audioLabel} (${meta.srcAudioCodec} -> ${meta.audioBitrateK}k AAC${hiResTag})`
            : ' | 🔇 No Audio';
        await logger.log(
            `📐 สเปกจาก ffprobe: ${meta.srcWidth}x${meta.srcHeight} (${meta.resolutionLabel}), ยาว ${formatDurationShort(meta.duration)}, ${meta.fps} fps, Source: ${meta.sourceCodec}, Bitrate: ${Math.round(meta.bitrate / 1000)} kbps${hdrTag}${audioTag}`
        );

        const laneCtx = {
            driveId,
            streamFolderId,
            streamFolderName,
            masterPlaylistPath,
            rawFilePath,
            hlsOutputDir,
            meta,
            runnerSpecs,
        };

        if (TRANSCODE_LANE === 'fast_sd') {
            await runLaneFastSd(laneCtx);
        } else if (TRANSCODE_LANE === 'hd') {
            await runLaneHd(laneCtx);
        } else if (TRANSCODE_LANE === 'fhd') {
            await runLaneFhd(laneCtx);
        } else if (TRANSCODE_LANE === 'qhd') {
            await runLaneQhd(laneCtx);
        } else if (TRANSCODE_LANE === 'uhd') {
            await runLaneUhd(laneCtx);
        } else {
            // Legacy 'all' mode (local CLI fallback): run all 5 lanes + finalize sequentially
            await runLaneFastSd(laneCtx);
            await runLaneHd(laneCtx);
            await runLaneFhd(laneCtx);
            await runLaneQhd(laneCtx);
            await runLaneUhd(laneCtx);
            await runFinalize({ driveId, streamFolderName, masterPlaylistPath, tempDir });
        }
    } catch (err) {
        console.error(`❌ [Transcode Worker Error - ${TRANSCODE_LANE}]:`, err);
        await logger.log(`❌ การแปลง HLS (${TRANSCODE_LANE}) ล้มเหลว: ${err.message}`, { level: 'error' }).catch(() => { });
        if (IS_PARALLEL_LANE) {
            // In parallel mode, record error without downgrading READY status; finalize decides final status!
            await recordLaneError(`[${TRANSCODE_LANE}] ${err.message}`);
        } else {
            await setFinalDbStatus({
                status: 'FAILED',
                progress: 0,
                stageDetail: 'การแปลงไฟล์ล้มเหลว',
                errorMsg: err.message,
            });
        }
        process.exit(1);
    } finally {
        try {
            if (fs.existsSync(tempDir)) {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        } catch (_) { }
    }
}

main();
