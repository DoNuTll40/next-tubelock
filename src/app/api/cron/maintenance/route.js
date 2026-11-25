import { timingSafeEqual } from 'node:crypto';
import { apiError } from '@/lib/apiError';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const received = Buffer.from(request.headers.get('authorization') || '');
  const expected = Buffer.from(`Bearer ${secret || ''}`);
  const headers = { 'Cache-Control': 'no-store' };
  if (!secret || received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
  }

  try {
    const sql = getDb();
    await sql.transaction([
      sql`DELETE FROM video_view_log WHERE bucket < FLOOR(EXTRACT(EPOCH FROM NOW()) / 900)::bigint - 1`,
      sql`DELETE FROM api_rate_limits WHERE window_start < NOW() - INTERVAL '1 day'`,
      sql`DELETE FROM upload_reservations WHERE expires_at < NOW()`,
    ]);
    return Response.json({ success: true }, { headers });
  } catch (error) {
    return apiError(error, { context: 'GET /api/cron/maintenance' });
  }
}
