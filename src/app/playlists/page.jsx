import { redirect } from 'next/navigation';
import { getCachedServerSession } from '@/lib/access';
import { getDb } from '@/lib/db';
import { ensurePlaylistSchema, listPlaylists } from '@/lib/playlists';
import PlaylistsClient from './PlaylistsClient';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'เพลย์ลิสต์ - TubeLock',
  description: 'จัดการเพลย์ลิสต์ ดูภายหลัง และวิดีโอที่ชอบ',
};

export default async function PlaylistsPage() {
  const session = await getCachedServerSession();
  if (!session?.id) redirect('/login?from=%2Fplaylists');

  let playlists = null;
  try {
    const sql = getDb();
    await ensurePlaylistSchema(sql);
    playlists = await listPlaylists(sql, session.id);
  } catch (error) {
    console.error('[PlaylistsPage]', error.message);
  }

  return <PlaylistsClient initialPlaylists={playlists} />;
}
