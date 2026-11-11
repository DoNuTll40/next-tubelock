import { createOAuthState } from '@/lib/oauthState';
import { NextResponse } from 'next/server';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const state = await createOAuthState('line', searchParams.get('from'), request.url);

    const rootUrl = 'https://access.line.me/oauth2/v2.1/authorize';
    const options = {
        response_type: 'code',
        client_id: process.env.LINE_CLIENT_ID,
        redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/line/callback`,
        state,
        scope: 'profile openid email',
        prompt: 'consent',
    };

    const qs = new URLSearchParams(options).toString();
    return NextResponse.redirect(`${rootUrl}?${qs}`);
}