import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';

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
// Returns all active sessions for the current user
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

        return NextResponse.json({
            sessions: sessions.map((s) => ({
                ...s,
                is_current: s.id === current.session_id,
            })),
        });
    } catch (err) {
        console.error('[Sessions GET Error]:', err);
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
            // ออกจากระบบทุกเครื่องยกเว้น current
            await sql`
                UPDATE user_sessions
                SET is_active = FALSE
                WHERE user_id = ${current.user_id}
                  AND id != ${current.session_id}
                  AND is_active = TRUE
            `;
        } else if (sessionId) {
            // ออกจากระบบเครื่องนั้น (ห้าม revoke current ของตัวเอง)
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
