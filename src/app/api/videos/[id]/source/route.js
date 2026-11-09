import { NextResponse } from 'next/server';
import { decodeVideoSlug } from '@/lib/videoUtils';
import { resolveVideoSourceServer } from '@/lib/videoSourceService';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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

    const { data, path, notReady } = await resolveVideoSourceServer(id, { forceFresh });

    if (notReady) {
      return NextResponse.json(data, { status: 422, headers: timing(path) });
    }

    return NextResponse.json(data, { headers: timing(path) });
  } catch (err) {
    console.error('[API_VIDEO_SOURCE_ERROR]:', err);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: err.message === 'Video not found' ? 404 : 500 }
    );
  }
}
