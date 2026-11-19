import { getGraphToken, getUserDriveId } from '@/lib/onedriveServer';
import { getSessionUserId, isAdmin, accessError } from '@/lib/access';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { reconcileSubtitleWorkflow } from '@/lib/subtitleWorkflow';
import { decodeVideoSlug, encodeVideoSlug } from '@/lib/videoUtils';
import { getVideoVersions, formatVersionSummary } from '@/lib/videoVersions';

/**
 * GET /api/videos/[id]/status
 * Lightweight real-time polling endpoint for video transcoding & AI workflows lifecycle
 */
export async function GET(request, context) {
  try {
    const { id: rawId } = await context.params;
    const id = decodeVideoSlug(rawId) || parseInt(rawId, 10);
    if (!id || isNaN(id)) {
      return NextResponse.json(
        { success: false, error: 'Video ID is required' },
        { status: 400 }
      );
    }

    const sql = getDb();
    const userId = await getSessionUserId(sql);
    if (userId == null) return accessError(401);
    const query = new URL(request.url).searchParams;
    const rawVersionId = query.get('versionId');
    const requestedVersionId = rawVersionId && /^\d+$/.test(rawVersionId) ? Number(rawVersionId) : null;

    if (requestedVersionId) {
      const verRows = await sql`
        SELECT
          vv.id AS version_id, vv.video_id, vv.version_key, vv.label, vv.badge,
          vv.aspect_label, vv.description, vv.is_default, vv.status, vv.transcode_progress,
          vv.stage_detail, vv.error_message, vv.raw_file_name, vv.master_playlist_path,
          vv.onedrive_folder_id, vv.duration, vv.resolution, vv.fps, vv.codec, vv.bitrate,
          vv.thumbnail_url, vv.file_size_bytes, vv.runner_specs, vv.worker_logs,
          vv.created_at, vv.updated_at,
          md5(COALESCE(vv.worker_logs, '[]'::jsonb)::text) AS logs_revision,
          v.title, v.category, v.user_id
        FROM video_versions vv
        JOIN videos v ON v.id = vv.video_id
        WHERE vv.id = ${requestedVersionId}
          AND vv.video_id = ${id}
          AND (${isAdmin(userId)} OR v.user_id = ${userId})
        LIMIT 1;
      `;

      if (!verRows.length) {
        return NextResponse.json({ success: false, error: 'Version not found' }, { status: 404 });
      }

      const ver = verRows[0];
      return NextResponse.json({
        success: true,
        revisions: {
          logs: ver.logs_revision,
        },
        version: {
          ...formatVersionSummary({ ...ver, id: ver.version_id }),
          runnerSpecs: ver.runner_specs || null,
          workerLogs: query.get('logsRevision') === ver.logs_revision
            ? undefined
            : (Array.isArray(ver.worker_logs) ? ver.worker_logs : []),
          title: ver.title || '',
          slug: encodeVideoSlug(ver.video_id, ver.category) || String(ver.video_id),
        },
      });
    }

    const rows = await sql`
      SELECT
        id, title, description, tags, category, status, transcode_progress, stage_detail,
        error_message, raw_file_name, master_playlist_path, onedrive_folder_id, duration,
        resolution, fps, codec, bitrate, thumbnail_url, file_size_bytes, created_at, updated_at,
        extras.metadata - ARRAY['subtitle_srt', 'subtitle_vtt', 'subtitle_tracks', 'worker_logs', 'thumbnail_options', 'vision_analysis', 'sprite_preview_url'] AS metadata,
        CASE WHEN revisions.subtitles <> ${query.get('subtitlesRevision') || ''}
          THEN jsonb_build_object('subtitle_srt', extras.metadata->'subtitle_srt',
            'subtitle_vtt', extras.metadata->'subtitle_vtt', 'subtitle_tracks', extras.metadata->'subtitle_tracks')
        END AS subtitles,
        CASE WHEN revisions.logs <> ${query.get('logsRevision') || ''}
          THEN extras.metadata->'worker_logs' END AS worker_logs,
        CASE WHEN revisions.meta <> ${query.get('metaRevision') || ''}
          THEN jsonb_build_object('thumbnail_options', extras.metadata->'thumbnail_options',
            'vision_analysis', extras.metadata->'vision_analysis',
            'sprite_preview_url', extras.metadata->'sprite_preview_url')
        END AS meta_heavy,
        revisions.subtitles AS subtitles_revision,
        revisions.logs AS logs_revision,
        revisions.meta AS meta_revision
      FROM videos v
      CROSS JOIN LATERAL (
        SELECT to_jsonb(v) - ARRAY['source_cache', 'source_cache_br', 'source_cache_expires_at'] AS row_data
      ) d
      CROSS JOIN LATERAL (
        SELECT jsonb_object_agg(key, value) AS metadata
        FROM jsonb_each(d.row_data)
        WHERE key IN ('subtitle_srt', 'subtitle_vtt', 'subtitle_tracks', 'worker_logs',
          'thumbnail_status', 'thumbnail_options', 'runner_specs', 'audio_status',
          'subtitle_status', 'subtitle_model', 'subtitle_job_id', 'source_language', 'sprite_status', 'sprite_preview_url',
          'content_rating', 'user_selected_rating', 'ai_suggested_rating',
          'rating_check_status', 'vision_analysis')
      ) m
      CROSS JOIN LATERAL (SELECT COALESCE(m.metadata, '{}'::jsonb) AS metadata) extras
      CROSS JOIN LATERAL (
        SELECT
          md5(jsonb_build_array(extras.metadata->'subtitle_srt', extras.metadata->'subtitle_vtt',
            extras.metadata->'subtitle_tracks')::text) AS subtitles,
          md5(COALESCE(extras.metadata->'worker_logs', 'null'::jsonb)::text) AS logs,
          md5(jsonb_build_array(extras.metadata->'thumbnail_options',
            extras.metadata->'vision_analysis',
            extras.metadata->'sprite_preview_url')::text) AS meta
      ) revisions
      WHERE id = ${id} AND (${isAdmin(userId)} OR user_id = ${userId})
      LIMIT 1;
    `;

    if (!rows || rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Video not found' },
        { status: 404 }
      );
    }

    const row = rows[0];
    let video = { ...row, ...row.metadata, ...row.subtitles, ...row.meta_heavy };
    if (query.get('syncSubtitles') === '1') {
      try {
        video = await reconcileSubtitleWorkflow(sql, video);
      } catch (error) {
        console.warn('[Subtitle status sync]', error.message);
      }
    }

    let rawUploaded;
    if (query.get('restore') === '1' &&
        ['UPLOADING', 'FAILED'].includes(video.status) && video.raw_file_name) {
      const token = await getGraphToken();
      const drive = encodeURIComponent(await getUserDriveId(token));
      const name = encodeURIComponent(video.raw_file_name);
      const raw = await fetch(`https://graph.microsoft.com/v1.0/drives/${drive}/root:/raw/${name}?select=size`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (!raw.ok && raw.status !== 404) throw new Error('ตรวจสอบไฟล์ต้นทางบน OneDrive ไม่สำเร็จ');
      rawUploaded = raw.ok && Number((await raw.json()).size) === Number(video.file_size_bytes);
    }

    const parseJsonSafe = (val) => {
      if (!val) return null;
      if (typeof val === 'object') return val;
      try {
        return JSON.parse(val);
      } catch (_) {
        return null;
      }
    };

    const rawVersions = await getVideoVersions(sql, id, { readyOnly: false });

    return NextResponse.json({
      success: true,
      revisions: {
        subtitles: row.subtitles_revision,
        logs: row.logs_revision,
        meta: row.meta_revision,
      },
      versions: rawVersions.map(formatVersionSummary),
      video: {
        id: video.id,
        title: video.title,
        description: video.description || '',
        tags: video.tags || [],
        rawUploaded,
        category: video.category || 'general',
        slug: encodeVideoSlug(video.id, video.category) || String(video.id),
        status: video.status || 'READY',
        transcodeProgress: video.transcode_progress || 0,
        stageDetail: video.stage_detail || '',
        errorMessage: video.error_message || '',
        rawFileName: video.raw_file_name || '',
        masterPlaylistPath: video.master_playlist_path || '',
        onedriveFolderId: video.onedrive_folder_id || '',
        duration: video.duration || 0,
        resolution: video.resolution || '1080p',
        fps: video.fps || 0,
        codec: video.codec || '',
        bitrate: video.bitrate || 0,
        thumbnailUrl: video.thumbnail_url || '',
        thumbnailStatus: video.thumbnail_status || 'waiting',
        ...(row.meta_heavy && {
          thumbnailOptions: parseJsonSafe(video.thumbnail_options) || [],
          visionAnalysis: parseJsonSafe(video.vision_analysis),
          spritePreviewUrl: video.sprite_preview_url || '',
        }),
        fileSizeBytes: video.file_size_bytes || 0,
        runnerSpecs: parseJsonSafe(video.runner_specs),
        workerLogs: query.get('logsRevision') === row.logs_revision
          ? undefined : parseJsonSafe(video.worker_logs) || [],
        // AI Workflows Real-time Fields
        audioStatus: video.audio_status || 'waiting',
        subtitleStatus: video.subtitle_status || 'waiting',
        ...(row.subtitles && {
          subtitleSrt: video.subtitle_srt || '',
          subtitleVtt: video.subtitle_vtt || '',
          subtitleTracks: parseJsonSafe(video.subtitle_tracks) || [],
        }),
        subtitleModel: video.subtitle_model || '',
        sourceLanguage: video.source_language || '',
        spriteStatus: video.sprite_status || 'waiting',
        contentRating: video.content_rating || 'all',
        userSelectedRating: video.user_selected_rating || 'all',
        aiSuggestedRating: video.ai_suggested_rating || '',
        ratingCheckStatus: video.rating_check_status || 'pending',
        createdAt: video.created_at,
        updatedAt: video.updated_at,
      },
    });
  } catch (err) {
    console.error('[API_VIDEO_STATUS_ERROR]:', err);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
