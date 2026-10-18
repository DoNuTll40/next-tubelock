import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';
import { isMusicVideo } from '@/lib/videoUtils';

export const dynamic = 'force-dynamic';

async function getAuthUser(sql) {
  const cookieStore = await cookies();
  const token = cookieStore.get('tubelock_session')?.value;
  if (!token) return null;

  const rows = await sql`
    SELECT s.user_id, u.name, u.email, u.picture
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.session_token = ${token}
      AND s.is_active = TRUE
      AND s.expires_at > NOW()
    LIMIT 1;
  `;
  return rows[0] || null;
}

/**
 * GET /api/history
 * Fetches user watch history with video metadata
 */
export async function GET(request) {
  try {
    const sql = getDb();
    const user = await getAuthUser(sql);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized', history: [] }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q')?.trim();

    let history;
    if (query) {
      const searchPattern = `%${query}%`;
      history = await sql`
        SELECT 
          h.id AS history_id,
          h.video_id,
          h.last_position_seconds,
          h.updated_at,
          v.id,
          v.title,
          v.description,
          v.duration,
          v.file_size_bytes,
          v.resolution,
          v.fps,
          v.codec,
          v.thumbnail_url,
          v.views_count,
          v.created_at AS video_created_at,
          v.category,
          v.source_type,
          u.name AS author_name,
          u.email AS author_email,
          u.picture AS author_picture
        FROM watch_history h
        JOIN videos v ON h.video_id = v.id
        LEFT JOIN users u ON v.user_id = u.id
        WHERE h.user_id = ${user.user_id}
          AND (v.title ILIKE ${searchPattern} OR v.description ILIKE ${searchPattern})
        ORDER BY h.updated_at DESC
        LIMIT 100;
      `;
    } else {
      history = await sql`
        SELECT 
          h.id AS history_id,
          h.video_id,
          h.last_position_seconds,
          h.updated_at,
          v.id,
          v.title,
          v.description,
          v.duration,
          v.file_size_bytes,
          v.resolution,
          v.fps,
          v.codec,
          v.thumbnail_url,
          v.views_count,
          v.created_at AS video_created_at,
          v.category,
          v.source_type,
          u.name AS author_name,
          u.email AS author_email,
          u.picture AS author_picture
        FROM watch_history h
        JOIN videos v ON h.video_id = v.id
        LEFT JOIN users u ON v.user_id = u.id
        WHERE h.user_id = ${user.user_id}
        ORDER BY h.updated_at DESC
        LIMIT 100;
      `;
    }

    return NextResponse.json({
      success: true,
      history: history.map((item) => ({
        ...item,
        last_position_seconds: isMusicVideo(item) ? 0 : Number(item.last_position_seconds || 0),
        duration: Number(item.duration || 0),
        views_count: Number(item.views_count || 0),
        updated_at: item.updated_at ? new Date(item.updated_at).toISOString() : null,
      })),
    });
  } catch (error) {
    console.error('[API History GET Error]:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/history
 * Records or updates watch progress for a video
 */
export async function POST(request) {
  try {
    const cookieStore = await cookies();
    const isPaused = cookieStore.get('tubelock_pause_history')?.value === 'true';
    if (isPaused) {
      return NextResponse.json({ success: true, message: 'History paused' });
    }

    const sql = getDb();
    const user = await getAuthUser(sql);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    const videoId = parseInt(body?.videoId, 10);
    const position = Math.max(0, Math.floor(Number(body?.position || 0)));

    if (!videoId || isNaN(videoId)) {
      return NextResponse.json({ success: false, error: 'Invalid videoId' }, { status: 400 });
    }

    // Music category check: Music tracks always reset to 0
    const videoRows = await sql`SELECT id, category, tags, title FROM videos WHERE id = ${videoId} LIMIT 1;`;
    const isMusic = videoRows.length > 0 && isMusicVideo(videoRows[0]);
    const finalPosition = isMusic ? 0 : position;

    await sql`
      INSERT INTO watch_history (user_id, video_id, last_position_seconds, updated_at)
      VALUES (${user.user_id}, ${videoId}, ${finalPosition}, NOW())
      ON CONFLICT (user_id, video_id)
      DO UPDATE SET
        last_position_seconds = ${finalPosition},
        updated_at = NOW();
    `;

    return NextResponse.json({ success: true, isMusic });
  } catch (error) {
    console.error('[API History POST Error]:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * DELETE /api/history
 * Clears entire history or removes single video
 */
export async function DELETE(request) {
  try {
    const sql = getDb();
    const user = await getAuthUser(sql);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const clearAll = searchParams.get('all') === 'true';
    const videoIdStr = searchParams.get('videoId');

    if (clearAll) {
      await sql`
        DELETE FROM watch_history 
        WHERE user_id = ${user.user_id};
      `;
      return NextResponse.json({ success: true, message: 'All history cleared' });
    }

    if (videoIdStr) {
      const videoId = parseInt(videoIdStr, 10);
      if (videoId && !isNaN(videoId)) {
        await sql`
          DELETE FROM watch_history 
          WHERE user_id = ${user.user_id} AND video_id = ${videoId};
        `;
        return NextResponse.json({ success: true, message: 'Video removed from history' });
      }
    }

    return NextResponse.json({ success: false, error: 'Missing videoId or all parameter' }, { status: 400 });
  } catch (error) {
    console.error('[API History DELETE Error]:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
