import { apiError } from '@/lib/apiError';
import { validateSavedDescription } from '@/lib/descriptionDocument.mjs';
import { descriptionImageFolder } from '@/lib/descriptionImageService.mjs';
import { protectVideoPoster, decodeVideoSlug } from '@/lib/videoUtils';
import { getSessionUserId, isAdmin, accessError } from '@/lib/access';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGraphToken, getUserDriveId, ensureFolderExists } from '@/lib/onedriveServer';
import { ensureSourceCacheColumns, invalidateVideoCaches } from '@/lib/videoSourceService';
import { normalizeSubtitleTracks } from '@/lib/videoEditorUtils';
import { normalizeVideoLanguageCode } from '@/lib/videoLanguages';
import { EVALUATED_RATING_STATUSES } from '@/lib/ratingStatus';
import { canViewVideo, normalizeVideoVisibility } from '@/lib/videoVisibility';
import {
  getVideoVersions,
  formatVersionSummary,
  resolveRequestedVersion,
} from '@/lib/videoVersions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/videos/[id]
 * Lightning-fast metadata retrieval (<50ms) for instant UI rendering
 */
export async function GET(request, context) {
  const t0 = performance.now();
  try {
    const { id: rawId } = await context.params;
    const numericId = decodeVideoSlug(rawId) || parseInt(rawId, 10);
    const id = numericId;
    if (!id || isNaN(id)) {
      return NextResponse.json({ success: false, error: 'Video ID is required' }, { status: 400 });
    }

    const searchParams = new URL(request.url).searchParams;
    const requestedVersion = searchParams.get('v') || searchParams.get('versionId') || null;
    const includeAllVersions = searchParams.get('includeVersions') === 'all';

    const sql = getDb();
    let allowAllVersions = false;
    if (includeAllVersions) {
      const uid = await getSessionUserId(sql);
      allowAllVersions = Boolean(uid);
    }

    const [rows, rawVersions] = await Promise.all([
      sql`
        SELECT 
          v.id, v.title, v.description, v.duration, v.file_size_bytes, v.resolution, v.fps, v.codec,
          v.thumbnail_url, v.tags, v.category, v.views_count, v.created_at, v.status, 
          v.transcode_progress, v.stage_detail, v.error_message, v.source_type,
          v.onedrive_item_id, v.onedrive_folder_id, v.raw_file_name, v.master_playlist_path,
          v.subtitle_status,
          CASE WHEN jsonb_array_length(COALESCE(v.subtitle_tracks, '[]'::jsonb)) > 0 THEN '' ELSE COALESCE(v.subtitle_srt, '') END AS subtitle_srt,
          CASE WHEN jsonb_array_length(COALESCE(v.subtitle_tracks, '[]'::jsonb)) > 0 THEN '' ELSE COALESCE(v.subtitle_vtt, '') END AS subtitle_vtt,
          v.subtitle_tracks, v.content_rating,
          v.user_id, COALESCE(v.visibility, 'public') AS visibility,
          to_jsonb(v)->'ready_qualities' AS ready_qualities,
          (to_jsonb(v)->>'audio_channels')::int AS audio_channels,
          to_jsonb(v)->'vision_analysis' AS vision_analysis,
          u.name AS author_name,
          u.picture AS author_picture,
          u.handle AS author_handle
        FROM videos v
        LEFT JOIN users u ON v.user_id = u.id
        WHERE v.id = ${id} AND (v.status = 'READY' OR v.status IS NULL)
        LIMIT 1;
      `,
      getVideoVersions(sql, id, { readyOnly: !allowAllVersions }),
    ]);
    if (!rows || rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Video not found' }, { status: 404 });
    }

    const baseVideo = rows[0];
    const viewerUserId = await getSessionUserId(sql);
    const viewerIsAdmin = viewerUserId != null && isAdmin(viewerUserId);
    if (!canViewVideo(baseVideo, viewerUserId, viewerIsAdmin)) {
      return NextResponse.json({ success: false, error: 'วิดีโอนี้ตั้งค่าเป็นส่วนตัว' }, { status: 403 });
    }
    const isOwnerOrAdmin = allowAllVersions
      ? Boolean(viewerUserId != null && (viewerIsAdmin || baseVideo.user_id === viewerUserId))
      : false;
    const visibleVersions = isOwnerOrAdmin
      ? rawVersions
      : rawVersions.filter((v) => !v.status || v.status === 'READY');
    const versions = visibleVersions.map(formatVersionSummary);
    const activeVersion = resolveRequestedVersion(visibleVersions, requestedVersion);
    const activeVersionSummary = activeVersion ? formatVersionSummary(activeVersion) : null;

    const mergedVideo = activeVersion
      ? {
          ...baseVideo,
          duration: Number(activeVersion.duration) || baseVideo.duration,
          file_size_bytes: Number(activeVersion.file_size_bytes) || baseVideo.file_size_bytes,
          resolution: activeVersion.resolution || baseVideo.resolution,
          fps: activeVersion.fps ?? baseVideo.fps,
          codec: activeVersion.codec || baseVideo.codec,
          audio_channels: activeVersion.audio_channels ?? baseVideo.audio_channels ?? null,
          ready_qualities:
            Array.isArray(activeVersion.ready_qualities) && activeVersion.ready_qualities.length > 0
              ? activeVersion.ready_qualities
              : baseVideo.ready_qualities ?? null,
          source_type: activeVersion.source_type || baseVideo.source_type,
          onedrive_item_id: activeVersion.onedrive_item_id || baseVideo.onedrive_item_id,
          onedrive_folder_id: activeVersion.onedrive_folder_id || baseVideo.onedrive_folder_id,
          master_playlist_path: activeVersion.master_playlist_path || baseVideo.master_playlist_path,
          ...(Array.isArray(activeVersion.subtitle_tracks_override) &&
          activeVersion.subtitle_tracks_override.length > 0
            ? { subtitle_tracks: activeVersion.subtitle_tracks_override }
            : {}),
          versions,
          active_version: activeVersionSummary,
        }
      : {
          ...baseVideo,
          versions: [],
          active_version: null,
        };

    return NextResponse.json(
      { success: true, video: protectVideoPoster(mergedVideo) },
      {
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Server-Timing': `total;dur=${(performance.now() - t0).toFixed(1)}`,
        },
      }
    );
  } catch (err) {
    return apiError(err, { context: 'GET /api/videos/[id]' });
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

    // 1. Fetch video & version details first to clean up OneDrive assets
    const [rows, versionRows] = await Promise.all([
      sql`
        SELECT id, raw_file_name, onedrive_folder_id, onedrive_item_id, title 
        FROM videos 
        WHERE id = ${id} AND (${admin} OR user_id = ${userId})
        LIMIT 1;
      `,
      getVideoVersions(sql, id),
    ]);

    if (!rows.length) return accessError(404);

    {
      const vid = rows[0];

      // 2. Best-effort cleanup of OneDrive files/folders (parent + all versions)
      try {
        const token = await getGraphToken();
        const driveId = await getUserDriveId(token);

        const deleteFolderByPath = async (folderName) => {
          try {
            await fetch(
              `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/streams/${encodeURIComponent(folderName)}`,
              {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
              }
            );
          } catch (_) {}
        };

        const deleteItemById = async (itemId) => {
          if (!itemId) return;
          try {
            await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${token}` },
            });
          } catch (_) {}
        };

        const deleteRawFile = async (rawName) => {
          if (!rawName) return;
          try {
            await fetch(
              `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/raw/${encodeURIComponent(rawName)}`,
              {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
              }
            );
          } catch (_) {}
        };

        const cleanupTasks = [
          fetch(`https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/root:${descriptionImageFolder(id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }),
          deleteFolderByPath(`stream_vid_${id}`),
          deleteItemById(vid.onedrive_folder_id),
          vid.onedrive_item_id !== vid.onedrive_folder_id ? deleteItemById(vid.onedrive_item_id) : null,
          deleteRawFile(vid.raw_file_name),
        ];

        for (const vv of versionRows || []) {
          cleanupTasks.push(deleteFolderByPath(`stream_vid_${id}_v${vv.id}`));
          if (vv.onedrive_folder_id && vv.onedrive_folder_id !== vid.onedrive_folder_id) {
            cleanupTasks.push(deleteItemById(vv.onedrive_folder_id));
          }
          if (vv.onedrive_item_id && vv.onedrive_item_id !== vv.onedrive_folder_id && vv.onedrive_item_id !== vid.onedrive_item_id) {
            cleanupTasks.push(deleteItemById(vv.onedrive_item_id));
          }
          if (vv.raw_file_name && vv.raw_file_name !== vid.raw_file_name) {
            cleanupTasks.push(deleteRawFile(vv.raw_file_name));
          }
        }

        await Promise.all(cleanupTasks.filter(Boolean));
      } catch (graphErr) {
        console.warn('[Cleanup OneDrive Warning]:', graphErr.message);
      }
    }

    // 3. Delete record completely from Neon DB and invalidate caches
    await sql`DELETE FROM videos WHERE id = ${id} AND (${admin} OR user_id = ${userId});`;
    invalidateVideoCaches(id);

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
    return apiError(err, { context: 'DELETE /api/videos/[id]' });
  }
}

