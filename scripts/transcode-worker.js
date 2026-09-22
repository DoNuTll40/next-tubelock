/**
 * TubeLock Progressive Cloud Transcoder Worker
 * Runs inside GitHub Actions Runner (Ubuntu 2-Core / 7GB RAM)
 * 
 * Progressive Multi-Quality Release Architecture:
 * 1. Download raw .mp4 from OneDrive /raw/{RAW_FILE_NAME}
 * 2. Transcode Fast Pass (144p) + Poster Thumbnail + Two-Tier Storyboards
 * 3. Upload 144p + initial master.m3u8 -> Immediately set DB status = 'READY'!
 * 4. In background: 360p -> 480p -> 720p -> 1080p -> 1440p -> 2160p (ตามสเปกไฟล์ต้นทาง)
 * 5. Delete raw file from /raw/ to save OneDrive space
 * 6. Mark 100% complete!
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { neon } from '@neondatabase/serverless';

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

// Network Resilience: ป้องกัน Node.js 24 undici ConnectTimeoutError (10000ms)
async function fetchWithRetry(url, options = {}, retries = 5, delay = 2000) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url, {
                ...options,
                signal: AbortSignal.timeout(60000), // ขยายเป็น 60 วินาที
            });
            return res;
        } catch (err) {
            const isLast = i === retries - 1;
            if (isLast) throw err;
            console.warn(`⚠️ [Network Retry] ${err.message} -> กำลังลองใหม่รอบที่ ${i + 1}/${retries} ในอีก ${delay / 1000} วิ...`);
            await new Promise((r) => setTimeout(r, delay));
            delay *= 1.5;
        }
    }
}

async function updateDbStatus({ status, progress, stageDetail, errorMsg = '', extra = {} }) {
    const vidNum = Number(VIDEO_ID);
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
          updated_at = NOW()
        WHERE id = ${vidNum};
      `;

            if (Object.keys(extra).length > 0) {
                if (extra.onedrive_folder_id) {
                    await sql`UPDATE videos SET onedrive_folder_id = ${extra.onedrive_folder_id} WHERE id = ${vidNum};`;
                }
                if (extra.master_playlist_path) {
                    await sql`UPDATE videos SET master_playlist_path = ${extra.master_playlist_path} WHERE id = ${vidNum};`;
                }
                if (extra.storyboard_vtt_path) {
                    await sql`UPDATE videos SET storyboard_vtt_path = ${extra.storyboard_vtt_path} WHERE id = ${vidNum};`;
                }
                if (extra.duration) {
                    await sql`UPDATE videos SET duration = ${extra.duration} WHERE id = ${vidNum};`;
                }
                if (extra.resolution) {
                    await sql`UPDATE videos SET resolution = ${extra.resolution} WHERE id = ${vidNum};`;
                }
                if (extra.fps) {
                    await sql`UPDATE videos SET fps = ${extra.fps} WHERE id = ${vidNum};`;
                }
                if (extra.codec) {
                    await sql`UPDATE videos SET codec = ${extra.codec} WHERE id = ${vidNum};`;
                }
                if (extra.thumbnail_url) {
                    await sql`UPDATE videos SET thumbnail_url = ${extra.thumbnail_url} WHERE id = ${vidNum};`;
                }
                if (extra.bitrate) {
                    try {
                        await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS bitrate INTEGER;`;
                        await sql`UPDATE videos SET bitrate = ${extra.bitrate} WHERE id = ${vidNum};`;
                    } catch (_) { }
                }
                if (extra.file_size_bytes) {
                    await sql`UPDATE videos SET file_size_bytes = ${extra.file_size_bytes} WHERE id = ${vidNum};`;
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

// 3. Microsoft Graph API Helpers (ใช้ fetchWithRetry ทุกจุด)
let cachedToken = null;
let tokenExpiresAt = 0;

async function getGraphToken() {
    const now = Date.now();
    if (cachedToken && tokenExpiresAt > now + 60000) {
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

async function getUserDriveId(token) {
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

async function ensureFolderExists(token, driveId, folderPath) {
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

async function uploadFileToOneDrive(token, driveId, folderId, fileName, filePath) {
    const fileBuffer = fs.readFileSync(filePath);
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
    const tempDir = path.resolve('./temp_transcode', String(VIDEO_ID));
    const rawFilePath = path.join(tempDir, 'raw_' + RAW_FILE_NAME);
    const hlsOutputDir = path.join(tempDir, 'hls');

    try {
        fs.mkdirSync(tempDir, { recursive: true });
        fs.mkdirSync(hlsOutputDir, { recursive: true });

        // Step 1: Initial Processing status
        await updateDbStatus({
            status: 'PROCESSING',
            progress: 10,
            stageDetail: 'กำลังยืนยันตัวตนกับ Microsoft Graph API',
        });

        const token = await getGraphToken();
        const driveId = await getUserDriveId(token);

        // Step 2: Download raw file from OneDrive /raw/{RAW_FILE_NAME}
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
        const downloadUrl = itemData['@microsoft.graph.downloadUrl'];

        console.log(`⬇️ Downloading raw file (${((itemData.size || 0) / (1024 * 1024)).toFixed(1)} MB)...`);
        const fileRes = await fetchWithRetry(downloadUrl);
        if (!fileRes.ok) throw new Error(`ดาวน์โหลดไฟล์ต้นฉบับไม่สำเร็จ (${fileRes.status})`);

        const arrayBuffer = await fileRes.arrayBuffer();
        fs.writeFileSync(rawFilePath, Buffer.from(arrayBuffer));
        console.log(`✅ Raw file downloaded.`);

        // Step 3: Video Probe
        await updateDbStatus({
            status: 'PROCESSING',
            progress: 25,
            stageDetail: 'ดาวน์โหลดไฟล์สำเร็จ กำลังวิเคราะห์ข้อมูลวิดีโอ (ffprobe)',
        });

        const probeData = await new Promise((resolve) => {
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
        });

        const vStream = (probeData.streams || []).find((s) => s.codec_type === 'video') || (probeData.streams || [])[0] || {};
        const srcWidth = vStream.width || 1920;
        const srcHeight = vStream.height || 1080;
        const duration = Math.round(parseFloat(probeData.format?.duration || vStream.duration || '0'));
        const fps = vStream.r_frame_rate ? Math.round(eval(vStream.r_frame_rate) || 30) : 30;
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

        // Create HLS Destination Folder on OneDrive
        const streamFolderName = `stream_vid_${VIDEO_ID}`;
        const streamsParentFolder = '/streams';
        const parentFolderId = await ensureFolderExists(token, driveId, streamsParentFolder);

        console.log(`📁 Creating folder ${streamFolderName} in ${streamsParentFolder}...`);
        const createFolderRes = await fetchWithRetry(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${parentFolderId}/children`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                name: streamFolderName,
                folder: {},
                '@microsoft.graph.conflictBehavior': 'replace',
            }),
        });

        if (!createFolderRes.ok) {
            const err = await createFolderRes.text();
            throw new Error(`Failed to create HLS folder: ${err}`);
        }

        const streamFolderData = await createFolderRes.json();
        const streamFolderId = streamFolderData.id;
        const masterPlaylistPath = `/streams/${streamFolderName}/master.m3u8`;

        // Step 4: Extract Video Thumbnail Poster (Default 00:00:03 per requirements)
        const posterPath = path.join(hlsOutputDir, 'poster.jpg');
        console.log('📸 Generating poster thumbnail (00:00:03)...');
        const seekTime = duration > 3 ? '00:00:03' : '00:00:01';
        await runFFmpeg([
            '-y',
            '-threads', '0',
            '-ss', seekTime,
            '-i', rawFilePath,
            '-vframes', '1',
            '-q:v', '2',
            posterPath,
        ]);

        console.log(`⬆️ Uploading poster.jpg to OneDrive (/streams/${streamFolderName}/poster.jpg)...`);
        await uploadFileToOneDrive(token, driveId, streamFolderId, 'poster.jpg', posterPath);

        const thumbnailUrl = `/streams/${streamFolderName}/poster.jpg`;

        console.log('💾 Syncing full metadata and poster thumbnail to Neon DB immediately...');
        await updateDbStatus({
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
        });

        const readyQualities = [];

        // =========================================================================
        // PASS 1: Ultra-Fast Instant Pass (144p) -> USER CAN WATCH IMMEDIATELY!
        // =========================================================================
        await updateDbStatus({
            status: 'TRANSCODING',
            progress: 15,
            stageDetail: '⚡ กำลังแปลงความละเอียดแรก (144p) เพื่อให้เปิดดูได้ในไม่กี่วินาที...',
        });

        console.log('⚡ Slicing 144p for instant playback (fastest pass)...');
        let lastProgressUpdate = 0;
        await runFFmpeg([
            '-y',
            '-threads', '0',
            '-i', rawFilePath,
            '-vf', 'scale=w=256:h=144:force_original_aspect_ratio=decrease:force_divisible_by=2',
            '-c:v', 'libx264', '-preset', 'ultrafast',
            '-g', gopSize, '-keyint_min', gopSize, '-sc_threshold', '0',
            '-b:v', '200k', '-maxrate', '250k', '-bufsize', '400k',
            '-c:a', 'aac', '-b:a', '64k',
            '-f', 'hls',
            '-hls_time', '4',
            '-hls_playlist_type', 'vod',
            '-hls_flags', 'independent_segments',
            '-hls_segment_type', 'mpegts',
            '-hls_segment_filename', path.join(hlsOutputDir, 'stream_144p_%03d.ts'),
            path.join(hlsOutputDir, '144p.m3u8'),
        ], (sec) => {
            if (Date.now() - lastProgressUpdate > 3000 && duration > 0) {
                lastProgressUpdate = Date.now();
                const pct = Math.min(99, Math.round((sec / duration) * 100));
                updateDbStatus({
                    status: 'TRANSCODING',
                    progress: Math.min(22, 12 + Math.round(pct * 0.1)),
                    stageDetail: `กำลังหั่น 144p (เร็วสุด): ${pct}% (${formatTime(sec)} / ${formatTime(duration)})`,
                });
            }
        });

        readyQualities.push({ name: '144p', width: 256, height: 144, bitrate: 200000 });

        const masterPath = path.join(hlsOutputDir, 'master.m3u8');
        fs.writeFileSync(masterPath, buildMasterM3U8(readyQualities));

        // Two-Tier Storyboard (SD 160x90 + HD 320x180) ตามที่คุณเขียนไว้
        console.log('📸 Generating YouTube-style Two-Tier Storyboard Sprite Sheets (SD + HD) & WebVTT...');
        let hasStoryboard = false;
        try {
            await runFFmpeg([
                '-y',
                '-threads', '0',
                '-ss', '0',
                '-i', rawFilePath,
                '-filter_complex',
                '[0:v]fps=1/5,scale=160:90,tile=10x10[sd];[0:v]fps=1/5,scale=320:180,tile=5x5[hd]',
                '-map', '[sd]', '-q:v', '3', path.join(hlsOutputDir, 'sprite_sd_%03d.jpg'),
                '-map', '[hd]', '-q:v', '2', path.join(hlsOutputDir, 'sprite_hd_%03d.jpg'),
            ]);
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

            hasStoryboard = true;
            console.log('✅ Two-Tier Storyboard Sprite Sheets (SD + HD) and WebVTT created successfully!');
        } catch (spriteErr) {
            console.warn('⚠️ Two-Tier Storyboard generation warning:', spriteErr.message);
        }

        const pass1Files = fs.readdirSync(hlsOutputDir).filter((f) =>
            f.includes('144p') || f === 'master.m3u8' || f.includes('thumbnails') || f.startsWith('sprite_')
        );
        for (const f of pass1Files) {
            await uploadFileToOneDrive(token, driveId, streamFolderId, f, path.join(hlsOutputDir, f));
        }

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
            },
        });

        // =========================================================================
        // PASS 2: 360p in background (if source >= 360p)
        // =========================================================================
        if (srcHeight >= 360) {
            console.log('⚡ Slicing 360p in background...');
            await runFFmpeg([
                '-y',
                '-threads', '0',
                '-i', rawFilePath,
                '-vf', 'scale=w=640:h=360:force_original_aspect_ratio=decrease:force_divisible_by=2',
                '-c:v', 'libx264', '-preset', 'veryfast',
                '-g', gopSize, '-keyint_min', gopSize, '-sc_threshold', '0',
                '-b:v', '600k', '-maxrate', '700k', '-bufsize', '1200k',
                '-c:a', 'aac', '-b:a', '96k',
                '-f', 'hls',
                '-hls_time', '4',
                '-hls_playlist_type', 'vod',
                '-hls_flags', 'independent_segments',
                '-hls_segment_type', 'mpegts',
                '-hls_segment_filename', path.join(hlsOutputDir, 'stream_360p_%03d.ts'),
                path.join(hlsOutputDir, '360p.m3u8'),
            ], (sec) => {
                if (Date.now() - lastProgressUpdate > 3000 && duration > 0) {
                    lastProgressUpdate = Date.now();
                    const pct = Math.min(99, Math.round((sec / duration) * 100));
                    const overall = Math.min(38, 25 + Math.round(pct * 0.13));
                    updateDbStatus({
                        status: 'READY',
                        progress: overall,
                        stageDetail: `⚡ เปิดดูได้แล้ว • กำลังหั่น 360p: ${pct}% (${formatTime(sec)} / ${formatTime(duration)} นาที)`,
                    });
                }
            });

            readyQualities.push({ name: '360p', width: 640, height: 360, bitrate: 600000 });
            fs.writeFileSync(masterPath, buildMasterM3U8(readyQualities));

            const pass2Files = fs.readdirSync(hlsOutputDir).filter((f) => f.includes('360p') || f === 'master.m3u8');
            for (const f of pass2Files) {
                await uploadFileToOneDrive(token, driveId, streamFolderId, f, path.join(hlsOutputDir, f));
            }
            console.log('✅ 360p uploaded and master.m3u8 updated.');
        }

        // =========================================================================
        // PASS 3: 480p (SD) in background (if source >= 480p)
        // =========================================================================
        if (srcHeight >= 480) {
            console.log('⚡ Slicing 480p in background...');
            await runFFmpeg([
                '-y',
                '-threads', '0',
                '-i', rawFilePath,
                '-vf', 'scale=w=854:h=480:force_original_aspect_ratio=decrease:force_divisible_by=2',
                '-c:v', 'libx264', '-preset', 'veryfast',
                '-g', gopSize, '-keyint_min', gopSize, '-sc_threshold', '0',
                '-b:v', '1000k', '-maxrate', '1200k', '-bufsize', '2000k',
                '-c:a', 'aac', '-b:a', '96k',
                '-f', 'hls',
                '-hls_time', '4',
                '-hls_playlist_type', 'vod',
                '-hls_flags', 'independent_segments',
                '-hls_segment_type', 'mpegts',
                '-hls_segment_filename', path.join(hlsOutputDir, 'stream_480p_%03d.ts'),
                path.join(hlsOutputDir, '480p.m3u8'),
            ], (sec) => {
                if (Date.now() - lastProgressUpdate > 3000 && duration > 0) {
                    lastProgressUpdate = Date.now();
                    const pct = Math.min(99, Math.round((sec / duration) * 100));
                    const overall = Math.min(50, 38 + Math.round(pct * 0.12));
                    updateDbStatus({
                        status: 'READY',
                        progress: overall,
                        stageDetail: `⚡ เปิดดูได้แล้ว • กำลังหั่น 480p SD: ${pct}% (${formatTime(sec)} / ${formatTime(duration)} นาที)`,
                    });
                }
            });

            readyQualities.push({ name: '480p', width: 854, height: 480, bitrate: 1000000 });
            fs.writeFileSync(masterPath, buildMasterM3U8(readyQualities));

            const pass3Files = fs.readdirSync(hlsOutputDir).filter((f) => f.includes('480p') || f === 'master.m3u8');
            for (const f of pass3Files) {
                await uploadFileToOneDrive(token, driveId, streamFolderId, f, path.join(hlsOutputDir, f));
            }
            console.log('✅ 480p uploaded and master.m3u8 updated.');
        }

        // =========================================================================
        // PASS 4: 720p (HD) in background (if source >= 720p)
        // =========================================================================
        if (srcHeight >= 720) {
            console.log('⚡ Slicing 720p in background...');
            await runFFmpeg([
                '-y',
                '-threads', '0',
                '-i', rawFilePath,
                '-vf', 'scale=w=1280:h=720:force_original_aspect_ratio=decrease:force_divisible_by=2',
                '-c:v', 'libx264', '-preset', 'veryfast',
                '-profile:v', 'high', '-level', '3.1',
                '-g', gopSize, '-keyint_min', gopSize, '-sc_threshold', '0',
                '-b:v', '3500k', '-maxrate', '4500k', '-bufsize', '6000k',
                '-c:a', 'aac', '-b:a', '128k',
                '-f', 'hls',
                '-hls_time', '4',
                '-hls_playlist_type', 'vod',
                '-hls_flags', 'independent_segments',
                '-hls_segment_type', 'mpegts',
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
            for (const f of pass4Files) {
                await uploadFileToOneDrive(token, driveId, streamFolderId, f, path.join(hlsOutputDir, f));
            }
            console.log('✅ 720p uploaded and master.m3u8 updated.');
        }

        // =========================================================================
        // PASS 5: 1080p (Full HD) in background (if source >= 1080p)
        // =========================================================================
        if (srcHeight >= 1080) {
            console.log('⚡ Slicing 1080p in background...');
            await runFFmpeg([
                '-y',
                '-threads', '0',
                '-i', rawFilePath,
                '-vf', 'scale=w=1920:h=1080:force_original_aspect_ratio=decrease:force_divisible_by=2',
                '-c:v', 'libx264', '-preset', 'veryfast',
                '-profile:v', 'high', '-level', '4.2',
                '-g', gopSize, '-keyint_min', gopSize, '-sc_threshold', '0',
                '-b:v', '8500k', '-maxrate', '11000k', '-bufsize', '16000k',
                '-c:a', 'aac', '-b:a', '192k',
                '-f', 'hls',
                '-hls_time', '4',
                '-hls_playlist_type', 'vod',
                '-hls_flags', 'independent_segments',
                '-hls_segment_type', 'mpegts',
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
            for (const f of pass5Files) {
                await uploadFileToOneDrive(token, driveId, streamFolderId, f, path.join(hlsOutputDir, f));
            }
            console.log('✅ 1080p uploaded and master.m3u8 updated.');
        }

        // =========================================================================
        // PASS 6: 1440p (2K Quad HD) in background (if source >= 1440p)
        // =========================================================================
        if (srcHeight >= 1440 || srcWidth >= 2560) {
            console.log('⚡ Slicing 1440p (2K) in background...');
            await runFFmpeg([
                '-y',
                '-threads', '0',
                '-i', rawFilePath,
                '-vf', 'scale=w=2560:h=1440:force_original_aspect_ratio=decrease:force_divisible_by=2',
                '-c:v', 'libx264', '-preset', 'veryfast',
                '-profile:v', 'high', '-level', '5.1',
                '-g', gopSize, '-keyint_min', gopSize, '-sc_threshold', '0',
                '-b:v', '12000k', '-maxrate', '16000k', '-bufsize', '24000k',
                '-c:a', 'aac', '-b:a', '192k',
                '-f', 'hls',
                '-hls_time', '4',
                '-hls_playlist_type', 'vod',
                '-hls_flags', 'independent_segments',
                '-hls_segment_type', 'mpegts',
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
            for (const f of pass6Files) {
                await uploadFileToOneDrive(token, driveId, streamFolderId, f, path.join(hlsOutputDir, f));
            }
            console.log('✅ 1440p (2K) uploaded and master.m3u8 updated.');
        }

        // =========================================================================
        // PASS 7: 2160p (4K Ultra HD) in background (if source >= 2160p)
        // =========================================================================
        if (srcHeight >= 2160 || srcWidth >= 3840) {
            console.log('⚡ Slicing 2160p (4K UHD) in background...');
            await runFFmpeg([
                '-y',
                '-threads', '0',
                '-i', rawFilePath,
                '-vf', 'scale=w=3840:h=2160:force_original_aspect_ratio=decrease:force_divisible_by=2',
                '-c:v', 'libx264', '-preset', 'veryfast',
                '-profile:v', 'high', '-level', '5.2',
                '-g', gopSize, '-keyint_min', gopSize, '-sc_threshold', '0',
                '-b:v', '20000k', '-maxrate', '24000k', '-bufsize', '36000k',
                '-c:a', 'aac', '-b:a', '192k',
                '-f', 'hls',
                '-hls_time', '4',
                '-hls_playlist_type', 'vod',
                '-hls_flags', 'independent_segments',
                '-hls_segment_type', 'mpegts',
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
            for (const f of pass7Files) {
                await uploadFileToOneDrive(token, driveId, streamFolderId, f, path.join(hlsOutputDir, f));
            }
            console.log('✅ 2160p (4K UHD) uploaded and master.m3u8 updated.');
        }

        // =========================================================================
        // FINAL PASS: Cleanup raw file & Mark 100% complete
        // =========================================================================
        try {
            console.log(`🗑️ Deleting raw file /raw/${RAW_FILE_NAME}...`);
            await fetchWithRetry(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${rawItemId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
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