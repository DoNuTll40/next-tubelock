import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

/**
 * POST /api/hls/complete
 * Records a completed HLS package into Neon PostgreSQL DB
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const {
      folderId,
      title,
      description = '',
      duration = 0,
      file_size_bytes = 0,
      resolution = '1080p',
      fps = 30,
      codec = 'h264',
      thumbnail_url = '',
      tags = [],
    } = body;

    if (!folderId || !title) {
      return NextResponse.json(
        { success: false, error: 'folderId and title are required' },
        { status: 400 }
      );
    }

    const sql = getDb();

    const cleanTags = Array.isArray(tags) ? tags : ['HLS', resolution];
    if (!cleanTags.includes('HLS')) cleanTags.unshift('HLS');

    const rows = await sql`
      INSERT INTO videos (
        onedrive_folder_id, source_type, title, description, duration, 
        file_size_bytes, resolution, fps, codec, thumbnail_url, tags, updated_at
      ) VALUES (
        ${folderId}, 'hls', ${title.trim()}, ${description.trim()}, 
        ${Math.round(duration)}, ${file_size_bytes}, ${resolution}, 
        ${Math.round(fps)}, ${codec}, ${thumbnail_url}, 
        ${cleanTags}, NOW()
      )
      ON CONFLICT (onedrive_folder_id) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        thumbnail_url = CASE WHEN EXCLUDED.thumbnail_url <> '' THEN EXCLUDED.thumbnail_url ELSE videos.thumbnail_url END,
        duration = EXCLUDED.duration,
        resolution = EXCLUDED.resolution,
        fps = EXCLUDED.fps,
        codec = EXCLUDED.codec,
        tags = EXCLUDED.tags,
        file_size_bytes = EXCLUDED.file_size_bytes,
        updated_at = NOW()
      RETURNING *;
    `;

    const video = rows[0];

    return NextResponse.json({
      success: true,
      video,
      message: `บันทึกชุด HLS "${title}" เข้าคลังสื่อเรียบร้อยแล้ว`,
    });
  } catch (err) {
    console.error('[HLS Complete Error]:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'บันทึกข้อมูล HLS ล้มเหลว' },
      { status: 500 }
    );
  }
}
