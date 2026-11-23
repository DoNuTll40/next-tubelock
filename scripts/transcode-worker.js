/**
 * TubeLock Progressive Cloud Transcoder Worker (3x Parallel Lanes + Sharpness Tuned)
 * Optimized for GitHub Actions Public Repo Runner (3x 4 vCPU / 16GB RAM / Freed NVMe + RAM Disk)
 *
 * Parallel Multi-Lane Architecture (100% Output & API Compatible):
 * - Lane 1 (`fast_sd`): poster.jpg + Pass 1 (144p + Storyboard SD/HD -> instant READY) + Pass 2/3 (360p + 480p)
 * - Lane 2 (`hd`):      Pass 4 (720p HD) + Pass 6 (1440p 2K if source >= 1440p)
 * - Lane 3 (`fhd`):     Pass 5 (1080p Full HD) + Pass 7 (2160p 4K if source >= 2160p)
 * - Finalize (`finalize`): Authoritative master.m3u8 sync + /raw/ cleanup (when AI workers idle) + 100% READY
 * - Legacy (`all`):     Runs all lanes + finalize sequentially in one process (local CLI fallback)
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
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

const VALID_LANES = new Set(['all', 'fast_sd', 'hd', 'fhd', 'finalize']);
const RAW_LANE = (process.env.TRANSCODE_LANE || 'all').trim().toLowerCase();
const TRANSCODE_LANE = VALID_LANES.has(RAW_LANE) ? RAW_LANE : 'all';
const IS_PARALLEL_LANE = TRANSCODE_LANE === 'fast_sd' || TRANSCODE_LANE === 'hd' || TRANSCODE_LANE === 'fhd';
const TRANSCODE_RUN_ID = (
    process.env.TRANSCODE_RUN_ID ||
    process.env.GITHUB_RUN_ID ||
    `local_${Date.now()}`
).trim();

// โหมดขนาน 3 เครื่องใช้เครื่องละ 4 (รวม 12 concurrent PUTs) ป้องกัน Microsoft Graph 429 Throttle
const UPLOAD_CONCURRENCY = IS_PARALLEL_LANE ? 4 : 8;

const LANE_DISPLAY_LABELS = {
    fast_sd: 'HLS Lane 1 (SD)',
    hd: 'HLS Lane 2 (HD)',
    fhd: 'HLS Lane 3 (FHD/4K)',
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
            parallelLanes: IS_PARALLEL_LANE ? 3 : 1,
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
            parallelLanes: IS_PARALLEL_LANE ? 3 : 1,
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
            const maxRawForShm = lane === 'fast_sd' ? 4.5 * 1024 ** 3 : 2.0 * 1024 ** 3;
            const safetyMultiplier = lane === 'fast_sd' ? 2.5 : 3.5;
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
        () => sql`ALTER TABLE video_versions ADD COLUMN IF NOT EXISTS m3u8_cache_br TEXT;`,
        () => sql`ALTER TABLE video_versions ADD COLUMN IF NOT EXISTS ready_qualities JSONB DEFAULT '[]'::jsonb;`,
        () => sql`ALTER TABLE video_versions ADD COLUMN IF NOT EXISTS lane_progress JSONB DEFAULT '{}'::jsonb;`,
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
    };
}

/**
 * Atomic, Monotonic, Race-Free Lane Progress & Metadata Update.
 * - Uses direct column expressions inside UPDATE SET (no CTE reading the same table)
 *   so PostgreSQL row locks serialize concurrent lanes cleanly.
 * - Never downgrades status once 'READY' is reached.
 * - Computes weighted transcode_progress across fast_sd (30%), hd (25%), fhd (30%) + base 10% (cap 95%).
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
    const { safeDuration, safeFps, safeBitrate, safeFileSize } = sanitizeExtra(extra);
    const laneKey = ['fast_sd', 'hd', 'fhd'].includes(lane) ? lane : 'fast_sd';

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
                                  ELSE COALESCE((lane_progress->'lanes'->>'fast_sd')::int, 0) END) * 0.30 +
                                (CASE WHEN CAST(${laneKey} AS TEXT) = 'hd'
                                  THEN GREATEST(COALESCE((lane_progress->'lanes'->>'hd')::int, 0), CAST(${clampedPct} AS INTEGER))
                                  ELSE COALESCE((lane_progress->'lanes'->>'hd')::int, 0) END) * 0.25 +
                                (CASE WHEN CAST(${laneKey} AS TEXT) = 'fhd'
                                  THEN GREATEST(COALESCE((lane_progress->'lanes'->>'fhd')::int, 0), CAST(${clampedPct} AS INTEGER))
                                  ELSE COALESCE((lane_progress->'lanes'->>'fhd')::int, 0) END) * 0.30
                              )::int
                            )
                          )
                        ELSE
                          GREATEST(
                            10,
                            LEAST(
                              95,
                              10 + ROUND(
                                (CASE WHEN CAST(${laneKey} AS TEXT) = 'fast_sd' THEN CAST(${clampedPct} AS INTEGER) ELSE 0 END) * 0.30 +
                                (CASE WHEN CAST(${laneKey} AS TEXT) = 'hd' THEN CAST(${clampedPct} AS INTEGER) ELSE 0 END) * 0.25 +
                                (CASE WHEN CAST(${laneKey} AS TEXT) = 'fhd' THEN CAST(${clampedPct} AS INTEGER) ELSE 0 END) * 0.30
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
                                  ELSE COALESCE((lane_progress->'lanes'->>'fast_sd')::int, 0) END) * 0.30 +
                                (CASE WHEN CAST(${laneKey} AS TEXT) = 'hd'
                                  THEN GREATEST(COALESCE((lane_progress->'lanes'->>'hd')::int, 0), CAST(${clampedPct} AS INTEGER))
                                  ELSE COALESCE((lane_progress->'lanes'->>'hd')::int, 0) END) * 0.25 +
                                (CASE WHEN CAST(${laneKey} AS TEXT) = 'fhd'
                                  THEN GREATEST(COALESCE((lane_progress->'lanes'->>'fhd')::int, 0), CAST(${clampedPct} AS INTEGER))
                                  ELSE COALESCE((lane_progress->'lanes'->>'fhd')::int, 0) END) * 0.30
                              )::int
                            )
                          )
                        ELSE
                          GREATEST(
                            10,
                            LEAST(
                              95,
                              10 + ROUND(
                                (CASE WHEN CAST(${laneKey} AS TEXT) = 'fast_sd' THEN CAST(${clampedPct} AS INTEGER) ELSE 0 END) * 0.30 +
                                (CASE WHEN CAST(${laneKey} AS TEXT) = 'hd' THEN CAST(${clampedPct} AS INTEGER) ELSE 0 END) * 0.25 +
                                (CASE WHEN CAST(${laneKey} AS TEXT) = 'fhd' THEN CAST(${clampedPct} AS INTEGER) ELSE 0 END) * 0.30
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
                      source_cache = CASE WHEN CAST(${invalidateCache} AS BOOLEAN) THEN NULL ELSE source_cache END,
                      source_cache_br = CASE WHEN CAST(${invalidateCache} AS BOOLEAN) THEN NULL ELSE source_cache_br END,
                      m3u8_cache_br = CASE WHEN CAST(${invalidateCache} AS BOOLEAN) THEN NULL ELSE m3u8_cache_br END,
                      source_cache_items_count = CASE WHEN CAST(${invalidateCache} AS BOOLEAN) THEN 0 ELSE source_cache_items_count END,
                      source_cache_expires_at = CASE WHEN CAST(${invalidateCache} AS BOOLEAN) THEN 0 ELSE source_cache_expires_at END,
                      thumbnail_url = COALESCE(CAST(${extra.thumbnail_url ?? null} AS TEXT), thumbnail_url),
                      onedrive_folder_id = COALESCE(CAST(${extra.onedrive_folder_id ?? null} AS TEXT), onedrive_folder_id),
                      master_playlist_path = COALESCE(CAST(${extra.master_playlist_path ?? null} AS TEXT), master_playlist_path),
                      storyboard_vtt_path = COALESCE(CAST(${extra.storyboard_vtt_path ?? null} AS TEXT), storyboard_vtt_path),
                      duration = COALESCE(CAST(${safeDuration} AS INTEGER), duration),
                      resolution = COALESCE(CAST(${extra.resolution ?? null} AS TEXT), resolution),
                      fps = COALESCE(CAST(${safeFps} AS NUMERIC), fps),
                      codec = COALESCE(CAST(${extra.codec ?? null} AS TEXT), codec),
                      bitrate = COALESCE(CAST(${safeBitrate} AS INTEGER), bitrate),
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

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const targetTag = versionNum ? `Video #${vidNum} (v${versionNum})` : `Video #${vidNum}`;
            console.log(`[DB FINAL] ${targetTag} Status: ${status} | Progress: ${safeProgress}% | ${stageDetail}`);

            if (versionNum) {
                const updatedRows = await sql`
                    UPDATE video_versions
                    SET
                      status = ${status},
                      transcode_progress = ${safeProgress},
                      stage_detail = ${stageDetail},
                      error_message = ${errorMsg},
                      source_cache_br = NULL,
                      m3u8_cache_br = NULL,
                      source_cache_items_count = 0,
                      source_cache_expires_at = 0,
                      thumbnail_url = COALESCE(${extra.thumbnail_url ?? null}, thumbnail_url),
                      onedrive_folder_id = COALESCE(${extra.onedrive_folder_id ?? null}, onedrive_folder_id),
                      master_playlist_path = COALESCE(${extra.master_playlist_path ?? null}, master_playlist_path),
                      updated_at = NOW()
                    WHERE id = ${versionNum} AND video_id = ${vidNum}
                    RETURNING is_default, duration, resolution, fps, codec, bitrate, file_size_bytes;
                `;

                if (status === 'READY' && safeProgress === 100 && updatedRows?.[0]?.is_default) {
                    const dv = updatedRows[0];
                    await sql`
                        UPDATE videos
                        SET duration = COALESCE(${dv.duration}, duration),
                            resolution = COALESCE(${dv.resolution}, resolution),
                            fps = COALESCE(${dv.fps}, fps),
                            codec = COALESCE(${dv.codec}, codec),
                            bitrate = COALESCE(${dv.bitrate}, bitrate),
                            file_size_bytes = COALESCE(${dv.file_size_bytes}, file_size_bytes),
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
                      status = ${status},
                      transcode_progress = ${safeProgress},
                      stage_detail = ${stageDetail},
                      error_message = ${errorMsg},
                      source_cache = NULL,
                      source_cache_br = NULL,
                      m3u8_cache_br = NULL,
                      source_cache_items_count = 0,
                      source_cache_expires_at = 0,
                      thumbnail_url = COALESCE(${extra.thumbnail_url ?? null}, thumbnail_url),
                      onedrive_folder_id = COALESCE(${extra.onedrive_folder_id ?? null}, onedrive_folder_id),
                      master_playlist_path = COALESCE(${extra.master_playlist_path ?? null}, master_playlist_path),
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
    let publishedKey = '';
    for (let syncTry = 0; syncTry < 3; syncTry++) {
        const key = mergedQualities.map((q) => q.name).join(',');
        if (key && key !== publishedKey) {
            fs.writeFileSync(masterPath, buildMasterM3U8(mergedQualities));
            await uploadFileToOneDrive(driveId, streamFolderId, 'master.m3u8', masterPath);
            publishedKey = key;
        }
        // Re-check DB once in case another lane registered a new quality during our PUT
        const latest = await readRunQualitiesFromDb();
        const latestKey = latest.map((q) => q.name).join(',');
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
    const fileBuffer = await fs.promises.readFile(filePath);
    const fileSize = fileBuffer.length;

    if (fileSize < 4 * 1024 * 1024) {
        const contentType = fileName.endsWith('.m3u8')
            ? 'application/vnd.apple.mpegurl'
            : fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')
                ? 'image/jpeg'
                : fileName.endsWith('.vtt')
                    ? 'text/vtt'
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

    // Files >= 4MB use upload session
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
    let offset = 0;
    let uploadResult = null;

    while (offset < fileSize) {
        const end = Math.min(offset + CHUNK_SIZE, fileSize);
        const chunk = fileBuffer.subarray(offset, end);

        const putRes = await fetchWithRetry(uploadUrl, {
            method: 'PUT',
            headers: {
                'Content-Length': chunk.length.toString(),
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
        if (cleanupTsAfterUpload && (f.endsWith('.ts') || f.startsWith('sprite_'))) {
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
            '-select_streams', 'v:0',
            '-show_entries', 'stream=width,height,duration,r_frame_rate,codec_name',
            '-show_entries', 'format=duration,bit_rate',
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

function parseProbeMeta(probeData) {
    const vStream = (probeData.streams || []).find((s) => s.codec_type === 'video') || (probeData.streams || [])[0] || {};
    const srcWidth = Number(vStream.width) || 1920;
    const srcHeight = Number(vStream.height) || 1080;
    const hasDimensions = Number(vStream.width) > 0 && Number(vStream.height) > 0;
    const duration = Math.round(parseFloat(probeData.format?.duration || vStream.duration || '0')) || 0;

    let fps = 30;
    if (vStream.r_frame_rate) {
        const [num, den] = String(vStream.r_frame_rate).split('/').map(Number);
        fps = den ? Math.round((num / den) * 1000) / 1000 : Math.round((num || 30) * 1000) / 1000;
    }
    const codec = vStream.codec_name || 'h264';
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
    return { srcWidth, srcHeight, hasDimensions, duration, fps, codec, bitrate, resolutionLabel, gopSize };
}

function runFFmpeg(args, onProgress, stepLabel = '', durationSec = 0) {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        let lastConsoleLogAt = 0;
        if (stepLabel) {
            console.log(`🎞️ [FFmpeg Start] ${stepLabel}...`);
        }
        const proc = spawn('ffmpeg', args);
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
    const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];
    for (const q of sorted) {
        lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${q.bitrate},RESOLUTION=${q.width}x${q.height}`);
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
    const { duration, gopSize, resolutionLabel, fps, codec, bitrate } = meta;
    await logger.log(`⚡ ${passLabel}: กำลังหั่น ${qualityName} (preset fast + lanczos + ${bitrateK}k)...`);

    let lastProgressUpdate = 0;
    await runFFmpeg(
        [
            '-y', '-threads', '0', '-i', rawFilePath,
            '-vf', `scale=w=${width}:h=${height}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos`,
            '-sws_flags', 'lanczos',
            '-c:v', 'libx264', '-preset', 'fast',
            '-profile:v', 'high', '-level', level,
            '-g', gopSize,
            '-force_key_frames', 'expr:gte(t,n_forced*4)',
            '-x264-params', 'deblock=-1,-1',
            '-b:v', `${bitrateK}k`, '-maxrate', `${maxrateK}k`, '-bufsize', `${bufsizeK}k`,
            '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
            '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod',
            '-hls_flags', 'independent_segments', '-hls_segment_type', 'mpegts',
            '-hls_segment_filename', path.join(hlsOutputDir, `stream_${qualityName}_%03d.ts`),
            path.join(hlsOutputDir, `${qualityName}.m3u8`),
        ],
        (sec) => {
            if (Date.now() - lastProgressUpdate > 4000 && duration > 0) {
                lastProgressUpdate = Date.now();
                const pct = Math.min(99, Math.round((sec / duration) * 100));
                const lanePct = Math.min(
                    lanePctEnd - 2,
                    lanePctStart + Math.round((pct / 100) * Math.max(1, lanePctEnd - lanePctStart - 2))
                );
                updateLaneProgress({
                    lane,
                    lanePct,
                    status: 'TRANSCODING',
                    stageDetail: `${stagePrefix}: ${pct}% (${formatTime(sec)} / ${formatTime(duration)} นาที)`,
                });
            }
        },
        passLabel,
        duration
    );

    const passFiles = fs
        .readdirSync(hlsOutputDir)
        .filter((f) => f.includes(qualityName) && f !== 'master.m3u8');

    await uploadBatchFilesAndCleanup(driveId, streamFolderId, hlsOutputDir, passFiles, true, passLabel);

    const merged = await registerQualitiesAndPublishMaster(driveId, streamFolderId, hlsOutputDir, [
        { name: qualityName, width, height, bitrate: manifestBitrate },
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
    const { srcWidth, srcHeight, duration, fps, codec, bitrate, resolutionLabel, gopSize } = meta;
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
        try {
            await runFFmpeg([
                '-y', '-threads', '0', '-ss', seekTime, '-i', rawFilePath,
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
            stageDetail: `วิเคราะห์สเปกสำเร็จ: ${srcWidth}x${srcHeight} (${resolutionLabel}), ${duration}s, ${fps}fps • เริ่มหั่นขนาน 3 เครื่อง`,
            invalidateCache: shouldPromotePosterUrl,
            extra: {
                duration,
                resolution: resolutionLabel,
                fps,
                codec,
                bitrate,
                thumbnail_url: shouldPromotePosterUrl ? thumbnailUrl : null,
                onedrive_folder_id: streamFolderId,
                hls_folder_path: `/streams/${streamFolderName}`,
                runner_specs: runnerSpecs,
            },
        }),
    ]);

    // PASS 1: Single-Pass (144p + Two-Tier Storyboards SD & HD Simultaneously!)
    await logger.log('⚡ Pass 1: กำลังหั่น HLS 144p + Storyboard SD/HD (Ultra-fast unlock)...');
    let lastProgressUpdate = 0;
    let hasStoryboard = false;

    try {
        await runFFmpeg(
            [
                '-y', '-threads', '0',
                '-i', rawFilePath,
                '-filter_complex',
                '[0:v]split=3[v144][vsd][vhd];' +
                '[v144]scale=w=256:h=144:force_original_aspect_ratio=decrease:force_divisible_by=2[out144];' +
                '[vsd]fps=1/5,scale=160:90,tile=10x10[outsd];' +
                '[vhd]fps=1/5,scale=320:180,tile=5x5[outhd]',
                // Output 1: 144p HLS (คง bitrate เดิม 200k/250k/400k)
                '-map', '[out144]', '-map', '0:a?',
                '-c:v', 'libx264', '-preset', 'ultrafast',
                '-g', gopSize, '-keyint_min', gopSize, '-sc_threshold', '0',
                '-b:v', '200k', '-maxrate', '250k', '-bufsize', '400k',
                '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
                '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod',
                '-hls_flags', 'independent_segments', '-hls_segment_type', 'mpegts',
                '-hls_segment_filename', path.join(hlsOutputDir, 'stream_144p_%03d.ts'),
                path.join(hlsOutputDir, '144p.m3u8'),
                // Output 2: SD Storyboard Sprites
                '-map', '[outsd]', '-q:v', '3', path.join(hlsOutputDir, 'sprite_sd_%03d.jpg'),
                // Output 3: HD Storyboard Sprites
                '-map', '[outhd]', '-q:v', '2', path.join(hlsOutputDir, 'sprite_hd_%03d.jpg'),
            ],
            (sec) => {
                if (Date.now() - lastProgressUpdate > 4000 && duration > 0) {
                    lastProgressUpdate = Date.now();
                    const pct = Math.min(99, Math.round((sec / duration) * 100));
                    updateLaneProgress({
                        lane: 'fast_sd',
                        lanePct: Math.min(43, 15 + Math.round(pct * 0.28)),
                        status: 'TRANSCODING',
                        stageDetail: `กำลังหั่น 144p + Storyboard (เร็วสุด): ${pct}% (${formatTime(sec)} / ${formatTime(duration)})`,
                    });
                }
            },
            'Pass 1: 144p + Storyboard',
            duration
        );
        hasStoryboard = true;
    } catch (combinedErr) {
        await logger.log(`⚠️ Combined pass fallback -> หั่น 144p เดี่ยว: ${combinedErr.message}`, { level: 'warn' });
        await runFFmpeg(
            [
                '-y', '-threads', '0', '-i', rawFilePath,
                '-vf', 'scale=w=256:h=144:force_original_aspect_ratio=decrease:force_divisible_by=2',
                '-c:v', 'libx264', '-preset', 'ultrafast',
                '-g', gopSize, '-keyint_min', gopSize, '-sc_threshold', '0',
                '-b:v', '200k', '-maxrate', '250k', '-bufsize', '400k',
                '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
                '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod',
                '-hls_flags', 'independent_segments', '-hls_segment_type', 'mpegts',
                '-hls_segment_filename', path.join(hlsOutputDir, 'stream_144p_%03d.ts'),
                path.join(hlsOutputDir, '144p.m3u8'),
            ],
            null,
            'Pass 1 Fallback: 144p',
            duration
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
        { name: '144p', width: 256, height: 144, bitrate: 200000 },
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
            thumbnail_url: shouldPromotePosterUrl ? thumbnailUrl : null,
        },
    });

    // PASS 2 & 3 COMBINED: 360p + 480p in a SINGLE Decode Pass (คง bitrate เดิม 600k / 1000k)
    if (srcHeight >= 480) {
        await logger.log('⚡ Pass 2/3: กำลังหั่น 360p + 480p SD พร้อมกัน...');
        await runFFmpeg(
            [
                '-y', '-threads', '0',
                '-i', rawFilePath,
                '-filter_complex',
                '[0:v]split=2[v360][v480];' +
                '[v360]scale=w=640:h=360:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos[out360];' +
                '[v480]scale=w=854:h=480:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos[out480]',
                '-sws_flags', 'lanczos',
                // 360p Output
                '-map', '[out360]', '-map', '0:a?',
                '-c:v', 'libx264', '-preset', 'veryfast',
                '-g', gopSize, '-keyint_min', gopSize, '-sc_threshold', '0',
                '-b:v', '600k', '-maxrate', '700k', '-bufsize', '1200k',
                '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
                '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod',
                '-hls_flags', 'independent_segments', '-hls_segment_type', 'mpegts',
                '-hls_segment_filename', path.join(hlsOutputDir, 'stream_360p_%03d.ts'),
                path.join(hlsOutputDir, '360p.m3u8'),
                // 480p Output
                '-map', '[out480]', '-map', '0:a?',
                '-c:v', 'libx264', '-preset', 'veryfast',
                '-g', gopSize, '-keyint_min', gopSize, '-sc_threshold', '0',
                '-b:v', '1000k', '-maxrate', '1200k', '-bufsize', '2000k',
                '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
                '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod',
                '-hls_flags', 'independent_segments', '-hls_segment_type', 'mpegts',
                '-hls_segment_filename', path.join(hlsOutputDir, 'stream_480p_%03d.ts'),
                path.join(hlsOutputDir, '480p.m3u8'),
            ],
            (sec) => {
                if (Date.now() - lastProgressUpdate > 4000 && duration > 0) {
                    lastProgressUpdate = Date.now();
                    const pct = Math.min(99, Math.round((sec / duration) * 100));
                    updateLaneProgress({
                        lane: 'fast_sd',
                        lanePct: Math.min(98, 45 + Math.round(pct * 0.53)),
                        status: 'READY',
                        stageDetail: `⚡ เปิดดูได้แล้ว • กำลังหั่น 360p & 480p SD: ${pct}% (${formatTime(sec)} / ${formatTime(duration)} นาที)`,
                    });
                }
            },
            'Pass 2/3: 360p + 480p',
            duration
        );

        const sdFiles = fs.readdirSync(hlsOutputDir).filter(
            (f) => f !== 'master.m3u8' && (f.includes('360p') || f.includes('480p'))
        );
        await uploadBatchFilesAndCleanup(driveId, streamFolderId, hlsOutputDir, sdFiles, true, '360p & 480p');

        const merged = await registerQualitiesAndPublishMaster(driveId, streamFolderId, hlsOutputDir, [
            { name: '360p', width: 640, height: 360, bitrate: 600000 },
            { name: '480p', width: 854, height: 480, bitrate: 1000000 },
        ]);
        const readyNames = merged.map((q) => q.name).join(', ');
        await updateLaneProgress({
            lane: 'fast_sd',
            lanePct: 100,
            status: 'READY',
            stageDetail: `⚡ พร้อมรับชม (${readyNames}) • Lane 1 (SD) เสร็จสมบูรณ์`,
            invalidateCache: true,
        });
        await logger.log(`✅ อัปโหลด 360p + 480p SD และซิงก์ master.m3u8 เรียบร้อย (พร้อมแล้ว: ${readyNames})`, {
            level: 'success',
        });
    } else if (srcHeight >= 360) {
        await logger.log('⚡ Pass 2: กำลังหั่น 360p SD...');
        await runFFmpeg(
            [
                '-y', '-threads', '0', '-i', rawFilePath,
                '-vf', 'scale=w=640:h=360:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos',
                '-sws_flags', 'lanczos',
                '-c:v', 'libx264', '-preset', 'veryfast',
                '-g', gopSize, '-keyint_min', gopSize, '-sc_threshold', '0',
                '-b:v', '600k', '-maxrate', '700k', '-bufsize', '1200k',
                '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
                '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod',
                '-hls_flags', 'independent_segments', '-hls_segment_type', 'mpegts',
                '-hls_segment_filename', path.join(hlsOutputDir, 'stream_360p_%03d.ts'),
                path.join(hlsOutputDir, '360p.m3u8'),
            ],
            null,
            'Pass 2: 360p',
            duration
        );

        const pass2Files = fs.readdirSync(hlsOutputDir).filter((f) => f !== 'master.m3u8' && f.includes('360p'));
        await uploadBatchFilesAndCleanup(driveId, streamFolderId, hlsOutputDir, pass2Files, true, '360p');

        const merged = await registerQualitiesAndPublishMaster(driveId, streamFolderId, hlsOutputDir, [
            { name: '360p', width: 640, height: 360, bitrate: 600000 },
        ]);
        const readyNames = merged.map((q) => q.name).join(', ');
        await updateLaneProgress({
            lane: 'fast_sd',
            lanePct: 100,
            status: 'READY',
            stageDetail: `⚡ พร้อมรับชม (${readyNames}) • Lane 1 (SD) เสร็จสมบูรณ์`,
            invalidateCache: true,
        });
        await logger.log(`✅ อัปโหลด 360p SD สำเร็จ (พร้อมแล้ว: ${readyNames})`, { level: 'success' });
    } else {
        await updateLaneProgress({
            lane: 'fast_sd',
            lanePct: 100,
            status: 'READY',
            stageDetail: `⚡ พร้อมรับชม (${readyAfter144Text}) • Lane 1 (SD) เสร็จสมบูรณ์`,
        });
    }
}

/**
 * LANE 2 (`hd`): Pass 4 (720p HD) + Pass 6 (1440p 2K if source >= 1440p)
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
    const has1440 = meta.srcHeight >= 1440 || meta.srcWidth >= 2560;

    if (!has720 && !has1440) {
        await logger.log(`⏭️ ข้าม Lane 2 (HD/2K) เนื่องจากต้นฉบับ ${meta.srcWidth}x${meta.srcHeight} ต่ำกว่า 720p`);
        await updateLaneProgress({
            lane: 'hd',
            lanePct: 100,
            status: 'PROCESSING',
            stageDetail: null,
        });
        return;
    }

    if (has720) {
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
            lanePctEnd: has1440 ? 55 : 100,
            stagePrefix: '⚡ กำลังหั่น 720p HD (คมชัด)',
        });
    }

    if (has1440) {
        await runHighQualityPass({
            lane: 'hd',
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
            lanePctStart: 55,
            lanePctEnd: 100,
            stagePrefix: '⚡ กำลังหั่น 2K Quad HD (1440p)',
        });
    }
}

/**
 * LANE 3 (`fhd`): Pass 5 (1080p Full HD) + Pass 7 (2160p 4K if source >= 2160p)
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
    const has2160 = meta.srcHeight >= 2160 || meta.srcWidth >= 3840;

    if (!has1080 && !has2160) {
        await logger.log(`⏭️ ข้าม Lane 3 (FHD/4K) เนื่องจากต้นฉบับ ${meta.srcWidth}x${meta.srcHeight} ต่ำกว่า 1080p`);
        await updateLaneProgress({
            lane: 'fhd',
            lanePct: 100,
            status: 'PROCESSING',
            stageDetail: null,
        });
        return;
    }

    if (has1080) {
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
            lanePctEnd: has2160 ? 50 : 100,
            stagePrefix: '⚡ กำลังหั่น 1080p Full HD (คมชัด)',
        });
    }

    if (has2160) {
        await runHighQualityPass({
            lane: 'fhd',
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
            lanePctStart: 50,
            lanePctEnd: 100,
            stagePrefix: '⚡ กำลังหั่น 4K UHD (2160p)',
        });
    }
}

/**
 * FINALIZE JOB (`finalize`):
 * - Publishes authoritative final master.m3u8 from all completed qualities of this run
 * - Deletes /raw/{RAW_FILE_NAME} ONLY if all 3 lanes succeeded AND AI workers are idle
 * - Marks 100% READY (or FAILED if zero qualities succeeded)
 */
