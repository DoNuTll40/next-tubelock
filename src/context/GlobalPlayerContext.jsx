'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import VideoPlayer from '@/components/VideoPlayer';
import AmbientLight from '@/components/player/AmbientLight';
import FloatingMiniplayerShell from '@/components/player/FloatingMiniplayerShell';
import { usePosterReveal } from '@/lib/usePosterReveal';
import { usePosterPreference } from '@/lib/usePosterPreference';
import {
  resolveClientPlaybackSource,
  fetchVideoSourceClient,
  resolveStoryboard,
  preloadHlsModule,
} from '@/lib/playbackResolver';
import {
  decodeVideoSlug,
  encodeVideoSlug,
  isMatureVideo,
  isMusicVideo,
  RESTRICTED_POSTER,
} from '@/lib/videoUtils';
import { rankRelatedVideos } from '@/lib/recommendationEngine';

export const DESKTOP_HEADER_OFFSET_PX = 105;
export const DESKTOP_PLAYER_MAX_HEIGHT = `calc(100vh - ${DESKTOP_HEADER_OFFSET_PX}px)`;

const GlobalPlayerContext = createContext(null);

const subscribeNoop = () => () => { };
const getServerHostSnapshot = () => null;

let singletonPlayerHostEl = null;
function getSingletonPlayerHost() {
  if (typeof document === 'undefined') return null;
  if (!singletonPlayerHostEl) {
    const existing = document.getElementById('movie_player');
    if (existing) {
      singletonPlayerHostEl = existing;
    } else {
      const el = document.createElement('div');
      el.id = 'movie_player';
      el.className = 'relative w-full h-full';
      singletonPlayerHostEl = el;
    }
  }
  return singletonPlayerHostEl;
}

const primeListeners = new Set();
let globalMiniplayerActive = false;

export function isGlobalMiniplayerActive() {
  return globalMiniplayerActive;
}

function reparentPlayerHost(targetParent, hostEl, videoEl = null) {
  if (!targetParent || !hostEl || hostEl.parentNode === targetParent) return;
  const wasPlaying = Boolean(videoEl && !videoEl.paused && !videoEl.ended);
  if (typeof targetParent.moveBefore === 'function' && hostEl.isConnected && targetParent.isConnected) {
    try {
      targetParent.moveBefore(hostEl, null);
      if (wasPlaying && videoEl?.paused) {
        videoEl.play().catch(() => { });
      }
      return;
    } catch (_) { }
  }
  targetParent.appendChild(hostEl);
  if (wasPlaying && videoEl?.paused) {
    videoEl.play().catch(() => { });
  }
}

/**
 * Trigger instant Player-First stream resolution & buffering at click time (t = 0ms)
 * before Next.js App Router finishes navigating / SSR-rendering /watch/[id].
 */
export function primeGlobalWatchVideo(
  videoData,
  { startTime = 0, versionKey = null, inPlace = false, replace = false, inMiniplayer = false } = {}
) {
  if (!videoData) return;
  for (const listener of primeListeners) {
    listener(videoData, { startTime, versionKey, inPlace, replace, inMiniplayer });
  }
}

function compactCandidateForPool(item) {
  if (!item || !item.id || item.id === 'undefined') return null;
  const {
    description: _d,
    subtitle_srt: _srt,
    subtitle_vtt: _vtt,
    subtitle_tracks: _tracks,
    versions: _vers,
    ...compact
  } = item;
  return compact;
}

function upsertCandidatesToPool(poolMap, items = [], extraItem = null) {
  if (!poolMap) return;
  const upsertOne = (raw) => {
    const compact = compactCandidateForPool(raw);
    if (!compact) return;
    const key = String(compact.id);
    const existing = poolMap.get(key);
    poolMap.set(key, existing ? { ...existing, ...compact } : compact);
    if (poolMap.size > 200) {
      const oldestKey = poolMap.keys().next().value;
      if (oldestKey !== undefined && oldestKey !== key) {
        poolMap.delete(oldestKey);
      }
    }
  };
  if (Array.isArray(items)) {
    for (let i = 0; i < items.length; i++) {
      upsertOne(items[i]);
    }
  }
  if (extraItem) {
    upsertOne(extraItem);
  }
}

function getVideoMetaRankKey(v) {
  if (!v?.id) return '';
  const tagsKey = Array.isArray(v.tags) ? v.tags.join(',') : String(v.tags || '');
  return `${v.id}|${v.category || ''}|${v.content_rating || ''}|${tagsKey}`;
}

