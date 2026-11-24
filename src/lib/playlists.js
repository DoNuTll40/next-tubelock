import { NextResponse } from 'next/server';
import { isAdmin } from './access';
import { encodeVideoSlug, isMatureVideo, protectVideoPoster, RESTRICTED_POSTER } from './videoUtils';

let playlistSchemaChecked = false;
let playlistSchemaPending;
const seededSystemPlaylistUsers = new Set();
const VISIBILITIES = new Set(['private', 'unlisted', 'public']);
const SYSTEM_KINDS = new Map([
  ['wl', 'watch_later'],
  ['watch_later', 'watch_later'],
  ['ll', 'liked'],
  ['liked', 'liked'],
]);

export async function ensurePlaylistSchema(sql) {
  if (playlistSchemaChecked) return;

  if (!playlistSchemaPending) {
    playlistSchemaPending = sql.transaction([
      // Serialize first-run DDL across server instances as well as within this process.
      sql`SELECT pg_advisory_xact_lock(927406153)`,
      sql`
        CREATE TABLE IF NOT EXISTS playlists (
          id SERIAL PRIMARY KEY,
          user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title VARCHAR(120) NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          visibility VARCHAR(20) NOT NULL DEFAULT 'private'
            CHECK (visibility IN ('private', 'unlisted', 'public')),
          kind VARCHAR(20) NOT NULL DEFAULT 'normal'
            CHECK (kind IN ('normal', 'watch_later', 'liked')),
          custom_thumbnail_url TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `,
      sql`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_playlists_user_system_kind
        ON playlists (user_id, kind) WHERE kind IN ('watch_later', 'liked')
      `,
      sql`
        CREATE INDEX IF NOT EXISTS idx_playlists_user_updated
        ON playlists (user_id, updated_at DESC, id DESC)
      `,
      sql`
        CREATE TABLE IF NOT EXISTS playlist_items (
          id SERIAL PRIMARY KEY,
          playlist_id INT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
          video_id INT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
          position INT NOT NULL DEFAULT 0,
          added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (playlist_id, video_id)
        )
      `,
      sql`
        CREATE INDEX IF NOT EXISTS idx_playlist_items_order
        ON playlist_items (playlist_id, position, added_at)
      `,
      sql`
        CREATE INDEX IF NOT EXISTS idx_playlist_items_video ON playlist_items (video_id)
      `,
    ]).then(() => {
      playlistSchemaChecked = true;
    }).finally(() => {
      playlistSchemaPending = undefined;
    });
  }

  await playlistSchemaPending;
}

export async function ensureSystemPlaylists(sql, userId) {
  if (!userId || seededSystemPlaylistUsers.has(userId)) return;

  await sql`
    INSERT INTO playlists (user_id, title, visibility, kind)
    VALUES
      (${userId}, 'ดูภายหลัง', 'private', 'watch_later'),
      (${userId}, 'วิดีโอที่ชอบ', 'private', 'liked')
    ON CONFLICT (user_id, kind) WHERE kind IN ('watch_later', 'liked')
    DO NOTHING
  `;

  if (seededSystemPlaylistUsers.size >= 500) {
    seededSystemPlaylistUsers.delete(seededSystemPlaylistUsers.values().next().value);
  }
  seededSystemPlaylistUsers.add(userId);
}

export function parsePlaylistId(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) {
    return null;
  }
  const id = Number(value);
  return Number.isInteger(id) && id > 0 && id <= 2147483647 ? id : null;
}

export function canManagePlaylist(playlist, currentUserId) {
  return Boolean(currentUserId && (playlist.user_id === currentUserId || isAdmin(currentUserId)));
}

export function canViewPlaylist(playlist, currentUserId) {
  return (playlist.kind === 'normal' && ['public', 'unlisted'].includes(playlist.visibility))
    || canManagePlaylist(playlist, currentUserId);
}

