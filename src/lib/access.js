import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { getDb } from './db';

const SERVER_SESSION_TTL_MS = 30 * 1000;
const SERVER_SESSION_MAX_ENTRIES = 500;
const serverSessionCache =
  globalThis.__tubelock_server_sessions || (globalThis.__tubelock_server_sessions = new Map());

export function evictCachedServerSession(token) {
  if (token) {
    serverSessionCache.delete(token);
  }
}

export const getCachedServerSession = cache(async () => {
  try {
    const token = (await cookies()).get('tubelock_session')?.value;
    if (!token) return null;

    const cached = serverSessionCache.get(token);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.session;
    }
    serverSessionCache.delete(token);

    const sql = getDb();
    const [row] = await sql`
      SELECT u.id, u.provider, u.name, u.email, u.picture, u.handle
      FROM user_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.session_token = ${token}
        AND s.is_active = TRUE
        AND s.expires_at > NOW()
      LIMIT 1;
    `;

    const session = row ? { ...row, isAdmin: isAdmin(row.id) } : null;
    if (session) {
      if (serverSessionCache.size >= SERVER_SESSION_MAX_ENTRIES) {
        const oldestKey = serverSessionCache.keys().next().value;
        if (oldestKey) serverSessionCache.delete(oldestKey);
      }
      serverSessionCache.set(token, {
        session,
        expiresAt: Date.now() + SERVER_SESSION_TTL_MS,
      });
    }
    return session;
  } catch {
    return null;
  }
});

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
