import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createHlsFolder, uploadHlsFileDirect, createHlsFileUploadSession } from './onedriveServer';
import { getDb } from './db';
import { classifyResolution } from './videoUtils';

const execAsync = promisify(exec);

/**
 * Run ffprobe to get comprehensive video metadata
 */
export async function probeVideoNative(filePath) {
  try {
    const cmd = `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`;
    const { stdout } = await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });
    const data = JSON.parse(stdout);

    const videoStream = data.streams?.find((s) => s.codec_type === 'video') || {};
    const audioStream = data.streams?.find((s) => s.codec_type === 'audio');

    const width = parseInt(videoStream.width || 0, 10);
    const height = parseInt(videoStream.height || 0, 10);
    const codec = (videoStream.codec_name || 'h264').toLowerCase();
    const duration = parseFloat(data.format?.duration || videoStream.duration || 0);

    // Calculate FPS
    let fps = 30;
    if (videoStream.r_frame_rate) {
      const parts = videoStream.r_frame_rate.split('/');
      if (parts.length === 2 && parseFloat(parts[1]) > 0) {
        fps = Math.round(parseFloat(parts[0]) / parseFloat(parts[1]));
      }
    }

    const resolution = classifyResolution(width, height);

    return {
      width,
      height,
      duration: Math.round(duration),
      fps,
      codec,
      hasAudio: !!audioStream,
      resolution,
      sizeBytes: parseInt(data.format?.size || 0, 10),
    };
  } catch (err) {
    console.warn('[probeVideoNative error]:', err.message);
    return {
      width: 1920,
      height: 1080,
      duration: 0,
      fps: 30,
      codec: 'h264',
      hasAudio: true,
      resolution: '1080p',
      sizeBytes: 0,
    };
  }
}

/**
 * Capture high quality thumbnail image from video frame using FFmpeg
 */
export async function extractThumbnailNative(filePath, outputPath, timeOffsetSec = 1) {
  try {
    const cmd = `ffmpeg -ss ${timeOffsetSec} -i "${filePath}" -frames:v 1 -vf "scale=640:-2" -q:v 2 "${outputPath}" -y`;
    await execAsync(cmd);
    return true;
  } catch (err) {
    console.warn('[extractThumbnailNative error]:', err.message);
    return false;
  }
}

/**
 * Slice video into HLS segments using native FFmpeg with multi-threading and hardware acceleration
 */
