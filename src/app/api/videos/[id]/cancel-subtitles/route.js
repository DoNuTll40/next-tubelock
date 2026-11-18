import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSessionUserId, isAdmin, accessError } from '@/lib/access';
import { isSubtitleWorkflowActive, reconcileSubtitleWorkflow } from '@/lib/subtitleWorkflow';

export async function POST(_request, { params }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'Invalid video ID' }, { status: 400 });

  try {
    const sql = getDb();
    const userId = await getSessionUserId(sql);
    if (userId == null) return accessError(401);
    const [video] = await sql`
      SELECT id, updated_at, to_jsonb(v)->>'audio_status' AS audio_status,
        to_jsonb(v)->>'subtitle_status' AS subtitle_status,
        to_jsonb(v)->>'subtitle_job_id' AS subtitle_job_id
      FROM videos v
      WHERE id = ${id} AND (${isAdmin(userId)} OR user_id = ${userId})
    `;
    if (!video) return NextResponse.json({ error: 'ไม่พบวิดีโอ' }, { status: 404 });

    const latest = await reconcileSubtitleWorkflow(sql, video, { cancel: true });
    return NextResponse.json({
      cancellationPending: isSubtitleWorkflowActive(latest),
      audioStatus: latest.audio_status,
      subtitleStatus: latest.subtitle_status,
    });
  } catch (error) {
    console.error('[Cancel subtitles]', error);
    return NextResponse.json({ error: error.message || 'ยกเลิกงานซับไม่สำเร็จ' }, { status: 502 });
  }
}
