import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    const sql = getDb();

    // Auto-create videos table if not exists
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

    const rows = await sql`SELECT * FROM videos ORDER BY created_at DESC;`;
    return NextResponse.json({ success: true, data: rows });
  } catch (err) {
    console.error('[API_VIDEOS_GET_ERROR]:', err);
    return NextResponse.json({ success: false, error: err.message, data: [] }, { status: 500 });
  }
}