export function sliceVideoToHlsNative(inputPath, outputDir, options = {}) {
  const {
    isH264 = false,
    duration = 0,
    onProgress = () => {},
  } = options;

  return new Promise((resolve, reject) => {
    fs.mkdirSync(outputDir, { recursive: true });

    const playlistPath = path.join(outputDir, 'playlist.m3u8');
    const segmentPattern = path.join(outputDir, 'segment_%03d.ts');

    let args = [];

    if (isH264 && (!options.meta?.height || options.meta.height <= 1080)) {
      // Direct Stream Copy: Ultra-fast (takes 2-5 seconds, virtually zero CPU)
      args = [
        '-i', inputPath,
        '-c', 'copy',
        '-f', 'hls',
        '-hls_time', '6',
        '-hls_list_size', '0',
        '-hls_segment_type', 'mpegts',
        '-hls_flags', 'split_by_time',
        '-hls_segment_filename', segmentPattern,
        playlistPath,
        '-y',
      ];
    } else {
      // Non-H264 (e.g. AV1, HEVC) or >1080p -> High-speed transcode to standard H.264
      // Scale to 1080p if 4K to eliminate mobile dropframes and speed up upload
      const scaleArgs = (options.meta?.height > 1080) ? ['-vf', 'scale=-2:1080'] : [];
      args = [
        '-i', inputPath,
        ...scaleArgs,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '22',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-f', 'hls',
        '-hls_time', '6',
        '-hls_list_size', '0',
        '-hls_segment_type', 'mpegts',
        '-hls_flags', 'split_by_time',
        '-hls_segment_filename', segmentPattern,
        playlistPath,
        '-y',
      ];
    }

    const ffmpegProc = spawn('ffmpeg', args);

    ffmpegProc.stderr.on('data', (chunk) => {
      const line = chunk.toString();
      const timeMatch = line.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (timeMatch && duration > 0) {
        const hours = parseFloat(timeMatch[1]);
        const mins = parseFloat(timeMatch[2]);
        const secs = parseFloat(timeMatch[3]);
        const currentSecs = hours * 3600 + mins * 60 + secs;
        const pct = Math.min(99, Math.round((currentSecs / duration) * 100));
        onProgress(pct);
      }
    });

    ffmpegProc.on('close', (code) => {
      if (code === 0) {
        onProgress(100);
        resolve(true);
      } else {
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });

    ffmpegProc.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Write master.m3u8 playlist file
 */
export function writeMasterPlaylist(outputDir, meta) {
  const masterPath = path.join(outputDir, 'master.m3u8');
  const targetH = meta.height > 1080 && (meta.codec !== 'h264' || meta.height > 1080) ? 1080 : meta.height;
  const targetW = meta.height > 1080 ? Math.round(meta.width * (1080 / meta.height)) : meta.width;
  const bandwidth = targetH >= 2160 ? 16000000 : targetH >= 1440 ? 9000000 : targetH >= 1080 ? 6000000 : 3000000;
  const content = `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${targetW}x${targetH}\nplaylist.m3u8\n`;
  fs.writeFileSync(masterPath, content, 'utf8');
}

/**
 * Upload all files in an HLS output directory to OneDrive
 */
export async function uploadHlsFolderToOneDrive(outputDir, parentFolder, subFolderName, onProgress = () => {}) {
  const folderInfo = await createHlsFolder(parentFolder, subFolderName);
  const folderId = folderInfo.folderId;

  const files = fs.readdirSync(outputDir);
  const hlsFiles = files.filter((f) => f.endsWith('.m3u8') || f.endsWith('.ts') || f.endsWith('.jpg'));

  let uploadedCount = 0;
  let thumbUrl = '';

  for (let i = 0; i < hlsFiles.length; i++) {
    const fileName = hlsFiles[i];
    const filePath = path.join(outputDir, fileName);
    const fileBuffer = fs.readFileSync(filePath);

    onProgress({
      currentFile: i + 1,
      totalFiles: hlsFiles.length,
      fileName,
      percent: Math.round(((i + 1) / hlsFiles.length) * 100),
    });

    if (fileBuffer.length < 4 * 1024 * 1024) {
      let attempts = 0;
      let res = null;
      while (!res && attempts < 3) {
        attempts++;
        try {
          res = await uploadHlsFileDirect(folderId, fileName, fileBuffer);
          if (fileName.endsWith('.jpg')) {
            thumbUrl = res['@microsoft.graph.downloadUrl'] || '';
          }
        } catch (err) {
          if (attempts >= 3) throw err;
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    } else {
      // Chunked upload for files >= 4MB
      const sessionData = await createHlsFileUploadSession(folderId, fileName);
      const uploadUrl = sessionData.uploadUrl;
      const CHUNK_SIZE = 320 * 1024 * 10;
      let start = 0;

      while (start < fileBuffer.length) {
        const end = Math.min(start + CHUNK_SIZE, fileBuffer.length);
        const chunk = fileBuffer.subarray(start, end);
        const contentRange = `bytes ${start}-${end - 1}/${fileBuffer.length}`;

        let attempts = 0;
        let success = false;
        while (!success && attempts < 3) {
          attempts++;
          try {
            const putRes = await fetch(uploadUrl, {
              method: 'PUT',
              headers: {
                'Content-Range': contentRange,
                'Content-Length': chunk.length.toString(),
                'Content-Type': 'application/octet-stream',
              },
              body: chunk,
            });
            if (putRes.ok || putRes.status === 202) {
              success = true;
            } else {
              const errText = await putRes.text();
              throw new Error(`HTTP ${putRes.status}: ${errText}`);
            }
          } catch (err) {
            if (attempts >= 3) throw err;
            await new Promise((r) => setTimeout(r, 1000));
          }
        }

        start = end;
      }
    }

    uploadedCount++;
  }

  return {
    folderId,
    folderName: folderInfo.folderName,
    filesCount: uploadedCount,
    thumbUrl,
  };
}
