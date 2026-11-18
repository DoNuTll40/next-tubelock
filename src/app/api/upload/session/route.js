import { NextResponse } from 'next/server';
import { getSessionUserId, isAdmin, accessError } from '@/lib/access';
import { getDb } from '@/lib/db';
import { createUploadSession } from '@/lib/onedriveServer';
import {
  ensureVideoVersionsSchema,
  ensurePrimaryVersionSeeded,
  slugifyVersionKey,
} from '@/lib/videoVersions';

/**
 * POST /api/upload/session
 * Step 1: Create Microsoft Graph Upload Session in /raw/ on OneDrive
 * and register initial video record (or a new video_versions record if targetVideoId is given).
 */
export async function POST(request) {
  try {
    const sql = getDb();
    const userId = await getSessionUserId(sql);
    if (userId == null) return accessError(401);
    const admin = isAdmin(userId);
    const body = await request.json();
    const {
      fileName,
      title,
      description = '',
      fileSize = 0,
      targetVideoId = null,
      versionLabel = '',
      versionKey = '',
      versionBadge = '',
      versionAspectLabel = '',
      versionDescription = '',
    } = body;

    if (typeof fileName !== 'string' || !fileName.trim()) {
      return NextResponse.json(
        { success: false, error: 'กรุณาระบุชื่อไฟล์ (fileName is required)' },
        { status: 400 }
      );
    }

    const parsedTargetId = targetVideoId != null ? parseInt(targetVideoId, 10) : null;
    if (targetVideoId != null && (!parsedTargetId || Number.isNaN(parsedTargetId))) {
      return NextResponse.json({ success: false, error: 'targetVideoId ไม่ถูกต้อง' }, { status: 400 });
    }

    if (parsedTargetId) {
      const parentRows = await sql`
        SELECT id, title, user_id
        FROM videos
        WHERE id = ${parsedTargetId} AND (${admin} OR user_id = ${userId})
        LIMIT 1;
      `;
      if (!parentRows.length) {
        return accessError(404);
      }
    }

    // 1. Sanitize file name and create a unique raw file name
    const ext = fileName.match(/\.([a-z0-9]{1,10})$/i)?.[1] || 'mp4';
    const cleanBase = fileName
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-zA-Z0-9_\u0E00-\u0E7F-]/g, '_')
      .slice(0, 80);
    const uniqueRawFileName = `${crypto.randomUUID()}_${cleanBase}.${ext}`;

    // 2. Request Microsoft Graph to open an upload session directly into /raw
    const targetFolder = '/raw';
    const sessionData = await createUploadSession(uniqueRawFileName, targetFolder);

    // Branch A: Adding a new version to an existing video
    if (parsedTargetId) {
      await ensureVideoVersionsSchema(sql);
      const seededOrExisting = await ensurePrimaryVersionSeeded(sql, parsedTargetId, 'ปกติ');
      const existingKeys = seededOrExisting.map((v) => v.version_key);
      const cleanLabel = String(versionLabel || '').trim().slice(0, 80) || `เวอร์ชัน ${existingKeys.length + 1}`;
      const uniqueKey = slugifyVersionKey(versionKey || cleanLabel, existingKeys);
      const cleanBadge = String(versionBadge || '').trim().slice(0, 32);
      const cleanAspect = String(versionAspectLabel || '').trim().slice(0, 24);
      const cleanDesc = String(versionDescription || '').trim().slice(0, 400);

      const maxSortRows = await sql`
        SELECT COALESCE(MAX(sort_order), 0)::int AS max_sort
        FROM video_versions
        WHERE video_id = ${parsedTargetId};
      `;
      const nextSort = (Number(maxSortRows?.[0]?.max_sort) || 0) + 1;

      const verRows = await sql`
        INSERT INTO video_versions (
          video_id, version_key, label, badge, aspect_label, description,
          is_default, sort_order, source_type, raw_file_name, file_size_bytes,
          status, transcode_progress, stage_detail, created_at, updated_at
        ) VALUES (
          ${parsedTargetId},
          ${uniqueKey},
          ${cleanLabel},
          ${cleanBadge},
          ${cleanAspect},
          ${cleanDesc},
          FALSE,
          ${nextSort},
          'hls',
          ${uniqueRawFileName},
          ${fileSize},
          'UPLOADING',
          0,
          'กำลังอัปโหลดไฟล์เวอร์ชันใหม่ตรงเข้า OneDrive (/raw)',
          NOW(),
          NOW()
        )
        RETURNING id, video_id, version_key, label, badge, aspect_label, status, raw_file_name, created_at;
      `;

      const createdVersion = verRows[0];
      return NextResponse.json({
        success: true,
        videoId: parsedTargetId,
        versionId: createdVersion.id,
        versionKey: createdVersion.version_key,
        rawFileName: uniqueRawFileName,
        uploadUrl: sessionData.uploadUrl,
        expirationDateTime: sessionData.expirationDateTime,
        targetFolder,
        version: createdVersion,
        message: 'เปิด Upload Session สำหรับเวอร์ชันใหม่สำเร็จ',
      });
    }

    const videoTitle = (title || fileName.replace(/\.[^/.]+$/, '')).trim();

    // 4. Create initial video record in Neon DB with status 'UPLOADING'
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
        user_id,
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
        ${userId},
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
