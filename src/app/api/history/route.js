import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb, retryDbRead } from '@/lib/db';
import { apiError } from '@/lib/apiError';
import { getCachedServerSession } from '@/lib/access';
import { protectVideoPoster, isMusicVideo } from '@/lib/videoUtils';

export const dynamic = 'force-dynamic';

/**
 * GET /api/history
 * Fetches user watch history with video metadata
 */
export async function GET(request) {
  try {
    const session = await getCachedServerSession();
    if (!session?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized', history: [] }, { status: 401 });
    }

    const sql = getDb();
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q')?.trim();

    let history;
    if (query) {
      const searchPattern = `%${query}%`;
      history = await retryDbRead(() => sql`
        SELECT 
          h.id AS history_id,
          h.video_id,
          h.last_position_seconds,
          h.last_version_id,
          h.watched_date,
          h.watched_at AS updated_at,
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
          v.content_rating,
          v.source_type,
          u.name AS author_name,
          u.email AS author_email,
          u.picture AS author_picture,
          u.handle AS author_handle
        FROM watch_history_log h
        JOIN videos v ON h.video_id = v.id
        LEFT JOIN users u ON v.user_id = u.id
        WHERE h.user_id = ${session.id}
          AND (v.title ILIKE ${searchPattern} OR v.description ILIKE ${searchPattern})
        ORDER BY h.watched_at DESC
        LIMIT 150;
      `);
    } else {
      history = await retryDbRead(() => sql`
        SELECT 
          h.id AS history_id,
          h.video_id,
          h.last_position_seconds,
          h.last_version_id,
          h.watched_date,
          h.watched_at AS updated_at,
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
          v.content_rating,
          v.source_type,
          u.name AS author_name,
          u.email AS author_email,
          u.picture AS author_picture,
          u.handle AS author_handle
        FROM watch_history_log h
        JOIN videos v ON h.video_id = v.id
        LEFT JOIN users u ON v.user_id = u.id
        WHERE h.user_id = ${session.id}
        ORDER BY h.watched_at DESC
        LIMIT 150;
      `);
    }

    return NextResponse.json({
      success: true,
      history: history.map((item) => ({
        ...protectVideoPoster(item),
        last_position_seconds: isMusicVideo(item) ? 0 : Number(item.last_position_seconds || 0),
        duration: Number(item.duration || 0),
        views_count: Number(item.views_count || 0),
        updated_at: item.updated_at ? new Date(item.updated_at).toISOString() : null,
      })),
    });
  } catch (error) {
    return apiError(error, { context: 'GET /api/history' });
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

    const session = await getCachedServerSession();
    if (!session?.id) {
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
    const rawVersionId = body?.versionId != null ? parseInt(body.versionId, 10) : null;
    const versionId = rawVersionId && !isNaN(rawVersionId) && rawVersionId > 0 ? rawVersionId : null;

    if (!videoId || isNaN(videoId)) {
      return NextResponse.json({ success: false, error: 'Invalid videoId' }, { status: 400 });
    }

    const sql = getDb();

    // Use client-supplied isMusic flag when available to avoid a redundant videos table lookup
    let isMusic;
    if (typeof body?.isMusic === 'boolean') {
      isMusic = body.isMusic;
    } else {
      const videoRows = await sql`SELECT id, category, tags, title FROM videos WHERE id = ${videoId} LIMIT 1;`;
      isMusic = videoRows.length > 0 && isMusicVideo(videoRows[0]);
    }
    const finalPosition = isMusic ? 0 : position;

    await Promise.all([
      sql`
        INSERT INTO watch_history (user_id, video_id, last_position_seconds, last_version_id, updated_at)
        VALUES (${session.id}, ${videoId}, ${finalPosition}, ${versionId}, NOW())
        ON CONFLICT (user_id, video_id)
        DO UPDATE SET
          last_position_seconds = ${finalPosition},
          last_version_id = COALESCE(${versionId}, watch_history.last_version_id),
          updated_at = NOW();
      `,
      sql`
        INSERT INTO watch_history_log (user_id, video_id, watched_date, last_position_seconds, last_version_id, watched_at)
        VALUES (
          ${session.id},
          ${videoId},
          (NOW() AT TIME ZONE 'Asia/Bangkok')::date,
          ${finalPosition},
          ${versionId},
          NOW()
        )
        ON CONFLICT (user_id, video_id, watched_date)
        DO UPDATE SET
          last_position_seconds = ${finalPosition},
          last_version_id = COALESCE(${versionId}, watch_history_log.last_version_id),
          watched_at = NOW();
      `,
    ]);

    return NextResponse.json({ success: true, isMusic });
  } catch (error) {
    return apiError(error, { context: 'POST /api/history' });
  }
}

/**
 * DELETE /api/history
 * Clears entire history or removes single video
 */
export async function DELETE(request) {
  try {
    const session = await getCachedServerSession();
    if (!session?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const sql = getDb();
    const { searchParams } = new URL(request.url);
    const clearAll = searchParams.get('all') === 'true';
    const historyIdStr = searchParams.get('historyId');
    const videoIdStr = searchParams.get('videoId');

    if (clearAll) {
      await Promise.all([
        sql`DELETE FROM watch_history_log WHERE user_id = ${session.id};`,
        sql`DELETE FROM watch_history WHERE user_id = ${session.id};`,
      ]);
      return NextResponse.json({ success: true, message: 'All history cleared' });
    }

    if (historyIdStr) {
      const historyId = parseInt(historyIdStr, 10);
      if (historyId && !isNaN(historyId)) {
        const deleted = await sql`
          DELETE FROM watch_history_log
          WHERE id = ${historyId} AND user_id = ${session.id}
          RETURNING video_id;
        `;
        const deletedVideoId = deleted[0]?.video_id;
        if (deletedVideoId != null) {
          const remaining = await sql`
            SELECT 1 FROM watch_history_log
            WHERE user_id = ${session.id} AND video_id = ${deletedVideoId}
            LIMIT 1;
          `;
          if (remaining.length === 0) {
            await sql`
              DELETE FROM watch_history
              WHERE user_id = ${session.id} AND video_id = ${deletedVideoId};
            `;
          }
        }
        return NextResponse.json({ success: true, message: 'History entry removed' });
      }
    }

    if (videoIdStr) {
      const videoId = parseInt(videoIdStr, 10);
      if (videoId && !isNaN(videoId)) {
        await Promise.all([
          sql`DELETE FROM watch_history_log WHERE user_id = ${session.id} AND video_id = ${videoId};`,
          sql`DELETE FROM watch_history WHERE user_id = ${session.id} AND video_id = ${videoId};`,
        ]);
        return NextResponse.json({ success: true, message: 'Video removed from history' });
      }
    }

    return NextResponse.json({ success: false, error: 'Missing videoId or all parameter' }, { status: 400 });
  } catch (error) {
    return apiError(error, { context: 'DELETE /api/history' });
  }
}
