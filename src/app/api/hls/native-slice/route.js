import { NextResponse } from 'next/server';
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
// Allow long-running uploads and slicing
export const maxDuration = 300;

/**
 * POST /api/hls/native-slice
 * Server-side native FFmpeg HLS Slicing and OneDrive Upload with Server-Sent Events (SSE)
 */
export async function POST(request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (data) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      let tempDir = null;

      try {
        const formData = await request.formData();
        const file = formData.get('file');
        const localPath = formData.get('localPath');
        const title = (formData.get('title') || 'video').toString().trim();
        const description = (formData.get('description') || '').toString().trim();
        const parentFolder = (formData.get('parentFolder') || '/Videos').toString().trim();
        const tagsRaw = (formData.get('tags') || '').toString().trim();

        if (!file && !localPath) {
          sendEvent({ error: 'กรุณาเลือกไฟล์วิดีโอ หรือระบุ Local Path' });
          controller.close();
          return;
        }

        tempDir = path.join(os.tmpdir(), `tubelock_hls_${Date.now()}`);
        fs.mkdirSync(tempDir, { recursive: true });

        let inputFilePath = '';
        let fileSize = 0;

        if (localPath && fs.existsSync(localPath)) {
          // Case 1: Direct Local File Path on PC (Instant, Zero HTTP upload!)
          inputFilePath = localPath;
          fileSize = fs.statSync(localPath).size;
          sendEvent({
            stage: 'init',
            percent: 5,
            text: `ตรวจพบไฟล์ในเครื่อง: "${path.basename(localPath)}" (${(fileSize / (1024 * 1024)).toFixed(1)} MB)`,
          });
        } else if (file) {
          // Case 2: File uploaded via Browser FormData
          fileSize = file.size;
          sendEvent({
            stage: 'saving_server',
            percent: 10,
            text: `กำลังเตรียมไฟล์บนเซิร์ฟเวอร์... (${(fileSize / (1024 * 1024)).toFixed(1)} MB)`,
          });

          inputFilePath = path.join(tempDir, file.name);
          const arrayBuffer = await file.arrayBuffer();
          fs.writeFileSync(inputFilePath, Buffer.from(arrayBuffer));
        }

        // -------------------------------------------------------------
        // Step 1: Probe video with native ffprobe
        // -------------------------------------------------------------
        sendEvent({
          stage: 'probing',
          percent: 20,
          text: 'กำลังสแกนโครงสร้างวิดีโอด้วย FFprobe...',
        });

        const meta = await probeVideoNative(inputFilePath);
        sendEvent({
          stage: 'probing_done',
          percent: 25,
          text: `ตรวจพบ: ${meta.width}x${meta.height} [${meta.resolution}] • Codec: ${meta.codec.toUpperCase()} • FPS: ${meta.fps}`,
          meta,
        });

        // -------------------------------------------------------------
        // Step 2: Slice into HLS with native FFmpeg
        // -------------------------------------------------------------
        const hlsOutputDir = path.join(tempDir, 'hls_out');
        fs.mkdirSync(hlsOutputDir, { recursive: true });

        // Capture thumbnail
        const thumbPath = path.join(hlsOutputDir, 'thumbnail.jpg');
        await extractThumbnailNative(inputFilePath, thumbPath, 1);

        const isH264 = meta.codec === 'h264' || meta.codec === 'avc1';
        sendEvent({
          stage: 'slicing',
          percent: 30,
          text: isH264
            ? '🚀 วิดีโอเป็น H.264: กำลังหั่น HLS Segment ด้วย Stream Copy (เร็วพิเศษในไม่กี่วินาที)...'
            : '⚡ กำลังหั่นและแปลงวิดีโอเป็น HLS H.264 ด้วย Multi-threaded FFmpeg...',
        });

        await sliceVideoToHlsNative(inputFilePath, hlsOutputDir, {
          isH264,
          duration: meta.duration,
          onProgress: (slicePct) => {
            const scaled = Math.min(65, 30 + Math.round(slicePct * 0.35));
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
          text: `หั่นสำเร็จ! ได้ไฟล์ HLS ทั้งหมด ${generatedFiles.length} รายการ`,
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
          text: `กำลังสร้างโฟลเดอร์ "${subFolderName}" และทยอยส่งข้อมูลขึ้น OneDrive...`,
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
        // Step 4: Register HLS video into Neon DB
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
        console.error('[Native Slice Error]:', err);
        sendEvent({
          error: err.message || 'เกิดข้อผิดพลาดในการประมวลผล HLS',
        });
      } finally {
        // Clean up temporary files on disk
        if (tempDir && fs.existsSync(tempDir)) {
          try {
            fs.rmSync(tempDir, { recursive: true, force: true });
          } catch (_) {}
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
