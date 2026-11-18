import { getSessionUserId, isAdmin, accessError } from '@/lib/access';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/videos/queue
 * Returns videos currently in the transcoding lifecycle or recently failed
 */
export async function GET() {
  try {
    const sql = getDb();
    const userId = await getSessionUserId(sql);
    if (userId == null) return accessError(401);
    const [rows, versionQueueRows] = await Promise.all([
      sql`
        SELECT 
          id, 
          title, 
          status, 
          transcode_progress, 
          stage_detail, 
          error_message, 
          raw_file_name, 
          file_size_bytes, 
          category,
          created_at, 
          updated_at
        FROM videos 
        WHERE (${isAdmin(userId)} OR user_id = ${userId})
          AND (status IN ('UPLOADING', 'QUEUED', 'PROCESSING', 'TRANSCODING', 'FAILED')
           OR (status = 'READY' AND (transcode_progress IS NULL OR transcode_progress < 100)))
        ORDER BY created_at DESC
        LIMIT 50;
      `,
      sql`
        SELECT
          vv.id AS version_id,
          vv.video_id,
          vv.version_key,
          vv.label AS version_label,
          vv.badge AS version_badge,
          v.title,
          v.category,
          vv.status,
          vv.transcode_progress,
          vv.stage_detail,
          vv.error_message,
          vv.raw_file_name,
          vv.file_size_bytes,
          vv.created_at,
          vv.updated_at
        FROM video_versions vv
        JOIN videos v ON v.id = vv.video_id
        WHERE (${isAdmin(userId)} OR v.user_id = ${userId})
          AND (vv.status IN ('UPLOADING', 'QUEUED', 'PROCESSING', 'TRANSCODING', 'FAILED')
           OR (vv.status = 'READY' AND (vv.transcode_progress IS NULL OR vv.transcode_progress < 100)))
        ORDER BY vv.created_at DESC
        LIMIT 50;
      `.catch(() => []),
    ]);

    const videoItems = rows.map((r) => ({
      id: r.id,
      versionId: null,
      versionLabel: null,
      versionBadge: null,
      title: r.title,
      category: r.category || 'general',
      status: r.status,
      transcodeProgress: r.transcode_progress || 0,
      stageDetail: r.stage_detail || '',
      errorMessage: r.error_message || '',
      rawFileName: r.raw_file_name || '',
      fileSizeBytes: r.file_size_bytes || 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    const versionItems = (versionQueueRows || []).map((r) => ({
      id: r.video_id,
      versionId: r.version_id,
      versionKey: r.version_key,
      versionLabel: r.version_label,
      versionBadge: r.version_badge || '',
      title: `${r.title} (${r.version_label})`,
      category: r.category || 'general',
      status: r.status,
      transcodeProgress: r.transcode_progress || 0,
      stageDetail: r.stage_detail || '',
      errorMessage: r.error_message || '',
      rawFileName: r.raw_file_name || '',
      fileSizeBytes: r.file_size_bytes || 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    const mergedQueue = [...versionItems, ...videoItems]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 50);

    return NextResponse.json({
      success: true,
      queue: mergedQueue,
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      },
    });
  } catch (err) {
    console.error('[API_VIDEOS_QUEUE_ERROR]:', err);
    return NextResponse.json(
      { success: false, error: err.message, queue: [] },
      { status: 500 }
    );
  }
}
