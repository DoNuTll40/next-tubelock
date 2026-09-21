import { getDb } from './db';

/**
 * Initialize all required tables in Neon DB if they don't exist yet.
 * Safe to call on every startup or first request — uses IF NOT EXISTS.
 */
export async function initTables() {
  const sql = getDb();

  // ── users: one row per unique social identity ─────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id         SERIAL PRIMARY KEY,
      provider   VARCHAR(20)  NOT NULL,
      sub        VARCHAR(255) NOT NULL,
      name       TEXT,
      email      TEXT,
      picture    TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(provider, sub)
    )
  `;

  // ── user_sessions: one row per active login ───────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id             SERIAL PRIMARY KEY,
      session_token  VARCHAR(64) UNIQUE NOT NULL,
      user_id        INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider       VARCHAR(20) NOT NULL,

      -- Device fingerprint (parsed from User-Agent)
      device_type    VARCHAR(20),      -- 'mobile' | 'desktop' | 'tablet'
      device_name    TEXT,             -- e.g. "Chrome 128 on Windows 10/11"
      os             TEXT,
      browser        TEXT,

      -- Location (from IP)
      ip_address     VARCHAR(45),
      country        VARCHAR(100),
      city           TEXT,

      -- Session lifecycle
      created_at     TIMESTAMPTZ DEFAULT NOW(),
      last_seen_at   TIMESTAMPTZ DEFAULT NOW(),
      expires_at     TIMESTAMPTZ NOT NULL,
      is_active      BOOLEAN DEFAULT TRUE
    )
  `;

  // Fast lookup index on session_token for active sessions
  await sql`
    CREATE INDEX IF NOT EXISTS idx_user_sessions_token
    ON user_sessions(session_token)
    WHERE is_active = TRUE
  `;
}
