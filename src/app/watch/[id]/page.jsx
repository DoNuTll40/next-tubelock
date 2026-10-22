import { notFound, redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { getDb } from '@/lib/db';
import { parseTimestamp, isMusicVideo, decodeVideoSlug, encodeVideoSlug } from '@/lib/videoUtils';
import WatchClient from './WatchClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Deduplicate video query between generateMetadata and WatchPage in the same request
const getVideoById = cache(async (numericId) => {
  if (!numericId) return null;
  const sql = getDb();
  const rows = await sql`
    SELECT 
      v.id, v.title, v.description, v.duration, v.file_size_bytes, v.resolution,
      v.fps, v.codec, v.bitrate, v.thumbnail_url, v.tags, v.category, v.views_count, v.created_at,
      v.status, v.source_type, v.user_id, v.onedrive_item_id, v.onedrive_folder_id, v.raw_file_name,
      u.name AS author_name, u.email AS author_email, u.picture AS author_picture
    FROM videos v
    LEFT JOIN users u ON v.user_id = u.id
    WHERE v.id = ${numericId}
    LIMIT 1;
  `;
  return rows?.[0] || null;
});

export async function generateMetadata({ params }) {
  const { id: rawSlug } = await params;
  const numericId = decodeVideoSlug(rawSlug);
  if (!numericId) {
    return {
      title: 'วิดีโอไม่พบ - TubeLock',
      description: 'ไม่พบวิดีโอที่คุณต้องการรับชมบน TubeLock',
    };
  }

  try {
    const video = await getVideoById(numericId);
    if (!video) {
      return {
        title: 'วิดีโอไม่พบ - TubeLock',
        description: 'ไม่พบวิดีโอที่คุณต้องการรับชมบน TubeLock',
      };
    }

    const canonicalSlug = encodeVideoSlug(video.id, video.category) || rawSlug;
    const rawTitle = (video.title || 'TubeLock').trim();

    // Google SERP and Social Cards recommend 50-60 characters
    // Title includes ' - TubeLock' (11 chars), so cleanTitle must be <= 47 chars for total <= 58 chars
    const cleanTitle = rawTitle.length > 47 ? `${rawTitle.slice(0, 44).trim()}...` : rawTitle;
    const socialTitle = rawTitle.length > 58 ? `${rawTitle.slice(0, 55).trim()}...` : rawTitle;

    // Clean description: remove newlines/tabs and truncate cleanly (< 150 chars)
    const rawDesc = (video.description || '')
      .replace(/\r?\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const pageDescription = rawDesc
      ? (rawDesc.length > 150 ? `${rawDesc.slice(0, 147).trim()}...` : rawDesc)
      : 'รับชมวิดีโอนี้บน TubeLock แพลตฟอร์มสตรีมมิ่งวิดีโอส่วนตัว ความคมชัดสูง ไร้โฆษณา';

    const canonicalPath = `/watch/${canonicalSlug}`;
    // Optimized 1200x630 JPEG endpoint (< 120 KB, perfect for WhatsApp, Twitter, Facebook)
    const ogImageUrl = `/api/og/${canonicalSlug}.jpg`;

    return {
      title: {
        absolute: `${cleanTitle} - TubeLock`,
      },
      description: pageDescription,
      alternates: {
        canonical: canonicalPath,
      },
      openGraph: {
        type: 'video.other',
        title: socialTitle,
        description: pageDescription,
        url: canonicalPath,
        siteName: 'TubeLock',
        locale: 'th_TH',
        images: [
          {
            url: ogImageUrl,
            width: 1200,
            height: 630,
            type: 'image/jpeg',
            alt: socialTitle,
          },
        ],
      },
      twitter: {
        card: 'summary_large_image',
        site: '@tubelock',
        creator: '@tubelock',
        title: socialTitle,
        description: pageDescription,
        images: [
          {
            url: ogImageUrl,
            width: 1200,
            height: 630,
            alt: socialTitle,
          },
        ],
      },
    };
  } catch (err) {
    console.error('[generateMetadata Error]:', err);
    return {
      title: 'TubeLock - Private HLS Streaming',
      description: 'Private Client-Side HLS Video Streaming Platform on Next.js',
    };
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
    // ⚡ Performance Optimization:
    // 1. getVideoById is deduplicated via React cache() (0 extra DB hit)
    // 2. relatedRows does NOT select huge v.description or unused fields
    // 3. LIMIT 12 reduces initial SSR payload to < 100 KB
    const [rawVideo, relatedRows] = await Promise.all([
      getVideoById(numericId),
      userId
        ? sql`
            SELECT 
              v.id, v.title, v.duration, v.resolution, v.thumbnail_url, v.category, v.views_count, v.created_at,
              v.status,
              h.last_position_seconds,
              (h.id IS NOT NULL) AS has_watched,
              u.name AS author_name, u.picture AS author_picture
            FROM videos v
            LEFT JOIN users u ON v.user_id = u.id
            LEFT JOIN watch_history h ON h.video_id = v.id AND h.user_id = ${userId}
            WHERE (v.status = 'READY' OR v.status IS NULL) AND v.id != ${numericId}
            ORDER BY v.created_at DESC
            LIMIT 12;
          `
        : sql`
            SELECT 
              v.id, v.title, v.duration, v.resolution, v.thumbnail_url, v.category, v.views_count, v.created_at,
              v.status,
              NULL AS last_position_seconds,
              FALSE AS has_watched,
              u.name AS author_name, u.picture AS author_picture
            FROM videos v
            LEFT JOIN users u ON v.user_id = u.id
            WHERE (v.status = 'READY' OR v.status IS NULL) AND v.id != ${numericId}
            ORDER BY v.created_at DESC
            LIMIT 12;
          `
    ]);

    if (!rawVideo) {
      notFound();
    }

    const videoRows = [rawVideo];
    const canonicalSlug = encodeVideoSlug(videoRows[0].id, videoRows[0].category);

    // If thumbnail is a heavy data URI, replace with lightweight /api/og endpoint to save ~200 KB HTML
    const safeThumbnail = videoRows[0].thumbnail_url?.startsWith('data:')
      ? `/api/og/${canonicalSlug}.jpg`
      : videoRows[0].thumbnail_url;

    video = {
      ...videoRows[0],
      thumbnail_url: safeThumbnail,
      slug: canonicalSlug,
      created_at: videoRows[0].created_at ? new Date(videoRows[0].created_at).toISOString() : null,
      views_count: Number(videoRows[0].views_count || 0),
    };

    // Canonical URL redirection: if accessed with numeric ID (e.g. /watch/851), redirect to /watch/v_g...
    if (/^\d+$/.test(rawSlug)) {
      if (canonicalSlug && canonicalSlug !== rawSlug) {
        const urlT = resolvedSearchParams?.t;
        redirect(`/watch/${canonicalSlug}${urlT ? `?t=${urlT}` : ''}`);
      }
    }

    relatedVideos = relatedRows.map((item) => {
      const isItemMusic = isMusicVideo(item);
      const hasWatched = Boolean(item.has_watched || (item.last_position_seconds !== null && item.last_position_seconds !== undefined));
      const itemSlug = encodeVideoSlug(item.id, item.category);
      const itemThumb = item.thumbnail_url?.startsWith('data:')
        ? `/api/og/${itemSlug}.jpg`
        : item.thumbnail_url;

      return {
        ...item,
        thumbnail_url: itemThumb,
        has_watched: hasWatched,
        last_position_seconds: isItemMusic ? 0 : (Number(item.last_position_seconds) || 0),
        created_at: item.created_at ? new Date(item.created_at).toISOString() : null,
        views_count: Number(item.views_count || 0),
      };
    });
  } catch (err) {
    // Re-throw Next.js redirect or notFound
    if (
      err?.message === 'NEXT_REDIRECT' ||
      err?.digest?.startsWith('NEXT_REDIRECT') ||
      err?.message === 'NEXT_NOT_FOUND' ||
      err?.digest?.startsWith('NEXT_NOT_FOUND')
    ) {
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
