import { getCachedServerSession } from '@/lib/access';
import { getDb } from '@/lib/db';
import {
  appendPlaylistItems, ensurePlaylistSchema, parsePlaylistId, playlistError, playlistResponse,
  removePlaylistItem, resolveManagedPlaylist,
} from '@/lib/playlists';

export async function POST(request, { params }) {
  const userId = (await getCachedServerSession())?.id;
  if (!userId) return playlistError(401);

  const body = await request.json().catch(() => null);
  const requestedIds = body?.videoIds ?? [body?.videoId];
  const parsedIds = Array.isArray(requestedIds) ? requestedIds.map(parsePlaylistId) : [];
  if (!parsedIds.length || parsedIds.some((id) => !id)) return playlistError(400, 'รหัสวิดีโอไม่ถูกต้อง');
  const videoIds = [...new Set(parsedIds)];

  const { id } = await params;
  try {
    const sql = getDb();
    await ensurePlaylistSchema(sql);
    const playlist = await resolveManagedPlaylist(sql, id, userId);
    if (playlist.errorStatus) return playlistError(playlist.errorStatus);

    const [result] = await appendPlaylistItems(sql, userId, videoIds, [playlist.id]);
    if (!result) return playlistError(404);
    if (!result.valid) return playlistError(404, 'ไม่พบวิดีโอที่จะบันทึก');
    return playlistResponse({
      playlistId: playlist.id,
      addedVideoIds: result.added_video_ids,
      itemCount: result.item_count,
    });
  } catch (error) {
    console.error('[POST /api/playlists/[id]/items]', error.message);
    return playlistError(500);
  }
}

export async function DELETE(request, { params }) {
  const userId = (await getCachedServerSession())?.id;
  if (!userId) return playlistError(401);

  const queryId = request.nextUrl.searchParams.get('videoId');
  const rawId = queryId ?? (await request.json().catch(() => null))?.videoId;
  const videoId = parsePlaylistId(rawId);
  if (!videoId) return playlistError(400, 'รหัสวิดีโอไม่ถูกต้อง');

  const { id } = await params;
  try {
    const sql = getDb();
    await ensurePlaylistSchema(sql);
    const playlist = await resolveManagedPlaylist(sql, id, userId);
    if (playlist.errorStatus) return playlistError(playlist.errorStatus);

    const itemCount = await removePlaylistItem(sql, playlist.id, videoId);
    return playlistResponse({ playlistId: playlist.id, removedVideoId: videoId, itemCount });
  } catch (error) {
    console.error('[DELETE /api/playlists/[id]/items]', error.message);
    return playlistError(500);
  }
}
