const POLICIES = {
  uploadSession: { limit: 8, windowSeconds: 600 },
  channelSubscribe: { limit: 30, windowSeconds: 60 },
  videoFeedback: { limit: 60, windowSeconds: 60 },
  searchHistoryRead: { limit: 120, windowSeconds: 60 },
  searchHistoryWrite: { limit: 60, windowSeconds: 60 },
  handleAvailability: { limit: 30, windowSeconds: 60 },
};

export async function rateLimitResponse(sql, scope, userId) {
  const { limit, windowSeconds } = POLICIES[scope];
  const [result] = await sql`
    WITH slot AS (
      SELECT to_timestamp(floor(extract(epoch FROM NOW()) / ${windowSeconds}::int) * ${windowSeconds}::int)
        AS window_start
    ),
    accepted AS (
      INSERT INTO api_rate_limits (scope, user_id, window_start)
      SELECT ${scope}, ${userId}::int, window_start FROM slot
      ON CONFLICT (scope, user_id, window_start) DO UPDATE
      SET request_count = api_rate_limits.request_count + 1
      WHERE api_rate_limits.request_count < ${limit}
      RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM accepted) AS allowed,
      GREATEST(1, CEIL(EXTRACT(EPOCH FROM window_start - NOW()) + ${windowSeconds}::int))::int AS retry_after
    FROM slot;
  `;

  if (result.allowed) return null;
  return Response.json(
    { success: false, error: 'ดำเนินการบ่อยเกินไป กรุณาลองใหม่อีกครั้ง' },
    { status: 429, headers: { 'Retry-After': String(result.retry_after), 'Cache-Control': 'no-store' } }
  );
}
