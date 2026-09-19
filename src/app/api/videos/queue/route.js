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
    const rows = await sql`
      SELECT 
        id, 
        title, 
        status, 
        transcode_progress, 
        stage_detail, 
        error_message, 
        raw_file_name, 
        file_size_bytes, 
        created_at, 
        updated_at
      FROM videos 
      WHERE status IN ('UPLOADING', 'QUEUED', 'PROCESSING', 'TRANSCODING', 'FAILED')
      ORDER BY created_at DESC
      LIMIT 50;
    `;

    return NextResponse.json({
      success: true,
      queue: rows.map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        transcodeProgress: r.transcode_progress || 0,
        stageDetail: r.stage_detail || '',
        errorMessage: r.error_message || '',
        rawFileName: r.raw_file_name || '',
        fileSizeBytes: r.file_size_bytes || 0,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
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
