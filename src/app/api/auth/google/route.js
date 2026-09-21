import { NextResponse } from 'next/server';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from') || '/';

    const rootUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
    const options = {
        redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google/callback`,
        client_id: process.env.GOOGLE_CLIENT_ID,
        access_type: 'offline',
        response_type: 'code',
        prompt: 'consent',
        state: from, // 👈 ฝาก path ที่จะให้กลับไป (เช่น /upload) ไว้ใน state
        scope: [
            'openid',
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/userinfo.email',
        ].join(' '),
    };

    const qs = new URLSearchParams(options).toString();
    return NextResponse.redirect(`${rootUrl}?${qs}`);
}