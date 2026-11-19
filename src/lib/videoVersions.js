let versionSchemaChecked = false;

/**
 * Ensure the multi-version schema exists in Neon DB (idempotent and safe).
 */
export async function ensureVideoVersionsSchema(sql) {
  if (versionSchemaChecked) return;
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS video_versions (
        id                       SERIAL PRIMARY KEY,
        video_id                 INT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
        version_key              VARCHAR(64) NOT NULL,
        label                    VARCHAR(80) NOT NULL,
        badge                    VARCHAR(32) DEFAULT '',
        aspect_label             VARCHAR(24) DEFAULT '',
        description              TEXT DEFAULT '',
        is_default               BOOLEAN DEFAULT FALSE,
        sort_order               INT DEFAULT 0,

        source_type              VARCHAR(50) NOT NULL DEFAULT 'hls',
        onedrive_item_id         VARCHAR(255),
        onedrive_folder_id       VARCHAR(255),
        hls_folder_path          TEXT DEFAULT '',
        master_playlist_path     TEXT DEFAULT '',
        storyboard_vtt_path      TEXT DEFAULT '',
        raw_file_name            TEXT DEFAULT '',
        duration                 INTEGER DEFAULT 0,
        file_size_bytes          BIGINT DEFAULT 0,
        resolution               VARCHAR(50) DEFAULT '1080p',
        fps                      NUMERIC(7, 3) DEFAULT 30,
        codec                    VARCHAR(50) DEFAULT 'h264',
        bitrate                  INTEGER DEFAULT 0,
        thumbnail_url            TEXT DEFAULT '',

        status                   VARCHAR(50) DEFAULT 'READY',
        transcode_progress       INTEGER DEFAULT 0,
        stage_detail             TEXT DEFAULT '',
        error_message            TEXT DEFAULT '',
        runner_specs             JSONB,
        worker_logs              JSONB DEFAULT '[]'::jsonb,
        subtitle_tracks_override JSONB DEFAULT NULL,

        source_cache_br          TEXT,
        m3u8_cache_br            TEXT,
        source_cache_items_count INTEGER DEFAULT 0,
        source_cache_expires_at  BIGINT DEFAULT 0,

        created_at               TIMESTAMPTZ DEFAULT NOW(),
        updated_at               TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (video_id, version_key)
      );
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_video_versions_video_id
      ON video_versions(video_id, sort_order, id);
    `;

    await sql`
      ALTER TABLE videos
      ADD COLUMN IF NOT EXISTS default_version_id INT;
    `;

    try {
      await sql`
        ALTER TABLE watch_history
        ADD COLUMN IF NOT EXISTS last_version_id INT;
      `;
    } catch (_) {}

    versionSchemaChecked = true;
  } catch (err) {
    console.warn('[video_versions schema warning]:', err.message);
  }
}

const THAI_KEY_ALIASES = [
  [/ปกติ|มาตรฐาน|standard|original|normal|widescreen/i, 'standard'],
  [/imax/i, 'imax'],
  [/restored|ฟื้นฟู|คมชัด|enhance/i, 'enhanced'],
  [/uncut|uncensored|เต็ม|ไม่ตัด/i, 'uncut'],
  [/director/i, 'directors-cut'],
];

/**
 * Generate a URL-safe, unique version_key for a given video.
 */
export function slugifyVersionKey(input, existingKeys = []) {
  const raw = String(input || '').trim();
  const used = new Set((existingKeys || []).map((k) => String(k || '').toLowerCase()));

  let base = '';
  for (const [pattern, alias] of THAI_KEY_ALIASES) {
    if (pattern.test(raw)) {
      base = alias;
      break;
    }
  }

  if (!base) {
    base = raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
  }

  if (!base) {
    base = 'version';
  }

  if (!used.has(base)) return base;

  let counter = 2;
  while (used.has(`${base}-${counter}`)) {
    counter += 1;
  }
  return `${base}-${counter}`.slice(0, 64);
}

/**
 * Build OneDrive stream folder name for a version record.
 */
export function buildVersionStreamFolderName(videoId, versionId) {
  return `stream_vid_${videoId}_v${versionId}`;
}

/**
 * Seed the initial/standard version row from an existing single-version video
 * so adding a 2nd version preserves the original stream & OneDrive folder untouched.
 */
export async function ensurePrimaryVersionSeeded(sql, videoId, defaultLabel = 'ปกติ') {
  await ensureVideoVersionsSchema(sql);
  const vidNum = Number(videoId);
  if (!vidNum || Number.isNaN(vidNum)) {
    throw new Error('Invalid videoId');
  }

  const existing = await sql`
    SELECT id, version_key, label, is_default
    FROM video_versions
    WHERE video_id = ${vidNum}
    ORDER BY sort_order ASC, id ASC;
  `;

  if (existing.length > 0) {
    return existing;
  }

  const parentRows = await sql`
    SELECT
      id, source_type, onedrive_item_id, onedrive_folder_id,
      to_jsonb(v)->>'hls_folder_path' AS hls_folder_path,
      master_playlist_path,
      to_jsonb(v)->>'storyboard_vtt_path' AS storyboard_vtt_path,
      raw_file_name, duration, file_size_bytes, resolution, fps, codec,
      COALESCE(bitrate, 0) AS bitrate, thumbnail_url, status,
      transcode_progress, stage_detail, error_message,
      to_jsonb(v)->'runner_specs' AS runner_specs,
      to_jsonb(v)->'worker_logs' AS worker_logs,
      source_cache_br,
      to_jsonb(v)->>'m3u8_cache_br' AS m3u8_cache_br,
      COALESCE(source_cache_items_count, 0) AS source_cache_items_count,
      COALESCE(source_cache_expires_at, 0) AS source_cache_expires_at
    FROM videos v
    WHERE id = ${vidNum}
    LIMIT 1;
  `;

  if (!parentRows.length) {
    throw new Error(`Video #${vidNum} not found`);
  }

  const parent = parentRows[0];
  const inserted = await sql`
    INSERT INTO video_versions (
      video_id, version_key, label, badge, aspect_label, description,
      is_default, sort_order,
      source_type, onedrive_item_id, onedrive_folder_id, hls_folder_path,
      master_playlist_path, storyboard_vtt_path, raw_file_name,
      duration, file_size_bytes, resolution, fps, codec, bitrate, thumbnail_url,
      status, transcode_progress, stage_detail, error_message,
      runner_specs, worker_logs,
      source_cache_br, m3u8_cache_br, source_cache_items_count, source_cache_expires_at
    ) VALUES (
      ${vidNum}, 'standard', ${defaultLabel}, '', '', '',
      TRUE, 0,
      ${parent.source_type || 'hls'},
      ${parent.onedrive_item_id || null},
      ${parent.onedrive_folder_id || null},
      ${parent.hls_folder_path || ''},
      ${parent.master_playlist_path || ''},
      ${parent.storyboard_vtt_path || ''},
      ${parent.raw_file_name || ''},
      ${Number(parent.duration) || 0},
      ${Number(parent.file_size_bytes) || 0},
      ${parent.resolution || '1080p'},
      ${Number(parent.fps) || 30},
      ${parent.codec || 'h264'},
      ${Number(parent.bitrate) || 0},
      ${parent.thumbnail_url || ''},
      ${parent.status || 'READY'},
      ${Number(parent.transcode_progress) || 0},
      ${parent.stage_detail || ''},
      ${parent.error_message || ''},
      ${parent.runner_specs ? JSON.stringify(parent.runner_specs) : null}::jsonb,
      ${Array.isArray(parent.worker_logs) ? JSON.stringify(parent.worker_logs) : '[]'}::jsonb,
      ${parent.source_cache_br || null},
      ${parent.m3u8_cache_br || null},
      ${Number(parent.source_cache_items_count) || 0},
      ${Number(parent.source_cache_expires_at) || 0}
    )
    ON CONFLICT (video_id, version_key) DO UPDATE
      SET updated_at = NOW()
    RETURNING id, version_key, label, is_default;
  `;

  if (inserted[0]?.id) {
    await sql`
      UPDATE videos
      SET default_version_id = COALESCE(default_version_id, ${inserted[0].id})
      WHERE id = ${vidNum};
    `;
  }

  return inserted;
}

