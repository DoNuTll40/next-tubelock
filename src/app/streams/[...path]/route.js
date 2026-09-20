import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGraphToken, getUserDriveId } from '@/lib/onedriveServer';

export const dynamic = 'force-dynamic';

const assetCache = globalThis.__tubelock_asset_cache || (globalThis.__tubelock_asset_cache = new Map());

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
    return (expSeconds * 1000) > (Date.now() + 5 * 60 * 1000);
  } catch (_) {
    return true;
  }
}

/**
 * GET /streams/[...path]
 * Proxies/redirects relative stream asset paths (e.g. /streams/stream_vid_823/poster.jpg)
 * directly to their authenticated OneDrive download URL.
 */
export async function GET(request, context) {
  try {
    const { path } = await context.params;
    if (!path || path.length < 2) {
      return new NextResponse('Invalid stream asset path', { status: 400 });
    }

    const folderName = path[0]; // e.g. 'stream_vid_823'
    const fileName = path.slice(1).join('/'); // e.g. 'poster.jpg'
    const cacheKey = `${folderName}/${fileName}`.toLowerCase();

    // ⚡ 1. Ultra-fast In-Memory Hit (<1ms) with Token Expiration Check
    const cached = assetCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() && isTempauthValid(cached.url)) {
      return NextResponse.redirect(cached.url, 307);
    } else {
      assetCache.delete(cacheKey);
    }

    const sql = getDb();

    // ⚡ 2. Locate video in Neon DB
    const matchId = folderName.match(/stream_vid_(\d+)/i);
    let rows = [];
    if (matchId) {
      const vidId = parseInt(matchId[1], 10);
      rows = await sql`
        SELECT id, onedrive_folder_id, source_cache 
        FROM videos 
        WHERE id = ${vidId} 
        LIMIT 1;
      `;
    }

    if (!rows || rows.length === 0) {
      rows = await sql`
        SELECT id, onedrive_folder_id, source_cache 
        FROM videos 
        WHERE master_playlist_path LIKE ${'%' + folderName + '%'} 
           OR thumbnail_url LIKE ${'%' + folderName + '%'}
        LIMIT 1;
      `;
    }

    if (!rows || rows.length === 0) {
      return new NextResponse('Stream package not found in database', { status: 404 });
    }

    const video = rows[0];
    const folderId = video.onedrive_folder_id;
    if (!folderId) {
      return new NextResponse('OneDrive folder ID not found for video', { status: 404 });
    }
    // ⚡ 3. Check if downloadUrl is already in source_cache and still valid
    if (video.source_cache) {
      const cacheData = typeof video.source_cache === 'string'
        ? JSON.parse(video.source_cache)
        : video.source_cache;
      const foundItem = cacheData?.items?.find(
        (i) => i.name.toLowerCase() === fileName.toLowerCase()
      );
      if (foundItem?.downloadUrl && isTempauthValid(foundItem.downloadUrl)) {
        assetCache.set(cacheKey, {
          url: foundItem.downloadUrl,
          expiresAt: Date.now() + 40 * 60 * 1000,
        });
        return NextResponse.redirect(foundItem.downloadUrl, 307);
      }
    }

    // ⚡ 4. Fetch direct download link from OneDrive via Microsoft Graph
    const token = await getGraphToken();
    const driveId = await getUserDriveId(token);

    const fileRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}:/${encodeURIComponent(fileName)}:?select=id,@microsoft.graph.downloadUrl`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!fileRes.ok) {
      return new NextResponse(`File "${fileName}" not found in OneDrive stream folder (${fileRes.status})`, { status: 404 });
    }

    const fileData = await fileRes.json();
    const downloadUrl = fileData['@microsoft.graph.downloadUrl'];
    if (!downloadUrl) {
      return new NextResponse('Could not obtain download URL from OneDrive', { status: 500 });
    }

    assetCache.set(cacheKey, {
      url: downloadUrl,
      expiresAt: Date.now() + 60 * 60 * 1000,
    });

    return NextResponse.redirect(downloadUrl, 307);
  } catch (err) {
    console.error('[Stream Asset Proxy Error]:', err);
    return new NextResponse(err.message, { status: 500 });
  }
}
