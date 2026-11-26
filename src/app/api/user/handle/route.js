import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';
import { getCachedServerSession, evictCachedServerSession, accessError } from '@/lib/access';
import { apiError } from '@/lib/apiError';
import { validateHandleFormat } from '@/lib/channelHandle';
import { rateLimitResponse } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

/**
 * GET /api/user/handle
 * - Without ?handle= : returns current logged-in user's channel profile (handle, bio, banner_url)
 * - With ?handle=... : checks format + uniqueness availability in real time
 */
export async function GET(request) {
  try {
    const sql = getDb();
    const session = await getCachedServerSession();
    const userId = session?.id ?? null;
    if (userId == null) return accessError(401);

    const { searchParams } = new URL(request.url);
    const rawHandle = searchParams.get('handle');

    if (rawHandle === null) {
      const rows = await sql`
        SELECT id, name, picture, handle, bio, banner_url,
          (SELECT COUNT(*)::int FROM subscriptions WHERE channel_id = users.id) AS subscriber_count,
          (SELECT LEAST(COUNT(*), 120)::int FROM videos
            WHERE user_id = users.id AND (status = 'READY' OR status IS NULL)
              AND COALESCE(visibility, 'public') = 'public') AS video_count
        FROM users
        WHERE id = ${userId}
        LIMIT 1;
      `;
      const profile = rows[0] || null;
      return NextResponse.json({
        success: true,
        profile: profile
          ? {
              id: profile.id,
              name: profile.name || '',
              picture: profile.picture || '',
              handle: profile.handle || '',
              bio: profile.bio || '',
              bannerUrl: profile.banner_url || '',
              subscriberCount: profile.subscriber_count,
              videoCount: profile.video_count,
            }
          : null,
      });
    }

    const limited = await rateLimitResponse(sql, 'handleAvailability', userId);
    if (limited) return limited;
    const check = validateHandleFormat(rawHandle);
    if (!check.valid) {
      return NextResponse.json({
        success: true,
        handle: check.handle,
        valid: false,
        available: false,
        isOwn: false,
        reason: check.reason,
      });
    }

    const existing = await sql`
      SELECT id, handle
      FROM users
      WHERE LOWER(handle) = LOWER(${check.handle})
      LIMIT 1;
    `;

    if (existing.length > 0) {
      const isOwn = Number(existing[0].id) === Number(userId);
      return NextResponse.json({
        success: true,
        handle: check.handle,
        valid: true,
        available: isOwn,
        isOwn,
        reason: isOwn ? 'นี่คือ @handle ปัจจุบันของคุณ' : 'ชื่อ @handle นี้มีผู้ใช้งานแล้ว กรุณาเลือกชื่ออื่น',
      });
    }

    return NextResponse.json({
      success: true,
      handle: check.handle,
      valid: true,
      available: true,
      isOwn: false,
      reason: 'สามารถใช้งาน @handle นี้ได้',
    });
  } catch (err) {
    return apiError(err, { context: 'GET /api/user/handle' });
  }
}

/**
 * PATCH /api/user/handle
 * Updates the current user's @handle, bio, and banner_url with case-insensitive uniqueness check.
 */
export async function PATCH(request) {
  try {
    const sql = getDb();
    const session = await getCachedServerSession();
    const userId = session?.id ?? null;
    if (userId == null) return accessError(401);

    const body = await request.json();
    const hasHandle = body.handle !== undefined;
    const hasBio = body.bio !== undefined;
    const hasBanner = body.bannerUrl !== undefined || body.banner_url !== undefined;

    let nextHandle = undefined;
    if (hasHandle) {
      const check = validateHandleFormat(body.handle);
      if (!check.valid) {
        return NextResponse.json({ success: false, error: check.reason }, { status: 400 });
      }
      const conflict = await sql`
        SELECT id FROM users
        WHERE LOWER(handle) = LOWER(${check.handle}) AND id <> ${userId}
        LIMIT 1;
      `;
      if (conflict.length > 0) {
        return NextResponse.json(
          { success: false, error: 'ชื่อ @handle นี้มีผู้ใช้งานแล้ว กรุณาเลือกชื่ออื่น' },
          { status: 409 }
        );
      }
      nextHandle = check.handle;
    }

    const nextBio = hasBio ? String(body.bio || '').trim().slice(0, 1000) : undefined;
    const rawBanner = body.bannerUrl ?? body.banner_url;
    let nextBanner = undefined;
    if (hasBanner) {
      const trimmedBanner = String(rawBanner || '').trim();
      if (trimmedBanner && !/^https?:\/\/.+/i.test(trimmedBanner) && !trimmedBanner.startsWith('/')) {
        return NextResponse.json(
          { success: false, error: 'URL ภาพแบนเนอร์ต้องขึ้นต้นด้วย https:// หรือ http://' },
          { status: 400 }
        );
      }
      nextBanner = trimmedBanner.slice(0, 2000);
    }

    const updated = await sql`
      UPDATE users
      SET
        handle = CASE WHEN ${nextHandle !== undefined} THEN ${nextHandle ?? null} ELSE handle END,
        bio = CASE WHEN ${nextBio !== undefined} THEN ${nextBio ?? ''} ELSE bio END,
        banner_url = CASE WHEN ${nextBanner !== undefined} THEN ${nextBanner ?? ''} ELSE banner_url END
      WHERE id = ${userId}
      RETURNING id, name, picture, handle, bio, banner_url;
    `;

    const token = (await cookies()).get('tubelock_session')?.value;
    if (token) evictCachedServerSession(token);

    const row = updated[0];
    return NextResponse.json({
      success: true,
      profile: {
        id: row.id,
        name: row.name || '',
        picture: row.picture || '',
        handle: row.handle || '',
        bio: row.bio || '',
        bannerUrl: row.banner_url || '',
      },
    });
  } catch (err) {
    if (String(err?.code) === '23505') {
      return NextResponse.json(
        { success: false, error: 'ชื่อ @handle นี้มีผู้ใช้งานแล้ว กรุณาเลือกชื่ออื่น' },
        { status: 409 }
      );
    }
    return apiError(err, { context: 'PATCH /api/user/handle' });
  }
}
