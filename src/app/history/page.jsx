import { cookies } from 'next/headers';
import { getSessionUserId } from '@/lib/access';
import { getDb, retryDbRead } from '@/lib/db';
import { isMusicVideo, protectVideoPoster } from '@/lib/videoUtils';
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

  let history = [];

  if (token) {
    try {
      const sql = getDb();
      const userId = await getSessionUserId(sql);

      if (userId != null) {
        const rows = await retryDbRead(() => sql`
          SELECT 
            h.id AS history_id,
            h.video_id,
            h.last_position_seconds,
            h.watched_date,
            h.watched_at AS updated_at,
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
            v.content_rating,
            v.source_type,
            u.name AS author_name,
            u.email AS author_email,
            u.picture AS author_picture,
            u.handle AS author_handle
          FROM watch_history_log h
          JOIN videos v ON h.video_id = v.id
          LEFT JOIN users u ON v.user_id = u.id
          WHERE h.user_id = ${userId}
          ORDER BY h.watched_at DESC
          LIMIT 150;
        `);

        history = rows.map((r) => ({
          ...protectVideoPoster(r),
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
      initialIsPaused={isPaused}
    />
  );
}
