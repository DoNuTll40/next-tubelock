import { NextResponse } from 'next/server';
import { uploadHlsFileDirect, createHlsFileUploadSession } from '@/lib/onedriveServer';

/**
 * POST /api/hls/upload-file
 * Uploads a single HLS file (.m3u8 playlist or .ts segment) into the target HLS folder
 */
export async function POST(request) {
  try {
    const formData = await request.formData();
    const folderId = formData.get('folderId');
    const fileName = formData.get('fileName');
    const file = formData.get('file');

    if (!folderId || !fileName || !file) {
      return NextResponse.json(
        { success: false, error: 'folderId, fileName, and file are required' },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Direct upload for files < 4MB (most playlists and segments)
    if (buffer.length < 4 * 1024 * 1024) {
      const res = await uploadHlsFileDirect(folderId, fileName, buffer);
      return NextResponse.json({
        success: true,
        fileName,
        itemId: res.id,
      });
    }

    // Chunked upload for segments >= 4MB
    const sessionData = await createHlsFileUploadSession(folderId, fileName);
    const uploadUrl = sessionData.uploadUrl;

    const CHUNK_SIZE = 320 * 1024 * 10; // ~3.2MB
    let start = 0;
    const totalSize = buffer.length;
    let lastResult = null;

    while (start < totalSize) {
      const end = Math.min(start + CHUNK_SIZE, totalSize);
      const chunk = buffer.subarray(start, end);
      const contentRange = `bytes ${start}-${end - 1}/${totalSize}`;

      const chunkRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Range': contentRange,
          'Content-Type': 'application/octet-stream',
        },
        body: chunk,
      });

      if (chunkRes.status === 200 || chunkRes.status === 201) {
        lastResult = await chunkRes.json();
      } else if (chunkRes.status !== 202) {
        const errText = await chunkRes.text();
        throw new Error(`Chunk upload failed (${chunkRes.status}): ${errText}`);
      }

      start = end;
    }

    return NextResponse.json({
      success: true,
      fileName,
      itemId: lastResult?.id,
    });
  } catch (err) {
    console.error('[HLS Upload File Error]:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'เกิดข้อผิดพลาดในการอัปโหลดไฟล์ HLS' },
      { status: 500 }
    );
  }
}
