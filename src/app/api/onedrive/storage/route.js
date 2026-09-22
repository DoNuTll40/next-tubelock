import { cookies } from 'next/headers';

export async function GET(request) {
    try {
        // 1. ตรวจสอบ tubelock_session จาก Cookie หรือ Header
        const cookieStore = await cookies();
        const sessionToken =
            cookieStore.get('tubelock_session')?.value ||
            request.headers.get('x-tubelock-session');

        if (!sessionToken) {
            return Response.json(
                {
                    success: false,
                    error: 'Unauthorized: ไม่พบเซสชันการเข้าสู่ระบบ (tubelock_session)',
                },
                { status: 401 }
            );
        }

        // (ออปชันเสริม) หากมีฟังก์ชัน verifySession สามารถเรียกเช็คกับ DB/JWT ได้ตรงนี้
        // const isValidSession = await verifySession(sessionToken);
        // if (!isValidSession) return Response.json({ success: false, error: 'Session หมดอายุ' }, { status: 401 });

        const tenantId = process.env.AZURE_TENANT_ID;
        const clientId = process.env.AZURE_CLIENT_ID;
        const clientSecret = process.env.AZURE_CLIENT_SECRET;
        const targetUser = process.env.ONEDRIVE_USER_ID;

        if (!tenantId || !clientId || !clientSecret) {
            return Response.json(
                {
                    success: false,
                    error: 'กรุณาตั้งค่า AZURE_TENANT_ID, AZURE_CLIENT_ID และ AZURE_CLIENT_SECRET ใน .env',
                },
                { status: 400 }
            );
        }

        // 2. ขอ Token จาก Microsoft
        const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
        const tokenBody = new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            scope: 'https://graph.microsoft.com/.default',
            grant_type: 'client_credentials',
        });

        const tokenRes = await fetch(tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: tokenBody.toString(),
        });

        const tokenData = await tokenRes.json();

        if (!tokenRes.ok) {
            return Response.json(
                {
                    success: false,
                    status: tokenRes.status,
                    error: tokenData.error_description || tokenData.error,
                },
                { status: tokenRes.status }
            );
        }

        const accessToken = tokenData.access_token;

        // 3. ดึงข้อมูล Drive & HLS Folders
        const graphHeaders = {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        };

        const encodedUser = encodeURIComponent(targetUser);
        const driveUrl = `https://graph.microsoft.com/v1.0/users/${encodedUser}/drive`;
        const foldersUrl = `https://graph.microsoft.com/v1.0/users/${encodedUser}/drive/root:/streams:/children?$select=id,name,size,folder,createdDateTime,lastModifiedDateTime,webUrl,eTag&$orderby=lastModifiedDateTime desc`;

        const [driveRes, foldersRes] = await Promise.all([
            fetch(driveUrl, { headers: graphHeaders }),
            fetch(foldersUrl, { headers: graphHeaders }),
        ]);

        if (!driveRes.ok) {
            const errText = await driveRes.text();
            console.error('[Microsoft Graph driveRes Error]:', driveRes.status, errText);
            return Response.json(
                { success: false, error: `ไม่สามารถดึงข้อมูล Drive (${driveRes.status}): ${errText}` },
                { status: driveRes.status }
            );
        }

        const driveData = await driveRes.json();
        const foldersData = foldersRes.ok ? await foldersRes.json() : { value: [] };

        async function getPosterUrlByPath(accessToken, targetUser, folderName) {
            try {
                const encodedUser = encodeURIComponent(targetUser);

                // ตัด ?$select=... ออก ปล่อยให้คืนค่า metadata ครบชุด
                const res = await fetch(
                    `https://graph.microsoft.com/v1.0/users/${encodedUser}/drive/root:/streams/${folderName}/poster.jpg`,
                    {
                        headers: { Authorization: `Bearer ${accessToken}` },
                    }
                );

                if (!res.ok) {
                    console.warn(`[getPosterUrlByPath] status: ${res.status}`);
                    return null;
                }

                const data = await res.json();

                // ตรวจสอบทั้ง downloadUrl และ fallback ไปที่ content stream
                return (
                    data['@microsoft.graph.downloadUrl'] ||
                    `https://graph.microsoft.com/v1.0/users/${encodedUser}/drive/items/${data.id}/content`
                );
            } catch (err) {
                console.error('[getPosterUrlByPath] error:', err);
                return null;
            }
        }

        // ใช้งานโดยส่งชื่อโฟลเดอร์ได้เลย
        const posterUrl = await getPosterUrlByPath(accessToken, targetUser, "stream_vid_839");

        // 4. คำนวณความจุและขนาด
        const quota = driveData.quota || {};
        const bytesToGB = (bytes) => (bytes ? (bytes / 1024 ** 3).toFixed(2) : '0.00');
        const usedBytes = quota.used || 0;
        const totalBytes = quota.total || 1;
        const remainingBytes = quota.remaining || 0;

        // กรองเอาเฉพาะรายการที่เป็นโฟลเดอร์
        const rawFolders = (foldersData.value || []).filter((item) => Boolean(item.folder));

        // ใช้ Promise.all คู่กับ async ภายใน map
        const streamFolders = await Promise.all(
            rawFolders.map(async (folder) => ({
                id: folder.id,
                name: folder.name,
                childCount: folder.folder?.childCount || 0,
                sizeMB: (folder.size / 1024 ** 2).toFixed(2),
                lastModified: folder.lastModifiedDateTime,
                imageUrl: `/api/onedrive/poster?folder=${encodeURIComponent(folder.name)}`,
            }))
        );

        return Response.json({
            success: true,
            storage: {
                usedGB: Number(bytesToGB(usedBytes)),
                totalGB: Math.round(totalBytes / 1024 ** 3),
                remainingGB: Number(bytesToGB(remainingBytes)),
                usedPercentage: ((usedBytes / totalBytes) * 100).toFixed(1),
            },
            folders: {
                totalStreams: streamFolders.length,
                items: streamFolders,
            },
        });
    } catch (error) {
        console.error('OneDrive API Route Error:', error);
        return Response.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}
