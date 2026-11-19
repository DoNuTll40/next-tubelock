import { notFound, redirect } from 'next/navigation';
import { getCachedServerSession } from '@/lib/access';
import { getDb } from '@/lib/db';
import { ensurePlaylistSchema, getPlaylistDetails } from '@/lib/playlists';
import PlaylistDetailClient from './PlaylistDetailClient';

export const metadata = { title: 'เพลย์ลิสต์ - TubeLock' };

export default async function PlaylistPage({ params }) {
  const { id } = await params;
  const session = await getCachedServerSession();
  const sql = getDb();
  await ensurePlaylistSchema(sql);
  const result = await getPlaylistDetails(sql, id, session?.id);

  if (result.errorStatus === 401) {
    redirect(`/login?from=${encodeURIComponent(`/playlist/${id}`)}`);
  }
  if (result.errorStatus) notFound();

  return (
    <PlaylistDetailClient
      key={result.playlist.route_key}
      initialPlaylist={result.playlist}
      initialItems={result.items}
    />
  );
}
