CREATE TABLE IF NOT EXISTS video_view_log (
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    viewer_key TEXT NOT NULL,
    bucket BIGINT NOT NULL,
    PRIMARY KEY (video_id, viewer_key, bucket)
);

CREATE INDEX IF NOT EXISTS video_view_log_bucket_idx ON video_view_log (bucket);
