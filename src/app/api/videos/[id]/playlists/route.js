import { getCachedServerSession } from '@/lib/access';
import { getDb } from '@/lib/db';
import {
  ensurePlaylistSchema, getVideoPlaylistState, parsePlaylistId, playlistError, playlistResponse,
  replaceVideoPlaylists,
} from '@/lib/playlists';
import { decodeVideoSlug } from '@/lib/videoUtils';

export async function GET(_request, { params }) {
  const userId = (await getCachedServerSession())?.id ?? null;
  const { id } = await params;
  const videoId = parsePlaylistId(decodeVideoSlug(id));
  if (!videoId) return playlistError(400, 'รหัสวิดีโอไม่ถูกต้อง');

  try {
    const sql = getDb();
    await ensurePlaylistSchema(sql);
    const state = await getVideoPlaylistState(sql, userId, videoId);
    return state ? playlistResponse(state) : playlistError(404, 'ไม่พบวิดีโอ');
  } catch (error) {
    console.error('[GET /api/videos/[id]/playlists]', error.message);
    return playlistError(500);
  }
}

export async function PUT(request, { params }) {
  const userId = (await getCachedServerSession())?.id;
  if (!userId) return playlistError(401);

  const { id } = await params;
  const videoId = parsePlaylistId(decodeVideoSlug(id));
  if (!videoId) return playlistError(400, 'รหัสวิดีโอไม่ถูกต้อง');

  const body = await request.json().catch(() => null);
  const playlistIds = Array.isArray(body?.playlistIds) ? body.playlistIds.map(parsePlaylistId) : null;
  if (!playlistIds || playlistIds.some((id) => !id)) return playlistError(400, 'รหัสเพลย์ลิสต์ไม่ถูกต้อง');

  try {
    const sql = getDb();
    await ensurePlaylistSchema(sql);
    const result = await replaceVideoPlaylists(sql, userId, videoId, [...new Set(playlistIds)]);
    return result ? playlistResponse(result) : playlistError(404, 'ไม่พบวิดีโอ');
  } catch (error) {
    console.error('[PUT /api/videos/[id]/playlists]', error.message);
    return playlistError(500);
  }
}
