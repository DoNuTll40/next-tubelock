import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

/**
 * GET /api/videos/[id]/status
 * Lightweight real-time polling endpoint for video transcoding lifecycle
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
    const rows = await sql`
      SELECT 
        id, 
        title, 
        status, 
        transcode_progress, 
        stage_detail, 
        error_message, 
        raw_file_name, 
        master_playlist_path,
        onedrive_folder_id,
        duration, 
        resolution, 
        thumbnail_url,
        file_size_bytes,
        created_at, 
        updated_at
      FROM videos 
      WHERE id = ${id} 
      LIMIT 1;
    `;

    if (!rows || rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Video not found' },
        { status: 404 }
      );
    }

    const video = rows[0];

    return NextResponse.json({
      success: true,
      video: {
        id: video.id,
        title: video.title,
        status: video.status || 'READY',
        transcodeProgress: video.transcode_progress || 0,
        stageDetail: video.stage_detail || '',
        errorMessage: video.error_message || '',
        rawFileName: video.raw_file_name || '',
        masterPlaylistPath: video.master_playlist_path || '',
        onedriveFolderId: video.onedrive_folder_id || '',
        duration: video.duration || 0,
        resolution: video.resolution || '1080p',
        thumbnailUrl: video.thumbnail_url || '',
        fileSizeBytes: video.file_size_bytes || 0,
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
