import { getCachedServerSession, isAdmin } from '@/lib/access';
import { canViewVideo } from '@/lib/videoVisibility';
import { POSTER_PREFERENCE } from '@/lib/posterPreference';
import { protectVideoPoster } from '@/lib/videoUtils';
import { notFound, redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { getDb } from '@/lib/db';
import { parseTimestamp, isMusicVideo, decodeVideoSlug, encodeVideoSlug } from '@/lib/videoUtils';
import { prewarmVideoSourceServer, getCachedVideoSourceSync } from '@/lib/videoSourceService';
import {
  getVideoVersions,
  formatVersionSummary,
  resolveRequestedVersion,
} from '@/lib/videoVersions';
import { rankRelatedVideos } from '@/lib/recommendationEngine';
import WatchClient from './WatchClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const viewport = { viewportFit: 'cover' };

// Deduplicate video query between generateMetadata and WatchPage in the same request
const getVideoById = cache(async (numericId) => {
  if (!numericId) return null;
  const sql = getDb();
  try {
    const rows = await sql`
      SELECT 
        v.id, v.title, v.description, v.duration, v.file_size_bytes, v.resolution,
        v.fps, v.codec, v.bitrate, v.thumbnail_url, v.tags, v.category, v.views_count, v.created_at,
        v.status, v.source_type, v.user_id, v.onedrive_item_id, v.onedrive_folder_id, v.raw_file_name,
        v.subtitle_status,
        CASE WHEN jsonb_array_length(COALESCE(v.subtitle_tracks, '[]'::jsonb)) > 0 THEN '' ELSE COALESCE(v.subtitle_srt, '') END AS subtitle_srt,
        CASE WHEN jsonb_array_length(COALESCE(v.subtitle_tracks, '[]'::jsonb)) > 0 THEN '' ELSE COALESCE(v.subtitle_vtt, '') END AS subtitle_vtt,
        v.subtitle_tracks, v.content_rating, COALESCE(v.visibility, 'public') AS visibility,
        u.name AS author_name, u.picture AS author_picture, u.handle AS author_handle
      FROM videos v
      LEFT JOIN users u ON v.user_id = u.id
      WHERE v.id = ${numericId} AND (v.status = 'READY' OR v.status IS NULL)
      LIMIT 1;
    `;
    return rows?.[0] || null;
  } catch (err) {
    // Schema resilience: if a newly added column is missing on DB, fallback to SELECT v.*
    console.warn('[getVideoById] Primary query failed, falling back to SELECT v.*:', err?.message);
    try {
      const rows = await sql`
        SELECT 
          v.*,
          u.name AS author_name, u.picture AS author_picture
        FROM videos v
        LEFT JOIN users u ON v.user_id = u.id
        WHERE v.id = ${numericId} AND (v.status = 'READY' OR v.status IS NULL)
        LIMIT 1;
      `;
      return rows?.[0] || null;
    } catch (fallbackErr) {
      console.error('[getVideoById] Fallback query failed:', fallbackErr?.message);
      return null;
    }
  }
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

    const visibility = String(video.visibility || 'public').toLowerCase();
    if (visibility === 'private') {
      return {
        title: 'วิดีโอส่วนตัว - TubeLock',
        description: 'วิดีโอนี้ถูกตั้งค่าเป็นส่วนตัวบน TubeLock',
        robots: { index: false, follow: false },
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
      ...(visibility !== 'public' ? { robots: { index: false, follow: false } } : {}),
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
  if (!rawSlug || rawSlug === 'undefined' || rawSlug === 'null') {
    redirect('/');
  }

  const numericId = decodeVideoSlug(rawSlug);
  if (!numericId) {
    notFound();
  }

  const resolvedSearchParams = searchParams ? await searchParams : {};
  const requestedVersion = resolvedSearchParams?.v ? String(resolvedSearchParams.v).trim() : null;
  const initialTime = parseTimestamp(resolvedSearchParams?.t);

  // ⚡ Kick off server-side source resolution immediately during SSR (non-blocking)
  // Shares inFlightRequests & sourceCache with /api/videos/[id]/source
  prewarmVideoSourceServer(numericId, { version: requestedVersion });

  const sql = getDb();

  // Reuse request-deduped & 30s cached session from RootLayout (0 extra DB queries!)
  const [cookieStore, session] = await Promise.all([cookies(), getCachedServerSession()]);
  const userId = session?.id ?? null;

  let video = null;
  let relatedVideos = [];
  let isPrivateBlocked = false;

  try {
    // ⚡ Performance Optimization:
    // 1. getVideoById is deduplicated via React cache() (0 extra DB hit)
    // 2. relatedRows runs in parallel with video + versions lookup & omits heavy v.description
    // 3. LIMIT 48 feeds the multi-signal recommendation scorer on SSR cleanly
    const relatedQueryPromise = (userId
      ? sql`
          SELECT 
            v.id, v.title, v.duration, v.file_size_bytes, v.resolution, v.fps, v.codec,
            v.thumbnail_url, v.tags, v.category, v.content_rating, v.views_count, v.created_at,
            v.status, v.source_type, v.user_id,
            h.last_position_seconds,
            (h.id IS NOT NULL) AS has_watched,
            u.name AS author_name, u.picture AS author_picture, u.handle AS author_handle
          FROM videos v
          LEFT JOIN users u ON v.user_id = u.id
          LEFT JOIN watch_history h ON h.video_id = v.id AND h.user_id = ${userId}
          WHERE (v.status = 'READY' OR v.status IS NULL)
            AND COALESCE(v.visibility, 'public') = 'public'
            AND v.id != ${numericId}
          ORDER BY v.created_at DESC
          LIMIT 48;
        `
      : sql`
          SELECT 
            v.id, v.title, v.duration, v.file_size_bytes, v.resolution, v.fps, v.codec,
            v.thumbnail_url, v.tags, v.category, v.content_rating, v.views_count, v.created_at,
            v.status, v.source_type, v.user_id,
            NULL AS last_position_seconds,
            FALSE AS has_watched,
            u.name AS author_name, u.picture AS author_picture, u.handle AS author_handle
          FROM videos v
          LEFT JOIN users u ON v.user_id = u.id
          WHERE (v.status = 'READY' OR v.status IS NULL)
            AND COALESCE(v.visibility, 'public') = 'public'
            AND v.id != ${numericId}
          ORDER BY v.created_at DESC
          LIMIT 48;
        `).catch((relErr) => {
          console.warn('[WatchPage] Related videos query failed gracefully:', relErr?.message);
          return [];
        });

    const [rawVideo, readyVersions, relatedRows] = await Promise.all([
      getVideoById(numericId),
      getVideoVersions(sql, numericId, { readyOnly: true }),
      relatedQueryPromise,
    ]);

    if (!rawVideo) {
      notFound();
    }

    if (!canViewVideo(rawVideo, userId, userId != null && isAdmin(userId))) {
      isPrivateBlocked = true;
    } else {
    let lastWatchedVersionId = null;
    let subscriberCount = 0;
    let isSubscribed = false;
    try {
      const [subCountRows, viewerSubRows] = await Promise.all([
        rawVideo.user_id != null
          ? sql`SELECT COUNT(*)::int AS cnt FROM subscriptions WHERE channel_id = ${rawVideo.user_id};`
          : Promise.resolve([]),
        userId != null && rawVideo.user_id != null && Number(userId) !== Number(rawVideo.user_id)
          ? sql`SELECT 1 FROM subscriptions WHERE subscriber_id = ${userId} AND channel_id = ${rawVideo.user_id} LIMIT 1;`
          : Promise.resolve([]),
      ]);
      subscriberCount = Number(subCountRows?.[0]?.cnt || 0);
      isSubscribed = viewerSubRows.length > 0;
    } catch (_) {}

    if (userId && !requestedVersion && readyVersions.length > 1) {
      try {
        const histRows = await sql`
          SELECT last_version_id
          FROM watch_history
          WHERE user_id = ${userId} AND video_id = ${numericId}
          LIMIT 1;
        `;
        lastWatchedVersionId = histRows?.[0]?.last_version_id || null;
      } catch (_) {}
    }

    const activeVersion = resolveRequestedVersion(
      readyVersions,
      requestedVersion || lastWatchedVersionId
    );
    if (activeVersion && !requestedVersion && lastWatchedVersionId) {
      prewarmVideoSourceServer(numericId, { version: activeVersion.id });
    }

    const {
      source_cache,
      source_cache_br,
      source_cache_items_count,
      source_cache_expires_at,
      ...publicVideo
    } = rawVideo;
    const videoRows = [protectVideoPoster(publicVideo)];
    const canonicalSlug = encodeVideoSlug(videoRows[0].id, videoRows[0].category) || String(videoRows[0].id);

    // If thumbnail is a heavy data URI, replace with lightweight /api/og endpoint to save ~200 KB HTML
    const safeThumbnail = videoRows[0].thumbnail_url?.startsWith('data:')
      ? `/api/og/${canonicalSlug}.jpg`
      : videoRows[0].thumbnail_url;

    const baseMerged = activeVersion
      ? {
          ...videoRows[0],
          duration: Number(activeVersion.duration) || videoRows[0].duration,
          file_size_bytes: Number(activeVersion.file_size_bytes) || videoRows[0].file_size_bytes,
          resolution: activeVersion.resolution || videoRows[0].resolution,
          fps: activeVersion.fps ?? videoRows[0].fps,
          codec: activeVersion.codec || videoRows[0].codec,
          ...(Array.isArray(activeVersion.subtitle_tracks_override) &&
          activeVersion.subtitle_tracks_override.length > 0
            ? { subtitle_tracks: activeVersion.subtitle_tracks_override }
            : {}),
          versions: readyVersions.map(formatVersionSummary),
          active_version: formatVersionSummary(activeVersion),
        }
      : {
          ...videoRows[0],
          versions: [],
          active_version: null,
        };

    video = {
      ...baseMerged,
      thumbnail_url: safeThumbnail,
      slug: canonicalSlug,
      created_at: videoRows[0].created_at ? new Date(videoRows[0].created_at).toISOString() : null,
      views_count: Number(videoRows[0].views_count || 0),
      subscribers_count: subscriberCount,
      is_subscribed: isSubscribed,
    };

    // Canonical URL redirection: if accessed with numeric ID or dirty slug (e.g. /watch/851 or /watch/...undefined)
    if (/^\d+$/.test(rawSlug) || rawSlug.includes('undefined') || (canonicalSlug && canonicalSlug !== rawSlug)) {
      if (canonicalSlug && canonicalSlug !== rawSlug) {
        const redirectQuery = new URLSearchParams();
        if (resolvedSearchParams?.t) redirectQuery.set('t', resolvedSearchParams.t);
        if (requestedVersion) redirectQuery.set('v', requestedVersion);
        for (const key of ['list', 'index', 'shuffle']) {
          const value = resolvedSearchParams?.[key];
          const firstValue = Array.isArray(value) ? value[0] : value;
          if (firstValue) redirectQuery.set(key, firstValue);
        }
        const qs = redirectQuery.toString();
        redirect(`/watch/${canonicalSlug}${qs ? `?${qs}` : ''}`);
      }
    }

    const mappedRelated = relatedRows.map((row) => {
      const item = protectVideoPoster(row);
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

    let subscribedChannelIds = [];
    let notInterestedIds = [];
    if (userId) {
      try {
        const [subIdsRows, fbIdsRows] = await Promise.all([
          sql`SELECT channel_id FROM subscriptions WHERE subscriber_id = ${userId};`,
          sql`SELECT video_id FROM user_video_feedback WHERE user_id = ${userId};`,
        ]);
        subscribedChannelIds = subIdsRows.map((r) => r.channel_id);
        notInterestedIds = fbIdsRows.map((r) => r.video_id);
      } catch (_) {}
    }

    relatedVideos = rankRelatedVideos(video, mappedRelated, {
      subscribedChannelIds,
      notInterestedIds,
      limit: 48,
    });
    }
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

  if (isPrivateBlocked) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center px-6 text-center gap-3">
        <div className="w-14 h-14 rounded-2xl bg-[#FF7A00]/15 border border-[#FF7A00]/30 flex items-center justify-center text-[#FF7A00] text-2xl">
          🔒
        </div>
        <h1 className="text-xl font-bold text-[#212529] dark:text-[#F1F1F1]">วิดีโอนี้เป็นส่วนตัว</h1>
        <p className="text-sm text-[#6C757D] dark:text-[#AAAAAA] max-w-md">
          เจ้าของวิดีโอตั้งค่าความเป็นส่วนตัวไว้ เฉพาะเจ้าของเท่านั้นที่สามารถเปิดรับชมได้
        </p>
      </div>
    );
  }

  const isMusic = isMusicVideo(video);
  const resolvedTime = isMusic ? 0 : initialTime;
  const showAdultPosters = Boolean(userId) && cookieStore.get(POSTER_PREFERENCE)?.value === '1';
  const ssrWarmSource = getCachedVideoSourceSync(numericId, {
    showAdultPreviews: showAdultPosters,
    version: requestedVersion || video?.active_version?.versionKey || video?.active_version?.id || null,
  });

  return (
    <WatchClient
      initialVideo={video}
      initialShowAdultPosters={showAdultPosters}
      initialRelated={relatedVideos}
      initialTime={resolvedTime}
      initialSource={ssrWarmSource}
    />
  );
}
