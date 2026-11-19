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
import { usePosterReveal } from '@/lib/usePosterReveal';
import { usePosterPreference } from '@/lib/usePosterPreference';
import {
  resolveClientPlaybackSource,
  fetchVideoSourceClient,
  resolveStoryboard,
  preloadHlsModule,
} from '@/lib/playbackResolver';
import {
  encodeVideoSlug,
  isMatureVideo,
  isMusicVideo,
  RESTRICTED_POSTER,
} from '@/lib/videoUtils';

export const DESKTOP_HEADER_OFFSET_PX = 105;
export const DESKTOP_PLAYER_MAX_HEIGHT = `calc(100vh - ${DESKTOP_HEADER_OFFSET_PX}px)`;

const GlobalPlayerContext = createContext(null);

const subscribeNoop = () => () => {};
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
      el.className = 'relative w-full';
      singletonPlayerHostEl = el;
    }
  }
  return singletonPlayerHostEl;
}

const primeListeners = new Set();

function reparentPlayerHost(targetParent, hostEl) {
  if (!targetParent || !hostEl || hostEl.parentNode === targetParent) return;
  if (typeof targetParent.moveBefore === 'function' && hostEl.isConnected && targetParent.isConnected) {
    try {
      targetParent.moveBefore(hostEl, null);
      return;
    } catch (_) { }
  }
  targetParent.appendChild(hostEl);
}

/**
 * Trigger instant Player-First stream resolution & buffering at click time (t = 0ms)
 * before Next.js App Router finishes navigating / SSR-rendering /watch/[id].
 */
