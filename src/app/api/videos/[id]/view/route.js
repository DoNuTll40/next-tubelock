import { getSessionUserId, isAdmin } from '@/lib/access';
import { apiError } from '@/lib/apiError';
import { getDb } from '@/lib/db';
import { decodeVideoSlug } from '@/lib/videoUtils';
import { recordVerifiedView } from '@/lib/viewTracker';

export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store' };

export async function POST(request, context) {
  try {
    const { id } = await context.params;
    const videoId = decodeVideoSlug(id);
    if (!videoId || videoId > 2147483647) {
      return Response.json({ success: false, error: 'Invalid video ID' }, { status: 400, headers });
    }

    // request.json() also accepts the JSON string sent as text/plain by sendBeacon.
    const usage = await request.json().catch(() => null);
    const watchTime = usage?.watchTime;
    const versionId = usage?.versionId ?? null;
    if (typeof watchTime !== 'number' || !Number.isFinite(watchTime) || watchTime < 0 ||
      (versionId != null && (!Number.isSafeInteger(versionId) || versionId < 1 || versionId > 2147483647))) {
      return Response.json({ success: false, error: 'Invalid view data' }, { status: 400, headers });
    }

    const sql = getDb();
    const userId = await getSessionUserId(sql);
    if (userId == null) {
      return Response.json({ success: false, error: 'Authentication required' }, { status: 401, headers });
    }
    const { status, body } = await recordVerifiedView(sql, {
      videoId, versionId, watchTime, viewer: { id: userId, isAdmin: isAdmin(userId) },
    });
    return Response.json(body, { status, headers });
  } catch (error) {
    return apiError(error, { context: 'POST /api/videos/[id]/view' });
  }
}
