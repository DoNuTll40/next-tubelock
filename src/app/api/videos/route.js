import { NextResponse, after } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';
import { isMusicVideo } from '@/lib/videoUtils';
import { prewarmVideoSourceServer, sourceCache } from '@/lib/videoSourceService';

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
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(id) ON DELETE SET NULL;`;
    await sql`CREATE INDEX IF NOT EXISTS idx_videos_user_id ON videos(user_id);`;
    try {
      await sql`ALTER TABLE videos ALTER COLUMN fps TYPE NUMERIC(7, 3);`;
    } catch (_) {}

    tableEnsured = true;
  } catch (err) {
    console.warn('[DB Init Warning]:', err.message);
  }
}

export async function GET(request) {
  try {
    const sql = getDb();
    const { searchParams } = new URL(request.url);

    // Optional manual table init trigger if needed
    if (searchParams.get('init') === '1' && !tableEnsured) {
      await ensureTable(sql);
    }

    // Resolve user_id from session cookie
    const cookieStore = await cookies();
    const token = cookieStore.get('tubelock_session')?.value;
    let userId = null;
    if (token) {
      try {
        const sessionRows = await sql`
          SELECT user_id FROM user_sessions
          WHERE session_token = ${token}
            AND is_active = TRUE
            AND expires_at > NOW()
          LIMIT 1;
        `;
        if (sessionRows.length > 0) {
          userId = sessionRows[0].user_id;
        }
      } catch (_) {}
    }

    // ⚡ Ultra-fast Slim Projection with personalized watch_history
    let rows;
    const fetchVideos = async () => {
      if (userId) {
        return sql`
          SELECT 
            v.id, v.title, v.duration, v.file_size_bytes, v.resolution, v.fps, v.codec, 
            v.thumbnail_url, v.tags, v.category, v.views_count, v.created_at, v.status, v.source_type,
            v.user_id, v.source_cache_expires_at,
            h.last_position_seconds,
            (h.id IS NOT NULL) AS has_watched,
            u.name AS author_name,
            u.email AS author_email,
            u.picture AS author_picture
          FROM videos v
          LEFT JOIN users u ON v.user_id = u.id
          LEFT JOIN watch_history h ON h.video_id = v.id AND h.user_id = ${userId}
          WHERE v.status = 'READY' OR v.status IS NULL 
          ORDER BY v.created_at DESC;
        `;
      }
      return sql`
        SELECT 
          v.id, v.title, v.duration, v.file_size_bytes, v.resolution, v.fps, v.codec, 
          v.thumbnail_url, v.tags, v.category, v.views_count, v.created_at, v.status, v.source_type,
          v.user_id, v.source_cache_expires_at,
          NULL AS last_position_seconds,
          FALSE AS has_watched,
          u.name AS author_name,
          u.email AS author_email,
          u.picture AS author_picture
        FROM videos v
        LEFT JOIN users u ON v.user_id = u.id
        WHERE v.status = 'READY' OR v.status IS NULL 
        ORDER BY v.created_at DESC;
      `;
    };

    try {
      rows = await fetchVideos();
    } catch (queryErr) {
      if (!tableEnsured) {
        await ensureTable(sql);
        rows = await fetchVideos();
      } else {
        throw queryErr;
      }
    }

    const headers = userId
      ? { 'Cache-Control': 'private, no-cache, no-store, must-revalidate' }
      : {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
          'CDN-Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
          'Vercel-CDN-Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
        };

    const now = Date.now();
    const expiredVideoIds = [];

    const sanitizedRows = (rows || []).map((v) => {
      const exp = Number(v.source_cache_expires_at || 0);
      const mem = sourceCache.get(String(v.id));
      const isMemFresh = mem && mem.expiresAt > now + 10 * 60 * 1000;
      if ((!isMemFresh || exp <= now + 10 * 60 * 1000) && expiredVideoIds.length < 6) {
        expiredVideoIds.push(v.id);
      }
      const { source_cache_expires_at, ...cleanV } = v;
      const isMusic = isMusicVideo(cleanV);
      const hasWatched = Boolean(cleanV.has_watched || (cleanV.last_position_seconds !== null && cleanV.last_position_seconds !== undefined));
      return {
        ...cleanV,
        has_watched: hasWatched,
        last_position_seconds: isMusic ? 0 : (Number(cleanV.last_position_seconds) || 0),
      };
    });

    // ⚡ Background Auto-Prewarm: เมื่อมีคนเปิดหน้าแรก อุ่น cache ของคลิปที่หมดอายุล่วงหน้าเบื้องหลังทันที
    if (expiredVideoIds.length > 0) {
      const lastFeedWarm = globalThis.__tubelock_feed_warmup_ts || 0;
      if (now - lastFeedWarm > 30 * 1000) {
        globalThis.__tubelock_feed_warmup_ts = now;
        after(() => {
          for (const vid of expiredVideoIds) {
            prewarmVideoSourceServer(vid);
          }
        });
      }
    }

    return NextResponse.json({ success: true, data: sanitizedRows }, { headers });
  } catch (err) {
    console.error('[API_VIDEOS_GET_ERROR]:', err);
    return NextResponse.json({ success: false, error: err.message, data: [] }, { status: 500 });
  }
}
