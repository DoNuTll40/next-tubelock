import { getCachedServerSession } from '@/lib/access';
import { getDb } from '@/lib/db';
import {
  ensurePlaylistSchema, parsePlaylistId, playlistError, playlistResponse, reorderPlaylistItems,
  resolveManagedPlaylist,
} from '@/lib/playlists';

export async function PATCH(request, { params }) {
  const userId = (await getCachedServerSession())?.id;
  if (!userId) return playlistError(401);

  const body = await request.json().catch(() => null);
  const orderedVideoIds = Array.isArray(body?.orderedVideoIds) ? body.orderedVideoIds.map(parsePlaylistId) : [];
  if (!orderedVideoIds.length || orderedVideoIds.some((id) => !id)
    || new Set(orderedVideoIds).size !== orderedVideoIds.length) {
    return playlistError(400, 'ลำดับวิดีโอไม่ถูกต้อง');
  }

  const { id } = await params;
  try {
    const sql = getDb();
    await ensurePlaylistSchema(sql);
    const playlist = await resolveManagedPlaylist(sql, id, userId);
    if (playlist.errorStatus) return playlistError(playlist.errorStatus);

    const reordered = await reorderPlaylistItems(sql, playlist.id, orderedVideoIds);
    if (!reordered) return playlistError(409);
    return playlistResponse({ playlistId: playlist.id });
  } catch (error) {
    console.error('[PATCH /api/playlists/[id]/items/reorder]', error.message);
    return playlistError(500);
  }
}
