import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { evictCachedServerSession, getServerSessionByToken } from '@/lib/access';
import { apiError } from '@/lib/apiError';
import { getDb } from '@/lib/db';
import { fetchGeoIP, isPrivateIP, parseUserAgent } from '@/lib/sessionUtils';

// ─── GET /api/auth/sessions ───────────────────────────────────────────────────
// Returns all active sessions for the current user (with automatic GeoIP backfill for missing locations)
export async function GET() {
    const cookieStore = await cookies();
    const token = cookieStore.get('tubelock_session')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const sql = getDb();
        const current = await getServerSessionByToken(token, sql);
        if (!current) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const sessions = await sql`
            SELECT
                id,
                device_type,
                device_name,
                os,
                browser,
                ip_address,
                country,
                city,
                created_at,
                last_seen_at,
                expires_at
            FROM user_sessions
            WHERE user_id  = ${current.user.id}
              AND is_active = TRUE
              AND expires_at > NOW()
            ORDER BY last_seen_at DESC
        `;

        // Auto-backfill missing GeoIP locations (cached by IP within this request & persisted to DB)
        const geoCache = new Map();
        const enriched = await Promise.all(
            sessions.map(async (s) => {
                let country = s.country;
                let city = s.city;
                if ((!country || !city) && s.ip_address && !isPrivateIP(s.ip_address)) {
                    let geo = geoCache.get(s.ip_address);
                    if (geo === undefined) {
                        geo = await fetchGeoIP(s.ip_address);
                        geoCache.set(s.ip_address, geo || null);
                    }
                    if (geo && (geo.country || geo.city)) {
                        country = geo.country || country;
                        city = geo.city || city;
                        sql`
                            UPDATE user_sessions
                            SET country = ${country}, city = ${city}
                            WHERE id = ${s.id};
                        `.catch(() => {});
                    }
                }
                return {
                    ...s,
                    country,
                    city,
                    is_current: s.id === current.sessionId,
                };
            })
        );

        return NextResponse.json({ sessions: enriched });
    } catch (err) {
        return apiError(err, { context: 'GET /api/auth/sessions' });
    }
}

// ─── PATCH /api/auth/sessions ─────────────────────────────────────────────────
// Enriches the current session with high-entropy Client Hints (Windows 11 vs 10, real phone model, arch, PWA)
export async function PATCH(request) {
    const cookieStore = await cookies();
    const token = cookieStore.get('tubelock_session')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const sql = getDb();
        const current = await getServerSessionByToken(token, sql);
        if (!current) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const body = await request.json().catch(() => ({}));
        const ua = request.headers.get('user-agent') || '';
        const parsed = parseUserAgent(ua, {
            model: typeof body.model === 'string' ? body.model.slice(0, 60) : '',
            platformVersion: typeof body.platformVersion === 'string' ? body.platformVersion.slice(0, 32) : '',
            architecture: typeof body.architecture === 'string' ? body.architecture.slice(0, 24) : '',
            isPwa: Boolean(body.isPwa),
        });

        await sql`
            UPDATE user_sessions
            SET
                device_type = ${parsed.device_type},
                device_name = ${parsed.device_name},
                os = ${parsed.os},
                browser = ${parsed.browser},
                last_seen_at = NOW()
            WHERE id = ${current.sessionId} AND is_active = TRUE AND expires_at > NOW();
        `;

        return NextResponse.json({ success: true, device: parsed });
    } catch (err) {
        return apiError(err, { context: 'PATCH /api/auth/sessions' });
    }
}

// ─── DELETE /api/auth/sessions ────────────────────────────────────────────────
// Body: { sessionId: number } — revoke a specific session
// Body: { all: true }         — revoke all sessions except current
export async function DELETE(request) {
    const cookieStore = await cookies();
    const token = cookieStore.get('tubelock_session')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const body = await request.json().catch(() => ({}));
        const { sessionId, all } = body ?? {};
        const targetSessionId = typeof sessionId === 'number' ||
            (typeof sessionId === 'string' && /^\d+$/.test(sessionId))
            ? Number(sessionId) : 0;
        const revokeAll = all === true;
        if (!revokeAll && (!Number.isInteger(targetSessionId) || targetSessionId < 1 || targetSessionId > 2147483647)) {
            return NextResponse.json({ error: 'A valid sessionId or all: true is required' }, { status: 400 });
        }

        const sql = getDb();
        const [result] = await sql`
            WITH actor_session AS (
                SELECT id, user_id FROM user_sessions
                WHERE session_token = ${token} AND is_active = TRUE AND expires_at > NOW()
            ),
            revoked AS (
                UPDATE user_sessions AS target
                SET is_active = FALSE
                FROM actor_session
                WHERE target.user_id = actor_session.user_id
                    AND target.id <> actor_session.id
                    AND target.is_active = TRUE
                    AND (${revokeAll} OR target.id = ${revokeAll ? 0 : targetSessionId})
                RETURNING target.session_token
            )
            SELECT EXISTS (SELECT 1 FROM actor_session) AS authorized,
                ARRAY(SELECT session_token FROM revoked) AS revoked_tokens;
        `;
        if (!result.authorized) {
            evictCachedServerSession(token);
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        for (const revokedToken of result.revoked_tokens) evictCachedServerSession(revokedToken);

        return NextResponse.json({ success: true });
    } catch (err) {
        return apiError(err, { context: 'DELETE /api/auth/sessions' });
    }
}
