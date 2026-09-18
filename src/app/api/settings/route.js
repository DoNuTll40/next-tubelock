import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

// Default fallback configs in case DB is unreachable or keys are missing
const DEFAULT_SETTINGS = {
  onedrive_config: {
    target_folder: '/Videos',
    scan_subfolders: true,
  },
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

import { getDb } from '@/lib/db';

function getDbClient() {
  return getDb();
}

/**
 * GET /api/settings
 * Retrieves all app settings mapped by key
 */
export async function GET() {
  try {
    const sql = getDbClient();

    // Auto-create table if it doesn't exist yet
    await sql`
      CREATE TABLE IF NOT EXISTS app_settings (
        key VARCHAR(100) PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    const rows = await sql`SELECT key, value FROM app_settings;`;

    // Map rows array into an object: { [key]: value }
    const settingsMap = { ...DEFAULT_SETTINGS };
    for (const row of rows) {
      if (row.key) {
        settingsMap[row.key] = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      }
    }

    return NextResponse.json({
      success: true,
      data: settingsMap,
    });
  } catch (error) {
    console.error('[API_SETTINGS_GET_ERROR]:', error);
    // Return fallback gracefully to prevent web crash
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to fetch settings from database',
        data: DEFAULT_SETTINGS,
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/settings
 * Upserts a setting by key and value
 */
export async function POST(request) {
  try {
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
    console.error('[API_SETTINGS_POST_ERROR]:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to update settings in database',
      },
      { status: 500 }
    );
  }
}
