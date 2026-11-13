import { getDb } from '@/lib/db';
import { getGraphToken, getUserDriveId } from '@/lib/onedriveServer';
import { resolveVideoSourceServer, sourceCache } from '@/lib/videoSourceService';
import { isMatureVideo } from '@/lib/videoUtils';

const headers = { 'Cache-Control': 'private, no-store' };
const timingFile = /^thumbnails(?:_sd|_hd)?\.vtt$/i;
const spriteFile = /^sprite_[a-z0-9_-]+\.(?:jpe?g|png|webp)$/i;
const isStoryboardAsset = (name) => timingFile.test(name) || spriteFile.test(name);

async function findVideo(params) {
  const { id } = await params;
  if (!/^\d+$/.test(id) || Number(id) < 1 || Number(id) > 2147483647) {
    return null;
  }
  const sql = getDb();
  const [video] = await sql`
    SELECT id, category, content_rating, onedrive_folder_id
    FROM videos WHERE id = ${Number(id)} AND (status = 'READY' OR status IS NULL)
  `;
  return isMatureVideo(video) ? video : null;
}

export async function POST(_request, { params }) {
  try {
    const video = await findVideo(params);
    if (!video) return Response.json({ error: 'Video not found' }, { status: 404, headers });

    const { notReady } = await resolveVideoSourceServer(video.id);
    if (notReady) return Response.json({ error: 'Video not found' }, { status: 404, headers });
    const items = (sourceCache.get(String(video.id))?.data?.items || [])
      .filter(({ name }) => isStoryboardAsset(name))
      .map(({ name }) => ({
        name,
        downloadUrl: `/api/videos/${video.id}/storyboard?asset=${encodeURIComponent(name)}`,
      }));
    return Response.json({ items }, { headers });
  } catch (error) {
    console.error('[Watch storyboard]', error.message);
    return Response.json({ error: 'Unable to load storyboard' }, { status: 502, headers });
  }
}

export async function GET(request, { params }) {
  const name = new URL(request.url).searchParams.get('asset') || '';
  if (!isStoryboardAsset(name)) return new Response(null, { status: 404, headers });

  try {
    const video = await findVideo(params);
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
