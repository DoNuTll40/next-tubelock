import { safeReturnUrl } from '@/lib/oauthState';
import { evictCachedServerSession } from '@/lib/access';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const redirectTo = searchParams.get('from') || '/login';

    const cookieStore = await cookies();
    const token = cookieStore.get('tubelock_session')?.value;

    // Deactivate session in DB (soft delete) and evict from proxy & server memory caches
    if (token) {
        globalThis.__tubelock_proxy_sessions?.delete(token);
        evictCachedServerSession(token);
        try {
            const sql = getDb();
            await sql`
                UPDATE user_sessions
                SET is_active = FALSE
                WHERE session_token = ${token}
            `;
        } catch (err) {
            console.error('[Logout DB Error]:', err);
        }
    }

    // Clear cookie
    cookieStore.set('tubelock_session', '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 0,
        path: '/',
    });

    return NextResponse.redirect(safeReturnUrl(redirectTo, request.url, '/login'));
}
