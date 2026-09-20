import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGraphToken, getUserDriveId } from '@/lib/onedriveServer';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// High-speed In-Memory Cache (Global across server restarts/HMR in dev)
const sourceCache = globalThis.__tubelock_source_cache || (globalThis.__tubelock_source_cache = new Map());
const inFlightRequests = globalThis.__tubelock_inflight || (globalThis.__tubelock_inflight = new Map());

// Prevent Vercel CDN from caching expiring OneDrive tempauth tokens
const EDGE_CACHE_HEADERS = {
  'Cache-Control': 'private, no-cache, no-store, must-revalidate',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
};

function isTempauthValid(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const urlObj = new URL(url);
    const tempauth = urlObj.searchParams.get('tempauth');
    if (!tempauth) return true;
    const parts = tempauth.split('.');
    if (parts.length < 2) return true;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    const expSeconds = Number(payload.exp);
    if (!expSeconds) return true;
    // Require at least 5 minutes remaining before token expiry
    return (expSeconds * 1000) > (Date.now() + 5 * 60 * 1000);
  } catch (_) {
    return true;
  }
}

let columnsChecked = false;
async function ensureSourceCacheColumns(sql) {
  if (columnsChecked) return;
  try {
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS source_cache JSONB;`;
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS source_cache_expires_at BIGINT DEFAULT 0;`;
    columnsChecked = true;
  } catch (_) {}
}

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
    const { searchParams } = new URL(request.url);
    const forceFresh = searchParams.get('fresh') === '1' || searchParams.get('refresh') === '1';

    if (forceFresh) {
      sourceCache.delete(cacheKey);
    } else {
      // ⚡ 1. Ultra-fast Cache Hit (<1ms) with Token Expiry Validation
      const cached = sourceCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now() && cached.data?.items?.length > 0) {
        const sampleUrl = cached.data.items[0]?.downloadUrl || cached.data.url;
        if (isTempauthValid(sampleUrl)) {
          return NextResponse.json(cached.data, { headers: EDGE_CACHE_HEADERS });
        } else {
          sourceCache.delete(cacheKey);
        }
      }
    }

    // ⚡ 2. In-Flight Request Deduplication (prevents parallel duplicate calls from React StrictMode)
    if (!forceFresh && inFlightRequests.has(cacheKey)) {
      const data = await inFlightRequests.get(cacheKey);
      if (data?.status && data.status !== 'READY' && !data.success) {
        return NextResponse.json(data, { status: 422 });
      }
      return NextResponse.json(data, { headers: EDGE_CACHE_HEADERS });
    }

    // ⚡ 3. Cold Fetch with Promise Coalescing & Database Persistent Cache
    const fetchPromise = (async () => {
      const sql = getDb();
      await ensureSourceCacheColumns(sql);

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

      // ⚡⚡⚡ ULTRA-SPEED PERSISTENT DB CACHE HIT (<30ms) ⚡⚡⚡
      // If cached in Neon DB and download URLs are still valid, return IMMEDIATELY!
      const now = Date.now();
      if (
        !forceFresh &&
        video.source_cache &&
        video.source_cache_expires_at &&
        Number(video.source_cache_expires_at) > now
      ) {
        const parsedCache = typeof video.source_cache === 'string'
          ? JSON.parse(video.source_cache)
          : video.source_cache;

        const sampleUrl = parsedCache?.items?.[0]?.downloadUrl || parsedCache?.url;
        const isTokenValid = isTempauthValid(sampleUrl);

        // Verify that HLS cache is not an incomplete early snapshot (e.g. only 144p cached while transcode finished)
        const cachedM3u8Count = parsedCache?.items?.filter((i) => i.name?.endsWith('.m3u8')).length || 0;
        const isStaleEarlySnapshot = (video.transcode_progress === 100 || video.status === 'READY') && cachedM3u8Count <= 2 && (parsedCache?.items?.length || 0) < 150;

        if (isTokenValid && !isStaleEarlySnapshot && parsedCache && (parsedCache.items?.length > 0 || parsedCache.url)) {
          const resultData = {
            ...parsedCache,
            video,
          };
          sourceCache.set(cacheKey, {
            data: resultData,
            expiresAt: Number(video.source_cache_expires_at),
          });
          return resultData;
        }
      }

      // If not in DB cache or expired, fetch fresh download URLs from OneDrive (valid for 60 mins)
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

        // Cache for 40 minutes if complete (leaving a 20-minute safety buffer before Microsoft 60-minute expiry)
        const isCompleted = Number(video.transcode_progress || 0) >= 100;
        const expiresAt = Date.now() + (isCompleted ? 40 * 60 * 1000 : 15 * 1000);

        sourceCache.set(cacheKey, {
          data: resultData,
          expiresAt,
        });

        // 💾 Persist to Neon DB so ALL serverless instances and users get <30ms response!
        try {
          const cachePayload = JSON.stringify({
            success: true,
            type: 'hls',
            items: validItems,
          });
          await sql`
            UPDATE videos 
            SET source_cache = ${cachePayload}::jsonb,
                source_cache_expires_at = ${expiresAt}
            WHERE id = ${id};
          `;
        } catch (dbErr) {
          console.warn('[DB source_cache save warning]:', dbErr.message);
        }

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

      const expiresAt = Date.now() + 90 * 60 * 1000;

      sourceCache.set(cacheKey, {
        data: resultData,
        expiresAt,
      });

      try {
        const cachePayload = JSON.stringify({
          success: true,
          type: 'mp4',
          url: downloadUrl,
        });
        await sql`
          UPDATE videos 
          SET source_cache = ${cachePayload}::jsonb,
              source_cache_expires_at = ${expiresAt}
          WHERE id = ${id};
        `;
      } catch (dbErr) {
        console.warn('[DB source_cache save warning]:', dbErr.message);
      }

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
