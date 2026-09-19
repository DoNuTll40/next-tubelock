import path from 'path';
import fs from 'fs';
import os from 'os';
import {
  probeVideoNative,
  extractThumbnailNative,
  sliceVideoToHlsNative,
  writeMasterPlaylist,
  uploadHlsFolderToOneDrive,
} from '@/lib/serverHlsTranscoder';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const maxDuration = 300;

global.__tubelock_jobs = global.__tubelock_jobs || new Map();

/**
 * GET /api/hls/process-stream
 * Server-Sent Events (SSE) endpoint to slice video with Native FFmpeg and upload to OneDrive
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);

  const jobId = searchParams.get('jobId');
  const localPath = searchParams.get('localPath');
  const title = (searchParams.get('title') || 'video').trim();
  const description = (searchParams.get('description') || '').trim();
  const parentFolder = (searchParams.get('parentFolder') || '/Videos').trim();
  const tagsRaw = (searchParams.get('tags') || '').trim();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (data) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch (_) {}
      };

      let cleanupDir = null;

      try {
        let inputFilePath = '';
        let fileSize = 0;

        if (localPath && fs.existsSync(localPath)) {
          // Direct PC path
          inputFilePath = localPath;
          fileSize = fs.statSync(localPath).size;
          sendEvent({
            stage: 'init',
            percent: 5,
            text: `ตรวจพบไฟล์ในเครื่อง: "${path.basename(localPath)}" (${(fileSize / (1024 * 1024)).toFixed(1)} MB)`,
          });
        } else if (jobId && global.__tubelock_jobs.has(jobId)) {
          // From uploaded temp
          const jobData = global.__tubelock_jobs.get(jobId);
          inputFilePath = jobData.tempFilePath;
          cleanupDir = jobData.tempDir;
          fileSize = jobData.fileSize;
          sendEvent({
            stage: 'init',
            percent: 5,
            text: `เตรียมไฟล์บนเซิร์ฟเวอร์เรียบร้อย (${(fileSize / (1024 * 1024)).toFixed(1)} MB)`,
          });
        } else {
          sendEvent({ error: 'ไม่พบไฟล์วิดีโอ กรุณาอัปโหลดใหม่หรือระบุ Local Path' });
          return;
        }

        // -------------------------------------------------------------
        // Step 1: Probe video with FFprobe
        // -------------------------------------------------------------
        sendEvent({
          stage: 'probing',
          percent: 15,
          text: 'กำลังสแกนโครงสร้างวิดีโอด้วย FFprobe...',
        });

        const meta = await probeVideoNative(inputFilePath);
        sendEvent({
          stage: 'probing_done',
          percent: 20,
          text: `สแกนสำเร็จ: ${meta.width}x${meta.height} [${meta.resolution}] • Codec: ${meta.codec.toUpperCase()} • ${meta.fps} FPS • ${Math.floor(meta.duration / 60)}:${String(meta.duration % 60).padStart(2, '0')} นาที`,
          meta,
        });

        // -------------------------------------------------------------
        // Step 2: Slice into HLS with native FFmpeg
        // -------------------------------------------------------------
        const workDir = cleanupDir || path.join(os.tmpdir(), `tubelock_out_${Date.now()}`);
        const hlsOutputDir = path.join(workDir, 'hls_out');
        fs.mkdirSync(hlsOutputDir, { recursive: true });

        // Capture thumbnail
        const thumbPath = path.join(hlsOutputDir, 'thumbnail.jpg');
        await extractThumbnailNative(inputFilePath, thumbPath, 1);

        const isH264 = meta.codec === 'h264' || meta.codec === 'avc1';
        sendEvent({
          stage: 'slicing',
          percent: 25,
          text: isH264
            ? '🚀 วิดีโอเป็น H.264: กำลังหั่น HLS Segment ด้วย Stream Copy (เร็วพิเศษในไม่กี่วินาที)...'
            : '⚡ กำลังหั่นและแปลงวิดีโอเป็น HLS H.264 ด้วย Multi-threaded FFmpeg...',
        });

        await sliceVideoToHlsNative(inputFilePath, hlsOutputDir, {
          isH264,
          duration: meta.duration,
          onProgress: (slicePct) => {
            const scaled = Math.min(65, 25 + Math.round(slicePct * 0.4));
            sendEvent({
              stage: 'slicing',
              percent: scaled,
              text: `กำลังหั่น HLS Segment (${slicePct}%)...`,
            });
          },
        });

        // Write master.m3u8
        writeMasterPlaylist(hlsOutputDir, meta);

        const generatedFiles = fs.readdirSync(hlsOutputDir);
        sendEvent({
          stage: 'sliced_done',
          percent: 65,
          text: `หั่นสำเร็จ! ได้ไฟล์ HLS ทั้งหมด ${generatedFiles.length} รายการ (Playlists + Segments)`,
        });

        // -------------------------------------------------------------
        // Step 3: Upload HLS Package to OneDrive
        // -------------------------------------------------------------
        const cleanTitle = title
          .replace(/[^a-zA-Z0-9_\-\u0E00-\u0E7F]/g, '_')
          .slice(0, 40) || 'video';

        const subFolderName = `hls_${cleanTitle}_${Date.now()}`;
        sendEvent({
          stage: 'uploading_onedrive',
          percent: 70,
          text: `กำลังสร้างโฟลเดอร์ "${subFolderName}" และทยอยอัปโหลดขึ้น OneDrive...`,
        });

        const uploadResult = await uploadHlsFolderToOneDrive(
          hlsOutputDir,
          parentFolder,
          subFolderName,
          (uploadProg) => {
            const scaled = Math.min(95, 70 + Math.round(uploadProg.percent * 0.25));
            sendEvent({
              stage: 'uploading_onedrive',
              percent: scaled,
              text: `อัปโหลดไฟล์ที่ ${uploadProg.currentFile}/${uploadProg.totalFiles}: ${uploadProg.fileName}`,
              uploadProg,
            });
          }
        );

        // -------------------------------------------------------------
        // Step 4: Register HLS video in Neon Database
        // -------------------------------------------------------------
        sendEvent({
          stage: 'db_saving',
          percent: 96,
          text: 'กำลังบันทึกข้อมูลเข้าฐานข้อมูล Neon PostgreSQL...',
        });

        const sql = getDb();
        const tags = tagsRaw
          ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean)
          : ['HLS', meta.resolution];

        if (!tags.includes('HLS')) tags.unshift('HLS');

        const rows = await sql`
          INSERT INTO videos (
            onedrive_folder_id, source_type, title, description, duration, 
            file_size_bytes, resolution, fps, codec, thumbnail_url, tags, updated_at
          ) VALUES (
            ${uploadResult.folderId}, 'hls', ${title}, ${description || `ชุด HLS จากโฟลเดอร์ ${parentFolder}`}, 
            ${meta.duration}, ${fileSize}, ${meta.resolution}, 
            ${meta.fps}, 'h264', ${uploadResult.thumbUrl || ''}, 
            ${tags}, NOW()
          )
          ON CONFLICT (onedrive_folder_id) DO UPDATE SET
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            duration = EXCLUDED.duration,
            resolution = EXCLUDED.resolution,
            fps = EXCLUDED.fps,
            codec = EXCLUDED.codec,
            thumbnail_url = CASE WHEN EXCLUDED.thumbnail_url <> '' THEN EXCLUDED.thumbnail_url ELSE videos.thumbnail_url END,
            tags = EXCLUDED.tags,
            file_size_bytes = EXCLUDED.file_size_bytes,
            updated_at = NOW()
          RETURNING *;
        `;

        const video = rows[0];

        sendEvent({
          stage: 'completed',
          percent: 100,
          text: '🎉 สตรีมมิ่งพร้อมใช้งาน! หั่น HLS และบันทึกเข้าสู่ระบบ TubeLock สำเร็จเรียบร้อย',
          video,
          folderName: uploadResult.folderName,
        });
      } catch (err) {
        console.error('[Process Stream Error]:', err);
        sendEvent({
          error: err.message || 'เกิดข้อผิดพลาดในการประมวลผล HLS',
        });
      } finally {
        if (jobId && global.__tubelock_jobs) {
          global.__tubelock_jobs.delete(jobId);
        }
        if (cleanupDir && fs.existsSync(cleanupDir)) {
          try {
            fs.rmSync(cleanupDir, { recursive: true, force: true });
          } catch (_) {}
        }
        try {
          controller.close();
        } catch (_) {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
