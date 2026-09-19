import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGraphToken, getUserDriveId } from '@/lib/onedriveServer';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// High-speed In-Memory Cache (Global across server restarts/HMR in dev)
// OneDrive download tokens are valid for multiple hours; cache for 60 minutes.
const sourceCache = globalThis.__tubelock_source_cache || (globalThis.__tubelock_source_cache = new Map());
const inFlightRequests = globalThis.__tubelock_inflight || (globalThis.__tubelock_inflight = new Map());

const EDGE_CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=1800',
  'CDN-Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=1800',
  'Vercel-CDN-Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=1800',
};

/**
 * GET /api/videos/[id]/source
 * Resolves direct playback URL from OneDrive via Azure Client Secret with 0ms in-memory cache & request coalescing
 */
export async function GET(request, context) {
  try {
    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ success: false, error: 'Video ID is required' }, { status: 400 });
    }

    const cacheKey = String(id);

    // ⚡ 1. Ultra-fast Cache Hit (<1ms)
    const cached = sourceCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() && cached.data?.items?.length > 0) {
      return NextResponse.json(cached.data, { headers: EDGE_CACHE_HEADERS });
    }

    // ⚡ 2. In-Flight Request Deduplication (prevents parallel duplicate calls from React StrictMode)
    if (inFlightRequests.has(cacheKey)) {
      const data = await inFlightRequests.get(cacheKey);
      if (data?.status && data.status !== 'READY' && !data.success) {
        return NextResponse.json(data, { status: 422 });
      }
      return NextResponse.json(data, { headers: EDGE_CACHE_HEADERS });
    }

    // ⚡ 3. Cold Fetch with Promise Coalescing
    const fetchPromise = (async () => {
      const sql = getDb();

      const rows = await sql`SELECT * FROM videos WHERE id = ${id} LIMIT 1;`;
      if (!rows || rows.length === 0) {
        throw new Error('Video not found');
      }

      const video = rows[0];

      // Check if video is still being processed
      if (video.status && video.status !== 'READY') {
        return {
          success: false,
          status: video.status,
          progress: video.transcode_progress || 0,
          stageDetail: video.stage_detail || '',
          errorMessage: video.error_message || '',
          video,
          error: video.status === 'FAILED'
            ? `การแปลงวิดีโอล้มเหลว: ${video.error_message || 'ไม่ทราบสาเหตุ'}`
            : `วิดีโอนี้อยู่ในสถานะ "${video.status}" (${video.stage_detail || 'กำลังประมวลผล'}) กรุณารอสักครู่`,
        };
      }

      const token = await getGraphToken();
      const driveId = await getUserDriveId(token);

      // Case 1: HLS Stream Folder
      if (video.source_type === 'hls' || video.onedrive_folder_id) {
        const folderId = video.onedrive_folder_id || video.onedrive_item_id;
        // Do NOT use $select here: Graph API strips @microsoft.graph.downloadUrl if $select is present!
        let nextUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}/children?$top=1000`;
        const allItems = [];

        while (nextUrl) {
          const res = await fetch(nextUrl, { headers: { Authorization: `Bearer ${token}` } });
          if (!res.ok) {
            throw new Error(`Failed to read HLS folder from OneDrive (${res.status})`);
          }
          const data = await res.json();
          if (Array.isArray(data.value)) {
            allItems.push(...data.value);
          }
          nextUrl = data['@odata.nextLink'] || null;
        }

        const validItems = allItems
          .filter(i => i.name && i['@microsoft.graph.downloadUrl'])
          .map(i => ({
            name: i.name,
            downloadUrl: i['@microsoft.graph.downloadUrl'],
          }));

        if (validItems.length === 0) {
          throw new Error('ไม่พบไฟล์ที่พร้อมเล่นในโฟลเดอร์ HLS จาก OneDrive');
        }

        const resultData = {
          success: true,
          type: 'hls',
          video,
          items: validItems,
        };

        // Cache for 60 minutes
        sourceCache.set(cacheKey, {
          data: resultData,
          expiresAt: Date.now() + 60 * 60 * 1000,
        });

        return resultData;
      }

      // Case 2: Standalone Video File (MP4, MKV, etc.)
      const itemId = video.onedrive_item_id;
      const res = await fetch(
        `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}?select=id,@microsoft.graph.downloadUrl`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!res.ok) {
        throw new Error(`Failed to fetch video download link from OneDrive (${res.status})`);
      }

      const data = await res.json();
      const downloadUrl = data['@microsoft.graph.downloadUrl'];

      const resultData = {
        success: true,
        type: 'mp4',
        url: downloadUrl,
        video,
      };

      // Cache for 60 minutes
      sourceCache.set(cacheKey, {
        data: resultData,
        expiresAt: Date.now() + 60 * 60 * 1000,
      });

      return resultData;
    })();

    inFlightRequests.set(cacheKey, fetchPromise);

    try {
      const data = await fetchPromise;
      if (data?.status && data.status !== 'READY' && !data.success) {
        return NextResponse.json(data, { status: 422 });
      }
      return NextResponse.json(data, { headers: EDGE_CACHE_HEADERS });
    } finally {
      inFlightRequests.delete(cacheKey);
    }
  } catch (err) {
    console.error('[API_VIDEO_SOURCE_ERROR]:', err);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: err.message === 'Video not found' ? 404 : 500 }
    );
  }
}