export function primeGlobalWatchVideo(
  videoData,
  { startTime = 0, versionKey = null, inPlace = false, replace = false } = {}
) {
  if (!videoData) return;
  for (const listener of primeListeners) {
    listener(videoData, { startTime, versionKey, inPlace, replace });
  }
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

  const [isDockedInWatch, setIsDockedInWatch] = useState(false);
  const [selection, setSelection] = useState({ id: null, startTime: 0 });
  const [video, setVideo] = useState(null);
  const [activeVersionKey, setActiveVersionKey] = useState(null);
  const [isSwitchingVersion, setIsSwitchingVersion] = useState(false);
  const [isSwitchingVideo, setIsSwitchingVideo] = useState(false);
  const [relatedVideos, setRelatedVideos] = useState([]);
  const [ssrShowAdultPosters, setSsrShowAdultPosters] = useState(false);
  const [streamUrl, setStreamUrl] = useState('');
  const [storyboard, setStoryboard] = useState(null);
  const [error, setError] = useState(null);
  const [detectedRatio, setDetectedRatio] = useState(null);
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

  // Guard: leaving /watch clears click-primed intent and parks + pauses #movie_player
  useEffect(() => {
    if (pathname?.startsWith('/watch')) return;
    primedInfoRef.current = null;
    activeSlotRef.current = null;

    const t = Promise.resolve().then(() => {
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
  }, [pathname, hostEl]);

  const dockPlayerSlot = useCallback(
    (slotEl) => {
      if (!slotEl) return;
      activeSlotRef.current = slotEl;
      setIsDockedInWatch(true);
      reparentPlayerHost(slotEl, hostEl);
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

  const undockPlayerSlot = useCallback(
    (slotEl) => {
      if (!slotEl || activeSlotRef.current !== slotEl) return;
      activeSlotRef.current = null;

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
    (newVideo, resumeTime = 0, { replace = false } = {}) => {
      if (
        !newVideo ||
        !newVideo.id ||
        newVideo.id === 'undefined' ||
        String(newVideo.id) === String(selectionIdRef.current)
      ) {
        return;
      }

      const safeId = newVideo.id && newVideo.id !== 'undefined' ? newVideo.id : '';
      const videoSlug =
        encodeVideoSlug(safeId, newVideo.category) || (safeId ? String(safeId) : '');
      const newUrl = videoSlug ? `/watch/${videoSlug}` : '/';

      if (typeof window !== 'undefined') {
        if (replace) {
          window.history.replaceState(null, '', newUrl);
        } else {
          window.history.pushState(null, '', newUrl);
        }
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

      setError(null);
      setStoryboard(null);
      setDetectedRatio(null);
      setActiveVersionKey(null);
      setIsSwitchingVersion(false);
      setIsSwitchingVideo(Boolean(streamUrlRef.current));
      setSelection({ id: newVideo.id, startTime: Number(resumeTime) || 0 });
      setVideo(newVideo);
      setRelatedVideos((prevList) => {
        const filtered = (Array.isArray(prevList) ? prevList : []).filter(
          (item) => String(item.id) !== String(newVideo.id)
        );
        if (
          prevVideo?.id &&
          String(prevVideo.id) !== String(newVideo.id) &&
          !filtered.some((item) => String(item.id) === String(prevVideo.id))
        ) {
          const {
            description: _d,
            subtitle_srt: _srt,
            subtitle_vtt: _vtt,
            subtitle_tracks: _tracks,
            versions: _vers,
            ...compactPrev
          } = prevVideo;
          return [compactPrev, ...filtered].slice(0, 16);
        }
        return filtered;
      });
      setStreamAttemptSeq((s) => s + 1);
    },
    [silenceAndPauseCurrentVideo]
  );

  const handlePrimeVideo = useCallback(
    (newVideo, { startTime = 0, versionKey = null, inPlace = false, replace = false } = {}) => {
      if (inPlace) {
        handleSelectVideo(newVideo, startTime, { replace });
        return;
      }

      const nextId =
        newVideo?.id && newVideo.id !== 'undefined'
          ? newVideo.id
          : newVideo?.video_id && newVideo.video_id !== 'undefined'
            ? newVideo.video_id
            : null;
      if (!nextId) return;

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
      setRelatedVideos(Array.isArray(initialRelated) ? initialRelated : []);

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
      setSelection({ id, startTime: currentPos });
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
        }).catch(() => {});
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

    async function initStream() {
      try {
        setError(null);
        setStoryboard(null);

        const prevBlobUrls = [...activeBlobUrlsRef.current];
        activeBlobUrlsRef.current = [];

        if (latestSourceTypeRef.current !== 'mp4') {
          preloadHlsModule().catch(() => {});
        }

        // Only fetch detail metadata in background for in-place switches (not awaiting it on TTFF path!)
        const isPrimedForId = primedInfoRef.current?.id === String(id);
        const needsMetadataDetail = loadedDetailIdRef.current !== id && !isPrimedForId;
        const versionQuery = activeVersionKey ? `?v=${encodeURIComponent(activeVersionKey)}` : '';
        if (needsMetadataDetail) {
          fetch(`/api/videos/${id}${versionQuery}`, { cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : null))
            .then((detailRes) => {
              if (cancelled || !detailRes?.video) return;
              loadedDetailIdRef.current = id;
              const dv = detailRes.video;
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
            .catch(() => {});
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
        if (cancelled) return;

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
              if (!cancelled && preview) setStoryboard(preview);
            })
            .catch(() => {});
        }

        if (sourceData.video) {
          const sv = sourceData.video;
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

        if (cancelled) return;

        if (resolved.blobUrls && resolved.blobUrls.length > 0) {
          activeBlobUrlsRef.current = resolved.blobUrls;
        }

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

        // Two-Phase Cold-Batch Hydration (~2.2s later upgrade _002+.ts to direct CF Worker URLs)
        if (resolved.partial) {
          hydrationTimer = setTimeout(() => {
            if (cancelled) return;
            fetchVideoSourceClient(id, {
              preferFull: true,
              lowPriority: true,
              showAdultPreviews: showAdultPoster,
              version: activeVersionKey,
            })
              .then((fullSource) => {
                if (cancelled || !Array.isArray(fullSource?.items)) return;
                const map = partialSegmentMapRef.current || {};
                for (const item of fullSource.items) {
                  if (item?.name && item.downloadUrl && item.name.toLowerCase().endsWith('.ts')) {
                    const cleanName = item.name.replace(/^\.?\//, '');
                    const baseName = cleanName.includes('/')
                      ? cleanName.slice(cleanName.lastIndexOf('/') + 1)
                      : cleanName;
                    map[item.name] = item.downloadUrl;
                    map[cleanName] = item.downloadUrl;
                    map[baseName] = item.downloadUrl;
                  }
                }
                partialSegmentMapRef.current = map;
                if (!needsRestrictedStoryboard) {
                  resolveStoryboard(fullSource.items)
                    .then((sb) => {
                      if (!cancelled && sb) setStoryboard(sb);
                    })
                    .catch(() => {});
                }
              })
              .catch(() => {});
          }, 2200);
        }

        if (needsRestrictedStoryboard) return;
        if (resolved.storyboard) {
          setStoryboard(resolved.storyboard);
        } else if (resolved.storyboardPromise) {
          resolved.storyboardPromise
            .then((sb) => {
              if (!cancelled && sb) {
                setStoryboard(sb);
              }
            })
            .catch(() => {});
        } else {
          setStoryboard(null);
        }
      } catch (err) {
        console.error('[GlobalPlayer Error]:', err);
        if (!cancelled) {
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
      videoRef.current.play().catch(() => {});
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
      ambientMode,
      setAmbientMode: handleSetAmbientMode,
      videoRef,
      handleSeek,
      handleBack,
      handleRatioChange,
      handleSelectVideo,
      handleSelectVersion,
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
      ambientMode,
      handleSetAmbientMode,
      handleSeek,
      handleBack,
      handleRatioChange,
      handleSelectVideo,
      handleSelectVersion,
      dockPlayerSlot,
      undockPlayerSlot,
      hydrateWatchPage,
    ]
  );

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

      {/* Persistent Singleton #movie_player Portal (AmbientLight + VideoPlayer always mounted once) */}
      {hostEl
        ? createPortal(
            <>
              <AmbientLight
                videoRef={videoRef}
                storyboard={matureVideo && !showAdultPoster ? null : storyboard}
                poster={watchPoster}
                enabled={ambientMode && isDockedInWatch}
                aspectRatio={videoRatio}
                className="hidden sm:block"
              />

              <div className="relative z-10 w-full">
                <VideoPlayer
                  isActive={isDockedInWatch}
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
                  ambientMode={ambientMode}
                  setAmbientMode={handleSetAmbientMode}
                  currentVideo={video}
                  relatedVideos={relatedVideos}
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
