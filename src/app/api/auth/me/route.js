import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';

export async function GET() {
    const cookieStore = await cookies();
    const token = cookieStore.get('tubelock_session')?.value;

    if (!token) return NextResponse.json({ session: null });

    try {
        const sql = getDb();

        // Query session + user info in one join, and update last_seen_at
        const [row] = await sql`
            UPDATE user_sessions
            SET last_seen_at = NOW()
            WHERE session_token = ${token}
              AND is_active = TRUE
              AND expires_at > NOW()
            RETURNING user_id, id AS session_id, provider
        `;

        if (!row) return NextResponse.json({ session: null });

        // Fetch user details
        const [user] = await sql`
            SELECT name, email, picture FROM users WHERE id = ${row.user_id}
        `;

        return NextResponse.json({
            session: {
                provider: row.provider,
                name:     user?.name    || null,
                email:    user?.email   || null,
                picture:  user?.picture || null,
                sessionId: row.session_id,
            },
        });
    } catch {
        return NextResponse.json({ session: null });
    }
}
