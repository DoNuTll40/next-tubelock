import { apiError } from '@/lib/apiError';
import { getSessionUserId } from '@/lib/access';
import { getDb } from '@/lib/db';
import { encodeVideoSlug, isMatureVideo } from '@/lib/videoUtils';

export async function GET() {
    try {
        // 1. ตรวจสอบเซสชันผู้ใช้จาก DB
        const actor = await getSessionUserId();

        if (actor == null) {
            return Response.json(
                {
                    success: false,
                    error: 'Unauthorized: กรุณาเข้าสู่ระบบก่อนตรวจสอบพื้นที่จัดเก็บ',
                },
                { status: 401 }
            );
        }

        const tenantId = process.env.AZURE_TENANT_ID;
        const clientId = process.env.AZURE_CLIENT_ID;
        const clientSecret = process.env.AZURE_CLIENT_SECRET;
        const targetUser = process.env.ONEDRIVE_USER_ID;

        if (!tenantId || !clientId || !clientSecret || !targetUser) {
            throw new Error('OneDrive credentials are incomplete');
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
            return apiError(new Error(tokenData.error_description || tokenData.error || `Token response ${tokenRes.status}`), {
                context: 'GET /api/onedrive/storage', status: 502,
            });
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
            return apiError(new Error(`Graph drive response ${driveRes.status}: ${errText}`), {
                context: 'GET /api/onedrive/storage', status: 502,
            });
        }

        const driveData = await driveRes.json();
        const foldersData = foldersRes.ok ? await foldersRes.json() : { value: [] };

        // 4. คำนวณความจุและขนาด
        const quota = driveData.quota || {};
        const bytesToGB = (bytes) => (bytes ? (bytes / 1024 ** 3).toFixed(2) : '0.00');
        const usedBytes = quota.used || 0;
        const totalBytes = quota.total || 1;
        const remainingBytes = quota.remaining || 0;

        // กรองเอาเฉพาะรายการที่เป็นโฟลเดอร์
        const rawFolders = (foldersData.value || []).filter((item) => Boolean(item.folder));

        // ดึง metadata วิดีโอจาก Neon DB แบบ batch เพื่อแสดงชื่อคลิปจริง, ความละเอียด, ความยาว และเรตเนื้อหา
        const vidIds = Array.from(
            new Set(
                rawFolders
                    .map((f) => String(f.name || '').match(/^stream_vid_(\d+)/i)?.[1])
                    .filter(Boolean)
                    .map((n) => Number(n))
                    .filter((n) => Number.isInteger(n) && n > 0)
            )
        );

        const videoMetaMap = new Map();
        if (vidIds.length > 0) {
            try {
                const sql = getDb();
                const videoRows = await sql`
                    SELECT id, user_id, title, category, resolution, duration, content_rating, status
                    FROM videos
                    WHERE id = ANY(${vidIds}::int[]);
                `;
                for (const v of videoRows) {
                    videoMetaMap.set(Number(v.id), {
                        videoId: Number(v.id),
                        ownerId: v.user_id != null ? Number(v.user_id) : null,
                        videoTitle: v.title || '',
                        videoSlug: encodeVideoSlug(v.id, v.category),
                        category: v.category || '',
                        resolution: v.resolution || '',
                        duration: Number(v.duration || 0),
                        isMature: isMatureVideo(v),
                        status: v.status || 'READY',
                    });
                }
            } catch (dbErr) {
                console.warn('[OneDrive Storage] Skip video metadata enrichment:', dbErr?.message);
            }
        }

        // คำนวณยอดรวมทั้งระบบ (Aggregate) และคัดกรองเฉพาะคลิปของผู้ใช้ที่ล็อกอินอยู่
        let totalHlsBytes = 0;
        let myHlsBytes = 0;
        const myUniqueVideoIds = new Set();
        const myStreamFolders = [];

        for (const folder of rawFolders) {
            const folderBytes = Number(folder.size || 0);
            totalHlsBytes += folderBytes;

            const vidNum = Number(String(folder.name || '').match(/^stream_vid_(\d+)/i)?.[1] || 0);
            const meta = vidNum ? videoMetaMap.get(vidNum) : null;
            const isMine = Boolean(meta && meta.ownerId != null && meta.ownerId === Number(actor));

            if (isMine) {
                myHlsBytes += folderBytes;
                myUniqueVideoIds.add(meta.videoId);
                myStreamFolders.push({
                    id: folder.id,
                    name: folder.name,
                    childCount: folder.folder?.childCount || 0,
                    sizeMB: (folderBytes / 1024 ** 2).toFixed(2),
                    lastModified: folder.lastModifiedDateTime,
                    imageUrl: `/api/onedrive/poster?folder=${encodeURIComponent(folder.name)}`,
                    videoId: meta.videoId,
                    videoTitle: meta.videoTitle,
                    videoSlug: meta.videoSlug,
                    category: meta.category,
                    resolution: meta.resolution,
                    duration: meta.duration,
                    isMature: meta.isMature,
                    status: meta.status,
                });
            }
        }

        const totalHlsGB = Number(bytesToGB(totalHlsBytes));
        const myUsedGB = Number(bytesToGB(myHlsBytes));
        const myUsedMB = Number((myHlsBytes / 1024 ** 2).toFixed(2));
        const otherCloudGB = Number(Math.max(0, Number(bytesToGB(usedBytes)) - myUsedGB).toFixed(2));

        return Response.json({
            success: true,
            storage: {
                usedGB: Number(bytesToGB(usedBytes)),
                totalGB: Math.round(totalBytes / 1024 ** 3),
                remainingGB: Number(bytesToGB(remainingBytes)),
                usedPercentage: ((usedBytes / totalBytes) * 100).toFixed(1),
                totalHlsGB,
                otherCloudGB,
            },
            myStorage: {
                usedGB: myUsedGB,
                usedMB: myUsedMB,
                videoCount: myUniqueVideoIds.size,
                usedPercentageOfTotal: totalBytes > 0 ? ((myHlsBytes / totalBytes) * 100).toFixed(2) : '0.00',
            },
            folders: {
                totalStreams: myStreamFolders.length,
                items: myStreamFolders,
            },
        });
    } catch (error) {
        return apiError(error, { context: 'GET /api/onedrive/storage' });
    }
}
