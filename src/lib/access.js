import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { getDb, retryDbRead } from './db';

const SERVER_SESSION_TTL_MS = 30 * 1000;
const SERVER_SESSION_MAX_ENTRIES = 500;
const serverSessionCache =
  globalThis.__tubelock_shared_sessions || (globalThis.__tubelock_shared_sessions = new Map());

export function evictCachedServerSession(token) {
  if (token) {
    serverSessionCache.delete(token);
  }
}

export async function getServerSessionByToken(token, sql) {
  if (typeof token !== 'string' || token.length === 0 || token.length > 64) return null;
  const now = Date.now();
  const cached = serverSessionCache.get(token);
  if (cached?.expiresAt > now) return cached.lookup;

  serverSessionCache.delete(token);
  if (serverSessionCache.size >= SERVER_SESSION_MAX_ENTRIES) {
    serverSessionCache.delete(serverSessionCache.keys().next().value);
  }

  const entry = { expiresAt: now + SERVER_SESSION_TTL_MS };
  entry.lookup = (async () => {
    const query = sql ?? getDb();
    const [row] = await retryDbRead(() => query`
      SELECT u.id, u.provider, u.name, u.email, u.picture, u.handle,
             s.id AS session_id, s.expires_at
      FROM user_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.session_token = ${token}
        AND s.is_active = TRUE
        AND s.expires_at > NOW()
      LIMIT 1;
    `);

    if (!row) return null;
    const { session_id: sessionId, expires_at: expiresAt, ...user } = row;
    entry.expiresAt = Math.min(entry.expiresAt, new Date(expiresAt).getTime());
    return { sessionId, user: { ...user, isAdmin: isAdmin(user.id) } };
  })();

  serverSessionCache.set(token, entry);
  let session;
  try {
    session = await entry.lookup;
    return session;
  } finally {
    // A revocation may already have removed or replaced this lookup.
    if (!session && serverSessionCache.get(token) === entry) {
      serverSessionCache.delete(token);
    }
  }
}

export const getCachedServerSession = cache(async () => {
  try {
    const token = (await cookies()).get('tubelock_session')?.value;
    return (await getServerSessionByToken(token))?.user ?? null;
  } catch {
    return null;
  }
});

export async function getSessionUserId(sql) {
  const token = (await cookies()).get('tubelock_session')?.value;
  return (await getServerSessionByToken(token, sql))?.user.id ?? null;
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
