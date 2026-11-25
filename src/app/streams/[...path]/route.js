import { isMatureVideo, isPreviewImage, RESTRICTED_POSTER } from '@/lib/videoUtils';
import { NextResponse } from 'next/server';
import { getCachedServerSession } from '@/lib/access';
import { apiError } from '@/lib/apiError';
import { getDb } from '@/lib/db';
import { getGraphToken, getUserDriveId } from '@/lib/onedriveServer';
import { assetCache, isTempauthValid, sourceCache, wrapWithWorkerCache } from '@/lib/videoSourceService';
import { canViewVideo, normalizeVideoVisibility } from '@/lib/videoVisibility';

export const dynamic = 'force-dynamic';

const ACCESS_TTL_MS = 30 * 1000;
const NO_STORE = 'private, no-store';

function forbidden() {
  return new NextResponse('Forbidden', { status: 403, headers: { 'Cache-Control': NO_STORE } });
}

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
    const cacheKey = `${folderName}/${fileName}`.toLowerCase();
    const restrictedPoster = () => redirectAsset(new URL(RESTRICTED_POSTER, request.url));
    function redirectAsset(url, previewAccessUntil = 0) {
      const response = NextResponse.redirect(url, 307);
      const maxAge = Math.floor((previewAccessUntil - Date.now()) / 1000);
      response.headers.set('Cache-Control', maxAge > 0 ? `private, max-age=${maxAge}` : NO_STORE);
      return response;
    }

    let sessionPromise;
    const canRequestAsset = async (video) => {
      if (canViewVideo(video)) return true;
      sessionPromise ??= getCachedServerSession();
      const session = await sessionPromise;
      return canViewVideo(video, session?.id, Boolean(session?.isAdmin));
    };
    const redirectToFile = (url, isPrivate, accessUntil) => redirectAsset(
      wrapWithWorkerCache(fileName, url),
      isPreview && !isPrivate ? accessUntil : 0
    );
    const rememberAsset = (video, url, checkedAt, expiresAt) => {
      const isPrivate = normalizeVideoVisibility(video.visibility) === 'private';
      const accessUntil = checkedAt + ACCESS_TTL_MS;
      assetCache.set(cacheKey, {
        url,
        isMature: isMatureVideo(video),
        isPrivate,
        ownerId: video.user_id,
        videoId: video.id,
        folderId: video.onedrive_folder_id,
        accessUntil,
        expiresAt,
      });
      return url ? redirectToFile(url, isPrivate, accessUntil) : restrictedPoster();
    };

    // Recheck access on each hit. Refresh the policy before reusing a longer-lived URL.
    const cached = assetCache.get(cacheKey);
    const hasCachedAsset = cached?.expiresAt > Date.now() && typeof cached.isPrivate === 'boolean';
    if (hasCachedAsset && cached.accessUntil > Date.now()) {
      const policy = { visibility: cached.isPrivate ? 'private' : 'public', user_id: cached.ownerId };
      if (!(await canRequestAsset(policy))) return forbidden();
      if (isPreview && cached.isMature) return restrictedPoster();
      if (cached.url && isTempauthValid(cached.url)) {
        return redirectToFile(cached.url, cached.isPrivate, cached.accessUntil);
      }
    }
    if (!hasCachedAsset) assetCache.delete(cacheKey);

    const match = /^stream_vid_(\d+)(?:_v(\d+))?$/i.exec(folderName);
    const videoId = match ? Number(match[1]) : null;
    const versionId = match?.[2] ? Number(match[2]) : null;
    const tryServeFromSourceCache = async (videoId, versionId, knownVideo, checkedAt) => {
      const candidateKeys = versionId
        ? [`${videoId}:vid:${versionId}`, `${videoId}:v:${versionId}`]
        : [`${videoId}:v:default`, String(videoId), `${videoId}:v:legacy`];
      for (const key of candidateKeys) {
        const memSource = sourceCache.get(key);
        if (!memSource || memSource.expiresAt <= Date.now() || !Array.isArray(memSource.data?.items)) {
          continue;
        }
        const sourceVideo = memSource.data.video;
        if (!sourceVideo || !Object.hasOwn(sourceVideo, 'visibility') || Number(sourceVideo.id) !== Number(videoId)) {
          continue;
        }
        if (knownVideo) {
          if (sourceVideo.onedrive_folder_id !== knownVideo.onedrive_folder_id) continue;
        } else if (!(memSource.accessCheckedAt + ACCESS_TTL_MS > Date.now()) ||
          Number(sourceVideo.active_version?.id || 0) !== (versionId || 0)) {
          continue;
        }
        if (!(await canRequestAsset(sourceVideo))) {
          if (knownVideo) continue;
          return forbidden();
        }

        const video = knownVideo ?? sourceVideo;
        const accessCheckedAt = checkedAt ?? memSource.accessCheckedAt;
        if (isPreview && isMatureVideo(video)) {
          return rememberAsset(video, null, accessCheckedAt, Date.now() + 15 * 60 * 1000);
        }
        const foundItem = memSource.data.items.find(
          (i) => i.name?.toLowerCase() === fileName.toLowerCase()
        );
        if (foundItem?.downloadUrl && isTempauthValid(foundItem.downloadUrl)) {
          return rememberAsset(
            video, foundItem.downloadUrl, accessCheckedAt, Date.now() + (isPreview ? 15 : 40) * 60 * 1000
          );
        }
      }
      return null;
    };

    if (videoId != null) {
      const earlyHit = await tryServeFromSourceCache(videoId, versionId);
      if (earlyHit) return earlyHit;
    }

    const sql = getDb();
    const accessCheckedAt = Date.now();

    // ⚡ 3. Locate video (or specific version) metadata in Neon DB (slim projection — never fetch source_cache!)
    let rows = [];

    if (versionId != null) {
      rows = await sql`
        SELECT v.id, vv.onedrive_folder_id, v.category, v.content_rating, v.visibility, v.user_id
        FROM video_versions vv
        JOIN videos v ON v.id = vv.video_id
        WHERE vv.id = ${versionId}
          AND vv.video_id = ${videoId}
          AND (vv.status = 'READY' OR vv.status IS NULL)
        LIMIT 1;
      `;
    } else if (videoId != null) {
      rows = await sql`
        SELECT id, onedrive_folder_id, category, content_rating, visibility, user_id
        FROM videos 
        WHERE id = ${videoId} AND (status = 'READY' OR status IS NULL)
        LIMIT 1;
      `;
    }

    if (!rows || rows.length === 0) {
      const folderPath = `%/${folderName.replace(/[\\%_]/g, '\\$&')}/%`;
      rows = await sql`
        SELECT id, onedrive_folder_id, category, content_rating, visibility, user_id
        FROM videos 
        WHERE (status = 'READY' OR status IS NULL)
          AND (('/' || master_playlist_path) LIKE ${folderPath}
            OR ('/' || thumbnail_url) LIKE ${folderPath})
        LIMIT 1;
      `;
    }

    if (!rows || rows.length === 0) {
      return new NextResponse('Stream package not found in database', { status: 404 });
    }

    const video = rows[0];
    if (!(await canRequestAsset(video))) return forbidden();
    if (isPreview && isMatureVideo(video)) {
      return rememberAsset(video, null, accessCheckedAt, Date.now() + 15 * 60 * 1000);
    }

    const folderId = video.onedrive_folder_id;
    if (!folderId) {
      return new NextResponse('OneDrive folder ID not found for video', { status: 404 });
    }

    if (hasCachedAsset && cached.videoId === video.id && cached.folderId === folderId &&
      cached.expiresAt > Date.now() && cached.url && isTempauthValid(cached.url)) {
      return rememberAsset(video, cached.url, accessCheckedAt, cached.expiresAt);
    }

    // Legacy folder names can reuse source URLs after resolving their video in the database.
    const fallbackSourceHit = await tryServeFromSourceCache(video.id, versionId, video, accessCheckedAt);
    if (fallbackSourceHit) return fallbackSourceHit;

    // ⚡ 4. Fetch direct download link for this single asset from OneDrive via Microsoft Graph
    const token = await getGraphToken();
    const driveId = await getUserDriveId(token);

    const fileRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}:/${encodeURIComponent(fileName)}:?select=id,@microsoft.graph.downloadUrl`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!fileRes.ok) {
      if (fileRes.status === 404) return new NextResponse('Stream asset not found', { status: 404 });
      return apiError(new Error(`Graph stream asset lookup returned ${fileRes.status}`), {
        context: 'GET /streams/[...path]', status: 502,
      });
    }

    const fileData = await fileRes.json();
    const downloadUrl = fileData['@microsoft.graph.downloadUrl'];
    if (!downloadUrl) {
      return apiError(new Error('Graph stream asset had no download URL'), {
        context: 'GET /streams/[...path]', status: 502,
      });
    }

    return rememberAsset(video, downloadUrl, accessCheckedAt, Date.now() + (isPreview ? 15 : 60) * 60 * 1000);
  } catch (err) {
    return apiError(err, { context: 'GET /streams/[...path]' });
  }
}
