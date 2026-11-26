'use client';

import BrowserMediaImage from '@/components/BrowserMediaImage';
import { useState, useRef, useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Play, Pause, Volume2, VolumeX, X, SkipBack, SkipForward } from 'lucide-react';
import { formatResolutionBadge, formatQualityLevel, watchTimeThreshold } from '@/lib/videoUtils';
import { getHlsVideoRange, getSavedQualityLevel, getSdrFallbackLevel, isHdrLevel, supportsHdrDisplay } from '@/lib/playerQuality.mjs';
import { preloadHlsModule } from '@/lib/playbackResolver';
import { useSession } from '@/context/SessionContext';
import {
  formatTime,
  formatTimePair,
  parseSubtitleCues,
  findActiveSubtitleCue,
  DEFAULT_SUBTITLE_STYLE,
  computeSubtitleStyles,
  computeSubtitleBoxLayout,
  normalizeDisplayCueText,
  buildMediaSessionArtwork,
  normalizeMediaSessionTitle,
} from './player/playerUtils';
import PlayerTopBar from './player/PlayerTopBar';
import PlayerCenterControls from './player/PlayerCenterControls';
import PlayerBottomBar from './player/PlayerBottomBar';
import AmbientLight from './player/AmbientLight';

const PlayerSettingsModal = dynamic(() => import('./player/PlayerSettingsModal'), { ssr: false });
const PlayerStatsModal = dynamic(() => import('./player/PlayerStatsModal'), { ssr: false });
const PlayerContextMenu = dynamic(() => import('./player/PlayerContextMenu'), { ssr: false });
const PlayerEndScreen = dynamic(() => import('./player/PlayerEndScreen'), { ssr: false });

const SUB_SETTINGS_CACHE_TTL_MS = 5 * 60 * 1000;
const subSettingsCache = { data: null, at: 0 };

function updateSubSettingsCache(data) {
  subSettingsCache.data = data;
  subSettingsCache.at = Date.now();
}

function unlockBrowserOrientation() {
  if (!window.matchMedia('(display-mode: standalone)').matches) {
    window.screen.orientation?.unlock?.();
  }
}

