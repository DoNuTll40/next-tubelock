/**
 * TubeLock Cloud Transcoder Worker
 * Runs inside GitHub Actions Runner (Ubuntu 2-Core / 7GB RAM)
 * 
 * Workflow:
 * 1. Read input params (VIDEO_ID, RAW_FILE_NAME, VIDEO_TITLE)
 * 2. Authenticate with Microsoft Graph API using Client Credentials
 * 3. Update Neon DB status to 'PROCESSING'
 * 4. Download raw .mp4 from OneDrive /raw/{RAW_FILE_NAME}
 * 5. Update Neon DB status to 'TRANSCODING'
 * 6. Transcode into Multi-bitrate HLS (1080p, 720p, 480p) + master.m3u8 + poster.jpg
 * 7. Upload HLS package to OneDrive /streams/{VIDEO_ID}/
 * 8. Delete raw file from /raw/{RAW_FILE_NAME} to save storage
 * 9. Update Neon DB status to 'READY'
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
let sanitizedDbUrl = DATABASE_URL.replace(/%E2%80%8B/g, '').replace(/\u200b/g, '').trim();
if (sanitizedDbUrl.includes('/mytube_db')) {
  sanitizedDbUrl = sanitizedDbUrl.replace('/mytube_db', '/neondb');
}
const sql = neon(sanitizedDbUrl);

async function updateDbStatus({ status, progress, stageDetail, errorMsg = '', extra = {} }) {
  try {
    console.log(`[DB UPDATE] Status: ${status} | Progress: ${progress}% | ${stageDetail}`);
    await sql`
      UPDATE videos 
      SET 
        status = ${status},
        transcode_progress = ${progress},
        stage_detail = ${stageDetail},
        error_message = ${errorMsg},
        updated_at = NOW()
      WHERE id = ${VIDEO_ID};
    `;

    if (Object.keys(extra).length > 0) {
      if (extra.onedrive_folder_id) {
        await sql`UPDATE videos SET onedrive_folder_id = ${extra.onedrive_folder_id} WHERE id = ${VIDEO_ID};`;
      }
      if (extra.master_playlist_path) {
        await sql`UPDATE videos SET master_playlist_path = ${extra.master_playlist_path} WHERE id = ${VIDEO_ID};`;
      }
      if (extra.duration) {
        await sql`UPDATE videos SET duration = ${extra.duration} WHERE id = ${VIDEO_ID};`;
      }
      if (extra.resolution) {
        await sql`UPDATE videos SET resolution = ${extra.resolution} WHERE id = ${VIDEO_ID};`;
      }
      if (extra.fps) {
        await sql`UPDATE videos SET fps = ${extra.fps} WHERE id = ${VIDEO_ID};`;
      }
      if (extra.codec) {
        await sql`UPDATE videos SET codec = ${extra.codec} WHERE id = ${VIDEO_ID};`;
      }
      if (extra.thumbnail_url) {
        await sql`UPDATE videos SET thumbnail_url = ${extra.thumbnail_url} WHERE id = ${VIDEO_ID};`;
      }
      if (extra.file_size_bytes) {
        await sql`UPDATE videos SET file_size_bytes = ${extra.file_size_bytes} WHERE id = ${VIDEO_ID};`;
      }
    }
  } catch (err) {
    console.warn('[DB UPDATE WARNING]:', err.message);
  }
}

// 3. Microsoft Graph API Helpers
let cachedToken = null;
let tokenExpiresAt = 0;

async function getGraphToken() {
  const now = Date.now();
  if (cachedToken && tokenExpiresAt > now + 60000) {
    return cachedToken;
  }

  const res = await fetch(`https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/token`, {
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
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(ONEDRIVE_USER_ID)}/drive`, {
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

  const checkRes = await fetch(
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

    const segRes = await fetch(checkSegUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (segRes.ok) {
      const segData = await segRes.json();
      currentParentId = segData.id;
    } else {
      const createUrl = currentParentId === 'root'
        ? `https://graph.microsoft.com/v1.0/drives/${driveId}/root/children`
        : `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${currentParentId}/children`;

      const createRes = await fetch(createUrl, {
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
        const fetchRes = await fetch(fetchUrl, { headers: { Authorization: `Bearer ${token}` } });
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

  // For files < 4MB, use Direct PUT
  if (fileSize < 4 * 1024 * 1024) {
    const contentType = fileName.endsWith('.m3u8')
      ? 'application/vnd.apple.mpegurl'
      : fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')
      ? 'image/jpeg'
      : 'video/mp2t';

    const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}:/${encodeURIComponent(fileName)}:/content`;
    const res = await fetch(url, {
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

  // For files >= 4MB, use Upload Session
  const sessionUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}:/${encodeURIComponent(fileName)}:/createUploadSession`;
  const sessionRes = await fetch(sessionUrl, {
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
  const CHUNK_SIZE = 5 * 1024 * 1024;
  let offset = 0;
  let uploadResult = null;

  while (offset < fileSize) {
    const end = Math.min(offset + CHUNK_SIZE, fileSize);
    const chunk = fileBuffer.subarray(offset, end);

    const putRes = await fetch(uploadUrl, {
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
      throw new Error(`Failed to upload chunk ${offset}-${end} for ${fileName} (${putRes.status}): ${err}`);
    }
  }

  return uploadResult;
}

// 4. Main Worker Execution Flow
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
      progress: 12,
      stageDetail: 'กำลังยืนยันตัวตนกับ Microsoft Graph API',
    });

    const token = await getGraphToken();
    const driveId = await getUserDriveId(token);

    // Step 2: Download raw file from OneDrive /raw/{RAW_FILE_NAME}
    await updateDbStatus({
      status: 'PROCESSING',
      progress: 18,
      stageDetail: `กำลังดาวน์โหลดไฟล์ต้นฉบับ "${RAW_FILE_NAME}" จาก OneDrive /raw/`,
    });

    console.log(`🔍 Locating /raw/${RAW_FILE_NAME} on OneDrive...`);
    const itemUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/raw/${encodeURIComponent(RAW_FILE_NAME)}?select=id,name,size,@microsoft.graph.downloadUrl`;
    const itemRes = await fetch(itemUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!itemRes.ok) {
      const err = await itemRes.text();
      throw new Error(`ไม่พบไฟล์ /raw/${RAW_FILE_NAME} บน OneDrive (${itemRes.status}): ${err}`);
    }

    const itemData = await itemRes.json();
    const rawItemId = itemData.id;
    const downloadUrl = itemData['@microsoft.graph.downloadUrl'];

    if (!downloadUrl) {
      throw new Error('ไม่พบ Download URL สำหรับไฟล์ต้นฉบับบน OneDrive');
    }

    console.log(`⬇️ Downloading raw file (${((itemData.size || 0) / (1024 * 1024)).toFixed(1)} MB)...`);
    const fileRes = await fetch(downloadUrl);
    if (!fileRes.ok) {
      throw new Error(`ดาวน์โหลดไฟล์ต้นฉบับไม่สำเร็จ (${fileRes.status})`);
    }

    const fileStream = fs.createWriteStream(rawFilePath);
    const arrayBuffer = await fileRes.arrayBuffer();
    fs.writeFileSync(rawFilePath, Buffer.from(arrayBuffer));
    console.log(`✅ Raw file downloaded to: ${rawFilePath}`);

    // Step 3: Video Probe & Metadata Extraction
    await updateDbStatus({
      status: 'PROCESSING',
      progress: 25,
      stageDetail: 'ดาวน์โหลดไฟล์สำเร็จ กำลังวิเคราะห์ข้อมูลวิดีโอ (ffprobe)',
    });

    const probeData = await new Promise((resolve) => {
      const proc = spawn('ffprobe', [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        rawFilePath,
      ]);

      let out = '';
      proc.stdout.on('data', (d) => { out += d.toString(); });
      proc.on('close', () => {
        try {
          resolve(JSON.parse(out));
        } catch {
          resolve({});
        }
      });
    });

    const vStream = (probeData.streams || []).find((s) => s.codec_type === 'video') || {};
    const srcWidth = vStream.width || 1920;
    const srcHeight = vStream.height || 1080;
    const duration = Math.round(parseFloat(probeData.format?.duration || vStream.duration || '0'));
    const fps = vStream.r_frame_rate ? Math.round(eval(vStream.r_frame_rate) || 30) : 30;
    const codec = vStream.codec_name || 'h264';
    const resolutionLabel = srcHeight >= 1080 ? '1080p' : srcHeight >= 720 ? '720p' : '480p';

    console.log(`🎬 Video specs: ${srcWidth}x${srcHeight} [${resolutionLabel}], ${duration}s, ${fps}fps, codec: ${codec}`);

    // Step 4: Extract Video Thumbnail Poster
    const posterPath = path.join(hlsOutputDir, 'poster.jpg');
    console.log('📸 Generating video poster thumbnail...');
    await new Promise((resolve) => {
      const ssTime = Math.min(2, Math.max(0.5, duration * 0.1)).toFixed(1);
      const thumbProc = spawn('ffmpeg', [
        '-y',
        '-ss', ssTime.toString(),
        '-i', rawFilePath,
        '-vframes', '1',
        '-q:v', '2',
        posterPath,
      ]);
      thumbProc.on('close', resolve);
    });

    // Step 5: Multi-bitrate HLS Transcoding via FFmpeg
    await updateDbStatus({
      status: 'TRANSCODING',
      progress: 30,
      stageDetail: 'เริ่มต้นหั่น HLS Multi-bitrate (480p / 720p / 1080p พร้อม master.m3u8)',
    });

    // Ladder rendition based on source height
    let ffmpegArgs = [];
    if (srcHeight >= 1080) {
      ffmpegArgs = [
        '-y', '-i', rawFilePath,
        '-filter_complex',
        '[0:v]split=3[v1][v2][v3]; [v1]scale=w=1920:h=1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2[v1out]; [v2]scale=w=1280:h=720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2[v2out]; [v3]scale=w=854:h=480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2[v3out]',
        '-map', '[v1out]', '-c:v:0', 'libx264', '-b:v:0', '4500k', '-maxrate:v:0', '5000k', '-bufsize:v:0', '7500k',
        '-map', '[v2out]', '-c:v:1', 'libx264', '-b:v:1', '2500k', '-maxrate:v:1', '2800k', '-bufsize:v:1', '4000k',
        '-map', '[v3out]', '-c:v:2', 'libx264', '-b:v:2', '1000k', '-maxrate:v:2', '1200k', '-bufsize:v:2', '2000k',
        '-map', '0:a?', '-c:a:0', 'aac', '-b:a:0', '128k',
        '-map', '0:a?', '-c:a:1', 'aac', '-b:a:1', '128k',
        '-map', '0:a?', '-c:a:2', 'aac', '-b:a:2', '96k',
        '-f', 'hls',
        '-hls_time', '6',
        '-hls_playlist_type', 'vod',
        '-hls_flags', 'independent_segments',
        '-hls_segment_type', 'mpegts',
        '-hls_segment_filename', path.join(hlsOutputDir, 'stream_%v_%03d.ts'),
        '-master_pl_name', 'master.m3u8',
        '-var_stream_map', 'v:0,a:0,name:1080p v:1,a:1,name:720p v:2,a:2,name:480p',
        path.join(hlsOutputDir, '%v.m3u8'),
      ];
    } else if (srcHeight >= 720) {
      ffmpegArgs = [
        '-y', '-i', rawFilePath,
        '-filter_complex',
        '[0:v]split=2[v1][v2]; [v1]scale=w=1280:h=720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2[v1out]; [v2]scale=w=854:h=480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2[v2out]',
        '-map', '[v1out]', '-c:v:0', 'libx264', '-b:v:0', '2500k', '-maxrate:v:0', '2800k', '-bufsize:v:0', '4000k',
        '-map', '[v2out]', '-c:v:1', 'libx264', '-b:v:1', '1000k', '-maxrate:v:1', '1200k', '-bufsize:v:1', '2000k',
        '-map', '0:a?', '-c:a:0', 'aac', '-b:a:0', '128k',
        '-map', '0:a?', '-c:a:1', 'aac', '-b:a:1', '96k',
        '-f', 'hls',
        '-hls_time', '6',
        '-hls_playlist_type', 'vod',
        '-hls_flags', 'independent_segments',
        '-hls_segment_type', 'mpegts',
        '-hls_segment_filename', path.join(hlsOutputDir, 'stream_%v_%03d.ts'),
        '-master_pl_name', 'master.m3u8',
        '-var_stream_map', 'v:0,a:0,name:720p v:1,a:1,name:480p',
        path.join(hlsOutputDir, '%v.m3u8'),
      ];
    } else {
      ffmpegArgs = [
        '-y', '-i', rawFilePath,
        '-filter_complex',
        '[0:v]scale=w=854:h=480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2[v1out]',
        '-map', '[v1out]', '-c:v:0', 'libx264', '-b:v:0', '1000k', '-maxrate:v:0', '1200k', '-bufsize:v:0', '2000k',
        '-map', '0:a?', '-c:a:0', 'aac', '-b:a:0', '96k',
        '-f', 'hls',
        '-hls_time', '6',
        '-hls_playlist_type', 'vod',
        '-hls_flags', 'independent_segments',
        '-hls_segment_type', 'mpegts',
        '-hls_segment_filename', path.join(hlsOutputDir, 'stream_%v_%03d.ts'),
        '-master_pl_name', 'master.m3u8',
        '-var_stream_map', 'v:0,a:0,name:480p',
        path.join(hlsOutputDir, '%v.m3u8'),
      ];
    }

    console.log('⚡ Running FFmpeg Transcoding...');
    let lastProgressUpdate = Date.now();

    await new Promise((resolve, reject) => {
      const transcodeProc = spawn('ffmpeg', ffmpegArgs);

      transcodeProc.stderr.on('data', (chunk) => {
        const line = chunk.toString();
        // Parse time=HH:MM:SS.ms to calculate progress
        const timeMatch = line.match(/time=(\d+):(\d+):(\d+\.\d+)/);
        if (timeMatch && duration > 0) {
          const currentSec = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseFloat(timeMatch[3]);
          const pct = Math.min(99, Math.round((currentSec / duration) * 100));
          const overallProgress = Math.min(80, 30 + Math.round(pct * 0.5));

          if (Date.now() - lastProgressUpdate > 4000) {
            lastProgressUpdate = Date.now();
            updateDbStatus({
              status: 'TRANSCODING',
              progress: overallProgress,
              stageDetail: `กำลังแปลงวิดีโอ HLS Multi-bitrate (${pct}%)`,
            });
          }
        }
      });

      transcodeProc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg exited with non-zero code ${code}`));
        }
      });

      transcodeProc.on('error', reject);
    });

    console.log('✅ FFmpeg Transcoding completed successfully!');

    // Step 6: Upload HLS Package to OneDrive /streams/{VIDEO_ID}/
    await updateDbStatus({
      status: 'TRANSCODING',
      progress: 82,
      stageDetail: `กำลังสร้างโฟลเดอร์ /streams/${VIDEO_ID} บน OneDrive Business`,
    });

    const streamFolderName = `stream_vid_${VIDEO_ID}`;
    const streamsParentFolder = '/streams';
    const parentFolderId = await ensureFolderExists(token, driveId, streamsParentFolder);

    // Create subfolder on OneDrive
    console.log(`📁 Creating folder ${streamFolderName} in ${streamsParentFolder}...`);
    const createFolderRes = await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${parentFolderId}/children`, {
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
      throw new Error(`Failed to create HLS stream folder (${createFolderRes.status}): ${err}`);
    }

    const streamFolderData = await createFolderRes.json();
    const streamFolderId = streamFolderData.id;

    // List all files in hlsOutputDir
    const hlsFiles = fs.readdirSync(hlsOutputDir);
    console.log(`📦 Uploading ${hlsFiles.length} HLS files to OneDrive /streams/${streamFolderName}...`);

    let filesUploaded = 0;
    for (const fileName of hlsFiles) {
      const filePath = path.join(hlsOutputDir, fileName);
      await uploadFileToOneDrive(token, driveId, streamFolderId, fileName, filePath);
      filesUploaded++;

      if (filesUploaded % 5 === 0 || filesUploaded === hlsFiles.length) {
        const uploadProgress = Math.min(95, 82 + Math.round((filesUploaded / hlsFiles.length) * 13));
        await updateDbStatus({
          status: 'TRANSCODING',
          progress: uploadProgress,
          stageDetail: `อัปโหลดไฟล์ HLS ขึ้น OneDrive: ${filesUploaded}/${hlsFiles.length} ชิ้น`,
        });
      }
    }

    // Step 7: Cleanup raw file on OneDrive to save storage space
    await updateDbStatus({
      status: 'PROCESSING',
      progress: 96,
      stageDetail: `กำลังลบไฟล์ต้นฉบับใน /raw/ เพื่อประหยัดพื้นที่จัดเก็บ`,
    });

    try {
      console.log(`🗑️ Deleting raw file /raw/${RAW_FILE_NAME} (ID: ${rawItemId}) on OneDrive...`);
      await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${rawItemId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      console.log('✅ Raw file deleted from OneDrive.');
    } catch (delErr) {
      console.warn('⚠️ Could not delete raw file:', delErr.message);
    }

    // Step 8: Final DB Update -> READY
    const masterPlaylistPath = `/streams/${streamFolderName}/master.m3u8`;
    await updateDbStatus({
      status: 'READY',
      progress: 100,
      stageDetail: 'แปลงไฟล์และจัดเก็บ HLS Multi-bitrate สำเร็จ พร้อมสตรีมมิ่ง!',
      extra: {
        onedrive_folder_id: streamFolderId,
        master_playlist_path: masterPlaylistPath,
        duration,
        resolution: resolutionLabel,
        fps,
        codec,
      },
    });

    console.log(`🎉 Transcoding workflow finished successfully for Video #${VIDEO_ID}!`);

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
    // Cleanup local runner temporary directory
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        console.log('🧹 Cleaned up local runner temp directory.');
      }
    } catch (_) {}
  }
}

main();
