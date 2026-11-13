'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useSession } from '@/context/SessionContext';

const posters = new Map();
const listeners = new Set();
const cacheDuration = 5 * 60 * 1000;

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(id, poster) {
  posters.set(id, poster);
  for (const listener of listeners) listener();
}

async function reveal(id, fresh) {
  if (!id || posters.get(id)?.status === 'loading') return;

  publish(id, { status: 'loading' });
  try {
    const response = await fetch(`/api/videos/${id}/poster${fresh ? '?fresh=1' : ''}`, { method: 'POST' });
    if (!response.ok) throw new Error('Poster unavailable');

    const { url } = await response.json();
    if (!url) throw new Error('Poster unavailable');

    const image = new Image();
    image.src = url;
    await image.decode();
    try {
      sessionStorage.setItem(`tubelock_revealed_poster_${id}`, '1');
    } catch {}
    publish(id, { url, status: 'ready', expiresAt: Date.now() + cacheDuration });
  } catch {
    publish(id, { status: 'failed' });
  }
}

const getServerSnapshot = () => null;

export function usePosterReveal(videoId, restore = true) {
  const isLoggedIn = Boolean(useSession());
  const id = isLoggedIn && videoId ? String(videoId) : null;
  const getSnapshot = useCallback(() => (id ? posters.get(id) ?? null : null), [id]);
  const poster = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const revealPoster = useCallback((fresh = false) => (id ? reveal(id, fresh) : Promise.resolve()), [id]);

  useEffect(() => {
    if (!id || !restore) return;
    try {
      if (sessionStorage.getItem(`tubelock_revealed_poster_${id}`) !== '1') return;
    } catch {
      return;
    }
    const cached = posters.get(id);
    if (!cached || (cached.status === 'ready' && cached.expiresAt <= Date.now())) {
      void reveal(id, cached?.status === 'ready');
    }
  }, [id, restore]);

  return { poster, revealPoster };
}
