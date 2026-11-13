/**
 * TubeLock GitHub Actions Worker:
 * 3-Segment Video Thumbnail Extractor (Start / Middle / End)
 *
 * Flow:
 * 1. Probe / download raw video from OneDrive /raw/{RAW_FILE_NAME}
 * 2. Capture 3 representative JPEG frames at ~15%, ~50%, ~85% of duration using FFmpeg fast seek
 * 3. Upload thumb_1.jpg, thumb_2.jpg, thumb_3.jpg to /streams/stream_vid_{VIDEO_ID}/
 * 4. Persist thumbnail_options (3 choices) and fallback thumbnail_url / poster.jpg if none chosen yet
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { neon } from '@neondatabase/serverless';

const VIDEO_ID = process.env.VIDEO_ID || process.argv[2];
const RAW_FILE_NAME = process.env.RAW_FILE_NAME || process.argv[3] || '';

const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
const AZURE_TENANT_ID = (process.env.AZURE_TENANT_ID || '').replace(/['"]/g, '').trim();
const AZURE_CLIENT_ID = (process.env.AZURE_CLIENT_ID || '').replace(/['"]/g, '').trim();
const AZURE_CLIENT_SECRET = (process.env.AZURE_CLIENT_SECRET || '').replace(/['"]/g, '').trim();
let ONEDRIVE_USER_ID = (process.env.ONEDRIVE_USER_ID || '').replace(/['"]/g, '').trim();
ONEDRIVE_USER_ID = ONEDRIVE_USER_ID.replace('@donuttll40.', '@donutll40.');

if (!VIDEO_ID) {
  console.error('❌ Missing required parameter: VIDEO_ID');
  process.exit(1);
}

if (!DATABASE_URL || !AZURE_TENANT_ID || !AZURE_CLIENT_ID || !AZURE_CLIENT_SECRET || !ONEDRIVE_USER_ID) {
  console.error('❌ Missing required database or OneDrive environment secrets.');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function ensureThumbnailColumns() {
  try {
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS thumbnail_status VARCHAR(50) DEFAULT 'waiting';`;
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS thumbnail_options JSONB DEFAULT '[]'::jsonb;`;
    await sql`ALTER TABLE videos ALTER COLUMN fps TYPE NUMERIC(7, 3);`;
  } catch (err) {
    console.warn('[Schema check warning]:', err.message);
  }
}

async function fetchWithRetry(url, options = {}, retries = 4, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(120000),
      });
      if ((res.status === 429 || res.status === 503 || res.status === 504) && i < retries - 1) {
        await new Promise((r) => setTimeout(r, delay));
        delay *= 1.5;
        continue;
      }
      return res;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, delay));
      delay *= 1.5;
    }
  }
}

let cachedToken = null;
let tokenExpiresAt = 0;

async function getGraphToken() {
  const now = Date.now();
  if (cachedToken && tokenExpiresAt > now + 120000) return cachedToken;

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

  if (!res.ok) throw new Error(`Failed to obtain Graph token (${res.status})`);
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in || 3600) * 1000;
  return cachedToken;
}

async function getUserDriveId() {
  const token = await getGraphToken();
  const res = await fetchWithRetry(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(ONEDRIVE_USER_ID)}/drive`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Failed to get OneDrive Drive ID (${res.status})`);
  const data = await res.json();
  return data.id;
}

async function ensureStreamFolder(driveId, videoId) {
  const token = await getGraphToken();
  const folderPath = `streams/stream_vid_${videoId}`;
  const checkRes = await fetchWithRetry(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${folderPath}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (checkRes.ok) return (await checkRes.json()).id;

  let streamsParentId = 'root';
  const parentRes = await fetchWithRetry(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/streams`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (parentRes.ok) {
    streamsParentId = (await parentRes.json()).id;
  } else {
    const createParent = await fetchWithRetry(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/root/children`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'streams', folder: {} }),
      }
    );
    if (createParent.ok) streamsParentId = (await createParent.json()).id;
  }

  const createFolder = await fetchWithRetry(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${streamsParentId}/children`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `stream_vid_${videoId}`,
        folder: {},
      }),
    }
  );
  if (!createFolder.ok) throw new Error(`Failed to create stream folder (${createFolder.status})`);
  return (await createFolder.json()).id;
}

async function uploadFileToOneDrive(driveId, folderId, fileName, filePath, contentType = 'image/jpeg') {
  const token = await getGraphToken();
  const fileBuffer = await fs.promises.readFile(filePath);
  const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}:/${encodeURIComponent(fileName)}:/content`;
  const res = await fetchWithRetry(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Length': fileBuffer.length.toString(),
      'Content-Type': contentType,
    },
    body: fileBuffer,
  });
  if (!res.ok) throw new Error(`Failed to upload ${fileName} (${res.status})`);
  return await res.json();
}

function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 6000) stderr = stderr.slice(-3000);
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-400)}`));
    });
    proc.on('error', reject);
  });
}

function probeVideoSpecs(videoPath) {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      videoPath,
    ]);
    let out = '';
    proc.stdout.on('data', (d) => {
      out += d.toString();
    });
    proc.on('close', () => {
      try {
        const parsed = JSON.parse(out);
        const videoStream = (parsed.streams || []).find((s) => s.codec_type === 'video') || {};
        const duration = Math.max(0, Math.round(parseFloat(parsed.format?.duration || videoStream.duration || 0)));
        const width = Number(videoStream.width || 0);
        const height = Number(videoStream.height || 0);
        let fps = 30;
        if (videoStream.r_frame_rate && videoStream.r_frame_rate.includes('/')) {
          const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
          if (den > 0 && num > 0) fps = Number((num / den).toFixed(3));
        }
        const codec = videoStream.codec_name || 'h264';
        const bitrate = Math.round(Number(parsed.format?.bit_rate || 0) / 1000);
        let resolution = '1080p';
        const maxDim = Math.max(width, height);
        if (maxDim >= 3840) resolution = '4K';
        else if (maxDim >= 2560) resolution = '2K';
        else if (maxDim >= 1920) resolution = '1080p';
        else if (maxDim >= 1280) resolution = '720p';
        else if (maxDim >= 854) resolution = '480p';
        else if (maxDim > 0) resolution = `${height}p`;

        resolve({ duration, width, height, resolution, fps, codec, bitrate });
      } catch {
        resolve({ duration: 60, width: 0, height: 0, resolution: '1080p', fps: 30, codec: 'h264', bitrate: 0 });
      }
    });
    proc.on('error', () => resolve({ duration: 60, width: 0, height: 0, resolution: '1080p', fps: 30, codec: 'h264', bitrate: 0 }));
  });
}

async function main() {
  const vidNum = Number(VIDEO_ID);
  const tempDir = path.resolve('./temp_thumbnails', String(vidNum));
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    await ensureThumbnailColumns();

    const rows = await sql`
      SELECT id, raw_file_name, thumbnail_url, duration
      FROM videos
      WHERE id = ${vidNum}
      LIMIT 1;
    `;
    if (!rows || rows.length === 0) {
      throw new Error(`ไม่พบวิดีโอ ID #${vidNum} ในฐานข้อมูล`);
    }

    const video = rows[0];
    const activeRawName = RAW_FILE_NAME || video.raw_file_name;
    if (!activeRawName) {
      throw new Error('ไม่พบชื่อไฟล์ต้นฉบับบน OneDrive (/raw/)');
    }

    await sql`
      UPDATE videos
      SET thumbnail_status = 'generating',
          updated_at = NOW()
      WHERE id = ${vidNum};
    `;

    const token = await getGraphToken();
    const driveId = await getUserDriveId();
    const streamFolderId = await ensureStreamFolder(driveId, vidNum);

    const rawUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/raw/${encodeURIComponent(activeRawName)}?select=id,name,@microsoft.graph.downloadUrl`;
    const rawRes = await fetchWithRetry(rawUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!rawRes.ok) {
      throw new Error(`ไม่พบไฟล์ต้นฉบับบน OneDrive /raw/${activeRawName} (${rawRes.status})`);
    }
    const rawData = await rawRes.json();
    const rawDownloadUrl = rawData['@microsoft.graph.downloadUrl'];
    if (!rawDownloadUrl) throw new Error('ไม่สามารถรับลิงก์ดาวน์โหลดไฟล์ต้นฉบับได้');

    const localVideoPath = path.join(tempDir, 'input_video.mp4');
    console.log(`⬇️ Downloading raw video /raw/${activeRawName} for 3-segment thumbnails...`);
    const fileRes = await fetchWithRetry(rawDownloadUrl);
    if (!fileRes.ok || !fileRes.body) throw new Error(`Failed to download raw video (${fileRes.status})`);
    await pipeline(Readable.fromWeb(fileRes.body), fs.createWriteStream(localVideoPath));

    const specs = await probeVideoSpecs(localVideoPath);
    const totalSec = Math.max(3, specs.duration || 10);

    // Divide video into 3 balanced segments: Start (~15%), Middle (~50%), End (~85%)
    const segmentRatios = [
      { id: 'seg_1', label: 'ช่วงต้น', ratio: 0.15, file: 'thumb_1.jpg' },
      { id: 'seg_2', label: 'ช่วงกลาง', ratio: 0.5, file: 'thumb_2.jpg' },
      { id: 'seg_3', label: 'ช่วงท้าย', ratio: 0.85, file: 'thumb_3.jpg' },
    ];

    const options = [];
    for (const seg of segmentRatios) {
      const seekSec = Number(Math.min(Math.max(0.5, totalSec * seg.ratio), Math.max(0.5, totalSec - 0.5)).toFixed(2));
      const outPath = path.join(tempDir, seg.file);

      await runFFmpeg([
        '-y',
        '-ss', String(seekSec),
        '-i', localVideoPath,
        '-frames:v', '1',
        '-vf', "scale='min(640,iw)':-2",
        '-q:v', '3',
        outPath,
      ]);

      await uploadFileToOneDrive(driveId, streamFolderId, seg.file, outPath, 'image/jpeg');
      const base64 = `data:image/jpeg;base64,${(await fs.promises.readFile(outPath)).toString('base64')}`;

      options.push({
        id: seg.id,
        label: seg.label,
        timeSec: Math.round(seekSec),
        dataUrl: base64,
        filePath: `/streams/stream_vid_${vidNum}/${seg.file}`,
      });
    }

    // Re-read current thumbnail_url in case user already uploaded/picked one while worker ran
    const freshRows = await sql`
      SELECT thumbnail_url
      FROM videos
      WHERE id = ${vidNum}
      LIMIT 1;
    `;
    const existingThumb = (freshRows[0]?.thumbnail_url || '').trim();
    const defaultMiddle = options[1] || options[0];

    // If user has no thumbnail yet, set the middle frame as default cover & upload poster.jpg
    let nextThumbUrl = existingThumb;
    if (!existingThumb || existingThumb.startsWith(`/streams/stream_vid_${vidNum}/poster.jpg`)) {
      if (defaultMiddle) {
        await uploadFileToOneDrive(
          driveId,
          streamFolderId,
          'poster.jpg',
          path.join(tempDir, segmentRatios[1]?.file || segmentRatios[0].file),
          'image/jpeg'
        );
        nextThumbUrl = defaultMiddle.dataUrl;
      }
    }

    await sql`
      UPDATE videos
      SET thumbnail_status = 'ready',
          thumbnail_options = ${JSON.stringify(options)}::jsonb,
          thumbnail_url = ${nextThumbUrl || ''},
          onedrive_folder_id = COALESCE(NULLIF(onedrive_folder_id, ''), ${streamFolderId}),
          duration = CASE WHEN ${specs.duration} > 0 THEN ${specs.duration} ELSE duration END,
          resolution = CASE WHEN ${specs.width} > 0 THEN ${specs.resolution} ELSE resolution END,
          fps = CASE WHEN ${specs.fps} > 0 THEN ${specs.fps} ELSE fps END,
          codec = CASE WHEN ${specs.codec} <> '' THEN ${specs.codec} ELSE codec END,
          bitrate = CASE WHEN ${specs.bitrate} > 0 THEN ${specs.bitrate} ELSE bitrate END,
          updated_at = NOW()
      WHERE id = ${vidNum};
    `;

    console.log(`✅ Extracted 3 thumbnails (15% / 50% / 85%) for video #${vidNum}`);
  } catch (err) {
    console.error('❌ [Thumbnail Worker Error]:', err);
    try {
      await sql`
        UPDATE videos
        SET thumbnail_status = 'failed',
            updated_at = NOW()
        WHERE id = ${vidNum};
      `;
    } catch (_) {}
    process.exit(1);
  } finally {
    try {
      if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

main();