async function runFinalize({ driveId, streamFolderName, masterPlaylistPath, tempDir }) {
    await ensureDbSchemaOnce();

    const laneResults = {
        fast_sd: (process.env.LANE_FAST_SD_RESULT || 'success').trim().toLowerCase(),
        hd: (process.env.LANE_HD_RESULT || 'success').trim().toLowerCase(),
        fhd: (process.env.LANE_FHD_RESULT || 'success').trim().toLowerCase(),
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

    if (allLanesSucceeded) {
        await setFinalDbStatus({
            status: 'READY',
            progress: 100,
            stageDetail: `เสร็จสมบูรณ์ทุกความละเอียด (${finalQualitiesText}) พร้อมรับชมแบบเต็มประสิทธิภาพ`,
            errorMsg: '',
            extra: {
                onedrive_folder_id: streamFolderId,
                master_playlist_path: masterPlaylistPath,
            },
        });
        await logger.log(`🎉 เสร็จสมบูรณ์ 100% (${finalQualitiesText}) พร้อมรับชมแล้ว!`, { level: 'success' });
    } else {
        const partialWarn = `บาง Lane ล้มเหลว (${failedLanes.join(', ')})${existingError ? `: ${existingError}` : ''}`;
        await setFinalDbStatus({
            status: 'READY',
            progress: 100,
            stageDetail: `พร้อมรับชมบางความละเอียด (${finalQualitiesText}) • บาง Lane ล้มเหลว (เก็บไฟล์ต้นฉบับไว้ให้ลองใหม่)`,
            errorMsg: partialWarn,
            extra: {
                onedrive_folder_id: streamFolderId,
                master_playlist_path: masterPlaylistPath,
            },
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
                stageDetail: `GitHub Actions (3x Parallel) พร้อมทำงาน: ${runnerSpecs.cpuModel} (${runnerSpecs.cpuCores} Cores × 3)`,
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

        // Fast remote ffprobe pre-check for Lane 2 (HD/2K) & Lane 3 (FHD/4K):
        // Avoid downloading multi-GB raw files when source resolution is below this lane's threshold!
        if (TRANSCODE_LANE === 'hd' || TRANSCODE_LANE === 'fhd') {
            const remoteProbe = await probeVideo(downloadUrl, 15000);
            const remoteMeta = parseProbeMeta(remoteProbe);
            if (remoteMeta.hasDimensions) {
                if (TRANSCODE_LANE === 'hd' && remoteMeta.srcHeight < 720 && remoteMeta.srcWidth < 2560) {
                    await logger.log(
                        `⏭️ ข้าม Lane 2 (HD/2K) โดยไม่ต้องดาวน์โหลด (ต้นฉบับ ${remoteMeta.srcWidth}x${remoteMeta.srcHeight} ต่ำกว่า 720p)`
                    );
                    await updateLaneProgress({ lane: 'hd', lanePct: 100, status: 'PROCESSING', stageDetail: null });
                    return;
                }
                if (TRANSCODE_LANE === 'fhd' && remoteMeta.srcHeight < 1080 && remoteMeta.srcWidth < 3840) {
                    await logger.log(
                        `⏭️ ข้าม Lane 3 (FHD/4K) โดยไม่ต้องดาวน์โหลด (ต้นฉบับ ${remoteMeta.srcWidth}x${remoteMeta.srcHeight} ต่ำกว่า 1080p)`
                    );
                    await updateLaneProgress({ lane: 'fhd', lanePct: 100, status: 'PROCESSING', stageDetail: null });
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
        await logger.log(
            `📐 สเปกจาก ffprobe: ${meta.srcWidth}x${meta.srcHeight} (${meta.resolutionLabel}), ยาว ${formatDurationShort(meta.duration)}, ${meta.fps} fps, Codec: ${meta.codec}, Bitrate: ${Math.round(meta.bitrate / 1000)} kbps`
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
        } else {
            // Legacy 'all' mode (local CLI fallback): run all 3 lanes + finalize sequentially
            await runLaneFastSd(laneCtx);
            await runLaneHd(laneCtx);
            await runLaneFhd(laneCtx);
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
