import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCachedServerSession, accessError } from '@/lib/access';
import { normalizeHandleInput } from '@/lib/channelHandle';

export const dynamic = 'force-dynamic';

/**
 * POST /api/channels/[handle]/subscribe
 * Toggles subscription for the authenticated user on the target channel (by handle or numeric id).
 */
export async function POST(request, context) {
  try {
    const sql = getDb();
    const session = await getCachedServerSession();
    const subscriberId = session?.id ?? null;
    if (subscriberId == null) return accessError(401);

    const { handle: rawHandle } = await context.params;
    const cleanHandle = normalizeHandleInput(rawHandle);
    if (!cleanHandle) {
      return NextResponse.json({ success: false, error: 'Channel handle is required' }, { status: 400 });
    }

    const isNumeric = /^\d+$/.test(cleanHandle);
    const channelRows = isNumeric
      ? await sql`SELECT id, handle FROM users WHERE id = ${Number(cleanHandle)} OR LOWER(handle) = LOWER(${cleanHandle}) LIMIT 1;`
      : await sql`SELECT id, handle FROM users WHERE LOWER(handle) = LOWER(${cleanHandle}) LIMIT 1;`;

    if (!channelRows.length) {
      return NextResponse.json({ success: false, error: 'ไม่พบช่องที่ต้องการติดตาม' }, { status: 404 });
    }

    const channelId = Number(channelRows[0].id);
    if (channelId === Number(subscriberId)) {
      return NextResponse.json({ success: false, error: 'ไม่สามารถติดตามช่องของตัวเองได้' }, { status: 400 });
    }

    const existing = await sql`
      SELECT 1 FROM subscriptions
      WHERE subscriber_id = ${subscriberId} AND channel_id = ${channelId}
      LIMIT 1;
    `;

    let subscribed = false;
    if (existing.length > 0) {
      await sql`
        DELETE FROM subscriptions
        WHERE subscriber_id = ${subscriberId} AND channel_id = ${channelId};
      `;
      subscribed = false;
    } else {
      await sql`
        INSERT INTO subscriptions (subscriber_id, channel_id)
        VALUES (${subscriberId}, ${channelId})
        ON CONFLICT (subscriber_id, channel_id) DO NOTHING;
      `;
      subscribed = true;
    }

    const countRows = await sql`
      SELECT COUNT(*)::int AS cnt FROM subscriptions WHERE channel_id = ${channelId};
    `;

    return NextResponse.json({
      success: true,
      subscribed,
      subscriberCount: Number(countRows[0]?.cnt || 0),
    });
  } catch (err) {
    console.error('[API_CHANNEL_SUBSCRIBE_ERROR]:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
