import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCachedServerSession } from '@/lib/access';
import { normalizeHandleInput } from '@/lib/channelHandle';
import { encodeVideoSlug, isMusicVideo, protectVideoPoster } from '@/lib/videoUtils';

export const dynamic = 'force-dynamic';

export async function GET(request, context) {
  try {
    const { handle: rawHandle } = await context.params;
    const cleanHandle = normalizeHandleInput(rawHandle);
    if (!cleanHandle) {
      return NextResponse.json({ success: false, error: 'Channel handle is required' }, { status: 400 });
    }

    const sql = getDb();
    const session = await getCachedServerSession();
    const viewerId = session?.id ?? null;

    const channelRows = await sql`
      SELECT id, name, picture, handle, bio, banner_url, created_at
      FROM users
      WHERE LOWER(handle) = LOWER(${cleanHandle})
      LIMIT 1;
    `;

    if (!channelRows.length) {
      return NextResponse.json({ success: false, error: 'Channel not found' }, { status: 404 });
    }

    const channel = channelRows[0];
    const isOwner = viewerId != null && Number(viewerId) === Number(channel.id);

    const [subStats, viewerSub, videoRows, playlistRows] = await Promise.all([
      sql`SELECT COUNT(*)::int AS cnt FROM subscriptions WHERE channel_id = ${channel.id};`,
      viewerId != null && !isOwner
        ? sql`SELECT 1 FROM subscriptions WHERE subscriber_id = ${viewerId} AND channel_id = ${channel.id} LIMIT 1;`
        : Promise.resolve([]),
      viewerId
        ? sql`
            SELECT
              v.id, v.title, v.duration, v.file_size_bytes, v.resolution, v.fps, v.codec,
              v.thumbnail_url, v.tags, v.category, v.content_rating, v.views_count, v.created_at,
              v.status, v.source_type, v.user_id, COALESCE(v.visibility, 'public') AS visibility,
              h.last_position_seconds, (h.id IS NOT NULL) AS has_watched,
              u.name AS author_name, u.picture AS author_picture, u.handle AS author_handle
            FROM videos v
            LEFT JOIN users u ON v.user_id = u.id
            LEFT JOIN watch_history h ON h.video_id = v.id AND h.user_id = ${viewerId}
            WHERE v.user_id = ${channel.id}
              AND (v.status = 'READY' OR v.status IS NULL)
              AND COALESCE(v.visibility, 'public') = 'public'
            ORDER BY v.created_at DESC
            LIMIT 120;
          `
        : sql`
            SELECT
              v.id, v.title, v.duration, v.file_size_bytes, v.resolution, v.fps, v.codec,
              v.thumbnail_url, v.tags, v.category, v.content_rating, v.views_count, v.created_at,
              v.status, v.source_type, v.user_id, COALESCE(v.visibility, 'public') AS visibility,
              u.name AS author_name, u.picture AS author_picture, u.handle AS author_handle
            FROM videos v
            LEFT JOIN users u ON v.user_id = u.id
            WHERE v.user_id = ${channel.id}
              AND (v.status = 'READY' OR v.status IS NULL)
              AND COALESCE(v.visibility, 'public') = 'public'
            ORDER BY v.created_at DESC
            LIMIT 120;
          `,
      sql`
        SELECT
          p.id, p.title, p.description, p.visibility, p.created_at, p.updated_at,
          COUNT(pi.video_id)::int AS video_count,
          (
            SELECT v2.thumbnail_url
            FROM playlist_items pi2
            JOIN videos v2 ON v2.id = pi2.video_id
            WHERE pi2.playlist_id = p.id
              AND COALESCE(v2.visibility, 'public') = 'public'
            ORDER BY pi2.position ASC, pi2.added_at ASC
            LIMIT 1
          ) AS cover_thumbnail
        FROM playlists p
        LEFT JOIN playlist_items pi ON pi.playlist_id = p.id
        WHERE p.user_id = ${channel.id}
          AND p.system_key IS NULL
          AND p.visibility = 'public'
        GROUP BY p.id
        ORDER BY p.updated_at DESC
        LIMIT 40;
      `.catch(() => []),
    ]);

    let totalViews = 0;
    const videos = videoRows.map((row) => {
      const views = Number(row.views_count || 0);
      totalViews += views;
      const item = protectVideoPoster(row);
      const isItemMusic = isMusicVideo(item);
      const slug = encodeVideoSlug(item.id, item.category);
      const safeThumb = item.thumbnail_url?.startsWith('data:')
        ? `/api/og/${slug}.jpg`
        : item.thumbnail_url;
      return {
        ...item,
        slug,
        thumbnail_url: safeThumb,
        has_watched: Boolean(item.has_watched || (item.last_position_seconds !== null && item.last_position_seconds !== undefined)),
        last_position_seconds: isItemMusic ? 0 : (Number(item.last_position_seconds) || 0),
        views_count: views,
        created_at: item.created_at ? new Date(item.created_at).toISOString() : null,
      };
    });

    return NextResponse.json({
      success: true,
      channel: {
        id: channel.id,
        name: channel.name || channel.handle,
        handle: channel.handle,
        picture: channel.picture || '',
        bannerUrl: channel.banner_url || '',
        bio: channel.bio || '',
        createdAt: channel.created_at ? new Date(channel.created_at).toISOString() : null,
        subscriberCount: Number(subStats[0]?.cnt || 0),
        isSubscribed: viewerSub.length > 0,
        isOwner,
        videoCount: videos.length,
        totalViews,
      },
      videos,
      playlists: playlistRows.map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description || '',
        videoCount: Number(p.video_count || 0),
        coverThumbnail: p.cover_thumbnail || '',
        updatedAt: p.updated_at ? new Date(p.updated_at).toISOString() : null,
      })),
    });
  } catch (err) {
    console.error('[API_CHANNEL_GET_ERROR]:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
