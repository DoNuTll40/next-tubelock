'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { formatResolutionBadge } from '@/lib/videoUtils';
import { formatTime } from './player/playerUtils';
import PlayerTopBar from './player/PlayerTopBar';
import PlayerCenterControls from './player/PlayerCenterControls';
import PlayerBottomBar from './player/PlayerBottomBar';
import PlayerSettingsModal from './player/PlayerSettingsModal';
import PlayerStatsModal from './player/PlayerStatsModal';
import PlayerContextMenu from './player/PlayerContextMenu';

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
  onRatioChange = null,
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

  // Video aspect ratio & vertical detection
  const [videoRatio, setVideoRatio] = useState(() => {
    if (typeof resolution === 'string' && resolution.includes('x')) {
      const parts = resolution.split('x');
      const w = parseFloat(parts[0]);
      const h = parseFloat(parts[1]);
      if (w > 0 && h > 0) return w / h;
    }
    return 16 / 9;
  });

  const updateRatio = useCallback((newRatio) => {
    if (newRatio && newRatio > 0 && !isNaN(newRatio)) {
      setVideoRatio(newRatio);
      if (onRatioChange) onRatioChange(newRatio);
    }
  }, [onRatioChange]);

  const [isVerticalVideo, setIsVerticalVideo] = useState(() => {
    if (typeof resolution === 'string' && resolution.includes('x')) {
      const parts = resolution.split('x');
      const w = parseFloat(parts[0]);
      const h = parseFloat(parts[1]);
      if (w > 0 && h > 0) return h > w;
    }
    return false;
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
            startLevel: -1, // Auto level selection (ensures safety when only 1 level like 144p is available)
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

              // Auto-detect aspect ratio from highest or initial HLS level
              const bestLevel = data.levels[0];
              if (bestLevel?.width && bestLevel?.height) {
                const isVertical = bestLevel.height > bestLevel.width;
                setIsVerticalVideo(isVertical);
                updateRatio(bestLevel.width / bestLevel.height);
              }
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
              if (lvl.width && lvl.height) {
                const isVertical = lvl.height > lvl.width;
                setIsVerticalVideo(isVertical);
                updateRatio(lvl.width / lvl.height);
              }
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

  // Quality selector (100% Smooth switch: updates nextLevel only, so existing buffer plays continuously without reloading stream, pausing, or showing spinner)
  const handleSelectQuality = (levelIdx) => {
    setCurrentLevelIndex(levelIdx);
    if (hlsInstanceRef.current) {
      hlsInstanceRef.current.nextLevel = levelIdx;
      if (levelIdx === -1) {
        showToast('ความละเอียด : Auto (ปรับตามเน็ต)');
      } else {
        const selected = levels.find((l) => l.index === levelIdx);
        if (selected) {
          setActiveLevelLabel(selected.label);
          showToast(`ความละเอียด : ${selected.label}`);
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

  // Fast Seek Commit (Direct currentTime assignment with instant DOM sync)
  const commitSeek = useCallback((targetTime) => {
    if (!video.current) return;
    const dur = video.current.duration || duration;
    const clamped = Math.min(Math.max(targetTime, 0), dur > 0 ? dur : targetTime);
    
    // Always assign currentTime directly for 100% reliable seeking across all browsers
    try {
      video.current.currentTime = clamped;
    } catch (_) {}

    // Immediate DOM updates so timeline and counter update instantly even when video is paused
    if (dur > 0) {
      const pct = (clamped / dur) * 100;
      if (progressBarRef.current) progressBarRef.current.style.width = `${pct}%`;
      if (scrubberKnobRef.current) scrubberKnobRef.current.style.left = `${pct}%`;
      if (timeDisplayRef.current) {
        timeDisplayRef.current.textContent = `${formatTime(clamped)} / ${formatTime(dur)}`;
      }
    }
    setPreviewTime(clamped);
    setPreviewPercent(dur > 0 ? (clamped / dur) * 100 : 0);
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
      setIsHoveringSeek(false);
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

        // 📱 Auto orientation lock:
        // Horizontal video -> lock to landscape (หมุนนอนอัตโนมัติ)
        // Vertical video (Shorts / 9:16 / Reels) -> lock to portrait (แนวตั้งตามวิดีโอ ไม่ต้องนอน)
        if (typeof window !== 'undefined' && window.screen?.orientation?.lock) {
          try {
            const vEl = video.current;
            const isVertical = (vEl && vEl.videoHeight > 0 && vEl.videoWidth > 0 && vEl.videoHeight > vEl.videoWidth)
              || isVerticalVideo
              || (videoRatio < 0.95);

            if (isVertical) {
              await window.screen.orientation.lock('portrait').catch(() => {});
            } else {
              await window.screen.orientation.lock('landscape').catch(() => {});
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
        : 'w-full rounded-none sm:rounded-2xl border-0 sm:border sm:border-black/10 shadow-none sm:shadow-md'
        } ${!showControls && isPlaying ? 'cursor-none' : 'cursor-default'}`}
      style={{
        width: isFullscreen ? '100vw' : '100%',
        maxWidth: isFullscreen ? undefined : (isVerticalVideo ? '480px' : undefined),
        aspectRatio: isFullscreen
          ? undefined
          : `${videoRatio}`,
        margin: isVerticalVideo ? '0 auto' : undefined,
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
            const isVertical = videoHeight > videoWidth;
            setIsVerticalVideo(isVertical);
            updateRatio(videoWidth / videoHeight);
          }
        }}
        onLoadedMetadata={(e) => {
          const { videoWidth, videoHeight, duration: dur } = e.target;
          if (videoWidth && videoHeight) {
            const isVertical = videoHeight > videoWidth;
            setIsVerticalVideo(isVertical);
            updateRatio(videoWidth / videoHeight);
          }
          if (dur) setDuration(dur);
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

      {/* Top Bar: Fullscreen / Mobile */}
      <PlayerTopBar
        showControls={showControls}
        isPlaying={isPlaying}
        isFullscreen={isFullscreen}
        isMobileView={isMobileView}
        title={title}
        channelName={channelName}
        onBack={onBack}
        isAutoplay={isAutoplay}
        setIsAutoplay={setIsAutoplay}
        isCcActive={isCcActive}
        setIsCcActive={setIsCcActive}
        showSettingsMenu={showSettingsMenu}
        setShowSettingsMenu={setShowSettingsMenu}
        setSettingsPlacement={setSettingsPlacement}
        setActiveMenuTab={setActiveMenuTab}
        activeLevelLabel={activeLevelLabel}
        showToast={showToast}
        resetControlsTimer={resetControlsTimer}
      />

      {/* Center Controls & Gestures Feedback */}
      <PlayerCenterControls
        toastMessage={toastMessage}
        centerRipple={centerRipple}
        doubleTapSide={doubleTapSide}
        accumulatedSeconds={accumulatedSeconds}
        showControls={showControls}
        isPlaying={isPlaying}
        isBuffering={isBuffering}
        hlsError={hlsError}
        isMobileView={isMobileView}
        seekStep={seekStep}
        togglePlay={togglePlay}
        commitSeek={commitSeek}
        video={video}
        duration={duration}
        showToast={showToast}
        resetControlsTimer={resetControlsTimer}
      />

      {/* Telemetry HUD (Stats for Nerds) */}
      <PlayerStatsModal
        showStats={showStats}
        setShowStats={setShowStats}
        copyTelemetry={copyTelemetry}
        statsCopied={statsCopied}
        nerdStats={nerdStats}
        videoRatio={videoRatio}
        aspectMode={aspectMode}
        isPlaying={isPlaying}
        realtimeFps={realtimeFps}
        fps={fps}
        codec={codec}
      />

      {/* Custom Context Menu */}
      <PlayerContextMenu
        contextMenu={contextMenu}
        setContextMenu={setContextMenu}
        video={video}
        isLooping={isLooping}
        setIsLooping={setIsLooping}
        showStats={showStats}
        setShowStats={setShowStats}
        showToast={showToast}
      />

      {/* Multi-Tab Settings Menu */}
      <PlayerSettingsModal
        showSettingsMenu={showSettingsMenu}
        setShowSettingsMenu={setShowSettingsMenu}
        settingsMenuRef={settingsMenuRef}
        settingsPlacement={settingsPlacement}
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
      />

      {/* Modern High-Performance Bottom Controls Bar */}
      <PlayerBottomBar
        showControls={showControls}
        isPlaying={isPlaying}
        isScrubbing={isScrubbing}
        isMobileView={isMobileView}
        isFullscreen={isFullscreen}
        activeTimeDisplay={activeTimeDisplay}
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
        setIsCcActive={setIsCcActive}
        showSettingsMenu={showSettingsMenu}
        setShowSettingsMenu={setShowSettingsMenu}
        setSettingsPlacement={setSettingsPlacement}
        setActiveMenuTab={setActiveMenuTab}
        activeLevelLabel={activeLevelLabel}
        togglePiP={togglePiP}
        aspectMode={aspectMode}
        cycleAspectMode={cycleAspectMode}
        toggleFullscreen={toggleFullscreen}
        setContextMenu={setContextMenu}
        showToast={showToast}
        // Scrubber props:
        seekTrackRef={seekTrackRef}
        scrubPreviewRef={scrubPreviewRef}
        scrubThumbSdRef={scrubThumbSdRef}
        scrubThumbHdRef={scrubThumbHdRef}
        scrubBadgeRef={scrubBadgeRef}
        bufferBarRef={bufferBarRef}
        progressBarRef={progressBarRef}
        scrubberKnobRef={scrubberKnobRef}
        isHoveringSeek={isHoveringSeek}
        setIsHoveringSeek={setIsHoveringSeek}
        previewPercent={previewPercent}
        hoverPercent={hoverPercent}
        previewTime={previewTime}
        hoverTime={hoverTime}
        videoRatio={videoRatio}
        poster={poster}
        initialBufferPct={initialBufferPct}
        activeScrubPercent={activeScrubPercent}
        handlePointerDown={handlePointerDown}
        handleSeekMouseMove={handleSeekMouseMove}
        handlePointerUp={handlePointerUp}
        calculateScrubPosition={calculateScrubPosition}
        latestScrubTimeRef={latestScrubTimeRef}
        commitSeek={commitSeek}
        setIsScrubbing={setIsScrubbing}
        isScrubbingRef={isScrubbingRef}
      />
    </div>
  );
}
