import { getSessionUserId, isAdmin } from '@/lib/access';
import { getDb } from '@/lib/db';
import { getGraphToken, getUserDriveId } from '@/lib/onedriveServer';
import { POSTER_PREFERENCE } from '@/lib/posterPreference';
import { isMatureVideo, RESTRICTED_POSTER } from '@/lib/videoUtils';
import { assetCache, isTempauthValid, sourceCache } from '@/lib/videoSourceService';
import { canViewVideo } from '@/lib/videoVisibility';

const headers = { 'Cache-Control': 'private, no-store' };

const dataImagePattern = /^data:(image\/(?:jpe?g|png|webp|gif|avif));base64,/i;

function respondWithPoster(url, asImage) {
  if (!asImage) return Response.json({ url }, { headers });

  const dataImage = url.match(dataImagePattern);
  if (dataImage) {
    return new Response(Buffer.from(url.slice(dataImage[0].length), 'base64'), {
      headers: { ...headers, 'Content-Type': dataImage[1], 'X-Content-Type-Options': 'nosniff' },
    });
  }
  return new Response(null, { status: 307, headers: { ...headers, Location: url } });
}

export async function GET(request, { params }) {
  if (request.cookies.get(POSTER_PREFERENCE)?.value !== '1') {
    return respondWithPoster(RESTRICTED_POSTER, true);
  }
  const userId = await getSessionUserId();
  if (!userId) {
    return respondWithPoster(RESTRICTED_POSTER, true);
  }
  return loadPoster(request, params, userId, true);
}

export async function POST(request, { params }) {
  const userId = await getSessionUserId();
  if (!userId) {
    return Response.json({ error: 'Authentication required' }, { status: 401, headers });
  }
  return loadPoster(request, params, userId, false);
}

async function loadPoster(request, params, userId, asImage) {
  const { id } = await params;
  if (!/^\d+$/.test(id) || Number(id) > 2147483647) {
    return Response.json({ error: 'Invalid video ID' }, { status: 400, headers });
  }

  try {
    const sql = getDb();
    const searchParams = new URL(request.url).searchParams;
    const requestedVersion = searchParams.get('v') || searchParams.get('versionId') || null;
    const reqVerNumeric = requestedVersion && /^\d+$/.test(requestedVersion) ? Number(requestedVersion) : null;
    const reqVerLower = requestedVersion ? requestedVersion.toLowerCase() : null;

    let video = null;
    if (requestedVersion) {
      try {
        const rows = await sql`
          SELECT
            v.id,
            COALESCE(NULLIF(vv.thumbnail_url, ''), v.thumbnail_url) AS thumbnail_url,
            COALESCE(vv.onedrive_folder_id, v.onedrive_folder_id) AS onedrive_folder_id,
            v.category, v.content_rating, v.visibility, v.user_id,
            vv.id AS version_id,
            to_jsonb(v)->>'source_cache_expires_at' AS cached_until,
            jsonb_path_query_first(to_jsonb(v)->'source_cache', '$.items[*] ? (@.name == "poster.jpg").downloadUrl') #>> '{}' AS cached_poster
          FROM videos v
          LEFT JOIN video_versions vv
            ON vv.video_id = v.id
            AND ((${reqVerNumeric != null} AND vv.id = ${reqVerNumeric || 0}) OR LOWER(vv.version_key) = ${reqVerLower || ''})
          WHERE v.id = ${Number(id)} AND (v.status = 'READY' OR v.status IS NULL)
          LIMIT 1;
        `;
        video = rows[0] || null;
      } catch {
        // Legacy installations can still load the base video without video_versions.
      }
    }
    if (!video) {
      const [row] = await sql`
        SELECT id, thumbnail_url, onedrive_folder_id, category, content_rating, visibility, user_id,
          to_jsonb(v)->>'source_cache_expires_at' AS cached_until,
          jsonb_path_query_first(to_jsonb(v)->'source_cache', '$.items[*] ? (@.name == "poster.jpg").downloadUrl') #>> '{}' AS cached_poster
        FROM videos v
        WHERE id = ${Number(id)} AND (status = 'READY' OR status IS NULL)
      `;
      video = row || null;
    }
    if (video && !canViewVideo(video, userId, isAdmin(userId))) {
      return asImage
        ? respondWithPoster(RESTRICTED_POSTER, true)
        : Response.json({ error: 'Forbidden' }, { status: 403, headers });
    }
    if (!isMatureVideo(video)) {
      return Response.json({ error: 'Poster not found' }, { status: 404, headers });
    }

    const thumbnail = video.thumbnail_url || '';
    if (dataImagePattern.test(thumbnail) ||
        /^https?:\/\//i.test(thumbnail)) {
      return respondWithPoster(thumbnail, asImage);
    }

    const streamFolderName = video.version_id ? `stream_vid_${video.id}_v${video.version_id}` : `stream_vid_${video.id}`;
    const revealCacheKey = `${streamFolderName}/poster.jpg:reveal`;

    if (searchParams.get('fresh') !== '1') {
      const minimumExpiry = Date.now() + 5 * 60 * 1000;
      const assetCached = assetCache.get(revealCacheKey) || assetCache.get(`${streamFolderName}/poster.jpg`);
      const assetUrl = assetCached && assetCached.expiresAt > Date.now() ? assetCached.url : null;
      const memory = video.version_id
        ? sourceCache.get(`${video.id}:vid:${video.version_id}`)
        : sourceCache.get(String(video.id));
      const memoryUrl = memory?.expiresAt > minimumExpiry
        ? memory.data?.items?.find((item) => item.name?.toLowerCase() === 'poster.jpg')?.downloadUrl
        : null;
      const databaseUrl = !video.version_id && Number(video.cached_until) > minimumExpiry ? video.cached_poster : null;
      const url = [assetUrl, memoryUrl, databaseUrl].find((candidate) => /^https:\/\//i.test(candidate || '') && isTempauthValid(candidate));
      if (url) return respondWithPoster(url, asImage);
    }

    const token = await getGraphToken();
    const driveId = encodeURIComponent(await getUserDriveId(token));
    const folder = video.onedrive_folder_id
      ? `items/${encodeURIComponent(video.onedrive_folder_id)}:/poster.jpg:`
      : `root:/streams/${streamFolderName}/poster.jpg`;
    const response = await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/${folder}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (response.ok) {
      const metadata = await response.json();
      const url = metadata['@microsoft.graph.downloadUrl'];
      if (url) {
        assetCache.set(revealCacheKey, {
          url,
          isMature: true,
          expiresAt: Date.now() + 15 * 60 * 1000,
        });
        return respondWithPoster(url, asImage);
      }
    }
    return Response.json({ error: 'Poster not found' }, { status: 404, headers });
  } catch (error) {
    console.error('[Poster reveal]', error.message);
    return Response.json({ error: 'Unable to load poster' }, { status: 502, headers });
  }
}
