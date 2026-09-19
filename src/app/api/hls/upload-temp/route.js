import { NextResponse } from 'next/server';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import path from 'path';
import fs from 'fs';
import os from 'os';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Shared in-memory map for active job temp paths
global.__tubelock_jobs = global.__tubelock_jobs || new Map();

/**
 * POST /api/hls/upload-temp
 * Streams raw binary file directly to disk temp folder (No FormData overhead, No memory limit!)
 */
export async function POST(request) {
  try {
    const rawFileName = request.headers.get('x-file-name') || 'video.mp4';
    const fileName = decodeURIComponent(rawFileName);

    const safeName = fileName.replace(/[^a-zA-Z0-9.\-_\u0E00-\u0E7F]/g, '_');
    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const tempDir = path.join(os.tmpdir(), `tubelock_${jobId}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const tempFilePath = path.join(tempDir, safeName);
    const fileWriteStream = fs.createWriteStream(tempFilePath);

    const nodeStream = Readable.fromWeb(request.body);
    await pipeline(nodeStream, fileWriteStream);

    const stat = fs.statSync(tempFilePath);

    global.__tubelock_jobs.set(jobId, {
      tempFilePath,
      tempDir,
      fileName,
      fileSize: stat.size,
      createdAt: Date.now(),
    });

    return NextResponse.json({
      success: true,
      jobId,
      fileName,
      fileSize: stat.size,
    });
  } catch (err) {
    console.error('[Upload Temp Error]:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'ไม่สามารถบันทึกไฟล์ชั่วคราวบนเซิร์ฟเวอร์ได้' },
      { status: 500 }
    );
  }
}