export function getPlaylistRouteKey(playlist) {
  if (playlist.kind === 'watch_later') return 'WL';
  if (playlist.kind === 'liked') return 'LL';
  return String(playlist.id);
}

export async function resolvePlaylistByParam(sql, rawId, currentUserId) {
  const kind = SYSTEM_KINDS.get(String(rawId).toLowerCase());
  const id = parsePlaylistId(rawId);
  if (!kind && !id) return { errorStatus: 400 };
  if (kind) {
    if (!currentUserId) return { errorStatus: 401 };
    await ensureSystemPlaylists(sql, currentUserId);
  }

  const [playlist] = await sql`
    SELECT p.id, p.user_id, p.title, p.description, p.visibility, p.kind,
           p.created_at, p.updated_at, u.name AS owner_name, u.picture AS owner_picture
    FROM playlists p
    LEFT JOIN users u ON u.id = p.user_id
    WHERE ${kind
      ? sql`p.user_id = ${currentUserId} AND p.kind = ${kind}`
      : sql`p.id = ${id}`}
  `;

  return playlist || { errorStatus: 404 };
}

export async function resolveManagedPlaylist(sql, rawId, currentUserId) {
  const playlist = await resolvePlaylistByParam(sql, rawId, currentUserId);
  if (playlist.errorStatus) return playlist;
  return canManagePlaylist(playlist, currentUserId) ? playlist : { errorStatus: 403 };
}

// Use the same rating/category aliases as isMatureVideo when selecting a cover in SQL.
const MATURE_VIDEO = `
  (lower(regexp_replace(coalesce(v.content_rating, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'))
    IN ('18+', 'mature', 'restricted')
   OR lower(regexp_replace(coalesce(v.category, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'))
    IN ('adult', '18+', 'mature'))
`;
const SLIM_POSTER = `
  CASE
    WHEN ${MATURE_VIDEO} THEN NULL
    WHEN lower(left(v.thumbnail_url, 5)) = 'data:' THEN 'data:'
    ELSE v.thumbnail_url
  END
`;

function safePlaylistVideo(video) {
  const safe = protectVideoPoster(video);
  const slug = encodeVideoSlug(safe.id, safe.category);
  return {
    ...safe,
    slug,
    thumbnail_url: /^data:/i.test(safe.thumbnail_url || '') ? `/api/og/${slug}.jpg` : safe.thumbnail_url,
  };
}

export function resolveSafePlaylistPreview(video) {
  if (!video) return { preview_thumbnail: '', preview_is_mature: false };

  const safe = safePlaylistVideo(video);
  const mature = isMatureVideo(safe);
  return {
    preview_thumbnail: mature ? RESTRICTED_POSTER : (safe.thumbnail_url || ''),
    preview_is_mature: mature,
  };
}

function serializePlaylistSummary(row, includeMembership = false) {
  const {
    first_video_id, first_video_category, cover_video_id, cover_video_category,
    cover_content_rating, cover_thumbnail_url, contains_video, ...playlist
  } = row;
  const cover = cover_video_id && {
    id: cover_video_id,
    category: cover_video_category,
    content_rating: cover_content_rating,
    thumbnail_url: cover_thumbnail_url,
  };

  return {
    ...playlist,
    route_key: getPlaylistRouteKey(playlist),
    first_video_id,
    first_video_category,
    first_video_slug: first_video_id ? encodeVideoSlug(first_video_id, first_video_category) : null,
    cover_video_id: cover_video_id || first_video_id || null,
    ...resolveSafePlaylistPreview(cover),
    ...(includeMembership && { contains_video: Boolean(contains_video) }),
  };
}

