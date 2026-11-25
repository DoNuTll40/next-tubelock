import { getSessionUserId, isAdmin } from '@/lib/access';
import { apiError } from '@/lib/apiError';
import { getDb } from '@/lib/db';
import { NextResponse } from 'next/server';
import { decodeVideoSlug } from '@/lib/videoUtils';
import { canViewVideo } from '@/lib/videoVisibility';
import { POSTER_PREFERENCE } from '@/lib/posterPreference';
import { protectSourcePreviews, resolveVideoSourceServer } from '@/lib/videoSourceService';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

// Prevent Vercel CDN from caching expiring OneDrive tempauth tokens
const EDGE_CACHE_HEADERS = {
  'Cache-Control': 'private, no-cache, no-store, must-revalidate',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
};

/**
 * GET /api/videos/[id]/source
 * Resolves direct playback URL from OneDrive via Azure Client Secret with 0ms in-memory cache & request coalescing
 */
export async function GET(request, context) {
  const t0 = performance.now();
  const timing = (path) => ({
    ...EDGE_CACHE_HEADERS,
    'Server-Timing': `total;dur=${(performance.now() - t0).toFixed(1)}, path;desc="${path}"`,
  });

  try {
    const { id: rawId } = await context.params;
    const numericId = decodeVideoSlug(rawId) || parseInt(rawId, 10);
    const id = numericId;
    if (!id || isNaN(id)) {
      return NextResponse.json({ success: false, error: 'Video ID is required' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const forceFresh = searchParams.get('fresh') === '1' || searchParams.get('refresh') === '1';
    const preferFull = searchParams.get('full') === '1';
    const requestedVersion = searchParams.get('v') || searchParams.get('versionId') || null;
    const sql = getDb();
    const [viewerUserId, [policy]] = await Promise.all([
      getSessionUserId(sql),
      sql`SELECT user_id, visibility, category, content_rating FROM videos WHERE id = ${id}`,
    ]);
    if (!policy) {
      return NextResponse.json({ success: false, error: 'Video not found' }, { status: 404, headers: timing('access') });
    }
    if (!canViewVideo(policy, viewerUserId, isAdmin(viewerUserId))) {
      return NextResponse.json({ success: false, error: 'วิดีโอนี้ตั้งค่าเป็นส่วนตัว' }, { status: 403, headers: timing('access') });
    }
    const wantsAdultPreviews = searchParams.get('previews') === '1' &&
      request.cookies.get(POSTER_PREFERENCE)?.value === '1';
    const showAdultPreviews = wantsAdultPreviews && Boolean(viewerUserId);

    const { data, path, notReady } = await resolveVideoSourceServer(id, {
      forceFresh,
      showAdultPreviews,
      version: requestedVersion,
      preferFull,
    });

    if (notReady || !data?.video || (data.video.status && data.video.status !== 'READY')) {
      return NextResponse.json({ success: false, error: 'Video not found' }, { status: 404, headers: timing(path) });
    }

    const video = { ...data.video, ...policy, visibility: policy.visibility ?? 'public' };
    const responseData = { ...data, video };
    return NextResponse.json(showAdultPreviews ? responseData : protectSourcePreviews(responseData, video), { headers: timing(path) });
  } catch (err) {
    if (err.message === 'Video not found') {
      return NextResponse.json({ success: false, error: 'Video not found' }, { status: 404, headers: EDGE_CACHE_HEADERS });
    }
    return apiError(err, { context: 'GET /api/videos/[id]/source', headers: EDGE_CACHE_HEADERS });
  }
}
