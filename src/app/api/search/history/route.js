import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';

let tableEnsured = false;

async function ensureSearchHistoryTable(sql) {
  if (tableEnsured) return;
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS search_history (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        query TEXT NOT NULL,
        thumbnail TEXT DEFAULT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, query)
      );
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_search_history_user ON search_history(user_id, updated_at DESC);
    `;
    tableEnsured = true;
  } catch (err) {
    console.warn('[DB search_history Init Warning]:', err.message);
  }
}

async function resolveUserId(sql) {
  const cookieStore = await cookies();
  const token = cookieStore.get('tubelock_session')?.value;
  if (!token) return null;

  try {
    const sessionRows = await sql`
      SELECT user_id FROM user_sessions
      WHERE session_token = ${token}
        AND is_active = TRUE
        AND expires_at > NOW()
      LIMIT 1;
    `;
    return sessionRows.length > 0 ? sessionRows[0].user_id : null;
  } catch {
    return null;
  }
}

// 📥 GET: ดึงประวัติการค้นหาของ Account ที่กำลังล็อกอิน
export async function GET() {
  try {
    const sql = getDb();
    await ensureSearchHistoryTable(sql);

    const userId = await resolveUserId(sql);
    if (!userId) {
      return NextResponse.json({ success: true, loggedIn: false, data: [] });
    }

    const rows = await sql`
      SELECT id, query, thumbnail, updated_at
      FROM search_history
      WHERE user_id = ${userId}
      ORDER BY updated_at DESC
      LIMIT 30;
    `;

    return NextResponse.json({
      success: true,
      loggedIn: true,
      data: rows.map((r) => ({
        id: `db_${r.id}`,
        dbId: r.id,
        query: r.query,
        thumbnail: r.thumbnail || null,
        updatedAt: r.updated_at,
      })),
    });
  } catch (error) {
    console.error('Error in GET /api/search/history:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch search history' },
      { status: 500 }
    );
  }
}

// 📤 POST: บันทึกหรืออัปเดตคำค้นหาลง Account ในฐานข้อมูล
export async function POST(request) {
  try {
    const sql = getDb();
    await ensureSearchHistoryTable(sql);

    const userId = await resolveUserId(sql);
    const body = await request.json().catch(() => ({}));
    const query = (body.query || '').trim();
    const thumbnail = body.thumbnail || null;

    if (!query) {
      return NextResponse.json({ success: false, error: 'Query is required' }, { status: 400 });
    }

    if (!userId) {
      // ผู้ใช้ยังไม่ล็อกอิน ให้ client จัดการเก็บใน localStorage
      return NextResponse.json({ success: true, loggedIn: false });
    }

    // Upsert: ถ้าเคยค้นคำนี้แล้วให้อัปเดต updated_at และ thumbnail ล่าสุด
    await sql`
      INSERT INTO search_history (user_id, query, thumbnail, updated_at)
      VALUES (${userId}, ${query}, ${thumbnail}, NOW())
      ON CONFLICT (user_id, query)
      DO UPDATE SET
        thumbnail = COALESCE(EXCLUDED.thumbnail, search_history.thumbnail),
        updated_at = NOW();
    `;

    return NextResponse.json({ success: true, loggedIn: true });
  } catch (error) {
    console.error('Error in POST /api/search/history:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save search history' },
      { status: 500 }
    );
  }
}

// 🗑️ DELETE: ลบคำค้นหารายตัว หรือล้างประวัติทั้งหมดของ Account
export async function DELETE(request) {
  try {
    const sql = getDb();
    await ensureSearchHistoryTable(sql);

    const userId = await resolveUserId(sql);
    if (!userId) {
      return NextResponse.json({ success: true, loggedIn: false });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const query = searchParams.get('query');
    const clearAll = searchParams.get('all') === '1';

    if (clearAll) {
      await sql`DELETE FROM search_history WHERE user_id = ${userId};`;
      return NextResponse.json({ success: true, clearedAll: true });
    }

    if (id) {
      const cleanId = id.startsWith('db_') ? parseInt(id.replace('db_', ''), 10) : parseInt(id, 10);
      if (!isNaN(cleanId)) {
        await sql`DELETE FROM search_history WHERE id = ${cleanId} AND user_id = ${userId};`;
      }
    } else if (query) {
      await sql`DELETE FROM search_history WHERE query = ${query.trim()} AND user_id = ${userId};`;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in DELETE /api/search/history:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete search history' },
      { status: 500 }
    );
  }
}
