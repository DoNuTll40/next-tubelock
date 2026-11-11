import { getSessionUserId, isAdmin, accessError } from '@/lib/access';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { encodeVideoSlug } from '@/lib/videoUtils';

/**
 * GET /api/videos/[id]/status
 * Lightweight real-time polling endpoint for video transcoding & AI workflows lifecycle
 */
export async function GET(request, context) {
  try {
    const { id } = await context.params;
    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Video ID is required' },
        { status: 400 }
      );
    }

    const sql = getDb();
    const userId = await getSessionUserId(sql);
    if (userId == null) return accessError(401);
    const rows = await sql`
      SELECT *
      FROM videos 
      WHERE id = ${id} AND (${isAdmin(userId)} OR user_id = ${userId})
      LIMIT 1;
    `;

    if (!rows || rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Video not found' },
        { status: 404 }
      );
    }

    const video = rows[0];

    const parseJsonSafe = (val) => {
      if (!val) return null;
      if (typeof val === 'object') return val;
      try {
        return JSON.parse(val);
      } catch (_) {
        return null;
      }
    };

    return NextResponse.json({
      success: true,
      video: {
        id: video.id,
        title: video.title,
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
        fileSizeBytes: video.file_size_bytes || 0,
        runnerSpecs: parseJsonSafe(video.runner_specs),
        // AI Workflows Real-time Fields
        audioStatus: video.audio_status || 'waiting',
        subtitleStatus: video.subtitle_status || 'waiting',
        subtitleSrt: video.subtitle_srt || '',
        subtitleVtt: video.subtitle_vtt || '',
        subtitleModel: video.subtitle_model || '',
        spriteStatus: video.sprite_status || 'waiting',
        spritePreviewUrl: video.sprite_preview_url || '',
        contentRating: video.content_rating || 'all',
        userSelectedRating: video.user_selected_rating || 'all',
        aiSuggestedRating: video.ai_suggested_rating || '',
        ratingCheckStatus: video.rating_check_status || 'pending',
        visionAnalysis: parseJsonSafe(video.vision_analysis),
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
