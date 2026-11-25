import { apiError } from '@/lib/apiError';
import { NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/access';
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
    const userId = await getSessionUserId();

    if (userId == null) {
      return NextResponse.json({
        success: true,
        authenticated: false,
        subtitleSettings: null,
      });
    }

    const sql = getDb();
    await ensureSubtitleColumn(sql);

    const [user] = await sql`
      SELECT subtitle_settings FROM users WHERE id = ${userId}
    `;

    if (!user) {
      return NextResponse.json({
        success: true,
        authenticated: false,
        subtitleSettings: null,
      });
    }

    const raw = user.subtitle_settings;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;

    return NextResponse.json({
      success: true,
      authenticated: true,
      userId,
      subtitleSettings: parsed || null,
    });
  } catch (error) {
    return apiError(error, { context: 'GET /api/user/subtitle-settings', message: 'Failed to load user subtitle settings', body: { authenticated: false, subtitleSettings: null } });
  }
}

/**
 * POST /api/user/subtitle-settings
 * บันทึกการตั้งค่าคำบรรยาย (Subtitle Style + CC state) ลงตาราง users ของผู้ใช้ที่ล็อกอินอยู่
 */
export async function POST(request) {
  try {
    const userId = await getSessionUserId();

    if (userId == null) {
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
    return apiError(error, { context: 'POST /api/user/subtitle-settings', message: 'Failed to save user subtitle settings' });
  }
}
