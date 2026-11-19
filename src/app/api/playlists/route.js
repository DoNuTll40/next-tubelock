import { getCachedServerSession } from '@/lib/access';
import { getDb } from '@/lib/db';
import {
  createPlaylist, ensurePlaylistSchema, listPlaylists, parsePlaylistFields, parsePlaylistId,
  playlistError, playlistResponse,
} from '@/lib/playlists';

export async function GET(request) {
  const userId = (await getCachedServerSession())?.id;
  if (!userId) return playlistError(401);

  const params = request.nextUrl.searchParams;
  const videoId = parsePlaylistId(params.get('videoId'));
  if (params.has('videoId') && !videoId) return playlistError(400);

  try {
    const sql = getDb();
    await ensurePlaylistSchema(sql);
    const playlists = await listPlaylists(sql, userId, {
      sort: params.get('sort'), filter: params.get('filter'), videoId,
    });
    return playlistResponse({ playlists });
  } catch (error) {
    console.error('[GET /api/playlists]', error.message);
    return playlistError(500);
  }
}

export async function POST(request) {
  const userId = (await getCachedServerSession())?.id;
  if (!userId) return playlistError(401);

  const body = await request.json().catch(() => null);
  const fields = parsePlaylistFields(body, true);
  if (!fields) return playlistError(400, 'กรุณาตรวจสอบชื่อ คำอธิบาย และการมองเห็นของเพลย์ลิสต์');

  const initialVideoId = parsePlaylistId(body.initialVideoId);
  if ('initialVideoId' in body && !initialVideoId) return playlistError(400, 'รหัสวิดีโอไม่ถูกต้อง');

  try {
    const sql = getDb();
    await ensurePlaylistSchema(sql);
    const playlist = await createPlaylist(sql, userId, { ...fields, initialVideoId });
    if (!playlist) return playlistError(404, 'ไม่พบวิดีโอที่จะบันทึก');
    return playlistResponse({ playlist }, 201);
  } catch (error) {
    console.error('[POST /api/playlists]', error.message);
    return playlistError(500);
  }
}
