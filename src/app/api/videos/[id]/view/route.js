import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';
import { recordVerifiedView } from '@/lib/viewTracker';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * POST /api/videos/[id]/view
 * Quality Anti-Spam Batched View Count Endpoint
 */
export async function POST(request, context) {
  try {
    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ success: false, error: 'Video ID is required' }, { status: 400 });
    }

    // 1. Parse body (support both JSON and navigator.sendBeacon text/plain)
    let body = {};
    try {
      const text = await request.text();
      if (text) body = JSON.parse(text);
    } catch (_) { }

    const watchTime = Number(body.watchTime) || 0;
    const duration = Number(body.duration) || 0;

    // 2. Resolve Viewer Identity (User ID if logged in, otherwise Client IP)
    let clientKey = '';
    try {
      const cookieStore = await cookies();
      const token = cookieStore.get('tubelock_session')?.value;
      if (token) {
        const sql = getDb();
        const sessionRows = await sql`
          SELECT user_id FROM user_sessions
          WHERE session_token = ${token} AND is_active = TRUE AND expires_at > NOW()
          LIMIT 1;
        `;
        if (sessionRows.length > 0) {
          clientKey = `user_${sessionRows[0].user_id}`;
        }
      }
    } catch (_) { }

    if (!clientKey) {
      // Fallback to IP address
      const forwarded = request.headers.get('x-forwarded-for') || '';
      const ip = forwarded.split(',')[0].trim() || request.headers.get('x-real-ip') || '127.0.0.1';
      clientKey = `ip_${ip}`;
    }

    // 3. Process View through Quality & Cooldown Gate + Batch Buffer
    const result = await recordVerifiedView({
      videoId: id,
      clientKey,
      watchTime,
      duration,
    });

    return NextResponse.json(result, {
      status: result.success ? 200 : 400,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (err) {
    console.error('[API_VIEW_COUNT_ERROR]:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