const DATA_IMAGE_RE = /^data:(image\/(?:jpe?g|png|webp));base64,(.+)$/i;

async function uploadBufferToStreamFolder(token, driveId, folderId, fileName, buffer, contentType) {
  await fetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${encodeURIComponent(folderId)}:/${encodeURIComponent(fileName)}:/content`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': contentType,
        'Content-Length': String(buffer.length),
      },
      body: buffer,
    }
  );
}

/**
 * PATCH /api/videos/[id]
 * Updates thumbnail, metadata, rating, and subtitle tracks for the video owner/admin
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
      await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS subtitle_status VARCHAR(50) DEFAULT 'waiting';`;
      await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS subtitle_srt TEXT DEFAULT '';`;
      await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS subtitle_vtt TEXT DEFAULT '';`;
      await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS subtitle_tracks JSONB DEFAULT '[]'::jsonb;`;
      await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS source_language VARCHAR(20) DEFAULT '';`;
      await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS user_selected_rating VARCHAR(50) DEFAULT 'all';`;
      await ensureSourceCacheColumns(sql);
    } catch (_) {}

    const existing = await sql`
      SELECT id, onedrive_folder_id, thumbnail_url, thumbnail_status
      FROM videos
      WHERE id = ${id} AND (${admin} OR user_id = ${userId})
      LIMIT 1;
    `;
    if (!existing.length) return accessError(404);

    const body = await request.json();
    const {
      thumbnailUrl,
      thumbnailOptions,
      title,
      description,
      sourceLanguage,
      category,
      tags,
      contentRating,
      subtitleTracks,
      subtitleSrt,
      subtitleVtt,
    } = body || {};

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

    let hasSubtitleUpdate = false;
    let normalizedSubTracks = [];
    let nextSubSrt = null;
    let nextSubVtt = null;
    let nextSubStatus = null;

    if (Array.isArray(subtitleTracks) || typeof subtitleSrt === 'string' || typeof subtitleVtt === 'string') {
      hasSubtitleUpdate = true;
      normalizedSubTracks = Array.isArray(subtitleTracks)
        ? normalizeSubtitleTracks(subtitleTracks)
        : normalizeSubtitleTracks(null, subtitleSrt || '', subtitleVtt || '');

      const primaryTrack =
        normalizedSubTracks.find((t) => t.id === 'th' || t.lang === 'th') ||
        normalizedSubTracks[0] ||
        null;
      nextSubSrt = primaryTrack ? primaryTrack.srt : '';
      nextSubVtt = primaryTrack ? primaryTrack.vtt : '';
      nextSubStatus = normalizedSubTracks.length > 0 ? 'ready' : 'waiting';
    }

    const sanitizedTitle = typeof title === 'string' && title.trim() ? title.trim().slice(0, 150) : null;
    let sanitizedDesc = null;
    if (description !== undefined) {
      try { sanitizedDesc = validateSavedDescription(description, id); }
      catch (error) { return NextResponse.json({ success: false, error: error.message }, { status: 400 }); }
    }
    const hasSourceLanguageUpdate = typeof sourceLanguage === 'string';
    const sanitizedSourceLanguage = hasSourceLanguageUpdate ? normalizeVideoLanguageCode(sourceLanguage) : null;
    const sanitizedCategory = typeof category === 'string' && category.trim() ? category.trim().slice(0, 100) : null;
    const sanitizedTags = Array.isArray(tags)
      ? tags.map((t) => String(t || '').trim().replace(/^[#,]+/, '')).filter(Boolean).slice(0, 15)
      : null;
    const sanitizedRating = typeof contentRating === 'string' ? contentRating.trim() : null;

    // Best-effort sync of custom/selected poster.jpg & subtitles to OneDrive
    let syncedFolderId = existing[0].onedrive_folder_id || '';
    const shouldSyncOneDrive = Boolean(decodedImageBuffer || (hasSubtitleUpdate && normalizedSubTracks.length > 0));
    if (shouldSyncOneDrive) {
      try {
        const token = await getGraphToken();
        const driveId = await getUserDriveId(token);
        const folderId = syncedFolderId || (await ensureFolderExists(token, driveId, `/streams/stream_vid_${id}`));
        if (folderId) {
          syncedFolderId = folderId;
          const uploads = [];
          if (decodedImageBuffer) {
            uploads.push(uploadBufferToStreamFolder(token, driveId, folderId, 'poster.jpg', decodedImageBuffer, decodedContentType));
          }
          if (hasSubtitleUpdate && normalizedSubTracks.length > 0) {
            uploads.push(
              uploadBufferToStreamFolder(token, driveId, folderId, 'subtitles.srt', Buffer.from(nextSubSrt, 'utf8'), 'text/plain; charset=utf-8'),
              uploadBufferToStreamFolder(token, driveId, folderId, 'subtitles.vtt', Buffer.from(nextSubVtt, 'utf8'), 'text/vtt; charset=utf-8')
            );
            const origTrack = normalizedSubTracks.find((t) => t.id === 'orig' || (t.lang && t.lang !== 'th' && t.id !== 'th'));
            if (origTrack) {
              uploads.push(
                uploadBufferToStreamFolder(token, driveId, folderId, 'subtitles_original.srt', Buffer.from(origTrack.srt, 'utf8'), 'text/plain; charset=utf-8'),
                uploadBufferToStreamFolder(token, driveId, folderId, 'subtitles_original.vtt', Buffer.from(origTrack.vtt, 'utf8'), 'text/vtt; charset=utf-8')
              );
            }
          }
          await Promise.all(uploads);
        }
      } catch (odErr) {
        console.warn('[PATCH OneDrive Sync Warning]:', odErr.message);
      }
    }

    const sanitizedVisibility =
      body.visibility !== undefined ? normalizeVideoVisibility(body.visibility, null) : null;

    const updated = await sql`
      UPDATE videos v
      SET thumbnail_url = COALESCE(${validThumbUrl}, thumbnail_url),
          thumbnail_options = COALESCE(${validOptions ? JSON.stringify(validOptions) : null}::jsonb, thumbnail_options),
          thumbnail_status = CASE WHEN ${Boolean(validOptions)} THEN 'ready' ELSE thumbnail_status END,
          onedrive_folder_id = COALESCE(NULLIF(${syncedFolderId}, ''), onedrive_folder_id),
          title = COALESCE(${sanitizedTitle}, title),
          description = COALESCE(${sanitizedDesc}, description),
          source_language = CASE WHEN ${hasSourceLanguageUpdate} THEN ${sanitizedSourceLanguage || ''} ELSE source_language END,
          category = COALESCE(${sanitizedCategory}, category),
          tags = COALESCE(${sanitizedTags}, tags),
          visibility = COALESCE(${sanitizedVisibility}, visibility),
          content_rating = CASE
            WHEN to_jsonb(v)->>'rating_check_status' = ANY(${EVALUATED_RATING_STATUSES}::text[]) THEN content_rating
            ELSE COALESCE(${sanitizedRating && sanitizedRating !== 'auto' ? sanitizedRating : null}, content_rating) END,
          user_selected_rating = CASE
            WHEN to_jsonb(v)->>'rating_check_status' = ANY(${EVALUATED_RATING_STATUSES}::text[]) THEN user_selected_rating
            ELSE COALESCE(${sanitizedRating}, user_selected_rating) END,
          subtitle_status = COALESCE(${nextSubStatus}, subtitle_status),
          subtitle_srt = CASE WHEN ${hasSubtitleUpdate} THEN ${nextSubSrt || ''} ELSE subtitle_srt END,
          subtitle_vtt = CASE WHEN ${hasSubtitleUpdate} THEN ${nextSubVtt || ''} ELSE subtitle_vtt END,
          subtitle_tracks = CASE WHEN ${hasSubtitleUpdate} THEN ${JSON.stringify(normalizedSubTracks)}::jsonb ELSE subtitle_tracks END,
          source_cache = NULL,
          source_cache_br = NULL,
          source_cache_items_count = 0,
          source_cache_expires_at = 0,
          updated_at = NOW()
      WHERE id = ${id} AND (${admin} OR user_id = ${userId})
      RETURNING
        id, title, description, source_language, category, tags, visibility, content_rating, user_selected_rating,
        thumbnail_url, thumbnail_status, thumbnail_options,
        subtitle_status, subtitle_srt, subtitle_vtt, subtitle_tracks, updated_at;
    `;

    invalidateVideoCaches(id);

    const row = updated[0] || {};
    return NextResponse.json({
      success: true,
      videoId: id,
      thumbnailUrl: row.thumbnail_url || '',
      thumbnailStatus: row.thumbnail_status || 'waiting',
      thumbnailOptions: row.thumbnail_options || [],
      video: {
        id: row.id,
        title: row.title || '',
        description: row.description || '',
        sourceLanguage: row.source_language || '',
        category: row.category || 'general',
        tags: row.tags || [],
        visibility: row.visibility || 'public',
        contentRating: row.content_rating || 'all',
        userSelectedRating: row.user_selected_rating || 'all',
        thumbnailUrl: row.thumbnail_url || '',
        thumbnailStatus: row.thumbnail_status || 'waiting',
        thumbnailOptions: row.thumbnail_options || [],
        subtitleStatus: row.subtitle_status || 'waiting',
        subtitleSrt: row.subtitle_srt || '',
        subtitleVtt: row.subtitle_vtt || '',
        subtitleTracks: row.subtitle_tracks || [],
        updatedAt: row.updated_at,
      },
    });
  } catch (err) {
    return apiError(err, { context: 'PATCH /api/videos/[id]' });
  }
}
