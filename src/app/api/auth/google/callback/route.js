import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';
import { initTables } from '@/lib/initDb';
import { generateSessionToken, parseUserAgent, fetchGeoIP, getRealIP } from '@/lib/sessionUtils';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const returnTo = searchParams.get('state') || '/';

    if (!code) {
        return NextResponse.redirect(new URL('/login?error=no_code', request.url));
    }

    try {
        // 1. แลก Authorization Code → Token
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: process.env.GOOGLE_CLIENT_ID,
                client_secret: process.env.GOOGLE_CLIENT_SECRET,
                redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google/callback`,
                grant_type: 'authorization_code',
            }),
        });
        const tokenData = await tokenRes.json();
        if (!tokenRes.ok) throw new Error(tokenData.error || 'Token exchange failed');

        // 2. ดึงข้อมูลผู้ใช้จาก Google
        const userRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const userData = await userRes.json();

        // 3. Init DB tables (idempotent)
        await initTables();
        const sql = getDb();

        // 4. Upsert user (สร้างถ้าไม่มี, อัพเดทถ้ามีแล้ว)
        const [user] = await sql`
            INSERT INTO users (provider, sub, name, email, picture, updated_at)
            VALUES ('google', ${userData.sub}, ${userData.name || null}, ${userData.email || null}, ${userData.picture || null}, NOW())
            ON CONFLICT (provider, sub) DO UPDATE
            SET name = EXCLUDED.name,
                email = EXCLUDED.email,
                picture = EXCLUDED.picture,
                updated_at = NOW()
            RETURNING id
        `;

        // 5. Parse Device Info จาก User-Agent
        const ua = request.headers.get('user-agent') || '';
        const { device_type, device_name, os, browser } = parseUserAgent(ua);

        // 6. ดึง IP และ GeoIP (non-blocking)
        const ip = getRealIP(request);
        const geo = await fetchGeoIP(ip);

        // 7. สร้าง Session Token และบันทึกลง DB
        const sessionToken = generateSessionToken();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 วัน

        await sql`
            INSERT INTO user_sessions (
                session_token, user_id, provider,
                device_type, device_name, os, browser,
                ip_address, country, city,
                expires_at
            ) VALUES (
                ${sessionToken}, ${user.id}, 'google',
                ${device_type}, ${device_name}, ${os}, ${browser},
                ${ip}, ${geo?.country || null}, ${geo?.city || null},
                ${expiresAt.toISOString()}
            )
        `;

        // 8. Set Cookie (เก็บแค่ token — ไม่ฝัง JSON อีกต่อไป)
        const cookieStore = await cookies();
        cookieStore.set('tubelock_session', sessionToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 60 * 60 * 24 * 7,
            path: '/',
        });

        const targetUrl = returnTo.startsWith('/') ? returnTo : '/';
        return NextResponse.redirect(new URL(targetUrl, request.url));
    } catch (err) {
        console.error('Google Auth Error:', err);
        return NextResponse.redirect(new URL('/login?error=auth_failed', request.url));
    }
}