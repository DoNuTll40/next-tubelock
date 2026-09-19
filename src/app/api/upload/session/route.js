import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { createUploadSession } from '@/lib/onedriveServer';

/**
 * POST /api/upload/session
 * Step 1: Create Microsoft Graph Upload Session in /raw/ on OneDrive
 * and register initial video record with status 'UPLOADING' in Neon DB.
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { fileName, title, description = '', fileSize = 0 } = body;

    if (!fileName) {
      return NextResponse.json(
        { success: false, error: 'กรุณาระบุชื่อไฟล์ (fileName is required)' },
        { status: 400 }
      );
    }

    // 1. Sanitize file name and create a unique raw file name
    const ext = fileName.includes('.') ? fileName.split('.').pop() : 'mp4';
    const cleanBase = fileName
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-zA-Z0-9_\u0E00-\u0E7F-]/g, '_')
      .slice(0, 80);
    const uniqueRawFileName = `${Date.now()}_${cleanBase}.${ext}`;

    const videoTitle = (title || fileName.replace(/\.[^/.]+$/, '')).trim();

    // 2. Request Microsoft Graph to open an upload session directly into /raw
    const targetFolder = '/raw';
    const sessionData = await createUploadSession(uniqueRawFileName, targetFolder);

    // 3. Create initial video record in Neon DB with status 'UPLOADING'
    const sql = getDb();
    const rows = await sql`
      INSERT INTO videos (
        title, 
        description, 
        file_size_bytes, 
        status, 
        transcode_progress, 
        stage_detail, 
        raw_file_name, 
        source_type, 
        tags,
        created_at, 
        updated_at
      ) VALUES (
        ${videoTitle}, 
        ${description}, 
        ${fileSize}, 
        'UPLOADING', 
        0, 
        'กำลังอัปโหลดไฟล์ตรงเข้า OneDrive Business (/raw)', 
        ${uniqueRawFileName}, 
        'hls', 
        ${['Upload', 'HLS']}, 
        NOW(), 
        NOW()
      )
      RETURNING id, title, status, raw_file_name, created_at;
    `;

    const createdVideo = rows[0];

    return NextResponse.json({
      success: true,
      videoId: createdVideo.id,
      rawFileName: uniqueRawFileName,
      uploadUrl: sessionData.uploadUrl,
      expirationDateTime: sessionData.expirationDateTime,
      targetFolder,
      video: createdVideo,
      message: 'เปิด Upload Session กับ Microsoft Graph สำเร็จ',
    });
  } catch (err) {
    console.error('[Upload Session Error Details]:', {
      message: err.message,
      stack: err.stack,
      name: err.name,
    });
    return NextResponse.json(
      { 
        success: false, 
        error: err.message || 'ไม่สามารถเปิด Upload Session กับ Microsoft Graph ได้',
        details: err.stack || err.toString(),
      },
      { status: 500 }
    );
  }
}
