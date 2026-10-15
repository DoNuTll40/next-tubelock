/**
 * TubeLock Progressive Cloud Transcoder Worker (High-Performance Edition)
 * Optimized for GitHub Actions Public Repo Runner (4 vCPU / 16GB RAM / RAM Disk)
 *
 * Progressive Multi-Quality Release Architecture (100% Output Compatible):
 * 1. Stream-download raw .mp4 from OneDrive /raw/{RAW_FILE_NAME} (onto /dev/shm RAM Disk if fits)
 * 2. Fast Pass: Single-Pass (144p + Two-Tier Storyboards SD/HD) + Poster Thumbnail
 * 3. Parallel Upload (8x Concurrency) -> Immediately set DB status = 'READY'!
 * 4. Background Passes:
 *    - Combined SD Pass (360p + 480p in a single FFmpeg decode pass!)
 *    - 720p HD -> 1080p Full HD -> 1440p 2K -> 2160p 4K (with immediate .ts cleanup to save RAM Disk)
 * 5. Delete raw file from /raw/ & Mark 100% complete!
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import os from 'node:os';
import { neon } from '@neondatabase/serverless';

// จำนวนไฟล์ที่อัปโหลดขึ้น OneDrive พร้อมกัน (8 คือจุดที่เร็วสุดโดยไม่ติด 429 Throttle ของ Microsoft Graph)
const UPLOAD_CONCURRENCY = 8;

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
        };
    } catch (e) {
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
        };
    }
}

// เลือกใช้ RAM Disk (/dev/shm) อัตโนมัติถ้าเป็น Linux และมีพื้นที่ว่างพอ เพื่อความเร็ว I/O สูงสุด
function selectOptimalWorkDir(videoId, requiredBytes = 0) {
    const shmPath = '/dev/shm';
    try {
        if (process.platform === 'linux' && fs.existsSync(shmPath) && fs.statfsSync) {
            const stats = fs.statfsSync(shmPath);
            const freeBytes = stats.bavail * stats.bsize;
            // ต้องมีพื้นที่ใน /dev/shm มากกว่าขนาดไฟล์ต้นฉบับอย่างน้อย 2.2 เท่า (เผื่อไฟล์ .ts ของแต่ละ Pass)
            if (freeBytes > Math.max(requiredBytes * 2.2, 1.5 * 1024 ** 3)) {
                console.log(`🚀 [RAM Disk Enabled] Using /dev/shm (${(freeBytes / (1024 ** 3)).toFixed(1)} GB free) for ultra-fast I/O!`);
                return path.join(shmPath, 'tubelock_transcode', String(videoId));
            }
        }
    } catch (_) { }
    return path.resolve('./temp_transcode', String(videoId));
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

// 1. Environment & Inputs
const VIDEO_ID = process.env.VIDEO_ID || process.argv[2];
const RAW_FILE_NAME = process.env.RAW_FILE_NAME || process.argv[3];
const VIDEO_TITLE = process.env.VIDEO_TITLE || process.argv[4] || 'Untitled Video';

const DATABASE_URL = process.env.DATABASE_URL || '';
const AZURE_TENANT_ID = (process.env.AZURE_TENANT_ID || '').replace(/['"]/g, '').trim();
const AZURE_CLIENT_ID = (process.env.AZURE_CLIENT_ID || '').replace(/['"]/g, '').trim();
const AZURE_CLIENT_SECRET = (process.env.AZURE_CLIENT_SECRET || '').replace(/['"]/g, '').trim();
let ONEDRIVE_USER_ID = (process.env.ONEDRIVE_USER_ID || '').replace(/['"]/g, '').trim();
ONEDRIVE_USER_ID = ONEDRIVE_USER_ID.replace('@donuttll40.', '@donutll40.');

if (!VIDEO_ID || !RAW_FILE_NAME) {
    console.error('❌ Missing required parameters: VIDEO_ID and RAW_FILE_NAME must be provided.');
    process.exit(1);
}

if (!DATABASE_URL || !AZURE_TENANT_ID || !AZURE_CLIENT_ID || !AZURE_CLIENT_SECRET || !ONEDRIVE_USER_ID) {
    console.error('❌ Missing required environment secrets. Check GitHub Actions secrets configuration.');
    process.exit(1);
}

// 2. Initialize Database Client
const dbUrl = (DATABASE_URL || '').trim();
const sql = neon(dbUrl);
let schemaChecked = false;

async function ensureDbSchemaOnce() {
    if (schemaChecked) return;
    schemaChecked = true;
    try {
        await sql`ALTER TABLE videos ALTER COLUMN fps TYPE NUMERIC(7, 3);`;
    } catch (_) { }
    try {
        await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS bitrate INTEGER;`;
    } catch (_) { }
    try {
        await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS runner_specs JSONB;`;
    } catch (_) { }
}

// Network Resilience: รองรับ Retry เมื่อเจอ Rate Limit (429) หรือ Timeout
async function fetchWithRetry(url, options = {}, retries = 5, delay = 2000) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url, {
                ...options,
                signal: AbortSignal.timeout(90000),
            });
            // ถ้าโดน OneDrive Throttle (429) หรือ Server Busy (503/504) ให้รอตาม Retry-After แล้วลองใหม่
            if ((res.status === 429 || res.status === 503 || res.status === 504) && i < retries - 1) {
                const retryAfterSec = parseInt(res.headers.get('Retry-After') || '3', 10);
                const waitMs = Math.max(delay, retryAfterSec * 1000);
                console.warn(`⏳ [HTTP ${res.status}] Rate limited/busy. Waiting ${waitMs / 1000}s before retry ${i + 1}/${retries}...`);
                await new Promise((r) => setTimeout(r, waitMs));
                delay *= 1.5;
                continue;
            }
            return res;
        } catch (err) {
            const isLast = i === retries - 1;
            if (isLast) throw err;
            console.warn(`⚠️ [Network Retry] ${err.message} -> ลองใหม่รอบที่ ${i + 1}/${retries} ในอีก ${delay / 1000} วิ...`);
            await new Promise((r) => setTimeout(r, delay));
            delay *= 1.5;
        }
    }
}

async function updateDbStatus({ status, progress, stageDetail, errorMsg = '', extra = {} }) {
    const vidNum = Number(VIDEO_ID);
    await ensureDbSchemaOnce();

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            console.log(`[DB UPDATE] Video #${vidNum} Status: ${status} | Progress: ${progress}% | ${stageDetail}`);
            await sql`
                UPDATE videos 
                SET 
                  status = ${status},
                  transcode_progress = ${progress},
                  stage_detail = ${stageDetail},
                  error_message = ${errorMsg},
                  source_cache = NULL,
                  source_cache_expires_at = 0,
                  thumbnail_url = COALESCE(${extra.thumbnail_url ?? null}, thumbnail_url),
                  onedrive_folder_id = COALESCE(${extra.onedrive_folder_id ?? null}, onedrive_folder_id),
                  master_playlist_path = COALESCE(${extra.master_playlist_path ?? null}, master_playlist_path),
                  storyboard_vtt_path = COALESCE(${extra.storyboard_vtt_path ?? null}, storyboard_vtt_path),
                  duration = COALESCE(${extra.duration ?? null}, duration),
                  resolution = COALESCE(${extra.resolution ?? null}, resolution),
                  fps = COALESCE(${extra.fps ?? null}, fps),
                  codec = COALESCE(${extra.codec ?? null}, codec),
                  bitrate = COALESCE(${extra.bitrate ?? null}, bitrate),
                  file_size_bytes = COALESCE(${extra.file_size_bytes ?? null}, file_size_bytes),
                  updated_at = NOW()
                WHERE id = ${vidNum};
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
            break;
        } catch (err) {
            if (attempt === 2) {
                console.error(`[DB UPDATE ERROR for #${vidNum}]:`, err.message);
            }
            await new Promise((r) => setTimeout(r, 1500));
        }
    }
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

            if (createRes.status === 409) {
                const fetchUrl = currentParentId === 'root'
                    ? `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodeURIComponent(seg)}`
                    : `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${currentParentId}:/${encodeURIComponent(seg)}`;
                const fetchRes = await fetchWithRetry(fetchUrl, { headers: { Authorization: `Bearer ${token}` } });
                if (fetchRes.ok) {
                    const fetched = await fetchRes.json();
                    currentParentId = fetched.id;
                } else {
                    const err = await fetchRes.text();
                    throw new Error(`Failed to resolve existing folder "${seg}": ${err}`);
                }
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

// อัปโหลดไฟล์ทั้งหมดใน Pass แบบ Parallel Concurrency โดยอัปโหลด .ts ก่อน แล้วค่อยอัปโหลด .m3u8 ปิดท้ายเสมอ
async function uploadBatchFilesAndCleanup(driveId, folderId, hlsOutputDir, fileNames, cleanupTsAfterUpload = true) {
    const segmentAndAssetFiles = fileNames.filter((f) => !f.endsWith('.m3u8'));
    const playlistFiles = fileNames.filter((f) => f.endsWith('.m3u8'));

    // 1. อัปโหลดชิ้นส่วน .ts, .jpg, .vtt พร้อมกันทีละ 8 ไฟล์
    await runWithConcurrency(segmentAndAssetFiles, UPLOAD_CONCURRENCY, async (f) => {
        const fullPath = path.join(hlsOutputDir, f);
        await uploadFileToOneDrive(driveId, folderId, f, fullPath);
        if (cleanupTsAfterUpload && (f.endsWith('.ts') || f.startsWith('sprite_'))) {
            try { fs.unlinkSync(fullPath); } catch (_) { }
        }
    });

    // 2. อัปโหลดไฟล์ Playlist (.m3u8) และ master.m3u8 เป็นลำดับสุดท้ายเพื่อไม่ให้ผู้ชมเจอ 404
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

function runFFmpeg(args, onProgress) {
    return new Promise((resolve, reject) => {
        const proc = spawn('ffmpeg', args);
        let stderr = '';
        proc.stderr.on('data', (d) => {
            const str = d.toString();
            stderr += str;
            if (stderr.length > 10000) stderr = stderr.slice(-5000);
            if (onProgress) {
                const timeMatch = str.match(/time=(\d+):(\d+):(\d+\.\d+)/);
                if (timeMatch) {
                    const sec = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseFloat(timeMatch[3]);
                    onProgress(sec);
                }
            }
        });
        proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`));
        });
        proc.on('error', reject);
    });
}

function buildMasterM3U8(qualities) {
    const sorted = [...qualities].sort((a, b) => a.bitrate - b.bitrate);
    let lines = ['#EXTM3U', '#EXT-X-VERSION:3'];
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

// 4. Main Progressive Worker
async function main() {
    let tempDir = path.resolve('./temp_transcode', String(VIDEO_ID));

    try {
        // Step 0: Collect & Report Runner Machine Specs
        const runnerSpecs = getRunnerSpecs();
        console.log('🖥️ Runner Machine Specs:', JSON.stringify(runnerSpecs, null, 2));

        await updateDbStatus({
            status: 'PROCESSING',
            progress: 8,
            stageDetail: `GitHub Actions พร้อมทำงาน: ${runnerSpecs.cpuModel} (${runnerSpecs.cpuCores} Cores), RAM ${runnerSpecs.totalRamGb}`,
            extra: { runner_specs: runnerSpecs },
        });

        // Step 1: Initial Processing status
        await updateDbStatus({
            status: 'PROCESSING',
            progress: 10,
            stageDetail: 'กำลังยืนยันตัวตนกับ Microsoft Graph API',
        });

        const token = await getGraphToken();
        const driveId = await getUserDriveId();

        // Step 2: Locate & Stream-Download raw file from OneDrive /raw/{RAW_FILE_NAME}
        await updateDbStatus({
            status: 'PROCESSING',
            progress: 15,
            stageDetail: `กำลังดาวน์โหลดไฟล์ต้นฉบับ "${RAW_FILE_NAME}" จาก OneDrive /raw/`,
        });

        console.log(`🔍 Locating /raw/${RAW_FILE_NAME} on OneDrive...`);
        const itemUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/raw/${encodeURIComponent(RAW_FILE_NAME)}?select=id,name,size,@microsoft.graph.downloadUrl`;
        const itemRes = await fetchWithRetry(itemUrl, { headers: { Authorization: `Bearer ${token}` } });

        if (!itemRes.ok) {
            const err = await itemRes.text();
            throw new Error(`ไม่พบไฟล์ /raw/${RAW_FILE_NAME} บน OneDrive (${itemRes.status}): ${err}`);
        }

        const itemData = await itemRes.json();
        const rawItemId = itemData.id;
        const rawFileSize = itemData.size || 0;
        const downloadUrl = itemData['@microsoft.graph.downloadUrl'];

        // เลือกใช้ /dev/shm (RAM Disk) ถ้ารองรับและพื้นที่พอ
        tempDir = selectOptimalWorkDir(VIDEO_ID, rawFileSize);
        const rawFilePath = path.join(tempDir, 'raw_' + RAW_FILE_NAME);
        const hlsOutputDir = path.join(tempDir, 'hls');
        fs.mkdirSync(tempDir, { recursive: true });
        fs.mkdirSync(hlsOutputDir, { recursive: true });

        console.log(`⬇️ Stream-downloading raw file (${(rawFileSize / (1024 * 1024)).toFixed(1)} MB)...`);
        const fileRes = await fetchWithRetry(downloadUrl);
        if (!fileRes.ok || !fileRes.body) throw new Error(`ดาวน์โหลดไฟล์ต้นฉบับไม่สำเร็จ (${fileRes.status})`);

        // ใช้ Stream Pipeline แทน arrayBuffer() เพื่อประหยัด RAM และเขียนลงดิสก์ทันที
        await pipeline(Readable.fromWeb(fileRes.body), fs.createWriteStream(rawFilePath));
        console.log(`✅ Raw file downloaded.`);

        // Step 3: Video Probe & Create OneDrive Folder in Parallel!
        await updateDbStatus({
            status: 'PROCESSING',
            progress: 25,
            stageDetail: 'ดาวน์โหลดไฟล์สำเร็จ กำลังวิเคราะห์ข้อมูลวิดีโอ (ffprobe)',
        });

        const streamFolderName = `stream_vid_${VIDEO_ID}`;
        const streamsParentFolder = '/streams';

        const [probeData, parentFolderId] = await Promise.all([
            new Promise((resolve) => {
                const proc = spawn('ffprobe', [
                    '-v', 'error',
                    '-select_streams', 'v:0',
                    '-show_entries', 'stream=width,height,duration,r_frame_rate,codec_name',
                    '-show_entries', 'format=duration,bit_rate',
                    '-of', 'json',
                    rawFilePath,
                ]);
                let out = '';
                proc.stdout.on('data', (d) => { out += d.toString(); });
                proc.on('close', () => {
                    try { resolve(JSON.parse(out)); } catch { resolve({}); }
                });
            }),
            ensureFolderExists(driveId, streamsParentFolder),
        ]);

        const vStream = (probeData.streams || []).find((s) => s.codec_type === 'video') || (probeData.streams || [])[0] || {};
        const srcWidth = vStream.width || 1920;
        const srcHeight = vStream.height || 1080;
        const duration = Math.round(parseFloat(probeData.format?.duration || vStream.duration || '0'));

        let fps = 30;
        if (vStream.r_frame_rate) {
            const [num, den] = String(vStream.r_frame_rate).split('/').map(Number);
            fps = den ? Math.round(num / den) : Math.round(num || 30);
        }
        const codec = vStream.codec_name || 'h264';
        const bitrate = probeData.format?.bit_rate ? Math.round(parseInt(probeData.format.bit_rate)) : (vStream.bit_rate ? Math.round(parseInt(vStream.bit_rate)) : 0);

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
        console.log(`🎬 Video specs: ${srcWidth}x${srcHeight} [${resolutionLabel}], ${duration}s, ${fps}fps, bitrate: ${bitrate}, GOP: ${gopSize}, codec: ${codec}`);

        // Create HLS Destination Folder on OneDrive & Extract Poster in Parallel
        const posterPath = path.join(hlsOutputDir, 'poster.jpg');
        const seekTime = duration > 3 ? '00:00:03' : '00:00:01';

        const [createFolderRes] = await Promise.all([
            fetchWithRetry(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${parentFolderId}/children`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${await getGraphToken()}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    name: streamFolderName,
                    folder: {},
                    '@microsoft.graph.conflictBehavior': 'replace',
                }),
            }),
            runFFmpeg([
                '-y', '-threads', '0', '-ss', seekTime, '-i', rawFilePath,
                '-vframes', '1', '-q:v', '2', posterPath,
            ]),
        ]);

        if (!createFolderRes.ok) {
            const err = await createFolderRes.text();
            throw new Error(`Failed to create HLS folder: ${err}`);
        }

        const streamFolderData = await createFolderRes.json();
        const streamFolderId = streamFolderData.id;
        const masterPlaylistPath = `/streams/${streamFolderName}/master.m3u8`;
        const thumbnailUrl = `/streams/${streamFolderName}/poster.jpg`;

        console.log(`⬆️ Uploading poster.jpg & syncing metadata...`);
        await Promise.all([
            uploadFileToOneDrive(driveId, streamFolderId, 'poster.jpg', posterPath),
            updateDbStatus({
                status: 'PROCESSING',
                progress: 25,
                stageDetail: `วิเคราะห์สเปกสำเร็จ: ${srcWidth}x${srcHeight} (${resolutionLabel}), ${duration}s, ${fps}fps พร้อมบันทึกภาพหน้าปก`,
                extra: {
                    duration,
                    resolution: resolutionLabel,
                    fps,
                    codec,
                    bitrate,
                    thumbnail_url: thumbnailUrl,
                    onedrive_folder_id: streamFolderId,
                },
            }),
        ]);

        const readyQualities = [];
        const masterPath = path.join(hlsOutputDir, 'master.m3u8');

        // =========================================================================
        // PASS 1: Single-Pass (144p + Two-Tier Storyboards SD & HD Simultaneously!)
        // =========================================================================
        await updateDbStatus({
            status: 'TRANSCODING',
            progress: 15,
            stageDetail: '⚡ กำลังแปลงความละเอียดแรก (144p) พร้อมสร้าง Storyboard ในรอบเดียว...',
        });

        console.log('⚡ Running combined Fast-Pass (144p + Two-Tier Storyboards SD & HD)...');
        let lastProgressUpdate = 0;
        let hasStoryboard = false;

        try {
            await runFFmpeg([
                '-y', '-threads', '0',
                '-i', rawFilePath,
                '-filter_complex',
                '[0:v]split=3[v144][vsd][vhd];' +
                '[v144]scale=w=256:h=144:force_original_aspect_ratio=decrease:force_divisible_by=2[out144];' +
                '[vsd]fps=1/5,scale=160:90,tile=10x10[outsd];' +
                '[vhd]fps=1/5,scale=320:180,tile=5x5[outhd]',
                // Output 1: 144p HLS
                '-map', '[out144]', '-map', '0:a?',
                '-c:v', 'libx264', '-preset', 'ultrafast',
                '-g', gopSize, '-keyint_min', gopSize, '-sc_threshold', '0',
                '-b:v', '200k', '-maxrate', '250k', '-bufsize', '400k',
                '-c:a', 'aac', '-b:a', '64k',
                '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod',
                '-hls_flags', 'independent_segments', '-hls_segment_type', 'mpegts',
                '-hls_segment_filename', path.join(hlsOutputDir, 'stream_144p_%03d.ts'),
                path.join(hlsOutputDir, '144p.m3u8'),
                // Output 2: SD Storyboard Sprites
                '-map', '[outsd]', '-q:v', '3', path.join(hlsOutputDir, 'sprite_sd_%03d.jpg'),
                // Output 3: HD Storyboard Sprites
                '-map', '[outhd]', '-q:v', '2', path.join(hlsOutputDir, 'sprite_hd_%03d.jpg'),
            ], (sec) => {
                if (Date.now() - lastProgressUpdate > 3000 && duration > 0) {
                    lastProgressUpdate = Date.now();
                    const pct = Math.min(99, Math.round((sec / duration) * 100));
                    updateDbStatus({
                        status: 'TRANSCODING',
                        progress: Math.min(22, 12 + Math.round(pct * 0.1)),
                        stageDetail: `กำลังหั่น 144p + Storyboard (เร็วสุด): ${pct}% (${formatTime(sec)} / ${formatTime(duration)})`,
                    });
                }
            });
            hasStoryboard = true;
        } catch (combinedErr) {
            console.warn('⚠️ Combined pass fallback to 144p only:', combinedErr.message);
            await runFFmpeg([
                '-y', '-threads', '0', '-i', rawFilePath,
                '-vf', 'scale=w=256:h=144:force_original_aspect_ratio=decrease:force_divisible_by=2',
                '-c:v', 'libx264', '-preset', 'ultrafast',
                '-g', gopSize, '-keyint_min', gopSize, '-sc_threshold', '0',
                '-b:v', '200k', '-maxrate', '250k', '-bufsize', '400k',
                '-c:a', 'aac', '-b:a', '64k',
                '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod',
                '-hls_flags', 'independent_segments', '-hls_segment_type', 'mpegts',
                '-hls_segment_filename', path.join(hlsOutputDir, 'stream_144p_%03d.ts'),
                path.join(hlsOutputDir, '144p.m3u8'),
            ]);
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

        readyQualities.push({ name: '144p', width: 256, height: 144, bitrate: 200000 });
        fs.writeFileSync(masterPath, buildMasterM3U8(readyQualities));

        const pass1Files = fs.readdirSync(hlsOutputDir).filter((f) =>
            f.includes('144p') || f === 'master.m3u8' || f.includes('thumbnails') || f.startsWith('sprite_')
        );
        console.log(`⬆️ Parallel uploading ${pass1Files.length} files for Pass 1 (${UPLOAD_CONCURRENCY}x concurrency)...`);
        await uploadBatchFilesAndCleanup(driveId, streamFolderId, hlsOutputDir, pass1Files);

        console.log(`🎉 144p is READY! Unlocking video for instant playback!`);
        await updateDbStatus({
            status: 'READY',
            progress: 25,
            stageDetail: '⚡ พร้อมรับชมทันทีที่ 144p! (กำลังแปลง 360p, 480p, 720p, 1080p, 4K เพิ่มเติมในพื้นหลัง...)',
            extra: {
                onedrive_folder_id: streamFolderId,
                master_playlist_path: masterPlaylistPath,
                storyboard_vtt_path: hasStoryboard ? `/streams/stream_vid_${VIDEO_ID}/thumbnails.vtt` : null,
                duration,
                resolution: resolutionLabel,
                fps,
                codec,
                thumbnail_url: thumbnailUrl,
            },
        });

        // =========================================================================
        // PASS 2 & 3 COMBINED: 360p + 480p in a SINGLE Decode Pass!
        // =========================================================================
        if (srcHeight >= 480) {
            console.log('⚡ Slicing 360p + 480p simultaneously in a single FFmpeg pass...');
            await runFFmpeg([
                '-y', '-threads', '0',
                '-i', rawFilePath,
                '-filter_complex',
                '[0:v]split=2[v360][v480];' +
                '[v360]scale=w=640:h=360:force_original_aspect_ratio=decrease:force_divisible_by=2[out360];' +
                '[v480]scale=w=854:h=480:force_original_aspect_ratio=decrease:force_divisible_by=2[out480]',
                // 360p Output
                '-map', '[out360]', '-map', '0:a?',
                '-c:v', 'libx264', '-preset', 'veryfast',
                '-g', gopSize, '-keyint_min', gopSize, '-sc_threshold', '0',
                '-b:v', '600k', '-maxrate', '700k', '-bufsize', '1200k',
                '-c:a', 'aac', '-b:a', '96k',
                '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod',
                '-hls_flags', 'independent_segments', '-hls_segment_type', 'mpegts',
                '-hls_segment_filename', path.join(hlsOutputDir, 'stream_360p_%03d.ts'),
                path.join(hlsOutputDir, '360p.m3u8'),
                // 480p Output
                '-map', '[out480]', '-map', '0:a?',
                '-c:v', 'libx264', '-preset', 'veryfast',
                '-g', gopSize, '-keyint_min', gopSize, '-sc_threshold', '0',
                '-b:v', '1000k', '-maxrate', '1200k', '-bufsize', '2000k',
                '-c:a', 'aac', '-b:a', '96k',
                '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod',
                '-hls_flags', 'independent_segments', '-hls_segment_type', 'mpegts',
                '-hls_segment_filename', path.join(hlsOutputDir, 'stream_480p_%03d.ts'),
                path.join(hlsOutputDir, '480p.m3u8'),
            ], (sec) => {
                if (Date.now() - lastProgressUpdate > 3000 && duration > 0) {
                    lastProgressUpdate = Date.now();
                    const pct = Math.min(99, Math.round((sec / duration) * 100));
                    const overall = Math.min(50, 25 + Math.round(pct * 0.25));
                    updateDbStatus({
                        status: 'READY',
                        progress: overall,
                        stageDetail: `⚡ เปิดดูได้แล้ว • กำลังหั่น 360p & 480p SD พร้อมกัน: ${pct}% (${formatTime(sec)} / ${formatTime(duration)} นาที)`,
                    });
                }
            });

            readyQualities.push(
                { name: '360p', width: 640, height: 360, bitrate: 600000 },
                { name: '480p', width: 854, height: 480, bitrate: 1000000 }
            );
            fs.writeFileSync(masterPath, buildMasterM3U8(readyQualities));

            const sdFiles = fs.readdirSync(hlsOutputDir).filter((f) => f.includes('360p') || f.includes('480p') || f === 'master.m3u8');
            await uploadBatchFilesAndCleanup(driveId, streamFolderId, hlsOutputDir, sdFiles);
            console.log('✅ 360p & 480p uploaded in parallel and master.m3u8 updated.');
        } else if (srcHeight >= 360) {
            console.log('⚡ Slicing 360p in background...');
            await runFFmpeg([
                '-y', '-threads', '0', '-i', rawFilePath,
                '-vf', 'scale=w=640:h=360:force_original_aspect_ratio=decrease:force_divisible_by=2',
                '-c:v', 'libx264', '-preset', 'veryfast',
                '-g', gopSize, '-keyint_min', gopSize, '-sc_threshold', '0',
                '-b:v', '600k', '-maxrate', '700k', '-bufsize', '1200k',
                '-c:a', 'aac', '-b:a', '96k',
                '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod',
                '-hls_flags', 'independent_segments', '-hls_segment_type', 'mpegts',
                '-hls_segment_filename', path.join(hlsOutputDir, 'stream_360p_%03d.ts'),
                path.join(hlsOutputDir, '360p.m3u8'),
            ]);
            readyQualities.push({ name: '360p', width: 640, height: 360, bitrate: 600000 });
            fs.writeFileSync(masterPath, buildMasterM3U8(readyQualities));
            const pass2Files = fs.readdirSync(hlsOutputDir).filter((f) => f.includes('360p') || f === 'master.m3u8');
            await uploadBatchFilesAndCleanup(driveId, streamFolderId, hlsOutputDir, pass2Files);
        }

        // =========================================================================
        // PASS 4: 720p (HD) in background (if source >= 720p)
        // =========================================================================
        if (srcHeight >= 720) {
            console.log('⚡ Slicing 720p in background...');
            await runFFmpeg([
                '-y', '-threads', '0', '-i', rawFilePath,
                '-vf', 'scale=w=1280:h=720:force_original_aspect_ratio=decrease:force_divisible_by=2',
                '-c:v', 'libx264', '-preset', 'veryfast',
                '-profile:v', 'high', '-level', '3.1',
                '-g', gopSize, '-keyint_min', gopSize, '-sc_threshold', '0',
                '-b:v', '3500k', '-maxrate', '4500k', '-bufsize', '6000k',
                '-c:a', 'aac', '-b:a', '128k',
                '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod',
                '-hls_flags', 'independent_segments', '-hls_segment_type', 'mpegts',
                '-hls_segment_filename', path.join(hlsOutputDir, 'stream_720p_%03d.ts'),
                path.join(hlsOutputDir, '720p.m3u8'),
            ], (sec) => {
                if (Date.now() - lastProgressUpdate > 3000 && duration > 0) {
                    lastProgressUpdate = Date.now();
                    const pct = Math.min(99, Math.round((sec / duration) * 100));
                    const overall = Math.min(65, 50 + Math.round(pct * 0.15));
                    updateDbStatus({
                        status: 'READY',
                        progress: overall,
                        stageDetail: `⚡ เปิดดูได้แล้ว • กำลังหั่น 720p HD: ${pct}% (${formatTime(sec)} / ${formatTime(duration)} นาที)`,
                    });
                }
            });

            readyQualities.push({ name: '720p', width: 1280, height: 720, bitrate: 3500000 });
            fs.writeFileSync(masterPath, buildMasterM3U8(readyQualities));

            const pass4Files = fs.readdirSync(hlsOutputDir).filter((f) => f.includes('720p') || f === 'master.m3u8');
            await uploadBatchFilesAndCleanup(driveId, streamFolderId, hlsOutputDir, pass4Files);
            console.log('✅ 720p uploaded and master.m3u8 updated.');
        }

        // =========================================================================
        // PASS 5: 1080p (Full HD) in background (if source >= 1080p)
        // =========================================================================
        if (srcHeight >= 1080) {
            console.log('⚡ Slicing 1080p in background...');
            await runFFmpeg([
                '-y', '-threads', '0', '-i', rawFilePath,
                '-vf', 'scale=w=1920:h=1080:force_original_aspect_ratio=decrease:force_divisible_by=2',
                '-c:v', 'libx264', '-preset', 'veryfast',
                '-profile:v', 'high', '-level', '4.2',
                '-g', gopSize, '-keyint_min', gopSize, '-sc_threshold', '0',
                '-b:v', '8500k', '-maxrate', '11000k', '-bufsize', '16000k',
                '-c:a', 'aac', '-b:a', '192k',
                '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod',
                '-hls_flags', 'independent_segments', '-hls_segment_type', 'mpegts',
                '-hls_segment_filename', path.join(hlsOutputDir, 'stream_1080p_%03d.ts'),
                path.join(hlsOutputDir, '1080p.m3u8'),
            ], (sec) => {
                if (Date.now() - lastProgressUpdate > 3000 && duration > 0) {
                    lastProgressUpdate = Date.now();
                    const pct = Math.min(99, Math.round((sec / duration) * 100));
                    const overall = Math.min(80, 65 + Math.round(pct * 0.15));
                    updateDbStatus({
                        status: 'READY',
                        progress: overall,
                        stageDetail: `⚡ เปิดดูได้แล้ว • กำลังหั่น 1080p Full HD (Premium): ${pct}% (${formatTime(sec)} / ${formatTime(duration)} นาที)`,
                    });
                }
            });

            readyQualities.push({ name: '1080p', width: 1920, height: 1080, bitrate: 8500000 });
            fs.writeFileSync(masterPath, buildMasterM3U8(readyQualities));

            const pass5Files = fs.readdirSync(hlsOutputDir).filter((f) => f.includes('1080p') || f === 'master.m3u8');
            await uploadBatchFilesAndCleanup(driveId, streamFolderId, hlsOutputDir, pass5Files);
            console.log('✅ 1080p uploaded and master.m3u8 updated.');
        }

        // =========================================================================
        // PASS 6: 1440p (2K Quad HD) in background (if source >= 1440p)
        // =========================================================================
        if (srcHeight >= 1440 || srcWidth >= 2560) {
            console.log('⚡ Slicing 1440p (2K) in background...');
            await runFFmpeg([
                '-y', '-threads', '0', '-i', rawFilePath,
                '-vf', 'scale=w=2560:h=1440:force_original_aspect_ratio=decrease:force_divisible_by=2',
                '-c:v', 'libx264', '-preset', 'veryfast',
                '-profile:v', 'high', '-level', '5.1',
                '-g', gopSize, '-keyint_min', gopSize, '-sc_threshold', '0',
                '-b:v', '12000k', '-maxrate', '16000k', '-bufsize', '24000k',
                '-c:a', 'aac', '-b:a', '192k',
                '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod',
                '-hls_flags', 'independent_segments', '-hls_segment_type', 'mpegts',
                '-hls_segment_filename', path.join(hlsOutputDir, 'stream_1440p_%03d.ts'),
                path.join(hlsOutputDir, '1440p.m3u8'),
            ], (sec) => {
                if (Date.now() - lastProgressUpdate > 3000 && duration > 0) {
                    lastProgressUpdate = Date.now();
                    const pct = Math.min(99, Math.round((sec / duration) * 100));
                    const overall = Math.min(92, 80 + Math.round(pct * 0.12));
                    updateDbStatus({
                        status: 'READY',
                        progress: overall,
                        stageDetail: `⚡ เปิดดูได้แล้ว • กำลังหั่น 2K Quad HD (1440p): ${pct}% (${formatTime(sec)} / ${formatTime(duration)} นาที)`,
                    });
                }
            });

            readyQualities.push({ name: '1440p', width: 2560, height: 1440, bitrate: 12000000 });
            fs.writeFileSync(masterPath, buildMasterM3U8(readyQualities));

            const pass6Files = fs.readdirSync(hlsOutputDir).filter((f) => f.includes('1440p') || f === 'master.m3u8');
            await uploadBatchFilesAndCleanup(driveId, streamFolderId, hlsOutputDir, pass6Files);
            console.log('✅ 1440p (2K) uploaded and master.m3u8 updated.');
        }

        // =========================================================================
        // PASS 7: 2160p (4K Ultra HD) in background (if source >= 2160p)
        // =========================================================================
        if (srcHeight >= 2160 || srcWidth >= 3840) {
            console.log('⚡ Slicing 2160p (4K UHD) in background...');
            await runFFmpeg([
                '-y', '-threads', '0', '-i', rawFilePath,
                '-vf', 'scale=w=3840:h=2160:force_original_aspect_ratio=decrease:force_divisible_by=2',
                '-c:v', 'libx264', '-preset', 'veryfast',
                '-profile:v', 'high', '-level', '5.2',
                '-g', gopSize, '-keyint_min', gopSize, '-sc_threshold', '0',
                '-b:v', '20000k', '-maxrate', '24000k', '-bufsize', '36000k',
                '-c:a', 'aac', '-b:a', '192k',
                '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod',
                '-hls_flags', 'independent_segments', '-hls_segment_type', 'mpegts',
                '-hls_segment_filename', path.join(hlsOutputDir, 'stream_2160p_%03d.ts'),
                path.join(hlsOutputDir, '2160p.m3u8'),
            ], (sec) => {
                if (Date.now() - lastProgressUpdate > 3000 && duration > 0) {
                    lastProgressUpdate = Date.now();
                    const pct = Math.min(99, Math.round((sec / duration) * 100));
                    const overall = Math.min(98, 91 + Math.round(pct * 0.07));
                    updateDbStatus({
                        status: 'READY',
                        progress: overall,
                        stageDetail: `⚡ เปิดดูได้แล้ว • กำลังหั่น 4K UHD (2160p): ${pct}% (${formatTime(sec)} / ${formatTime(duration)} นาที)`,
                    });
                }
            });

            readyQualities.push({ name: '2160p', width: 3840, height: 2160, bitrate: 20000000 });
            fs.writeFileSync(masterPath, buildMasterM3U8(readyQualities));

            const pass7Files = fs.readdirSync(hlsOutputDir).filter((f) => f.includes('2160p') || f === 'master.m3u8');
            await uploadBatchFilesAndCleanup(driveId, streamFolderId, hlsOutputDir, pass7Files);
            console.log('✅ 2160p (4K UHD) uploaded and master.m3u8 updated.');
        }

        // =========================================================================
        // FINAL PASS: Cleanup raw file & Mark 100% complete
        // =========================================================================
        try {
            console.log(`🗑️ Deleting raw file /raw/${RAW_FILE_NAME}...`);
            await fetchWithRetry(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${rawItemId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${await getGraphToken()}` },
            });
            console.log('✅ Raw file deleted.');
        } catch (delErr) {
            console.warn('⚠️ Could not delete raw file:', delErr.message);
        }

        const finalQualitiesText = readyQualities.map((q) => q.name).join(', ');
        await updateDbStatus({
            status: 'READY',
            progress: 100,
            stageDetail: `เสร็จสมบูรณ์ทุกความละเอียด (${finalQualitiesText}) พร้อมรับชมแบบเต็มประสิทธิภาพ`,
            extra: {
                thumbnail_url: thumbnailUrl,
            },
        });

        console.log(`🎉 All progressive passes finished for Video #${VIDEO_ID}!`);

    } catch (err) {
        console.error('❌ [Transcode Worker Fatal Error]:', err);
        await updateDbStatus({
            status: 'FAILED',
            progress: 0,
            stageDetail: 'การแปลงไฟล์ล้มเหลว',
            errorMsg: err.message,
        });
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