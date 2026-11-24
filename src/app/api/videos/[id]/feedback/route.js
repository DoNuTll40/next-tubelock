import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCachedServerSession, accessError } from '@/lib/access';
import { decodeVideoSlug } from '@/lib/videoUtils';

export const dynamic = 'force-dynamic';

const VALID_FEEDBACK_TYPES = new Set(['not_interested', 'dont_recommend_channel']);

/**
 * POST /api/videos/[id]/feedback
 * Records or undoes user recommendation feedback ("Not Interested").
 */
export async function POST(request, context) {
  try {
    const sql = getDb();
    const session = await getCachedServerSession();
    const userId = session?.id ?? null;
    if (userId == null) return accessError(401);

    const { id: rawId } = await context.params;
    const videoId = decodeVideoSlug(rawId) || parseInt(rawId, 10);
    if (!videoId || Number.isNaN(videoId)) {
      return NextResponse.json({ success: false, error: 'Invalid video ID' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const action = String(body.action || 'hide').toLowerCase();
    const feedbackType = VALID_FEEDBACK_TYPES.has(body.feedbackType)
      ? body.feedbackType
      : 'not_interested';

    if (action === 'undo' || action === 'remove') {
      await sql`
        DELETE FROM user_video_feedback
        WHERE user_id = ${userId} AND video_id = ${videoId};
      `;
      return NextResponse.json({ success: true, hidden: false, videoId });
    }

    await sql`
      INSERT INTO user_video_feedback (user_id, video_id, feedback_type, created_at)
      VALUES (${userId}, ${videoId}, ${feedbackType}, NOW())
      ON CONFLICT (user_id, video_id)
      DO UPDATE SET feedback_type = EXCLUDED.feedback_type, created_at = NOW();
    `;

    return NextResponse.json({ success: true, hidden: true, feedbackType, videoId });
  } catch (err) {
    console.error('[API_VIDEO_FEEDBACK_ERROR]:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
