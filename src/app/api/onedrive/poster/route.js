import { cookies } from 'next/headers';

export async function GET(request) {
    try {
        // 1. ตรวจสอบ Session ก่อนอนุญาตให้ดึงรูป
        const cookieStore = await cookies();
        const sessionToken =
            cookieStore.get('tubelock_session')?.value ||
            request.headers.get('x-tubelock-session');

        if (!sessionToken) {
            return new Response('Unauthorized', { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const folderName = searchParams.get('folder');

        if (!folderName) {
            return new Response('Missing folder parameter', { status: 400 });
        }

        const tenantId = process.env.AZURE_TENANT_ID;
        const clientId = process.env.AZURE_CLIENT_ID;
        const clientSecret = process.env.AZURE_CLIENT_SECRET;
        const targetUser = process.env.ONEDRIVE_USER_ID;

        // 2. ขอ Token ฝั่ง Server
        const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
        const tokenRes = await fetch(tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                scope: 'https://graph.microsoft.com/.default',
                grant_type: 'client_credentials',
            }).toString(),
        });

        if (!tokenRes.ok) return new Response('Token Error', { status: 500 });
        const { access_token } = await tokenRes.json();

        // 3. ดึง Content Binary ของ poster.jpg โดยตรง
        const encodedUser = encodeURIComponent(targetUser);
        const fileUrl = `https://graph.microsoft.com/v1.0/users/${encodedUser}/drive/root:/streams/${folderName}/poster.jpg:/content`;

        const imageRes = await fetch(fileUrl, {
            headers: { Authorization: `Bearer ${access_token}` },
        });

        if (!imageRes.ok) {
            return new Response('Image not found', { status: 404 });
        }

        // 4. ส่งรูปภาพกลับไปให้เบราว์เซอร์ พร้อมแคชไว้ในเครื่อง Client (1 วัน)
        const imageBlob = await imageRes.blob();
        return new Response(imageBlob, {
            headers: {
                'Content-Type': imageRes.headers.get('Content-Type') || 'image/jpeg',
                'Cache-Control': 'public, max-age=86400, s-maxage=86400',
            },
        });
    } catch (error) {
        console.error('Poster proxy error:', error);
        return new Response('Internal Server Error', { status: 500 });
    }
}