export default function VideoPlayer({
  isActive = true,
  isMiniplayer = false,
  onToggleMiniplayer = null,
  onCloseMiniplayer = null,
  onRefreshStream = null,
  togglePlayRef = null,
  src,
  poster,
  storyboard = null,
  keepScrubPreviewOnLoad = false,
  title = '',
  channelName = 'TubeLock',
  onBack = null,
  resolution,
  width: initialWidth,
  height: initialHeight,
  aspectRatio: initialRatioProp,
  fps,
  codec = 'h264',
  audioChannels = null,
  audioLayout = null,
  hiResAudio = null,
  videoId,
  videoSlug,
  videoCategory,
  defaultVolume = 0.8,
  defaultAutoplay = true,
  defaultSpeed = 1,
  defaultFit = 'fit',
  seekStep = 10,
  autoStats = false,
  initialTime = 0,
  isMusic = false,
  onTimeUpdate,
  onLoadedMetadata,
  onRatioChange = null,
  onHdrStateChange = null,
  videoRef: externalVideoRef,
  desktopMaxHeight = 'calc(100vh - 100px)',
  ambientMode = true,
  setAmbientMode = null,
  currentVideo = null,
  relatedVideos = [],
  onSelectVideo = null,
  playlistActive = false,
  playlistNextVideo = null,
  playlistPrevVideo = null,
  playlistLoopMode = 'none',
  onPlayNext = null,
  onPlayPrev = null,
  forcePlaylistPlayback = false,
  isSwitchingVideo = false,
  versions = [],
  activeVersion = null,
  onSelectVersion = null,
  isSwitchingVersion = false,
  partialSegmentMapRef = null,
}) {
  const shouldAutoplay = defaultAutoplay || forcePlaylistPlayback;
  const video = useRef(null);
  const isActiveRef = useRef(isActive);
  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);
  const resolutionRef = useRef(resolution);
  useEffect(() => {
    resolutionRef.current = resolution;
  }, [resolution]);
  const segmentMapRefProp = useRef(partialSegmentMapRef);
  useEffect(() => {
    segmentMapRefProp.current = partialSegmentMapRef;
  }, [partialSegmentMapRef]);
  useEffect(() => {
    if (externalVideoRef) {
      externalVideoRef.current = video.current;
    }
  });
  const containerRef = useRef(null);
  const seekTrackRef = useRef(null);
  const hlsInstanceRef = useRef(null);
  const hlsRetryCountRef = useRef(0);
  const recoverHdrPlaybackRef = useRef(null);
  const isTransitioningStreamRef = useRef(false);
  const isSwitchingVideoRef = useRef(isSwitchingVideo);
  useLayoutEffect(() => {
    isSwitchingVideoRef.current = isSwitchingVideo;
  }, [isSwitchingVideo]);

  // Resume / Timestamp seeking support (?t=seconds)
  // For music: always restart from 00:00 (targetInitialTime = 0)
  const initialSeekDoneRef = useRef(false);
  const targetInitialTime = isMusic ? 0 : (Number(initialTime) || 0);

  // When switching video: mute & stopLoad & pause old video silently, show buffering, reset progress to 0:00, show new poster!
  useEffect(() => {
    isSwitchingVideoRef.current = isSwitchingVideo;
    if (isSwitchingVideo) {
      isTransitioningStreamRef.current = true;
      if (hlsInstanceRef.current) {
        try { hlsInstanceRef.current.stopLoad(); } catch (_) { }
      }
      if (video.current) {
        try {
          video.current.muted = true;
          video.current.volume = 0;
          video.current.pause();
        } catch (_) { }
      }
      setIsPlaying(false);
      setIsBuffering(true);
      isEndedRef.current = false;
      setIsEnded(false);
      setIsMobileEndScreenDismissed(false);
      isUserPausedRef.current = false;
      setShowPoster(true);

      // Reset playback states immediately
      setDuration(0);
      setIsSeeking(false);
      lastReportedSecondRef.current = 0;

      // Clear progress bar, scrubber knob, buffer bar, and time display immediately
      if (progressBarRef.current) progressBarRef.current.style.width = '0%';
      if (hoverBarRef.current) hoverBarRef.current.style.width = '0%';
      if (scrubberKnobRef.current) scrubberKnobRef.current.style.left = '0%';
      if (bufferBarRef.current) bufferBarRef.current.style.width = '0%';
      if (timeDisplayRef.current) timeDisplayRef.current.textContent = '0:00 / 0:00';
      if (fadeBlackOverlayRef.current) {
        fadeBlackOverlayRef.current.style.transition = 'none';
        fadeBlackOverlayRef.current.style.opacity = '0';
      }
    }
  }, [isSwitchingVideo]);

  // Track previous stream source URL to guard against redundant resets
  const prevSrcRef = useRef(src);

  // Reset playback and scrubber ONLY when the new stream URL (src) actually changes
  useEffect(() => {
    if (src === prevSrcRef.current) return;
    prevSrcRef.current = src;

    isTransitioningStreamRef.current = true;
    initialSeekDoneRef.current = false;
    isEndedRef.current = false;
    setIsEnded(false);
    setIsMobileEndScreenDismissed(false);
    isUserPausedRef.current = false;
    setIsMuted(isUserMutedRef.current);
    setShowPoster(true);
    const startSec = targetInitialTime > 0 ? targetInitialTime : 0;
    lastReportedSecondRef.current = Math.floor(startSec);
    if (startSec === 0) {
      if (progressBarRef.current) progressBarRef.current.style.width = '0%';
      if (hoverBarRef.current) hoverBarRef.current.style.width = '0%';
      if (scrubberKnobRef.current) scrubberKnobRef.current.style.left = '0%';
      if (timeDisplayRef.current) timeDisplayRef.current.textContent = '0:00 / 0:00';
    }
    if (fadeBlackOverlayRef.current) {
      fadeBlackOverlayRef.current.style.transition = 'none';
      fadeBlackOverlayRef.current.style.opacity = '0';
    }

    // Resume fullscreen across video transitions
    if (typeof window !== 'undefined') {
      try {
        if (sessionStorage.getItem('tubelock_keep_fullscreen') === '1') {
          sessionStorage.removeItem('tubelock_keep_fullscreen');
          const isFull = !!(document.fullscreenElement || document.webkitFullscreenElement);
          if (!isFull && containerRef.current) {
            if (containerRef.current.requestFullscreen) {
              containerRef.current.requestFullscreen().catch(() => { });
            } else if (containerRef.current.webkitRequestFullscreen) {
              containerRef.current.webkitRequestFullscreen().catch(() => { });
            }
          }
        }
      } catch (_) { }
    }
  }, [src, targetInitialTime]);

  // Clean music position on videoId change
  useEffect(() => {
    if (isMusic && videoId && typeof window !== 'undefined') {
      try {
        localStorage.removeItem(`tubelock_pos_${videoId}`);
      } catch (_) { }
    }
  }, [videoId, isMusic]);

  // Performance Direct-DOM Refs (Prevents React re-render thrashing!)
  const progressBarRef = useRef(null);
  const bufferBarRef = useRef(null);
  const hoverBarRef = useRef(null);
  const scrubberKnobRef = useRef(null);
  const timeDisplayRef = useRef(null);
  const fadeBlackOverlayRef = useRef(null);

  // Compute initial aspect ratio from metadata props (prioritizes DB width/height or parsed resolution)
  const computePropRatio = useCallback(() => {
    if (initialRatioProp && initialRatioProp > 0) return initialRatioProp;
    if (initialWidth && initialHeight && initialWidth > 0 && initialHeight > 0) {
      return initialWidth / initialHeight;
    }
    if (typeof resolution === 'string' && resolution.includes('x')) {
      const parts = resolution.split('x');
      const w = parseFloat(parts[0]);
      const h = parseFloat(parts[1]);
      if (w > 0 && h > 0) return w / h;
    }
    return 16 / 9;
  }, [initialRatioProp, initialWidth, initialHeight, resolution]);

  // Video aspect ratio & vertical detection
  const propRatio = computePropRatio();
  const [detectedRatio, setDetectedRatio] = useState(null);
  const videoRatio = detectedRatio || propRatio;

  // Cinematic: wider than 16:9 (ratio > ~1.78)
  const isCinematic = videoRatio > (16 / 9 + 0.05);

  const lastReportedRatioRef = useRef(null);
  const checkAndUpdateRatio = useCallback((forceRatio = null) => {
    const v = video?.current;
    let trueRatio = forceRatio;
    if (!trueRatio && v && v.videoWidth > 0 && v.videoHeight > 0) {
      trueRatio = v.videoWidth / v.videoHeight;
    }
    if (trueRatio && trueRatio > 0 && !isNaN(trueRatio)) {
      if (!lastReportedRatioRef.current || Math.abs(lastReportedRatioRef.current - trueRatio) > 0.005) {
        lastReportedRatioRef.current = trueRatio;
        setDetectedRatio(trueRatio);
        if (onRatioChange) onRatioChange(trueRatio);
      }
      return true;
    }
    return false;
  }, [video, onRatioChange]);

  const updateRatio = useCallback((newRatio) => {
    if (newRatio && newRatio > 0 && !isNaN(newRatio)) {
      const v = video?.current;
      if (v && v.videoWidth > 0 && v.videoHeight > 0) {
        checkAndUpdateRatio();
        return;
      }
      checkAndUpdateRatio(newRatio);
    }
  }, [video, checkAndUpdateRatio]);

  // Native HTMLVideoElement dimension listener (HTML5 'resize' event fires when intrinsic dimensions change)
  useEffect(() => {
    const v = video.current;
    if (!v) return;

    const handleDimensionEvent = () => {
      checkAndUpdateRatio();
    };

    v.addEventListener('resize', handleDimensionEvent);
    v.addEventListener('loadedmetadata', handleDimensionEvent);
    v.addEventListener('loadeddata', handleDimensionEvent);
    v.addEventListener('canplay', handleDimensionEvent);
    v.addEventListener('playing', handleDimensionEvent);

    return () => {
      v.removeEventListener('resize', handleDimensionEvent);
      v.removeEventListener('loadedmetadata', handleDimensionEvent);
      v.removeEventListener('loadeddata', handleDimensionEvent);
      v.removeEventListener('canplay', handleDimensionEvent);
      v.removeEventListener('playing', handleDimensionEvent);
    };
  }, [video, checkAndUpdateRatio]);

  // Playback states
  const [isPlaying, setIsPlaying] = useState(false);
  const [isEnded, setIsEnded] = useState(false);
  const isEndedRef = useRef(false);
  const [isMobileEndScreenDismissed, setIsMobileEndScreenDismissed] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [showPoster, setShowPoster] = useState(true);
  const [duration, setDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [volume, setVolume] = useState(defaultVolume);
  const volumeRef = useRef(defaultVolume);
  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);
  const [isMuted, setIsMuted] = useState(false);
  const isUserMutedRef = useRef(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);

  // Hi-Res Lossless Audio Engine (Synced Uncompressed Full WAV / Auto-FLAC <audio> track)
  const hiResAudioRef = useRef(null);
  const hiResFailedUrlRef = useRef(null);
  const [preferHiResAudio, setPreferHiResAudio] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem('tubelock_prefer_hires') === '1';
    } catch {
      return false;
    }
  });
  const [hiResStatus, setHiResStatus] = useState('idle');
  const hasHiResAudio = Boolean(hiResAudio?.url);
  const isHiResActive = Boolean(
    hasHiResAudio &&
    preferHiResAudio &&
    hiResFailedUrlRef.current !== hiResAudio?.url
  );
  const isHiResActiveRef = useRef(isHiResActive);
  useEffect(() => {
    isHiResActiveRef.current = isHiResActive;
  }, [isHiResActive]);
  const [isCurrentLevelHdr, setIsCurrentLevelHdr] = useState(false);
  const autoCapLevelIndexRef = useRef(-1);

  // Responsive device view & popup placement
  const [isMobileView, setIsMobileView] = useState(false);
  const [isMobileLandscape, setIsMobileLandscape] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [settingsPlacement, setSettingsPlacement] = useState('bottom'); // 'bottom' | 'top'

  useEffect(() => {
    const checkIsMobile = () => {
      if (typeof window === 'undefined') return;
      const isTouchOrMobileUA =
        'ontouchstart' in window ||
        navigator.maxTouchPoints > 0 ||
        window.matchMedia?.('(pointer: coarse)')?.matches ||
        window.matchMedia?.('(hover: none)')?.matches ||
        /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent);
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const isLandscapePhone = Boolean(isTouchOrMobileUA && vw > vh && vh <= 520 && vw <= 1024);
      const isSmall = vw < 768;
      const isMediumTouch = Boolean(isTouchOrMobileUA && vw < 1024);
      setIsMobileView(isSmall || isMediumTouch || isLandscapePhone);
      setIsMobileLandscape(isLandscapePhone);
    };
    checkIsMobile();
    window.addEventListener('resize', checkIsMobile);
    window.addEventListener('orientationchange', checkIsMobile);
    return () => {
      window.removeEventListener('resize', checkIsMobile);
      window.removeEventListener('orientationchange', checkIsMobile);
    };
  }, []);

  const effectiveFullscreen = isFullscreen || isMobileLandscape;

  useEffect(() => {
    if (typeof document === 'undefined' || !isActive || !isMobileLandscape) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isActive, isMobileLandscape]);

  // Measure actual rendered player box so subtitles stay inside the video frame on tall screens
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof window === 'undefined') return;

    const updateSize = (nextW, nextH) => {
      const w = Math.round(nextW || 0);
      const h = Math.round(nextH || 0);
      setContainerSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    };

    const measure = () => {
      const rect = el.getBoundingClientRect();
      updateSize(rect.width, rect.height);
    };

    measure();
    window.addEventListener('resize', measure);

    let observer = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        updateSize(entry.contentRect.width, entry.contentRect.height);
      });
      observer.observe(el);
    }

    return () => {
      window.removeEventListener('resize', measure);
      if (observer) observer.disconnect();
    };
  }, [effectiveFullscreen, videoRatio, isMobileView]);

  // YouTube Mobile UI states & Subtitles (Direct from DB)
  const session = useSession();
  const hasSession = Boolean(session);
  const [isAutoplay, setIsAutoplay] = useState(defaultAutoplay);
  const [isCcActive, setIsCcActive] = useState(false);
  const [subtitleStyle, setSubtitleStyle] = useState(DEFAULT_SUBTITLE_STYLE);
  const [activeCueText, setActiveCueText] = useState('');
  const lastCueTextRef = useRef('');
  const subPrefsHydratedRef = useRef(false);
  const userChangedSubPrefsRef = useRef(false);
  const skipNextDbSyncRef = useRef(false);
  const dbSyncTimerRef = useRef(null);

  const handleUserSetCcActive = useCallback((updater) => {
    userChangedSubPrefsRef.current = true;
    setIsCcActive(updater);
  }, []);

  const handleUserSetSubtitleStyle = useCallback((updater) => {
    userChangedSubPrefsRef.current = true;
    setSubtitleStyle(updater);
  }, []);

  // Load saved CC preference & Subtitle style from localStorage + users table in DB (cached & deferred to protect TTFF)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let isCancelled = false;

    const applyDbSettings = (data) => {
      if (isCancelled || !data?.authenticated || !data?.subtitleSettings) return;
      const { style: dbStyle, ccActive: dbCcActive } = data.subtitleSettings;
      skipNextDbSyncRef.current = true;
      if (dbStyle && typeof dbStyle === 'object') {
        const merged = { ...DEFAULT_SUBTITLE_STYLE, ...dbStyle };
        setSubtitleStyle(merged);
        try {
          localStorage.setItem('tubelock_subtitle_style', JSON.stringify(merged));
        } catch (_) { }
      }
      if (typeof dbCcActive === 'boolean') {
        setIsCcActive(dbCcActive);
        try {
          localStorage.setItem('tubelock_cc_active', dbCcActive ? '1' : '0');
        } catch (_) { }
      }
      setTimeout(() => {
        skipNextDbSyncRef.current = false;
      }, 100);
    };

    Promise.resolve().then(() => {
      if (isCancelled) return;
      try {
        const savedStyle = localStorage.getItem('tubelock_subtitle_style');
        if (savedStyle) {
          const parsed = JSON.parse(savedStyle);
          if (parsed && typeof parsed === 'object') {
            setSubtitleStyle({ ...DEFAULT_SUBTITLE_STYLE, ...parsed });
          }
        }
        const savedCc = localStorage.getItem('tubelock_cc_active');
        if (savedCc === '1') {
          setIsCcActive(true);
        }
      } catch (_) { }
      subPrefsHydratedRef.current = true;
    });

    if (!hasSession) {
      return () => {
        isCancelled = true;
      };
    }

    if (subSettingsCache.data && Date.now() - subSettingsCache.at < SUB_SETTINGS_CACHE_TTL_MS) {
      Promise.resolve().then(() => applyDbSettings(subSettingsCache.data));
      return () => {
        isCancelled = true;
      };
    }

    // Defer account sync so it never contends with initial manifest / chunk #0 startup
    const fetchTimer = setTimeout(() => {
      fetch('/api/user/subtitle-settings', { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (isCancelled || !data) return;
          updateSubSettingsCache(data);
          applyDbSettings(data);
        })
        .catch(() => { });
    }, 1200);

    return () => {
      isCancelled = true;
      clearTimeout(fetchTimer);
    };
  }, [hasSession]);

  // Persist subtitleStyle & isCcActive to localStorage + users table ONLY when user explicitly changed preferences
  useEffect(() => {
    if (typeof window === 'undefined' || !subPrefsHydratedRef.current || !userChangedSubPrefsRef.current) {
      return;
    }
    try {
      localStorage.setItem('tubelock_subtitle_style', JSON.stringify(subtitleStyle));
      localStorage.setItem('tubelock_cc_active', isCcActive ? '1' : '0');
    } catch (_) { }

    if (!hasSession || skipNextDbSyncRef.current) return;

    if (dbSyncTimerRef.current) {
      clearTimeout(dbSyncTimerRef.current);
    }
    dbSyncTimerRef.current = setTimeout(() => {
      fetch('/api/user/subtitle-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          style: subtitleStyle,
          ccActive: isCcActive,
        }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((saved) => {
          if (saved?.success) {
            updateSubSettingsCache({
              authenticated: true,
              subtitleSettings: saved.subtitleSettings || { style: subtitleStyle, ccActive: isCcActive },
            });
          }
        })
        .catch(() => { });
    }, 350);

    return () => {
      if (dbSyncTimerRef.current) {
        clearTimeout(dbSyncTimerRef.current);
      }
    };
  }, [subtitleStyle, isCcActive, hasSession]);

  const computedSubStyles = useMemo(
    () => computeSubtitleStyles(subtitleStyle, isMobileView),
    [subtitleStyle, isMobileView]
  );

  const subtitleTracks = useMemo(() => {
    let tracks = [];
    const raw = currentVideo?.subtitle_tracks;
    if (Array.isArray(raw) && raw.length > 0) {
      tracks = raw;
    } else if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) tracks = parsed;
      } catch (_) { }
    }
    // Fallback if no tracks array but subtitle_srt or subtitle_vtt exists
    if (tracks.length === 0 && (currentVideo?.subtitle_srt || currentVideo?.subtitle_vtt)) {
      tracks = [
        {
          id: 'th',
          label: 'ไทย (สร้างอัตโนมัติ)',
          lang: 'th',
          srt: currentVideo?.subtitle_srt || '',
          vtt: currentVideo?.subtitle_vtt || '',
        },
      ];
    }
    return tracks;
  }, [currentVideo?.subtitle_tracks, currentVideo?.subtitle_srt, currentVideo?.subtitle_vtt]);

  const [selectedSubTrackId, setSelectedSubTrackId] = useState('th');

  useEffect(() => {
    if (subtitleTracks.length > 0) {
      const match = subtitleTracks.find((t) => t.id === selectedSubTrackId);
      if (!match) {
        const hasTh = subtitleTracks.some((t) => t.id === 'th');
        setSelectedSubTrackId(hasTh ? 'th' : subtitleTracks[0].id);
      }
    }
  }, [subtitleTracks, selectedSubTrackId]);

  const activeSubTrack = useMemo(() => {
    if (!subtitleTracks || subtitleTracks.length === 0) return null;
    return subtitleTracks.find((t) => t.id === selectedSubTrackId) || subtitleTracks[0];
  }, [subtitleTracks, selectedSubTrackId]);

  const subtitleCues = useMemo(() => {
    if (!activeSubTrack) return [];
    const rawSub = activeSubTrack.srt || activeSubTrack.vtt || '';
    return parseSubtitleCues(rawSub);
  }, [activeSubTrack]);

  const hasSubtitles = subtitleTracks.length > 0 && subtitleCues.length > 0;
  const [isLiked, setIsLiked] = useState(false);
  const [isDisliked, setIsDisliked] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  // Speed and Aspect Mode: 'fit' | 'crop' | 'fill'
  const [playbackRate, setPlaybackRate] = useState(defaultSpeed);
  const [aspectMode, setAspectMode] = useState(defaultFit);

  // Ultra-Smooth Performance Mode (Disables blurs/animations on low-spec/mobile)
  const [ultraSmooth, setUltraSmooth] = useState(false);

  // Telemetry HUD / Stats
  const [showStats, setShowStats] = useState(autoStats);

  // On-Screen Toast & Momentary Ripple
  const [toastMessage, setToastMessage] = useState(null);
  const [centerRipple, setCenterRipple] = useState(null);
  const toastTimeoutRef = useRef(null);
  const rippleTimeoutRef = useRef(null);

  const showToast = useCallback((msg) => {
    setToastMessage(msg);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToastMessage(null), 1500);
  }, []);

  const triggerRipple = useCallback((type) => {
    setCenterRipple(type);
    if (rippleTimeoutRef.current) clearTimeout(rippleTimeoutRef.current);
    rippleTimeoutRef.current = setTimeout(() => setCenterRipple(null), 450);
  }, []);

  // Controls & Menus
  const [showControls, setShowControls] = useState(true);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [hasOpenedSettings, setHasOpenedSettings] = useState(false);
  const settingsMenuRef = useRef(null);
  const [activeMenuTab, setActiveMenuTab] = useState('main'); // 'main' | 'speed' | 'quality' | 'aspect'

  const handleSetShowSettingsMenu = useCallback((nextOrUpdater) => {
    if (typeof nextOrUpdater === 'function') {
      setHasOpenedSettings(true);
      setShowSettingsMenu(nextOrUpdater);
    } else {
      if (nextOrUpdater) setHasOpenedSettings(true);
      setShowSettingsMenu(nextOrUpdater);
    }
  }, []);

  // Click Outside to Dismiss Settings Menu (YouTube Standard)
  useEffect(() => {
    if (!showSettingsMenu) return;

    // ปิด seek hover preview ทันทีเมื่อเปิดเมนูตั้งค่า
    setIsHoveringSeek(false);

    const handlePointerDownOutside = (e) => {
      if (settingsMenuRef.current && settingsMenuRef.current.contains(e.target)) {
        return;
      }
      if (e.target?.closest?.('[data-settings-btn="true"]')) {
        return;
      }
      setShowSettingsMenu(false);
    };

    document.addEventListener('pointerdown', handlePointerDownOutside);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDownOutside);
    };
  }, [showSettingsMenu]);

  // HLS ABR Levels
  const [levels, setLevels] = useState([]);
  const [currentLevelIndex, setCurrentLevelIndex] = useState(-1);
  const [activeLevelLabel, setActiveLevelLabel] = useState(formatResolutionBadge(resolution) || 'Auto');

  // Scrubbing & Hover Preview (Direct DOM updates only — zero React state churn during hover/scrub!)
  const [isScrubbing, setIsScrubbing] = useState(false);
  const isScrubbingRef = useRef(false);
  const latestScrubTimeRef = useRef(null);
  useEffect(() => {
    isScrubbingRef.current = isScrubbing;
  }, [isScrubbing]);
  const [isHoveringSeek, setIsHoveringSeek] = useState(false);
  const lastHoverTimeRef = useRef(0);    // ค้าง hover time ล่าสุด — ใช้ fallback ไม่ให้ preview วิ่งไป 0:00 ตอน mouse leave
  const lastHoverPercentRef = useRef(0); // ค้าง hover position ล่าสุด
  const scrubPreviewRef = useRef(null);
  const scrubBadgeRef = useRef(null);
  const scrubThumbSdRef = useRef(null);
  const scrubThumbHdRef = useRef(null);
  const scrubSheetImagesRef = useRef(new Map());
  const pendingScrubFrameRef = useRef(null);
  const hdDwellTimerRef = useRef(null);

  // Unified YouTube 3-Zone Click / Double-Click Seeking & Context Menu
  const clickStateRef = useRef({ time: 0, zone: null });
  const singleClickTimerRef = useRef(null);
  const doubleTapClearTimerRef = useRef(null);
  const pendingTargetTimeRef = useRef(null);
  const [doubleTapSide, setDoubleTapSide] = useState(null);
  const [accumulatedSeconds, setAccumulatedSeconds] = useState(0);
  const [contextMenu, setContextMenu] = useState(null);
  const [isLooping, setIsLooping] = useState(false);
  const nativeLooping = isLooping && !playlistActive;
  const repeatPlaylistVideo = playlistActive && playlistLoopMode === 'one';
  const controlsTimeoutRef = useRef(null);
  const lastSavedTimeRef = useRef(0);
  const lastSavedHistoryTimeRef = useRef(0);
  const lastDbHistorySyncRef = useRef({ videoId: null, versionId: null, position: -1, at: 0, musicSynced: false });
  const lastReportedSecondRef = useRef(-1);

  // ── Quality View Counting Tracker (Anti-Spam & 15s Watch Threshold) ──
  const accumulatedWatchTimeRef = useRef(0);
  const lastTickTimeRef = useRef(null);
  const viewCountRecordedRef = useRef(false);

  useEffect(() => {
    accumulatedWatchTimeRef.current = 0;
    lastTickTimeRef.current = null;
    viewCountRecordedRef.current = false;
    lastReportedRatioRef.current = null;
    lastDbHistorySyncRef.current = { videoId: null, versionId: null, position: -1, at: 0, musicSynced: false };
    const resetTimer = Promise.resolve().then(() => {
      setDetectedRatio(null);
    });
    return () => { void resetTimer; };
  }, [videoId]);

  const isUserPausedRef = useRef(!shouldAutoplay);
  const wakeLockSentinelRef = useRef(null);
  const isSeekingRef = useRef(false);
  const seekTimeRef = useRef(0);
  const seekCooldownTimerRef = useRef(null);

  const [hlsError, setHlsError] = useState(null);

  // Screen WakeLock
  const requestWakeLock = useCallback(async () => {
    if (typeof window !== 'undefined' && 'wakeLock' in navigator && !wakeLockSentinelRef.current) {
      try {
        wakeLockSentinelRef.current = await navigator.wakeLock.request('screen');
        wakeLockSentinelRef.current.addEventListener('release', () => {
          wakeLockSentinelRef.current = null;
        });
      } catch (err) {
        console.warn('Wake Lock failed:', err);
      }
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    if (wakeLockSentinelRef.current) {
      try {
        await wakeLockSentinelRef.current.release();
        wakeLockSentinelRef.current = null;
      } catch (err) {
        console.warn('Wake Lock release error:', err);
      }
    }
  }, []);

  useEffect(() => {
    if (isPlaying) requestWakeLock();
    else releaseWakeLock();
  }, [isPlaying, requestWakeLock, releaseWakeLock]);

  // Sync watch history to localStorage immediately & throttle/deduplicate Neon DB writes
  const syncHistoryToPlayState = useCallback((curSec, { forceServer = false } = {}) => {
    if (!videoId || !(curSec > 1)) return;
    const floorPos = isMusic ? 0 : Math.floor(curSec);
    const verId = activeVersion?.id || null;

    if (isMusic) {
      try {
        localStorage.setItem(`tubelock_watched_${videoId}`, '1');
        localStorage.removeItem(`tubelock_pos_${videoId}`);
      } catch (_) { }
    } else {
      try {
        localStorage.setItem(`tubelock_pos_${videoId}`, String(floorPos));
      } catch (_) { }
    }

    if (!hasSession) return;

    const now = performance.now();
    const syncState = lastDbHistorySyncRef.current;
    const isSameVideo = syncState.videoId === videoId && syncState.versionId === verId;

    if (!isSameVideo) {
      lastDbHistorySyncRef.current = {
        videoId,
        versionId: verId,
        position: -1,
        at: 0,
        musicSynced: false,
      };
    }

    const curSync = lastDbHistorySyncRef.current;
    if (isMusic) {
      if (curSync.musicSynced) return;
    } else {
      const isFirstSync = curSync.position < 0;
      const posDiff = Math.abs(floorPos - curSync.position);
      if (forceServer) {
        if (!isFirstSync && posDiff < 3) return;
      } else {
        if (!isFirstSync && (now - curSync.at < 45000 || posDiff < 10)) return;
      }
    }

    lastDbHistorySyncRef.current = {
      videoId,
      versionId: verId,
      position: floorPos,
      at: now,
      musicSynced: Boolean(isMusic),
    };

    const historyPayload = JSON.stringify({
      videoId,
      versionId: verId,
      position: floorPos,
      isMusic: Boolean(isMusic),
    });

    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon('/api/history', historyPayload);
    } else {
      fetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: historyPayload,
        keepalive: true,
      }).catch(() => { });
    }
  }, [videoId, activeVersion?.id, isMusic, hasSession]);

  // Flush latest non-music watch position when user switches tabs or closes the page
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const flushHistory = () => {
      const v = video.current;
      if (!v || !isActiveRef.current || isSwitchingVideoRef.current) return;
      if (v.currentTime > 1) {
        syncHistoryToPlayState(v.currentTime, { forceServer: true });
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushHistory();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', flushHistory);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', flushHistory);
    };
  }, [syncHistoryToPlayState]);

  // Initial volume setup
  useEffect(() => {
    if (video.current) {
      volumeRef.current = defaultVolume;
      setVolume(defaultVolume);
      if (!isTransitioningStreamRef.current && isActiveRef.current && !isSwitchingVideoRef.current) {
        const targetVol = isUserMutedRef.current ? 0 : defaultVolume;
        if (isHiResActiveRef.current && hiResAudioRef.current) {
          video.current.muted = true;
          hiResAudioRef.current.volume = targetVol;
          hiResAudioRef.current.muted = isUserMutedRef.current;
        } else {
          video.current.volume = targetVol;
        }
      }
      video.current.playbackRate = defaultSpeed;
      if (hiResAudioRef.current) hiResAudioRef.current.playbackRate = defaultSpeed;
      setPlaybackRate(defaultSpeed);
    }
  }, [defaultVolume, defaultSpeed, video]);

  // Direct DOM Buffer Progress Update (Zero React re-render overhead!)
  const updateBufferProgress = useCallback(() => {
    if (!video.current || !bufferBarRef.current) return;
    const b = video.current.buffered;
    const cur = video.current.currentTime;
    const dur = video.current.duration || duration;
    if (dur <= 0) return;

    for (let i = 0; i < b.length; i++) {
      if (b.start(i) <= cur && cur <= b.end(i)) {
        const pct = Math.min((b.end(i) / dur) * 100, 100);
        bufferBarRef.current.style.width = `${pct}%`;
        return;
      }
    }
  }, [video, duration]);

  // ZERO-RE-RENDER Playback Progress via Direct DOM Updates!
  const handleNativeTimeUpdate = (e) => {
    if (isSwitchingVideo) return;
    // Ultra-fast O(1) aspect ratio check: verifies real decoded frame aspect ratio
    const v = e.target;
    if (v && v.videoWidth > 0 && v.videoHeight > 0) {
      const curRatio = v.videoWidth / v.videoHeight;
      if (!lastReportedRatioRef.current || Math.abs(lastReportedRatioRef.current - curRatio) > 0.005) {
        checkAndUpdateRatio(curRatio);
      }
    }

    const cur = e.target.currentTime;
    const rawDur = e.target.duration || duration || 0;
    const dur = Math.max(rawDur, cur);

    // Update active subtitle cue text with millisecond accuracy (only re-renders when cue text changes)
    if (isCcActive && subtitleCues.length > 0) {
      const matchedCue = findActiveSubtitleCue(subtitleCues, cur);
      const nextText = matchedCue ? matchedCue.text : '';
      if (nextText !== lastCueTextRef.current) {
        lastCueTextRef.current = nextText;
        setActiveCueText(nextText);
      }
    } else if (lastCueTextRef.current !== '') {
      lastCueTextRef.current = '';
      setActiveCueText('');
    }

    // Sync state duration if it drifts (e.g. initial metadata vs decoded fragments)
    if (dur > 0 && Math.abs(dur - duration) > 0.5) {
      setDuration(dur);
    }

    // ถ้า isSeeking หรือ isScrubbing เป็นจริง ห้ามอัปเดต currentTime จากตัว <video> เด็ดขาด (กันค่า 0 ชั่วคราวมาทับ UI)
    if (isSeeking || isSeekingRef.current || isScrubbing || isScrubbingRef.current) {
      return;
    }

    // Direct DOM manipulation only — ZERO React re-renders per second during playback!
    const curSecFloor = Math.floor(cur);
    const timeChanged = curSecFloor !== lastReportedSecondRef.current;
    if (timeChanged) {
      lastReportedSecondRef.current = curSecFloor;
    }

    if (dur > 0) {
      const pct = (cur / dur) * 100;
      if (progressBarRef.current) {
        progressBarRef.current.style.width = `${pct}%`;
      }
      if (scrubberKnobRef.current) {
        scrubberKnobRef.current.style.left = `${pct}%`;
      }
      if (timeDisplayRef.current && timeChanged) {
        timeDisplayRef.current.textContent = formatTimePair(cur, dur);
      }
    }

    // 🎬 Cinematic Fade to Black (ช่วง ~0.5s สุดท้ายก่อนจบวิดีโอ)
    if (dur > 2) {
      const timeLeft = dur - cur;
      if (timeLeft <= 0.5) {
        if (fadeBlackOverlayRef.current && fadeBlackOverlayRef.current.style.opacity !== '1') {
          fadeBlackOverlayRef.current.style.transition = 'opacity 700ms cubic-bezier(0.4, 0, 0.2, 1)';
          fadeBlackOverlayRef.current.style.opacity = '1';
        }
      } else if (timeLeft > 1 && !isEndedRef.current) {
        if (fadeBlackOverlayRef.current && fadeBlackOverlayRef.current.style.opacity !== '0') {
          fadeBlackOverlayRef.current.style.transition = 'opacity 300ms ease-out';
          fadeBlackOverlayRef.current.style.opacity = '0';
        }
      }
    }

    updateBufferProgress();

    // ⚡ Quality View Counting Tracker (Anti-Spam & 15s Watch Threshold)
    if (videoId && !viewCountRecordedRef.current) {
      const nowTs = performance.now();
      if (lastTickTimeRef.current !== null) {
        const deltaSec = (nowTs - lastTickTimeRef.current) / 1000;
        // ป้องกันค่ากระโดดผิดปกติ (เช่น สลับแท็บ) โดยรับเฉพาะ tick ปกติ (0 - 1.5 วินาที)
        if (deltaSec > 0 && deltaSec < 1.5) {
          accumulatedWatchTimeRef.current += deltaSec;
        }
      }
      lastTickTimeRef.current = nowTs;

      const viewDuration = Number(activeVersion?.duration || currentVideo?.duration) || dur;
      const minRequired = watchTimeThreshold(viewDuration);
      if (accumulatedWatchTimeRef.current >= minRequired) {
        viewCountRecordedRef.current = true;

        const viewUrl = `/api/videos/${videoId}/view`;
        const payload = JSON.stringify({
          watchTime: Math.min(accumulatedWatchTimeRef.current, viewDuration > 0 ? viewDuration * 1.1 : Infinity),
          versionId: activeVersion?.id ? Number(activeVersion.id) : null,
        });
        if (!navigator.sendBeacon?.(viewUrl, payload)) {
          fetch(viewUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            keepalive: true,
          }).catch(() => { });
        }
      }
    }

    // Trigger external callback periodically (for watch position saving)
    const now = performance.now();
    if (now - lastSavedTimeRef.current > 2000) {
      if (onTimeUpdate) onTimeUpdate(e);
      lastSavedTimeRef.current = now;
    }

    // Auto-save Watch History locally every 5s and sync to database via throttled/deduped helper
    if (videoId && cur > 1 && now - lastSavedHistoryTimeRef.current > 5000) {
      lastSavedHistoryTimeRef.current = now;
      syncHistoryToPlayState(cur, { forceServer: false });
    }
  };



  const showControlsRef = useRef(showControls);
  useEffect(() => {
    showControlsRef.current = showControls;
  }, [showControls]);

  const mobileControlsCanHide = isMobileView && !isScrubbing && !showSettingsMenu &&
    !showStats && !isEnded && !isBuffering && !isSwitchingVideo;

  const scheduleControlsHide = useCallback((delay) => {
    controlsTimeoutRef.current = setTimeout(() => {
      controlsTimeoutRef.current = null;
      showControlsRef.current = false;
      setShowControls(false);
    }, delay);
  }, []);

  const resetControlsTimer = useCallback((customDelay = null) => {
    showControlsRef.current = true;
    setShowControls(true);
    clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = null;
    const canHide = isMobileView
      ? mobileControlsCanHide
      : isPlaying && !isScrubbing && !showSettingsMenu && !showStats;
    if (canHide) {
      scheduleControlsHide(customDelay || (isMobileView ? 4500 : 2800));
    }
  }, [isPlaying, isScrubbing, showSettingsMenu, showStats, isMobileView, mobileControlsCanHide, scheduleControlsHide]);

  // Opening a sheet or starting a seek suspends the mobile timer. Closing it
  // gives the controls a fresh timeout, including while playback is paused.
  useEffect(() => {
    if (!isMobileView) return;
    clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = null;
    if (showControls && mobileControlsCanHide) scheduleControlsHide(4500);
    return () => {
      clearTimeout(controlsTimeoutRef.current);
      controlsTimeoutRef.current = null;
    };
  }, [isMobileView, mobileControlsCanHide, showControls, isPlaying, scheduleControlsHide]);

  const restoreAudioAfterTransition = useCallback(() => {
    const v = video.current;
    if (!v) return;
    const targetMuted = isUserMutedRef.current;
    const targetVol = targetMuted ? 0 : (volumeRef.current > 0 ? volumeRef.current : (defaultVolume || 0.8));
    if (isTransitioningStreamRef.current) {
      isTransitioningStreamRef.current = false;
    }
    try {
      if (isHiResActiveRef.current && hiResAudioRef.current) {
        v.muted = true;
        hiResAudioRef.current.muted = targetMuted;
        hiResAudioRef.current.volume = targetVol;
      } else {
        v.muted = targetMuted;
        v.volume = targetVol;
      }
    } catch (_) { }
    setIsMuted(targetMuted);
  }, [video, defaultVolume]);

  // Reliable Autoplay with YouTube-style graceful unmuted -> muted fallback
  const attemptAutoPlay = useCallback(() => {
    const v = video.current;
    if (!v || !isActiveRef.current || !shouldAutoplay || isUserPausedRef.current) return;
    if (isSwitchingVideoRef.current || v.readyState < 2) return;

    // Do NOT autoplay if video is ended or approaching the end (leaves playback stopped at end screen)
    if (v.ended || (v.duration > 0 && v.currentTime >= v.duration - 0.5) || isEndedRef.current) {
      return;
    }

    if (!v.paused) return;

    if (isTransitioningStreamRef.current) {
      restoreAudioAfterTransition();
    }

    const p = v.play();
    if (p !== undefined) {
      p.then(() => {
        setIsPlaying(true);
        isEndedRef.current = false;
        setIsEnded(false);
        setIsMobileEndScreenDismissed(false);
      }).catch((err) => {
        // Browser Autoplay Policy: if unmuted autoplay is blocked, mute and play immediately!
        // Ignore AbortError caused by source switching or transient load interruptions.
        if (v && err.name === 'NotAllowedError') {
          v.muted = true;
          setIsMuted(true);
          v.play()
            .then(() => {
              setIsPlaying(true);
              isEndedRef.current = false;
              setIsEnded(false);
              setIsMobileEndScreenDismissed(false);
            })
            .catch(() => { });
        }
      });
    }
  }, [shouldAutoplay, restoreAudioAfterTransition]);

  // Read current playback options without reconnecting an already playing stream.
  const getPlaybackOptions = useEffectEvent(() => ({
    attemptAutoPlay,
    checkAndUpdateRatio,
    fps,
    isPlaying,
    onHdrStateChange,
    onRefreshStream,
    restoreAudioAfterTransition,
    targetInitialTime,
    updateRatio,
  }));

  // Initialize HLS or Native Player
  useEffect(() => {
    const v = video.current;
    if (!v || !src || isSwitchingVideo) return;
    const { targetInitialTime } = getPlaybackOptions();

    isTransitioningStreamRef.current = true;
    try {
      v.muted = true;
      v.volume = 0;
    } catch (_) { }

    setHlsError(null);
    setIsBuffering(true);
    setLevels([]);
    setCurrentLevelIndex(-1);
    setActiveLevelLabel(formatResolutionBadge(resolutionRef.current) || 'Auto');
    hlsRetryCountRef.current = 0;

    isUserPausedRef.current = false;
    if (hlsInstanceRef.current) {
      try { hlsInstanceRef.current.stopLoad(); } catch (_) { }
      hlsInstanceRef.current.destroy();
      hlsInstanceRef.current = null;
    }

    const isHls = src.startsWith('blob:') || src.includes('.m3u8') || src.includes('playlist');
    let isMounted = true;

    async function initHls() {
      if (isHls) {
        const Hls = await preloadHlsModule();
        if (!isMounted || !Hls) return;

        if (Hls.isSupported()) {
          // ✨ Quality Persistence: อ่าน height ที่ผู้ใช้เคยเลือกไว้ → match กับ level index
          let savedStartLevel = -1; // default: Auto
          try {
            const savedHeight = localStorage.getItem('tubelock_quality_height');
            if (savedHeight) {
              // จะถูก resolve หลัง MANIFEST_PARSED เมื่อรู้จำนวน levels แล้ว
              savedStartLevel = parseInt(savedHeight, 10) || -1;
            }
          } catch (_) { }

          const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

          // ⚡ Seamless Two-Phase Segment URL Upgrade:
          // Swaps fallback /streams/{folder}/{seg}.ts URLs to direct CF Worker URLs in 0ms once background hydration finishes.
          class SegmentHydrationLoader extends Hls.DefaultConfig.loader {
            load(context, config, callbacks) {
              const map = segmentMapRefProp.current?.current;
              if (map && context?.url && context.url.includes('/streams/')) {
                try {
                  const cleanPath = context.url.split('?')[0];
                  const match = cleanPath.match(/\/streams\/[^/]+\/(.+)$/);
                  if (match && match[1]) {
                    const relPath = decodeURIComponent(match[1]);
                    const baseName = relPath.includes('/')
                      ? relPath.slice(relPath.lastIndexOf('/') + 1)
                      : relPath;
                    const directUrl = map[relPath] || map[baseName] || map[baseName.toLowerCase()];
                    if (directUrl) {
                      context.url = directUrl;
                    }
                  }
                } catch (_) {}
              }
              super.load(context, config, callbacks);
            }
          }

          const hls = new Hls({
            fLoader: SegmentHydrationLoader,
            startPosition: targetInitialTime > 0 ? targetInitialTime : -1,
            // Defer fragment load until MANIFEST_PARSED so we can pick the exact fast-start or saved level before chunk #0!
            autoStartLoad: false,

            // mobile: เริ่มระดับต่ำสุด, desktop: เลือก fast-start 360p/480p ใน MANIFEST_PARSED แล้วให้ ABR เด้ง 1080p/4K ทันทีใน chunk ถัดไป
            startLevel: isMobile ? 0 : -1,

            // คุมระยะเวลาโหลดล่วงหน้า
            maxBufferLength: 60,
            maxMaxBufferLength: 120,

            // ลดขนาดแคชสูงสุด
            maxBufferSize: (isMobile ? 120 : 240) * 1000 * 1000,

            // ป้องกันการลบ buffer ด้านหลังเร็วเกินไป (30s แทน 5s ป้องกัน Chrome MSE buffer decode stall)
            backBufferLength: 30,
            enableWorker: true,
            lowLatencyMode: false,

            // ลดระดับอัตโนมัติในโหมด Auto เมื่ออุปกรณ์ดรอปเฟรม (เช่น CPU ถอดรหัส 4K AV1 ไม่ไหว) — แต่ยังกดเลือก 4K เองได้เสมอ
            capLevelOnFPSDrop: true,
            fpsDroppedMonitoringPeriod: 5000,
            fpsDroppedMonitoringThreshold: 0.15,

            fragLoadingTimeOut: 20000,
            fragLoadingMaxRetry: 4,
            manifestLoadingTimeOut: 15000,
            manifestLoadingMaxRetry: 3,
            levelLoadingTimeOut: 15000,
            levelLoadingMaxRetry: 3,

            // ปิด bandwidth probe ก่อนเริ่ม เพื่อไม่ให้เสียเวลาโหลด fragment แรกซ้ำซ้อน
            testBandwidth: false,

            // ค่าประเมินเริ่มต้นที่สมดุล เพื่อให้หลัง chunk แรก (360p/480p) จบ ABR กระโดดขึ้น 1080p/4K ทันที
            abrEwmaDefaultEstimate: isMobile ? 1500000 : 5000000,

            // Anti-stall watchdog settings: ข้าม micro-gaps อัตโนมัติ ป้องกันวิดีโอหยุดเล่นเอง
            maxBufferHole: 0.5,
            highBufferWatchdogPeriod: 2,
            nudgeOffset: 0.1,
            nudgeMaxRetry: 5,
          });

          hls.loadSource(src);
          hls.attachMedia(v);
          hlsInstanceRef.current = hls;

          const describeLevels = (playlistLevels, fps) => playlistLevels.map((level, index) => {
            const levelFps = level.attrs?.['FRAME-RATE'] ? parseFloat(level.attrs['FRAME-RATE']) : Number(fps) || 0;
            const isHdr = isHdrLevel(level);
            const { label, badge, fullLabel } = formatQualityLevel(level.height, levelFps, isHdr);
            return {
              index, height: level.height, width: level.width, bitrate: level.bitrate,
              isHdr, videoRange: getHlsVideoRange(level), label, badge, fullLabel,
            };
          });

          let hdrFallbackUsed = false;
          let resettingToSdr = false;
          let resumeAfterHdrFallback = false;
          const recoverHdrPlayback = (reportedLevel = hls.currentLevel) => {
            if (resettingToSdr) return true;
            if (!isMounted || hdrFallbackUsed || hlsInstanceRef.current !== hls) return false;

            const failedIndex = [reportedLevel, hls.loadLevel, hls.currentLevel, hls.startLevel]
              .find((index) => hls.levels[index]);
            const fallback = getSdrFallbackLevel(hls.levels, failedIndex);
            if (!fallback) return false;

            const { fps, isPlaying, onHdrStateChange } = getPlaybackOptions();
            const resumeAt = v.currentTime > 0 ? v.currentTime : (v.readyState === 0 ? targetInitialTime : 0);
            const wasAuto = hls.autoLevelEnabled;
            resumeAfterHdrFallback = !isUserPausedRef.current && (isPlaying || !v.paused);
            hdrFallbackUsed = true;
            resettingToSdr = true;
            setHlsError(null);
            setIsBuffering(true);
            isTransitioningStreamRef.current = true;
            lastTickTimeRef.current = null;

            // Reset the decoder for the codec change and keep Auto from selecting HDR again.
            hls.stopLoad();
            for (let index = hls.levels.length - 1; index >= 0; index--) {
              if (isHdrLevel(hls.levels[index])) hls.removeLevel(index);
            }
            const fallbackIndex = hls.levels.indexOf(fallback);
            const remaining = describeLevels(hls.levels, fps);
            autoCapLevelIndexRef.current = -1;
            hls.autoLevelCapping = -1;
            hls.startLevel = fallbackIndex;
            hls.loadLevel = wasAuto ? -1 : fallbackIndex;
            setLevels(remaining);
            setCurrentLevelIndex(wasAuto ? -1 : fallbackIndex);
            setActiveLevelLabel(remaining[fallbackIndex].label);
            setIsCurrentLevelHdr(false);
            onHdrStateChange?.(false);
            hlsRetryCountRef.current = 0;
            hls.recoverMediaError();
            if (wasAuto) hls.nextAutoLevel = fallbackIndex;
            hls.startLoad(resumeAt);
            queueMicrotask(() => { resettingToSdr = false; });
            return true;
          };
          recoverHdrPlaybackRef.current = recoverHdrPlayback;

          hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
            const { attemptAutoPlay, fps, onHdrStateChange, updateRatio } = getPlaybackOptions();
            setIsBuffering(false);
            isEndedRef.current = false;
            setIsEnded(false);
            setIsMobileEndScreenDismissed(false);
            const startSec = targetInitialTime > 0 ? targetInitialTime : 0;
            if (startSec > 0 && v) {
              try {
                v.currentTime = startSec;
              } catch (_) { }
            }
            lastReportedSecondRef.current = Math.floor(startSec);
            initialSeekDoneRef.current = true;
            if (data.levels && data.levels.length > 0) {
              const parsed = describeLevels(data.levels, fps);
              setLevels(parsed);

              // ✨ Quality Persistence vs YouTube-style Fast-Start ABR
              let appliedSaved = false;
              const displaySupportsHdr = supportsHdrDisplay();
              const screenPhysHeight =
                typeof window !== 'undefined'
                  ? Math.round((window.screen?.height || 1080) * (window.devicePixelRatio || 1))
                  : 1080;

              // In Auto mode on SDR screens (<=1080p physical height), cap auto-escalation at <=1080p so CPU doesn't waste 4x load decoding 4K AV1 just to downscale to 1080p!
              // Manual selection always clears autoLevelCapping so user can still pick 1440p/2160p anytime.
              let computedAutoCap = -1;
              if (!displaySupportsHdr && parsed.some((l) => l.isHdr) && screenPhysHeight <= 1200) {
                const underCap = parsed.filter((l) => (l.height || 0) <= 1080);
                if (underCap.length > 0 && underCap.length < parsed.length) {
                  computedAutoCap = underCap[underCap.length - 1].index;
                }
              }
              autoCapLevelIndexRef.current = computedAutoCap;

              if (savedStartLevel > 0) {
                const savedLevel = getSavedQualityLevel(parsed, savedStartLevel, displaySupportsHdr);
                if (savedLevel) {
                  const matchIdx = savedLevel.index;
                  hls.autoLevelCapping = -1;
                  hls.startLevel = matchIdx;
                  hls.currentLevel = matchIdx;
                  hls.nextLevel = matchIdx;
                  setCurrentLevelIndex(matchIdx);
                  setActiveLevelLabel(savedLevel.label);
                  setIsCurrentLevelHdr(Boolean(savedLevel.isHdr));
                  onHdrStateChange?.(Boolean(savedLevel.isHdr));
                  appliedSaved = true;
                }
              }

              if (!appliedSaved) {
                hls.autoLevelCapping = computedAutoCap;
                if (parsed.length > 1) {
                  const sortedByHeight = [...parsed].sort((a, b) => (a.height || 0) - (b.height || 0));
                  // On HDR-capable displays, prefer starting directly on the lowest HDR tier (e.g. 1080p HDR)
                  // so Android Chrome initializes SurfaceFlinger directly in 10-bit HDR mode without getting stuck in SDR!
                  const firstHdrLevel = displaySupportsHdr ? sortedByHeight.find((l) => l.isHdr) : null;
                  const fastStart = firstHdrLevel
                    ? firstHdrLevel
                    : isMobile
                      ? sortedByHeight[0]
                      : sortedByHeight.find((l) => l.height >= 360 && l.height <= 480) || sortedByHeight[0];
                  if (fastStart) {
                    // Load only chunk #0 from fast-start level while keeping Auto ABR active for chunk #1+
                    hls.startLevel = fastStart.index;
                    setIsCurrentLevelHdr(Boolean(fastStart.isHdr));
                    onHdrStateChange?.(Boolean(fastStart.isHdr));
                  }
                }
                setCurrentLevelIndex(-1);
              }

              // Auto-detect aspect ratio from highest HLS level
              const bestLevel = data.levels[data.levels.length - 1] || data.levels[0];
              if (bestLevel?.width && bestLevel?.height) {
                updateRatio(bestLevel.width / bestLevel.height);
              }
            }

            hls.startLoad(targetInitialTime > 0 ? targetInitialTime : -1);
            if (v && v.readyState >= 2) {
              attemptAutoPlay();
            }
          });

          hls.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
            const { checkAndUpdateRatio, fps, onHdrStateChange, updateRatio } = getPlaybackOptions();
            const lvl = hls.levels[data.level];
            if (lvl) {
              const lvlFps = lvl.attrs?.['FRAME-RATE'] ? parseFloat(lvl.attrs['FRAME-RATE']) : Number(fps) || 0;
              const isLevelHdr = isHdrLevel(lvl);
              const formatted = formatQualityLevel(lvl.height, lvlFps, isLevelHdr);
              setActiveLevelLabel(formatted.label);
              setIsCurrentLevelHdr(isLevelHdr);
              onHdrStateChange?.(isLevelHdr);
              if (lvl.width && lvl.height) {
                updateRatio(lvl.width / lvl.height);
              }
            }
            checkAndUpdateRatio();
          });

          hls.on(Hls.Events.LEVEL_LOADED, (event, data) => {
            const { checkAndUpdateRatio, updateRatio } = getPlaybackOptions();
            const lvl = hls.levels[data.level];
            if (lvl && lvl.width > 0 && lvl.height > 0) {
              updateRatio(lvl.width / lvl.height);
            }
            checkAndUpdateRatio();
          });

          hls.on(Hls.Events.FRAG_BUFFERED, (event, data) => {
            const { attemptAutoPlay, checkAndUpdateRatio } = getPlaybackOptions();
            checkAndUpdateRatio();
            if (resumeAfterHdrFallback && data.frag?.type === 'main') {
              resumeAfterHdrFallback = false;
              if (!shouldAutoplay && isActiveRef.current && !isUserPausedRef.current) v.play().catch(() => {});
            }
            attemptAutoPlay();
          });

          hls.on(Hls.Events.FRAG_LOADED, (event, data) => {
            if (data?.stats?.total) {
              lastFragBytesRef.current = data.stats.total;
              setTimeout(() => {
                lastFragBytesRef.current = 0;
              }, 1500);
            }
          });

          hls.on(Hls.Events.ERROR, (event, data) => {
            if (resettingToSdr) return;
            if (data.fatal) {
              const { onRefreshStream } = getPlaybackOptions();
              switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                  hlsRetryCountRef.current += 1;
                  if (hlsRetryCountRef.current >= 2 && onRefreshStream) {
                    const resumeAt = v?.currentTime || 0;
                    hlsRetryCountRef.current = 0;
                    setIsBuffering(true);
                    Promise.resolve(onRefreshStream(resumeAt)).then((refreshed) => {
                      if (!refreshed) {
                        setHlsError(`เชื่อมต่อสตรีมไม่สำเร็จ: ${data.details}`);
                        setIsBuffering(false);
                        try { hls.destroy(); } catch (_) { }
                      }
                    });
                  } else if (hlsRetryCountRef.current > 4) {
                    setHlsError(`เชื่อมต่อสตรีมไม่สำเร็จ: ${data.details}`);
                    setIsBuffering(false);
                    hls.destroy();
                  } else {
                    hls.startLoad();
                  }
                  break;
                case Hls.ErrorTypes.MEDIA_ERROR:
                  if (recoverHdrPlayback(data.frag?.type === 'main' ? data.frag.level : data.level)) break;
                  hlsRetryCountRef.current += 1;
                  if (hlsRetryCountRef.current > 4) {
                    setHlsError(`ไฟล์วิดีโอมีปัญหา: ${data.details}`);
                    setIsBuffering(false);
                    hls.destroy();
                  } else {
                    hls.recoverMediaError();
                  }
                  break;
                default:
                  setHlsError(`${data.type}: ${data.details}`);
                  setIsBuffering(false);
                  hls.destroy();
                  break;
              }
            } else {
              // Auto-recover non-fatal buffer stalls so video NEVER freezes on its own
              if (
                data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR ||
                data.details === Hls.ErrorDetails.BUFFER_NUDGE_ON_STALL
              ) {
                if (!isUserPausedRef.current && v && v.paused) {
                  v.play().catch(() => { });
                }
              }
            }
          });
        } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
          // Native Safari Apple hardware acceleration
          v.src = src;
          if (targetInitialTime > 0 && !initialSeekDoneRef.current) {
            initialSeekDoneRef.current = true;
            const applySeek = () => {
              try {
                v.currentTime = targetInitialTime;
              } catch (_) { }
              v.removeEventListener('loadedmetadata', applySeek);
            };
            if (v.readyState >= 1) {
              applySeek();
            } else {
              v.addEventListener('loadedmetadata', applySeek);
            }
          }
        }
      } else {
        // Direct MP4 - Clean Native Playback
        v.src = src;
        if (targetInitialTime > 0 && !initialSeekDoneRef.current) {
          initialSeekDoneRef.current = true;
          const applySeek = () => {
            try {
              v.currentTime = targetInitialTime;
            } catch (_) { }
            v.removeEventListener('loadedmetadata', applySeek);
          };
          if (v.readyState >= 1) {
            applySeek();
          } else {
            v.addEventListener('loadedmetadata', applySeek);
          }
        }
        if (isActiveRef.current && shouldAutoplay && !isUserPausedRef.current) {
          getPlaybackOptions().restoreAudioAfterTransition();
          v.play().then(() => setIsPlaying(true)).catch((err) => {
            if (err?.name === 'NotAllowedError') {
              v.muted = true;
              setIsMuted(true);
              v.play().then(() => setIsPlaying(true)).catch(() => { });
            }
          });
        }
      }
    }

    initHls();

    return () => {
      isMounted = false;
      recoverHdrPlaybackRef.current = null;
      if (hlsInstanceRef.current) {
        hlsInstanceRef.current.destroy();
        hlsInstanceRef.current = null;
      }
    };
  }, [src, shouldAutoplay, video, showToast, isSwitchingVideo]);

  // Quality selector (100% Smooth switch: nextLevel only, no stream reload)
  const handleSelectQuality = (levelIdx) => {
    setCurrentLevelIndex(levelIdx);
    if (hlsInstanceRef.current) {
      hlsInstanceRef.current.autoLevelCapping = levelIdx === -1 ? autoCapLevelIndexRef.current : -1;
      hlsInstanceRef.current.nextLevel = levelIdx;
      if (levelIdx === -1) {
        showToast('ความละเอียด : Auto (ปรับตามเน็ต)');
        try { localStorage.removeItem('tubelock_quality_height'); } catch (_) { }
      } else {
        const selected = levels.find((l) => l.index === levelIdx);
        if (selected) {
          setActiveLevelLabel(selected.label);
          setIsCurrentLevelHdr(Boolean(selected.isHdr));
          onHdrStateChange?.(Boolean(selected.isHdr));
          showToast(`ความละเอียด : ${selected.label}`);
          // ✨ Persist: เก็บ height ไว้ใน localStorage → คลิปต่อไปจะเริ่มที่ quality นี้เลย
          try { localStorage.setItem('tubelock_quality_height', String(selected.height)); } catch (_) { }
        }
      }
    }
    setShowSettingsMenu(false);
    resetControlsTimer();
  };

  const replayVideo = useCallback(() => {
    const current = video.current;
    if (!current) return;
    current.currentTime = 0;
    isEndedRef.current = false;
    setIsEnded(false);
    setIsMobileEndScreenDismissed(false);
    isUserPausedRef.current = false;
    restoreAudioAfterTransition();
    if (fadeBlackOverlayRef.current) {
      fadeBlackOverlayRef.current.style.transition = 'opacity 300ms ease-out';
      fadeBlackOverlayRef.current.style.opacity = '0';
    }
    current.play()
      .then(() => setIsPlaying(true))
      .catch(() => setIsPlaying(false));
    resetControlsTimer();
  }, [resetControlsTimer, restoreAudioAfterTransition]);

  const nextPlaylistVideoId = playlistNextVideo?.id;
  const prevPlaylistVideoId = playlistPrevVideo?.id;
  const selectPlaylistNext = useCallback(() => {
    if (String(nextPlaylistVideoId) === String(videoId)) replayVideo();
    else onPlayNext?.();
  }, [nextPlaylistVideoId, videoId, replayVideo, onPlayNext]);
  const selectPlaylistPrev = useCallback(() => {
    if (String(prevPlaylistVideoId) === String(videoId)) replayVideo();
    else onPlayPrev?.();
  }, [prevPlaylistVideoId, videoId, replayVideo, onPlayPrev]);
  const playPlaylistNext = playlistActive && playlistNextVideo && onPlayNext ? selectPlaylistNext : null;
  const playPlaylistPrev = playlistActive && playlistPrevVideo && onPlayPrev ? selectPlaylistPrev : null;

  // Instant Play/Pause
  const togglePlay = useCallback(() => {
    if (!video.current) return;

    if (video.current.ended || isEnded || isEndedRef.current) {
      replayVideo();
      return;
    }

    if (video.current.paused) {
      isUserPausedRef.current = false;
      restoreAudioAfterTransition();
      video.current.play()
        .then(() => {
          setIsPlaying(true);
        })
        .catch(() => setIsPlaying(false));
    } else {
      isUserPausedRef.current = true;
      video.current.pause();
      setIsPlaying(false);
    }
    resetControlsTimer();
  }, [video, isEnded, replayVideo, resetControlsTimer, restoreAudioAfterTransition]);

  useEffect(() => {
    if (togglePlayRef) {
      togglePlayRef.current = togglePlay;
    }
  }, [togglePlayRef, togglePlay]);

  // Volume Handlers
  const handleVolumeChange = (e) => {
    const val = parseFloat(e.target.value);
    volumeRef.current = val;
    setVolume(val);
    isUserMutedRef.current = val === 0;
    isTransitioningStreamRef.current = false;
    if (isHiResActiveRef.current && hiResAudioRef.current) {
      if (video.current) video.current.muted = true;
      hiResAudioRef.current.volume = val;
      hiResAudioRef.current.muted = val === 0;
      setIsMuted(val === 0);
    } else if (video.current) {
      video.current.volume = val;
      video.current.muted = val === 0;
      setIsMuted(val === 0);
    }
    showToast(`ระดับเสียง: ${Math.round(val * 100)}%`);
  };

  const toggleMute = useCallback(() => {
    if (!video.current) return;
    const nextMuted = !isMuted;
    isUserMutedRef.current = nextMuted;
    isTransitioningStreamRef.current = false;
    const targetVol = nextMuted ? 0 : (volumeRef.current > 0 ? volumeRef.current : 0.5);
    if (!nextMuted && volume === 0) {
      volumeRef.current = 0.5;
      setVolume(0.5);
    }
    if (isHiResActiveRef.current && hiResAudioRef.current) {
      video.current.muted = true;
      hiResAudioRef.current.volume = targetVol;
      hiResAudioRef.current.muted = nextMuted;
    } else {
      video.current.volume = targetVol;
      video.current.muted = nextMuted;
    }
    setIsMuted(nextMuted);
    showToast(nextMuted ? 'ปิดเสียง' : `ระดับเสียง: ${Math.round(targetVol * 100)}%`);
    resetControlsTimer();
  }, [isMuted, resetControlsTimer, showToast, video, volume]);

  const handleSelectAudioMode = useCallback((mode) => {
    const nextPrefer = mode === 'hires';
    if (nextPrefer) {
      hiResFailedUrlRef.current = null;
    }
    setPreferHiResAudio(nextPrefer);
    try {
      localStorage.setItem('tubelock_prefer_hires', nextPrefer ? '1' : '0');
    } catch (_) { }
    if (nextPrefer && hiResAudio) {
      const rateKhz = (hiResAudio.sampleRate / 1000).toFixed(hiResAudio.sampleRate % 1000 === 0 ? 0 : 1);
      const fmtLabel = hiResAudio.format === 'flac' ? 'FLAC' : 'PCM WAV';
      showToast(`🎧 เปิดเสียง Hi-Res Lossless (${hiResAudio.bits}-bit / ${rateKhz} kHz ${fmtLabel})`);
    } else {
      showToast('สลับเป็นเสียงมาตรฐาน (AAC)');
    }
    resetControlsTimer();
  }, [hiResAudio, showToast, resetControlsTimer]);

  // Synced Hi-Res Full WAV / FLAC <audio> Engine (keeps <video> muted & drift-locked <= 120ms)
  useEffect(() => {
    const v = video.current;
    const a = hiResAudioRef.current;
    if (!v || !a) return;

    const hiResUrl = hiResAudio?.url || '';
    if (!isHiResActive || !hiResUrl || isSwitchingVideo) {
      try {
        a.pause();
        if (a.getAttribute('src')) {
          a.removeAttribute('src');
          a.load();
        }
      } catch (_) { }
      setHiResStatus('idle');
      if (!isSwitchingVideo && !isTransitioningStreamRef.current) {
        const targetMuted = isUserMutedRef.current;
        const targetVol = targetMuted ? 0 : (volumeRef.current > 0 ? volumeRef.current : (defaultVolume || 0.8));
        try {
          v.muted = targetMuted;
          v.volume = targetVol;
        } catch (_) { }
      }
      return;
    }

    let cancelled = false;
    setHiResStatus('loading');

    const applyAudioLevels = () => {
      const targetMuted = isUserMutedRef.current;
      const targetVol = targetMuted ? 0 : (volumeRef.current > 0 ? volumeRef.current : (defaultVolume || 0.8));
      try {
        v.muted = true;
        a.muted = targetMuted;
        a.volume = targetVol;
        a.playbackRate = v.playbackRate || 1;
        a.loop = Boolean(v.loop);
      } catch (_) { }
    };

    const syncPlayState = (forceSeek = false) => {
      if (cancelled) return;
      applyAudioLevels();
      const targetTime = Number.isFinite(v.currentTime) ? v.currentTime : 0;
      if (forceSeek || Math.abs((a.currentTime || 0) - targetTime) > 0.12) {
        try {
          if (a.readyState >= 1) {
            a.currentTime = targetTime;
          }
        } catch (_) { }
      }
      if (!v.paused && !v.ended && isActiveRef.current) {
        if (a.paused) {
          a.play().catch((err) => {
            if (err?.name === 'NotAllowedError') {
              isUserMutedRef.current = true;
              a.muted = true;
              setIsMuted(true);
              a.play().catch(() => { });
            }
          });
        }
      } else if (!a.paused) {
        a.pause();
      }
    };

    if (a.src !== hiResUrl) {
      a.src = hiResUrl;
      a.load();
    }
    applyAudioLevels();

    const onVideoPlay = () => syncPlayState(true);
    const onVideoPlaying = () => syncPlayState(false);
    const onVideoPause = () => { try { a.pause(); } catch (_) { } };
    const onVideoWaiting = () => { try { a.pause(); } catch (_) { } };
    const onVideoSeek = () => {
      try {
        if (a.readyState >= 1 && Number.isFinite(v.currentTime)) {
          a.currentTime = v.currentTime;
        }
      } catch (_) { }
    };
    const onVideoRateChange = () => {
      try { a.playbackRate = v.playbackRate || 1; } catch (_) { }
    };

    const onAudioLoadedMetadata = () => {
      if (cancelled) return;
      syncPlayState(true);
    };
    const onAudioCanPlay = () => {
      if (cancelled) return;
      setHiResStatus('ready');
      syncPlayState(false);
    };
    const onAudioWaiting = () => {
      if (!cancelled) setHiResStatus('loading');
    };
    const onAudioPlaying = () => {
      if (!cancelled) setHiResStatus('ready');
    };
    const onAudioError = () => {
      if (cancelled) return;
      hiResFailedUrlRef.current = hiResUrl;
      setHiResStatus('error');
      setPreferHiResAudio(false);
      try {
        a.pause();
        const targetMuted = isUserMutedRef.current;
        const targetVol = targetMuted ? 0 : (volumeRef.current > 0 ? volumeRef.current : (defaultVolume || 0.8));
        v.muted = targetMuted;
        v.volume = targetVol;
      } catch (_) { }
      showToast('ไม่สามารถโหลดเสียง Hi-Res ได้ สลับกลับเป็น AAC อัตโนมัติ');
    };

    v.addEventListener('play', onVideoPlay);
    v.addEventListener('playing', onVideoPlaying);
    v.addEventListener('pause', onVideoPause);
    v.addEventListener('waiting', onVideoWaiting);
    v.addEventListener('ended', onVideoPause);
    v.addEventListener('seeking', onVideoSeek);
    v.addEventListener('seeked', onVideoSeek);
    v.addEventListener('ratechange', onVideoRateChange);

    a.addEventListener('loadedmetadata', onAudioLoadedMetadata);
    a.addEventListener('canplay', onAudioCanPlay);
    a.addEventListener('waiting', onAudioWaiting);
    a.addEventListener('playing', onAudioPlaying);
    a.addEventListener('error', onAudioError);

    const driftInterval = setInterval(() => {
      if (cancelled || v.paused || v.ended || a.readyState < 2) return;
      if (!v.muted) v.muted = true;
      const drift = (a.currentTime || 0) - (v.currentTime || 0);
      if (Math.abs(drift) > 0.12) {
        try {
          a.currentTime = v.currentTime;
        } catch (_) { }
      }
      if (a.paused && isActiveRef.current) {
        a.play().catch(() => { });
      }
    }, 250);

    if (a.readyState >= 2) {
      setHiResStatus('ready');
      syncPlayState(true);
    }

    return () => {
      cancelled = true;
      clearInterval(driftInterval);
      v.removeEventListener('play', onVideoPlay);
      v.removeEventListener('playing', onVideoPlaying);
      v.removeEventListener('pause', onVideoPause);
      v.removeEventListener('waiting', onVideoWaiting);
      v.removeEventListener('ended', onVideoPause);
      v.removeEventListener('seeking', onVideoSeek);
      v.removeEventListener('seeked', onVideoSeek);
      v.removeEventListener('ratechange', onVideoRateChange);
      a.removeEventListener('loadedmetadata', onAudioLoadedMetadata);
      a.removeEventListener('canplay', onAudioCanPlay);
      a.removeEventListener('waiting', onAudioWaiting);
      a.removeEventListener('playing', onAudioPlaying);
      a.removeEventListener('error', onAudioError);
      try { a.pause(); } catch (_) { }
    };
  }, [isHiResActive, hiResAudio?.url, isSwitchingVideo, defaultVolume, video, showToast]);

  // 1. วาง updateStoryboardThumbnail ไว้ก่อน (ข้างบน)
  const loadScrubSheet = useCallback(function loadSheet(url, priority = 'high', retry = true) {
    const sheets = scrubSheetImagesRef.current;
    const existing = sheets.get(url);
    if (existing) {
      if (priority === 'high') existing.image.fetchPriority = priority;
      return existing;
    }

    const image = new Image();
    const sheet = { image, ready: false };
    sheets.set(url, sheet);
    image.fetchPriority = priority;
    image.src = url;
    image.decode().then(() => {
      if (sheets !== scrubSheetImagesRef.current) return;
      sheet.ready = true;
      const pending = pendingScrubFrameRef.current;
      if (pending?.url === url && scrubThumbSdRef.current) {
        Object.assign(scrubThumbSdRef.current.style, pending.style);
      }
    }).catch(() => {
      if (sheets !== scrubSheetImagesRef.current) return;
      if (retry && pendingScrubFrameRef.current?.url === url) {
        setTimeout(() => {
          if (sheets !== scrubSheetImagesRef.current || pendingScrubFrameRef.current?.url !== url) return;
          sheets.delete(url);
          loadSheet(url, 'high', false);
        }, 300);
      } else if (priority === 'low') {
        sheets.delete(url);
      }
    });
    return sheet;
  }, []);

  useEffect(() => {
    if (!keepScrubPreviewOnLoad) return;

    const sdCues = storyboard?.cuesSD || storyboard?.cues || [];
    const sdSheets = sdCues.length
      ? sdCues.map(({ url }) => url)
      : Object.entries(storyboard?.spriteMap || {})
        .filter(([name]) => /^sprite_(?:sd_)?\d+\./i.test(name))
        .map(([, url]) => url);
    for (const url of [...new Set(sdSheets.filter((url) => /^https?:\/\//i.test(url)))].slice(0, 8)) {
      loadScrubSheet(url, 'low');
    }

    const thumbnail = scrubThumbSdRef.current;
    return () => {
      scrubSheetImagesRef.current = new Map();
      pendingScrubFrameRef.current = null;
      if (thumbnail) {
        thumbnail.style.backgroundImage = '';
        thumbnail.style.opacity = '0';
      }
    };
  }, [keepScrubPreviewOnLoad, loadScrubSheet, storyboard, videoId]);

  // Two-Tier YouTube-Style Sprite Sheet Thumbnail Lookup (Direct DOM)
  const updateStoryboardThumbnail = useCallback((targetSec) => {
    const elSd = scrubThumbSdRef.current;
    const elHd = scrubThumbHdRef.current;
    if (!elSd) return;
    if (keepScrubPreviewOnLoad) pendingScrubFrameRef.current = null;

    const safeSec = Math.max(0, targetSec || 0);
    const cuesSD = storyboard?.cuesSD || storyboard?.cues || [];
    const spriteMap = storyboard?.spriteMap || {};

    let resolvedUrl = null;
    let col = 0;
    let row = 0;
    let cols = 10;
    let rows = 10;

    // 1. WebVTT Cue Matching (Exact second matching: start <= targetSec < end)
    if (cuesSD.length > 0) {
      let cue = cuesSD.find((c) => safeSec >= c.start && safeSec < c.end);
      if (!cue) {
        const interval = storyboard?.interval || 5;
        const estIdx = Math.min(cuesSD.length - 1, Math.max(0, Math.floor(safeSec / interval)));
        cue = cuesSD[estIdx] || cuesSD[0];
      }

      if (cue) {
        resolvedUrl = cue.url;
        col = cue.col ?? 0;
        row = cue.row ?? 0;
        cols = cue.cols || 10;
      }
    }

    // 2. Direct Math Fallback (if no cue or cue URL is unresolved)
    if (!resolvedUrl || !resolvedUrl.startsWith('http')) {
      const INTERVAL = storyboard?.interval || 5;
      const frameIndex = Math.floor(safeSec / INTERVAL);
      const sheetIndex = Math.floor(frameIndex / 100) + 1; // 100 tiles per sheet (10x10)
      const indexInSheet = frameIndex % 100;
      col = indexInSheet % 10;
      row = Math.floor(indexInSheet / 10);
      cols = 10;
      rows = 10;

      const sheetPadded = String(sheetIndex).padStart(3, '0');
      const sheetKeyStd = `sprite_${sheetPadded}.jpg`;
      const sheetKeySD = `sprite_sd_${sheetPadded}.jpg`;
      const sheetKeyHD = `sprite_hd_${sheetPadded}.jpg`;

      resolvedUrl = spriteMap[sheetKeySD] || spriteMap[sheetKeyStd] || spriteMap[sheetKeyHD]
        || spriteMap[sheetPadded] || spriteMap[String(sheetIndex)]
        || (keepScrubPreviewOnLoad ? null : `/streams/${videoId}/thumbnails/sprite_${sheetPadded}.jpg`);
    }

    if (resolvedUrl) {
      const posX = cols > 1 ? (col / (cols - 1)) * 100 : 0;
      const posY = rows > 1 ? (row / (rows - 1)) * 100 : 0;

      const style = {
        backgroundImage: `url("${resolvedUrl}")`,
        backgroundPosition: `${posX}% ${posY}%`,
        backgroundSize: `${cols * 100}% ${rows * 100}%`,
        opacity: '1',
      };
      if (!keepScrubPreviewOnLoad) {
        Object.assign(elSd.style, style);
      } else if (/^https?:\/\//i.test(resolvedUrl)) {
        pendingScrubFrameRef.current = { url: resolvedUrl, style };
        if (loadScrubSheet(resolvedUrl).ready) Object.assign(elSd.style, style);
      }
    }

    // Tier 2: Sharp HD Preview (Crossfades when hovering > 300ms)
    if (hdDwellTimerRef.current) {
      clearTimeout(hdDwellTimerRef.current);
      hdDwellTimerRef.current = null;
    }

    const cuesHD = storyboard?.cuesHD || [];
    if (cuesHD.length > 0 && elHd) {
      elHd.style.opacity = '0';

      hdDwellTimerRef.current = setTimeout(() => {
        let hdCue = cuesHD.find((c) => safeSec >= c.start && safeSec < c.end);
        if (!hdCue) {
          const interval = storyboard?.interval || 5;
          const estIdx = Math.min(cuesHD.length - 1, Math.max(0, Math.floor(safeSec / interval)));
          hdCue = cuesHD[estIdx];
        }

        if (hdCue && scrubThumbHdRef.current) {
          const hdCol = hdCue.col ?? 0;
          const hdRow = hdCue.row ?? 0;
          const hdCols = hdCue.cols || 5;
          const posX = hdCols > 1 ? (hdCol / (hdCols - 1)) * 100 : 0;
          const posY = hdCols > 1 ? (hdRow / (hdCols - 1)) * 100 : 0;

          scrubThumbHdRef.current.style.backgroundImage = `url("${hdCue.url}")`;
          scrubThumbHdRef.current.style.backgroundPosition = `${posX}% ${posY}%`;
          scrubThumbHdRef.current.style.backgroundSize = `${hdCols * 100}% ${hdCols * 100}%`;
          scrubThumbHdRef.current.style.opacity = '1';
        }
      }, 300);
    }
  }, [storyboard, videoId, keepScrubPreviewOnLoad, loadScrubSheet]);

  useEffect(() => {
    if (!keepScrubPreviewOnLoad || !storyboard || (!isHoveringSeek && !isScrubbing)) return;
    const previewPosition = isScrubbing
      ? latestScrubTimeRef.current ?? lastHoverTimeRef.current
      : lastHoverTimeRef.current;
    updateStoryboardThumbnail(previewPosition);
  }, [keepScrubPreviewOnLoad, storyboard, isHoveringSeek, isScrubbing, updateStoryboardThumbnail]);

  // 2. แล้วค่อยตามด้วย commitSeek (อยู่ข้างล่าง)
  // Fast Seek Commit (Direct currentTime assignment with instant DOM sync)
  const commitSeek = useCallback((targetTime) => {
    if (!video.current) return;
    const dur = video.current.duration || duration;
    if (dur <= 0 || targetTime === null || targetTime === undefined || isNaN(targetTime)) return;
    const clamped = Math.min(Math.max(Number(targetTime), 0), dur);

    // Optimistic UI: ล็อคค่าเวลาที่ผู้ใช้กดไว้ทันที
    isSeekingRef.current = true;
    setIsSeeking(true);
    seekTimeRef.current = clamped;
    lastReportedSecondRef.current = Math.floor(clamped);

    if (seekCooldownTimerRef.current) {
      clearTimeout(seekCooldownTimerRef.current);
    }
    seekCooldownTimerRef.current = setTimeout(() => {
      isSeekingRef.current = false;
      setIsSeeking(false);
      seekCooldownTimerRef.current = null;
    }, 1500);

    try {
      video.current.currentTime = clamped;
    } catch (_) { }

    const pct = (clamped / dur) * 100;
    if (progressBarRef.current) progressBarRef.current.style.width = `${pct}%`;
    if (scrubberKnobRef.current) scrubberKnobRef.current.style.left = `${pct}%`;
    if (timeDisplayRef.current) {
      timeDisplayRef.current.textContent = formatTimePair(clamped, dur);
    }
    if (scrubBadgeRef.current) {
      scrubBadgeRef.current.textContent = formatTime(clamped);
    }
    if (seekTrackRef.current && scrubPreviewRef.current) {
      const rect = seekTrackRef.current.getBoundingClientRect();
      if (rect && rect.width > 0) {
        const offsetX = (clamped / dur) * rect.width;
        scrubPreviewRef.current.style.left = `${getClampedPreviewPercent(offsetX, rect)}%`;
      } else {
        scrubPreviewRef.current.style.left = `${pct}%`;
      }
    }
    updateStoryboardThumbnail(clamped); // เรียกใช้ได้แล้ว เพราะประกาศไว้ด้านบนแล้ว
    pendingTargetTimeRef.current = null;
  }, [duration, video, updateStoryboardThumbnail]);

  // Scrubbing calculation
  // Clamps preview thumbnail position so it never overflows left/right of video player boundary
  const getClampedPreviewPercent = (offsetX, trackRect) => {
    if (!trackRect || trackRect.width <= 0) return 50;
    const previewEl = scrubPreviewRef.current;
    const playerEl = containerRef.current;

    // Measure preview half-width (default ~140px if not yet rendered)
    const halfWidth = previewEl && previewEl.offsetWidth > 0 ? previewEl.offsetWidth / 2 : 140;

    const playerRect = playerEl ? playerEl.getBoundingClientRect() : null;
    const leftMargin = playerRect ? Math.max(0, trackRect.left - playerRect.left) : 24;
    const rightMargin = playerRect ? Math.max(0, playerRect.right - trackRect.right) : 24;
    const edgePadding = 8; // 8px safety margin inside player bounds

    const minX = Math.max(0, halfWidth - leftMargin + edgePadding);
    const maxX = Math.min(trackRect.width, trackRect.width + rightMargin - halfWidth - edgePadding);

    if (minX >= maxX) {
      return (offsetX / trackRect.width) * 100;
    }

    const clampedX = Math.max(minX, Math.min(offsetX, maxX));
    return (clampedX / trackRect.width) * 100;
  };

  // Scrubbing calculation
  const calculateScrubPosition = (clientX) => {
    if (typeof clientX !== 'number' || isNaN(clientX)) return;
    const realDur = video.current?.duration || duration;
    if (!seekTrackRef.current || realDur <= 0) return;
    const rect = seekTrackRef.current.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const offsetX = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const percent = (offsetX / rect.width) * 100;
    const calculatedSec = (offsetX / rect.width) * realDur;
    const clampedPercent = getClampedPreviewPercent(offsetX, rect);

    latestScrubTimeRef.current = calculatedSec;

    // Zero-lag direct DOM updates (0 React re-renders during drag/scrub!)
    if (scrubPreviewRef.current) {
      scrubPreviewRef.current.style.left = `${clampedPercent}%`;
    }
    if (scrubBadgeRef.current) {
      scrubBadgeRef.current.textContent = formatTime(calculatedSec);
    }
    if (hoverBarRef.current) hoverBarRef.current.style.width = `${percent}%`;
    if (progressBarRef.current) progressBarRef.current.style.width = `${percent}%`;
    if (scrubberKnobRef.current) scrubberKnobRef.current.style.left = `${percent}%`;
    if (timeDisplayRef.current) timeDisplayRef.current.textContent = formatTimePair(calculatedSec, realDur);

    lastHoverTimeRef.current = calculatedSec;
    lastHoverPercentRef.current = clampedPercent;
    updateStoryboardThumbnail(calculatedSec);
  };

  const handleSeekMouseMove = (e) => {
    const realDur = video.current?.duration || duration;
    if (!seekTrackRef.current || realDur <= 0) return;
    if (!isScrubbingRef.current && (!isHoveringSeek || showSettingsMenu)) return;
    const rect = seekTrackRef.current.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const offsetX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const pct = (offsetX / rect.width) * 100;
    const time = (offsetX / rect.width) * realDur;
    const clampedPct = getClampedPreviewPercent(offsetX, rect);

    // Zero-lag direct DOM updates on hover (0 React re-renders per mousemove!)
    if (scrubPreviewRef.current) {
      scrubPreviewRef.current.style.left = `${clampedPct}%`;
    }
    if (scrubBadgeRef.current) {
      scrubBadgeRef.current.textContent = formatTime(time);
    }
    if (hoverBarRef.current) {
      hoverBarRef.current.style.width = `${pct}%`;
    }

    lastHoverTimeRef.current = time;       // เก็บค้างไว้ใน ref เพื่อ fallback ตอน fade-out
    lastHoverPercentRef.current = clampedPct;
    updateStoryboardThumbnail(time);
    if (isScrubbingRef.current) {
      calculateScrubPosition(e.clientX);
    }
  };

  const handlePointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (showSettingsMenu) setShowSettingsMenu(false);
    if (contextMenu) setContextMenu(null);
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (_) { }

    if (hdDwellTimerRef.current) {
      clearTimeout(hdDwellTimerRef.current);
      hdDwellTimerRef.current = null;
    }
    if (scrubThumbHdRef.current) {
      scrubThumbHdRef.current.style.opacity = '0';
    }

    isScrubbingRef.current = true;
    setIsScrubbing(true);
    calculateScrubPosition(e.clientX);
  };

  const handlePointerUp = (e) => {
    e.stopPropagation?.();
    try {
      if (e?.currentTarget?.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch (_) { }
    if (!isScrubbingRef.current) return;
    isScrubbingRef.current = false;
    setIsScrubbing(false);
    // setIsHoveringSeek(false);

    // const isTouch = e.pointerType === 'touch' || isMobileView;
    // if (isTouch) {
    //   setIsHoveringSeek(false);
    //   if (scrubPreviewRef.current) {
    //     scrubPreviewRef.current.style.opacity = '0';
    //   }
    // }

    let targetSec = latestScrubTimeRef.current;
    if (targetSec === null && typeof e?.clientX === 'number' && !isNaN(e.clientX) && seekTrackRef.current) {
      const realDur = video.current?.duration || duration;
      const rect = seekTrackRef.current.getBoundingClientRect();
      if (rect && rect.width > 0 && realDur > 0) {
        const offsetX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        targetSec = (offsetX / rect.width) * realDur;
      }
    }
    latestScrubTimeRef.current = null;

    if (targetSec !== null && targetSec !== undefined && !isNaN(targetSec)) {
      commitSeek(targetSec);
    }
    resetControlsTimer();
  };

  // YouTube Standard Click / Double-Click Interaction:
  // - 0% - 35% (Left): Double Click/Tap = Seek -10s with left animated ripple
  // - 65% - 100% (Right): Double Click/Tap = Seek +10s with right animated ripple
  // - 35% - 65% (Center): Double Click/Tap = Toggle Fullscreen
  // - Single Click anywhere: Toggles Play/Pause (debounced by ~220ms to completely eliminate pause stutter during double-click)
  const handlePlayerOverlayClick = (e) => {
    if (contextMenu) {
      setContextMenu(null);
      return;
    }
    if (showSettingsMenu) {
      setShowSettingsMenu(false);
      return;
    }
    if (!containerRef.current) return;

    if (isEnded && !isMobileView) {
      togglePlay();
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    const xRatio = (e.clientX - rect.left) / rect.width;
    const zone = xRatio < 0.35 ? 'left' : xRatio > 0.65 ? 'right' : 'center';
    const now = e.timeStamp;

    // On Mobile, center zone has NO double-tap fullscreen — toggle controls instantaneously (0ms)!
    if (isMobileView && zone === 'center') {
      if (singleClickTimerRef.current) {
        clearTimeout(singleClickTimerRef.current);
        singleClickTimerRef.current = null;
      }
      clickStateRef.current = { time: 0, zone: null };
      if (showControlsRef.current) {
        showControlsRef.current = false;
        setShowControls(false);
        if (controlsTimeoutRef.current) {
          clearTimeout(controlsTimeoutRef.current);
          controlsTimeoutRef.current = null;
        }
      } else {
        resetControlsTimer(4500);
      }
      return;
    }

    const prev = clickStateRef.current;
    const isDouble = (e.detail >= 2) || ((now - prev.time < 340) && (prev.zone === zone || (zone === 'center' && prev.zone === 'center')));

    if (isDouble) {
      // Cancel pending single click immediately! (Play/Pause will NEVER be triggered)
      if (singleClickTimerRef.current) {
        clearTimeout(singleClickTimerRef.current);
        singleClickTimerRef.current = null;
      }
      clickStateRef.current = { time: 0, zone: null };

      if (zone === 'left') {
        const currentTime = pendingTargetTimeRef.current !== null
          ? pendingTargetTimeRef.current
          : (video.current?.currentTime || 0);
        const target = Math.max(0, currentTime - seekStep);
        pendingTargetTimeRef.current = target;
        commitSeek(target);

        setAccumulatedSeconds((prevSec) => (prevSec <= 0 ? prevSec - seekStep : -seekStep));
        setDoubleTapSide('left');

        if (doubleTapClearTimerRef.current) clearTimeout(doubleTapClearTimerRef.current);
        doubleTapClearTimerRef.current = setTimeout(() => {
          setDoubleTapSide(null);
          setAccumulatedSeconds(0);
          pendingTargetTimeRef.current = null;
        }, 650);

        showToast(`-${seekStep} วินาที`);
        resetControlsTimer(4500);
      } else if (zone === 'right') {
        const currentTime = pendingTargetTimeRef.current !== null
          ? pendingTargetTimeRef.current
          : (video.current?.currentTime || 0);
        const target = Math.min(duration, currentTime + seekStep);
        pendingTargetTimeRef.current = target;
        commitSeek(target);

        setAccumulatedSeconds((prevSec) => (prevSec >= 0 ? prevSec + seekStep : seekStep));
        setDoubleTapSide('right');

        if (doubleTapClearTimerRef.current) clearTimeout(doubleTapClearTimerRef.current);
        doubleTapClearTimerRef.current = setTimeout(() => {
          setDoubleTapSide(null);
          setAccumulatedSeconds(0);
          pendingTargetTimeRef.current = null;
        }, 650);

        showToast(`+${seekStep} วินาที`);
        resetControlsTimer(4500);
      } else {
        toggleFullscreen();
      }
      return;
    }

    // First click: cancel any previous timeout, record state, and debounce by ~240ms
    if (singleClickTimerRef.current) {
      clearTimeout(singleClickTimerRef.current);
      singleClickTimerRef.current = null;
    }
    clickStateRef.current = { time: now, zone };

    singleClickTimerRef.current = setTimeout(() => {
      // On mobile touch view: single tap reliably reveals or hides YouTube overlay controls!
      // On PC (both windowed & fullscreen): clicking video directly toggles Play/Pause!
      if (isMobileView) {
        if (showControlsRef.current) {
          showControlsRef.current = false;
          setShowControls(false);
          if (controlsTimeoutRef.current) {
            clearTimeout(controlsTimeoutRef.current);
            controlsTimeoutRef.current = null;
          }
        } else {
          resetControlsTimer(4500);
        }
      } else {
        togglePlay();
      }
      singleClickTimerRef.current = null;
      clickStateRef.current = { time: 0, zone: null };
    }, 240);
  };

  // YouTube-Style Right-Click Context Menu
  const handleContextMenu = (e) => {
    e.preventDefault();
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.min(e.clientX - rect.left, rect.width - 250);
    const y = Math.min(e.clientY - rect.top, rect.height - 200);
    setContextMenu({ x: Math.max(10, x), y: Math.max(10, y) });
  };

  // Fullscreen & PiP with Mobile Orientation Auto-Lock
  const toggleFullscreen = useCallback(async () => {
    if (!containerRef.current) return;
    const isFull = !!(document.fullscreenElement || document.webkitFullscreenElement);

    if (!isFull) {
      try {
        if (containerRef.current.requestFullscreen) {
          await containerRef.current.requestFullscreen();
        } else if (containerRef.current.webkitRequestFullscreen) {
          await containerRef.current.webkitRequestFullscreen();
        } else if (video.current?.webkitEnterFullscreen) {
          video.current.webkitEnterFullscreen();
          return;
        }
        setIsFullscreen(true);

        // 📱 Auto orientation lock:
        // Horizontal video -> lock to landscape (หมุนนอนอัตโนมัติ)
        // Vertical video (Shorts / 9:16 / Reels) -> lock to portrait (แนวตั้งตามวิดีโอ ไม่ต้องนอน)
        if (typeof window !== 'undefined' && window.screen?.orientation?.lock) {
          try {
            const vEl = video.current;
            // The loaded stream takes precedence over the catalog's orientation hint.
            const hasVideoSize = vEl?.videoWidth > 0 && vEl?.videoHeight > 0;
            const isPortrait = hasVideoSize
              ? vEl.videoHeight > vEl.videoWidth
              : videoRatio < 1;
            const target = isPortrait ? 'portrait' : 'landscape';
            try {
              await window.screen.orientation.lock(target);
            } catch (firstError) {
              // Some Android browsers apply fullscreen before accepting the orientation lock.
              await new Promise((resolve) => requestAnimationFrame(resolve));
              const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
              if (!fullscreenElement || fullscreenElement !== containerRef.current) throw firstError;
              await window.screen.orientation.lock(target);
            }
          } catch (orientErr) {
            console.log('Orientation lock notice:', orientErr);
          }
        }
      } catch (err) {
        console.warn('Fullscreen error:', err);
      }
    } else {
      try {
        // 📱 Auto orientation return: Rotate mobile back to portrait when exiting fullscreen!
        if (typeof window !== 'undefined' && window.screen?.orientation?.lock) {
          try {
            await window.screen.orientation.lock('portrait');
          } catch (orientErr) {
            console.log('Orientation portrait lock notice:', orientErr);
          }
        }

        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          await document.webkitExitFullscreen();
        } else if (video.current?.webkitExitFullscreen) {
          video.current.webkitExitFullscreen();
        }
        setIsFullscreen(false);

        // Browser tabs can follow the device again after leaving fullscreen.
        if (typeof window !== 'undefined' && window.screen?.orientation?.unlock) {
          setTimeout(() => {
            if (document.fullscreenElement || document.webkitFullscreenElement) return;
            try {
              unlockBrowserOrientation();
            } catch (_) { }
          }, 600);
        }
      } catch (err) {
        console.warn('Exit fullscreen error:', err);
      }
    }
    resetControlsTimer();
  }, [resetControlsTimer, video, videoRatio]);

  const togglePiP = useCallback(async () => {
    const v = video.current;
    if (!v) return;
    try {
      // Standard Picture-in-Picture API (Android Chrome/Edge/Samsung PWA & Desktop)
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        showToast('ออกจากโหมดหน้าต่างลอย (PiP)');
        return;
      }
      if (document.pictureInPictureEnabled && typeof v.requestPictureInPicture === 'function') {
        await v.requestPictureInPicture();
        showToast('เล่นแบบหน้าต่างลอย (PiP)');
        return;
      }
      // iOS Safari / iPadOS PWA WebKit Presentation Mode PiP
      if (
        typeof v.webkitSetPresentationMode === 'function' &&
        v.webkitSupportsPresentationMode?.('picture-in-picture')
      ) {
        const nextMode = v.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture';
        v.webkitSetPresentationMode(nextMode);
        showToast(nextMode === 'picture-in-picture' ? 'เล่นแบบหน้าต่างลอย (PiP)' : 'ออกจากโหมดหน้าต่างลอย (PiP)');
        return;
      }
      showToast('เบราว์เซอร์ไม่รองรับ PiP');
    } catch (err) {
      console.warn('PiP error:', err);
    }
  }, [showToast, video]);

  // Mobile-Only PWA Auto Picture-in-Picture when leaving the app to use other apps
  useEffect(() => {
    const v = video.current;
    if (!v) return;

    // Enable Chrome Auto-PiP property on Mobile only
    try {
      if ('autoPictureInPicture' in v) {
        v.autoPictureInPicture = Boolean(isMobileView && isActive);
      }
    } catch (_) { }

    if (!isMobileView || !isActive) return;

    // Register MediaSession `enterpictureinpicture` handler (Chrome 120+ / Android PWA Auto-PiP)
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : null;
    if (ms?.setActionHandler) {
      try {
        ms.setActionHandler('enterpictureinpicture', () => {
          const el = video.current;
          if (!el || el.paused || el.ended || document.pictureInPictureElement) return;
          if (document.pictureInPictureEnabled && typeof el.requestPictureInPicture === 'function') {
            el.requestPictureInPicture().catch(() => { });
          }
        });
      } catch (_) { }
    }

    // Best-effort auto-enter OS PiP when switching away from Mobile PWA while playing
    const handleVisibilityAutoPiP = () => {
      if (!document.hidden) return;
      const el = video.current;
      if (!el || el.paused || el.ended || el.readyState < 2 || document.pictureInPictureElement) return;
      if (document.pictureInPictureEnabled && typeof el.requestPictureInPicture === 'function') {
        el.requestPictureInPicture().catch(() => { });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityAutoPiP);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityAutoPiP);
      if (ms?.setActionHandler) {
        try {
          ms.setActionHandler('enterpictureinpicture', null);
        } catch (_) { }
      }
    };
  }, [isMobileView, isActive]);

  // 📱 Manual Screen Orientation Toggle (สั่งหมุน แนวนอน <-> แนวตั้ง ได้เองตามต้องการ)
  const toggleOrientation = useCallback(async () => {
    if (typeof window === 'undefined' || !window.screen?.orientation?.lock) {
      showToast('เบราว์เซอร์ไม่รองรับคำสั่งหมุนหน้าจอ');
      return;
    }
    try {
      const currentType = window.screen.orientation.type || '';
      const isLandscape = currentType.includes('landscape');

      if (isLandscape) {
        if (window.screen.orientation.lock) {
          await window.screen.orientation.lock('portrait');
          showToast('หมุนเป็นแนวตั้ง (Portrait)');
        }
      } else {
        // If entering landscape, entering fullscreen provides the best mobile experience
        if (!isFullscreen && containerRef.current) {
          if (containerRef.current.requestFullscreen) {
            await containerRef.current.requestFullscreen();
          } else if (containerRef.current.webkitRequestFullscreen) {
            await containerRef.current.webkitRequestFullscreen();
          }
        }
        if (window.screen.orientation.lock) {
          await window.screen.orientation.lock('landscape');
          showToast('หมุนเป็นแนวนอน (Landscape)');
        }
      }
    } catch (err) {
      console.log('Manual orientation toggle notice:', err);
      if (window.screen.orientation.unlock) {
        unlockBrowserOrientation();
      }
      showToast('หมุนหน้าจอตามการเอียงของอุปกรณ์');
    }
    resetControlsTimer();
  }, [isFullscreen, showToast, resetControlsTimer]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFull = !!(document.fullscreenElement || document.webkitFullscreenElement);
      setIsFullscreen(isFull);
      if (!isFull && typeof window !== 'undefined') {
        // When exiting fullscreen via Esc, swipe, or back button:
        // 📱 Rotate back to portrait first, then unlock sensor
        if (window.screen?.orientation?.lock) {
          window.screen.orientation.lock('portrait').catch(() => { });
        }
        if (window.screen?.orientation?.unlock) {
          setTimeout(() => {
            if (document.fullscreenElement || document.webkitFullscreenElement) return;
            try {
              unlockBrowserOrientation();
            } catch (_) { }
          }, 600);
        }
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      if (typeof window !== 'undefined' && window.screen?.orientation?.unlock) {
        try {
          unlockBrowserOrientation();
        } catch (_) { }
      }
    };
  }, []);

  // Aspect Mode Toggle
  const cycleAspectMode = () => {
    let nextMode = 'fit';
    let label = 'สัดส่วน: พอดีเฟรม (Fit)';
    if (aspectMode === 'fit') {
      nextMode = 'crop';
      label = 'สัดส่วน: ตัดขอบดำ (Crop)';
    } else if (aspectMode === 'crop') {
      nextMode = 'fill';
      label = 'สัดส่วน: ยืดเต็มจอ (Fill)';
    } else {
      nextMode = 'fit';
      label = 'สัดส่วน: พอดีเฟรม (Fit)';
    }
    setAspectMode(nextMode);
    showToast(label);
    resetControlsTimer();
  };

  // Pause parked singleton player & dismiss menus cleanly when leaving /watch; resume buffered stream upon docking
  useEffect(() => {
    let cancelled = false;
    const v = video.current;
    if (!isActive) {
      Promise.resolve().then(() => {
        if (cancelled) return;
        setShowSettingsMenu(false);
        setContextMenu(null);
      });
      if (v && (typeof document === 'undefined' || document.pictureInPictureElement !== v)) {
        isTransitioningStreamRef.current = true;
        try {
          v.muted = true;
          v.volume = 0;
          if (!v.paused) v.pause();
        } catch (_) { }
      }
    } else if (v && src && !isSwitchingVideo && !isSwitchingVideoRef.current && !isTransitioningStreamRef.current) {
      restoreAudioAfterTransition();
      if (v.readyState >= 2) {
        attemptAutoPlay();
      }
    }
    return () => {
      cancelled = true;
    };
  }, [isActive, src, isSwitchingVideo, attemptAutoPlay, restoreAudioAfterTransition]);

  // Keyboard Shortcuts (Supports all keyboard languages via physical e.code)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isActive || isMiniplayer || e.defaultPrevented) return;
      // Ignore if user is typing in an input, textarea, or contentEditable element
      if (['INPUT', 'TEXTAREA'].includes(e.target?.tagName) || e.target?.isContentEditable) return;
      // Do not hijack browser system combos (Ctrl+C, Ctrl+F, Ctrl+P, Alt+Left, etc.)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const code = e.code;
      const key = e.key?.toLowerCase();

      if (playlistActive && e.shiftKey) {
        const isNext = code === 'KeyN' || key === 'n';
        const isPrev = code === 'KeyP' || key === 'p';
        if (isNext || isPrev) {
          e.preventDefault();
          const playTrack = isNext ? playPlaylistNext : playPlaylistPrev;
          if (!e.repeat) playTrack?.();
          return;
        }
      }

      // Number jump: 0-9 (Digit0-Digit9 or Numpad0-Numpad9 works even in Thai keyboard mode)
      const digitMatch = code?.match(/^(Digit|Numpad)([0-9])$/);
      if ((digitMatch || /^[0-9]$/.test(e.key)) && duration > 0) {
        e.preventDefault();
        const num = digitMatch ? parseInt(digitMatch[2], 10) : parseInt(e.key, 10);
        const fraction = num / 10;
        commitSeek(duration * fraction);
        showToast(`กระโดดไปที่ ${fraction * 100}%`);
        return;
      }

      if (code === 'Space' || code === 'KeyK' || key === ' ' || key === 'k') {
        if ((code === 'Space' || key === ' ') && e.target?.closest?.('button, a, [role="button"]')) return;
        e.preventDefault();
        togglePlay();
      } else if (code === 'KeyF' || key === 'f') {
        e.preventDefault();
        toggleFullscreen();
      } else if (code === 'KeyM' || key === 'm') {
        e.preventDefault();
        toggleMute();
      } else if (code === 'KeyJ' || key === 'j') {
        e.preventDefault();
        commitSeek((video.current?.currentTime || 0) - 10);
        showToast('-10 วินาที');
      } else if (code === 'KeyL' || key === 'l') {
        e.preventDefault();
        commitSeek((video.current?.currentTime || 0) + 10);
        showToast('+10 วินาที');
      } else if (code === 'KeyC' || key === 'c') {
        e.preventDefault();
        if (!hasSubtitles) {
          showToast('วิดีโอนี้ยังไม่มีคำบรรยาย (CC)');
          return;
        }
        handleUserSetCcActive((prev) => {
          const next = !prev;
          showToast(next ? 'เปิดคำบรรยาย (CC)' : 'ปิดคำบรรยาย');
          return next;
        });
      } else if (code === 'KeyP' || key === 'p') {
        e.preventDefault();
        togglePiP();
      } else if (code === 'KeyI' || key === 'i') {
        if (onToggleMiniplayer) {
          e.preventDefault();
          onToggleMiniplayer();
        }
      } else if (code === 'ArrowRight' || e.key === 'ArrowRight') {
        e.preventDefault();
        commitSeek((video.current?.currentTime || 0) + seekStep);
        showToast(`+${seekStep} วินาที`);
      } else if (code === 'ArrowLeft' || e.key === 'ArrowLeft') {
        e.preventDefault();
        commitSeek((video.current?.currentTime || 0) - seekStep);
        showToast(`-${seekStep} วินาที`);
      } else if (code === 'ArrowUp' || e.key === 'ArrowUp') {
        e.preventDefault();
        const nextVol = Math.min(volume + 0.05, 1);
        volumeRef.current = nextVol;
        setVolume(nextVol);
        isUserMutedRef.current = false;
        setIsMuted(false);
        if (isHiResActiveRef.current && hiResAudioRef.current) {
          if (video.current) video.current.muted = true;
          hiResAudioRef.current.muted = false;
          hiResAudioRef.current.volume = nextVol;
        } else if (video.current) {
          video.current.muted = false;
          video.current.volume = nextVol;
        }
        showToast(`ระดับเสียง: ${Math.round(nextVol * 100)}%`);
      } else if (code === 'ArrowDown' || e.key === 'ArrowDown') {
        e.preventDefault();
        const nextVol = Math.max(volume - 0.05, 0);
        volumeRef.current = nextVol;
        setVolume(nextVol);
        isUserMutedRef.current = nextVol === 0;
        setIsMuted(nextVol === 0);
        if (isHiResActiveRef.current && hiResAudioRef.current) {
          if (video.current) video.current.muted = true;
          hiResAudioRef.current.muted = nextVol === 0;
          hiResAudioRef.current.volume = nextVol;
        } else if (video.current) {
          video.current.muted = nextVol === 0;
          video.current.volume = nextVol;
        }
        showToast(`ระดับเสียง: ${Math.round(nextVol * 100)}%`);
      } else if (code === 'Home') {
        e.preventDefault();
        commitSeek(0);
        showToast('จุดเริ่มต้น');
      } else if (code === 'End' && duration > 0) {
        e.preventDefault();
        commitSeek(duration);
        showToast('จุดสิ้นสุด');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, isMiniplayer, onToggleMiniplayer, togglePlay, commitSeek, duration, seekStep, volume, toggleMute, showToast, togglePiP, toggleFullscreen, hasSubtitles, handleUserSetCcActive, playlistActive, playPlaylistNext, playPlaylistPrev]);

  // Sync position progress & playback speed with OS media controls (Android / Lockscreen / Bluetooth)
  const syncMediaPositionState = useCallback((positionOverride = null) => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    if (typeof navigator.mediaSession.setPositionState !== 'function') return;
    const v = video.current;
    if (!v || isSwitchingVideo) return;
    const dur = Number(v.duration || duration || 0);
    const pos = Number(
      positionOverride !== null && positionOverride !== undefined
        ? positionOverride
        : (v.currentTime || 0)
    );
    const rate = Number(v.playbackRate || playbackRate || 1);
    if (Number.isFinite(dur) && dur > 0 && Number.isFinite(pos) && pos >= 0 && Number.isFinite(rate) && rate > 0) {
      try {
        navigator.mediaSession.setPositionState({
          duration: dur,
          playbackRate: rate,
          position: Math.min(pos, dur),
        });
      } catch (_) { }
    }
  }, [video, duration, playbackRate, isSwitchingVideo]);

  // Register Media Session metadata (title, artist, thumbnail artwork)
  useEffect(() => {
    if (!isActive || !videoId) return;
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') {
      return;
    }
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const docTitle = typeof document !== 'undefined' ? document.title : '';
    const resolvedTitle = normalizeMediaSessionTitle(title, docTitle);
    const resolvedArtist = (typeof channelName === 'string' && channelName.trim()) ? channelName.trim() : 'TubeLock';
    const artwork = buildMediaSessionArtwork({
      poster,
      videoId,
      videoSlug,
      origin,
      keepScrubPreviewOnLoad,
    });
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: resolvedTitle,
        artist: resolvedArtist,
        album: 'TubeLock',
        artwork,
      });
    } catch (_) { }
  }, [isActive, title, channelName, poster, videoId, videoSlug, keepScrubPreviewOnLoad]);

  // Keep OS Media Notification playbackState & timeline synced
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = (!isActive || !src || isSwitchingVideo)
        ? 'none'
        : (isPlaying && !isEnded ? 'playing' : 'paused');
    } catch (_) { }
    if (isActive) {
      syncMediaPositionState();
    }
  }, [isActive, src, isSwitchingVideo, isPlaying, isEnded, syncMediaPositionState]);

  // Bind OS notification, lockscreen, and Bluetooth media transport buttons
  useEffect(() => {
    if (!isActive || !videoId || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const safeSetHandler = (action, handler) => {
      try {
        ms.setActionHandler(action, handler);
      } catch (_) { }
    };

    safeSetHandler('play', () => {
      const v = video.current;
      if (!v) return;
      if (v.paused || v.ended || isEndedRef.current) {
        togglePlay();
      }
    });
    safeSetHandler('pause', () => {
      const v = video.current;
      if (!v || v.paused) return;
      isUserPausedRef.current = true;
      v.pause();
      setIsPlaying(false);
      syncMediaPositionState(v.currentTime);
    });
    safeSetHandler('seekbackward', (details) => {
      const v = video.current;
      if (!v) return;
      const offset = Number(details?.seekOffset) || seekStep || 10;
      const target = Math.max(0, (v.currentTime || 0) - offset);
      commitSeek(target);
      syncMediaPositionState(target);
    });
    safeSetHandler('seekforward', (details) => {
      const v = video.current;
      if (!v) return;
      const offset = Number(details?.seekOffset) || seekStep || 10;
      const maxDur = v.duration || duration || 0;
      const rawTarget = (v.currentTime || 0) + offset;
      const target = maxDur > 0 ? Math.min(maxDur, rawTarget) : rawTarget;
      commitSeek(target);
      syncMediaPositionState(target);
    });
    safeSetHandler('seekto', (details) => {
      if (!details || typeof details.seekTime !== 'number' || Number.isNaN(details.seekTime)) return;
      const maxDur = video.current?.duration || duration || 0;
      const clamped = maxDur > 0
        ? Math.min(Math.max(details.seekTime, 0), maxDur)
        : Math.max(details.seekTime, 0);
      commitSeek(clamped);
      syncMediaPositionState(clamped);
    });
    safeSetHandler('stop', () => {
      const v = video.current;
      if (!v) return;
      isUserPausedRef.current = true;
      v.pause();
      setIsPlaying(false);
    });

    return () => {
      ['play', 'pause', 'seekbackward', 'seekforward', 'seekto', 'stop'].forEach((action) => {
        safeSetHandler(action, null);
      });
      try {
        ms.playbackState = 'none';
      } catch (_) { }
    };
  }, [isActive, videoId, video, togglePlay, commitSeek, seekStep, duration, syncMediaPositionState]);

  useEffect(() => {
    if (!isActive || !playlistActive || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const mediaSession = navigator.mediaSession;
    const handlers = [['nexttrack', playPlaylistNext], ['previoustrack', playPlaylistPrev]];
    for (const [action, handler] of handlers) {
      try { mediaSession.setActionHandler(action, handler); } catch (_) { }
    }
    return () => {
      for (const [action] of handlers) {
        try { mediaSession.setActionHandler(action, null); } catch (_) { }
      }
    };
  }, [isActive, playlistActive, playPlaylistNext, playPlaylistPrev]);


  const is4K = (resolution && resolution.toString().includes('2160')) ||
    (activeLevelLabel && (activeLevelLabel.includes('4K') || activeLevelLabel.includes('2160p')));
  const isHD = is4K || (resolution && (resolution.toString().includes('1080') || resolution.toString().includes('720') || resolution.toString().includes('1440'))) ||
    (activeLevelLabel && (activeLevelLabel.includes('1080') || activeLevelLabel.includes('720') || activeLevelLabel.includes('1440')));

  // Keep DOM scrubber/timer refs synchronized immediately when bottom bar layout changes (Mobile <-> Desktop <-> Fullscreen)
  useLayoutEffect(() => {
    const v = video.current;
    const dur = isSwitchingVideo ? 0 : (v?.duration || duration || 0);
    const startSec = targetInitialTime > 0 ? targetInitialTime : 0;
    const cur = isSwitchingVideo ? 0 : (v?.currentTime ?? startSec);
    const pct = dur > 0 ? Math.min(100, Math.max(0, (cur / dur) * 100)) : 0;

    if (progressBarRef.current) progressBarRef.current.style.width = `${pct}%`;
    if (scrubberKnobRef.current) scrubberKnobRef.current.style.left = `${pct}%`;
    if (timeDisplayRef.current) {
      timeDisplayRef.current.textContent = dur > 0 ? formatTimePair(cur, dur) : '0:00 / 0:00';
    }
    if (bufferBarRef.current) {
      if (isSwitchingVideo || !v || dur <= 0) {
        bufferBarRef.current.style.width = '0%';
      } else {
        let bufPct = 0;
        const b = v.buffered;
        for (let i = 0; i < b.length; i++) {
          if (b.start(i) <= cur && cur <= b.end(i)) {
            bufPct = Math.min((b.end(i) / dur) * 100, 100);
            break;
          }
        }
        bufferBarRef.current.style.width = `${bufPct}%`;
      }
    }
  }, [isMobileView, effectiveFullscreen, isMiniplayer, isSwitchingVideo, duration, src, targetInitialTime]);

  const controlsVisible = showControls || (!isMobileView && !isPlaying);
  const upNextVideo = playlistActive ? (playPlaylistNext ? playlistNextVideo : null) : relatedVideos?.[0] ?? null;
  const showEndScreen = isActive && isEnded && !nativeLooping && !repeatPlaylistVideo && !isSwitchingVideo && !isSwitchingVersion;
  const isMobileEndPromptOpen = Boolean(
    isMobileView && showEndScreen && !isMobileEndScreenDismissed && upNextVideo
  );
  const subtitleLayout = useMemo(
    () => computeSubtitleBoxLayout({
      containerWidth: containerSize.width,
      containerHeight: containerSize.height,
      videoRatio,
      aspectMode,
      controlsVisible: controlsVisible || (isMobileView && isScrubbing),
      isMobile: isMobileView,
    }),
    [containerSize.width, containerSize.height, videoRatio, aspectMode, controlsVisible, isMobileView, isScrubbing]
  );

  const showInnerAmbientBackdrop = Boolean(
    ambientMode &&
    isActive &&
    !isMiniplayer &&
    !isSwitchingVideo &&
    !(isCurrentLevelHdr && effectiveFullscreen) &&
    aspectMode === 'fit' &&
    (effectiveFullscreen || (videoRatio && videoRatio < 0.98) || (isMobileView && isCinematic))
  );

  return (
    <div
      ref={containerRef}
      data-player-fullscreen={!isMiniplayer && effectiveFullscreen ? 'true' : undefined}
      onContextMenu={isMiniplayer ? undefined : handleContextMenu}
      onClick={() => { if (contextMenu) setContextMenu(null); }}
      onMouseMove={(e) => {
        if (isMiniplayer || isMobileView) return;
        if (e?.nativeEvent?.pointerType === 'touch') return;
        resetControlsTimer();
      }}
      className={
        isMiniplayer
          ? 'relative w-full h-full bg-black select-none overflow-visible group/mini'
          : `bg-black select-none ${isMobileView && !effectiveFullscreen ? 'overflow-visible' : 'overflow-hidden'} group/player ${effectiveFullscreen
            ? 'fixed inset-0 z-[100] h-dvh w-dvw border-0 rounded-none [--player-safe-top:env(safe-area-inset-top,0px)] [--player-safe-bottom:env(safe-area-inset-bottom,0px)]'
            : (videoRatio && videoRatio < 0.98)
              ? 'relative w-full h-[min(48vh,380px)] lg:h-auto lg:aspect-video rounded-none sm:rounded-2xl border-0 sm:border sm:border-black/10 shadow-none sm:shadow-none'
              : 'relative w-full h-auto rounded-none sm:rounded-2xl border-0 sm:border-0 sm:border-black/10 shadow-none sm:shadow-none'
            } ${!showControls && isPlaying ? 'cursor-none' : 'cursor-default'}`
      }
      style={
        isMiniplayer
          ? { WebkitTouchCallout: 'none' }
          : {
              aspectRatio: effectiveFullscreen
                ? undefined
                : (videoRatio && videoRatio < 0.98)
                  ? (isMobileView ? undefined : '16/9')
                  // Mobile + cinematic → clamp to 16/9; desktop → keep true ratio
                  : (isMobileView && isCinematic) ? '16/9' : `${videoRatio}`,
              maxWidth: effectiveFullscreen
                ? undefined
                : (videoRatio && videoRatio < 0.98)
                  ? undefined
                  : (isMobileView && isCinematic)
                    ? undefined
                    : `calc((${desktopMaxHeight}) * ${videoRatio})`,
              maxHeight: effectiveFullscreen
                ? undefined
                : (videoRatio && videoRatio < 0.98)
                  ? (isMobileView ? 'min(48vh, 380px)' : desktopMaxHeight)
                  : desktopMaxHeight,
              margin: (videoRatio && videoRatio >= 0.98) ? 0 : '0 auto',
              contain: (isCurrentLevelHdr && effectiveFullscreen) || (isMobileView && !effectiveFullscreen) ? undefined : 'paint layout',
              WebkitTouchCallout: 'none',
            }
      }
    >
      {/* Ambient Mode Backdrop inside Player (fills fullscreen / pillarbox / letterbox black bars) */}
      <AmbientLight
        videoRef={video}
        storyboard={keepScrubPreviewOnLoad ? null : storyboard}
        poster={poster}
        enabled={showInnerAmbientBackdrop}
        preferStoryboardOnly={isCurrentLevelHdr}
        variant="backdrop"
      />

      {/* Hidden Synced Hi-Res Lossless Audio Element (Full PCM WAV / Auto-FLAC) */}
      <audio
        ref={hiResAudioRef}
        preload="none"
        crossOrigin="anonymous"
        className="hidden"
        aria-hidden="true"
      />

      {/* High-Performance Native Video Element */}
      <video
        ref={video}
        poster={poster}
        crossOrigin="anonymous"
        loop={nativeLooping}
        playsInline
        webkit-playsinline="true"
        x5-playsinline="true"
        preload="metadata" // Lowers memory contention on mobile!
        controlsList="nodownload nofullscreen noremoteplayback"
        disablePictureInPicture={false}
        disableRemotePlayback
        onRateChange={() => syncMediaPositionState()}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => {
          if (isSwitchingVideo || isSwitchingVideoRef.current) return;
          if (isTransitioningStreamRef.current) {
            restoreAudioAfterTransition();
          }
          setIsBuffering(false);
          setIsPlaying(true);
          setShowPoster(false);
          isEndedRef.current = false;
          setIsEnded(false);
          setIsMobileEndScreenDismissed(false);
          isUserPausedRef.current = false;
          checkAndUpdateRatio();
          lastTickTimeRef.current = performance.now();
        }}
        onPause={() => {
          const v = video.current;
          if (
            isSwitchingVideo ||
            isSwitchingVideoRef.current ||
            isTransitioningStreamRef.current ||
            !v ||
            v.readyState < 1
          ) {
            return;
          }
          const isAtEnd = v.ended || isEndedRef.current ||
            (!playlistActive && v.duration > 0 && v.currentTime >= v.duration - 0.5);

          if (isAtEnd) {
            const wasEnded = isEndedRef.current;
            // จบวิดีโอตามปกติ: อัปเดตสถานะจบ, ค้างจอดำ และแสดง End Screen (ไม่วนเล่นซ้ำถ้าไม่ได้เปิด loop)
            isEndedRef.current = true;
            setIsEnded(true);
            if (!wasEnded) {
              setIsMobileEndScreenDismissed(false);
            }
            setIsPlaying(false);
            lastTickTimeRef.current = null;
            if (fadeBlackOverlayRef.current) {
              fadeBlackOverlayRef.current.style.transition = 'opacity 200ms ease-out';
              fadeBlackOverlayRef.current.style.opacity = '1';
            }
            if (videoId && v && v.currentTime > 1) {
              syncHistoryToPlayState(v.currentTime, { forceServer: true });
            }
            return;
          }

          // หากเบราว์เซอร์ emit pause เองระหว่างเล่น โดยที่ผู้ใช้ไม่ได้กดหยุด และคลิปยังไม่จบ (เช่น Buffer stall / MSE pipeline hiccup)
          if (
            !isUserPausedRef.current &&
            !isSwitchingVideo &&
            !isSwitchingVideoRef.current &&
            !isTransitioningStreamRef.current &&
            isActiveRef.current
          ) {
            if (v && v.readyState >= 2) {
              v.play().catch(() => { });
              return;
            } else {
              setIsBuffering(true);
            }
          }

          setIsPlaying(false);
          lastTickTimeRef.current = null;
          if (videoId && v && v.currentTime > 1) {
            syncHistoryToPlayState(v.currentTime, { forceServer: true });
          }
        }}
        onError={(e) => {
          const err = e.target.error;
          if ((err?.code === 3 || err?.code === 4) && recoverHdrPlaybackRef.current?.()) return;
          const msg = err ? `ข้อผิดพลาดในการเล่น (${err.code}): ${err.message || ''}` : 'Native video error';
          setHlsError(msg);
          setIsBuffering(false);
          lastTickTimeRef.current = null;
        }}
        onProgress={updateBufferProgress}
        onTimeUpdate={handleNativeTimeUpdate}
        onDurationChange={(e) => {
          const d = e.target.duration;
          if (d && !isNaN(d) && isFinite(d) && d > 0) {
            setDuration(d);
            const c = e.target.currentTime || 0;
            if (timeDisplayRef.current) {
              timeDisplayRef.current.textContent = formatTimePair(c, d);
            }
          }
        }}
        onEnded={(event) => {
          if (isSwitchingVideo || !event.currentTarget.ended) return;
          if (isActive && repeatPlaylistVideo) {
            replayVideo();
            return;
          }
          const wasEnded = isEndedRef.current;
          isEndedRef.current = true;
          setIsEnded(true);
          if (!wasEnded) {
            setIsMobileEndScreenDismissed(false);
          }
          setIsPlaying(false);
          if (playlistActive) setShowControls(true);
          if (fadeBlackOverlayRef.current) {
            fadeBlackOverlayRef.current.style.transition = 'opacity 200ms ease-out';
            fadeBlackOverlayRef.current.style.opacity = '1';
          }
          if (nativeLooping) {
            setTimeout(() => {
              if (fadeBlackOverlayRef.current) {
                fadeBlackOverlayRef.current.style.transition = 'opacity 400ms ease-out';
                fadeBlackOverlayRef.current.style.opacity = '0';
              }
            }, 150);
          }
        }}
        onSeeking={() => {
          isSeekingRef.current = true;
          lastTickTimeRef.current = null;
          isEndedRef.current = false;
          setIsEnded(false);
          setIsMobileEndScreenDismissed(false);
          if (fadeBlackOverlayRef.current) {
            fadeBlackOverlayRef.current.style.transition = 'none';
            fadeBlackOverlayRef.current.style.opacity = '0';
          }
        }}
        onSeeked={() => {
          lastTickTimeRef.current = performance.now();
          if (seekCooldownTimerRef.current) {
            clearTimeout(seekCooldownTimerRef.current);
            seekCooldownTimerRef.current = null;
          }

          const v = video.current;
          if (v) {
            const vDur = Math.max(v.duration || 0, duration, v.currentTime);
            lastReportedSecondRef.current = Math.floor(v.currentTime);
            if (vDur - v.currentTime > 1.0) {
              isEndedRef.current = false;
              setIsEnded(false);
              setIsMobileEndScreenDismissed(false);
            }
            if (vDur > 0) {
              const pct = Math.min(100, Math.max(0, (v.currentTime / vDur) * 100));
              if (progressBarRef.current) progressBarRef.current.style.width = `${pct}%`;
              if (scrubberKnobRef.current) scrubberKnobRef.current.style.left = `${pct}%`;
            }
            if (timeDisplayRef.current) {
              timeDisplayRef.current.textContent = formatTimePair(v.currentTime, vDur);
            }
            if (fadeBlackOverlayRef.current && (vDur - v.currentTime) > 1.8) {
              fadeBlackOverlayRef.current.style.transition = 'none';
              fadeBlackOverlayRef.current.style.opacity = '0';
            }
            syncMediaPositionState(v.currentTime);
          }

          setTimeout(() => {
            isSeekingRef.current = false;
            setIsSeeking(false);
          }, 60);
        }}
        onLoadedData={() => {
          checkAndUpdateRatio();
          attemptAutoPlay();
        }}
        onCanPlay={(event) => {
          if (isMobileView && event.currentTarget.paused) setIsBuffering(false);
          checkAndUpdateRatio();
          attemptAutoPlay();
        }}
        onResize={() => {
          checkAndUpdateRatio();
        }}
        onLoadedMetadata={(e) => {
          if (isSwitchingVideo) return;
          const { duration: dur } = e.target;
          checkAndUpdateRatio();
          if (dur) setDuration(dur);
          updateBufferProgress();

          const startSec = targetInitialTime > 0 ? targetInitialTime : 0;
          if (!initialSeekDoneRef.current) {
            initialSeekDoneRef.current = true;
            if (startSec > 0) {
              try {
                e.target.currentTime = startSec;
              } catch (_) { }
            }
          }
          lastReportedSecondRef.current = Math.floor(startSec);

          if (dur && dur > 0) {
            const pct = Math.min((startSec / dur) * 100, 100);
            if (progressBarRef.current) progressBarRef.current.style.width = `${pct}%`;
            if (scrubberKnobRef.current) scrubberKnobRef.current.style.left = `${pct}%`;
            if (timeDisplayRef.current) {
              timeDisplayRef.current.textContent = formatTimePair(startSec, dur);
            }
          }
          syncMediaPositionState(startSec);

          if (onLoadedMetadata) onLoadedMetadata(e);
        }}
        className={`relative z-[1] w-full h-full pointer-events-none block ${aspectMode === 'crop'
          ? 'object-cover scale-[1.08]' // ตัดแถบดำด้านบน-ล่างอย่างนุ่มนวล
          : aspectMode === 'fill'
            ? 'object-cover'
            : 'object-contain'
          }`}
        style={aspectMode === 'crop' ? { transform: 'scale(1.08)' } : undefined}
      />

      {/* 🖼️ Instant Video Poster / Transition Backdrop (Shows new video's thumbnail immediately!) */}
      {poster && (
        <div
          className={`absolute inset-0 z-[2] overflow-hidden pointer-events-none transition-opacity duration-500 ease-out ${
            (showPoster || isSwitchingVideo) ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {/* Ambient blurred backdrop fills entire player */}
          <BrowserMediaImage
            src={poster}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover blur-2xl scale-110 opacity-40 select-none pointer-events-none"
          />
          {/* Main crisp poster image */}
          <BrowserMediaImage
            src={poster}
            alt={title || 'Video Poster'}
            className={`w-full h-full relative z-[1] select-none pointer-events-none ${
              aspectMode === 'crop'
                ? 'object-cover scale-[1.08]'
                : aspectMode === 'fill'
                  ? 'object-cover'
                  : 'object-contain'
            }`}
          />
          {/* Gentle cinematic vignette for crisp controls contrast */}
          <div className="absolute inset-0 z-[2] bg-gradient-to-t from-black/60 via-black/20 to-black/60 pointer-events-none" />
        </div>
      )}

      {/* 🎬 Cinematic Fade-to-Black Overlay (ช่วง ~0.8s - 1.0s ก่อนจบวิดีโอ) */}
      <div
        ref={fadeBlackOverlayRef}
        className="absolute inset-0 bg-black pointer-events-none z-[4] transition-opacity duration-500 ease-out opacity-0"
      />

      {/* Full-Frame Mobile Scrub Storyboard Preview (YouTube Mobile style: replaces video live while dragging scrubber!) */}
      {!isMiniplayer && isMobileView && (
        <div
          aria-hidden="true"
          className={`absolute inset-0 z-[24] bg-black overflow-hidden pointer-events-none transition-opacity duration-100 ${
            isScrubbing ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {poster && !keepScrubPreviewOnLoad && (
            <BrowserMediaImage
              src={poster}
              alt=""
              className="absolute inset-0 w-full h-full object-contain opacity-65"
            />
          )}
          <div
            ref={scrubThumbSdRef}
            className="absolute inset-0 w-full h-full bg-no-repeat z-10 opacity-0"
          />
          <div
            ref={scrubThumbHdRef}
            className="absolute inset-0 w-full h-full bg-no-repeat z-20 opacity-0 transition-opacity duration-150"
          />
        </div>
      )}

      {/* Unified 3-Zone Click / Double-Click Overlay (Full Watch Mode) OR YouTube-Style Desktop Miniplayer Overlay */}
      {isMiniplayer ? (
        !isMobileView && (
          <>
            {/* Compact Subtitles (CC) inside Miniplayer */}
            {(() => {
              const displayCue = isCcActive && hasSubtitles && activeCueText ? normalizeDisplayCueText(activeCueText) : '';
              if (!displayCue || isEnded) return null;
              return (
                <div className="absolute inset-x-3 bottom-6 z-[15] flex justify-center pointer-events-none">
                  <span className="max-w-[92%] px-2 py-0.5 rounded bg-black/75 text-white text-[10.5px] leading-snug text-center whitespace-pre-line break-words">
                    {displayCue}
                  </span>
                </div>
              );
            })()}

            {/* Hover / Paused Controls Overlay (absolute-positioned layers so compact/21:9 sizes NEVER overflow past scrubber!) */}
            <div
              onClick={() => togglePlay()}
              className={`absolute inset-0 z-20 bg-gradient-to-t from-black/80 via-black/15 to-black/65 transition-opacity duration-150 cursor-pointer ${
                !isPlaying || isScrubbing || isHoveringSeek
                  ? 'opacity-100'
                  : 'opacity-0 group-hover/mini:opacity-100'
              }`}
            >
              {/* Top row: YouTube-style Expand (top-left) & Close X (top-right) */}
              <div className="absolute top-0 inset-x-0 z-20 flex items-center justify-between px-2.5 pt-2 pointer-events-none">
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleMiniplayer?.();
                  }}
                  className="pointer-events-auto p-1.5 rounded-lg text-white/95 hover:text-white hover:bg-white/15 drop-shadow transition cursor-pointer focus:outline-none"
                  title="ขยายกลับหน้าดูเต็ม (i)"
                  aria-label="ขยายกลับหน้าดูเต็ม"
                >
                  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
                    <path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" />
                  </svg>
                </button>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseMiniplayer?.();
                  }}
                  className="pointer-events-auto p-1.5 rounded-lg text-white/90 hover:text-white hover:bg-white/15 drop-shadow transition cursor-pointer focus:outline-none"
                  title="ปิด Miniplayer"
                  aria-label="ปิด Miniplayer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Center: Clean White YouTube Play/Pause (+ Playlist Prev/Next) — dead-center, fades out cleanly while scrubbing */}
              <div
                className={`absolute inset-0 z-10 flex items-center justify-center gap-4 pointer-events-none transition-opacity duration-100 ${
                  isHoveringSeek || isScrubbing ? 'opacity-0' : 'opacity-100'
                }`}
              >
                {playlistActive && playPlaylistPrev && (
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.stopPropagation();
                      playPlaylistPrev();
                    }}
                    className={`p-1.5 text-white/90 hover:text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)] transition active:scale-90 cursor-pointer focus:outline-none ${
                      isHoveringSeek || isScrubbing ? 'pointer-events-none' : 'pointer-events-auto'
                    }`}
                    title="วิดีโอก่อนหน้า"
                    aria-label="วิดีโอก่อนหน้า"
                  >
                    <SkipBack className="w-5.5 h-5.5 fill-current" />
                  </button>
                )}
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePlay();
                  }}
                  className={`p-1.5 text-white hover:scale-105 drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)] transition active:scale-90 cursor-pointer focus:outline-none ${
                    isHoveringSeek || isScrubbing ? 'pointer-events-none' : 'pointer-events-auto'
                  }`}
                  title={isPlaying ? 'หยุดชั่วคราว (k)' : 'เล่นต่อ (k)'}
                  aria-label={isPlaying ? 'หยุดชั่วคราว' : 'เล่นต่อ'}
                >
                  {isPlaying ? <Pause className="w-9 h-9 fill-current" /> : <Play className="w-9 h-9 fill-current ml-0.5" />}
                </button>
                {playlistActive && playPlaylistNext && (
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.stopPropagation();
                      playPlaylistNext();
                    }}
                    className={`p-1.5 text-white/90 hover:text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)] transition active:scale-90 cursor-pointer focus:outline-none ${
                      isHoveringSeek || isScrubbing ? 'pointer-events-none' : 'pointer-events-auto'
                    }`}
                    title="วิดีโอถัดไป"
                    aria-label="วิดีโอถัดไป"
                  >
                    <SkipForward className="w-5.5 h-5.5 fill-current" />
                  </button>
                )}
              </div>

              {/* Bottom Info Row: Live Time (0:43 / 4:23) + Mute — pinned cleanly above flush scrubber */}
              <div
                className={`absolute bottom-1.5 inset-x-0 z-20 flex items-center justify-between px-2.5 pointer-events-none transition-opacity duration-100 ${
                  isHoveringSeek || isScrubbing ? 'opacity-0' : 'opacity-100'
                }`}
              >
                <span
                  ref={timeDisplayRef}
                  className="text-[11px] font-medium font-mono text-white/95 drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)] select-none"
                >
                  0:00 / 0:00
                </span>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleMute();
                  }}
                  className={`p-1 rounded-md text-white/90 hover:text-white hover:bg-white/15 drop-shadow transition cursor-pointer focus:outline-none ${
                    isHoveringSeek || isScrubbing ? 'pointer-events-none' : 'pointer-events-auto'
                  }`}
                  title={isMuted ? 'เปิดเสียง (m)' : 'ปิดเสียง (m)'}
                  aria-label={isMuted ? 'เปิดเสียง' : 'ปิดเสียง'}
                >
                  {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Always-Visible Flush Bottom Scrubber (sits right on the video/info-bar seam; round knob z-40 floats cleanly over seam!) */}
            <div
              data-mini-scrubber="true"
              ref={seekTrackRef}
              onPointerDown={(e) => {
                e.stopPropagation();
                handlePointerDown(e);
              }}
              onPointerMove={handleSeekMouseMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onMouseEnter={() => setIsHoveringSeek(true)}
              onMouseLeave={() => {
                setIsHoveringSeek(false);
                if (hoverBarRef.current) hoverBarRef.current.style.width = '0%';
              }}
              onClick={(e) => e.stopPropagation()}
              className="absolute bottom-0 left-0 right-0 z-40 h-4 flex items-end cursor-pointer group/miniscrub"
            >
              {/* Floating Storyboard Preview + Timestamp (YouTube Miniplayer Hover Preview!) */}
              <div
                ref={scrubPreviewRef}
                className={`absolute bottom-4 -translate-x-1/2 pointer-events-none transition-opacity duration-100 flex flex-col items-center gap-1 ${
                  isHoveringSeek || isScrubbing ? 'opacity-100' : 'opacity-0'
                }`}
                style={{ left: '50%' }}
              >
                <div
                  className={`relative ${
                    videoRatio && videoRatio < 1.3 ? 'h-[96px] w-auto' : 'w-[144px] h-auto'
                  } rounded-lg overflow-hidden bg-black border border-white/20 shadow-[0_6px_20px_rgba(0,0,0,0.85)] shrink-0`}
                  style={{ aspectRatio: videoRatio || 16 / 9 }}
                >
                  {poster && !keepScrubPreviewOnLoad && (
                    <BrowserMediaImage
                      src={poster}
                      alt=""
                      className="absolute inset-0 w-full h-full object-cover opacity-70"
                    />
                  )}
                  <div
                    ref={scrubThumbSdRef}
                    className="absolute inset-0 w-full h-full bg-no-repeat z-10 opacity-0"
                  />
                  <div
                    ref={scrubThumbHdRef}
                    className="absolute inset-0 w-full h-full bg-no-repeat z-20 opacity-0 transition-opacity duration-150"
                  />
                </div>
                <span
                  ref={scrubBadgeRef}
                  className="px-2 py-0.5 rounded-full bg-black/85 border border-white/15 text-[11px] font-mono font-bold text-white shadow"
                >
                  0:00
                </span>
              </div>

              {/* Flush Track Bar */}
              <div className="relative w-full h-[3px] group-hover/miniscrub:h-[5px] bg-white/25 transition-[height] duration-100">
                <div
                  ref={bufferBarRef}
                  className="absolute inset-y-0 left-0 bg-white/40 pointer-events-none"
                  style={{ width: '0%' }}
                />
                <div
                  ref={hoverBarRef}
                  className="absolute inset-y-0 left-0 bg-white/50 pointer-events-none"
                  style={{ width: '0%' }}
                />
                <div
                  ref={progressBarRef}
                  className="absolute inset-y-0 left-0 bg-[#FF7A00] pointer-events-none"
                  style={{ width: '0%' }}
                />
                <div
                  ref={scrubberKnobRef}
                  className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-50 w-3.5 h-3.5 rounded-full bg-[#FF7A00] shadow-[0_0_10px_rgba(255,122,0,0.9)] pointer-events-none transition-transform duration-100 ${
                    isHoveringSeek || isScrubbing ? 'scale-100' : 'scale-0'
                  }`}
                  style={{ left: '0%' }}
                />
              </div>
            </div>
          </>
        )
      ) : (
        <>
          <div
            onClick={handlePlayerOverlayClick}
            className="absolute inset-0 z-10 touch-manipulation"
          />

          {/* Top Bar: Fullscreen / Mobile */}
          <PlayerTopBar
        showControls={controlsVisible && !isMobileEndPromptOpen && !(isMobileView && isScrubbing)}
        isFullscreen={effectiveFullscreen}
        isMobileView={isMobileView}
        isEnded={isEnded}
        upNextVideo={upNextVideo}
        onSelectVideo={playlistActive ? playPlaylistNext : onSelectVideo}
        title={title}
        channelName={channelName}
        onBack={onBack}
        onToggleMiniplayer={onToggleMiniplayer}
        isAutoplay={isAutoplay}
        setIsAutoplay={setIsAutoplay}
        isCcActive={isCcActive}
        setIsCcActive={handleUserSetCcActive}
        hasSubtitles={hasSubtitles}
        showSettingsMenu={showSettingsMenu}
        setShowSettingsMenu={handleSetShowSettingsMenu}
        setSettingsPlacement={setSettingsPlacement}
        setActiveMenuTab={setActiveMenuTab}
        activeLevelLabel={activeLevelLabel}
        activeVersion={activeVersion}
        versions={versions}
        showToast={showToast}
        resetControlsTimer={resetControlsTimer}
      />

      {/* Center Controls & Gestures Feedback */}
      <PlayerCenterControls
        toastMessage={toastMessage}
        centerRipple={centerRipple}
        doubleTapSide={doubleTapSide}
        accumulatedSeconds={accumulatedSeconds}
        showControls={controlsVisible && !isMobileEndPromptOpen && !(isMobileView && isScrubbing)}
        isPlaying={isPlaying}
        isEnded={isEnded}
        isBuffering={isBuffering || isSwitchingVideo || isSwitchingVersion}
        hlsError={hlsError}
        isMobileView={isMobileView}
        seekStep={seekStep}
        togglePlay={togglePlay}
        commitSeek={commitSeek}
        video={video}
        duration={duration}
        showToast={showToast}
        resetControlsTimer={resetControlsTimer}
        onPlayNext={playlistActive ? playPlaylistNext : upNextVideo && onSelectVideo ? () => onSelectVideo(upNextVideo, 0) : null}
        onPlayPrev={playPlaylistPrev}
      />

      {/* 🎬 YouTube-style End Screen Overlay (Lazy-loaded via next/dynamic only when ended) */}
      {(showEndScreen && (!isMobileView || isMobileEndPromptOpen)) && (
        <PlayerEndScreen
          key={`${videoId}:${playlistActive}:${playlistNextVideo?.id ?? ''}`}
          isVisible={true}
          isFullscreen={effectiveFullscreen}
          isMobileView={isMobileView}
          currentVideo={currentVideo || { id: videoId, title, category: videoCategory, author_name: channelName }}
          relatedVideos={relatedVideos}
          onReplay={togglePlay}
          onSelectVideo={onSelectVideo}
          playlistNextVideo={playPlaylistNext ? playlistNextVideo : null}
          onPlayNext={playPlaylistNext}
          onDismiss={() => {
            setIsMobileEndScreenDismissed(true);
            setShowControls(true);
          }}
        />
      )}

      {/* Telemetry HUD (Stats for Nerds — Lazy-loaded only when opened) */}
      {showStats && (
        <PlayerStatsModal
          showStats={showStats}
          setShowStats={setShowStats}
          video={video}
          hlsRef={hlsInstanceRef}
          containerRef={containerRef}
          videoRatio={videoRatio}
          aspectMode={aspectMode}
          isPlaying={isPlaying}
          fps={fps}
          codec={codec}
          audioChannels={audioChannels}
          audioLayout={audioLayout}
          hiResAudio={hiResAudio}
          isHiResActive={isHiResActive}
          hiResAudioRef={hiResAudioRef}
          videoId={videoId}
          videoSlug={videoSlug}
          videoCategory={videoCategory}
          src={src}
          showToast={showToast}
        />
      )}

      {/* Custom Context Menu (Lazy-loaded only on right-click) */}
      {contextMenu && (
        <PlayerContextMenu
          contextMenu={contextMenu}
          setContextMenu={setContextMenu}
          video={video}
          isLooping={nativeLooping}
          setIsLooping={setIsLooping}
          showLoopOption={!playlistActive}
          showStats={showStats}
          setShowStats={setShowStats}
          showToast={showToast}
        />
      )}

      {/* Multi-Tab Settings Menu (Lazy-loaded with framer-motion ONLY on first settings open!) */}
      {(hasOpenedSettings || showSettingsMenu) && (
        <PlayerSettingsModal
          showSettingsMenu={showSettingsMenu}
          setShowSettingsMenu={handleSetShowSettingsMenu}
          settingsMenuRef={settingsMenuRef}
          settingsPlacement={settingsPlacement}
          isMobileView={isMobileView}
          isFullscreen={effectiveFullscreen}
          activeMenuTab={activeMenuTab}
          setActiveMenuTab={setActiveMenuTab}
          levels={levels}
          currentLevelIndex={currentLevelIndex}
          activeLevelLabel={activeLevelLabel}
          handleSelectQuality={handleSelectQuality}
          playbackRate={playbackRate}
          setPlaybackRate={setPlaybackRate}
          aspectMode={aspectMode}
          setAspectMode={setAspectMode}
          video={video}
          showToast={showToast}
          resetControlsTimer={resetControlsTimer}
          ambientMode={ambientMode}
          setAmbientMode={setAmbientMode}
          isMuted={isMuted}
          volume={volume}
          toggleMute={toggleMute}
          togglePiP={togglePiP}
          isCcActive={isCcActive}
          setIsCcActive={handleUserSetCcActive}
          hasSubtitles={hasSubtitles}
          subtitleTracks={subtitleTracks}
          selectedSubTrackId={selectedSubTrackId}
          setSelectedSubTrackId={setSelectedSubTrackId}
          activeSubTrack={activeSubTrack}
          subtitleStyle={subtitleStyle}
          setSubtitleStyle={handleUserSetSubtitleStyle}
          versions={versions}
          activeVersion={activeVersion}
          onSelectVersion={onSelectVersion}
          isSwitchingVersion={isSwitchingVersion}
          hiResAudio={hiResAudio}
          isHiResActive={isHiResActive}
          hiResStatus={hiResStatus}
          onSelectAudioMode={handleSelectAudioMode}
          audioChannels={audioChannels}
          audioLayout={audioLayout}
        />
      )}

      {/* 💬 YouTube-Style Subtitle (CC) Overlay */}
      {(() => {
        const isEditingSubStyle = showSettingsMenu && activeMenuTab?.startsWith('subtitle_opt');
        const rawDisplayCue = (isCcActive && hasSubtitles && activeCueText)
          ? activeCueText
          : isEditingSubStyle
            ? (activeCueText || 'ตัวอย่างคำบรรยาย TubeLock (CC)\nปรับระยะห่างบรรทัดให้คมชัดสมดุล')
            : '';
        const displayCue = normalizeDisplayCueText(rawDisplayCue);
        if (!displayCue || isEnded) return null;
        return (
          <div
            className="absolute z-25 flex justify-center pointer-events-none transition-all duration-200"
            style={{
              bottom: `${subtitleLayout.bottomPx}px`,
              left: `${subtitleLayout.sideInsetPx}px`,
              right: `${subtitleLayout.sideInsetPx}px`,
            }}
          >
            <div
              className="max-w-[92%] sm:max-w-[80%] text-center transition-all duration-150 inline-flex justify-center"
              style={{
                ...computedSubStyles.windowStyle,
                ...(subtitleLayout.maxWidthPx ? { maxWidth: `${subtitleLayout.maxWidthPx}px` } : {}),
              }}
            >
              <span
                className="inline-block max-w-full whitespace-pre-line text-center break-words"
                style={computedSubStyles.textStyle}
              >
                {displayCue}
              </span>
            </div>
          </div>
        );
      })()}

      {/* Modern High-Performance Bottom Controls Bar */}
      <PlayerBottomBar
        showControls={controlsVisible && !isMobileEndPromptOpen}
        isPlaying={isPlaying}
        isEnded={isEnded}
        isScrubbing={isScrubbing}
        isMobileView={isMobileView}
        isFullscreen={effectiveFullscreen}
        isNativeFullscreen={isFullscreen}
        timeDisplayRef={timeDisplayRef}
        togglePlay={togglePlay}
        toggleMute={toggleMute}
        isMuted={isMuted}
        volume={volume}
        showVolumeSlider={showVolumeSlider}
        setShowVolumeSlider={setShowVolumeSlider}
        handleVolumeChange={handleVolumeChange}
        isLiked={isLiked}
        setIsLiked={setIsLiked}
        isDisliked={isDisliked}
        setIsDisliked={setIsDisliked}
        isSaved={isSaved}
        setIsSaved={setIsSaved}
        isAutoplay={isAutoplay}
        setIsAutoplay={setIsAutoplay}
        isCcActive={isCcActive}
        setIsCcActive={handleUserSetCcActive}
        hasSubtitles={hasSubtitles}
        showSettingsMenu={showSettingsMenu}
        setShowSettingsMenu={handleSetShowSettingsMenu}
        setSettingsPlacement={setSettingsPlacement}
        setActiveMenuTab={setActiveMenuTab}
        activeLevelLabel={activeLevelLabel}
        toggleMiniplayer={onToggleMiniplayer}
        togglePiP={togglePiP}
        aspectMode={aspectMode}
        cycleAspectMode={cycleAspectMode}
        toggleFullscreen={toggleFullscreen}
        toggleOrientation={toggleOrientation}
        setContextMenu={setContextMenu}
        showToast={showToast}
        // Scrubber props:
        seekTrackRef={seekTrackRef}
        scrubPreviewRef={scrubPreviewRef}
        scrubThumbSdRef={scrubThumbSdRef}
        scrubThumbHdRef={scrubThumbHdRef}
        scrubBadgeRef={scrubBadgeRef}
        bufferBarRef={bufferBarRef}
        hoverBarRef={hoverBarRef}
        progressBarRef={progressBarRef}
        scrubberKnobRef={scrubberKnobRef}
        isHoveringSeek={isHoveringSeek}
        setIsHoveringSeek={setIsHoveringSeek}
        videoRatio={videoRatio}
        poster={keepScrubPreviewOnLoad ? null : poster}
        handlePointerDown={handlePointerDown}
        handleSeekMouseMove={handleSeekMouseMove}
        handlePointerUp={handlePointerUp}
        calculateScrubPosition={calculateScrubPosition}
        latestScrubTimeRef={latestScrubTimeRef}
        commitSeek={commitSeek}
        setIsScrubbing={setIsScrubbing}
        isScrubbingRef={isScrubbingRef}
      />
        </>
      )}
    </div>
  );
}
