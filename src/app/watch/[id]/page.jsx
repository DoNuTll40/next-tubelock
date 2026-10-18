import { notFound, redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';
import { parseTimestamp, isMusicVideo, decodeVideoSlug, encodeVideoSlug } from '@/lib/videoUtils';
import WatchClient from './WatchClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function generateMetadata({ params }) {
  const { id: rawSlug } = await params;
  const numericId = decodeVideoSlug(rawSlug);
  if (!numericId) return { title: 'TubeLock' };

  try {
    const sql = getDb();
    const rows = await sql`
      SELECT id, title, description, thumbnail_url, tags, category
      FROM videos
      WHERE id = ${numericId}
      LIMIT 1;
    `;
    if (!rows || rows.length === 0) {
      return { title: 'TubeLock' };
    }
    const video = rows[0];
    return {
      title: `${video.title} - TubeLock`,
      description: video.description ? video.description.slice(0, 160) : 'TubeLock Video Streaming',
      openGraph: {
        title: `${video.title} - TubeLock`,
        description: video.description ? video.description.slice(0, 160) : 'TubeLock Video Streaming',
        images: video.thumbnail_url ? [video.thumbnail_url] : [],
      },
    };
  } catch {
    return { title: 'TubeLock' };
  }
}

export default async function WatchPage({ params, searchParams }) {
  const { id: rawSlug } = await params;
  const numericId = decodeVideoSlug(rawSlug);
  if (!numericId) {
    notFound();
  }

  const resolvedSearchParams = searchParams ? await searchParams : {};
  const initialTime = parseTimestamp(resolvedSearchParams?.t);
  const sql = getDb();

  // Resolve user_id from session cookie
  const cookieStore = await cookies();
  const token = cookieStore.get('tubelock_session')?.value;
  let userId = null;
  if (token) {
    try {
      const sRows = await sql`
        SELECT user_id FROM user_sessions
        WHERE session_token = ${token}
          AND is_active = TRUE
          AND expires_at > NOW()
        LIMIT 1;
      `;
      if (sRows.length > 0) userId = sRows[0].user_id;
    } catch (_) {}
  }

  let video = null;
  let relatedVideos = [];

  try {
    const [videoRows, relatedRows] = await Promise.all([
      sql`
        SELECT 
          v.id, v.title, v.description, v.duration, v.file_size_bytes, v.resolution,
          v.fps, v.codec, v.bitrate, v.thumbnail_url, v.tags, v.category, v.views_count, v.created_at,
          v.status, v.source_type, v.user_id, v.onedrive_item_id, v.onedrive_folder_id, v.raw_file_name,
          u.name AS author_name, u.email AS author_email, u.picture AS author_picture
        FROM videos v
        LEFT JOIN users u ON v.user_id = u.id
        WHERE v.id = ${numericId}
        LIMIT 1;
      `,
      userId
        ? sql`
            SELECT 
              v.id, v.title, v.description, v.duration, v.file_size_bytes, v.resolution,
              v.fps, v.codec, v.bitrate, v.thumbnail_url, v.tags, v.category, v.views_count, v.created_at,
              v.status, v.source_type, v.user_id, v.onedrive_item_id, v.onedrive_folder_id,
              h.last_position_seconds,
              (h.id IS NOT NULL) AS has_watched,
              u.name AS author_name, u.email AS author_email, u.picture AS author_picture
            FROM videos v
            LEFT JOIN users u ON v.user_id = u.id
            LEFT JOIN watch_history h ON h.video_id = v.id AND h.user_id = ${userId}
            WHERE (v.status = 'READY' OR v.status IS NULL) AND v.id != ${numericId}
            ORDER BY v.created_at DESC
            LIMIT 30;
          `
        : sql`
            SELECT 
              v.id, v.title, v.description, v.duration, v.file_size_bytes, v.resolution,
              v.fps, v.codec, v.bitrate, v.thumbnail_url, v.tags, v.category, v.views_count, v.created_at,
              v.status, v.source_type, v.user_id, v.onedrive_item_id, v.onedrive_folder_id,
              NULL AS last_position_seconds,
              FALSE AS has_watched,
              u.name AS author_name, u.email AS author_email, u.picture AS author_picture
            FROM videos v
            LEFT JOIN users u ON v.user_id = u.id
            WHERE (v.status = 'READY' OR v.status IS NULL) AND v.id != ${numericId}
            ORDER BY v.created_at DESC
            LIMIT 30;
          `
    ]);

    if (!videoRows || videoRows.length === 0) {
      notFound();
    }

    video = {
      ...videoRows[0],
      created_at: videoRows[0].created_at ? new Date(videoRows[0].created_at).toISOString() : null,
      views_count: Number(videoRows[0].views_count || 0),
    };

    // Canonical URL redirection: if accessed with numeric ID (e.g. /watch/851), redirect to /watch/v_g...
    if (/^\d+$/.test(rawSlug)) {
      const canonicalSlug = encodeVideoSlug(video.id, video.category);
      if (canonicalSlug && canonicalSlug !== rawSlug) {
        const urlT = resolvedSearchParams?.t;
        redirect(`/watch/${canonicalSlug}${urlT ? `?t=${urlT}` : ''}`);
      }
    }

    relatedVideos = relatedRows.map((item) => {
      const isItemMusic = isMusicVideo(item);
      const hasWatched = Boolean(item.has_watched || (item.last_position_seconds !== null && item.last_position_seconds !== undefined));
      return {
        ...item,
        has_watched: hasWatched,
        last_position_seconds: isItemMusic ? 0 : (Number(item.last_position_seconds) || 0),
        created_at: item.created_at ? new Date(item.created_at).toISOString() : null,
        views_count: Number(item.views_count || 0),
      };
    });
  } catch (err) {
    // Re-throw Next.js redirect or notFound
    if (err?.message === 'NEXT_REDIRECT' || err?.digest?.startsWith('NEXT_REDIRECT')) {
      throw err;
    }
    console.error('[WatchPage SSR Error]:', err);
    notFound();
  }

  const isMusic = isMusicVideo(video);
  const resolvedTime = isMusic ? 0 : initialTime;

  return (
    <WatchClient
      initialVideo={video}
      initialRelated={relatedVideos}
      initialTime={resolvedTime}
    />
  );
}
