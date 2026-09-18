import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { scanOneDriveVideos } from '@/lib/onedriveServer';

// Ensure the tables exist in the Neon database
async function ensureTables(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS videos (
      id SERIAL PRIMARY KEY,
      onedrive_item_id VARCHAR(255) UNIQUE,
      onedrive_folder_id VARCHAR(255) UNIQUE,
      source_type VARCHAR(50) NOT NULL DEFAULT 'file',
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      duration INTEGER DEFAULT 0,
      file_size_bytes BIGINT DEFAULT 0,
      resolution VARCHAR(50) DEFAULT '1080p',
      fps INTEGER DEFAULT 30,
      codec VARCHAR(50) DEFAULT 'h264',
      thumbnail_url TEXT DEFAULT '',
      tags TEXT[] DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
}

/**
 * POST /api/videos/sync
 * Scans OneDrive via Client Secret (no user login required!) and saves to Neon DB
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const sql = getDb();

    await ensureTables(sql);

    let videosToSync = [];
    let serverLogs = [];
    let totalScanned = 0;

    // If client provided explicit videos array
    if (Array.isArray(body.videos) && body.videos.length > 0) {
      videosToSync = body.videos;
      totalScanned = body.videos.length;
    } else {
      // Direct Server-Side Scan from OneDrive via Client Secret!
      const targetFolder = body.targetFolder || '/Videos';
      const scanResult = await scanOneDriveVideos(targetFolder);
      videosToSync = scanResult.scannedVideos;
      serverLogs = scanResult.logs;
      totalScanned = scanResult.totalItems;
    }

    let insertedCount = 0;

    for (const v of videosToSync) {
      if (v.source_type === 'hls' || v.onedrive_folder_id) {
        // Upsert HLS Video
        await sql`
          INSERT INTO videos (
            onedrive_folder_id, source_type, title, description, duration, 
            file_size_bytes, resolution, fps, codec, thumbnail_url, tags, updated_at
          ) VALUES (
            ${v.onedrive_folder_id}, 'hls', ${v.title}, ${v.description || ''}, 
            ${v.duration || 0}, ${v.file_size_bytes || 0}, ${v.resolution || '1080p'}, 
            ${v.fps || 30}, ${v.codec || 'h264'}, ${v.thumbnail_url || ''}, 
            ${v.tags || []}, NOW()
          )
          ON CONFLICT (onedrive_folder_id) DO UPDATE SET
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            thumbnail_url = EXCLUDED.thumbnail_url,
            resolution = EXCLUDED.resolution,
            fps = EXCLUDED.fps,
            codec = EXCLUDED.codec,
            tags = EXCLUDED.tags,
            file_size_bytes = EXCLUDED.file_size_bytes,
            updated_at = NOW();
        `;
        insertedCount++;
      } else if (v.onedrive_item_id) {
        // Upsert File Video (mp4, mkv, etc.)
        await sql`
          INSERT INTO videos (
            onedrive_item_id, source_type, title, description, duration, 
            file_size_bytes, resolution, fps, codec, thumbnail_url, tags, updated_at
          ) VALUES (
            ${v.onedrive_item_id}, 'file', ${v.title}, ${v.description || ''}, 
            ${v.duration || 0}, ${v.file_size_bytes || 0}, ${v.resolution || '1080p'}, 
            ${v.fps || 30}, ${v.codec || 'h264'}, ${v.thumbnail_url || ''}, 
            ${v.tags || []}, NOW()
          )
          ON CONFLICT (onedrive_item_id) DO UPDATE SET
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            thumbnail_url = EXCLUDED.thumbnail_url,
            duration = EXCLUDED.duration,
            resolution = EXCLUDED.resolution,
            fps = EXCLUDED.fps,
            codec = EXCLUDED.codec,
            tags = EXCLUDED.tags,
            file_size_bytes = EXCLUDED.file_size_bytes,
            updated_at = NOW();
        `;
        insertedCount++;
      }
    }

    return NextResponse.json({
      success: true,
      count: insertedCount,
      total: totalScanned,
      videos: videosToSync,
      logs: serverLogs,
      message: `Successfully synced ${insertedCount} video(s) into database`,
    });
  } catch (err) {
    console.error('[API_VIDEOS_SYNC_ERROR]:', err);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
