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
}

export async function appendWorkerLog(
  sql,
  videoId,
  { source = 'api', label = 'Studio API', level = 'info', message = '' } = {}
) {
  const vidNum = Number(videoId);
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
  } catch (err) {
    console.warn('[appendWorkerLog warning]:', err.message);
  }
}
