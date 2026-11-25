import { apiError } from '@/lib/apiError';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSessionUserId, isAdmin, accessError } from '@/lib/access';
import { decodeVideoSlug } from '@/lib/videoUtils';
import { getGraphToken, getUserDriveId } from '@/lib/onedriveServer';
import { invalidateVideoCaches } from '@/lib/videoSourceService';
import { normalizeSubtitleTracks } from '@/lib/videoEditorUtils';
import {
  ensureVideoVersionsSchema,
  formatVersionSummary,
  slugifyVersionKey,
  setDefaultVideoVersion,
} from '@/lib/videoVersions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/videos/[id]/versions/[versionId]
 */
export async function GET(_request, context) {
  try {
    const { id: rawId, versionId: rawVerId } = await context.params;
    const videoId = decodeVideoSlug(rawId) || parseInt(rawId, 10);
    const versionId = parseInt(rawVerId, 10);
    if (!videoId || Number.isNaN(videoId) || !versionId || Number.isNaN(versionId)) {
      return NextResponse.json({ success: false, error: 'Invalid videoId or versionId' }, { status: 400 });
    }

    const sql = getDb();
    await ensureVideoVersionsSchema(sql);
    const rows = await sql`
      SELECT vv.*, v.user_id AS owner_user_id
      FROM video_versions vv
      JOIN videos v ON v.id = vv.video_id
      WHERE vv.id = ${versionId} AND vv.video_id = ${videoId}
      LIMIT 1;
    `;
    if (!rows.length) {
      return NextResponse.json({ success: false, error: 'Version not found' }, { status: 404 });
    }

    const row = rows[0];
    if (row.status && row.status !== 'READY') {
      const userId = await getSessionUserId(sql);
      if (userId == null || (!isAdmin(userId) && row.owner_user_id !== userId)) {
        return accessError(404);
      }
    }

    return NextResponse.json({
      success: true,
      version: {
        ...formatVersionSummary(row),
        workerLogs: Array.isArray(row.worker_logs) ? row.worker_logs : [],
      },
    });
  } catch (err) {
    return apiError(err, { context: 'GET /api/videos/[id]/versions/[versionId]' });
  }
}

/**
 * PATCH /api/videos/[id]/versions/[versionId]
 * Update label, badge, aspectLabel, description, sortOrder, isDefault, or per-version subtitle override.
 */
export async function PATCH(request, context) {
  try {
    const { id: rawId, versionId: rawVerId } = await context.params;
    const videoId = decodeVideoSlug(rawId) || parseInt(rawId, 10);
    const versionId = parseInt(rawVerId, 10);
    if (!videoId || Number.isNaN(videoId) || !versionId || Number.isNaN(versionId)) {
      return NextResponse.json({ success: false, error: 'Invalid videoId or versionId' }, { status: 400 });
    }

    const sql = getDb();
    const userId = await getSessionUserId(sql);
    if (userId == null) return accessError(401);
    const admin = isAdmin(userId);
    await ensureVideoVersionsSchema(sql);

    const existingRows = await sql`
      SELECT vv.id, vv.version_key, vv.status, v.user_id
      FROM video_versions vv
      JOIN videos v ON v.id = vv.video_id
      WHERE vv.id = ${versionId} AND vv.video_id = ${videoId} AND (${admin} OR v.user_id = ${userId})
      LIMIT 1;
    `;
    if (!existingRows.length) return accessError(404);

    const body = await request.json();
    const {
      label,
      versionKey,
      badge,
      aspectLabel,
      description,
      sortOrder,
      isDefault,
      subtitleTracksOverride,
      resetSubtitleOverride = false,
    } = body || {};

    let nextKey = null;
    if (typeof versionKey === 'string' && versionKey.trim()) {
      const siblingRows = await sql`
        SELECT version_key FROM video_versions
        WHERE video_id = ${videoId} AND id <> ${versionId};
      `;
      nextKey = slugifyVersionKey(
        versionKey,
        siblingRows.map((r) => r.version_key)
      );
    }

    const nextLabel = typeof label === 'string' && label.trim() ? label.trim().slice(0, 80) : null;
    const nextBadge = typeof badge === 'string' ? badge.trim().slice(0, 32) : null;
    const nextAspect = typeof aspectLabel === 'string' ? aspectLabel.trim().slice(0, 24) : null;
    const nextDesc = typeof description === 'string' ? description.trim().slice(0, 400) : null;
    const nextSort = Number.isFinite(Number(sortOrder)) ? Math.round(Number(sortOrder)) : null;

    let hasSubOverrideUpdate = false;
    let nextSubOverrideJson = null;
    if (resetSubtitleOverride) {
      hasSubOverrideUpdate = true;
      nextSubOverrideJson = null;
    } else if (Array.isArray(subtitleTracksOverride)) {
      hasSubOverrideUpdate = true;
      const normalized = normalizeSubtitleTracks(subtitleTracksOverride);
      nextSubOverrideJson = normalized.length > 0 ? JSON.stringify(normalized) : null;
    }

    await sql`
      UPDATE video_versions
      SET
        label = COALESCE(${nextLabel}, label),
        version_key = COALESCE(${nextKey}, version_key),
        badge = COALESCE(${nextBadge}, badge),
        aspect_label = COALESCE(${nextAspect}, aspect_label),
        description = COALESCE(${nextDesc}, description),
        sort_order = COALESCE(${nextSort}, sort_order),
        subtitle_tracks_override = CASE
          WHEN ${hasSubOverrideUpdate} THEN ${nextSubOverrideJson}::jsonb
          ELSE subtitle_tracks_override
        END,
        updated_at = NOW()
      WHERE id = ${versionId} AND video_id = ${videoId};
    `;

    if (isDefault === true) {
      if (existingRows[0].status && existingRows[0].status !== 'READY') {
        return NextResponse.json(
          { success: false, error: 'ต้องรอให้เวอร์ชันนี้แปลงเสร็จ (READY) ก่อนตั้งเป็นเวอร์ชันเริ่มต้น' },
          { status: 400 }
        );
      }
      await setDefaultVideoVersion(sql, videoId, versionId);
    }

    invalidateVideoCaches(videoId, versionId);

    const updated = await sql`
      SELECT * FROM video_versions WHERE id = ${versionId} AND video_id = ${videoId} LIMIT 1;
    `;

    return NextResponse.json({
      success: true,
      version: formatVersionSummary(updated[0]),
    });
  } catch (err) {
    return apiError(err, { context: 'PATCH /api/videos/[id]/versions/[versionId]' });
  }
}

