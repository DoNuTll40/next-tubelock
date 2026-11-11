import { getSessionUserId, isAdmin, accessError } from '@/lib/access';
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
  const actor = await getSessionUserId();
  if (actor == null) return accessError(401);
  if (!isAdmin(actor)) return accessError(403);
  try {
    const jobId = request.headers.get('x-job-id') || '';
    const rawFileName = request.headers.get('x-file-name') || 'video.mp4';
    const chunkIndex = Number(request.headers.get('x-chunk-index') ?? NaN);
    const totalChunks = Number(request.headers.get('x-total-chunks') ?? NaN);
    const totalSize = Number(request.headers.get('x-total-size') ?? NaN);

    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(jobId)
      || ![chunkIndex, totalChunks, totalSize].every(Number.isSafeInteger)
      || chunkIndex < 0 || chunkIndex >= totalChunks || totalSize < totalChunks) {
      return NextResponse.json({ success: false, error: 'Invalid chunk metadata' }, { status: 400 });
    }

    const chunkBuffer = Buffer.from(await request.arrayBuffer());
    if (!chunkBuffer.length || chunkBuffer.length > 10 * 1024 * 1024) {
      return NextResponse.json({ success: false, error: 'Invalid chunk size' }, { status: 400 });
    }

    let job = global.__tubelock_jobs.get(jobId);
    if (!job && chunkIndex === 0) {
      job = {
        fileName: decodeURIComponent(rawFileName),
        totalChunks,
        totalSize,
        nextChunk: 0,
        fileSize: 0,
        createdAt: Date.now(),
      };
    }

    if (!job || job.nextChunk !== chunkIndex || job.totalChunks !== totalChunks || job.totalSize !== totalSize) {
      return NextResponse.json({ success: false, error: 'Unexpected chunk for this job' }, { status: 409 });
    }

    const fileSize = job.fileSize + chunkBuffer.length;
    const isComplete = chunkIndex === totalChunks - 1;
    if (fileSize > totalSize || isComplete !== (fileSize === totalSize)) {
      return NextResponse.json({ success: false, error: 'Chunk does not match declared size' }, { status: 400 });
    }

    if (chunkIndex === 0) {
      job.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tubelock_'));
      job.tempFilePath = path.join(job.tempDir, 'video');
    }

    try {
      fs.appendFileSync(job.tempFilePath, chunkBuffer);
    } catch (err) {
      global.__tubelock_jobs.delete(jobId);
      fs.rmSync(job.tempDir, { recursive: true, force: true });
      throw err;
    }

    job.nextChunk += 1;
    job.fileSize = fileSize;
    job.isComplete = isComplete;
    global.__tubelock_jobs.set(jobId, job);

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
