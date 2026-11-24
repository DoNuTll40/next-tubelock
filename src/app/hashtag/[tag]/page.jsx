import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { getCachedServerSession } from '@/lib/access';
import { encodeVideoSlug, isMusicVideo, protectVideoPoster } from '@/lib/videoUtils';
import HashtagClient from './HashtagClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function normalizeTagParam(rawTag) {
  let decoded = String(rawTag || '');
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // keep raw
  }
  return decoded.replace(/^#+/, '').trim();
}

function extractHashtagTokens(text = '') {
  const matches = String(text || '').match(/#([a-zA-Z0-9_\u0E00-\u0E7F]+)/g) || [];
  return matches.map((m) => m.slice(1).toLowerCase());
}

export async function generateMetadata({ params }) {
  const { tag: rawTag } = await params;
  const cleanTag = normalizeTagParam(rawTag);
  if (!cleanTag) {
    return { title: 'แฮชแท็ก - TubeLock' };
  }
  return {
    title: `#${cleanTag} - TubeLock`,
    description: `รวมวิดีโอทั้งหมดที่ติดแฮชแท็ก #${cleanTag} บน TubeLock`,
  };
}

export default async function HashtagPage({ params }) {
  const { tag: rawTag } = await params;
  const cleanTag = normalizeTagParam(rawTag);
  if (!cleanTag) {
    notFound();
  }

  const lowerTag = cleanTag.toLowerCase();
  const descPattern = `%#${cleanTag}%`;
  const sql = getDb();
  const session = await getCachedServerSession();
  const userId = session?.id ?? null;

  let videos = [];
  let channelCount = 0;

  try {
    const rows = userId
      ? await sql`
          SELECT
            v.id, v.title, v.description, v.duration, v.file_size_bytes, v.resolution,
            v.fps, v.codec, v.thumbnail_url, v.tags, v.category, v.content_rating,
            v.views_count, v.created_at, v.status, v.source_type, v.user_id,
            COALESCE(v.visibility, 'public') AS visibility,
            h.last_position_seconds,
            (h.id IS NOT NULL) AS has_watched,
            u.name AS author_name, u.picture AS author_picture, u.handle AS author_handle
          FROM videos v
          LEFT JOIN users u ON v.user_id = u.id
          LEFT JOIN watch_history h ON h.video_id = v.id AND h.user_id = ${userId}
          WHERE (v.status = 'READY' OR v.status IS NULL)
            AND COALESCE(v.visibility, 'public') = 'public'
            AND (
              EXISTS (
                SELECT 1
                FROM unnest(COALESCE(v.tags, ARRAY[]::text[])) AS t
                WHERE LOWER(TRIM(LEADING '#' FROM t)) = ${lowerTag}
              )
              OR COALESCE(v.description, '') ILIKE ${descPattern}
            )
          ORDER BY v.views_count DESC NULLS LAST, v.created_at DESC
          LIMIT 120;
        `
      : await sql`
          SELECT
            v.id, v.title, v.description, v.duration, v.file_size_bytes, v.resolution,
            v.fps, v.codec, v.thumbnail_url, v.tags, v.category, v.content_rating,
            v.views_count, v.created_at, v.status, v.source_type, v.user_id,
            COALESCE(v.visibility, 'public') AS visibility,
            u.name AS author_name, u.picture AS author_picture, u.handle AS author_handle
          FROM videos v
          LEFT JOIN users u ON v.user_id = u.id
          WHERE (v.status = 'READY' OR v.status IS NULL)
            AND COALESCE(v.visibility, 'public') = 'public'
            AND (
              EXISTS (
                SELECT 1
                FROM unnest(COALESCE(v.tags, ARRAY[]::text[])) AS t
                WHERE LOWER(TRIM(LEADING '#' FROM t)) = ${lowerTag}
              )
              OR COALESCE(v.description, '') ILIKE ${descPattern}
            )
          ORDER BY v.views_count DESC NULLS LAST, v.created_at DESC
          LIMIT 120;
        `;

    const matched = rows.filter((row) => {
      const arrayMatch = Array.isArray(row.tags) && row.tags.some(
        (t) => String(t || '').replace(/^#+/, '').trim().toLowerCase() === lowerTag
      );
      if (arrayMatch) return true;
      return extractHashtagTokens(row.description).includes(lowerTag);
    });

    const channels = new Set();
    videos = matched.map((row) => {
      if (row.user_id != null) channels.add(String(row.user_id));
      const item = protectVideoPoster(row);
      const isItemMusic = isMusicVideo(item);
      const slug = encodeVideoSlug(item.id, item.category);
      const safeThumb = item.thumbnail_url?.startsWith('data:')
        ? `/api/og/${slug}.jpg`
        : item.thumbnail_url;
      return {
        ...item,
        description: undefined,
        slug,
        thumbnail_url: safeThumb,
        has_watched: Boolean(item.has_watched || (item.last_position_seconds !== null && item.last_position_seconds !== undefined)),
        last_position_seconds: isItemMusic ? 0 : (Number(item.last_position_seconds) || 0),
        views_count: Number(item.views_count || 0),
        created_at: item.created_at ? new Date(item.created_at).toISOString() : null,
      };
    });
    channelCount = channels.size;
  } catch (err) {
    console.error('[HashtagPage SSR Error]:', err);
  }

  return (
    <HashtagClient
      tag={cleanTag}
      initialVideos={videos}
      channelCount={channelCount}
    />
  );
}
