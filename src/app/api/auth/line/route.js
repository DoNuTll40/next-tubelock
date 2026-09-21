import { NextResponse } from 'next/server';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from') || '/';

    const rootUrl = 'https://access.line.me/oauth2/v2.1/authorize';
    const options = {
        response_type: 'code',
        client_id: process.env.LINE_CLIENT_ID,
        redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/line/callback`,
        state: from, // ส่งหน้าที่อยากให้กลับไปต่อ
        scope: 'profile openid email',
        prompt: 'consent',
    };

    const qs = new URLSearchParams(options).toString();
    return NextResponse.redirect(`${rootUrl}?${qs}`);
}