export async function listPlaylists(sql, userId, { sort, filter, videoId = null } = {}) {
  await ensureSystemPlaylists(sql, userId);
  const order = sort === 'title' ? sql`lower(p.title) ASC`
    : sort === 'created' ? sql`p.created_at DESC` : sql`p.updated_at DESC`;
  const kindFilter = filter === 'normal' ? sql`AND p.kind = 'normal'`
    : filter === 'system' ? sql`AND p.kind IN ('watch_later', 'liked')` : sql``;

  const rows = await sql`
    SELECT p.id, p.title, p.description, p.visibility, p.kind, p.created_at, p.updated_at,
           counts.item_count, counts.contains_video,
           first_video.id AS first_video_id, first_video.category AS first_video_category,
           first_video.status AS first_video_status,
           cover.id AS cover_video_id, cover.category AS cover_video_category,
           cover.content_rating AS cover_content_rating, cover.thumbnail_url AS cover_thumbnail_url
    FROM playlists p
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS item_count, BOOL_OR(pi.video_id = ${videoId}::int) AS contains_video
      FROM playlist_items pi
      WHERE pi.playlist_id = p.id
    ) counts ON TRUE
    LEFT JOIN LATERAL (
      SELECT v.id, v.category, v.status
      FROM playlist_items pi
      JOIN videos v ON v.id = pi.video_id
      WHERE pi.playlist_id = p.id
      ORDER BY pi.position, pi.added_at, pi.id
      LIMIT 1
    ) first_video ON TRUE
    LEFT JOIN LATERAL (
      SELECT v.id, v.category, v.content_rating, ${sql.unsafe(SLIM_POSTER)} AS thumbnail_url
      FROM playlist_items pi
      JOIN videos v ON v.id = pi.video_id
      WHERE pi.playlist_id = p.id
      ORDER BY ${sql.unsafe(MATURE_VIDEO)}, pi.position, pi.added_at, pi.id
      LIMIT 1
    ) cover ON TRUE
    WHERE p.user_id = ${userId} ${kindFilter}
    ORDER BY ${order}, p.id DESC
  `;

  return rows.map((row) => serializePlaylistSummary(row, videoId !== null));
}

export async function getPlaylistDetails(sql, rawId, userId) {
  const playlist = await resolvePlaylistByParam(sql, rawId, userId);
  if (playlist.errorStatus) return playlist;
  if (!canViewPlaylist(playlist, userId)) return { errorStatus: userId ? 403 : 401 };

  const canManage = canManagePlaylist(playlist, userId);
  const rows = await sql`
    SELECT pi.id AS item_id, pi.position, pi.added_at, v.id, v.title, v.duration,
           v.resolution, v.fps, v.codec, v.file_size_bytes, v.category, v.content_rating,
           v.views_count, v.status, v.source_type, v.user_id, v.created_at,
           ${sql.unsafe(SLIM_POSTER)} AS thumbnail_url,
           u.name AS author_name, u.picture AS author_picture,
           COALESCE(h.last_position_seconds, 0) AS last_position_seconds,
           h.video_id IS NOT NULL AS has_watched
    FROM playlist_items pi
    JOIN playlists p ON p.id = pi.playlist_id
    JOIN videos v ON v.id = pi.video_id
    LEFT JOIN users u ON u.id = v.user_id
    LEFT JOIN watch_history h ON h.video_id = v.id AND h.user_id = ${userId ?? null}::int
    WHERE pi.playlist_id = ${playlist.id}
      AND (${canManage} OR (p.kind = 'normal' AND p.visibility IN ('public', 'unlisted')))
      AND (${canManage} OR v.status = 'READY' OR v.status IS NULL)
    ORDER BY pi.position, pi.added_at, pi.id
  `;

  const items = rows.map(safePlaylistVideo);
  const first = items[0];
  return {
    playlist: {
      ...playlist,
      route_key: playlist.user_id === userId ? getPlaylistRouteKey(playlist) : String(playlist.id),
      can_manage: canManage,
      item_count: items.length,
      total_duration: items.reduce((total, item) => total + Number(item.duration || 0), 0),
      first_video_id: first?.id ?? null,
      first_video_slug: first?.slug ?? null,
      first_video_status: first?.status ?? null,
      ...resolveSafePlaylistPreview(items.find((item) => !isMatureVideo(item)) ?? first),
    },
    items,
  };
}

