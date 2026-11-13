import { protectVideoPoster } from '@/lib/videoUtils';
import { getSessionUserId, isAdmin, accessError } from '@/lib/access';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGraphToken, getUserDriveId, ensureFolderExists } from '@/lib/onedriveServer';
import { decodeVideoSlug } from '@/lib/videoUtils';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/videos/[id]
 * Lightning-fast metadata retrieval (<50ms) for instant UI rendering
 */
export async function GET(request, context) {
  try {
    const { id: rawId } = await context.params;
    const numericId = decodeVideoSlug(rawId) || parseInt(rawId, 10);
    const id = numericId;
    if (!id || isNaN(id)) {
      return NextResponse.json({ success: false, error: 'Video ID is required' }, { status: 400 });
    }

    const sql = getDb();
    const rows = await sql`
      SELECT 
        v.id, v.title, v.description, v.duration, v.file_size_bytes, v.resolution, v.fps, v.codec,
        v.thumbnail_url, v.tags, v.category, v.views_count, v.created_at, v.status, 
        v.transcode_progress, v.stage_detail, v.error_message, v.source_type,
        v.onedrive_item_id, v.onedrive_folder_id, v.raw_file_name, v.master_playlist_path,
        v.subtitle_status, v.subtitle_srt, v.subtitle_vtt, v.subtitle_tracks, v.content_rating,
        v.user_id,
        u.name AS author_name,
        u.picture AS author_picture
      FROM videos v
      LEFT JOIN users u ON v.user_id = u.id
      WHERE v.id = ${id} AND (v.status = 'READY' OR v.status IS NULL)
      LIMIT 1;
    `;
    if (!rows || rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Video not found' }, { status: 404 });
    }

    return NextResponse.json(
      { success: true, video: protectVideoPoster(rows[0]) },
      {
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      }
    );
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

/**
 * DELETE /api/videos/[id]
 * Completely removes a video or queue item from Neon DB and OneDrive (no cache)
 */
export async function DELETE(request, context) {
  try {
    const { id: rawId } = await context.params;
    const numericId = decodeVideoSlug(rawId) || parseInt(rawId, 10);
    const id = numericId;
    if (!id || isNaN(id)) {
      return NextResponse.json({ success: false, error: 'Video ID is required' }, { status: 400 });
    }

    const sql = getDb();
    const userId = await getSessionUserId(sql);
    if (userId == null) return accessError(401);
    const admin = isAdmin(userId);

    // 1. Fetch video details first to clean up OneDrive assets
    const rows = await sql`
      SELECT id, raw_file_name, onedrive_folder_id, onedrive_item_id, title 
      FROM videos 
      WHERE id = ${id} AND (${admin} OR user_id = ${userId})
      LIMIT 1;
    `;

    if (!rows.length) return accessError(404);

    {
      const vid = rows[0];

      // 2. Best-effort cleanup of OneDrive files/folders
      try {
        const token = await getGraphToken();
        const driveId = await getUserDriveId(token);

        // 1. Delete HLS stream folder by path: /streams/stream_vid_{id}
        try {
          await fetch(
            `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/streams/stream_vid_${id}`,
            {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${token}` },
            }
          );
        } catch (_) {}

        // 2. Delete HLS folder by ID if present
        const folderId = vid.onedrive_folder_id;
        if (folderId) {
          try {
            await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${token}` },
            });
          } catch (_) {}
        }

        // 3. Delete direct video file if present
        if (vid.onedrive_item_id && vid.onedrive_item_id !== folderId) {
          try {
            await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${vid.onedrive_item_id}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${token}` },
            });
          } catch (_) {}
        }

        // 4. Delete raw file from /raw/ if present
        if (vid.raw_file_name) {
          try {
            await fetch(
              `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/raw/${encodeURIComponent(vid.raw_file_name)}`,
              {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
              }
            );
          } catch (_) {}
        }
      } catch (graphErr) {
        console.warn('[Cleanup OneDrive Warning]:', graphErr.message);
      }
    }

    // 3. Delete record completely from Neon DB
    await sql`DELETE FROM videos WHERE id = ${id} AND (${admin} OR user_id = ${userId});`;

    return NextResponse.json(
      {
        success: true,
        message: `ลบคิวและข้อมูลวิดีโอ #${id} ออกจากระบบถาวรเรียบร้อยแล้ว`,
        deletedId: id,
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        },
      }
    );
  } catch (err) {
    console.error('[DELETE_VIDEO_ERROR]:', err);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}

const DATA_IMAGE_RE = /^data:(image\/(?:jpe?g|png|webp));base64,(.+)$/i;

/**
 * PATCH /api/videos/[id]
 * Saves thumbnail choice/custom cover, extracted options, and draft metadata for the video owner
 */
export async function PATCH(request, context) {
  try {
    const { id: rawId } = await context.params;
    const numericId = decodeVideoSlug(rawId) || parseInt(rawId, 10);
    const id = numericId;
    if (!id || isNaN(id)) {
      return NextResponse.json({ success: false, error: 'Video ID is required' }, { status: 400 });
    }

    const sql = getDb();
    const userId = await getSessionUserId(sql);
    if (userId == null) return accessError(401);
    const admin = isAdmin(userId);

    try {
      await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS thumbnail_status VARCHAR(50) DEFAULT 'waiting';`;
      await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS thumbnail_options JSONB DEFAULT '[]'::jsonb;`;
    } catch (_) {}

    const existing = await sql`
      SELECT id, onedrive_folder_id, thumbnail_url, thumbnail_status
      FROM videos
      WHERE id = ${id} AND (${admin} OR user_id = ${userId})
      LIMIT 1;
    `;
    if (!existing.length) return accessError(404);

    const body = await request.json();
    const { thumbnailUrl, thumbnailOptions, title, description, category, tags, contentRating } = body || {};

    let validThumbUrl = null;
    let decodedImageBuffer = null;
    let decodedContentType = 'image/jpeg';

    if (typeof thumbnailUrl === 'string' && thumbnailUrl.trim()) {
      const trimmed = thumbnailUrl.trim();
      const match = trimmed.match(DATA_IMAGE_RE);
      if (match && trimmed.length <= 2_600_000) {
        validThumbUrl = trimmed;
        decodedContentType = match[1].toLowerCase();
        decodedImageBuffer = Buffer.from(match[2], 'base64');
      } else if (trimmed.startsWith(`/streams/stream_vid_${id}/`)) {
        validThumbUrl = trimmed;
      } else {
        return NextResponse.json({ success: false, error: 'รูปแบบหรือขนาดไฟล์ภาพปกไม่ถูกต้อง (สูงสุด 2MB)' }, { status: 400 });
      }
    }

    let validOptions = null;
    if (Array.isArray(thumbnailOptions)) {
      const sanitized = thumbnailOptions
        .slice(0, 5)
        .filter((opt) => opt && typeof opt.dataUrl === 'string' && DATA_IMAGE_RE.test(opt.dataUrl))
        .map((opt, idx) => ({
          id: String(opt.id || `seg_${idx + 1}`).slice(0, 32),
          label: String(opt.label || `เฟรมที่ ${idx + 1}`).slice(0, 40),
          timeSec: Number.isFinite(Number(opt.timeSec)) ? Math.max(0, Math.round(Number(opt.timeSec))) : 0,
          dataUrl: opt.dataUrl,
        }));
      if (sanitized.length > 0) {
        validOptions = sanitized;
      }
    }

    // Best-effort sync of custom/selected poster.jpg to OneDrive
    let syncedFolderId = existing[0].onedrive_folder_id || '';
    if (decodedImageBuffer) {
      try {
        const token = await getGraphToken();
        const driveId = await getUserDriveId(token);
        const folderId = syncedFolderId || (await ensureFolderExists(token, driveId, `/streams/stream_vid_${id}`));
        if (folderId) {
          syncedFolderId = folderId;
          await fetch(
            `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${encodeURIComponent(folderId)}:/poster.jpg:/content`,
            {
              method: 'PUT',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': decodedContentType,
                'Content-Length': String(decodedImageBuffer.length),
              },
              body: decodedImageBuffer,
            }
          );
        }
      } catch (odErr) {
        console.warn('[PATCH Thumbnail OneDrive Sync Warning]:', odErr.message);
      }
    }

    const updated = await sql`
      UPDATE videos
      SET thumbnail_url = COALESCE(${validThumbUrl}, thumbnail_url),
          thumbnail_options = COALESCE(${validOptions ? JSON.stringify(validOptions) : null}::jsonb, thumbnail_options),
          thumbnail_status = CASE WHEN ${Boolean(validOptions)} THEN 'ready' ELSE thumbnail_status END,
          onedrive_folder_id = COALESCE(NULLIF(${syncedFolderId}, ''), onedrive_folder_id),
          title = COALESCE(${typeof title === 'string' && title.trim() ? title.trim().slice(0, 150) : null}, title),
          description = COALESCE(${typeof description === 'string' ? description : null}, description),
          category = COALESCE(${typeof category === 'string' && category.trim() ? category.trim() : null}, category),
          tags = COALESCE(${Array.isArray(tags) ? tags : null}, tags),
          content_rating = COALESCE(${typeof contentRating === 'string' && contentRating !== 'auto' ? contentRating : null}, content_rating),
          user_selected_rating = COALESCE(${typeof contentRating === 'string' ? contentRating : null}, user_selected_rating),
          source_cache = NULL,
          source_cache_expires_at = 0,
          updated_at = NOW()
      WHERE id = ${id} AND (${admin} OR user_id = ${userId})
      RETURNING id, thumbnail_url, thumbnail_status, thumbnail_options;
    `;

    return NextResponse.json({
      success: true,
      videoId: id,
      thumbnailUrl: updated[0]?.thumbnail_url || '',
      thumbnailStatus: updated[0]?.thumbnail_status || 'waiting',
      thumbnailOptions: updated[0]?.thumbnail_options || [],
    });
  } catch (err) {
    console.error('[PATCH_VIDEO_ERROR]:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