/**
 * Slim projection of video_versions (omits heavy source_cache_br & worker_logs).
 */
export async function getVideoVersions(sql, videoId, { readyOnly = false } = {}) {
  const vidNum = Number(videoId);
  if (!vidNum || Number.isNaN(vidNum)) return [];

  try {
    const rows = readyOnly
      ? await sql`
          SELECT
            id, video_id, version_key, label, badge, aspect_label, description,
            is_default, sort_order, source_type, onedrive_item_id, onedrive_folder_id,
            master_playlist_path, storyboard_vtt_path, raw_file_name,
            duration, file_size_bytes, resolution, fps, codec, bitrate, thumbnail_url,
            status, transcode_progress, stage_detail, error_message,
            subtitle_tracks_override, created_at, updated_at
          FROM video_versions
          WHERE video_id = ${vidNum}
            AND (status = 'READY' OR status IS NULL)
          ORDER BY sort_order ASC, id ASC;
        `
      : await sql`
          SELECT
            id, video_id, version_key, label, badge, aspect_label, description,
            is_default, sort_order, source_type, onedrive_item_id, onedrive_folder_id,
            master_playlist_path, storyboard_vtt_path, raw_file_name,
            duration, file_size_bytes, resolution, fps, codec, bitrate, thumbnail_url,
            status, transcode_progress, stage_detail, error_message,
            subtitle_tracks_override, created_at, updated_at
          FROM video_versions
          WHERE video_id = ${vidNum}
          ORDER BY sort_order ASC, id ASC;
        `;
    return rows || [];
  } catch (err) {
    if (err?.code === '42P01') return [];
    throw err;
  }
}

