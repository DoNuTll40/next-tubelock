import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';

let columnEnsured = false;

async function ensureSubtitleColumn(sql) {
  if (columnEnsured) return;
  try {
    await sql`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS subtitle_settings JSONB DEFAULT NULL
    `;
    columnEnsured = true;
  } catch (err) {
    console.warn('[SUBTITLE_SETTINGS_COLUMN_WARN]:', err?.message);
  }
}

/**
 * GET /api/user/subtitle-settings
 * ดึงค่าการตั้งค่าคำบรรยาย (Subtitle Style + CC state) ของผู้ใช้ที่ล็อกอินอยู่จากตาราง users
 */
export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('tubelock_session')?.value;

    if (!token) {
      return NextResponse.json({
        success: true,
        authenticated: false,
        subtitleSettings: null,
      });
    }

    const sql = getDb();
    await ensureSubtitleColumn(sql);

    const rows = await sql`
      SELECT u.id AS user_id, u.subtitle_settings
      FROM user_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.session_token = ${token}
        AND s.is_active = TRUE
        AND s.expires_at > NOW()
      LIMIT 1
    `;

    if (!rows || rows.length === 0) {
      return NextResponse.json({
        success: true,
        authenticated: false,
        subtitleSettings: null,
      });
    }

    const raw = rows[0].subtitle_settings;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;

    return NextResponse.json({
      success: true,
      authenticated: true,
      userId: rows[0].user_id,
      subtitleSettings: parsed || null,
    });
  } catch (error) {
    console.error('[API_USER_SUBTITLE_GET_ERROR]:', error);
    return NextResponse.json(
      {
        success: false,
        authenticated: false,
        subtitleSettings: null,
        error: error.message || 'Failed to load user subtitle settings',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/user/subtitle-settings
 * บันทึกการตั้งค่าคำบรรยาย (Subtitle Style + CC state) ลงตาราง users ของผู้ใช้ที่ล็อกอินอยู่
 */
export async function POST(request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('tubelock_session')?.value;

    if (!token) {
      return NextResponse.json({
        success: false,
        authenticated: false,
        error: 'Not authenticated',
      }, { status: 401 });
    }

    const body = await request.json();
    const { style, ccActive } = body || {};

    const sql = getDb();
    await ensureSubtitleColumn(sql);

    const sessionRows = await sql`
      SELECT user_id
      FROM user_sessions
      WHERE session_token = ${token}
        AND is_active = TRUE
        AND expires_at > NOW()
      LIMIT 1
    `;

    if (!sessionRows || sessionRows.length === 0) {
      return NextResponse.json({
        success: false,
        authenticated: false,
        error: 'Session expired or invalid',
      }, { status: 401 });
    }

    const userId = sessionRows[0].user_id;

    // Merge with existing subtitle_settings if partial update
    const existingRows = await sql`
      SELECT subtitle_settings FROM users WHERE id = ${userId} LIMIT 1
    `;
    const existingRaw = existingRows?.[0]?.subtitle_settings;
    const existingObj = (typeof existingRaw === 'string' ? JSON.parse(existingRaw) : existingRaw) || {};

    const updatedSettings = {
      ...existingObj,
      ...(style && typeof style === 'object' ? { style } : {}),
      ...(typeof ccActive === 'boolean' ? { ccActive } : {}),
      updatedAt: new Date().toISOString(),
    };

    const jsonString = JSON.stringify(updatedSettings);

    await sql`
      UPDATE users
      SET subtitle_settings = ${jsonString}::jsonb,
          updated_at = NOW()
      WHERE id = ${userId}
    `;

    return NextResponse.json({
      success: true,
      authenticated: true,
      userId,
      subtitleSettings: updatedSettings,
    });
  } catch (error) {
    console.error('[API_USER_SUBTITLE_POST_ERROR]:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to save user subtitle settings',
      },
      { status: 500 }
    );
  }
}
