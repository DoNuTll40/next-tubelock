const WORKFLOW = 'extract-audio-subtitles.yml';
const activeStatuses = new Set(['extracting', 'processing']);

export function isSubtitleWorkflowActive(video) {
  return activeStatuses.has(video.subtitle_status) || video.audio_status === 'extracting';
}

function githubClient() {
  const token = (process.env.GITHUB_TOKEN || process.env.GH_PAT || process.env.GITHUB_PAT || '').trim();
  if (!token) throw new Error('ยังไม่ได้ตั้งค่า GitHub token');
  const repo = process.env.GITHUB_REPO || 'DoNuTll40/next-tubelock';
  return async (path, method = 'GET') => {
    const response = await fetch(`https://api.github.com/repos/${repo}/actions/${path}`, {
      method,
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) throw new Error(`GitHub Actions HTTP ${response.status}`);
    if (method === 'GET') return response.json();
  };
}

async function findRun(github, video) {
  const prefix = `TubeLock subtitles #${video.id}`;
  const jobId = video.subtitle_job_id;
  const params = new URLSearchParams({ branch: process.env.GITHUB_BRANCH || 'main', event: 'workflow_dispatch', per_page: '30' });
  const { workflow_runs: runs = [] } = await github(`workflows/${WORKFLOW}/runs?${params}`);
  if (jobId) {
    return runs.find((run) => run.display_title === `${prefix} / ${jobId}`) || null;
  }

  // Older workflow runs identify the video in the job name instead of the run title.
  const candidates = runs.filter((run) =>
    !run.display_title?.startsWith('TubeLock subtitles #') || run.display_title === `${prefix} /`
  );
  for (let index = 0; index < candidates.length; index += 5) {
    const matches = await Promise.all(candidates.slice(index, index + 5).map(async (run) => {
      const { jobs } = await github(`runs/${run.id}/jobs`);
      return jobs.some((job) => job.name.startsWith(`Audio & AI Subtitles #${video.id} (`)) ? run : null;
    }));
    const match = matches.find(Boolean);
    if (match) return match;
  }
}

export async function markSubtitleDispatchFailed(sql, videoId, jobId, previousAudioStatus) {
  await sql`
    UPDATE videos
    SET subtitle_status = 'failed',
        audio_status = ${previousAudioStatus === 'ready' ? 'ready' : 'failed'}
    WHERE id = ${videoId} AND subtitle_job_id = ${jobId} AND subtitle_status = 'extracting'
  `;
}

export async function reconcileSubtitleWorkflow(sql, video, { cancel = false } = {}) {
  if (!isSubtitleWorkflowActive(video)) return video;
  const github = githubClient();
  const run = await findRun(github, video);
  if (!run) {
    // Use Postgres server clock instead of local Date.now() to avoid local PC clock skew
    const [clockRow] = await sql`
      SELECT EXTRACT(EPOCH FROM (NOW() - updated_at)) * 1000 AS age_ms
      FROM videos
      WHERE id = ${video.id}
      LIMIT 1
    `;
    const ageMs = Number(clockRow?.age_ms ?? 0);
    if (cancel) {
      if (ageMs < 15000) {
        throw new Error('ยังไม่พบงานซับใน GitHub Actions ลองอีกครั้งหลัง GitHub รับงาน');
      }
    } else if (ageMs < 2 * 60 * 60 * 1000) {
      return video;
    }
  } else if (run.status !== 'completed') {
    if (cancel) {
      try {
        await github(`runs/${run.id}/cancel`, 'POST');
      } catch (error) {
        const latest = await github(`runs/${run.id}`);
        if (latest.status !== 'completed') throw error;
        return reconcileSubtitleWorkflow(sql, video);
      }
    }
    return video;
  }

  const subtitleStatus = cancel || run?.conclusion === 'cancelled' ? 'cancelled' : 'failed';
  const [updated] = await sql`
    UPDATE videos v
    SET subtitle_status = ${subtitleStatus},
        audio_status = CASE WHEN audio_status = 'extracting' THEN ${subtitleStatus} ELSE audio_status END,
        updated_at = NOW()
    WHERE id = ${video.id}
      AND (to_jsonb(v)->>'subtitle_job_id') IS NOT DISTINCT FROM ${video.subtitle_job_id ?? null}
      AND (subtitle_status IN ('extracting', 'processing') OR audio_status = 'extracting')
    RETURNING subtitle_status, audio_status
  `;
  return updated ? { ...video, ...updated } : video;
}
