-- Fix PostgreSQL 42804: UNION types video_status and character varying cannot be matched
-- videos.status uses the video_status ENUM on production databases, while video_versions.status is VARCHAR(50).
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
        SELECT v.id AS video_id, v.status::text AS status, v.raw_file_name,
            GREATEST(v.upload_reserved_bytes, v.file_size_bytes, 0) AS bytes
        FROM videos v
        WHERE v.user_id = owner_id
            AND NOT EXISTS (SELECT 1 FROM video_versions vv WHERE vv.video_id = v.id)
        UNION ALL
        SELECT vv.video_id, vv.status::text AS status, vv.raw_file_name,
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