/**
 * DELETE /api/videos/[id]/versions/[versionId]
 * Removes one version (keeps the parent video intact as long as at least 1 other version remains).
 */
export async function DELETE(_request, context) {
  try {
    const { id: rawId, versionId: rawVerId } = await context.params;
    const videoId = decodeVideoSlug(rawId) || parseInt(rawId, 10);
    const versionId = parseInt(rawVerId, 10);
    if (!videoId || Number.isNaN(videoId) || !versionId || Number.isNaN(versionId)) {
      return NextResponse.json({ success: false, error: 'Invalid videoId or versionId' }, { status: 400 });
    }

    const sql = getDb();
    const userId = await getSessionUserId(sql);
    if (userId == null) return accessError(401);
    const admin = isAdmin(userId);
    await ensureVideoVersionsSchema(sql);

    const allVersions = await sql`
      SELECT vv.*, v.user_id AS owner_user_id, v.onedrive_folder_id AS parent_folder_id
      FROM video_versions vv
      JOIN videos v ON v.id = vv.video_id
      WHERE vv.video_id = ${videoId}
      ORDER BY vv.sort_order ASC, vv.id ASC;
    `;

    if (!allVersions.length) return accessError(404);
    if (!admin && allVersions[0].owner_user_id !== userId) return accessError(403);

    const target = allVersions.find((v) => Number(v.id) === versionId);
    if (!target) return accessError(404);

    if (allVersions.length <= 1) {
      return NextResponse.json(
        { success: false, error: 'ไม่สามารถลบเวอร์ชันสุดท้ายได้ หากต้องการลบทั้งวิดีโอให้ใช้เมนูลบวิดีโอหลัก' },
        { status: 400 }
      );
    }

    // Best-effort OneDrive cleanup for this version's folder/raw file
    try {
      const token = await getGraphToken();
      const driveId = await getUserDriveId(token);
      const isSharedWithParent = Boolean(
        target.onedrive_folder_id && target.onedrive_folder_id === target.parent_folder_id
      );

      const tasks = [];
      if (!isSharedWithParent) {
        tasks.push(
          fetch(
            `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/streams/stream_vid_${videoId}_v${versionId}`,
            { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
          ).catch(() => {})
        );
        if (target.onedrive_folder_id) {
          tasks.push(
            fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${target.onedrive_folder_id}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${token}` },
            }).catch(() => {})
          );
        }
      }
      if (target.raw_file_name) {
        tasks.push(
          fetch(
            `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/raw/${encodeURIComponent(target.raw_file_name)}`,
            { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
          ).catch(() => {})
        );
      }
      await Promise.all(tasks);
    } catch (odErr) {
      console.warn('[Delete Version OneDrive Warning]:', odErr.message);
    }

    await sql`DELETE FROM video_versions WHERE id = ${versionId} AND video_id = ${videoId};`;

    const remaining = allVersions.filter((v) => Number(v.id) !== versionId);
    if (target.is_default && remaining.length > 0) {
      const nextDefault = remaining.find((v) => v.status === 'READY') || remaining[0];
      await setDefaultVideoVersion(sql, videoId, nextDefault.id);
    }

    invalidateVideoCaches(videoId);

    return NextResponse.json({
      success: true,
      videoId,
      deletedVersionId: versionId,
      remainingVersions: remaining.map(formatVersionSummary),
    });
  } catch (err) {
    return apiError(err, { context: 'DELETE /api/videos/[id]/versions/[versionId]' });
  }
}
