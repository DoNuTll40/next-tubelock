import { createHash } from 'node:crypto';
import { DESCRIPTION_FILE_LIMIT, parseRichDescription } from './descriptionDocument.mjs';

export const descriptionImageFolder = id => `/description-images/video_${id}`;
const assetPattern = /^[a-f0-9]{64}\.(jpg|png|webp|gif)$/;
const mimeTypes = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
function error(status, message) { return Response.json({ success: false, error: message }, { status, headers }); }

export function detectDescriptionImage(bytes) {
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString())) return 'gif';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

// Inject dependencies in tests: no database, token, or network is opened at module load.
export function createDescriptionImageHandlers(deps) {
  const { getDb, getSessionUserId, isAdmin, canViewVideo, getGraphToken, getUserDriveId, ensureFolderExists, rateLimitResponse, fetch: graphFetch = globalThis.fetch } = deps;
  async function load(context) {
    const { id, assetId } = await context.params;
    if (!/^[1-9]\d*$/.test(id) || Number(id) > 2147483647 || (assetId && !assetPattern.test(assetId))) return { response: error(400, 'Invalid image identifier') };
    const sql = getDb();
    const userId = await getSessionUserId(sql);
    const [video] = await sql`SELECT id, user_id, visibility, status, description FROM videos WHERE id = ${Number(id)} LIMIT 1`;
    const owner = Boolean(video && userId != null && (isAdmin(userId) || Number(video.user_id) === Number(userId)));
    return { id, assetId, sql, userId, video, owner };
  }
  async function POST(request, context) {
    try {
      const state = await load(context);
      if (state.response) return state.response;
      const { id, sql, userId, video, owner } = state;
      if (userId == null) return error(401, 'Authentication required');
      if (!video || !owner) return error(404, 'Video not found');
      if (Number(request.headers.get('content-length')) > DESCRIPTION_FILE_LIMIT + 65536) return error(413, 'Image exceeds 4 MB');
      const limited = await rateLimitResponse(sql, 'descriptionImage', userId);
      if (limited) return limited;
      const form = await request.formData();
      const file = form.get('file');
      if (!file || typeof file.arrayBuffer !== 'function' || file.size < 1 || file.size > DESCRIPTION_FILE_LIMIT) return error(400, 'Use an image up to 4 MB');
      const bytes = Buffer.from(await file.arrayBuffer());
      const extension = detectDescriptionImage(bytes);
      if (!extension || file.type !== mimeTypes[extension]) return error(400, 'Use a valid JPEG, PNG, WebP or GIF image');
      const assetId = `${createHash('sha256').update(bytes).digest('hex')}.${extension}`;
      const token = await getGraphToken();
      const driveId = await getUserDriveId(token);
      const folderId = await ensureFolderExists(token, driveId, descriptionImageFolder(id));
      const result = await graphFetch(`https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(folderId)}:/${assetId}:/content`, {
        method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': file.type }, body: bytes,
      });
      if (!result.ok) return error(502, 'Unable to store description image');
      return Response.json({ success: true, image: { src: `/api/videos/${id}/description-images/${assetId}`, assetId, name: String(file.name || '').slice(0, 255), size: bytes.length } }, { headers });
    } catch { return error(502, 'Unable to store description image'); }
  }
  async function GET(request, context) {
    try {
      const state = await load(context);
      if (state.response) return state.response;
      const { id, assetId, video, userId, owner } = state;
      if (!assetId || !video || !canViewVideo(video, userId, userId != null && isAdmin(userId))) return error(404, 'Image not found');
      const src = `/api/videos/${id}/description-images/${assetId}`;
      const referenced = parseRichDescription(video.description)?.albums.some(album => album.images.some(image => image.src === src));
      if (!owner && (!referenced || (video.status && video.status !== 'READY'))) return error(404, 'Image not found');
      const token = await getGraphToken();
      const driveId = await getUserDriveId(token);
      const path = `${descriptionImageFolder(id)}/${assetId}`;
      const response = await graphFetch(`https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/root:${path}:/content`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      if (!response.ok || !response.body) return error(404, 'Image not found');
      // Stream bytes instead of redirecting: an expiring OneDrive URL would bypass video permissions.
      return new Response(response.body, { headers: { ...headers, 'Content-Type': mimeTypes[assetId.split('.').pop()], 'Content-Security-Policy': "default-src 'none'; sandbox" } });
    } catch { return error(502, 'Unable to load description image'); }
  }
  return { POST, GET };
}
