'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { isMusicVideo } from './videoUtils';

const getServerProgress = () => '';

export function useVideoWatchProgress(video) {
  const id = video?.id;
  const isMusic = isMusicVideo(video);
  const watchedKey = `tubelock_watched_${id}`;
  const positionKey = `tubelock_pos_${id}`;

  const subscribe = useCallback((onChange) => {
    const handleStorage = (event) => {
      if (event.key === null || event.key === watchedKey || event.key === positionKey) onChange();
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [watchedKey, positionKey]);
  const getProgress = () => {
    if (!id) return '';
    try {
      const watched = localStorage.getItem(watchedKey) === '1' ? '1' : '0';
      const position = isMusic ? '' : localStorage.getItem(positionKey) || '';
      return `${watched}:${position}`;
    } catch {
      return '';
    }
  };

  const saved = useSyncExternalStore(subscribe, getProgress, getServerProgress);
  const [savedWatched, savedPosition] = saved.split(':', 2);
  const pos = isMusic ? 0 : Number(video?.last_position_seconds) || Number(savedPosition) || 0;
  const dur = Number(video?.duration) || 0;
  const hasWatched = Boolean(video?.has_watched || savedWatched === '1');
  const progressPct = isMusic
    ? (hasWatched ? 100 : 0)
    : (dur > 0 && pos > 0 ? Math.min((pos / dur) * 100, 100) : 0);

  return { isMusic, pos, progressPct };
}
