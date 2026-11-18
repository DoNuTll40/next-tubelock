import { getDb } from '@/lib/db';
import { getGraphToken, getUserDriveId } from '@/lib/onedriveServer';
import { resolveVideoSourceServer, sourceCache } from '@/lib/videoSourceService';
import { isMatureVideo } from '@/lib/videoUtils';

const headers = { 'Cache-Control': 'private, no-store' };
const timingFile = /^thumbnails(?:_sd|_hd)?\.vtt$/i;
const spriteFile = /^sprite_[a-z0-9_-]+\.(?:jpe?g|png|webp)$/i;
const isStoryboardAsset = (name) => timingFile.test(name) || spriteFile.test(name);

async function findVideo(params, requestedVersion = null) {
  const { id } = await params;
  if (!/^\d+$/.test(id) || Number(id) < 1 || Number(id) > 2147483647) {
    return null;
  }
  const sql = getDb();
  const vidNum = Number(id);
  const reqVer = requestedVersion != null && String(requestedVersion).trim() !== ''
    ? String(requestedVersion).trim()
    : null;
  const reqVerNumeric = reqVer && /^\d+$/.test(reqVer) ? Number(reqVer) : null;
  const reqVerLower = reqVer ? reqVer.toLowerCase() : null;

  let video = null;
  try {
    const rows = await sql`
      SELECT
        v.id, v.category, v.content_rating,
        COALESCE(vv.onedrive_folder_id, v.onedrive_folder_id) AS onedrive_folder_id,
        vv.id AS version_id
      FROM videos v
      LEFT JOIN LATERAL (
        SELECT id, onedrive_folder_id
        FROM video_versions ver
        WHERE ver.video_id = v.id
          AND (ver.status = 'READY' OR ver.status IS NULL)
          AND (
            ${reqVer == null}
            OR (${reqVerNumeric != null} AND ver.id = ${reqVerNumeric || 0})
            OR LOWER(ver.version_key) = ${reqVerLower || ''}
          )
        ORDER BY
          CASE
            WHEN ${reqVer != null} AND (${reqVerNumeric != null} AND ver.id = ${reqVerNumeric || 0}) THEN 0
            WHEN ${reqVer != null} AND LOWER(ver.version_key) = ${reqVerLower || ''} THEN 1
            ELSE 2
          END ASC,
          ver.is_default DESC,
          ver.sort_order ASC,
          ver.id ASC
        LIMIT 1
      ) vv ON TRUE
      WHERE v.id = ${vidNum} AND (v.status = 'READY' OR v.status IS NULL)
      LIMIT 1;
    `;
    video = rows?.[0] || null;
  } catch (err) {
    if (err?.code === '42P01') {
      const [legacy] = await sql`
        SELECT id, category, content_rating, onedrive_folder_id, NULL::int AS version_id
        FROM videos WHERE id = ${vidNum} AND (status = 'READY' OR status IS NULL)
      `;
      video = legacy || null;
    } else {
      throw err;
    }
  }
  return isMatureVideo(video) ? video : null;
}

export async function POST(request, { params }) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const requestedVersion = searchParams.get('v') || searchParams.get('versionId') || null;
    const video = await findVideo(params, requestedVersion);
    if (!video) return Response.json({ error: 'Video not found' }, { status: 404, headers });

    const { notReady } = await resolveVideoSourceServer(video.id, { version: requestedVersion });
    if (notReady) return Response.json({ error: 'Video not found' }, { status: 404, headers });

    const cacheKey = video.version_id ? `${video.id}:vid:${video.version_id}` : String(video.id);
    const fallbackKey = requestedVersion ? `${video.id}:v:${requestedVersion.toLowerCase()}` : `${video.id}:v:default`;
    const cachedData = sourceCache.get(cacheKey)?.data || sourceCache.get(fallbackKey)?.data;
    const verParam = video.version_id ? `&v=${encodeURIComponent(String(video.version_id))}` : '';

    const items = (cachedData?.items || [])
      .filter(({ name }) => isStoryboardAsset(name))
      .map(({ name }) => ({
        name,
        downloadUrl: `/api/videos/${video.id}/storyboard?asset=${encodeURIComponent(name)}${verParam}`,
      }));
    return Response.json({ items }, { headers });
  } catch (error) {
    console.error('[Watch storyboard]', error.message);
    return Response.json({ error: 'Unable to load storyboard' }, { status: 502, headers });
  }
}

export async function GET(request, { params }) {
  const searchParams = new URL(request.url).searchParams;
  const name = searchParams.get('asset') || '';
  const requestedVersion = searchParams.get('v') || searchParams.get('versionId') || null;
  if (!isStoryboardAsset(name)) return new Response(null, { status: 404, headers });

  try {
    const video = await findVideo(params, requestedVersion);
    if (!video?.onedrive_folder_id) return new Response(null, { status: 404, headers });

    const token = await getGraphToken();
    const driveId = encodeURIComponent(await getUserDriveId(token));
    const folderId = encodeURIComponent(video.onedrive_folder_id);
    const asset = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}:/${encodeURIComponent(name)}:/content`,
      { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: request.signal }
    );
    if (!asset.ok) return new Response(null, { status: asset.status === 404 ? 404 : 502, headers });

    return new Response(asset.body, {
      headers: {
        'Content-Type': timingFile.test(name) ? 'text/vtt; charset=utf-8' : asset.headers.get('content-type') || 'image/jpeg',
        'Cache-Control': 'private, max-age=60',
        Vary: 'Cookie',
      },
    });
  } catch (error) {
    console.error('[Watch storyboard asset]', error.message);
    return new Response(null, { status: 502, headers });
  }
}
