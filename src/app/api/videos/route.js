import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

let tableEnsured = false;

async function ensureTable(sql) {
  if (tableEnsured) return;
  try {
    // Auto-create videos table if not exists with all required columns
    await sql`
      CREATE TABLE IF NOT EXISTS videos (
        id SERIAL PRIMARY KEY,
        onedrive_item_id VARCHAR(255) UNIQUE,
        onedrive_folder_id VARCHAR(255) UNIQUE,
        source_type VARCHAR(50) NOT NULL DEFAULT 'hls',
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        duration INTEGER DEFAULT 0,
        file_size_bytes BIGINT DEFAULT 0,
        resolution VARCHAR(50) DEFAULT '1080p',
        fps INTEGER DEFAULT 30,
        codec VARCHAR(50) DEFAULT 'h264',
        thumbnail_url TEXT DEFAULT '',
        tags TEXT[] DEFAULT '{}',
        status VARCHAR(50) DEFAULT 'READY',
        transcode_progress INTEGER DEFAULT 0,
        stage_detail TEXT DEFAULT '',
        error_message TEXT DEFAULT '',
        raw_file_name TEXT DEFAULT '',
        master_playlist_path TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    // Ensure all required columns exist on older tables
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'READY';`;
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS transcode_progress INTEGER DEFAULT 0;`;
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS stage_detail TEXT DEFAULT '';`;
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS error_message TEXT DEFAULT '';`;
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS raw_file_name TEXT DEFAULT '';`;
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS master_playlist_path TEXT DEFAULT '';`;
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS category VARCHAR(100) DEFAULT 'general';`;

    tableEnsured = true;
  } catch (err) {
    console.warn('[DB Init Warning]:', err.message);
  }
}

export async function GET() {
  try {
    const sql = getDb();

    if (!tableEnsured) {
      await ensureTable(sql);
    }

    // Normal feed only returns READY (or pre-existing NULL) videos
    const rows = await sql`
      SELECT * FROM videos 
      WHERE status = 'READY' OR status IS NULL 
      ORDER BY created_at DESC;
    `;
    return NextResponse.json(
      { success: true, data: rows },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
          'CDN-Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
          'Vercel-CDN-Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
        },
      }
    );
  } catch (err) {
    console.error('[API_VIDEOS_GET_ERROR]:', err);
    return NextResponse.json({ success: false, error: err.message, data: [] }, { status: 500 });
  }
}
