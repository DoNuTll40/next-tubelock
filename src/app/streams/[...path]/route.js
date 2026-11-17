import { isMatureVideo, isPreviewImage, RESTRICTED_POSTER } from '@/lib/videoUtils';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGraphToken, getUserDriveId } from '@/lib/onedriveServer';
import { assetCache, isTempauthValid, sourceCache, wrapWithWorkerCache } from '@/lib/videoSourceService';

export const dynamic = 'force-dynamic';

/**
 * GET /streams/[...path]
 * Proxies/redirects relative stream asset paths (e.g. /streams/stream_vid_823/poster.jpg)
 * directly to their authenticated OneDrive download URL without pulling multi-MB source_cache from Neon.
 */
export async function GET(request, context) {
  try {
    const { path } = await context.params;
    if (!path || path.length < 2) {
      return new NextResponse('Invalid stream asset path', { status: 400 });
    }

    const folderName = path[0]; // e.g. 'stream_vid_823'
    const fileName = path.slice(1).join('/'); // e.g. 'poster.jpg' หรือ '1080p/001.ts'
    const isPreview = isPreviewImage(fileName);
    const redirectAsset = (url, cacheablePreview = false) => {
      const response = NextResponse.redirect(url, 307);
      if (isPreview) {
        response.headers.set(
          'Cache-Control',
          cacheablePreview ? 'private, max-age=900' : 'private, no-store'
        );
      }
      return response;
    };
    const cacheKey = `${folderName}/${fileName}`.toLowerCase();

    // ⚡ 1. Ultra-fast In-Memory Hit (<1ms) with Mature Check & Token Expiration Validation
    const cached = assetCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      if (isPreview && cached.isMature) {
        return redirectAsset(new URL(RESTRICTED_POSTER, request.url), false);
      }
      if (cached.url && isTempauthValid(cached.url)) {
        return redirectAsset(wrapWithWorkerCache(fileName, cached.url), isPreview && !cached.isMature);
      }
    }
    assetCache.delete(cacheKey);

    const sql = getDb();

    // ⚡ 2. Locate video metadata in Neon DB (slim projection — never fetch source_cache!)
    const matchId = folderName.match(/^stream_vid_(\d+)$/i);
    let rows = [];
    if (matchId) {
      const vidId = parseInt(matchId[1], 10);
      rows = await sql`
        SELECT id, onedrive_folder_id, category, content_rating
        FROM videos 
        WHERE id = ${vidId} AND (status = 'READY' OR status IS NULL)
        LIMIT 1;
      `;
    }

    if (!rows || rows.length === 0) {
      rows = await sql`
        SELECT id, onedrive_folder_id, category, content_rating
        FROM videos 
        WHERE (status = 'READY' OR status IS NULL)
          AND (master_playlist_path LIKE ${'%' + folderName + '%'}
            OR thumbnail_url LIKE ${'%' + folderName + '%'})
        LIMIT 1;
      `;
    }

    if (!rows || rows.length === 0) {
      return new NextResponse('Stream package not found in database', { status: 404 });
    }

    const video = rows[0];
    const mature = isMatureVideo(video);
    if (isPreview && mature) {
      assetCache.set(cacheKey, {
        url: null,
        isMature: true,
        expiresAt: Date.now() + 15 * 60 * 1000,
      });
      return redirectAsset(new URL(RESTRICTED_POSTER, request.url), false);
    }

    const folderId = video.onedrive_folder_id;
    if (!folderId) {
      return new NextResponse('OneDrive folder ID not found for video', { status: 404 });
    }

    // ⚡ 3. Check in-memory sourceCache from videoSourceService (0 Neon egress, 0 Graph calls!)
    const memSource = sourceCache.get(String(video.id));
    if (memSource && memSource.expiresAt > Date.now() && Array.isArray(memSource.data?.items)) {
      const foundItem = memSource.data.items.find(
        (i) => i.name?.toLowerCase() === fileName.toLowerCase()
      );
      if (foundItem?.downloadUrl && isTempauthValid(foundItem.downloadUrl)) {
        assetCache.set(cacheKey, {
          url: foundItem.downloadUrl,
          isMature: mature,
          expiresAt: Date.now() + (isPreview ? 15 : 40) * 60 * 1000,
        });
        return redirectAsset(wrapWithWorkerCache(fileName, foundItem.downloadUrl), isPreview && !mature);
      }
    }

    // ⚡ 4. Fetch direct download link for this single asset from OneDrive via Microsoft Graph
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
      isMature: mature,
      expiresAt: Date.now() + (isPreview ? 15 : 60) * 60 * 1000,
    });

    return redirectAsset(wrapWithWorkerCache(fileName, downloadUrl), isPreview && !mature);
  } catch (err) {
    console.error('[Stream Asset Proxy Error]:', err);
    return new NextResponse(err.message, { status: 500 });
  }
}
