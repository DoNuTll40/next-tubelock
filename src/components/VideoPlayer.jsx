'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Pause, Volume2, VolumeX, Volume1, Maximize, Minimize,
  Settings, Check, ChevronRight, ChevronLeft, Loader2, Info, X,
  Scan, Expand, Crop, PictureInPicture2, Copy, Activity, Zap,
  AlertTriangle, Gauge, Sparkles, ShieldCheck, RotateCcw, RotateCw,
  ThumbsUp, ThumbsDown, MessageSquare, Share2, Subtitles, ChevronDown, Plus,
  Cast, MoreHorizontal, Bookmark, ArrowLeft
} from 'lucide-react';
import { formatResolutionBadge } from '@/lib/videoUtils';

export default function VideoPlayer({
  src,
  poster,
  storyboard = null,
  title = '',
  channelName = 'TubeLock',
  onBack = null,
  resolution,
  fps,
  codec = 'h264',
  videoId,
  defaultVolume = 0.8,
  defaultAutoplay = true,
  defaultSpeed = 1,
  defaultFit = 'fit',
  seekStep = 10,
  autoStats = false,
  onTimeUpdate,
  onLoadedMetadata,
  videoRef: externalVideoRef
}) {
  const localRef = useRef(null);
  const video = externalVideoRef || localRef;
  const containerRef = useRef(null);
  const seekTrackRef = useRef(null);
  const hlsInstanceRef = useRef(null);
  const hlsRetryCountRef = useRef(0);

  // Performance Direct-DOM Refs (Prevents React re-render thrashing!)
  const progressBarRef = useRef(null);
  const bufferBarRef = useRef(null);
  const scrubberKnobRef = useRef(null);
  const timeDisplayRef = useRef(null);

  // Video aspect ratio
  const [videoRatio, setVideoRatio] = useState(() => {
    if (typeof resolution === 'string' && resolution.includes('x')) {
      const parts = resolution.split('x');
      const w = parseFloat(parts[0]);
      const h = parseFloat(parts[1]);
      if (w > 0 && h > 0) return w / h;
    }
    return 16 / 9;
  });

  // Playback states
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(defaultVolume);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);

  // Responsive device view & popup placement
  const [isMobileView, setIsMobileView] = useState(false);
  const [settingsPlacement, setSettingsPlacement] = useState('bottom'); // 'bottom' | 'top'

  useEffect(() => {
    const checkIsMobile = () => {
      const isTouch = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
      const isSmall = typeof window !== 'undefined' && window.innerWidth < 768;
      const isMediumTouch = isTouch && typeof window !== 'undefined' && window.innerWidth < 1024;
      setIsMobileView(isSmall || isMediumTouch);
    };
    checkIsMobile();
    window.addEventListener('resize', checkIsMobile);
    return () => window.removeEventListener('resize', checkIsMobile);
  }, []);

  // YouTube Mobile UI states
  const [isAutoplay, setIsAutoplay] = useState(defaultAutoplay);
  const [isCcActive, setIsCcActive] = useState(false);
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
  const [statsCopied, setStatsCopied] = useState(false);

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
  const settingsMenuRef = useRef(null);
  const [activeMenuTab, setActiveMenuTab] = useState('main'); // 'main' | 'speed' | 'quality' | 'aspect'

  // Click Outside to Dismiss Settings Menu (YouTube Standard)
  useEffect(() => {
    if (!showSettingsMenu) return;

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

  // Scrubbing & Hover Preview
  const [isScrubbing, setIsScrubbing] = useState(false);
  const isScrubbingRef = useRef(false);
  const latestScrubTimeRef = useRef(null);
  useEffect(() => {
    isScrubbingRef.current = isScrubbing;
  }, [isScrubbing]);
  const [previewTime, setPreviewTime] = useState(0);
  const [previewPercent, setPreviewPercent] = useState(0);
  const [isHoveringSeek, setIsHoveringSeek] = useState(false);
  const [hoverTime, setHoverTime] = useState(0);
  const [hoverPercent, setHoverPercent] = useState(0);
  const scrubPreviewRef = useRef(null);
  const scrubBadgeRef = useRef(null);
  const scrubThumbSdRef = useRef(null);
  const scrubThumbHdRef = useRef(null);
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
  const controlsTimeoutRef = useRef(null);
  const lastSavedTimeRef = useRef(0);

  const isUserPausedRef = useRef(!defaultAutoplay);
  const wakeLockSentinelRef = useRef(null);

  // Realtime FPS & Telemetry Metrics
  const [realtimeFps, setRealtimeFps] = useState('0.0');
  const frameCountRef = useRef(0);
  const lastFpsTimeRef = useRef(performance.now());
  const rvfcIdRef = useRef(null);

  const [nerdStats, setNerdStats] = useState({
    viewport: '0x0',
    dpr: '1.0',
    optimalRes: '0x0',
    bufferHealth: 0,
    droppedFrames: 0,
    totalFrames: 0,
    dropRate: '0.0%',
    protocol: 'Direct MP4',
    isHeavyCodec: false,
  });

  const [hlsError, setHlsError] = useState(null);

  const formatTime = (time) => {
    if (isNaN(time) || !time || time < 0) return '00:00';
    const m = Math.floor(time / 60);
    const s = Math.floor(time % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

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

  // Initial volume setup
  useEffect(() => {
    if (video.current) {
      video.current.volume = defaultVolume;
      setVolume(defaultVolume);
      video.current.playbackRate = defaultSpeed;
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
    const cur = e.target.currentTime;
    const dur = e.target.duration || duration;

    // Direct DOM manipulation - doesn't re-render the 1400 lines of React components!
    if (dur > 0 && !isScrubbing && !isScrubbingRef.current) {
      const pct = (cur / dur) * 100;
      if (progressBarRef.current) {
        progressBarRef.current.style.width = `${pct}%`;
      }
      if (scrubberKnobRef.current) {
        scrubberKnobRef.current.style.left = `${pct}%`;
      }
      if (timeDisplayRef.current) {
        timeDisplayRef.current.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
      }
    }

    updateBufferProgress();

    // Trigger external callback periodically (for watch position saving)
    const now = performance.now();
    if (now - lastSavedTimeRef.current > 2000) {
      if (onTimeUpdate) onTimeUpdate(e);
      lastSavedTimeRef.current = now;
    }
  };

  // FPS Telemetry: Only activates when Stats HUD is open
  useEffect(() => {
    const v = video.current;
    if (!v || !showStats || !isPlaying) {
      if (rvfcIdRef.current && v?.cancelVideoFrameCallback) {
        v.cancelVideoFrameCallback(rvfcIdRef.current);
      }
      return;
    }

    frameCountRef.current = 0;
    lastFpsTimeRef.current = performance.now();

    const handleVideoFrame = (now) => {
      frameCountRef.current += 1;
      const elapsed = now - lastFpsTimeRef.current;

      if (elapsed >= 500) {
        const currentFps = (frameCountRef.current / (elapsed / 1000));
        setRealtimeFps(currentFps.toFixed(1));
        frameCountRef.current = 0;
        lastFpsTimeRef.current = now;
      }

      if (video.current && 'requestVideoFrameCallback' in video.current) {
        rvfcIdRef.current = video.current.requestVideoFrameCallback(handleVideoFrame);
      }
    };

    if ('requestVideoFrameCallback' in v) {
      rvfcIdRef.current = v.requestVideoFrameCallback(handleVideoFrame);
    }

    return () => {
      if (rvfcIdRef.current && v?.cancelVideoFrameCallback) {
        v.cancelVideoFrameCallback(rvfcIdRef.current);
      }
    };
  }, [showStats, isPlaying, video]);

  // Telemetry Polling: ONLY active when Stats HUD is open
  useEffect(() => {
    if (!showStats) return;

    const interval = setInterval(() => {
      if (video.current && containerRef.current) {
        const cur = video.current.currentTime;
        let bufHealth = 0;
        for (let i = 0; i < video.current.buffered.length; i++) {
          if (video.current.buffered.start(i) <= cur && cur <= video.current.buffered.end(i)) {
            bufHealth = video.current.buffered.end(i) - cur;
            break;
          }
        }

        let dropped = 0;
        let total = 0;
        if (typeof video.current.getVideoPlaybackQuality === 'function') {
          const quality = video.current.getVideoPlaybackQuality();
          dropped = quality.droppedVideoFrames;
          total = quality.totalVideoFrames;
        } else {
          dropped = video.current.webkitDroppedFrameCount || 0;
        }

        const isHls = src?.startsWith('blob:') || src?.includes('.m3u8');
        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        const dropRate = total > 0 ? ((dropped / total) * 100).toFixed(1) + '%' : '0.0%';
        const isAv1or4K = (codec?.toLowerCase().includes('av1') || codec?.toLowerCase().includes('av01')) && (video.current.videoWidth >= 2500 || Number(fps) >= 50);

        setNerdStats({
          viewport: `${containerRef.current.clientWidth}x${containerRef.current.clientHeight}`,
          dpr: dpr.toFixed(1),
          optimalRes: `${video.current.videoWidth || 3840}x${video.current.videoHeight || 2026}`,
          bufferHealth: bufHealth,
          droppedFrames: dropped,
          totalFrames: total,
          dropRate,
          protocol: isHls ? 'HLS Adaptive Bitrate' : 'Direct MP4 Stream',
          isHeavyCodec: isAv1or4K,
        });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [showStats, video, src, codec, fps]);

  const showControlsRef = useRef(showControls);
  useEffect(() => {
    showControlsRef.current = showControls;
  }, [showControls]);

  // Controls Auto-Hide
  const resetControlsTimer = useCallback((customDelay = null) => {
    showControlsRef.current = true;
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    if (isPlaying && !isScrubbing && !showSettingsMenu && !showStats) {
      const delay = customDelay || (isMobileView ? 4500 : 2800);
      controlsTimeoutRef.current = setTimeout(() => {
        showControlsRef.current = false;
        setShowControls(false);
      }, delay);
    }
  }, [isPlaying, isScrubbing, showSettingsMenu, showStats, isMobileView]);

  // Initialize HLS or Native Player
  useEffect(() => {
    const v = video.current;
    if (!v || !src) return;

    setHlsError(null);
    setIsBuffering(true);
    setLevels([]);
    setCurrentLevelIndex(-1);
    setActiveLevelLabel(formatResolutionBadge(resolution) || 'Auto');
    hlsRetryCountRef.current = 0;

    if (hlsInstanceRef.current) {
      hlsInstanceRef.current.destroy();
      hlsInstanceRef.current = null;
    }

    const isHls = src.startsWith('blob:') || src.includes('.m3u8') || src.includes('playlist');
    let isMounted = true;

    async function initHls() {
      if (isHls) {
        const { default: Hls } = await import('hls.js');
        if (!isMounted) return;

        if (Hls.isSupported()) {
          const hls = new Hls({
            startLevel: 1, // Start level (360p/480p) for instant fast start without buffering
            maxBufferLength: 30, // YouTube standard buffer
            maxMaxBufferLength: 60,
            enableWorker: true,
            lowLatencyMode: false,
            fragLoadingTimeOut: 25000,
            fragLoadingMaxRetry: 4,
            manifestLoadingTimeOut: 15000,
            manifestLoadingMaxRetry: 3,
            levelLoadingTimeOut: 15000,
            levelLoadingMaxRetry: 3,
          });

          hls.loadSource(src);
          hls.attachMedia(v);
          hlsInstanceRef.current = hls;

          hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
            setIsBuffering(false);
            if (data.levels && data.levels.length > 0) {
              const parsed = data.levels.map((lvl, index) => ({
                index,
                height: lvl.height,
                width: lvl.width,
                bitrate: lvl.bitrate,
                label: formatResolutionBadge(`${lvl.height}p`),
              }));
              setLevels(parsed);
              setCurrentLevelIndex(hls.currentLevel);
            }

            if (defaultAutoplay && !isUserPausedRef.current) {
              v.play().then(() => setIsPlaying(true)).catch(() => {
                v.muted = true;
                setIsMuted(true);
                v.play().then(() => setIsPlaying(true)).catch(() => { });
              });
            }
          });

          hls.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
            const lvl = hls.levels[data.level];
            if (lvl) {
              const activeLabel = formatResolutionBadge(`${lvl.height}p`);
              setActiveLevelLabel(activeLabel);
              showToast(`คุณภาพ: ${activeLabel}`);
            }
          });

          hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
              switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                  hlsRetryCountRef.current += 1;
                  if (hlsRetryCountRef.current > 4) {
                    setHlsError(`เชื่อมต่อสตรีมไม่สำเร็จ: ${data.details}`);
                    setIsBuffering(false);
                    hls.destroy();
                  } else {
                    hls.startLoad();
                  }
                  break;
                case Hls.ErrorTypes.MEDIA_ERROR:
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
            }
          });
        } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
          // Native Safari Apple hardware acceleration
          v.src = src;
        }
      } else {
        // Direct MP4 - Clean Native Playback
        v.src = src;
        if (defaultAutoplay && !isUserPausedRef.current) {
          v.play().then(() => setIsPlaying(true)).catch(() => {
            v.muted = true;
            setIsMuted(true);
            v.play().then(() => setIsPlaying(true)).catch(() => { });
          });
        }
      }
    }

    initHls();

    return () => {
      isMounted = false;
      if (hlsInstanceRef.current) {
        hlsInstanceRef.current.destroy();
        hlsInstanceRef.current = null;
      }
    };
  }, [src, defaultAutoplay, resolution, video, showToast]);

  // Quality selector (Seamless switch: updates nextLevel & currentLevel without resetting stream or reloading src)
  const handleSelectQuality = (levelIdx) => {
    setCurrentLevelIndex(levelIdx);
    if (hlsInstanceRef.current) {
      hlsInstanceRef.current.nextLevel = levelIdx;
      hlsInstanceRef.current.currentLevel = levelIdx;
      if (levelIdx === -1) {
        showToast('ความละเอียด: Auto (ปรับตามเน็ต)');
      } else {
        const selected = levels.find((l) => l.index === levelIdx);
        if (selected) {
          setActiveLevelLabel(selected.label);
          showToast(`ความละเอียด: ${selected.label}`);
        }
      }
    }
    setShowSettingsMenu(false);
    resetControlsTimer();
  };

  // Instant Play/Pause
  const togglePlay = useCallback(() => {
    if (!video.current) return;

    if (video.current.paused) {
      isUserPausedRef.current = false;
      video.current.play()
        .then(() => {
          setIsPlaying(true);
          triggerRipple('play');
        })
        .catch(() => setIsPlaying(false));
    } else {
      isUserPausedRef.current = true;
      video.current.pause();
      setIsPlaying(false);
      triggerRipple('pause');
    }
    resetControlsTimer();
  }, [video, triggerRipple, resetControlsTimer]);

  // Volume Handlers
  const handleVolumeChange = (e) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (video.current) {
      video.current.volume = val;
      video.current.muted = val === 0;
      setIsMuted(val === 0);
    }
    showToast(`ระดับเสียง: ${Math.round(val * 100)}%`);
  };

  const toggleMute = () => {
    if (!video.current) return;
    const nextMuted = !isMuted;
    video.current.muted = nextMuted;
    setIsMuted(nextMuted);
    if (!nextMuted && volume === 0) {
      setVolume(0.5);
      video.current.volume = 0.5;
    }
    showToast(nextMuted ? 'ปิดเสียง' : `ระดับเสียง: ${Math.round((nextMuted ? 0 : volume) * 100)}%`);
  };

  // Fast Seek Commit
  const commitSeek = useCallback((targetTime) => {
    if (!video.current) return;
    const clamped = Math.min(Math.max(targetTime, 0), duration);
    if ('fastSeek' in video.current) {
      video.current.fastSeek(clamped);
    } else {
      video.current.currentTime = clamped;
    }
    pendingTargetTimeRef.current = null;
  }, [duration, video]);

  // Two-Tier YouTube-Style Sprite Sheet Thumbnail Lookup (Direct DOM)
  const updateStoryboardThumbnail = useCallback((targetSec) => {
    const elSd = scrubThumbSdRef.current;
    const elHd = scrubThumbHdRef.current;
    if (!elSd) return;

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

      // Lookup authenticated OneDrive downloadUrl from spriteMap
      resolvedUrl = spriteMap[sheetKeySD] || spriteMap[sheetKeyStd] || spriteMap[sheetKeyHD]
        || spriteMap[sheetPadded] || spriteMap[String(sheetIndex)]
        || `/streams/${videoId}/thumbnails/sprite_${sheetPadded}.jpg`;
    }

    if (resolvedUrl) {
      // CSS Percentage positioning: aligns exact column and row within dynamic aspect-ratio container
      const posX = cols > 1 ? (col / (cols - 1)) * 100 : 0;
      const posY = rows > 1 ? (row / (rows - 1)) * 100 : 0;

      elSd.style.backgroundImage = `url("${resolvedUrl}")`;
      elSd.style.backgroundPosition = `${posX}% ${posY}%`;
      elSd.style.backgroundSize = `${cols * 100}% ${rows * 100}%`;
      elSd.style.opacity = '1';
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
  }, [storyboard, videoId]);

  // Scrubbing calculation
  const calculateScrubPosition = (clientX) => {
    if (!seekTrackRef.current || duration <= 0) return;
    const rect = seekTrackRef.current.getBoundingClientRect();
    const offsetX = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const percent = (offsetX / rect.width) * 100;
    const calculatedSec = (offsetX / rect.width) * duration;
    const clampedPercent = Math.max(10, Math.min(percent, 90));

    latestScrubTimeRef.current = calculatedSec;

    // Zero-lag direct DOM updates!
    if (scrubPreviewRef.current) {
      scrubPreviewRef.current.style.left = `${clampedPercent}%`;
    }
    if (scrubBadgeRef.current) {
      scrubBadgeRef.current.textContent = formatTime(calculatedSec);
    }
    if (progressBarRef.current) progressBarRef.current.style.width = `${percent}%`;
    if (scrubberKnobRef.current) scrubberKnobRef.current.style.left = `${percent}%`;
    if (timeDisplayRef.current) timeDisplayRef.current.textContent = `${formatTime(calculatedSec)} / ${formatTime(duration)}`;

    setPreviewPercent(percent);
    setPreviewTime(calculatedSec);
    updateStoryboardThumbnail(calculatedSec);
  };

  const handleSeekMouseMove = (e) => {
    if (!seekTrackRef.current || duration <= 0) return;
    if (!isScrubbing && !isHoveringSeek) return;
    const rect = seekTrackRef.current.getBoundingClientRect();
    const offsetX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const pct = (offsetX / rect.width) * 100;
    const time = (offsetX / rect.width) * duration;
    const clampedPct = Math.max(10, Math.min(pct, 90));

    // Zero-lag direct DOM update on hover as well!
    if (scrubPreviewRef.current) {
      scrubPreviewRef.current.style.left = `${clampedPct}%`;
    }
    if (scrubBadgeRef.current) {
      scrubBadgeRef.current.textContent = formatTime(time);
    }

    setHoverPercent(pct);
    setHoverTime(time);
    updateStoryboardThumbnail(time);
    if (isScrubbing) {
      calculateScrubPosition(e.clientX);
    }
  };

  const handlePointerDown = (e) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (_) { }
    isScrubbingRef.current = true;
    setIsScrubbing(true);
    calculateScrubPosition(e.clientX);
  };

  const handlePointerUp = (e) => {
    try {
      if (e?.currentTarget?.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch (_) { }
    if (isScrubbing || isScrubbingRef.current) {
      const targetSec = latestScrubTimeRef.current !== null ? latestScrubTimeRef.current : previewTime;
      commitSeek(targetSec);
      latestScrubTimeRef.current = null;
      isScrubbingRef.current = false;
      setIsScrubbing(false);
      resetControlsTimer();
    }
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

    const rect = containerRef.current.getBoundingClientRect();
    const xRatio = (e.clientX - rect.left) / rect.width;
    const zone = xRatio < 0.35 ? 'left' : xRatio > 0.65 ? 'right' : 'center';
    const now = Date.now();

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
  const toggleFullscreen = async () => {
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

        // 📱 Auto orientation lock: Rotate mobile to landscape automatically when video is widescreen!
        if (typeof window !== 'undefined' && window.screen?.orientation?.lock) {
          try {
            if (videoRatio >= 1) {
              await window.screen.orientation.lock('landscape');
            } else {
              await window.screen.orientation.lock('portrait');
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

        // Allow natural free rotation again after rotating back to portrait
        if (typeof window !== 'undefined' && window.screen?.orientation?.unlock) {
          setTimeout(() => {
            try {
              window.screen.orientation.unlock();
            } catch (_) { }
          }, 600);
        }
      } catch (err) {
        console.warn('Exit fullscreen error:', err);
      }
    }
    resetControlsTimer();
  };

  const togglePiP = async () => {
    if (!video.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await video.current.requestPictureInPicture();
      }
    } catch (err) {
      console.warn('PiP error:', err);
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFull = !!(document.fullscreenElement || document.webkitFullscreenElement);
      setIsFullscreen(isFull);
      if (!isFull && typeof window !== 'undefined' && window.screen?.orientation?.unlock) {
        try {
          window.screen.orientation.unlock();
        } catch (_) { }
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      if (typeof window !== 'undefined' && window.screen?.orientation?.unlock) {
        try {
          window.screen.orientation.unlock();
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

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target?.tagName)) return;

      if (e.key === ' ' || e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        commitSeek((video.current?.currentTime || 0) + seekStep);
        showToast(`+${seekStep} วินาที`);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        commitSeek((video.current?.currentTime || 0) - seekStep);
        showToast(`-${seekStep} วินาที`);
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        commitSeek((video.current?.currentTime || 0) + 10);
        showToast('+10 วินาที');
      } else if (e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        commitSeek((video.current?.currentTime || 0) - 10);
        showToast('-10 วินาที');
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        toggleMute();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const nextVol = Math.min(volume + 0.05, 1);
        setVolume(nextVol);
        if (video.current) video.current.volume = nextVol;
        showToast(`ระดับเสียง: ${Math.round(nextVol * 100)}%`);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextVol = Math.max(volume - 0.05, 0);
        setVolume(nextVol);
        if (video.current) video.current.volume = nextVol;
        showToast(`ระดับเสียง: ${Math.round(nextVol * 100)}%`);
      } else if (/^[0-9]$/.test(e.key) && duration > 0) {
        e.preventDefault();
        const fraction = parseInt(e.key, 10) / 10;
        commitSeek(duration * fraction);
        showToast(`กระโดดไปที่ ${fraction * 100}%`);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, commitSeek, duration, seekStep, volume, toggleMute, showToast]);

  // Copy Telemetry report
  const copyTelemetry = () => {
    const report = JSON.stringify(
      {
        videoId,
        resolution: nerdStats.optimalRes,
        viewport: nerdStats.viewport,
        dpr: nerdStats.dpr,
        aspectRatio: videoRatio.toFixed(3),
        fps: `${realtimeFps} / ${fps || 30}`,
        droppedFrames: `${nerdStats.droppedFrames} / ${nerdStats.totalFrames} (${nerdStats.dropRate})`,
        codec,
        bufferHealthSec: nerdStats.bufferHealth.toFixed(2),
        aspectMode,
        playbackRate,
        timestamp: new Date().toISOString(),
      },
      null,
      2
    );
    navigator.clipboard.writeText(report);
    setStatsCopied(true);
    showToast('คัดลอกสถิติเรียบร้อย');
    setTimeout(() => setStatsCopied(false), 2000);
  };

  const targetFpsNumber = Number(fps) || 30;
  const currentFpsNumber = Number(realtimeFps);
  const is4K = (resolution && resolution.toString().includes('2160')) ||
    (activeLevelLabel && (activeLevelLabel.includes('4K') || activeLevelLabel.includes('2160p')));
  const isHD = is4K || (resolution && (resolution.toString().includes('1080') || resolution.toString().includes('720') || resolution.toString().includes('1440'))) ||
    (activeLevelLabel && (activeLevelLabel.includes('1080') || activeLevelLabel.includes('720') || activeLevelLabel.includes('1440')));

  // Persistent progress and time values (Prevents flicker/reset to 0% and 00:00 on state re-render!)
  const currentVideoTime = video.current?.currentTime || 0;
  const currentProgressPct = duration > 0 ? Math.min(100, Math.max(0, (currentVideoTime / duration) * 100)) : 0;
  const activeScrubPercent = isScrubbing ? previewPercent : currentProgressPct;
  const activeTimeDisplay = isScrubbing
    ? `${formatTime(previewTime)} / ${formatTime(duration)}`
    : `${formatTime(currentVideoTime)} / ${formatTime(duration)}`;

  let initialBufferPct = 0;
  if (video.current && duration > 0) {
    const b = video.current.buffered;
    for (let i = 0; i < b.length; i++) {
      if (b.start(i) <= currentVideoTime && currentVideoTime <= b.end(i)) {
        initialBufferPct = Math.min((b.end(i) / duration) * 100, 100);
        break;
      }
    }
  }

  return (
    <div
      ref={containerRef}
      onContextMenu={handleContextMenu}
      onClick={() => { if (contextMenu) setContextMenu(null); }}
      onMouseMove={(e) => {
        if (isMobileView) return;
        if (e?.nativeEvent?.pointerType === 'touch') return;
        resetControlsTimer();
      }}
      onPointerMove={handleSeekMouseMove}
      onPointerUp={handlePointerUp}
      className={`relative bg-black select-none overflow-hidden group/player ${isFullscreen
        ? 'fixed inset-0 z-50 h-screen w-screen border-0 rounded-none'
        : 'rounded-2xl border border-black/10 shadow-md'
        } ${!showControls && isPlaying ? 'cursor-none' : 'cursor-default'}`}
      style={{
        width: isFullscreen ? '100vw' : '100%',
        maxWidth: isFullscreen ? undefined : `calc(min(75vh, calc(100vh - 160px)) * ${videoRatio})`,
        aspectRatio: isFullscreen ? undefined : videoRatio,
        maxHeight: isFullscreen ? undefined : 'min(75vh, calc(100vh - 160px))',
        margin: '0 auto',
        contain: 'paint layout',
        WebkitTouchCallout: 'none',
      }}
    >
      {/* High-Performance Native Video Element */}
      <video
        ref={video}
        poster={poster}
        playsInline
        webkit-playsinline="true"
        x5-playsinline="true"
        preload="metadata" // Lowers memory contention on mobile!
        controlsList="nodownload nofullscreen noremoteplayback"
        disablePictureInPicture={false}
        disableRemotePlayback
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => {
          setIsBuffering(false);
          setIsPlaying(true);
          isUserPausedRef.current = false;
        }}
        onPause={() => setIsPlaying(false)}
        onError={(e) => {
          const err = e.target.error;
          const msg = err ? `ข้อผิดพลาดในการเล่น (${err.code}): ${err.message || ''}` : 'Native video error';
          setHlsError(msg);
          setIsBuffering(false);
        }}
        onProgress={updateBufferProgress}
        onTimeUpdate={handleNativeTimeUpdate}
        onCanPlay={(e) => {
          const { videoWidth, videoHeight } = e.target;
          if (videoWidth && videoHeight) {
            setVideoRatio(videoWidth / videoHeight);
          }
        }}
        onLoadedMetadata={(e) => {
          const { videoWidth, videoHeight, duration: dur } = e.target;
          if (videoWidth && videoHeight) {
            setVideoRatio(videoWidth / videoHeight);
          }
          setDuration(dur);
          updateBufferProgress();
          if (onLoadedMetadata) onLoadedMetadata(e);
        }}
        className={`w-full h-full pointer-events-none block ${aspectMode === 'crop'
          ? 'object-cover scale-[1.08]' // ตัดแถบดำด้านบน-ล่างอย่างนุ่มนวล
          : aspectMode === 'fill'
            ? 'object-cover'
            : 'object-contain'
          }`}
        style={{
          transform: aspectMode === 'crop' ? 'scale(1.08)' : 'none',
          willChange: 'auto',
          backfaceVisibility: 'hidden',
        }}
      />

      {/* Unified 3-Zone Click / Double-Click Overlay (Left -10s, Center Play/Pause/Fullscreen, Right +10s) */}
      <div
        onClick={handlePlayerOverlayClick}
        className="absolute inset-0 z-10 cursor-pointer touch-manipulation"
      />

      {/* On-Screen Toast Notification */}
      {toastMessage && (
        <div className="absolute top-10 left-1/2 -translate-x-1/2 z-40 bg-[#151413]/40 backdrop-blur-md text-white px-4 py-2 rounded-full border border-white/15 text-xs font-semibold shadow-xl flex items-center gap-2 pointer-events-none animate-fadeIn">
          {/* <Sparkles className="w-3.5 h-3.5 text-[#FF7A00]" /> */}
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Momentary Play/Pause Ripple Flash (Auto vanishes in 400ms) */}
      {centerRipple && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30 animate-scaleFade">
          <div className="w-16 h-16 rounded-full bg-black/65 border border-white/20 flex items-center justify-center text-white shadow-2xl">
            {centerRipple === 'play' ? (
              <Play className="w-7 h-7 fill-white ml-0.5" />
            ) : (
              <Pause className="w-7 h-7 fill-white" />
            )}
          </div>
        </div>
      )}

      {/* YouTube-Style Double Click/Tap Animated Ripple Feedback */}
      {doubleTapSide && (
        <div className={`absolute ${doubleTapSide === 'left' ? 'left-8 sm:left-16' : 'right-8 sm:right-16'} top-1/2 -translate-y-1/2 pointer-events-none z-30 select-none animate-scaleFade`}>
          <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-black/75 border border-white/20 flex flex-col items-center justify-center text-white shadow-2xl backdrop-blur-xs">
            <div className="flex items-center">
              {doubleTapSide === 'left' ? (
                <>
                  <ChevronLeft className="w-5 h-5 -mr-2 text-white/70 animate-pulse" />
                  <ChevronLeft className="w-5 h-5 text-white" />
                </>
              ) : (
                <>
                  <ChevronRight className="w-5 h-5 text-white" />
                  <ChevronRight className="w-5 h-5 -ml-2 text-white/70 animate-pulse" />
                </>
              )}
            </div>
            <span className="text-xs font-bold font-mono mt-1">
              {accumulatedSeconds > 0 ? `+${accumulatedSeconds}s` : `${accumulatedSeconds}s`}
            </span>
          </div>
        </div>
      )}

      {/* Top Bar: On PC Desktop fullscreen, shows only the Title text at top-left. On Mobile, shows Mobile Top Bar */}
      {(showControls || !isPlaying) && (
        <div
          className={`absolute top-0 left-0 right-0 px-4 sm:px-6 pt-3.5 sm:pt-4 pb-8 bg-gradient-to-b from-black/85 via-black/35 to-transparent flex items-center justify-between z-30 transition-opacity duration-150 ${!isFullscreen && !isMobileView ? 'hidden' : ''
            }`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Top-Left: Title in Fullscreen (Matches Screenshot 2), or Back Button in Mobile Portrait */}
          {isFullscreen ? (
            <div className="flex items-center gap-2 max-w-[75%] min-w-0">
              <div className="flex flex-col min-w-0 text-left">
                <div className="flex items-center gap-1.5">
                  <span className="text-white text-xs sm:text-base font-semibold truncate drop-shadow-md select-none">
                    {title || 'วิดีโอ TubeLock'}
                  </span>
                  {isMobileView && <ChevronRight className="w-3.5 h-3.5 text-zinc-400 shrink-0" />}
                </div>
                {isMobileView && (
                  <span className="text-[10px] sm:text-[11px] text-zinc-400 truncate select-none">
                    {channelName} • Cloud Stream
                  </span>
                )}
              </div>
            </div>
          ) : isMobileView && onBack ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onBack();
              }}
              className="p-2 -ml-1 rounded-full bg-black/40 hover:bg-black/60 text-white backdrop-blur-xs transition active:scale-90 cursor-pointer"
              title="ย้อนกลับ"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          ) : (
            <div className="w-8" />
          )}

          {/* Top-Right: Shown ONLY on Mobile (On PC desktop, controls live exclusively in bottom bar like real YouTube!) */}
          {isMobileView ? (
            <div className="flex items-center gap-2 sm:gap-3 shrink-0 text-white">
              {/* Autoplay switch */}
              <button
                type="button"
                onClick={() => {
                  const next = !isAutoplay;
                  setIsAutoplay(next);
                  showToast(next ? 'เปิดการเล่นอัตโนมัติ' : 'ปิดการเล่นอัตโนมัติ');
                  resetControlsTimer();
                }}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${isAutoplay ? 'bg-white' : 'bg-white/30'
                  }`}
                title={isAutoplay ? 'การเล่นอัตโนมัติเปิดอยู่' : 'การเล่นอัตโนมัติปิดอยู่'}
              >
                <span
                  className={`inline-flex items-center justify-center h-3.5 w-3.5 transform rounded-full transition-transform ${isAutoplay ? 'translate-x-4.5 bg-black' : 'translate-x-1 bg-white'
                    }`}
                >
                  {isAutoplay ? (
                    <Play className="w-2 h-2 fill-current text-white" />
                  ) : (
                    <Pause className="w-2 h-2 fill-current text-black" />
                  )}
                </span>
              </button>

              {/* Cast */}
              <button
                type="button"
                onClick={() => {
                  showToast('เชื่อมต่ออุปกรณ์ Cast / TV');
                  resetControlsTimer();
                }}
                className="p-1.5 rounded-lg hover:bg-white/15 active:scale-90 transition cursor-pointer text-zinc-300 hover:text-white"
                title="เล่นบนทีวี (Cast)"
              >
                <Cast className="w-4.5 h-4.5" />
              </button>

              {/* CC */}
              <button
                type="button"
                onClick={() => {
                  setIsCcActive(!isCcActive);
                  showToast(isCcActive ? 'ปิดคำบรรยาย' : 'ยังไม่มีไฟล์คำบรรยาย (CC)');
                  resetControlsTimer();
                }}
                className={`p-1.5 rounded-lg hover:bg-white/15 active:scale-90 transition cursor-pointer ${isCcActive ? 'text-[#FF7A00] bg-white/15' : 'text-zinc-300 hover:text-white'
                  }`}
                title="คำบรรยาย (CC)"
              >
                <Subtitles className="w-4.5 h-4.5" />
              </button>

              {/* Settings */}
              <button
                type="button"
                data-settings-btn="true"
                onClick={() => {
                  setSettingsPlacement('top');
                  setShowSettingsMenu(!showSettingsMenu);
                  setActiveMenuTab('main');
                  resetControlsTimer();
                }}
                className="p-1.5 rounded-lg hover:bg-white/15 active:scale-90 transition cursor-pointer text-zinc-300 hover:text-white relative"
                title="การตั้งค่า"
              >
                <Settings className="w-4.5 h-4.5" />
                {is4K ? (
                  <span className="absolute -top-0.5 -right-0.5 bg-red-600 text-white font-extrabold text-[7px] leading-tight px-1 py-0.5 rounded shadow pointer-events-none">
                    4K
                  </span>
                ) : isHD ? (
                  <span className="absolute -top-0.5 -right-0.5 bg-red-600 text-white font-extrabold text-[7px] leading-tight px-0.5 py-0.5 rounded shadow pointer-events-none">
                    HD
                  </span>
                ) : null}
              </button>
            </div>
          ) : (
            <div />
          )}
        </div>
      )}

      {/* Center Controls: Mobile shows Trio (-10s, Play/Pause, +10s), Desktop remains clean while playing */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
        {hlsError ? (
          <div className="pointer-events-auto flex flex-col items-center gap-2 bg-[#121110]/95 rounded-2xl px-5 py-3.5 text-center max-w-[85%] border border-rose-500/30 shadow-2xl">
            <span className="text-rose-400 text-xs font-mono break-words">{hlsError}</span>
          </div>
        ) : isBuffering ? (
          <div className="p-3 bg-black/60 rounded-full border border-white/15 shadow-xl backdrop-blur-md">
            <Loader2 className="w-7 h-7 text-[#FF7A00] animate-spin" />
          </div>
        ) : (
          (showControls || !isPlaying) && !doubleTapSide && (
            <>
              {/* Mobile View: YouTube Trio (-10s, Play/Pause, +10s) */}
              {isMobileView ? (
                <div className="flex items-center gap-7 sm:gap-14 pointer-events-auto select-none">
                  {/* Skip -10s */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const cur = video.current?.currentTime || 0;
                      commitSeek(Math.max(0, cur - seekStep));
                      showToast(`-${seekStep} วินาที`);
                      resetControlsTimer();
                    }}
                    className="w-11 h-11 sm:w-13 sm:h-13 rounded-full bg-black/55 hover:bg-black/80 active:scale-90 border border-white/15 text-white flex flex-col items-center justify-center transition shadow-xl backdrop-blur-xs cursor-pointer"
                    title={`ย้อนหลัง ${seekStep} วินาที`}
                  >
                    <RotateCcw className="w-4.5 h-4.5 sm:w-5.5 sm:h-5.5" />
                    <span className="text-[8px] sm:text-[9px] font-mono font-bold leading-none -mt-0.5">10</span>
                  </button>

                  {/* Big Center Play/Pause */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePlay();
                    }}
                    className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-black/65 hover:bg-[#FF7A00] active:scale-95 border border-white/25 text-white flex items-center justify-center transition-all duration-150 shadow-[0_8px_32px_rgba(0,0,0,0.6)] backdrop-blur-xs cursor-pointer"
                    title={isPlaying ? 'หยุดชั่วคราว' : 'เล่น'}
                  >
                    {isPlaying ? (
                      <Pause className="w-6 h-6 sm:w-7 sm:h-7 fill-white" />
                    ) : (
                      <Play className="w-6 h-6 sm:w-7 sm:h-7 fill-white ml-0.5" />
                    )}
                  </button>

                  {/* Skip +10s */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const cur = video.current?.currentTime || 0;
                      commitSeek(Math.min(duration, cur + seekStep));
                      showToast(`+${seekStep} วินาที`);
                      resetControlsTimer();
                    }}
                    className="w-11 h-11 sm:w-13 sm:h-13 rounded-full bg-black/55 hover:bg-black/80 active:scale-90 border border-white/15 text-white flex flex-col items-center justify-center transition shadow-xl backdrop-blur-xs cursor-pointer"
                    title={`ไปข้างหน้า ${seekStep} วินาที`}
                  >
                    <RotateCw className="w-4.5 h-4.5 sm:w-5.5 sm:h-5.5" />
                    <span className="text-[8px] sm:text-[9px] font-mono font-bold leading-none -mt-0.5">10</span>
                  </button>
                </div>
              ) : (
                /* Desktop View (Both Windowed & Fullscreen): Clean center while playing; Play button when paused */
                !isPlaying && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePlay();
                    }}
                    className="pointer-events-auto w-16 h-16 rounded-full bg-black/70 hover:bg-[#FF7A00] hover:scale-110 active:scale-95 border border-white/25 text-white flex items-center justify-center transition-all duration-200 shadow-2xl backdrop-blur-xs cursor-pointer group"
                    title="เล่น (k)"
                  >
                    <Play className="w-7 h-7 fill-white ml-0.5 group-hover:scale-105 transition-transform" />
                  </button>
                )
              )}
            </>
          )
        )}
      </div>

      {/* GOD-TIER TELEMETRY HUD (Stats for Nerds) */}
      {showStats && (
        <div className="absolute top-3 left-3 sm:top-4 sm:left-4 z-40 bg-[#0F0E0D]/95 border border-white/15 rounded-2xl p-3.5 sm:p-4 text-[11px] font-mono text-zinc-300 shadow-2xl w-[92%] sm:w-[350px] md:w-[370px] max-h-[82%] overflow-y-auto select-text scrollbar-none">
          {/* HUD Header */}
          <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-2 font-sans">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-red-500/20 flex items-center justify-center text-red-500">
                <Activity className="w-3.5 h-3.5" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-white leading-none">สถิติสำหรับเด็กเนิร์ด</h4>
                <span className="text-[9px] text-emerald-400 font-mono font-medium flex items-center gap-1 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live Telemetry
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={copyTelemetry}
                className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-zinc-200 text-[10px] font-sans flex items-center gap-1 transition cursor-pointer"
              >
                <Copy className="w-3 h-3 text-red-500" />
                <span>{statsCopied ? 'คัดลอกแล้ว' : 'คัดลอก'}</span>
              </button>
              <button
                type="button"
                onClick={() => setShowStats(false)}
                className="p-1 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Heavy Codec Warning for Mobile Phones */}
          {nerdStats.isHeavyCodec && (
            <div className="mb-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded-xl text-[10px] text-amber-200 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <div className="leading-snug">
                <span className="font-bold text-amber-300">แจ้งเตือนโหลดสูง (4K AV1):</span> มือถือรุ่นเก่าหรือไม่มีชิป AV1 ฮาร์ดแวร์ จะถอดรหัสด้วย CPU ทำให้เกิด Dropframe ได้
              </div>
            </div>
          )}

          {/* Telemetry Metrics */}
          <div className="flex flex-col gap-1.5 text-[10px] leading-tight">
            <div className="flex justify-between items-center py-0.5 border-b border-white/5">
              <span className="text-zinc-400">Stream Source:</span>
              <span className="text-white font-bold">{nerdStats.protocol}</span>
            </div>

            <div className="flex justify-between items-center py-0.5 border-b border-white/5">
              <span className="text-zinc-400">Viewport / DPR:</span>
              <span className="text-zinc-200">{nerdStats.viewport} <span className="text-zinc-400">({nerdStats.dpr}x)</span></span>
            </div>

            <div className="flex justify-between items-center py-0.5 border-b border-white/5">
              <span className="text-zinc-400">Native Resolution:</span>
              <span className="text-red-500 font-bold">{nerdStats.optimalRes}</span>
            </div>

            <div className="flex justify-between items-center py-0.5 border-b border-white/5">
              <span className="text-zinc-400">Aspect Ratio / Fit:</span>
              <span className="text-zinc-200">{videoRatio.toFixed(3)}:1 <span className="text-amber-400 uppercase font-semibold">({aspectMode})</span></span>
            </div>

            {/* Live Playback FPS */}
            <div className="flex justify-between items-center bg-white/5 px-2 py-1 rounded-lg my-0.5">
              <span className="text-zinc-300 flex items-center gap-1">
                <Zap className="w-3 h-3 text-emerald-400" /> Live FPS (จริง / เป้าหมาย):
              </span>
              <span className="font-bold font-mono">
                <span className={
                  !isPlaying
                    ? 'text-zinc-400'
                    : (currentFpsNumber > 0 && currentFpsNumber < targetFpsNumber - 4)
                      ? 'text-rose-400'
                      : 'text-emerald-400'
                }>
                  {isPlaying ? realtimeFps : '0.0'}
                </span>
                <span className="text-zinc-400 font-normal"> / {fps || 30} fps</span>
              </span>
            </div>

            {/* Dropped Frames with Highlight */}
            <div className="flex justify-between items-center py-0.5 border-b border-white/5">
              <span className="text-zinc-400">Dropped Frames:</span>
              <span className={nerdStats.droppedFrames > 10 ? 'text-rose-400 font-bold' : 'text-zinc-200'}>
                {nerdStats.droppedFrames} / {nerdStats.totalFrames} <span className="text-zinc-400">({nerdStats.dropRate})</span>
              </span>
            </div>

            <div className="flex justify-between items-center py-0.5 border-b border-white/5">
              <span className="text-zinc-400">Video Codec:</span>
              <span className="text-zinc-100 uppercase font-bold">{codec}</span>
            </div>

            {/* Buffer Health Meter */}
            <div className="flex flex-col gap-1 pt-1">
              <div className="flex justify-between items-center">
                <span className="text-zinc-400">Buffer Health:</span>
                <span className={`font-bold ${nerdStats.bufferHealth > 15 ? 'text-emerald-400' : nerdStats.bufferHealth > 5 ? 'text-amber-400' : 'text-rose-400'}`}>
                  {nerdStats.bufferHealth.toFixed(1)} s
                </span>
              </div>
              <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 rounded-full ${nerdStats.bufferHealth > 15 ? 'bg-emerald-400' : nerdStats.bufferHealth > 5 ? 'bg-amber-400' : 'bg-rose-400'
                    }`}
                  style={{ width: `${Math.min((nerdStats.bufferHealth / 40) * 100, 100)}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* YouTube-Style Context Menu */}
      {contextMenu && (
        <div
          className="absolute z-50 bg-[#1f1f1f]/65 border border-white/15 rounded-xl py-1.5 w-56 text-xs text-zinc-200 shadow-2xl backdrop-blur-md"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
          onMouseLeave={() => setContextMenu(null)}
        >
          <button
            type="button"
            onClick={() => {
              if (video.current) {
                const nextLoop = !isLooping;
                video.current.loop = nextLoop;
                setIsLooping(nextLoop);
                showToast(nextLoop ? 'เปิดการเล่นวนซ้ำ' : 'ปิดการเล่นวนซ้ำ');
              }
              setContextMenu(null);
            }}
            className="w-full flex items-center justify-between px-3.5 py-2 hover:bg-white/10 text-left transition cursor-pointer"
          >
            <span>เล่นวนซ้ำ (Loop)</span>
            {isLooping && <Check className="w-3.5 h-3.5 text-[#FF7A00]" />}
          </button>

          <button
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined') {
                navigator.clipboard.writeText(window.location.href);
                showToast('คัดลอก URL ของวิดีโอแล้ว');
              }
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3.5 py-2 hover:bg-white/10 text-left transition cursor-pointer border-t border-white/5"
          >
            <Copy className="w-3.5 h-3.5 text-zinc-400" />
            <span>คัดลอก URL ของวิดีโอ</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined' && video.current) {
                const url = new URL(window.location.href);
                url.searchParams.set('t', Math.floor(video.current.currentTime || 0));
                navigator.clipboard.writeText(url.toString());
                showToast(`คัดลอก URL ที่เวลา ${formatTime(video.current.currentTime)} แล้ว`);
              }
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3.5 py-2 hover:bg-white/10 text-left transition cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5 text-zinc-400" />
            <span>คัดลอก URL ตามเวลาปัจจุบัน</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setShowStats(!showStats);
              setContextMenu(null);
            }}
            className="w-full flex items-center justify-between px-3.5 py-2 hover:bg-white/10 text-left transition cursor-pointer border-t border-white/5"
          >
            <span className="flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
              <span>สถิติสำหรับเด็กเนิร์ด</span>
            </span>
            {showStats && <Check className="w-3.5 h-3.5 text-[#FF7A00]" />}
          </button>
        </div>
      )}

      {/* Multi-Tab Settings Menu (Positioned dynamically above or below clicked gear button) */}
      {showSettingsMenu && (
        <div
          ref={settingsMenuRef}
          className={`absolute ${settingsPlacement === 'top'
            ? 'top-14 right-3 sm:right-6'
            : 'bottom-18 right-3 sm:right-6'
            } bg-[#18181B]/65 border border-white/15 rounded-2xl py-1.5 w-56 text-xs text-zinc-200 z-40 shadow-2xl overflow-hidden backdrop-blur-md`}
          onClick={(e) => e.stopPropagation()}
        >
          {activeMenuTab === 'main' && (
            <div className="flex flex-col">
              <button
                type="button"
                disabled={levels.length <= 1}
                onClick={() => setActiveMenuTab('quality')}
                className="w-full flex items-center justify-between px-3.5 py-2.5 hover:bg-white/10 transition disabled:opacity-50 cursor-pointer"
              >
                <span className="text-zinc-300">คุณภาพ</span>
                <span className="text-[#FF7A00] font-semibold flex items-center gap-1 font-mono">
                  {currentLevelIndex === -1 ? `Auto (${activeLevelLabel})` : activeLevelLabel}
                  {levels.length > 1 && <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveMenuTab('speed')}
                className="w-full flex items-center justify-between px-3.5 py-2.5 hover:bg-white/10 transition border-t border-white/5 cursor-pointer"
              >
                <span className="text-zinc-300">ความเร็ว</span>
                <span className="text-[#FF7A00] flex items-center gap-1 font-mono font-semibold">
                  {playbackRate === 1 ? 'ปกติ' : `${playbackRate}x`}
                  <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveMenuTab('aspect')}
                className="w-full flex items-center justify-between px-3.5 py-2.5 hover:bg-white/10 transition border-t border-white/5 cursor-pointer"
              >
                <span className="text-zinc-300">สัดส่วนวิดีโอ</span>
                <span className="text-amber-400 flex items-center gap-1 uppercase font-semibold">
                  {aspectMode === 'crop' ? 'ตัดขอบดำ' : aspectMode === 'fill' ? 'เต็มจอ' : 'พอดี'}
                  <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
                </span>
              </button>
            </div>
          )}

          {activeMenuTab === 'quality' && (
            <div className="flex flex-col max-h-56 overflow-y-auto">
              <div className="px-3.5 py-2 text-[10px] text-zinc-400 border-b border-white/10 flex justify-between items-center">
                <span>เลือกระดับความละเอียด</span>
                <button type="button" onClick={() => setActiveMenuTab('main')} className="text-[#FF7A00] font-semibold cursor-pointer">กลับ</button>
              </div>

              <button
                type="button"
                onClick={() => handleSelectQuality(-1)}
                className="w-full flex items-center justify-between px-3.5 py-2 hover:bg-white/10 text-left transition cursor-pointer"
              >
                <span className={currentLevelIndex === -1 ? 'text-[#FF7A00] font-semibold' : ''}>
                  Auto {currentLevelIndex === -1 && `(${activeLevelLabel})`}
                </span>
                {currentLevelIndex === -1 && <Check className="w-3.5 h-3.5 text-[#FF7A00]" />}
              </button>

              {[...levels].sort((a, b) => (b.height || 0) - (a.height || 0)).map((lvl) => {
                const isSelected = currentLevelIndex === lvl.index;
                return (
                  <button
                    key={lvl.index}
                    type="button"
                    onClick={() => handleSelectQuality(lvl.index)}
                    className="w-full flex items-center justify-between px-3.5 py-2 hover:bg-white/10 text-left transition font-mono cursor-pointer"
                  >
                    <span className={isSelected ? 'text-[#FF7A00] font-semibold' : ''}>
                      {lvl.label}
                    </span>
                    {isSelected && <Check className="w-3.5 h-3.5 text-[#FF7A00]" />}
                  </button>
                );
              })}
            </div>
          )}

          {activeMenuTab === 'speed' && (
            <div>
              <div className="px-3.5 py-2 text-[10px] text-zinc-400 border-b border-white/10 flex justify-between items-center">
                <span>เลือกความเร็วการเล่น</span>
                <button type="button" onClick={() => setActiveMenuTab('main')} className="text-[#FF7A00] font-semibold cursor-pointer">กลับ</button>
              </div>
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                <button
                  key={rate}
                  type="button"
                  onClick={() => {
                    if (!video.current) return;
                    video.current.playbackRate = rate;
                    setPlaybackRate(rate);
                    showToast(`ความเร็ว: ${rate}x`);
                    setShowSettingsMenu(false);
                    resetControlsTimer();
                  }}
                  className="w-full flex items-center justify-between px-3.5 py-2 hover:bg-white/10 text-left transition font-mono cursor-pointer"
                >
                  <span className={playbackRate === rate ? 'text-[#FF7A00] font-semibold' : ''}>
                    {rate === 1 ? 'ปกติ (1x)' : `${rate}x`}
                  </span>
                  {playbackRate === rate && <Check className="w-3.5 h-3.5 text-[#FF7A00]" />}
                </button>
              ))}
            </div>
          )}

          {activeMenuTab === 'aspect' && (
            <div>
              <div className="px-3.5 py-2 text-[10px] text-zinc-400 border-b border-white/10 flex justify-between items-center">
                <span>เลือกสัดส่วนภาพ</span>
                <button type="button" onClick={() => setActiveMenuTab('main')} className="text-[#FF7A00] font-semibold cursor-pointer">กลับ</button>
              </div>
              {[
                { key: 'fit', label: 'พอดีเฟรม (Fit)', desc: 'แสดงตามสัดส่วนจริง ไม่ครอป' },
                { key: 'crop', label: 'ตัดขอบดำ (Crop)', desc: 'ซูมตัดแถบดำบน-ล่างออก' },
                { key: 'fill', label: 'ขยายเต็มจอ (Fill)', desc: 'ขยายให้เต็มกล่องเครื่องเล่น' },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    setAspectMode(item.key);
                    showToast(`สัดส่วน: ${item.label}`);
                    setShowSettingsMenu(false);
                    resetControlsTimer();
                  }}
                  className="w-full flex items-center justify-between px-3.5 py-2.5 hover:bg-white/10 text-left transition cursor-pointer"
                >
                  <div className="flex flex-col">
                    <span className={aspectMode === item.key ? 'text-[#FF7A00] font-semibold' : ''}>
                      {item.label}
                    </span>
                    <span className="text-[9px] text-zinc-400">{item.desc}</span>
                  </div>
                  {aspectMode === item.key && <Check className="w-3.5 h-3.5 text-[#FF7A00]" />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modern High-Performance Bottom Controls Bar */}
      <div
        className={`absolute bottom-0 left-0 right-0 px-4 sm:px-6 pb-3 pt-8 bg-gradient-to-t from-black/95 via-black/40 to-transparent flex flex-col gap-2 z-30 transition-all duration-200 ${(showControls || !isPlaying || isScrubbing)
          ? 'opacity-100 pointer-events-auto translate-y-0'
          : 'opacity-0 pointer-events-none translate-y-1'
          }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Seekbar with Direct DOM Updates */}
        <div
          ref={seekTrackRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handleSeekMouseMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onMouseEnter={() => setIsHoveringSeek(true)}
          onMouseLeave={() => setIsHoveringSeek(false)}
          className="relative flex items-center h-5 cursor-pointer touch-none group/seek"
        >
          {/* YouTube-Style Timeline Thumbnail Scrub Preview Window */}
          <div
            ref={scrubPreviewRef}
            className={`absolute bottom-[calc(100%+14px)] -translate-x-1/2 flex flex-col items-center pointer-events-none z-40 transition-opacity duration-150 ease-out ${(isScrubbing || isHoveringSeek)
              ? 'opacity-100 scale-100 translate-y-0'
              : 'opacity-0 scale-90 translate-y-2 pointer-events-none'
              }`}
            style={{ left: `${Math.max(10, Math.min(isScrubbing ? previewPercent : hoverPercent, 90))}%` }}
          >
            {/* Preview Frame Thumbnail Card */}
            <div
              className="w-44 sm:w-52 rounded-xl overflow-hidden border-2 border-white/60 bg-zinc-950 shadow-[0_8px_30px_rgba(0,0,0,0.9)] relative mb-1.5 ring-1 ring-black/80"
              style={{ aspectRatio: videoRatio }}
            >
              {/* Poster fallback layer: always present underneath so it NEVER turns pure black */}
              {poster && (
                <img
                  src={poster}
                  alt="Thumbnail Preview"
                  className="absolute inset-0 w-full h-full object-cover opacity-75"
                />
              )}
              {/* Tier 1: Fast SD Sprite Sheet Layer (0ms Scrubbing) */}
              <div
                ref={scrubThumbSdRef}
                className="absolute inset-0 w-full h-full bg-no-repeat z-10 opacity-0"
              />
              {/* Tier 2: Sharp HD Sprite Sheet Layer (Fade in when hovering > 300ms) */}
              <div
                ref={scrubThumbHdRef}
                className="absolute inset-0 w-full h-full bg-no-repeat z-20 opacity-0 transition-opacity duration-200"
              />
              {/* Subtle vignette */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/10 pointer-events-none z-20" />
            </div>

            {/* Time Badge */}
            <div
              ref={scrubBadgeRef}
              className="bg-black/90 text-white border border-white/20 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold shadow-xl whitespace-nowrap backdrop-blur-md"
            >
              {formatTime(isScrubbing ? previewTime : hoverTime)}
            </div>
          </div>

          {/* Progress Background Track */}
          <div className="w-full h-1 group-hover/seek:h-1.5 bg-white/20 rounded-full overflow-hidden relative pointer-events-none transition-all duration-150">
            {/* Buffer Track (Direct DOM) */}
            <div
              ref={bufferBarRef}
              className="absolute left-0 top-0 bottom-0 bg-white/40"
              style={{ width: `${initialBufferPct}%` }}
            />
            {/* Hover Preview Track */}
            {isHoveringSeek && !isScrubbing && (
              <div
                className="absolute left-0 top-0 bottom-0 bg-white/30"
                style={{ width: `${hoverPercent}%` }}
              />
            )}
            {/* Playback Progress (Direct DOM - TubeLock Orange) */}
            <div
              ref={progressBarRef}
              className="absolute left-0 top-0 bottom-0 bg-[#FF7A00]"
              style={{ width: `${activeScrubPercent}%` }}
            />
          </div>

          {/* Scrubber Knob (Direct DOM - TubeLock Orange) */}
          <div
            ref={scrubberKnobRef}
            className={`absolute -translate-x-1/2 w-3.5 h-3.5 bg-[#FF7A00] ring-2 ring-white/90 rounded-full shadow-md pointer-events-none transition-transform duration-100 ${isScrubbing ? 'scale-125' : 'scale-100 sm:scale-0 sm:group-hover/seek:scale-100'
              }`}
            style={{ left: `${activeScrubPercent}%` }}
          />
        </div>

        {/* Bottom Bar: Clean division between Desktop (Windowed & Fullscreen) and Mobile */}
        {!isMobileView ? (
          /* ============================================================ */
          /* PC DESKTOP BOTTOM BAR (Matches YouTube Screenshots 2 & 3)    */
          /* ============================================================ */
          <div className="flex items-center justify-between text-white text-xs pt-1 px-1 sm:px-2 select-none">
            {/* Left Controls: Play/Pause, Volume + Hover Slider, Time Display */}
            <div className="flex items-center gap-2 sm:gap-3.5">
              {/* Play/Pause */}
              <button
                type="button"
                onClick={togglePlay}
                className="active:scale-90 transition cursor-pointer p-1.5 rounded-lg hover:bg-white/15"
                title={isPlaying ? 'หยุดชั่วคราว (k)' : 'เล่น (k)'}
              >
                {isPlaying ? <Pause className="w-5 h-5 fill-white" /> : <Play className="w-5 h-5 fill-white ml-0.5" />}
              </button>

              {/* YouTube Expandable Volume Slider */}
              <div
                className="flex items-center group/vol relative"
                onMouseEnter={() => setShowVolumeSlider(true)}
                onMouseLeave={() => setShowVolumeSlider(false)}
              >
                <button
                  type="button"
                  onClick={toggleMute}
                  className="cursor-pointer p-1.5 rounded-lg hover:bg-white/15 transition"
                  title={isMuted ? 'เปิดเสียง (m)' : 'ปิดเสียง (m)'}
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-5 h-5 fill-white text-white" />
                  ) : volume < 0.5 ? (
                    <Volume1 className="w-5 h-5 fill-white text-white" />
                  ) : (
                    <Volume2 className="w-5 h-5 fill-white text-white" />
                  )}
                </button>

                <div className={`overflow-hidden transition-all duration-200 flex items-center ${showVolumeSlider ? 'w-20 sm:w-24 opacity-100 ml-1' : 'w-0 opacity-0 pointer-events-none'
                  }`}>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={isMuted ? 0 : volume}
                    onChange={handleVolumeChange}
                    className="w-full h-1 bg-white/30 rounded-full cursor-pointer accent-white appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white"
                  />
                </div>
              </div>

              {/* Time Display */}
              <span ref={timeDisplayRef} className="font-mono text-xs text-zinc-200 select-none font-medium ml-1">
                {activeTimeDisplay}
              </span>
            </div>

            {/* Right Controls: Desktop Fullscreen vs Desktop Windowed */}
            <div className="flex items-center gap-1 sm:gap-2">
              {/* On PC Fullscreen: Like, Dislike, Comment, Share, More (Matches Screenshot 2) */}
              {isFullscreen && (
                <div className="flex items-center gap-1 sm:gap-2 mr-2 border-r border-white/15 pr-2">
                  <button
                    type="button"
                    onClick={() => {
                      const next = !isLiked;
                      setIsLiked(next);
                      if (next && isDisliked) setIsDisliked(false);
                      showToast(next ? 'ถูกใจวิดีโอแล้ว' : 'ยกเลิกการถูกใจ');
                    }}
                    className={`p-1.5 rounded-full hover:bg-white/15 active:scale-90 transition cursor-pointer ${isLiked ? 'text-[#FF7A00] bg-white/15' : 'text-zinc-200 hover:text-white'
                      }`}
                    title="ถูกใจ"
                  >
                    <ThumbsUp className="w-4.5 h-4.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const next = !isDisliked;
                      setIsDisliked(next);
                      if (next && isLiked) setIsLiked(false);
                      showToast(next ? 'ไม่ชอบวิดีโอ' : 'ยกเลิก');
                    }}
                    className={`p-1.5 rounded-full hover:bg-white/15 active:scale-90 transition cursor-pointer ${isDisliked ? 'text-zinc-400 bg-white/15' : 'text-zinc-200 hover:text-white'
                      }`}
                    title="ไม่ชอบ"
                  >
                    <ThumbsDown className="w-4.5 h-4.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => showToast('ส่วนความคิดเห็น')}
                    className="p-1.5 rounded-full hover:bg-white/15 active:scale-90 transition cursor-pointer text-zinc-200 hover:text-white"
                    title="ความคิดเห็น"
                  >
                    <MessageSquare className="w-4.5 h-4.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (typeof window !== 'undefined') {
                        navigator.clipboard.writeText(window.location.href);
                        showToast('คัดลอกลิงก์วิดีโอแล้ว');
                      }
                    }}
                    className="p-1.5 rounded-full hover:bg-white/15 active:scale-90 transition cursor-pointer text-zinc-200 hover:text-white"
                    title="แชร์วิดีโอ"
                  >
                    <Share2 className="w-4.5 h-4.5" />
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setContextMenu({ x: rect.left, y: Math.max(10, rect.top - 180) });
                    }}
                    className="p-1.5 rounded-full hover:bg-white/15 active:scale-90 transition cursor-pointer text-zinc-200 hover:text-white"
                    title="เพิ่มเติม"
                  >
                    <MoreHorizontal className="w-4.5 h-4.5" />
                  </button>
                </div>
              )}

              {/* Autoplay Switch (YouTube Style) */}
              <button
                type="button"
                onClick={() => {
                  const next = !isAutoplay;
                  setIsAutoplay(next);
                  showToast(next ? 'เปิดการเล่นอัตโนมัติ' : 'ปิดการเล่นอัตโนมัติ');
                }}
                className={`relative inline-flex h-4.5 w-8 items-center rounded-full transition-colors cursor-pointer mr-1 ${isAutoplay ? 'bg-white' : 'bg-white/30'
                  }`}
                title={isAutoplay ? 'การเล่นอัตโนมัติเปิดอยู่' : 'การเล่นอัตโนมัติปิดอยู่'}
              >
                <span
                  className={`inline-flex items-center justify-center h-3 w-3 transform rounded-full transition-transform ${isAutoplay ? 'translate-x-4 bg-black' : 'translate-x-1 bg-white'
                    }`}
                >
                  {isAutoplay ? (
                    <Play className="w-1.5 h-1.5 fill-current text-white" />
                  ) : (
                    <Pause className="w-1.5 h-1.5 fill-current text-black" />
                  )}
                </span>
              </button>

              {/* CC (Subtitles) */}
              <button
                type="button"
                onClick={() => {
                  setIsCcActive(!isCcActive);
                  showToast(isCcActive ? 'ปิดคำบรรยาย' : 'ยังไม่มีไฟล์คำบรรยาย (CC)');
                }}
                className={`p-1.5 rounded-lg hover:bg-white/15 transition cursor-pointer ${isCcActive ? 'text-[#FF7A00] bg-white/15' : 'text-zinc-200 hover:text-white'
                  }`}
                title="คำบรรยาย (c)"
              >
                <Subtitles className="w-4.5 h-4.5" />
              </button>

              {/* Settings Gear with 4K Badge */}
              <button
                type="button"
                data-settings-btn="true"
                onClick={() => {
                  setSettingsPlacement('bottom');
                  setShowSettingsMenu(!showSettingsMenu);
                  setActiveMenuTab('main');
                }}
                title="การตั้งค่าเครื่องเล่น"
                className={`relative p-1.5 rounded-lg transition cursor-pointer ${showSettingsMenu ? 'text-[#FF7A00] bg-white/15' : 'text-zinc-200 hover:text-white hover:bg-white/15'
                  }`}
              >
                <Settings className="w-4.5 h-4.5" />
                {is4K ? (
                  <span className="absolute -top-1 -right-1 bg-red-600 text-white font-extrabold text-[7px] leading-tight px-1 py-0.5 rounded shadow pointer-events-none">
                    4K
                  </span>
                ) : isHD ? (
                  <span className="absolute -top-1 -right-1 bg-red-600 text-white font-extrabold text-[7px] leading-tight px-0.5 py-0.5 rounded shadow pointer-events-none">
                    HD
                  </span>
                ) : null}
              </button>

              {/* Miniplayer (PiP - Only in windowed mode) */}
              {!isFullscreen && (
                <button
                  type="button"
                  onClick={togglePiP}
                  title="เล่นแบบหน้าต่างลอย (PiP)"
                  className="p-1.5 rounded-lg text-zinc-200 hover:text-white hover:bg-white/15 transition cursor-pointer"
                >
                  <PictureInPicture2 className="w-4.5 h-4.5" />
                </button>
              )}

              {/* Aspect Ratio */}
              <button
                type="button"
                onClick={cycleAspectMode}
                title={`สัดส่วน: ${aspectMode.toUpperCase()} (คลิกเพื่อเปลี่ยน)`}
                className={`px-2 py-1 rounded-lg transition cursor-pointer flex items-center gap-1 font-mono uppercase text-[11px] font-semibold ${aspectMode !== 'fit' ? 'text-[#FF7A00] bg-white/15' : 'text-zinc-200 hover:text-white hover:bg-white/15'
                  }`}
              >
                {aspectMode === 'crop' ? <Crop className="w-4 h-4" /> : aspectMode === 'fill' ? <Scan className="w-4 h-4" /> : <Expand className="w-4 h-4" />}
                <span>{aspectMode}</span>
              </button>

              {/* Fullscreen Toggle */}
              <button
                type="button"
                onClick={toggleFullscreen}
                title={isFullscreen ? 'ออกจากเต็มจอ (f)' : 'เต็มจอ (f)'}
                className="p-1.5 rounded-lg text-white hover:bg-white/15 transition cursor-pointer active:scale-90"
              >
                {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
              </button>
            </div>
          </div>
        ) : isFullscreen ? (
          /* ============================================================ */
          /* MOBILE FULLSCREEN BOTTOM BAR                                 */
          /* ============================================================ */
          <div className="flex items-center justify-between text-white text-xs pt-1 px-1">
            {/* Left Action Buttons */}
            <div className="flex items-center gap-1.5">
              <span ref={timeDisplayRef} className="font-mono text-xs text-zinc-200 font-medium mr-1 select-none">
                {activeTimeDisplay}
              </span>

              {/* Like */}
              <button
                type="button"
                onClick={() => {
                  const next = !isLiked;
                  setIsLiked(next);
                  if (next && isDisliked) setIsDisliked(false);
                  showToast(next ? 'ถูกใจวิดีโอแล้ว' : 'ยกเลิกการถูกใจ');
                }}
                className={`p-1.5 rounded-full hover:bg-white/15 active:scale-90 transition cursor-pointer ${isLiked ? 'text-[#FF7A00] bg-white/15' : 'text-zinc-200 hover:text-white'
                  }`}
                title="ถูกใจ"
              >
                <ThumbsUp className="w-4.5 h-4.5" />
              </button>

              {/* Dislike */}
              <button
                type="button"
                onClick={() => {
                  const next = !isDisliked;
                  setIsDisliked(next);
                  if (next && isLiked) setIsLiked(false);
                  showToast(next ? 'ไม่ชอบวิดีโอ' : 'ยกเลิก');
                }}
                className={`p-1.5 rounded-full hover:bg-white/15 active:scale-90 transition cursor-pointer ${isDisliked ? 'text-zinc-400 bg-white/15' : 'text-zinc-200 hover:text-white'
                  }`}
                title="ไม่ชอบ"
              >
                <ThumbsDown className="w-4.5 h-4.5" />
              </button>

              {/* Comments */}
              <button
                type="button"
                onClick={() => showToast('ส่วนความคิดเห็น')}
                className="p-1.5 rounded-full hover:bg-white/15 active:scale-90 transition cursor-pointer text-zinc-200 hover:text-white"
                title="ความคิดเห็น"
              >
                <MessageSquare className="w-4.5 h-4.5" />
              </button>

              {/* Save */}
              <button
                type="button"
                onClick={() => {
                  const next = !isSaved;
                  setIsSaved(next);
                  showToast(next ? 'บันทึกในเพลย์ลิสต์แล้ว' : 'นำออกจากเพลย์ลิสต์');
                }}
                className={`p-1.5 rounded-full hover:bg-white/15 active:scale-90 transition cursor-pointer ${isSaved ? 'text-[#FF7A00] bg-white/15' : 'text-zinc-200 hover:text-white'
                  }`}
                title="บันทึกในเพลย์ลิสต์"
              >
                <Plus className="w-4.5 h-4.5" />
              </button>

              {/* Share */}
              <button
                type="button"
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    navigator.clipboard.writeText(window.location.href);
                    showToast('คัดลอกลิงก์วิดีโอแล้ว');
                  }
                }}
                className="p-1.5 rounded-full hover:bg-white/15 active:scale-90 transition cursor-pointer text-zinc-200 hover:text-white"
                title="แชร์วิดีโอ"
              >
                <Share2 className="w-4.5 h-4.5" />
              </button>

              {/* More */}
              <button
                type="button"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setContextMenu({ x: rect.left, y: Math.max(10, rect.top - 180) });
                }}
                className="p-1.5 rounded-full hover:bg-white/15 active:scale-90 transition cursor-pointer text-zinc-200 hover:text-white"
                title="เพิ่มเติม"
              >
                <MoreHorizontal className="w-4.5 h-4.5" />
              </button>
            </div>

            {/* Right: Aspect ratio + Exit Fullscreen */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={cycleAspectMode}
                title={`สัดส่วน: ${aspectMode.toUpperCase()}`}
                className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white font-mono uppercase text-[11px] font-semibold transition active:scale-90 cursor-pointer flex items-center gap-1"
              >
                {aspectMode === 'crop' ? <Crop className="w-4 h-4" /> : aspectMode === 'fill' ? <Scan className="w-4 h-4" /> : <Expand className="w-4 h-4" />}
                <span>{aspectMode}</span>
              </button>

              <button
                type="button"
                onClick={toggleFullscreen}
                title="ออกจากเต็มจอ"
                className="p-1.5 rounded-lg text-white hover:bg-white/15 transition active:scale-90 cursor-pointer"
              >
                <Minimize className="w-5 h-5" />
              </button>
            </div>
          </div>
        ) : (
          /* ============================================================ */
          /* MOBILE PORTRAIT BOTTOM BAR                                   */
          /* ============================================================ */
          <div className="flex items-center justify-between text-white text-xs pt-0.5">
            <span ref={timeDisplayRef} className="font-mono text-xs text-zinc-300 font-medium select-none">
              {activeTimeDisplay}
            </span>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={cycleAspectMode}
                title={`สัดส่วน: ${aspectMode.toUpperCase()}`}
                className={`p-1.5 rounded-lg transition active:scale-90 flex items-center gap-1 text-[11px] cursor-pointer ${aspectMode !== 'fit' ? 'text-[#FF7A00] bg-white/10 font-bold' : 'text-zinc-200'
                  }`}
              >
                {aspectMode === 'crop' ? <Crop className="w-4 h-4" /> : aspectMode === 'fill' ? <Scan className="w-4 h-4" /> : <Expand className="w-4 h-4" />}
              </button>

              <button
                type="button"
                onClick={toggleFullscreen}
                title="เต็มจอ"
                className="p-1.5 rounded-lg text-white hover:bg-white/15 transition active:scale-90 cursor-pointer"
              >
                <Maximize className="w-4.5 h-4.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
