import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { getCachedServerSession } from '@/lib/access';
import { normalizeHandleInput } from '@/lib/channelHandle';
import { encodeVideoSlug, isMusicVideo, protectVideoPoster } from '@/lib/videoUtils';
import { ensurePlaylistSchema, listPlaylists } from '@/lib/playlists';
import ChannelClient from './ChannelClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function generateMetadata({ params }) {
  const { handle: rawHandle } = await params;
  const cleanHandle = normalizeHandleInput(rawHandle);
  if (!cleanHandle) {
    return { title: 'ไม่พบช่อง - TubeLock' };
  }

  try {
    const sql = getDb();
    const rows = await sql`
      SELECT name, handle, bio
      FROM users
      WHERE LOWER(handle) = LOWER(${cleanHandle})
      LIMIT 1;
    `;
    const ch = rows[0];
    if (!ch) {
      return { title: `@${cleanHandle} - TubeLock` };
    }
    return {
      title: `${ch.name || ch.handle} (@${ch.handle}) - TubeLock`,
      description: ch.bio || `รับชมวิดีโอจากช่อง ${ch.name || ch.handle} บน TubeLock`,
    };
  } catch {
    return { title: `@${cleanHandle} - TubeLock` };
  }
}

export default async function ChannelPage({ params }) {
  const { handle: rawHandle } = await params;
  const cleanHandle = normalizeHandleInput(rawHandle);
  if (!cleanHandle) {
    notFound();
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
    notFound();
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
    (async () => {
      try {
        await ensurePlaylistSchema(sql);
        const allChannelPlaylists = await listPlaylists(sql, channel.id, { filter: 'normal' });
        return isOwner
          ? allChannelPlaylists
          : allChannelPlaylists.filter((pl) => pl.visibility === 'public');
      } catch {
        return [];
      }
    })(),
  ]);

  const videos = videoRows.map((row) => {
    const views = Number(row.views_count || 0);
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
  const totalViews = videos.reduce((sum, v) => sum + (Number(v.views_count) || 0), 0);

  const channelData = {
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
  };

  const playlists = Array.isArray(playlistRows) ? playlistRows : [];

  return (
    <ChannelClient
      channel={channelData}
      initialVideos={videos}
      initialPlaylists={playlists}
    />
  );
}
