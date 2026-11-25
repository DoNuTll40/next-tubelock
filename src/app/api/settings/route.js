import { getSessionUserId, isAdmin, accessError } from '@/lib/access';
import { apiError } from '@/lib/apiError';
import { getDb } from '@/lib/db';
import { NextResponse } from 'next/server';

// Default fallback configs in case DB is unreachable or keys are missing
const DEFAULT_SETTINGS = {
  player_defaults: {
    fit: 'contain',
    speed: 1.0,
    volume: 1.0,
    autoplay: false,
    seekStep: 10,
    rememberPos: true,
    restrictedMode: false,
    statsForNerds: false,
  },
  theme_config: {
    primary: '#3b82f6',
    bg_main: '#0a0a0a',
    bg_card: '#171717',
    bg_nav: '#0f0f0f',
    text_primary: '#ffffff',
    text_muted: '#a3a3a3',
    border_card: '#262626',
    radius_card: '12px',
    radius_btn: '8px',
  },
};

const PUBLIC_SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS);

function getDbClient() {
  return getDb();
}

function sanitizeUserPreferences(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out = {};

  if (typeof input.volume === 'number' && Number.isFinite(input.volume)) {
    out.volume = Math.min(1, Math.max(0, Math.round(input.volume * 100) / 100));
  }
  if (typeof input.autoplay === 'boolean') {
    out.autoplay = input.autoplay;
  }
  if (typeof input.default_speed === 'number' && [0.5, 0.75, 1, 1.25, 1.5, 2].includes(input.default_speed)) {
    out.default_speed = input.default_speed;
  }
  if (typeof input.default_fit === 'string' && ['fit', 'fill', 'contain', 'cover'].includes(input.default_fit)) {
    out.default_fit = input.default_fit;
  }
  if (typeof input.seek_step === 'number' && [5, 10, 15, 30].includes(input.seek_step)) {
    out.seek_step = input.seek_step;
  }
  if (typeof input.auto_stats === 'boolean') {
    out.auto_stats = input.auto_stats;
  }
  if (typeof input.allow_18plus === 'boolean') {
    out.allow_18plus = input.allow_18plus;
  }
  if (typeof input.theme === 'string' && ['light', 'dark', 'auto'].includes(input.theme)) {
    out.theme = input.theme;
  }

  return out;
}

async function ensureUserSettingsTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
}

/**
 * GET /api/settings
 * Retrieves global app settings + signed-in user's personal preferences
 */
export async function GET() {
  try {
    const sql = getDbClient();

    // Auto-create tables if they don't exist yet
    await sql`
      CREATE TABLE IF NOT EXISTS app_settings (
        key VARCHAR(100) PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    const [rows, actor] = await Promise.all([
      sql`SELECT key, value FROM app_settings WHERE key = ANY(${PUBLIC_SETTINGS_KEYS}::text[]);`,
      getSessionUserId(sql).catch(() => null),
    ]);

    // Map rows array into an object: { [key]: value }
    const settingsMap = { ...DEFAULT_SETTINGS };
    for (const row of rows) {
      if (PUBLIC_SETTINGS_KEYS.includes(row.key)) {
        settingsMap[row.key] = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      }
    }

    let userPreferences = null;
    if (actor != null) {
      await ensureUserSettingsTable(sql);
      const userRows = await sql`
        SELECT preferences FROM user_settings WHERE user_id = ${actor} LIMIT 1;
      `;
      const rawPrefs = userRows[0]?.preferences;
      if (rawPrefs) {
        userPreferences = typeof rawPrefs === 'string' ? JSON.parse(rawPrefs) : rawPrefs;
      }
    }

    return NextResponse.json({
      success: true,
      data: settingsMap,
      userPreferences,
    });
  } catch (error) {
    return apiError(error, {
      context: 'GET /api/settings',
      body: { data: DEFAULT_SETTINGS, userPreferences: null },
    });
  }
}

/**
 * PATCH /api/settings
 * Auto-saves signed-in user's personal preferences to Neon DB
 */
export async function PATCH(request) {
  try {
    const actor = await getSessionUserId();
    if (actor == null) return accessError(401);

    const body = await request.json();
    const patch = sanitizeUserPreferences(body?.preferences ?? body);

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid preference fields provided' },
        { status: 400 }
      );
    }

    const sql = getDbClient();
    await ensureUserSettingsTable(sql);

    const jsonPatch = JSON.stringify(patch);
    const rows = await sql`
      INSERT INTO user_settings (user_id, preferences, updated_at)
      VALUES (${actor}, ${jsonPatch}::jsonb, NOW())
      ON CONFLICT (user_id) DO UPDATE
      SET preferences = COALESCE(user_settings.preferences, '{}'::jsonb) || EXCLUDED.preferences,
          updated_at = NOW()
      RETURNING preferences;
    `;

    const savedPrefs = rows[0]?.preferences || patch;
    return NextResponse.json({
      success: true,
      userPreferences: typeof savedPrefs === 'string' ? JSON.parse(savedPrefs) : savedPrefs,
    });
  } catch (error) {
    return apiError(error, { context: 'PATCH /api/settings' });
  }
}

/**
 * POST /api/settings
 * Upserts a setting by key and value
 */
export async function POST(request) {
  try {
    const actor = await getSessionUserId();
    if (actor == null) return accessError(401);
    if (!isAdmin(actor)) return accessError(403);

    const body = await request.json();
    const { key, value } = body || {};

    if (!key || typeof key !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Field "key" (string) is required' },
        { status: 400 }
      );
    }

    if (value === undefined) {
      return NextResponse.json(
        { success: false, error: 'Field "value" is required' },
        { status: 400 }
      );
    }

    const sql = getDbClient();

    // Auto-create table if not exists
    await sql`
      CREATE TABLE IF NOT EXISTS app_settings (
        key VARCHAR(100) PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    // Neon handles json serialization when passing value directly or stringified with ::jsonb
    const jsonValue = typeof value === 'string' ? value : JSON.stringify(value);

    await sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (${key}, ${jsonValue}::jsonb, NOW())
      ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value, updated_at = NOW();
    `;

    return NextResponse.json({
      success: true,
      message: `Setting "${key}" updated successfully`,
      data: {
        key,
        value,
      },
    });
  } catch (error) {
    return apiError(error, { context: 'POST /api/settings' });
  }
}
