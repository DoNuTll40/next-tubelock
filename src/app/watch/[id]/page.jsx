import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import WatchClient from './WatchClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function generateMetadata({ params }) {
  const { id } = await params;
  try {
    const sql = getDb();
    const rows = await sql`
      SELECT id, title, description, thumbnail_url, tags, category
      FROM videos
      WHERE id = ${id}
      LIMIT 1;
    `;
    if (!rows || rows.length === 0) {
      return { title: 'TubeLock' };
    }
    const video = rows[0];
    return {
      title: `${video.title} - TubeLock`,
      description: video.description ? video.description.slice(0, 160) : 'TubeLock Video Streaming',
      openGraph: {
        title: `${video.title} - TubeLock`,
        description: video.description ? video.description.slice(0, 160) : 'TubeLock Video Streaming',
        images: video.thumbnail_url ? [video.thumbnail_url] : [],
      },
    };
  } catch {
    return { title: 'TubeLock' };
  }
}

export default async function WatchPage({ params }) {
  const { id } = await params;
  const sql = getDb();

  let video = null;
  let relatedVideos = [];

  try {
    const [videoRows, relatedRows] = await Promise.all([
      sql`
        SELECT 
          v.id, v.title, v.description, v.duration, v.file_size_bytes, v.resolution,
          v.fps, v.codec, v.bitrate, v.thumbnail_url, v.tags, v.category, v.views_count, v.created_at,
          v.status, v.source_type, v.user_id, v.onedrive_item_id, v.onedrive_folder_id, v.raw_file_name,
          u.name AS author_name, u.email AS author_email, u.picture AS author_picture
        FROM videos v
        LEFT JOIN users u ON v.user_id = u.id
        WHERE v.id = ${id}
        LIMIT 1;
      `,
      sql`
        SELECT 
          v.id, v.title, v.description, v.duration, v.file_size_bytes, v.resolution,
          v.fps, v.codec, v.bitrate, v.thumbnail_url, v.tags, v.category, v.views_count, v.created_at,
          v.status, v.source_type, v.user_id, v.onedrive_item_id, v.onedrive_folder_id,
          u.name AS author_name, u.email AS author_email, u.picture AS author_picture
        FROM videos v
        LEFT JOIN users u ON v.user_id = u.id
        WHERE (v.status = 'READY' OR v.status IS NULL) AND v.id != ${id}
        ORDER BY v.created_at DESC
        LIMIT 30;
      `
    ]);

    if (!videoRows || videoRows.length === 0) {
      notFound();
    }

    video = {
      ...videoRows[0],
      created_at: videoRows[0].created_at ? new Date(videoRows[0].created_at).toISOString() : null,
      views_count: Number(videoRows[0].views_count || 0),
    };

    relatedVideos = relatedRows.map((item) => ({
      ...item,
      created_at: item.created_at ? new Date(item.created_at).toISOString() : null,
      views_count: Number(item.views_count || 0),
    }));
  } catch (err) {
    console.error('[WatchPage SSR Error]:', err);
    notFound();
  }

  return <WatchClient initialVideo={video} initialRelated={relatedVideos} />;
}
