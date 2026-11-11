import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from './db';

export async function getSessionUserId(sql = getDb()) {
  const token = (await cookies()).get('tubelock_session')?.value;
  if (!token) return null;

  const [session] = await sql`
    SELECT user_id FROM user_sessions
    WHERE session_token = ${token} AND is_active = TRUE AND expires_at > NOW()
    LIMIT 1;
  `;
  return session?.user_id ?? null;
}

export function isAdmin(userId) {
  if (userId == null) return false;
  return (process.env.TUBELOCK_ADMIN_USER_IDS || '').split(',')
    .some((id) => id.trim() === String(userId));
}

export function accessError(status) {
  const errors = { 401: 'Authentication required', 403: 'Forbidden', 404: 'Video not found' };
  return NextResponse.json({ success: false, error: errors[status] }, { status });
}
