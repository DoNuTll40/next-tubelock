import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import os from 'os';

export const runtime = 'nodejs';
export const maxDuration = 300;

global.__tubelock_jobs = global.__tubelock_jobs || new Map();

/**
 * POST /api/hls/upload-chunk
 * Chunked upload endpoint to bypass Next.js 10MB request body limit completely.
 * Accepts 5MB-10MB binary chunks and appends them to disk in real-time.
 */
export async function POST(request) {
  try {
    const jobId = request.headers.get('x-job-id');
    const rawFileName = request.headers.get('x-file-name') || 'video.mp4';
    const fileName = decodeURIComponent(rawFileName);
    const chunkIndex = parseInt(request.headers.get('x-chunk-index') || '0', 10);
    const totalChunks = parseInt(request.headers.get('x-total-chunks') || '1', 10);
    const totalSize = parseInt(request.headers.get('x-total-size') || '0', 10);

    if (!jobId) {
      return NextResponse.json({ success: false, error: 'x-job-id header is required' }, { status: 400 });
    }

    const safeName = fileName.replace(/[^a-zA-Z0-9.\-_\u0E00-\u0E7F]/g, '_');
    const tempDir = path.join(os.tmpdir(), `tubelock_${jobId}`);
    const tempFilePath = path.join(tempDir, safeName);

    // On first chunk, ensure directory and clean previous file
    if (chunkIndex === 0) {
      fs.mkdirSync(tempDir, { recursive: true });
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    }

    const chunkArrayBuffer = await request.arrayBuffer();
    const chunkBuffer = Buffer.from(chunkArrayBuffer);

    // Append chunk to disk
    fs.appendFileSync(tempFilePath, chunkBuffer);

    const isComplete = chunkIndex === totalChunks - 1;

    if (isComplete) {
      const stat = fs.statSync(tempFilePath);
      global.__tubelock_jobs.set(jobId, {
        tempFilePath,
        tempDir,
        fileName,
        fileSize: stat.size,
        createdAt: Date.now(),
      });
    }

    return NextResponse.json({
      success: true,
      jobId,
      chunkIndex,
      isComplete,
    });
  } catch (err) {
    console.error('[Upload Chunk Error]:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'บันทึกชิ้นส่วนไฟล์ไม่สำเร็จ' },
      { status: 500 }
    );
  }
}
