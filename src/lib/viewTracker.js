import { watchTimeThreshold } from './videoUtils.js';
import { canViewVideo } from './videoVisibility.js';

export async function recordVerifiedView(sql, { videoId, versionId, viewer, watchTime }) {
  const [video] = await sql`
    SELECT id, user_id, visibility, duration
    FROM videos
    WHERE id = ${videoId} AND (${versionId}::int IS NOT NULL OR status = 'READY' OR status IS NULL)
  `;
  if (!video) return { status: 404, body: { success: false, error: 'Video not found' } };
  if (!canViewVideo(video, viewer.id, viewer.isAdmin)) {
    return { status: 403, body: { success: false, error: 'Forbidden' } };
  }

  let duration = Number(video.duration);
  if (versionId != null) {
    const [version] = await sql`
      SELECT duration FROM video_versions
      WHERE id = ${versionId} AND video_id = ${videoId} AND (status = 'READY' OR status IS NULL)
    `;
    if (!version) return { status: 404, body: { success: false, error: 'Video version not found' } };
    duration = Number(version.duration) || duration;
  }

  if (!(duration > 0) || watchTime > duration * 1.1) {
    return { status: 400, body: { success: false, counted: false, reason: 'invalid_watch_time' } };
  }
  if (watchTime < watchTimeThreshold(duration)) {
    return { status: 400, body: { success: false, counted: false, reason: 'insufficient_watch_time' } };
  }

  // Lock the authorized row, then claim the window and increment in one statement.
  const viewerKey = `user_${viewer.id}`;
  const [result] = await sql`
    WITH eligible AS MATERIALIZED (
      SELECT id FROM videos
      WHERE id = ${videoId}
        AND user_id IS NOT DISTINCT FROM ${video.user_id}
        AND visibility IS NOT DISTINCT FROM ${video.visibility}
        AND (
          (${versionId}::int IS NULL AND (status = 'READY' OR status IS NULL))
          OR EXISTS (
            SELECT 1 FROM video_versions vv
            WHERE vv.id = ${versionId} AND vv.video_id = videos.id AND (vv.status = 'READY' OR vv.status IS NULL)
          )
        )
      FOR UPDATE
    ), claimed AS (
      INSERT INTO video_view_log (video_id, viewer_key, bucket)
      SELECT id, ${viewerKey}, FLOOR(EXTRACT(EPOCH FROM NOW()) / 900)::bigint
      FROM eligible
      ON CONFLICT DO NOTHING
      RETURNING video_id
    ), counted AS (
      UPDATE videos v SET views_count = COALESCE(v.views_count, 0) + 1
      FROM claimed WHERE v.id = claimed.video_id
      RETURNING v.id
    )
    SELECT EXISTS (SELECT 1 FROM eligible) AS eligible, EXISTS (SELECT 1 FROM counted) AS counted
  `;
  if (!result.eligible) return { status: 409, body: { success: false, error: 'Video changed' } };
  const body = result.counted
    ? { success: true, counted: true }
    : { success: true, counted: false, reason: 'cooldown' };
  return { status: 200, body };
}