export async function createPlaylist(sql, userId, { title, description, visibility, initialVideoId }) {
  const [row] = await sql`
    WITH video AS (
      SELECT v.id, v.category, v.content_rating, v.status, ${sql.unsafe(SLIM_POSTER)} AS thumbnail_url
      FROM videos v
      WHERE v.id = ${initialVideoId}::int
        AND (v.status = 'READY' OR v.status IS NULL OR v.user_id = ${userId} OR ${isAdmin(userId)})
      FOR KEY SHARE
    ),
    created AS (
      INSERT INTO playlists (user_id, title, description, visibility)
      SELECT ${userId}::int, ${title}::text, ${description}::text, ${visibility}::text
      WHERE ${initialVideoId}::int IS NULL OR EXISTS (SELECT 1 FROM video)
      RETURNING id, title, description, visibility, kind, created_at, updated_at
    ),
    added AS (
      INSERT INTO playlist_items (playlist_id, video_id, position)
      SELECT p.id, v.id, 0
      FROM created p CROSS JOIN video v
      RETURNING video_id
    )
    SELECT p.*, (v.id IS NOT NULL)::int AS item_count, v.id IS NOT NULL AS contains_video,
           v.id AS first_video_id, v.category AS first_video_category, v.status AS first_video_status,
           v.id AS cover_video_id, v.category AS cover_video_category,
           v.content_rating AS cover_content_rating, v.thumbnail_url AS cover_thumbnail_url
    FROM created p
    LEFT JOIN added a ON TRUE
    LEFT JOIN video v ON v.id = a.video_id
  `;

  return row && serializePlaylistSummary(row, initialVideoId !== null);
}

// Every item mutation writes the playlist row and runs at SERIALIZABLE isolation.
// A concurrent change to MAX(position) or to membership is retried on a fresh snapshot.
async function writePlaylistItems(sql, statement) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const [rows] = await sql.transaction([statement], { isolationLevel: 'Serializable' });
      return rows;
    } catch (error) {
      if (attempt >= 3 || !['40001', '40P01'].includes(error.code)) throw error;
    }
  }
}

export async function appendPlaylistItems(sql, userId, videoIds, playlistIds) {
  const admin = isAdmin(userId);
  return writePlaylistItems(sql, sql`
    WITH targets AS (
      SELECT p.id
      FROM playlists p
      WHERE p.id = ANY(${playlistIds}::int[]) AND (p.user_id = ${userId} OR ${admin})
    ),
    requested AS (
      SELECT v.id, requested_video.input_position
      FROM unnest(${videoIds}::int[]) WITH ORDINALITY AS requested_video(id, input_position)
      JOIN videos v ON v.id = requested_video.id
      WHERE v.status = 'READY' OR v.status IS NULL OR v.user_id = ${userId} OR ${admin}
    ),
    validation AS (
      SELECT COUNT(*) = ${videoIds.length}::int AS valid FROM requested
    ),
    added AS (
      INSERT INTO playlist_items (playlist_id, video_id, position)
      SELECT p.id, r.id,
             COALESCE((SELECT MAX(position) FROM playlist_items WHERE playlist_id = p.id), -1)
               + ROW_NUMBER() OVER (PARTITION BY p.id ORDER BY r.input_position)
      FROM targets p
      CROSS JOIN requested r
      CROSS JOIN validation
      WHERE validation.valid
        AND NOT EXISTS (
          SELECT 1 FROM playlist_items pi WHERE pi.playlist_id = p.id AND pi.video_id = r.id
        )
      ON CONFLICT (playlist_id, video_id) DO NOTHING
      RETURNING playlist_id, video_id, position
    ),
    added_by_playlist AS (
      SELECT playlist_id, array_agg(video_id ORDER BY position) AS video_ids
      FROM added
      GROUP BY playlist_id
    ),
    touched AS (
      UPDATE playlists p SET updated_at = NOW()
      FROM added_by_playlist a
      WHERE p.id = a.playlist_id
    )
    SELECT p.id AS playlist_id, validation.valid,
           COALESCE(a.video_ids, ARRAY[]::int[]) AS added_video_ids,
           (SELECT COUNT(*)::int FROM playlist_items pi WHERE pi.playlist_id = p.id)
             + COALESCE(cardinality(a.video_ids), 0) AS item_count
    FROM targets p
    CROSS JOIN validation
    LEFT JOIN added_by_playlist a ON a.playlist_id = p.id
  `);
}

