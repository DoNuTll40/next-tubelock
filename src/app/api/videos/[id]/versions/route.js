import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSessionUserId, isAdmin } from '@/lib/access';
import { decodeVideoSlug } from '@/lib/videoUtils';
import { getVideoVersions, formatVersionSummary } from '@/lib/videoVersions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/videos/[id]/versions
 * Lists versions for a video (public sees READY versions; owner/admin with ?all=1 sees all).
 */
export async function GET(request, context) {
  try {
    const { id: rawId } = await context.params;
    const id = decodeVideoSlug(rawId) || parseInt(rawId, 10);
    if (!id || Number.isNaN(id)) {
      return NextResponse.json({ success: false, error: 'Video ID is required' }, { status: 400 });
    }

    const sql = getDb();
    const wantsAll = new URL(request.url).searchParams.get('all') === '1';

    let allowAll = false;
    if (wantsAll) {
      const userId = await getSessionUserId(sql);
      if (userId != null) {
        const ownerRows = await sql`SELECT user_id FROM videos WHERE id = ${id} LIMIT 1;`;
        if (ownerRows.length > 0 && (isAdmin(userId) || ownerRows[0].user_id === userId)) {
          allowAll = true;
        }
      }
    }

    const rows = await getVideoVersions(sql, id, { readyOnly: !allowAll });
    return NextResponse.json(
      {
        success: true,
        videoId: id,
        versions: rows.map(formatVersionSummary),
      },
      {
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      }
    );
  } catch (err) {
    console.error('[GET_VIDEO_VERSIONS_ERROR]:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
