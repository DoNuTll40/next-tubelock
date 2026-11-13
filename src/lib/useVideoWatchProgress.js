'use client';

import { useEffect, useState } from 'react';
import { isMusicVideo } from './videoUtils';

export function useVideoWatchProgress(video) {
  const id = video?.id;
  const isMusic = isMusicVideo(video);
  const [saved, setSaved] = useState(null);

  useEffect(() => {
    if (!id) return;
    try {
      const watched = localStorage.getItem(`tubelock_watched_${id}`) === '1';
      const position = isMusic ? 0 : Number(localStorage.getItem(`tubelock_pos_${id}`)) || 0;
      setSaved({ id, watched, position });
    } catch {}
  }, [id, isMusic]);

  const local = saved?.id === id ? saved : null;
  const pos = isMusic ? 0 : Number(video?.last_position_seconds) || local?.position || 0;
  const dur = Number(video?.duration) || 0;
  const hasWatched = Boolean(video?.has_watched || local?.watched);
  const progressPct = isMusic
    ? (hasWatched ? 100 : 0)
    : (dur > 0 && pos > 0 ? Math.min((pos / dur) * 100, 100) : 0);

  return { isMusic, pos, progressPct };
}