export async function addVideoToPlaylists(sql, userId, videoId, playlistIds) {
  const id = parsePlaylistId(videoId);
  if (!userId || !id || !Array.isArray(playlistIds)) return [];
  const ids = [...new Set(playlistIds.map(parsePlaylistId).filter(Boolean))];
  return ids.length ? appendPlaylistItems(sql, userId, [id], ids) : [];
}

export async function removePlaylistItem(sql, playlistId, videoId) {
  const [row] = await writePlaylistItems(sql, sql`
    WITH removed AS (
      DELETE FROM playlist_items WHERE playlist_id = ${playlistId} AND video_id = ${videoId}
      RETURNING playlist_id
    ),
    touched AS (
      UPDATE playlists p SET updated_at = NOW()
      FROM removed r
      WHERE p.id = r.playlist_id
    )
    SELECT (SELECT COUNT(*)::int FROM playlist_items WHERE playlist_id = ${playlistId})
      - (SELECT COUNT(*)::int FROM removed) AS item_count
  `);
  return row.item_count;
}

export async function reorderPlaylistItems(sql, playlistId, orderedVideoIds) {
  const [row] = await writePlaylistItems(sql, sql`
    WITH wanted AS (
      SELECT video_id, new_pos
      FROM unnest(${orderedVideoIds}::int[]) WITH ORDINALITY AS ord(video_id, new_pos)
    ),
    validation AS (
      SELECT EXISTS (SELECT 1 FROM playlists WHERE id = ${playlistId})
        AND (SELECT COUNT(*) FROM playlist_items WHERE playlist_id = ${playlistId})
          = ${orderedVideoIds.length}::int
        AND NOT EXISTS (
          SELECT 1 FROM wanted w
          WHERE NOT EXISTS (
            SELECT 1 FROM playlist_items pi WHERE pi.playlist_id = ${playlistId} AND pi.video_id = w.video_id
          )
        ) AS valid
    ),
    reordered AS (
      UPDATE playlist_items pi
      SET position = w.new_pos - 1
      FROM wanted w, validation
      WHERE validation.valid AND pi.playlist_id = ${playlistId} AND pi.video_id = w.video_id
      RETURNING playlist_id
    ),
    touched AS (
      UPDATE playlists SET updated_at = NOW()
      WHERE id IN (SELECT playlist_id FROM reordered)
    )
    SELECT valid FROM validation
  `);
  return row.valid;
}

export async function getVideoPlaylistState(sql, userId, videoId) {
  const [row] = await sql`
    SELECT COUNT(*) FILTER (WHERE p.kind = 'liked')::int AS "likeCount",
           COALESCE(array_agg(p.id ORDER BY p.id) FILTER (WHERE p.user_id = ${userId}::int),
                    ARRAY[]::int[]) AS "playlistIds",
           COALESCE(array_agg(p.id ORDER BY p.id)
                      FILTER (WHERE p.user_id = ${userId}::int AND p.kind = 'normal'),
                    ARRAY[]::int[]) AS "normalPlaylistIds",
           COALESCE(BOOL_OR(p.user_id = ${userId}::int AND p.kind = 'watch_later'), FALSE) AS "watchLater",
           COALESCE(BOOL_OR(p.user_id = ${userId}::int AND p.kind = 'liked'), FALSE) AS liked
    FROM videos v
    LEFT JOIN playlist_items pi ON pi.video_id = v.id
    LEFT JOIN playlists p ON p.id = pi.playlist_id AND (p.kind = 'liked' OR p.user_id = ${userId}::int)
    WHERE v.id = ${videoId}
      AND (v.status = 'READY' OR v.status IS NULL OR v.user_id = ${userId}::int OR ${isAdmin(userId)})
    GROUP BY v.id
  `;
  if (!row) return null;
  return { ...row, authenticated: Boolean(userId), saved: row.watchLater || row.normalPlaylistIds.length > 0 };
}

