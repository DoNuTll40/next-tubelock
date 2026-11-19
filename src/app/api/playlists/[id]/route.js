import { getCachedServerSession } from '@/lib/access';
import { getDb } from '@/lib/db';
import {
  ensurePlaylistSchema, getPlaylistDetails, getPlaylistRouteKey, parsePlaylistFields,
  playlistError, playlistResponse, resolveManagedPlaylist,
} from '@/lib/playlists';

export async function GET(_request, { params }) {
  const userId = (await getCachedServerSession())?.id;
  const { id } = await params;

  try {
    const sql = getDb();
    await ensurePlaylistSchema(sql);
    const details = await getPlaylistDetails(sql, id, userId);
    return details.errorStatus ? playlistError(details.errorStatus) : playlistResponse(details);
  } catch (error) {
    console.error('[GET /api/playlists/[id]]', error.message);
    return playlistError(500);
  }
}

export async function PATCH(request, { params }) {
  const userId = (await getCachedServerSession())?.id;
  if (!userId) return playlistError(401);

  const { id } = await params;
  try {
    const sql = getDb();
    await ensurePlaylistSchema(sql);
    const playlist = await resolveManagedPlaylist(sql, id, userId);
    if (playlist.errorStatus) return playlistError(playlist.errorStatus);
    if (playlist.kind !== 'normal') {
      return playlistError(403, 'ไม่สามารถแก้ไขชื่อหรือสถานะของเพลย์ลิสต์ระบบได้');
    }

    const fields = parsePlaylistFields(await request.json().catch(() => null));
    if (!fields || Object.values(fields).every((value) => value === undefined)) {
      return playlistError(400, 'กรุณาตรวจสอบชื่อ คำอธิบาย และการมองเห็นของเพลย์ลิสต์');
    }

    const [updated] = await sql`
      UPDATE playlists
      SET title = COALESCE(${fields.title ?? null}::text, title),
          description = COALESCE(${fields.description ?? null}::text, description),
          visibility = COALESCE(${fields.visibility ?? null}::text, visibility),
          updated_at = NOW()
      WHERE id = ${playlist.id} AND kind = 'normal'
      RETURNING id, title, description, visibility, kind, user_id, created_at, updated_at
    `;
    if (!updated) return playlistError(404);
    return playlistResponse({ playlist: { ...updated, route_key: getPlaylistRouteKey(updated) } });
  } catch (error) {
    console.error('[PATCH /api/playlists/[id]]', error.message);
    return playlistError(500);
  }
}

export async function DELETE(_request, { params }) {
  const userId = (await getCachedServerSession())?.id;
  if (!userId) return playlistError(401);

  const { id } = await params;
  try {
    const sql = getDb();
    await ensurePlaylistSchema(sql);
    const playlist = await resolveManagedPlaylist(sql, id, userId);
    if (playlist.errorStatus) return playlistError(playlist.errorStatus);
    if (playlist.kind !== 'normal') return playlistError(403, 'ไม่สามารถลบเพลย์ลิสต์ระบบได้');

    await sql`DELETE FROM playlists WHERE id = ${playlist.id} AND kind = 'normal'`;
    return playlistResponse({ deletedId: playlist.id });
  } catch (error) {
    console.error('[DELETE /api/playlists/[id]]', error.message);
    return playlistError(500);
  }
}
