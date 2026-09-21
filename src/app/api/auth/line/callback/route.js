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
        // 1. แลก Authorization Code → Token (ได้ทั้ง access_token และ id_token)
        const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/line/callback`,
                client_id: process.env.LINE_CLIENT_ID,
                client_secret: process.env.LINE_CLIENT_SECRET,
            }),
        });
        const tokenData = await tokenRes.json();
        if (!tokenRes.ok) throw new Error(tokenData.error_description || 'Line token exchange failed');

        // 2. ดึงอีเมลและข้อมูลโปรไฟล์จาก id_token ผ่าน Verify API
        let email = '', name = '', picture = '', sub = '';

        if (tokenData.id_token) {
            const verifyRes = await fetch('https://api.line.me/oauth2/v2.1/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    id_token: tokenData.id_token,
                    client_id: process.env.LINE_CLIENT_ID,
                }),
            });
            const verifyData = await verifyRes.json();
            if (verifyRes.ok) {
                email   = verifyData.email   || '';
                name    = verifyData.name    || '';
                picture = verifyData.picture || '';
                sub     = verifyData.sub     || '';
            }
        }

        // 3. Fallback: ดึงจาก /v2/profile ถ้าชื่อหรือรูปยังหายอยู่
        if (!name || !picture) {
            const profileRes = await fetch('https://api.line.me/v2/profile', {
                headers: { Authorization: `Bearer ${tokenData.access_token}` },
            });
            if (profileRes.ok) {
                const profile = await profileRes.json();
                name    = name    || profile.displayName;
                picture = picture || profile.pictureUrl || '';
                sub     = sub     || profile.userId;
            }
        }

        // 4. Init DB tables (idempotent)
        await initTables();
        const sql = getDb();

        // 5. Upsert user
        const [user] = await sql`
            INSERT INTO users (provider, sub, name, email, picture, updated_at)
            VALUES ('line', ${sub}, ${name || null}, ${email || null}, ${picture || null}, NOW())
            ON CONFLICT (provider, sub) DO UPDATE
            SET name = EXCLUDED.name,
                email = EXCLUDED.email,
                picture = EXCLUDED.picture,
                updated_at = NOW()
            RETURNING id
        `;

        // 6. Parse Device Info จาก User-Agent
        const ua = request.headers.get('user-agent') || '';
        const { device_type, device_name, os, browser } = parseUserAgent(ua);

        // 7. ดึง IP และ GeoIP (non-blocking)
        const ip = getRealIP(request);
        const geo = await fetchGeoIP(ip);

        // 8. สร้าง Session Token และบันทึกลง DB
        const sessionToken = generateSessionToken();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 วัน

        await sql`
            INSERT INTO user_sessions (
                session_token, user_id, provider,
                device_type, device_name, os, browser,
                ip_address, country, city,
                expires_at
            ) VALUES (
                ${sessionToken}, ${user.id}, 'line',
                ${device_type}, ${device_name}, ${os}, ${browser},
                ${ip}, ${geo?.country || null}, ${geo?.city || null},
                ${expiresAt.toISOString()}
            )
        `;

        // 9. Set Cookie (เก็บแค่ token)
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
        console.error('LINE Auth Error:', err);
        return NextResponse.redirect(new URL('/login?error=auth_failed', request.url));
    }
}