export function formatVersionSummary(row) {
  if (!row) return null;
  const subOverride = Array.isArray(row.subtitle_tracks_override)
    ? row.subtitle_tracks_override
    : null;
  return {
    id: row.id,
    videoId: row.video_id,
    versionKey: row.version_key,
    version_key: row.version_key,
    label: row.label,
    badge: row.badge || '',
    aspectLabel: row.aspect_label || '',
    aspect_label: row.aspect_label || '',
    description: row.description || '',
    isDefault: Boolean(row.is_default),
    is_default: Boolean(row.is_default),
    sortOrder: Number(row.sort_order) || 0,
    sourceType: row.source_type || 'hls',
    duration: Number(row.duration) || 0,
    fileSizeBytes: Number(row.file_size_bytes) || 0,
    resolution: row.resolution || '1080p',
    fps: Number(row.fps) || 0,
    codec: row.codec || 'h264',
    bitrate: Number(row.bitrate) || 0,
    thumbnailUrl: row.thumbnail_url || '',
    status: row.status || 'READY',
    transcodeProgress: Number(row.transcode_progress) || 0,
    stageDetail: row.stage_detail || '',
    errorMessage: row.error_message || '',
    hasSubtitleOverride: Boolean(subOverride && subOverride.length > 0),
    subtitleTracksOverride: subOverride,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Pick the active version matching requested ID/key, or fall back to default / first version.
 */
export function resolveRequestedVersion(versions, requestedParam = null) {
  if (!Array.isArray(versions) || versions.length === 0) return null;

  if (requestedParam !== null && requestedParam !== undefined && String(requestedParam).trim() !== '') {
    const raw = String(requestedParam).trim();
    if (/^\d+$/.test(raw)) {
      const byId = versions.find((v) => Number(v.id) === Number(raw));
      if (byId) return byId;
    }
    const lower = raw.toLowerCase();
    const byKey = versions.find((v) => String(v.version_key || '').toLowerCase() === lower);
    if (byKey) return byKey;
  }

  return versions.find((v) => v.is_default) || versions[0];
}

/**
 * Set one version as the default for its parent video and sync summary fields.
 */
export async function setDefaultVideoVersion(sql, videoId, versionId) {
  const vidNum = Number(videoId);
  const verNum = Number(versionId);
  await ensureVideoVersionsSchema(sql);

  await sql`
    UPDATE video_versions
    SET is_default = (id = ${verNum}),
        updated_at = NOW()
    WHERE video_id = ${vidNum};
  `;

  const rows = await sql`
    SELECT id, duration, file_size_bytes, resolution, fps, codec, bitrate, status
    FROM video_versions
    WHERE id = ${verNum} AND video_id = ${vidNum}
    LIMIT 1;
  `;

  if (rows.length > 0) {
    const v = rows[0];
    await sql`
      UPDATE videos
      SET default_version_id = ${verNum},
          duration = CASE WHEN ${v.status === 'READY' && Number(v.duration) > 0} THEN ${Number(v.duration)} ELSE duration END,
          file_size_bytes = CASE WHEN ${v.status === 'READY' && Number(v.file_size_bytes) > 0} THEN ${Number(v.file_size_bytes)} ELSE file_size_bytes END,
          resolution = CASE WHEN ${v.status === 'READY' && Boolean(v.resolution)} THEN ${v.resolution} ELSE resolution END,
          fps = CASE WHEN ${v.status === 'READY' && Number(v.fps) > 0} THEN ${Number(v.fps)} ELSE fps END,
          codec = CASE WHEN ${v.status === 'READY' && Boolean(v.codec)} THEN ${v.codec} ELSE codec END,
          bitrate = CASE WHEN ${v.status === 'READY' && Number(v.bitrate) > 0} THEN ${Number(v.bitrate)} ELSE bitrate END,
          updated_at = NOW()
      WHERE id = ${vidNum};
    `;
  }

  return rows[0] || null;
}