function readStoredPlayerConfig() {
  if (typeof window === 'undefined') return null;
  try {
    const saved = localStorage.getItem('tubelock_settings');
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

function normalizePlaylistKey(rawKey) {
  const key = rawKey?.toLowerCase();
  if (key === 'wl' || key === 'watch_later') return 'WL';
  if (key === 'll' || key === 'liked') return 'LL';
  if (/^\d+$/.test(key) && Number(key) > 0 && Number(key) <= 2147483647) return String(Number(key));
  return null;
}

function writePlaylistParams(url, state) {
  if (state) {
    url.searchParams.set('list', state.listKey);
    url.searchParams.set('index', String(state.currentIndex + 1));
  } else {
    url.searchParams.delete('list');
    url.searchParams.delete('index');
  }
  if (state?.isShuffled) url.searchParams.set('shuffle', '1');
  else url.searchParams.delete('shuffle');
}

function replacePlaylistInUrl(state) {
  const url = new URL(window.location.href);
  if (!url.pathname.startsWith('/watch/')) return;
  writePlaylistParams(url, state);
  if (url.href !== window.location.href) window.history.replaceState(null, '', url);
}

function shufflePlaylist(size, currentIndex, startWithCurrent = true) {
  const order = Array.from({ length: size }, (_, i) => i).filter((i) => i !== currentIndex);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (startWithCurrent) return [currentIndex, ...order];
  order.splice(1 + Math.floor(Math.random() * order.length), 0, currentIndex);
  return order;
}

function preparePlaylistCycle(state) {
  const needsNextCycle = state.isShuffled && state.loopMode === 'all' && state.items.length > 1
    && state.shuffleOrder.at(-1) === state.currentIndex;
  if (needsNextCycle && !state.nextShuffleOrder) {
    return { ...state, nextShuffleOrder: shufflePlaylist(state.items.length, state.currentIndex, false) };
  }
  return !needsNextCycle && state.nextShuffleOrder ? { ...state, nextShuffleOrder: null } : state;
}

function getPlaylistStep(state, direction) {
  if (!state?.items.length) return null;
  const { currentIndex, isShuffled, items, loopMode, nextShuffleOrder, shuffleOrder } = state;
  const position = isShuffled ? shuffleOrder.indexOf(currentIndex) : currentIndex;
  const target = position + direction;
  if (target >= 0 && target < items.length) return { index: isShuffled ? shuffleOrder[target] : target };
  if (loopMode !== 'all') return null;
  if (!isShuffled) return { index: target < 0 ? items.length - 1 : 0 };
  if (direction < 0) return null;
  return { index: nextShuffleOrder?.[0] ?? currentIndex, shuffleOrder: nextShuffleOrder };
}

export function GlobalPlayerProvider({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const hostEl = useSyncExternalStore(
    subscribeNoop,
    getSingletonPlayerHost,
    getServerHostSnapshot
  );

  const parkingRef = useRef(null);
  const activeSlotRef = useRef(null);
  const videoRef = useRef(null);

  const initialSourceRef = useRef(null);
  const initialVideoIdRef = useRef(null);
  const initialVersionKeyRef = useRef(null);
  const activeBlobUrlsRef = useRef([]);
  const partialSegmentMapRef = useRef({});
  const loadedDetailIdRef = useRef(null);
  const primedInfoRef = useRef(null);
  const lastHydratedInitialVideoRef = useRef(null);
  const candidatePoolRef = useRef(new Map());
  const sessionWatchedIdsRef = useRef(new Set());
  const rankedMetaKeyRef = useRef('');
  const rankedSeedRef = useRef(0);
  const playlistStateRef = useRef(null);
  const playlistRequestRef = useRef(null);

  const [isDockedInWatch, setIsDockedInWatch] = useState(false);
  const [isMiniplayer, setIsMiniplayer] = useState(false);
  const isMiniplayerRef = useRef(false);
  const isExpandingFromMiniRef = useRef(false);
  const miniLaunchRectRef = useRef(null);
  const lastNonWatchUrlRef = useRef('/');
  const [selection, setSelection] = useState({ id: null, startTime: 0 });
  const [video, setVideo] = useState(null);
  const [activeVersionKey, setActiveVersionKey] = useState(null);
  const [isSwitchingVersion, setIsSwitchingVersion] = useState(false);
  const [isSwitchingVideo, setIsSwitchingVideo] = useState(false);
  const [relatedVideos, setRelatedVideos] = useState([]);
  const [playlistState, setPlaylistState] = useState(null);
  const [ssrShowAdultPosters, setSsrShowAdultPosters] = useState(false);
  const [streamUrl, setStreamUrl] = useState('');
  const [storyboard, setStoryboard] = useState(null);
  const [error, setError] = useState(null);
  const [detectedRatio, setDetectedRatio] = useState(null);
  const [detectedAudio, setDetectedAudio] = useState(null);
  const [isPlayingHdr, setIsPlayingHdr] = useState(false);
  const [streamAttemptSeq, setStreamAttemptSeq] = useState(0);

  const [playerConfig, setPlayerConfig] = useState(readStoredPlayerConfig);
  const [ambientMode, setAmbientMode] = useState(() => {
    if (typeof window === 'undefined') return true;
    try {
      const saved = localStorage.getItem('tubelock_ambient_mode');
      return saved !== null ? JSON.parse(saved) : true;
    } catch {
      return true;
    }
  });

  const selectionIdRef = useRef(selection.id);
  const activeVersionKeyRef = useRef(activeVersionKey);
  const streamUrlRef = useRef(streamUrl);
  const errorRef = useRef(error);
  const latestSourceTypeRef = useRef(video?.source_type);
  const playerConfigRef = useRef(playerConfig);

  useEffect(() => {
    selectionIdRef.current = selection.id;
  }, [selection.id]);

  useEffect(() => {
    activeVersionKeyRef.current = activeVersionKey;
  }, [activeVersionKey]);

  useEffect(() => {
    streamUrlRef.current = streamUrl;
  }, [streamUrl]);

  useEffect(() => {
    errorRef.current = error;
  }, [error]);

  useEffect(() => {
    latestSourceTypeRef.current = video?.source_type;
  }, [video?.source_type]);

  useEffect(() => {
    playerConfigRef.current = playerConfig;
  }, [playerConfig]);

  const isSwitchingVideoRef = useRef(isSwitchingVideo);
  useEffect(() => {
    isSwitchingVideoRef.current = isSwitchingVideo;
  }, [isSwitchingVideo]);

  const currentVideoRef = useRef(video);
  useEffect(() => {
    currentVideoRef.current = video;
  }, [video]);

  const updatePlaylist = useCallback((nextState) => {
    const next = nextState ? preparePlaylistCycle(nextState) : null;
    playlistStateRef.current = next;
    setPlaylistState(next);
    return next;
  }, []);

  const clearPlaylist = useCallback(({ updateUrl = true } = {}) => {
    playlistRequestRef.current?.controller.abort();
    playlistRequestRef.current = null;
    if (playlistStateRef.current) updatePlaylist(null);
    if (updateUrl) replacePlaylistInUrl(null);
  }, [updatePlaylist]);

  const loadPlaylist = useCallback(async () => {
    const url = new URL(window.location.href);
    if (!url.pathname.startsWith('/watch/')) return;
    const listKey = normalizePlaylistKey(url.searchParams.get('list'));
    if (!listKey) {
      clearPlaylist();
      return;
    }

    function syncPlaylist(state, location) {
      const id = decodeVideoSlug(location.pathname.split('/').at(-1));
      const currentIndex = state.items.findIndex((item) => Number(item.id) === id);
      if (currentIndex < 0) {
        clearPlaylist();
        return;
      }
      const isShuffled = location.searchParams.get('shuffle') === '1';
      if (state.isShuffled !== isShuffled) {
        state = {
          ...state,
          isShuffled,
          shuffleOrder: isShuffled ? shufflePlaylist(state.items.length, currentIndex) : [],
          nextShuffleOrder: null,
        };
      }
      if (state.currentIndex !== currentIndex) state = { ...state, currentIndex, nextShuffleOrder: null };
      if (state !== playlistStateRef.current) state = updatePlaylist(state);
      replacePlaylistInUrl(state);
    }

    const current = playlistStateRef.current;
    if (current?.listKey === listKey && !current.isLoading) {
      syncPlaylist(current, url);
      return;
    }
    if (playlistRequestRef.current?.listKey === listKey) return;
    playlistRequestRef.current?.controller.abort();
    const controller = new AbortController();
    playlistRequestRef.current = { listKey, controller };
    updatePlaylist({
      listKey, playlist: null, items: [], currentIndex: -1, loopMode: 'none',
      isShuffled: false, shuffleOrder: [], isLoading: true,
    });

    try {
      const response = await fetch(`/api/playlists/${encodeURIComponent(listKey)}`, { signal: controller.signal });
      if (!response.ok) throw new Error('Could not load playlist');
      const data = await response.json();
      if (!data.success || !data.playlist || !Array.isArray(data.items)) throw new Error('Invalid playlist');
      const location = new URL(window.location.href);
      if (controller.signal.aborted || !location.pathname.startsWith('/watch/')
        || normalizePlaylistKey(location.searchParams.get('list')) !== listKey) return;
      syncPlaylist({
        listKey,
        playlist: data.playlist,
        items: data.items.filter((item) => item.id && (!item.status || item.status === 'READY')),
        currentIndex: -1,
        loopMode: 'none',
        isShuffled: false,
        shuffleOrder: [],
        isLoading: false,
      }, location);
    } catch {
      const location = new URL(window.location.href);
      if (!controller.signal.aborted && location.pathname.startsWith('/watch/')
        && normalizePlaylistKey(location.searchParams.get('list')) === listKey) clearPlaylist();
    } finally {
      if (playlistRequestRef.current?.controller === controller) playlistRequestRef.current = null;
    }
  }, [clearPlaylist, updatePlaylist]);

  // Ensure singleton host is parked offscreen when no /watch slot owns it
  useLayoutEffect(() => {
    if (
      hostEl &&
      parkingRef.current &&
      !activeSlotRef.current &&
      hostEl.parentNode !== parkingRef.current
    ) {
      reparentPlayerHost(parkingRef.current, hostEl);
    }
  }, [hostEl]);

  // Cleanup all blob URLs only when top-level AppShell unmounts
  useEffect(() => {
    return () => {
      for (const u of activeBlobUrlsRef.current) {
        try { URL.revokeObjectURL(u); } catch (_) { }
      }
      activeBlobUrlsRef.current = [];
    };
  }, []);

  // Remember the last non-/watch URL so pressing `i` on /watch returns cleanly to where the user came from
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (pathname && !pathname.startsWith('/watch')) {
      lastNonWatchUrlRef.current = `${window.location.pathname}${window.location.search}`;
    }
  }, [pathname]);

  // Guard: leaving /watch clears click-primed intent and parks + pauses #movie_player (UNLESS Miniplayer is active!)
  useEffect(() => {
    if (pathname?.startsWith('/watch')) return;
    primedInfoRef.current = null;
    activeSlotRef.current = null;

    if (isMiniplayerRef.current) {
      const tMini = Promise.resolve().then(() => {
        setIsDockedInWatch(false);
      });
      return () => { void tMini; };
    }

    const t = Promise.resolve().then(() => {
      if (!window.location.pathname.startsWith('/watch/')) clearPlaylist({ updateUrl: false });
      setIsDockedInWatch((prev) => (activeSlotRef.current ? prev : false));
    });

    const v = videoRef.current;
    if (v && typeof document !== 'undefined' && document.pictureInPictureElement !== v) {
      try {
        v.muted = true;
        v.volume = 0;
        if (!v.paused) v.pause();
      } catch (_) { }
    }
    if (hostEl && parkingRef.current && hostEl.parentNode !== parkingRef.current) {
      reparentPlayerHost(parkingRef.current, hostEl);
    }

    return () => { void t; };
  }, [pathname, hostEl, clearPlaylist]);

  const dockPlayerSlot = useCallback(
    (slotEl) => {
      if (!slotEl) return;
      activeSlotRef.current = slotEl;
      isExpandingFromMiniRef.current = false;
      // Move #movie_player into /watch slot FIRST while Miniplayer is still mounted so DOM never detaches <video>!
      reparentPlayerHost(slotEl, hostEl, videoRef.current);
      setIsDockedInWatch(true);
      if (isMiniplayerRef.current) {
        isMiniplayerRef.current = false;
        globalMiniplayerActive = false;
        setIsMiniplayer(false);
      }
    },
    [hostEl]
  );

  const silenceAndPauseCurrentVideo = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    try {
      v.muted = true;
      v.volume = 0;
      if (!v.paused) {
        v.pause();
      }
    } catch (_) { }
  }, []);

  // Prefetch last non-/watch route while watching so swipe-down / `i` Miniplayer return is instant!
  useEffect(() => {
    if (!pathname?.startsWith('/watch')) return;
    const target = lastNonWatchUrlRef.current && !lastNonWatchUrlRef.current.startsWith('/watch')
      ? lastNonWatchUrlRef.current
      : '/';
    try {
      router.prefetch?.(target);
    } catch (_) { }
  }, [pathname, router]);

  const enterMiniplayer = useCallback((options = null) => {
    if (!selectionIdRef.current || !streamUrlRef.current) return;
    if (typeof document !== 'undefined' && document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => { });
    }
    if (options && typeof options === 'object' && options.sourceRect) {
      miniLaunchRectRef.current = {
        rect: options.sourceRect,
        corner: options.preferredCorner || null,
      };
    } else {
      miniLaunchRectRef.current = null;
    }
    isExpandingFromMiniRef.current = false;
    isMiniplayerRef.current = true;
    globalMiniplayerActive = true;
    setIsMiniplayer(true);

    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/watch')) {
      const target = lastNonWatchUrlRef.current && !lastNonWatchUrlRef.current.startsWith('/watch')
        ? lastNonWatchUrlRef.current
        : '/';
      // Wait 1 frame so FloatingMiniplayerShell commits and reparents #movie_player BEFORE /watch unmounts!
      requestAnimationFrame(() => {
        if (isMiniplayerRef.current) {
          router.push(target);
        }
      });
    }
  }, [router]);

  const expandMiniplayer = useCallback(() => {
    const curVideo = currentVideoRef.current;
    const curId = selectionIdRef.current || curVideo?.id;
    if (!curId) {
      isMiniplayerRef.current = false;
      globalMiniplayerActive = false;
      setIsMiniplayer(false);
      return;
    }

    const slug = encodeVideoSlug(curId, curVideo?.category) || String(curId);
    const url = new URL(`/watch/${slug}`, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    if (activeVersionKeyRef.current) {
      url.searchParams.set('v', activeVersionKeyRef.current);
    }
    if (playlistStateRef.current) {
      writePlaylistParams(url, playlistStateRef.current);
    }

    // Keep isMiniplayer = true during route transition so FloatingMiniplayerShell stays mounted & <video> stays active!
    // dockPlayerSlot() will atomically reparent #movie_player into /watch and then close Miniplayer.
    isExpandingFromMiniRef.current = true;
    primedInfoRef.current = {
      id: String(curId),
      versionKey: activeVersionKeyRef.current || null,
      at: Date.now(),
    };
    router.push(`${url.pathname}${url.search}`);
  }, [router]);

  const closeMiniplayer = useCallback(() => {
    isMiniplayerRef.current = false;
    globalMiniplayerActive = false;
    isExpandingFromMiniRef.current = false;
    setIsMiniplayer(false);
    setIsDockedInWatch(false);
    clearPlaylist({ updateUrl: false });
    silenceAndPauseCurrentVideo();
    if (hostEl && parkingRef.current && hostEl.parentNode !== parkingRef.current) {
      reparentPlayerHost(parkingRef.current, hostEl);
    }
  }, [clearPlaylist, hostEl, silenceAndPauseCurrentVideo]);

  // Global keyboard shortcuts when Miniplayer is open on non-/watch pages (`i` = expand, `k` = play/pause, `m` = mute)
  useEffect(() => {
    if (!isMiniplayer) return;
    const handleMiniKeyDown = (e) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName) || e.target?.isContentEditable) return;
      const code = e.code;
      const key = e.key?.toLowerCase();
      if (code === 'KeyI' || key === 'i') {
        e.preventDefault();
        expandMiniplayer();
      } else if (code === 'KeyK' || key === 'k') {
        e.preventDefault();
        const v = videoRef.current;
        if (!v) return;
        if (v.paused || v.ended) v.play().catch(() => { });
        else v.pause();
      } else if (code === 'KeyM' || key === 'm') {
        e.preventDefault();
        const v = videoRef.current;
        if (!v) return;
        v.muted = !v.muted;
      }
    };
    window.addEventListener('keydown', handleMiniKeyDown);
    return () => window.removeEventListener('keydown', handleMiniKeyDown);
  }, [isMiniplayer, expandMiniplayer]);

  const undockPlayerSlot = useCallback(
    (slotEl) => {
      if (!slotEl || activeSlotRef.current !== slotEl) return;
      activeSlotRef.current = null;

      if (isMiniplayerRef.current || isExpandingFromMiniRef.current) {
        setIsDockedInWatch(false);
        return;
      }

      const isPrimedWatchTransition =
        Boolean(primedInfoRef.current) &&
        typeof window !== 'undefined' &&
        window.location.pathname.startsWith('/watch');

      if (!isPrimedWatchTransition) {
        setIsDockedInWatch(false);
        const v = videoRef.current;
        if (v && typeof document !== 'undefined' && document.pictureInPictureElement !== v) {
          try {
            v.muted = true;
            v.volume = 0;
            if (!v.paused) v.pause();
          } catch (_) { }
        }
      }
      if (hostEl && parkingRef.current && hostEl.parentNode !== parkingRef.current) {
        reparentPlayerHost(parkingRef.current, hostEl);
      }
    },
    [hostEl]
  );

  const handleSetAmbientMode = useCallback((val) => {
    setAmbientMode(val);
    try {
      localStorage.setItem('tubelock_ambient_mode', JSON.stringify(val));
    } catch (_) { }
  }, []);

  // YouTube In-Place Instant Video Switcher (keeps #movie_player, #player-primary-container & Fullscreen 100% intact)
  const handleSelectVideo = useCallback(
    (newVideo, resumeTime = 0, {
      replace = false, preservePlaylist = false, nextPlaylistIndex, nextShuffleOrder, updateHistory = true,
    } = {}) => {
      if (!newVideo || !newVideo.id || newVideo.id === 'undefined') {
        return;
      }
      if (String(newVideo.id) === String(selectionIdRef.current)) {
        if (isMiniplayerRef.current && videoRef.current?.paused) {
          videoRef.current.play().catch(() => { });
        }
        return;
      }

      const safeId = newVideo.id && newVideo.id !== 'undefined' ? newVideo.id : '';
      const videoSlug =
        encodeVideoSlug(safeId, newVideo.category) || (safeId ? String(safeId) : '');
      const currentPlaylist = playlistStateRef.current;
      let nextPlaylist = null;
      if (preservePlaylist && currentPlaylist?.items[nextPlaylistIndex]?.id === newVideo.id) {
        nextPlaylist = updatePlaylist({
          ...currentPlaylist,
          currentIndex: nextPlaylistIndex,
          shuffleOrder: nextShuffleOrder ?? currentPlaylist.shuffleOrder,
          nextShuffleOrder: null,
        });
      } else if (!preservePlaylist) {
        clearPlaylist({ updateUrl: false });
      }

      const shouldUpdateWatchPage = updateHistory && !isMiniplayerRef.current;
      if (typeof window !== 'undefined' && shouldUpdateWatchPage) {
        const url = new URL(videoSlug ? `/watch/${videoSlug}` : '/', window.location.origin);
        if (nextPlaylist) writePlaylistParams(url, nextPlaylist);
        if (replace && (!currentPlaylist || preservePlaylist)) window.history.replaceState(null, '', url);
        else window.history.pushState(null, '', url);
        document.title = newVideo.title ? `${newVideo.title} - TubeLock` : 'TubeLock';
        if (window.scrollY > 120) {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }

      silenceAndPauseCurrentVideo();

      const prevVideo = currentVideoRef.current;
      primedInfoRef.current = null;
      isSwitchingVideoRef.current = Boolean(streamUrlRef.current);
      selectionIdRef.current = newVideo.id;
      activeVersionKeyRef.current = null;
      errorRef.current = null;
      latestSourceTypeRef.current = newVideo?.source_type;
      currentVideoRef.current = newVideo;

      upsertCandidatesToPool(candidatePoolRef.current, [newVideo], prevVideo);
      if (prevVideo?.id) {
        sessionWatchedIdsRef.current.add(String(prevVideo.id));
      }
      sessionWatchedIdsRef.current.add(String(newVideo.id));

      const nextSeed = Date.now();
      rankedSeedRef.current = nextSeed;
      rankedMetaKeyRef.current = getVideoMetaRankKey(newVideo);
      const rankedRelated = rankRelatedVideos(
        newVideo,
        Array.from(candidatePoolRef.current.values()),
        {
          sessionWatchedIds: sessionWatchedIdsRef.current,
          lastVideoId: prevVideo?.id ?? null,
          seed: nextSeed,
          limit: 48,
        }
      );

      setError(null);
      setStoryboard(null);
      setDetectedRatio(null);
      setActiveVersionKey(null);
      setIsSwitchingVersion(false);
      setIsSwitchingVideo(Boolean(streamUrlRef.current));
      setSelection({
        id: newVideo.id,
        startTime: Number(resumeTime) || 0,
        forcePlaylistPlayback: Boolean(nextPlaylist && updateHistory),
      });
      setVideo(newVideo);
      setRelatedVideos(rankedRelated);
      setStreamAttemptSeq((s) => s + 1);
    },
    [silenceAndPauseCurrentVideo, clearPlaylist, updatePlaylist]
  );

  const selectPlaylistVideo = useCallback((index, nextShuffleOrder) => {
    const state = playlistStateRef.current;
    const next = state?.items[index];
    if (!next) return;
    if (index === state.currentIndex) {
      const player = videoRef.current;
      if (player) {
        player.currentTime = 0;
        player.play().catch(() => { });
      }
      return;
    }
    handleSelectVideo(next, 0, { preservePlaylist: true, nextPlaylistIndex: index, nextShuffleOrder });
  }, [handleSelectVideo]);

  const playNextInPlaylist = useCallback(() => {
    const next = getPlaylistStep(playlistStateRef.current, 1);
    if (next) selectPlaylistVideo(next.index, next.shuffleOrder);
  }, [selectPlaylistVideo]);

  const playPrevInPlaylist = useCallback(() => {
    const previous = getPlaylistStep(playlistStateRef.current, -1);
    if (previous) selectPlaylistVideo(previous.index);
  }, [selectPlaylistVideo]);

  const togglePlaylistShuffle = useCallback(() => {
    const state = playlistStateRef.current;
    if (!state?.items.length) return;
    const isShuffled = !state.isShuffled;
    const next = updatePlaylist({
      ...state,
      isShuffled,
      shuffleOrder: isShuffled ? shufflePlaylist(state.items.length, state.currentIndex) : [],
      nextShuffleOrder: null,
    });
    replacePlaylistInUrl(next);
  }, [updatePlaylist]);

  const cyclePlaylistLoop = useCallback(() => {
    const state = playlistStateRef.current;
    if (!state?.items.length) return;
    const loopMode = state.loopMode === 'none' ? 'all' : state.loopMode === 'all' ? 'one' : 'none';
    updatePlaylist({ ...state, loopMode });
  }, [updatePlaylist]);

  const restorePlaylistWatchLocation = useCallback(() => {
    const url = new URL(window.location.href);
    if (!url.pathname.startsWith('/watch/')) return true;
    const listKey = normalizePlaylistKey(url.searchParams.get('list'));
    const state = playlistStateRef.current;
    if ((!listKey && !state) || url.searchParams.has('v')) return false;
    const id = decodeVideoSlug(url.pathname.split('/').at(-1));
    const index = state?.listKey === listKey
      ? state.items.findIndex((item) => Number(item.id) === id)
      : -1;
    const item = index >= 0 ? state.items[index] : candidatePoolRef.current.get(String(id));
    if (!item && String(id) !== String(selectionIdRef.current)) return false;
    if (item) {
      handleSelectVideo(item, 0, { preservePlaylist: Boolean(listKey), nextPlaylistIndex: index, updateHistory: false });
    }
    void loadPlaylist();
    return true;
  }, [handleSelectVideo, loadPlaylist]);

  const handlePrimeVideo = useCallback(
    (newVideo, { startTime = 0, versionKey = null, inPlace = false, replace = false, inMiniplayer = false } = {}) => {
      const nextId =
        newVideo?.id && newVideo.id !== 'undefined'
          ? newVideo.id
          : newVideo?.video_id && newVideo.video_id !== 'undefined'
            ? newVideo.video_id
            : null;
      if (!nextId) return;

      // YouTube-style: while Miniplayer is open, clicking another video plays it right inside Miniplayer
      // without expanding back to /watch unless the user explicitly expands!
      if (inMiniplayer || isMiniplayerRef.current) {
        handleSelectVideo({ ...newVideo, id: nextId }, startTime, { updateHistory: false });
        return;
      }

      if (inPlace) {
        handleSelectVideo(newVideo, startTime, { replace });
        return;
      }

      const normalizedVersion = versionKey ? String(versionKey) : null;
      const nextStart = Number(startTime) || 0;
      primedInfoRef.current = {
        id: String(nextId),
        versionKey: normalizedVersion,
        at: Date.now(),
      };

      const nextConfig = readStoredPlayerConfig();
      if (nextConfig) {
        playerConfigRef.current = nextConfig;
        setPlayerConfig(nextConfig);
      }

      // Resume instantaneously if exact same video & version are already loaded cleanly
      if (
        String(selectionIdRef.current) === String(nextId) &&
        (activeVersionKeyRef.current || null) === normalizedVersion &&
        streamUrlRef.current &&
        !errorRef.current
      ) {
        const v = videoRef.current;
        if (v && (v.ended || Math.abs((v.currentTime || 0) - nextStart) > 2)) {
          try { v.currentTime = nextStart; } catch (_) { }
        }
        setSelection({ id: nextId, startTime: nextStart });
        setVideo((prev) => ({ ...(prev || {}), ...newVideo, id: nextId }));
        isSwitchingVideoRef.current = false;
        setIsSwitchingVideo(false);
        return;
      }

      silenceAndPauseCurrentVideo();

      const hasPreviousStream = Boolean(streamUrlRef.current);
      isSwitchingVideoRef.current = hasPreviousStream;
      selectionIdRef.current = nextId;
      activeVersionKeyRef.current = normalizedVersion;
      errorRef.current = null;
      latestSourceTypeRef.current = newVideo?.source_type;
      currentVideoRef.current = { ...newVideo, id: nextId };

      setError(null);
      setStoryboard(null);
      setDetectedRatio(null);
      setIsSwitchingVersion(false);
      setIsSwitchingVideo(hasPreviousStream);
      setActiveVersionKey(normalizedVersion);
      setSelection({ id: nextId, startTime: nextStart });
      setVideo({ ...newVideo, id: nextId });
      setStreamAttemptSeq((s) => s + 1);
    },
    [handleSelectVideo, silenceAndPauseCurrentVideo]
  );

  useEffect(() => {
    primeListeners.add(handlePrimeVideo);
    return () => {
      primeListeners.delete(handlePrimeVideo);
    };
  }, [handlePrimeVideo]);

  // Global capture-phase interceptor while Miniplayer is active:
  // clicking ANY <a href="/watch/..."> link (History, Search Results, Playlists, Videos, etc.)
  // switches the video directly inside Miniplayer instead of navigating away to full /watch!
  useEffect(() => {
    if (!isMiniplayer || typeof document === 'undefined') return;
    const handleMiniWatchLinkClick = (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = e.target?.closest?.('a[href]');
      if (!link || link.target === '_blank' || link.closest('#movie_player_mini_dock')) return;
      // VideoCard handles its own click with full video metadata for 0ms title/channel swap
      if (link.hasAttribute('data-mini-handled')) return;

      let url;
      try {
        url = new URL(link.href, window.location.origin);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin || !url.pathname.startsWith('/watch/')) return;

      const slug = url.pathname.slice('/watch/'.length).split('/')[0];
      const decodedId = decodeVideoSlug(slug);
      if (!decodedId) return;

      e.preventDefault();
      e.stopPropagation();

      const resumeSec = Number(url.searchParams.get('t')) || 0;
      const cached = candidatePoolRef.current.get(String(decodedId));
      handleSelectVideo(cached || { id: decodedId }, resumeSec, { updateHistory: false });
    };

    document.addEventListener('click', handleMiniWatchLinkClick, true);
    return () => document.removeEventListener('click', handleMiniWatchLinkClick, true);
  }, [isMiniplayer, handleSelectVideo]);

  const hydrateWatchPage = useCallback(
    ({
      initialVideo,
      initialRelated = [],
      initialTime = 0,
      initialShowAdultPosters = false,
      initialSource = null,
      requestedVersion = null,
    }) => {
      if (!initialVideo?.id) return;

      // Ignore stale initialVideo effect re-runs if user switched video in-place via EndScreen (pushState)
      if (
        lastHydratedInitialVideoRef.current === initialVideo &&
        !primedInfoRef.current &&
        selectionIdRef.current !== null &&
        String(selectionIdRef.current) !== String(initialVideo.id)
      ) {
        return;
      }
      lastHydratedInitialVideoRef.current = initialVideo;

      const nextConfig = readStoredPlayerConfig();
      if (nextConfig) {
        playerConfigRef.current = nextConfig;
        setPlayerConfig(nextConfig);
      }

      setSsrShowAdultPosters(Boolean(initialShowAdultPosters));
      loadedDetailIdRef.current = initialVideo.id;

      upsertCandidatesToPool(candidatePoolRef.current, initialRelated, initialVideo);
      sessionWatchedIdsRef.current.add(String(initialVideo.id));
      rankedSeedRef.current = 0;
      rankedMetaKeyRef.current = getVideoMetaRankKey(initialVideo);
      const rankedRelated = rankRelatedVideos(
        initialVideo,
        Array.from(candidatePoolRef.current.values()),
        {
          sessionWatchedIds: sessionWatchedIdsRef.current,
          seed: 0,
          limit: 48,
        }
      );
      setRelatedVideos(rankedRelated);

      const targetVersionKey = requestedVersion ? String(requestedVersion) : null;
      const isSameActiveVideo =
        selectionIdRef.current !== null &&
        String(selectionIdRef.current) === String(initialVideo.id) &&
        (activeVersionKeyRef.current || null) === targetVersionKey &&
        !errorRef.current;

      if (isSameActiveVideo) {
        // Merge full SSR metadata (description, versions, subtitles) without restarting active stream
        setVideo((prev) => {
          if (!prev || String(prev.id) !== String(initialVideo.id)) {
            return initialVideo;
          }
          return {
            ...prev,
            ...initialVideo,
            versions:
              Array.isArray(initialVideo.versions) && initialVideo.versions.length > 0
                ? initialVideo.versions
                : prev.versions,
            active_version: initialVideo.active_version ?? prev.active_version ?? null,
          };
        });
        return;
      }

      initialSourceRef.current = initialSource;
      initialVideoIdRef.current = initialVideo.id;
      initialVersionKeyRef.current = targetVersionKey;
      primedInfoRef.current = null;

      const hasPreviousStream = Boolean(streamUrlRef.current);
      if (hasPreviousStream) {
        silenceAndPauseCurrentVideo();
      }
      isSwitchingVideoRef.current = hasPreviousStream;
      selectionIdRef.current = initialVideo.id;
      activeVersionKeyRef.current = targetVersionKey;
      errorRef.current = null;
      latestSourceTypeRef.current = initialVideo.source_type;

      setError(null);
      setStoryboard(null);
      setDetectedRatio(null);
      setIsSwitchingVersion(false);
      setIsSwitchingVideo(hasPreviousStream);
      setActiveVersionKey(targetVersionKey);
      setSelection({ id: initialVideo.id, startTime: Number(initialTime) || 0 });
      setVideo(initialVideo);
      setStreamAttemptSeq((s) => s + 1);
    },
    [silenceAndPauseCurrentVideo]
  );

  const id = selection.id;
  const startTime = selection.startTime;

  const rawVersions = video?.versions;
  const fallbackActiveVersion = video?.active_version;

  const playableVersions = useMemo(() => {
    const raw = Array.isArray(rawVersions) ? rawVersions : [];
    return raw.filter(
      (v) => !v?.status || ['READY', 'COMPLETED'].includes(String(v.status).toUpperCase())
    );
  }, [rawVersions]);

  const activeVersion = useMemo(() => {
    if (playableVersions.length > 0) {
      if (activeVersionKey) {
        const matched = playableVersions.find(
          (v) => v.versionKey === activeVersionKey || String(v.id) === String(activeVersionKey)
        );
        if (matched) return matched;
      }
      if (fallbackActiveVersion) {
        const matched = playableVersions.find(
          (v) =>
            v.id === fallbackActiveVersion.id || v.versionKey === fallbackActiveVersion.versionKey
        );
        if (matched) return matched;
      }
      return playableVersions.find((v) => v.isDefault) || playableVersions[0];
    }
    return fallbackActiveVersion || null;
  }, [playableVersions, activeVersionKey, fallbackActiveVersion]);

  const isMusic = isMusicVideo(video);
  const matureVideo = isMatureVideo(video);
  const showAdultPoster = usePosterPreference(matureVideo, ssrShowAdultPosters);
  const { poster: revealedPoster } = usePosterReveal(
    matureVideo ? video?.id : null,
    !showAdultPoster
  );
  const watchPoster = video
    ? matureVideo
      ? showAdultPoster
        ? `/api/videos/${video.id}/poster${activeVersionKey ? `?v=${encodeURIComponent(activeVersionKey)}` : ''}`
        : revealedPoster?.url || RESTRICTED_POSTER
      : activeVersion?.thumbnailUrl ||
      video?.thumbnail_url ||
      (video?.id ? `/streams/stream_vid_${video.id}/poster.jpg` : null)
    : null;

  const videoResolution = activeVersion?.resolution || video?.resolution;
  const videoWidth = video?.width;
  const videoHeight = video?.height;

  const videoRatio = useMemo(() => {
    if (detectedRatio && detectedRatio > 0) return detectedRatio;
    if (typeof videoResolution === 'string' && videoResolution.includes('x')) {
      const parts = videoResolution.split('x');
      const w = parseFloat(parts[0]);
      const h = parseFloat(parts[1]);
      if (w > 0 && h > 0) return w / h;
    } else if (videoWidth && videoHeight) {
      return videoWidth / videoHeight;
    }
    if (video?.category === 'shorts') return 9 / 16;
    return 16 / 9;
  }, [detectedRatio, videoResolution, videoWidth, videoHeight, video?.category]);

  // Version Switcher (keeps #movie_player & Fullscreen intact + preserves current timestamp)
  const handleSelectVersion = useCallback(
    (targetVersion) => {
      if (!targetVersion) return;
      const targetKey = targetVersion.versionKey || String(targetVersion.id);
      const currentKey =
        activeVersion?.versionKey || (activeVersion?.id ? String(activeVersion.id) : null);
      if (
        targetKey === currentKey ||
        (targetVersion.id && targetVersion.id === activeVersion?.id)
      ) {
        return;
      }

      const currentPos = Number.isFinite(videoRef.current?.currentTime)
        ? videoRef.current.currentTime
        : 0;

      silenceAndPauseCurrentVideo();

      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        if (targetVersion.isDefault) {
          url.searchParams.delete('v');
        } else {
          url.searchParams.set('v', targetKey);
        }
        window.history.replaceState(null, '', url.pathname + (url.search ? url.search : ''));
      }

      primedInfoRef.current = null;
      activeVersionKeyRef.current = targetKey;
      errorRef.current = null;

      setError(null);
      setDetectedRatio(null);
      setIsSwitchingVersion(true);
      setSelection((previous) => ({ ...previous, id, startTime: currentPos }));
      setActiveVersionKey(targetKey);
      setStreamAttemptSeq((s) => s + 1);

      if (id && targetVersion.id) {
        fetch('/api/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoId: id,
            versionId: targetVersion.id,
            position: Math.floor(currentPos),
          }),
        }).catch(() => { });
      }
    },
    [id, activeVersion, silenceAndPauseCurrentVideo]
  );

  // Stream resolution effect (runs immediately on click-prime OR direct SSR hydration!)
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let hydrationTimer = null;
    const storyboardRequest = new AbortController();
    // Selection refs change immediately, before React cleans up the old effect.
    const isStale = () => cancelled || String(selectionIdRef.current) !== String(id)
      || activeVersionKeyRef.current !== activeVersionKey;

    async function initStream() {
      try {
        setError(null);
        setStoryboard(null);

        if (latestSourceTypeRef.current !== 'mp4') {
          preloadHlsModule().catch(() => { });
        }

        const maybeReRankWithEnrichedVideo = (mergedVideo) => {
          if (!mergedVideo?.id) return;
          upsertCandidatesToPool(candidatePoolRef.current, null, mergedVideo);
          const nextKey = getVideoMetaRankKey(mergedVideo);
          if (
            nextKey !== rankedMetaKeyRef.current &&
            candidatePoolRef.current.size > 0 &&
            (mergedVideo.tags || mergedVideo.category || mergedVideo.content_rating)
          ) {
            rankedMetaKeyRef.current = nextKey;
            setRelatedVideos(
              rankRelatedVideos(mergedVideo, Array.from(candidatePoolRef.current.values()), {
                sessionWatchedIds: sessionWatchedIdsRef.current,
                seed: rankedSeedRef.current,
                limit: 48,
              })
            );
          }
        };

        // Only fetch detail metadata in background for in-place switches (not awaiting it on TTFF path!)
        const isPrimedForId = primedInfoRef.current?.id === String(id);
        const needsMetadataDetail = loadedDetailIdRef.current !== id && !isPrimedForId;
        const versionQuery = activeVersionKey ? `?v=${encodeURIComponent(activeVersionKey)}` : '';
        if (needsMetadataDetail) {
          fetch(`/api/videos/${id}${versionQuery}`, { cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : null))
            .then((detailRes) => {
              if (isStale() || !detailRes?.video) return;
              loadedDetailIdRef.current = id;
              const dv = detailRes.video;
              const mergedForRank = { ...(currentVideoRef.current || {}), ...dv };
              maybeReRankWithEnrichedVideo(mergedForRank);
              setVideo((prev) => ({
                ...prev,
                ...dv,
                versions: dv.versions ?? prev?.versions ?? [],
                active_version: dv.active_version ?? prev?.active_version ?? null,
                subtitle_srt: dv.subtitle_srt ?? prev?.subtitle_srt ?? '',
                subtitle_vtt: dv.subtitle_vtt ?? prev?.subtitle_vtt ?? '',
                subtitle_tracks: dv.subtitle_tracks ?? prev?.subtitle_tracks ?? [],
                subtitle_status: dv.subtitle_status || prev?.subtitle_status || 'waiting',
                author_name: dv.author_name || prev?.author_name,
                author_picture: dv.author_picture || prev?.author_picture,
              }));
            })
            .catch(() => { });
        }

        const canUseSsrSource =
          initialSourceRef.current &&
          String(id) === String(initialVideoIdRef.current) &&
          (activeVersionKey || null) === (initialVersionKeyRef.current || null);
        const ssrSource = canUseSsrSource ? initialSourceRef.current : null;
        if (canUseSsrSource) {
          initialSourceRef.current = null;
        }

        let sourceData = await (ssrSource
          ? Promise.resolve(ssrSource)
          : fetchVideoSourceClient(id, {
            showAdultPreviews: showAdultPoster,
            version: activeVersionKey,
          }));
        if (isStale()) return;

        const needsRestrictedStoryboard =
          !showAdultPoster && sourceData.type === 'hls' && isMatureVideo(sourceData.video);
        if (needsRestrictedStoryboard) {
          fetch(`/api/videos/${id}/storyboard${versionQuery}`, {
            method: 'POST',
            signal: storyboardRequest.signal,
          })
            .then((response) => (response.ok ? response.json() : null))
            .then((data) =>
              resolveStoryboard(
                data?.items?.map((item) => ({
                  ...item,
                  downloadUrl: new URL(item.downloadUrl, window.location.origin).href,
                }))
              )
            )
            .then((preview) => {
              if (!isStale() && preview) setStoryboard(preview);
            })
            .catch(() => { });
        }

        if (sourceData.video) {
          const sv = sourceData.video;
          const mergedForRank = { ...(currentVideoRef.current || {}), ...sv };
          maybeReRankWithEnrichedVideo(mergedForRank);
          setVideo((prev) => ({
            ...prev,
            ...sv,
            versions:
              Array.isArray(sv.versions) && sv.versions.length > 0
                ? sv.versions
                : prev?.versions ?? [],
            active_version: sv.active_version ?? prev?.active_version ?? null,
            subtitle_srt: sv.subtitle_srt ?? prev?.subtitle_srt ?? '',
            subtitle_vtt: sv.subtitle_vtt ?? prev?.subtitle_vtt ?? '',
            subtitle_tracks: sv.subtitle_tracks ?? prev?.subtitle_tracks ?? [],
            subtitle_status: sv.subtitle_status || prev?.subtitle_status || 'waiting',
            author_name: sv.author_name || prev?.author_name,
            author_picture: sv.author_picture || prev?.author_picture,
          }));
        }

        let resolved;
        try {
          resolved = await resolveClientPlaybackSource(sourceData);
        } catch (resolveErr) {
          if (isStale()) return;
          console.warn(
            '[GlobalPlayer] Token expired or fetch failed, auto-recovering with fresh tokens...',
            resolveErr
          );
          sourceData = await fetchVideoSourceClient(id, {
            forceFresh: true,
            showAdultPreviews: showAdultPoster,
            version: activeVersionKey,
          });
          resolved = await resolveClientPlaybackSource(sourceData);
        }

        if (isStale()) {
          for (const url of resolved.blobUrls ?? []) URL.revokeObjectURL(url);
          return;
        }

        const prevBlobUrls = activeBlobUrlsRef.current;
        activeBlobUrlsRef.current = resolved.blobUrls ?? [];
        partialSegmentMapRef.current = resolved.segmentUrlMap
          ? { ...resolved.segmentUrlMap }
          : {};

        streamUrlRef.current = resolved.url;
        isSwitchingVideoRef.current = false;
        setStreamUrl(resolved.url);
        setIsSwitchingVideo(false);
        setIsSwitchingVersion(false);

        for (const u of prevBlobUrls) {
          try { URL.revokeObjectURL(u); } catch (_) { }
        }
        if (resolved.aspectRatio) {
          setDetectedRatio(resolved.aspectRatio);
        }
        setDetectedAudio(
          resolved.audioChannels != null || resolved.audioLayout || resolved.hiResAudio
            ? {
                channels: resolved.audioChannels ?? null,
                layout: resolved.audioLayout ?? null,
                hiRes: resolved.hiResAudio ?? null,
              }
            : null
        );

        // Two-Phase Cold-Batch Hydration (~2.2s later upgrade _002+.ts to direct CF Worker URLs & direct Hi-Res URL)
        if (resolved.partial) {
          hydrationTimer = setTimeout(() => {
            if (isStale()) return;
            fetchVideoSourceClient(id, {
              preferFull: true,
              lowPriority: true,
              showAdultPreviews: showAdultPoster,
              version: activeVersionKey,
            })
              .then((fullSource) => {
                if (isStale() || !Array.isArray(fullSource?.items)) return;
                const map = partialSegmentMapRef.current || {};
                let hydratedHiResItem = null;
                for (const item of fullSource.items) {
                  const lowerName = item?.name ? item.name.toLowerCase() : '';
                  if (
                    item?.name &&
                    item.downloadUrl &&
                    (lowerName === 'audio_hires.wav' || lowerName === 'audio_hires.flac')
                  ) {
                    hydratedHiResItem = item;
                  }
                  if (
                    item?.name &&
                    item.downloadUrl &&
                    (lowerName.endsWith('.ts') || lowerName.endsWith('.m4s') || lowerName.endsWith('.mp4'))
                  ) {
                    const cleanName = item.name.replace(/^\.?\//, '');
                    const baseName = cleanName.includes('/')
                      ? cleanName.slice(cleanName.lastIndexOf('/') + 1)
                      : cleanName;
                    map[item.name] = item.downloadUrl;
                    map[cleanName] = item.downloadUrl;
                    map[baseName] = item.downloadUrl;
                    map[baseName.toLowerCase()] = item.downloadUrl;
                  }
                }
                partialSegmentMapRef.current = map;
                if (hydratedHiResItem) {
                  setDetectedAudio((prev) => {
                    const base = prev || { channels: null, layout: null, hiRes: null };
                    if (base.hiRes) {
                      return { ...base, hiRes: { ...base.hiRes, url: hydratedHiResItem.downloadUrl } };
                    }
                    const file = hydratedHiResItem.name.replace(/^\.?\//, '');
                    return {
                      ...base,
                      hiRes: {
                        url: hydratedHiResItem.downloadUrl,
                        file,
                        format: file.toLowerCase().endsWith('.flac') ? 'flac' : 'wav',
                        bits: 24,
                        sampleRate: 48000,
                        channels: base.channels || 2,
                        layout: base.layout || 'stereo',
                        bytes: 0,
                      },
                    };
                  });
                }
                if (!needsRestrictedStoryboard) {
                  resolveStoryboard(fullSource.items)
                    .then((sb) => {
                      if (!isStale() && sb) setStoryboard(sb);
                    })
                    .catch(() => { });
                }
              })
              .catch(() => { });
          }, 2200);
        }

        if (needsRestrictedStoryboard) return;
        if (resolved.storyboard) {
          setStoryboard(resolved.storyboard);
        } else if (resolved.storyboardPromise) {
          resolved.storyboardPromise
            .then((sb) => {
              if (!isStale() && sb) {
                setStoryboard(sb);
              }
            })
            .catch(() => { });
        } else {
          setStoryboard(null);
        }
      } catch (err) {
        console.error('[GlobalPlayer Error]:', err);
        if (!isStale()) {
          for (const url of activeBlobUrlsRef.current) URL.revokeObjectURL(url);
          activeBlobUrlsRef.current = [];
          isSwitchingVideoRef.current = false;
          setIsSwitchingVideo(false);
          setIsSwitchingVersion(false);
          streamUrlRef.current = '';
          setStreamUrl('');
          errorRef.current = err.message || 'เกิดข้อผิดพลาดในการโหลดวิดีโอ';
          setError(errorRef.current);
        }
      }
    }

    initStream();

    return () => {
      cancelled = true;
      if (hydrationTimer) clearTimeout(hydrationTimer);
      storyboardRequest.abort();
    };
  }, [id, activeVersionKey, showAdultPoster, streamAttemptSeq]);

  const handleSeek = useCallback((timeInSeconds) => {
    if (videoRef.current) {
      videoRef.current.currentTime = timeInSeconds;
      videoRef.current.play().catch(() => { });
    }
  }, []);

  const handleBack = useCallback(() => {
    router.push('/');
  }, [router]);

  const handleRatioChange = useCallback((r) => {
    setDetectedRatio(r);
  }, []);

  const videoSlugValue =
    video?.slug ||
    encodeVideoSlug(video?.id, video?.category) ||
    (video?.id && video?.id !== 'undefined' ? String(video?.id) : '');

  const playlistNextStep = getPlaylistStep(playlistState, 1);
  const playlistPrevStep = getPlaylistStep(playlistState, -1);
  const playlistNextVideo = playlistNextStep ? playlistState.items[playlistNextStep.index] : null;
  const playlistPrevVideo = playlistPrevStep ? playlistState.items[playlistPrevStep.index] : null;

  const contextValue = useMemo(
    () => ({
      video,
      activeVersionKey,
      activeVersion,
      playableVersions,
      isSwitchingVersion,
      isSwitchingVideo,
      relatedVideos,
      setRelatedVideos,
      streamUrl,
      storyboard,
      error,
      videoRatio,
      isDockedInWatch,
      isMiniplayer,
      enterMiniplayer,
      expandMiniplayer,
      closeMiniplayer,
      ambientMode,
      setAmbientMode: handleSetAmbientMode,
      videoRef,
      handleSeek,
      handleBack,
      handleRatioChange,
      handleSelectVideo,
      handleSelectVersion,
      playlistState,
      playlistNextVideo,
      loadPlaylist,
      clearPlaylist,
      restorePlaylistWatchLocation,
      selectPlaylistVideo,
      togglePlaylistShuffle,
      cyclePlaylistLoop,
      playNextInPlaylist,
      playPrevInPlaylist,
      dockPlayerSlot,
      undockPlayerSlot,
      hydrateWatchPage,
      DESKTOP_PLAYER_MAX_HEIGHT,
    }),
    [
      video,
      activeVersionKey,
      activeVersion,
      playableVersions,
      isSwitchingVersion,
      isSwitchingVideo,
      relatedVideos,
      streamUrl,
      storyboard,
      error,
      videoRatio,
      isDockedInWatch,
      isMiniplayer,
      enterMiniplayer,
      expandMiniplayer,
      closeMiniplayer,
      ambientMode,
      handleSetAmbientMode,
      handleSeek,
      handleBack,
      handleRatioChange,
      handleSelectVideo,
      handleSelectVersion,
      playlistState,
      playlistNextVideo,
      loadPlaylist,
      clearPlaylist,
      restorePlaylistWatchLocation,
      selectPlaylistVideo,
      togglePlaylistShuffle,
      cyclePlaylistLoop,
      playNextInPlaylist,
      playPrevInPlaylist,
      dockPlayerSlot,
      undockPlayerSlot,
      hydrateWatchPage,
    ]
  );

  const reparentToMiniSlot = useCallback((slotEl, el) => {
    reparentPlayerHost(slotEl, el, videoRef.current);
  }, []);

  const consumeMiniLaunchRect = useCallback(() => {
    const val = miniLaunchRectRef.current;
    miniLaunchRectRef.current = null;
    return val;
  }, []);

  return (
    <GlobalPlayerContext.Provider value={contextValue}>
      {children}

      {/* Offscreen parking container for singleton #movie_player when not on /watch */}
      <div
        ref={parkingRef}
        id="movie_player_parking"
        className="fixed -left-[9999px] -top-[9999px] w-px h-px overflow-hidden opacity-0 pointer-events-none"
        aria-hidden="true"
      />

      {/* Floating Miniplayer Dock (Desktop 4-Corner Draggable + Mobile Floating PiP Card) */}
      <FloatingMiniplayerShell
        isOpen={isMiniplayer}
        hostEl={hostEl}
        reparentHost={reparentToMiniSlot}
        videoRef={videoRef}
        aspectRatio={videoRatio}
        consumeLaunchRect={consumeMiniLaunchRect}
        title={video?.title || ''}
        channelName={video?.author_name || 'DONUŤ'}
        onExpand={expandMiniplayer}
        onClose={closeMiniplayer}
      />

      {/* Persistent Singleton #movie_player Portal (AmbientLight + VideoPlayer always mounted once) */}
      {hostEl
        ? createPortal(
          <>
            <AmbientLight
              videoRef={videoRef}
              storyboard={matureVideo && !showAdultPoster ? null : storyboard}
              poster={watchPoster}
              enabled={ambientMode && isDockedInWatch && !isMiniplayer}
              preferStoryboardOnly={isPlayingHdr}
              aspectRatio={videoRatio}
              className="max-md:mix-blend-multiply dark:max-md:mix-blend-screen"
            />

            <div className="relative z-10 w-full h-full">
              <VideoPlayer
                isActive={isDockedInWatch || isMiniplayer}
                isMiniplayer={isMiniplayer}
                onToggleMiniplayer={isMiniplayer ? expandMiniplayer : enterMiniplayer}
                onCloseMiniplayer={closeMiniplayer}
                src={streamUrl}
                partialSegmentMapRef={partialSegmentMapRef}
                poster={watchPoster}
                storyboard={storyboard}
                keepScrubPreviewOnLoad={matureVideo && !showAdultPoster}
                channelName={video?.author_name || 'DONUŤ'}
                title={video?.title || ''}
                onBack={handleBack}
                resolution={activeVersion?.resolution || video?.resolution}
                width={video?.width}
                height={video?.height}
                aspectRatio={videoRatio}
                fps={activeVersion?.fps || video?.fps}
                codec={activeVersion?.codec || video?.codec}
                audioChannels={detectedAudio?.channels ?? activeVersion?.audio_channels ?? video?.audio_channels ?? null}
                audioLayout={detectedAudio?.layout ?? null}
                hiResAudio={detectedAudio?.hiRes ?? null}
                videoId={video?.id}
                videoSlug={videoSlugValue}
                videoCategory={video?.category}
                videoRef={videoRef}
                desktopMaxHeight={DESKTOP_PLAYER_MAX_HEIGHT}
                defaultVolume={playerConfig?.volume ?? 0.8}
                defaultAutoplay={playerConfig?.autoplay ?? true}
                defaultSpeed={playerConfig?.default_speed ?? 1}
                defaultFit={playerConfig?.default_fit ?? 'fit'}
                seekStep={playerConfig?.seek_step ?? 10}
                autoStats={playerConfig?.auto_stats ?? false}
                initialTime={startTime}
                isMusic={isMusic}
                onRatioChange={handleRatioChange}
                onHdrStateChange={setIsPlayingHdr}
                ambientMode={ambientMode}
                setAmbientMode={handleSetAmbientMode}
                currentVideo={video}
                relatedVideos={relatedVideos}
                playlistActive={Boolean(playlistState)}
                playlistNextVideo={playlistNextVideo}
                playlistPrevVideo={playlistPrevVideo}
                playlistLoopMode={playlistState?.loopMode ?? 'none'}
                onPlayNext={playlistNextVideo ? playNextInPlaylist : null}
                onPlayPrev={playlistPrevVideo ? playPrevInPlaylist : null}
                forcePlaylistPlayback={Boolean(selection.forcePlaylistPlayback)}
                onSelectVideo={handleSelectVideo}
                isSwitchingVideo={isSwitchingVideo || !streamUrl}
                versions={playableVersions}
                activeVersion={activeVersion}
                onSelectVersion={handleSelectVersion}
                isSwitchingVersion={isSwitchingVersion}
              />
            </div>
          </>,
          hostEl
        )
        : null}
    </GlobalPlayerContext.Provider>
  );
}

export function useGlobalPlayer() {
  return useContext(GlobalPlayerContext);
}
