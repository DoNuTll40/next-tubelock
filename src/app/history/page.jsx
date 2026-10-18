import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';
import { isMusicVideo } from '@/lib/videoUtils';
import HistoryClient from './HistoryClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: 'ประวัติการรับชม - TubeLock',
  description: 'ดูประวัติและวิดีโอที่คุณเคยรับชมบน TubeLock พร้อมสานต่อการเล่นจากจุดที่ค้างไว้',
};

export default async function HistoryPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get('tubelock_session')?.value;
  const isPaused = cookieStore.get('tubelock_pause_history')?.value === 'true';

  let user = null;
  let history = [];

  if (token) {
    try {
      const sql = getDb();
      const userRows = await sql`
        SELECT s.user_id, u.name, u.email, u.picture
        FROM user_sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.session_token = ${token}
          AND s.is_active = TRUE
          AND s.expires_at > NOW()
        LIMIT 1;
      `;
      user = userRows[0] || null;

      if (user) {
        const rows = await sql`
          SELECT 
            h.id AS history_id,
            h.video_id,
            h.last_position_seconds,
            h.updated_at,
            v.id,
            v.title,
            v.description,
            v.duration,
            v.file_size_bytes,
            v.resolution,
            v.fps,
            v.codec,
            v.thumbnail_url,
            v.views_count,
            v.created_at AS video_created_at,
            v.category,
            v.source_type,
            u.name AS author_name,
            u.email AS author_email,
            u.picture AS author_picture
          FROM watch_history h
          JOIN videos v ON h.video_id = v.id
          LEFT JOIN users u ON v.user_id = u.id
          WHERE h.user_id = ${user.user_id}
          ORDER BY h.updated_at DESC
          LIMIT 100;
        `;

        history = rows.map((r) => ({
          ...r,
          history_id: r.history_id,
          video_id: r.video_id,
          last_position_seconds: isMusicVideo(r) ? 0 : Number(r.last_position_seconds || 0),
          updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : null,
          video_created_at: r.video_created_at ? new Date(r.video_created_at).toISOString() : null,
          duration: Number(r.duration || 0),
          views_count: Number(r.views_count || 0),
        }));
      }
    } catch (err) {
      console.error('Error fetching watch history in SSR:', err);
    }
  }

  return (
    <HistoryClient
      initialHistory={history}
      initialUser={user}
      initialIsPaused={isPaused}
    />
  );
}
