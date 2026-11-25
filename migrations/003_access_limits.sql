CREATE TABLE IF NOT EXISTS api_rate_limits (
    scope TEXT NOT NULL,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    window_start TIMESTAMPTZ NOT NULL,
    request_count INT NOT NULL DEFAULT 1 CHECK (request_count > 0),
    PRIMARY KEY (scope, user_id, window_start)
);

CREATE INDEX IF NOT EXISTS idx_api_rate_limits_window_start ON api_rate_limits (window_start);

-- Install the current version schema on older databases that predate versions.
CREATE TABLE IF NOT EXISTS video_versions (
    id                        SERIAL PRIMARY KEY,
    video_id                  INT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    version_key               VARCHAR(64) NOT NULL,
    label                     VARCHAR(80) NOT NULL,
    badge                     VARCHAR(32) DEFAULT '',
    aspect_label              VARCHAR(24) DEFAULT '',
    description               TEXT DEFAULT '',
    is_default                BOOLEAN DEFAULT FALSE,
    sort_order                INT DEFAULT 0,
    source_type               VARCHAR(50) NOT NULL DEFAULT 'hls',
    onedrive_item_id          VARCHAR(255),
    onedrive_folder_id        VARCHAR(255),
    hls_folder_path           TEXT DEFAULT '',
    master_playlist_path      TEXT DEFAULT '',
    storyboard_vtt_path       TEXT DEFAULT '',
    raw_file_name             TEXT DEFAULT '',
    duration                  INTEGER DEFAULT 0,
    file_size_bytes           BIGINT DEFAULT 0,
    resolution                VARCHAR(50) DEFAULT '1080p',
    fps                       NUMERIC(7, 3) DEFAULT 30,
    codec                     VARCHAR(50) DEFAULT 'h264',
    bitrate                   INTEGER DEFAULT 0,
    thumbnail_url             TEXT DEFAULT '',
    status                    VARCHAR(50) DEFAULT 'READY',
    transcode_progress        INTEGER DEFAULT 0,
    stage_detail              TEXT DEFAULT '',
    error_message             TEXT DEFAULT '',
    runner_specs              JSONB,
    worker_logs               JSONB DEFAULT '[]'::jsonb,
    subtitle_tracks_override  JSONB DEFAULT NULL,
    source_cache_br           TEXT,
    m3u8_cache_br             TEXT,
    source_cache_items_count  INTEGER DEFAULT 0,
    source_cache_expires_at   BIGINT DEFAULT 0,
    created_at                TIMESTAMPTZ DEFAULT NOW(),
    updated_at                TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (video_id, version_key)
);

CREATE INDEX IF NOT EXISTS idx_video_versions_video_id ON video_versions (video_id, sort_order, id);
ALTER TABLE videos ADD COLUMN IF NOT EXISTS default_version_id INT;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS upload_reserved_bytes BIGINT;
ALTER TABLE video_versions ADD COLUMN IF NOT EXISTS upload_reserved_bytes BIGINT;
ALTER TABLE video_versions ADD COLUMN IF NOT EXISTS upload_quota_user_id INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS watch_history ADD COLUMN IF NOT EXISTS last_version_id INT;

CREATE TABLE IF NOT EXISTS upload_reservations (
    raw_file_name TEXT PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes')
);

CREATE INDEX IF NOT EXISTS idx_upload_reservations_owner ON upload_reservations (user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_upload_reservations_expiry ON upload_reservations (expires_at);
CREATE INDEX IF NOT EXISTS idx_videos_user_id ON videos (user_id);
CREATE INDEX IF NOT EXISTS idx_video_versions_quota_user ON video_versions (upload_quota_user_id)
    WHERE upload_quota_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION reserve_upload_capacity(
    owner_id INT, filename TEXT, requested_size BIGINT, quota BIGINT, storage_usage JSONB
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    allocated_bytes NUMERIC;
    reserved_bytes NUMERIC;
BEGIN
    IF requested_size <= 0 OR requested_size > quota THEN
        RETURN FALSE;
    END IF;

    -- Serialize admissions for one owner. An upload and a version share that budget.
    PERFORM pg_advisory_xact_lock(841332, owner_id);

    WITH assets AS (
        -- A parent with versions mirrors one of those versions. Count the assets once.
        SELECT v.id AS video_id, v.status, v.raw_file_name,
            GREATEST(v.upload_reserved_bytes, v.file_size_bytes, 0) AS bytes
        FROM videos v
        WHERE v.user_id = owner_id
            AND NOT EXISTS (SELECT 1 FROM video_versions vv WHERE vv.video_id = v.id)
        UNION ALL
        SELECT vv.video_id, vv.status, vv.raw_file_name,
            GREATEST(vv.upload_reserved_bytes, vv.file_size_bytes, 0) AS bytes
        FROM video_versions vv
        JOIN videos v ON v.id = vv.video_id
        WHERE v.user_id = owner_id OR (v.user_id IS NULL AND vv.upload_quota_user_id = owner_id)
    ),
    totals AS (
        SELECT video_id, SUM(bytes) AS recorded_bytes,
            SUM(CASE WHEN status = 'UPLOADING' THEN GREATEST(
                bytes - COALESCE((storage_usage -> 'rawBytes' ->> LOWER(raw_file_name))::bigint, 0),
                0
            ) ELSE 0 END) AS pending_bytes
        FROM assets
        GROUP BY video_id
    )
    SELECT COALESCE(SUM(GREATEST(
        recorded_bytes,
        pending_bytes + COALESCE((storage_usage -> 'videoBytes' ->> video_id::text)::bigint, 0)
    )), 0)
      INTO allocated_bytes
      FROM totals;

    SELECT COALESCE(SUM(r.file_size_bytes), 0)
      INTO reserved_bytes
      FROM upload_reservations r
     WHERE r.user_id = owner_id AND r.expires_at > NOW();

    IF allocated_bytes + reserved_bytes + requested_size > quota THEN
        RETURN FALSE;
    END IF;

    INSERT INTO upload_reservations (raw_file_name, user_id, file_size_bytes)
    VALUES (filename, owner_id, requested_size);
    RETURN TRUE;
END;
$$;
