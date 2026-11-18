/**
 * Helper to atomically append structured log entries into `videos.worker_logs` (JSONB)
 * from Next.js API routes without overwriting concurrent GitHub Actions worker logs
 * and without touching `updated_at` (which is used for dispatch anti-spam debounce).
 */

function formatBangkokTimeLabel() {
  try {
    return new Date().toLocaleTimeString('th-TH', {
      timeZone: 'Asia/Bangkok',
      hour12: false,
    });
  } catch {
    return new Date().toISOString().slice(11, 19);
  }
}

export async function ensureWorkerLogsColumn(sql) {
  try {
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS worker_logs JSONB DEFAULT '[]'::jsonb;`;
  } catch (err) {
    console.warn('[worker_logs schema warning]:', err.message);
  }
  try {
    await sql`ALTER TABLE video_versions ADD COLUMN IF NOT EXISTS worker_logs JSONB DEFAULT '[]'::jsonb;`;
  } catch (_) {}
}

export async function appendWorkerLog(
  sql,
  videoId,
  { source = 'api', label = 'Studio API', level = 'info', message = '', versionId = null } = {}
) {
  const vidNum = Number(videoId);
  const verNum = versionId != null && Number.isFinite(Number(versionId)) && Number(versionId) > 0
    ? Number(versionId)
    : null;
  if (!sql || !Number.isFinite(vidNum) || !message) return;

  const entry = {
    id: `${source}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    ts: new Date().toISOString(),
    time: formatBangkokTimeLabel(),
    source,
    label,
    level,
    message: String(message).slice(0, 500),
  };

  try {
    await ensureWorkerLogsColumn(sql);
    const entryJson = JSON.stringify([entry]);
    if (verNum) {
      await sql`
        UPDATE video_versions
        SET worker_logs = COALESCE(
          (
            SELECT jsonb_agg(elem ORDER BY ord ASC)
            FROM (
              SELECT elem, ord
              FROM jsonb_array_elements(COALESCE(video_versions.worker_logs, '[]'::jsonb) || ${entryJson}::jsonb)
              WITH ORDINALITY AS t(elem, ord)
              ORDER BY ord DESC
              LIMIT 120
            ) sub
          ),
          '[]'::jsonb
        )
        WHERE id = ${verNum} AND video_id = ${vidNum};
      `;
    } else {
      await sql`
        UPDATE videos
        SET worker_logs = COALESCE(
          (
            SELECT jsonb_agg(elem ORDER BY ord ASC)
            FROM (
              SELECT elem, ord
              FROM jsonb_array_elements(COALESCE(videos.worker_logs, '[]'::jsonb) || ${entryJson}::jsonb)
              WITH ORDINALITY AS t(elem, ord)
              ORDER BY ord DESC
              LIMIT 120
            ) sub
          ),
          '[]'::jsonb
        )
        WHERE id = ${vidNum};
      `;
    }
  } catch (err) {
    console.warn('[appendWorkerLog warning]:', err.message);
  }
}