export async function replaceVideoPlaylists(sql, userId, videoId, playlistIds) {
  const [row] = await writePlaylistItems(sql, sql`
    WITH video AS (
      SELECT id FROM videos
      WHERE id = ${videoId}
        AND (status = 'READY' OR status IS NULL OR user_id = ${userId} OR ${isAdmin(userId)})
    ),
    wanted AS (
      SELECT id FROM playlists
      WHERE user_id = ${userId} AND kind = 'normal' AND id = ANY(${playlistIds}::int[])
    ),
    removed AS (
      DELETE FROM playlist_items pi USING playlists p, video v
      WHERE pi.playlist_id = p.id AND pi.video_id = v.id
        AND p.user_id = ${userId} AND p.kind = 'normal'
        AND NOT EXISTS (SELECT 1 FROM wanted w WHERE w.id = pi.playlist_id)
      RETURNING pi.playlist_id
    ),
    added AS (
      INSERT INTO playlist_items (playlist_id, video_id, position)
      SELECT p.id, v.id, COALESCE((SELECT MAX(position) FROM playlist_items WHERE playlist_id = p.id), -1) + 1
      FROM wanted p CROSS JOIN video v
      WHERE NOT EXISTS (
        SELECT 1 FROM playlist_items pi WHERE pi.playlist_id = p.id AND pi.video_id = v.id
      )
      ON CONFLICT (playlist_id, video_id) DO NOTHING
      RETURNING playlist_id
    ),
    touched AS (
      UPDATE playlists SET updated_at = NOW()
      WHERE id IN (SELECT playlist_id FROM added UNION SELECT playlist_id FROM removed)
    )
    SELECT ARRAY(SELECT id FROM wanted ORDER BY id) AS "playlistIds" FROM video
  `);
  return row;
}

export function parsePlaylistFields(body, creating = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;

  const { title, description = creating ? '' : undefined, visibility = creating ? 'private' : undefined } = body;

  if ((creating || title !== undefined)
    && (typeof title !== 'string' || !title.trim() || title.includes('\0') || [...title.trim()].length > 120)) {
    return null;
  }
  if (description !== undefined && (typeof description !== 'string'
    || description.includes('\0') || [...description.trim()].length > 1000)) {
    return null;
  }
  if (visibility !== undefined && !VISIBILITIES.has(visibility)) return null;

  return { title: title?.trim(), description: description?.trim(), visibility };
}

export function playlistResponse(data, status = 200) {
  return NextResponse.json({ success: true, ...data }, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

export function playlistError(status, message) {
  const errors = {
    400: 'ข้อมูลเพลย์ลิสต์ไม่ถูกต้อง',
    401: 'กรุณาเข้าสู่ระบบ',
    403: 'คุณไม่มีสิทธิ์เข้าถึงเพลย์ลิสต์นี้',
    404: 'ไม่พบเพลย์ลิสต์',
    409: 'รายการเพลย์ลิสต์มีการเปลี่ยนแปลง กรุณาโหลดใหม่แล้วลองอีกครั้ง',
    500: 'ไม่สามารถดำเนินการกับเพลย์ลิสต์ได้ กรุณาลองใหม่',
  };
  return NextResponse.json(
    { success: false, error: message || errors[status] },
    { status, headers: { 'Cache-Control': 'private, no-store' } },
  );
}
