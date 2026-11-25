import { apiError } from '@/lib/apiError';
import { protectVideoPoster } from '@/lib/videoUtils';
import { ensureVideoVersionsSchema } from '@/lib/videoVersions';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';
import { isAdmin, accessError, getServerSessionByToken } from '@/lib/access';
import { isMusicVideo } from '@/lib/videoUtils';
import { buildUserTasteProfile, rankHomeFeedVideos } from '@/lib/recommendationEngine';
import { POSTER_PREFERENCE } from '@/lib/posterPreference';

let tableEnsured = false;

async function ensureTable(sql) {
  if (tableEnsured) return;
  try {
    // Auto-create videos table if not exists with all required columns
    await sql`
      CREATE TABLE IF NOT EXISTS videos (
        id SERIAL PRIMARY KEY,
        onedrive_item_id VARCHAR(255) UNIQUE,
        onedrive_folder_id VARCHAR(255) UNIQUE,
        source_type VARCHAR(50) NOT NULL DEFAULT 'hls',
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        duration INTEGER DEFAULT 0,
        file_size_bytes BIGINT DEFAULT 0,
        resolution VARCHAR(50) DEFAULT '1080p',
        fps INTEGER DEFAULT 30,
        codec VARCHAR(50) DEFAULT 'h264',
        thumbnail_url TEXT DEFAULT '',
        tags TEXT[] DEFAULT '{}',
        status VARCHAR(50) DEFAULT 'READY',
        transcode_progress INTEGER DEFAULT 0,
        stage_detail TEXT DEFAULT '',
        error_message TEXT DEFAULT '',
        raw_file_name TEXT DEFAULT '',
        master_playlist_path TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    // Ensure all required columns exist on older tables
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'READY';`;
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS transcode_progress INTEGER DEFAULT 0;`;
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS stage_detail TEXT DEFAULT '';`;
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS error_message TEXT DEFAULT '';`;
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS raw_file_name TEXT DEFAULT '';`;
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS master_playlist_path TEXT DEFAULT '';`;
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS category VARCHAR(100) DEFAULT 'general';`;
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS content_rating VARCHAR(50) DEFAULT 'all';`;
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS subtitle_tracks JSONB DEFAULT '[]'::jsonb;`;
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(id) ON DELETE SET NULL;`;
    await sql`CREATE INDEX IF NOT EXISTS idx_videos_user_id ON videos(user_id);`;
    try {
      await sql`ALTER TABLE videos ALTER COLUMN fps TYPE NUMERIC(7, 3);`;
    } catch (_) {}
    await ensureVideoVersionsSchema(sql);

    tableEnsured = true;
  } catch (err) {
    console.warn('[DB Init Warning]:', err.message);
  }
}

export async function GET(request) {
  try {
    const sql = getDb();
    const { searchParams } = new URL(request.url);

    // Optional manual table init trigger if needed
    if (searchParams.get('init') === '1' && !tableEnsured) {
      await ensureTable(sql);
    }

    // Resolve user_id from session cookie
    const cookieStore = await cookies();
    const token = cookieStore.get('tubelock_session')?.value;
    const session = await getServerSessionByToken(token, sql).catch(() => null);
    const userId = session?.user.id ?? null;

    const isMine = searchParams.get('mine') === '1';
    if (isMine && userId == null) {
      return accessError(401);
    }

    const noCacheHeaders = {
      'Cache-Control': 'no-cache, no-store, max-age=0, must-revalidate',
      'CDN-Cache-Control': 'no-cache, no-store',
      'Vercel-CDN-Cache-Control': 'no-cache, no-store',
    };

    if (isMine) {
      const admin = isAdmin(userId);
      const studioRows = await sql`
        SELECT
          v.id, v.title, v.description, v.duration, v.file_size_bytes, v.resolution, v.fps, v.codec,
          v.thumbnail_url, v.tags, v.category, v.content_rating, v.views_count, v.created_at, v.updated_at,
          v.status, v.transcode_progress, v.stage_detail, v.error_message, v.raw_file_name, v.source_type,
          v.user_id, COALESCE(v.visibility, 'public') AS visibility,
          to_jsonb(v)->>'subtitle_status' AS subtitle_status,
          to_jsonb(v)->>'thumbnail_status' AS thumbnail_status,
          to_jsonb(v)->>'user_selected_rating' AS user_selected_rating,
          to_jsonb(v)->>'ai_suggested_rating' AS ai_suggested_rating,
          to_jsonb(v)->>'rating_check_status' AS rating_check_status,
          (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('id', t->>'id', 'label', t->>'label', 'lang', t->>'lang')), '[]'::jsonb)
            FROM jsonb_array_elements(COALESCE(to_jsonb(v)->'subtitle_tracks', '[]'::jsonb)) AS t
          ) AS subtitle_tracks_meta,
          COALESCE(vv_meta.version_count, 0) AS version_count,
          COALESCE(vv_meta.version_badges, '[]'::jsonb) AS version_badges,
          u.name AS author_name,
          u.picture AS author_picture
        FROM videos v
        LEFT JOIN users u ON v.user_id = u.id
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*)::int AS version_count,
            COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'id', vv.id,
                  'version_key', vv.version_key,
                  'label', vv.label,
                  'badge', vv.badge,
                  'status', vv.status,
                  'is_default', vv.is_default
                ) ORDER BY vv.sort_order ASC, vv.id ASC
              ),
              '[]'::jsonb
            ) AS version_badges
          FROM video_versions vv
          WHERE vv.video_id = v.id
        ) vv_meta ON TRUE
        WHERE (${admin} OR v.user_id = ${userId})
        ORDER BY v.created_at DESC;
      `;

      const studioData = (studioRows || []).map((row) => {
        const tracksMeta = Array.isArray(row.subtitle_tracks_meta) ? row.subtitle_tracks_meta : [];
        const versionBadges = Array.isArray(row.version_badges) ? row.version_badges : [];
        return {
          ...protectVideoPoster(row),
          subtitle_tracks_meta: tracksMeta,
          subtitle_count: tracksMeta.length,
          version_count: Number(row.version_count) || 0,
          version_badges: versionBadges,
        };
      });

      return NextResponse.json({ success: true, data: studioData }, { headers: noCacheHeaders });
    }

    // ⚡ Ultra-fast Slim Projection with personalized watch_history + slim version badges
    let rows;
    const fetchVideos = async () => {
      if (userId) {
        return sql`
          SELECT 
            v.id, v.title, v.duration, v.file_size_bytes, v.resolution, v.fps, v.codec, 
            v.thumbnail_url, v.tags, v.category, v.content_rating, v.views_count, v.created_at, v.status, v.source_type,
            v.user_id, COALESCE(v.visibility, 'public') AS visibility,
            h.last_position_seconds,
            h.last_version_id,
            h.updated_at AS last_watched_at,
            (h.id IS NOT NULL) AS has_watched,
            COALESCE(vv_meta.version_count, 0) AS version_count,
            COALESCE(vv_meta.version_badges, '[]'::jsonb) AS version_badges,
            u.name AS author_name,
            u.picture AS author_picture,
            u.handle AS author_handle
          FROM videos v
          LEFT JOIN users u ON v.user_id = u.id
          LEFT JOIN watch_history h ON h.video_id = v.id AND h.user_id = ${userId}
          LEFT JOIN LATERAL (
            SELECT
              COUNT(*)::int AS version_count,
              COALESCE(
                jsonb_agg(
                  jsonb_build_object(
                    'id', vv.id,
                    'version_key', vv.version_key,
                    'label', vv.label,
                    'badge', vv.badge,
                    'aspect_label', vv.aspect_label
                  ) ORDER BY vv.sort_order ASC, vv.id ASC
                ),
                '[]'::jsonb
              ) AS version_badges
            FROM video_versions vv
            WHERE vv.video_id = v.id AND (vv.status = 'READY' OR vv.status IS NULL)
          ) vv_meta ON TRUE
          WHERE (v.status = 'READY' OR v.status IS NULL)
            AND COALESCE(v.visibility, 'public') = 'public'
          ORDER BY v.created_at DESC;
        `;
      }
      return sql`
        SELECT 
          v.id, v.title, v.duration, v.file_size_bytes, v.resolution, v.fps, v.codec, 
          v.thumbnail_url, v.tags, v.category, v.content_rating, v.views_count, v.created_at, v.status, v.source_type,
          v.user_id, COALESCE(v.visibility, 'public') AS visibility,
          NULL AS last_position_seconds,
          NULL AS last_version_id,
          FALSE AS has_watched,
          COALESCE(vv_meta.version_count, 0) AS version_count,
          COALESCE(vv_meta.version_badges, '[]'::jsonb) AS version_badges,
          u.name AS author_name,
          u.picture AS author_picture,
          u.handle AS author_handle
        FROM videos v
        LEFT JOIN users u ON v.user_id = u.id
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*)::int AS version_count,
            COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'id', vv.id,
                  'version_key', vv.version_key,
                  'label', vv.label,
                  'badge', vv.badge,
                  'aspect_label', vv.aspect_label
                ) ORDER BY vv.sort_order ASC, vv.id ASC
              ),
              '[]'::jsonb
            ) AS version_badges
          FROM video_versions vv
          WHERE vv.video_id = v.id AND (vv.status = 'READY' OR vv.status IS NULL)
        ) vv_meta ON TRUE
        WHERE (v.status = 'READY' OR v.status IS NULL)
          AND COALESCE(v.visibility, 'public') = 'public'
        ORDER BY v.created_at DESC;
      `;
    };

    try {
      rows = await fetchVideos();
    } catch (queryErr) {
      if (!tableEnsured) {
        await ensureTable(sql);
        rows = await fetchVideos();
      } else {
        throw queryErr;
      }
    }

    const headers = noCacheHeaders;

    const sanitizedRows = (rows || []).map((v) => {
      const isMusic = isMusicVideo(v);
      const hasWatched = Boolean(v.has_watched || (v.last_position_seconds !== null && v.last_position_seconds !== undefined));
      return {
        ...protectVideoPoster(v),
        has_watched: hasWatched,
        last_position_seconds: isMusic ? 0 : (Number(v.last_position_seconds) || 0),
        last_watched_at: v.last_watched_at ? new Date(v.last_watched_at).toISOString() : null,
      };
    });

    let rankedRows = sanitizedRows;
    try {
      const cookieStore = await cookies();
      const allow18Plus = Boolean(userId) && cookieStore.get(POSTER_PREFERENCE)?.value === '1';
      // Hourly deterministic seed so feed stays stable during scrolling but refreshes gently over time
      const hourSeed = Math.floor(Date.now() / (1000 * 60 * 60));

      if (userId) {
        const [subRows, likedRows, feedbackRows] = await Promise.all([
          sql`SELECT channel_id FROM subscriptions WHERE subscriber_id = ${userId};`.catch(() => []),
          sql`
            SELECT pi.video_id
            FROM playlist_items pi
            JOIN playlists p ON p.id = pi.playlist_id
            WHERE p.user_id = ${userId} AND p.kind = 'liked';
          `.catch(() => []),
          sql`SELECT video_id FROM user_video_feedback WHERE user_id = ${userId};`.catch(() => []),
        ]);

        const userProfile = buildUserTasteProfile(sanitizedRows, {
          subscribedChannelIds: subRows.map((r) => r.channel_id),
          likedVideoIds: likedRows.map((r) => r.video_id),
          notInterestedIds: feedbackRows.map((r) => r.video_id),
        });

        rankedRows = rankHomeFeedVideos(sanitizedRows, userProfile, {
          allow18Plus,
          seed: hourSeed,
        });
      } else {
        rankedRows = rankHomeFeedVideos(sanitizedRows, null, {
          allow18Plus: false,
          seed: hourSeed,
        });
      }
    } catch (rankErr) {
      console.warn('[API_VIDEOS_RANK_FALLBACK]:', rankErr?.message);
    }

    return NextResponse.json({ success: true, data: rankedRows }, { headers });
  } catch (err) {
    return apiError(err, { context: 'GET /api/videos', body: { data: [] } });
  }
}
