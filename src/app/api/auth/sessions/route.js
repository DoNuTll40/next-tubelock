import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';
import { fetchGeoIP, isPrivateIP, parseUserAgent } from '@/lib/sessionUtils';

// ─── Helper: resolve current user from cookie token ──────────────────────────
async function getCurrentSession(sql, token) {
    if (!token) return null;
    const [row] = await sql`
        SELECT id AS session_id, user_id
        FROM user_sessions
        WHERE session_token = ${token}
          AND is_active = TRUE
          AND expires_at > NOW()
    `;
    return row || null;
}

// ─── GET /api/auth/sessions ───────────────────────────────────────────────────
// Returns all active sessions for the current user (with automatic GeoIP backfill for missing locations)
export async function GET() {
    const cookieStore = await cookies();
    const token = cookieStore.get('tubelock_session')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const sql = getDb();
        const current = await getCurrentSession(sql, token);
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
            WHERE user_id  = ${current.user_id}
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
                    is_current: s.id === current.session_id,
                };
            })
        );

        return NextResponse.json({ sessions: enriched });
    } catch (err) {
        console.error('[Sessions GET Error]:', err);
        return NextResponse.json({ error: 'Server error' }, { status: 500 });
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
        const current = await getCurrentSession(sql, token);
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
            WHERE id = ${current.session_id};
        `;

        return NextResponse.json({ success: true, device: parsed });
    } catch (err) {
        console.error('[Sessions PATCH Error]:', err);
        return NextResponse.json({ error: 'Server error' }, { status: 500 });
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
        const { sessionId, all } = body;

        const sql = getDb();
        const current = await getCurrentSession(sql, token);
        if (!current) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        if (all) {
            await sql`
                UPDATE user_sessions
                SET is_active = FALSE
                WHERE user_id = ${current.user_id}
                  AND id != ${current.session_id}
                  AND is_active = TRUE
            `;
        } else if (sessionId) {
            await sql`
                UPDATE user_sessions
                SET is_active = FALSE
                WHERE id = ${sessionId}
                  AND user_id = ${current.user_id}
                  AND id != ${current.session_id}
            `;
        } else {
            return NextResponse.json({ error: 'sessionId or all required' }, { status: 400 });
        }

        return NextResponse.json({ success: true });
    } catch (err) {
        console.error('[Sessions DELETE Error]:', err);
        return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
}
