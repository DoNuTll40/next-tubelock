'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { formatResolutionBadge, formatQualityLevel } from '@/lib/videoUtils';
import { formatTime, formatTimePair } from './player/playerUtils';
import PlayerTopBar from './player/PlayerTopBar';
import PlayerCenterControls from './player/PlayerCenterControls';
import PlayerBottomBar from './player/PlayerBottomBar';
import PlayerSettingsModal from './player/PlayerSettingsModal';
import PlayerStatsModal from './player/PlayerStatsModal';
import PlayerContextMenu from './player/PlayerContextMenu';
import PlayerEndScreen from './player/PlayerEndScreen';

export default function VideoPlayer({
  src,
  poster,
  storyboard = null,
  title = '',
  channelName = 'TubeLock',
  onBack = null,
  resolution,
  width: initialWidth,
  height: initialHeight,
  aspectRatio: initialRatioProp,
  fps,
  codec = 'h264',
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
  videoRef: externalVideoRef,
  desktopMaxHeight = 'calc(100vh - 100px)',
  ambientMode = true,
  setAmbientMode = null,
  currentVideo = null,
  relatedVideos = [],
}) {
  const video = useRef(null);
  useEffect(() => {
    if (externalVideoRef) {
      externalVideoRef.current = video.current;
    }
  });
  const containerRef = useRef(null);
  const seekTrackRef = useRef(null);
  const hlsInstanceRef = useRef(null);
  const hlsRetryCountRef = useRef(0);

  // Resume / Timestamp seeking support (?t=seconds)
  // For music: always restart from 00:00 (targetInitialTime = 0)
  const initialSeekDoneRef = useRef(false);
  const targetInitialTime = isMusic ? 0 : (Number(initialTime) || 0);

  useEffect(() => {
    initialSeekDoneRef.current = false;
    if (fadeBlackOverlayRef.current) {
      fadeBlackOverlayRef.current.style.transition = 'none';
      fadeBlackOverlayRef.current.style.opacity = '0';
    }
    if (isMusic && videoId && typeof window !== 'undefined') {
      try {
        localStorage.removeItem(`tubelock_pos_${videoId}`);
      } catch (_) { }
    }
  }, [src, videoId, targetInitialTime, isMusic]);

  // Performance Direct-DOM Refs (Prevents React re-render thrashing!)
  const progressBarRef = useRef(null);
  const bufferBarRef = useRef(null);
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
  const [isBuffering, setIsBuffering] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekTime, setSeekTime] = useState(0);
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

  // Scrubbing & Hover Preview
  const [isScrubbing, setIsScrubbing] = useState(false);
  const isScrubbingRef = useRef(false);
  const latestScrubTimeRef = useRef(null);
  useEffect(() => {
    isScrubbingRef.current = isScrubbing;
  }, [isScrubbing]);
  const [scrubPercent, setScrubPercent] = useState(0);
  const [previewTime, setPreviewTime] = useState(0);
  const [previewPercent, setPreviewPercent] = useState(0);
  const [isHoveringSeek, setIsHoveringSeek] = useState(false);
  const [hoverTime, setHoverTime] = useState(0);
  const [hoverPercent, setHoverPercent] = useState(0);
  const lastHoverTimeRef = useRef(0);    // ค้าง hover time ล่าสุด — ใช้ fallback ไม่ให้ preview วิ่งไป 0:00 ตอน mouse leave
  const lastHoverPercentRef = useRef(0); // ค้าง hover position ล่าสุด
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
  const lastSavedHistoryTimeRef = useRef(0);
  const lastReportedSecondRef = useRef(-1);

  // ── Quality View Counting Tracker (Anti-Spam & 15s Watch Threshold) ──
  const accumulatedWatchTimeRef = useRef(0);
  const lastTickTimeRef = useRef(null);
  const viewCountRecordedRef = useRef(false);

  useEffect(() => {
    accumulatedWatchTimeRef.current = 0;
    lastTickTimeRef.current = null;
    viewCountRecordedRef.current = false;
  }, [videoId]);

  const isUserPausedRef = useRef(!defaultAutoplay);
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

  // Initial volume setup
  useEffect(() => {
    if (video.current) {
      video.current.volume = defaultVolume;
      setVolume(defaultVolume);
      video.current.playbackRate = defaultSpeed;
      setPlaybackRate(defaultSpeed);
    }
  }, [defaultVolume, defaultSpeed, video]);

  // Resume / initial seek synchronization (?t=seconds)
  useEffect(() => {
    if (targetInitialTime > 0 && !initialSeekDoneRef.current && video.current) {
      const v = video.current;
      if (v.readyState >= 1) {
        initialSeekDoneRef.current = true;
        try {
          v.currentTime = targetInitialTime;
          setCurrentTime(targetInitialTime);
          const dur = v.duration || duration;
          if (dur > 0) {
            const pct = Math.min((targetInitialTime / dur) * 100, 100);
            if (progressBarRef.current) progressBarRef.current.style.width = `${pct}%`;
            if (scrubberKnobRef.current) scrubberKnobRef.current.style.left = `${pct}%`;
            if (timeDisplayRef.current) {
              timeDisplayRef.current.textContent = `${formatTime(targetInitialTime)} / ${formatTime(dur)}`;
            }
          }
        } catch (_) { }
      }
    }
  }, [targetInitialTime, duration, video]);

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

    // Sync state duration if it drifts (e.g. initial metadata vs decoded fragments)
    if (dur > 0 && Math.abs(dur - duration) > 0.5) {
      setDuration(dur);
    }

    // ถ้า isSeeking หรือ isScrubbing เป็นจริง ห้ามอัปเดต currentTime จากตัว <video> เด็ดขาด (กันค่า 0 ชั่วคราวมาทับ UI)
    if (isSeeking || isSeekingRef.current || isScrubbing || isScrubbingRef.current) {
      return;
    }

    // Throttled React state update: only update currentTime state once per second to prevent 4x/s re-render thrashing
    const curSecFloor = Math.floor(cur);
    if (curSecFloor !== lastReportedSecondRef.current) {
      lastReportedSecondRef.current = curSecFloor;
      setCurrentTime(cur);
    }

    // Direct DOM manipulation - doesn't re-render the 1400 lines of React components!
    if (dur > 0) {
      const pct = (cur / dur) * 100;
      if (progressBarRef.current) {
        progressBarRef.current.style.width = `${pct}%`;
      }
      if (scrubberKnobRef.current) {
        scrubberKnobRef.current.style.left = `${pct}%`;
      }
      if (timeDisplayRef.current) {
        timeDisplayRef.current.textContent = formatTimePair(cur, dur);
      }
    }

    // 🎬 Cinematic Fade to Black (ช่วง ~1.0s สุดท้ายก่อนจบวิดีโอ)
    if (dur > 2) {
      const timeLeft = dur - cur;
      if (timeLeft <= 0.5) {
        if (fadeBlackOverlayRef.current && fadeBlackOverlayRef.current.style.opacity !== '1') {
          fadeBlackOverlayRef.current.style.transition = 'opacity 700ms cubic-bezier(0.4, 0, 0.2, 1)';
          fadeBlackOverlayRef.current.style.opacity = '1';
        }
      } else if (timeLeft > 1) {
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

      // เกณฑ์ 15 วินาที หรือ 30% ของคลิปสั้น
      const minRequired = dur > 0 ? Math.min(15, Math.max(3, dur * 0.3)) : 15;
      if (accumulatedWatchTimeRef.current >= minRequired) {
        viewCountRecordedRef.current = true;

        const storageKey = `tubelock_viewed_${videoId}`;
        const alreadyCountedInSession = typeof window !== 'undefined' && sessionStorage.getItem(storageKey);

        if (!alreadyCountedInSession) {
          if (typeof window !== 'undefined') {
            try { sessionStorage.setItem(storageKey, '1'); } catch (_) { }
          }

          const payload = JSON.stringify({
            watchTime: Math.floor(accumulatedWatchTimeRef.current),
            duration: Math.floor(dur),
          });

          if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
            navigator.sendBeacon(`/api/videos/${videoId}/view`, payload);
          } else {
            fetch(`/api/videos/${videoId}/view`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: payload,
              keepalive: true,
            }).catch(() => { });
          }
        }
      }
    }

    // Trigger external callback periodically (for watch position saving)
    const now = performance.now();
    if (now - lastSavedTimeRef.current > 2000) {
      if (onTimeUpdate) onTimeUpdate(e);
      lastSavedTimeRef.current = now;
    }

    // Auto-save Watch History to database every 5 seconds
    if (videoId && cur > 1 && now - lastSavedHistoryTimeRef.current > 5000) {
      lastSavedHistoryTimeRef.current = now;
      const historyPayload = JSON.stringify({ videoId, position: isMusic ? 0 : Math.floor(cur) });
      if (isMusic) {
        try {
          localStorage.setItem(`tubelock_watched_${videoId}`, '1');
          localStorage.removeItem(`tubelock_pos_${videoId}`);
        } catch (_) { }
      } else {
        try {
          localStorage.setItem(`tubelock_pos_${videoId}`, String(Math.floor(cur)));
        } catch (_) { }
      }
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
    }
  };



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

  // Reliable Autoplay with YouTube-style graceful unmuted -> muted fallback
  const attemptAutoPlay = useCallback(() => {
    const v = video.current;
    if (!v || !defaultAutoplay || isUserPausedRef.current) return;
    if (!v.paused) return;

    const p = v.play();
    if (p !== undefined) {
      p.then(() => {
        setIsPlaying(true);
      }).catch((err) => {
        // Browser Autoplay Policy: if unmuted autoplay is blocked, mute and play immediately!
        if (v && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
          v.muted = true;
          setIsMuted(true);
          v.play()
            .then(() => setIsPlaying(true))
            .catch(() => { });
        }
      });
    }
  }, [defaultAutoplay]);

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

    isUserPausedRef.current = false;
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

          const hls = new Hls({
            startPosition: targetInitialTime > 0 ? targetInitialTime : -1,

            // mobile: บังคับเริ่มที่ level 0 (ต่ำสุด = 144p) แล้วค่อย ramp-up
            // desktop: ปล่อย ABR เลือกเอง (-1)
            startLevel: isMobile ? 0 : -1,

            // คุมระยะเวลาโหลดล่วงหน้า (บนมือถือเอาแค่ 10-15 วิ พอ ไม่ต้องตุนถึง 60 วิ)
            maxBufferLength: 60,
            maxMaxBufferLength: 120,

            // ลดขนาดแคชสูงสุด (มือถือไม่เกิน 30MB, คอมไม่เกิน 60MB)
            maxBufferSize: (isMobile ? 120 : 240) * 1000 * 1000,

            backBufferLength: 5,
            enableWorker: true,
            lowLatencyMode: false,

            fragLoadingTimeOut: 20000,
            fragLoadingMaxRetry: 4,
            manifestLoadingTimeOut: 15000,
            manifestLoadingMaxRetry: 3,
            levelLoadingTimeOut: 15000,
            levelLoadingMaxRetry: 3,

            testBandwidth: true,

            // ปรับลดค่าประเมินเริ่มต้นเหลือ 1.5 - 3 Mbps (แทนที่จะยัดไป 20 Mbps)
            // เพื่อให้ตัวเล่นเริ่มที่ 720p/480p ก่อน แล้วค่อยสลับขึ้น 1080p/4K ถ้ารับไหวจริง
            abrEwmaDefaultEstimate: isMobile ? 1500000 : 3500000,

            fpsDroppedMonitoring: true,
            fpsDroppedMonitoringPeriod: 4000,
            fpsDroppedMonitoringThreshold: 0.2,
          });

          hls.loadSource(src);
          hls.attachMedia(v);
          hlsInstanceRef.current = hls;

          hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
            setIsBuffering(false);
            if (targetInitialTime > 0 && !initialSeekDoneRef.current) {
              initialSeekDoneRef.current = true;
              setCurrentTime(targetInitialTime);
              if (v) {
                try {
                  v.currentTime = targetInitialTime;
                } catch (_) { }
              }
            }
            if (data.levels && data.levels.length > 0) {
              const videoFps = Number(fps) || 0;
              const parsed = data.levels.map((lvl, index) => {
                const lvlFps = lvl.attrs?.['FRAME-RATE'] ? parseFloat(lvl.attrs['FRAME-RATE']) : videoFps;
                const formatted = formatQualityLevel(lvl.height, lvlFps);
                return {
                  index,
                  height: lvl.height,
                  width: lvl.width,
                  bitrate: lvl.bitrate,
                  label: formatted.label,
                  badge: formatted.badge,
                  fullLabel: formatted.fullLabel,
                };
              });
              setLevels(parsed);
              setCurrentLevelIndex(hls.currentLevel);

              // ✨ Quality Persistence: จับคู่ saved height กับ level index จริง
              if (savedStartLevel > 0) {
                const matchIdx = parsed.findIndex((l) => l.height === savedStartLevel);
                if (matchIdx !== -1) {
                  hls.nextLevel = matchIdx;
                  setCurrentLevelIndex(matchIdx);
                  setActiveLevelLabel(parsed[matchIdx].label);
                }
              }

              // Auto-detect aspect ratio from highest HLS level
              const bestLevel = data.levels[0];
              if (bestLevel?.width && bestLevel?.height) {
                updateRatio(bestLevel.width / bestLevel.height);
              }
            }

            attemptAutoPlay();
          });

          hls.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
            const lvl = hls.levels[data.level];
            if (lvl) {
              const lvlFps = lvl.attrs?.['FRAME-RATE'] ? parseFloat(lvl.attrs['FRAME-RATE']) : Number(fps) || 0;
              const formatted = formatQualityLevel(lvl.height, lvlFps);
              setActiveLevelLabel(formatted.label);
              if (lvl.width && lvl.height) {
                updateRatio(lvl.width / lvl.height);
              }
            }
            checkAndUpdateRatio();
          });

          hls.on(Hls.Events.LEVEL_LOADED, (event, data) => {
            const lvl = hls.levels[data.level];
            if (lvl && lvl.width > 0 && lvl.height > 0) {
              updateRatio(lvl.width / lvl.height);
            }
            checkAndUpdateRatio();
          });

          hls.on(Hls.Events.FRAG_BUFFERED, () => {
            checkAndUpdateRatio();
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
          if (targetInitialTime > 0 && !initialSeekDoneRef.current) {
            initialSeekDoneRef.current = true;
            const applySeek = () => {
              try {
                v.currentTime = targetInitialTime;
                setCurrentTime(targetInitialTime);
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
              setCurrentTime(targetInitialTime);
            } catch (_) { }
            v.removeEventListener('loadedmetadata', applySeek);
          };
          if (v.readyState >= 1) {
            applySeek();
          } else {
            v.addEventListener('loadedmetadata', applySeek);
          }
        }
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

  // Quality selector (100% Smooth switch: nextLevel only, no stream reload)
  const handleSelectQuality = (levelIdx) => {
    setCurrentLevelIndex(levelIdx);
    if (hlsInstanceRef.current) {
      hlsInstanceRef.current.nextLevel = levelIdx;
      if (levelIdx === -1) {
        showToast('ความละเอียด : Auto (ปรับตามเน็ต)');
        try { localStorage.removeItem('tubelock_quality_height'); } catch (_) { }
      } else {
        const selected = levels.find((l) => l.index === levelIdx);
        if (selected) {
          setActiveLevelLabel(selected.label);
          showToast(`ความละเอียด : ${selected.label}`);
          // ✨ Persist: เก็บ height ไว้ใน localStorage → คลิปต่อไปจะเริ่มที่ quality นี้เลย
          try { localStorage.setItem('tubelock_quality_height', String(selected.height)); } catch (_) { }
        }
      }
    }
    setShowSettingsMenu(false);
    resetControlsTimer();
  };

  // Instant Play/Pause
  const togglePlay = useCallback(() => {
    if (!video.current) return;

    if (video.current.ended || isEnded) {
      video.current.currentTime = 0;
      setIsEnded(false);
      isUserPausedRef.current = false;
      if (fadeBlackOverlayRef.current) {
        fadeBlackOverlayRef.current.style.transition = 'opacity 300ms ease-out';
        fadeBlackOverlayRef.current.style.opacity = '0';
      }
      video.current.play()
        .then(() => {
          setIsPlaying(true);
        })
        .catch(() => setIsPlaying(false));
      resetControlsTimer();
      return;
    }

    if (video.current.paused) {
      isUserPausedRef.current = false;
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
  }, [video, isEnded, resetControlsTimer]);

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

  // 1. วาง updateStoryboardThumbnail ไว้ก่อน (ข้างบน)
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

      resolvedUrl = spriteMap[sheetKeySD] || spriteMap[sheetKeyStd] || spriteMap[sheetKeyHD]
        || spriteMap[sheetPadded] || spriteMap[String(sheetIndex)]
        || `/streams/${videoId}/thumbnails/sprite_${sheetPadded}.jpg`;
    }

    if (resolvedUrl) {
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
    setSeekTime(clamped);
    setCurrentTime(clamped);

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
    setScrubPercent(pct);
    setPreviewTime(clamped);
    if (seekTrackRef.current) {
      const rect = seekTrackRef.current.getBoundingClientRect();
      if (rect && rect.width > 0) {
        const offsetX = (clamped / dur) * rect.width;
        setPreviewPercent(getClampedPreviewPercent(offsetX, rect));
      } else {
        setPreviewPercent(pct);
      }
    } else {
      setPreviewPercent(pct);
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

    // Zero-lag direct DOM updates!
    if (scrubPreviewRef.current) {
      scrubPreviewRef.current.style.left = `${clampedPercent}%`;
    }
    if (scrubBadgeRef.current) {
      scrubBadgeRef.current.textContent = formatTime(calculatedSec);
    }
    if (progressBarRef.current) progressBarRef.current.style.width = `${percent}%`;
    if (scrubberKnobRef.current) scrubberKnobRef.current.style.left = `${percent}%`;
    if (timeDisplayRef.current) timeDisplayRef.current.textContent = formatTimePair(calculatedSec, realDur);

    setScrubPercent(percent);
    setPreviewPercent(clampedPercent);
    setPreviewTime(calculatedSec);
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

    // Zero-lag direct DOM update on hover as well!
    if (scrubPreviewRef.current) {
      scrubPreviewRef.current.style.left = `${clampedPct}%`;
    }
    if (scrubBadgeRef.current) {
      scrubBadgeRef.current.textContent = formatTime(time);
    }

    setHoverPercent(pct);
    setPreviewPercent(clampedPct);
    setHoverTime(time);
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

    if (isEnded) {
      togglePlay();
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    const xRatio = (e.clientX - rect.left) / rect.width;
    const zone = xRatio < 0.35 ? 'left' : xRatio > 0.65 ? 'right' : 'center';
    const now = e.timeStamp;

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
              await window.screen.orientation.lock('portrait').catch(() => { });
            } else {
              await window.screen.orientation.lock('landscape').catch(() => { });
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
        showToast('ออกจากโหมดหน้าต่างลอย (PiP)');
      } else if (document.pictureInPictureEnabled) {
        await video.current.requestPictureInPicture();
        showToast('เล่นแบบหน้าต่างลอย (PiP)');
      } else {
        showToast('เบราว์เซอร์ไม่รองรับ PiP');
      }
    } catch (err) {
      console.warn('PiP error:', err);
    }
  };

  // 📱 Manual Screen Orientation Toggle (สั่งหมุน แนวนอน <-> แนวตั้ง ได้เองตามต้องการ)
  const toggleOrientation = useCallback(async () => {
    if (typeof window === 'undefined' || !window.screen?.orientation) {
      showToast('เบราว์เซอร์ไม่รองรับคำสั่งหมุนหน้าจอ');
      return;
    }
    try {
      const currentType = window.screen.orientation.type || '';
      const isLandscape = currentType.includes('landscape');

      if (isLandscape) {
        if (window.screen.orientation.lock) {
          await window.screen.orientation.lock('portrait').catch(() => { });
          showToast('หมุนเป็นแนวตั้ง (Portrait)');
        }
      } else {
        // If entering landscape, entering fullscreen provides the best mobile experience
        if (!isFullscreen && containerRef.current) {
          if (containerRef.current.requestFullscreen) {
            await containerRef.current.requestFullscreen().catch(() => { });
          } else if (containerRef.current.webkitRequestFullscreen) {
            await containerRef.current.webkitRequestFullscreen().catch(() => { });
          }
        }
        if (window.screen.orientation.lock) {
          await window.screen.orientation.lock('landscape').catch(() => { });
          showToast('หมุนเป็นแนวนอน (Landscape)');
        }
      }
    } catch (err) {
      console.log('Manual orientation toggle notice:', err);
      if (window.screen.orientation.unlock) {
        window.screen.orientation.unlock();
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
            try {
              window.screen.orientation.unlock();
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

  // Keyboard Shortcuts (Supports all keyboard languages via physical e.code)
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore if user is typing in an input, textarea, or contentEditable element
      if (['INPUT', 'TEXTAREA'].includes(e.target?.tagName) || e.target?.isContentEditable) return;
      // Do not hijack browser system combos (Ctrl+C, Ctrl+F, Ctrl+P, Alt+Left, etc.)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const code = e.code;
      const key = e.key?.toLowerCase();

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
        setIsCcActive((prev) => {
          const next = !prev;
          showToast(next ? 'เปิดคำบรรยาย' : 'ปิดคำบรรยาย');
          return next;
        });
      } else if (code === 'KeyP' || key === 'p') {
        e.preventDefault();
        togglePiP();
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
        setVolume(nextVol);
        if (video.current) video.current.volume = nextVol;
        showToast(`ระดับเสียง: ${Math.round(nextVol * 100)}%`);
      } else if (code === 'ArrowDown' || e.key === 'ArrowDown') {
        e.preventDefault();
        const nextVol = Math.max(volume - 0.05, 0);
        setVolume(nextVol);
        if (video.current) video.current.volume = nextVol;
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
  }, [togglePlay, commitSeek, duration, seekStep, volume, toggleMute, showToast, togglePiP, setIsCcActive]);


  const is4K = (resolution && resolution.toString().includes('2160')) ||
    (activeLevelLabel && (activeLevelLabel.includes('4K') || activeLevelLabel.includes('2160p')));
  const isHD = is4K || (resolution && (resolution.toString().includes('1080') || resolution.toString().includes('720') || resolution.toString().includes('1440'))) ||
    (activeLevelLabel && (activeLevelLabel.includes('1080') || activeLevelLabel.includes('720') || activeLevelLabel.includes('1440')));

  // Persistent progress and time values with Optimistic UI:
  // ให้แถบ Seekbar และตัวเลขเวลาใน UI ใช้ค่าเวลาตามเงื่อนไข: isSeeking ? seekTime : currentTime
  const currentVideoTime = isSeeking ? seekTime : currentTime;
  const currentProgressPct = duration > 0 ? Math.min(100, Math.max(0, (currentVideoTime / duration) * 100)) : 0;
  const activeScrubPercent = isScrubbing ? scrubPercent : currentProgressPct;
  const activeTimeDisplay = isScrubbing
    ? formatTimePair(previewTime, duration)
    : formatTimePair(currentVideoTime, duration);

  const initialBufferPct = 0;

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
      className={`relative bg-transparent select-none overflow-hidden group/player ${isFullscreen
        ? 'fixed inset-0 z-50 h-screen w-screen border-0 rounded-none'
        : (videoRatio && videoRatio < 0.98)
          ? 'w-full h-[min(48vh,380px)] lg:h-auto lg:aspect-video rounded-none sm:rounded-2xl border-0 sm:border sm:border-black/10 shadow-none sm:shadow-none'
          : 'w-full h-auto rounded-none sm:rounded-2xl border-0 sm:border-0 sm:border-black/10 shadow-none sm:shadow-none'
        } ${!showControls && isPlaying ? 'cursor-none' : 'cursor-default'}`}
      style={{
        aspectRatio: isFullscreen
          ? undefined
          : (videoRatio && videoRatio < 0.98)
            ? (isMobileView ? undefined : '16/9')
            // Mobile + cinematic → clamp to 16/9; desktop → keep true ratio
            : (isMobileView && isCinematic) ? '16/9' : `${videoRatio}`,
        maxWidth: isFullscreen
          ? undefined
          : (videoRatio && videoRatio < 0.98)
            ? undefined
            : (isMobileView && isCinematic)
              ? undefined
              : `calc((${desktopMaxHeight}) * ${videoRatio})`,
        maxHeight: isFullscreen
          ? undefined
          : (videoRatio && videoRatio < 0.98)
            ? (isMobileView ? 'min(48vh, 380px)' : desktopMaxHeight)
            : desktopMaxHeight,
        margin: (videoRatio && videoRatio >= 0.98) ? 0 : '0 auto',
        contain: 'paint layout',
        WebkitTouchCallout: 'none',
      }}
    >
      {/* High-Performance Native Video Element */}
      <video
        ref={video}
        poster={poster}
        crossOrigin="anonymous"
        autoPlay={defaultAutoplay}
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
          setIsEnded(false);
          isUserPausedRef.current = false;
          checkAndUpdateRatio();
          lastTickTimeRef.current = performance.now();
        }}
        onPause={() => {
          setIsPlaying(false);
          lastTickTimeRef.current = null;
          const v = video.current;
          if (videoId && v && v.currentTime > 1) {
            const historyPayload = JSON.stringify({ videoId, position: isMusic ? 0 : Math.floor(v.currentTime) });
            if (isMusic) {
              try {
                localStorage.setItem(`tubelock_watched_${videoId}`, '1');
                localStorage.removeItem(`tubelock_pos_${videoId}`);
              } catch (_) { }
            } else {
              try {
                localStorage.setItem(`tubelock_pos_${videoId}`, String(Math.floor(v.currentTime)));
              } catch (_) { }
            }
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
          }
        }}
        onError={(e) => {
          const err = e.target.error;
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
        onEnded={() => {
          setIsEnded(true);
          setIsPlaying(false);
          if (fadeBlackOverlayRef.current) {
            fadeBlackOverlayRef.current.style.transition = 'opacity 200ms ease-out';
            fadeBlackOverlayRef.current.style.opacity = '1';
          }
          if (isLooping) {
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
          setIsEnded(false);
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
            setCurrentTime(v.currentTime);
            lastReportedSecondRef.current = Math.floor(v.currentTime);
            if (vDur - v.currentTime > 1.0) {
              setIsEnded(false);
            }
            if (timeDisplayRef.current) {
              timeDisplayRef.current.textContent = formatTimePair(v.currentTime, vDur);
            }
            if (fadeBlackOverlayRef.current && (vDur - v.currentTime) > 1.8) {
              fadeBlackOverlayRef.current.style.transition = 'none';
              fadeBlackOverlayRef.current.style.opacity = '0';
            }
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
        onCanPlay={() => {
          checkAndUpdateRatio();
          attemptAutoPlay();
        }}
        onResize={() => {
          checkAndUpdateRatio();
        }}
        onLoadedMetadata={(e) => {
          const { duration: dur } = e.target;
          checkAndUpdateRatio();
          if (dur) setDuration(dur);
          updateBufferProgress();

          if (targetInitialTime > 0 && !initialSeekDoneRef.current) {
            initialSeekDoneRef.current = true;
            try {
              e.target.currentTime = targetInitialTime;
              setCurrentTime(targetInitialTime);
            } catch (_) { }
          }

          if (dur && dur > 0 && targetInitialTime > 0) {
            const pct = Math.min((targetInitialTime / dur) * 100, 100);
            if (progressBarRef.current) progressBarRef.current.style.width = `${pct}%`;
            if (scrubberKnobRef.current) scrubberKnobRef.current.style.left = `${pct}%`;
            if (timeDisplayRef.current) {
              timeDisplayRef.current.textContent = formatTimePair(targetInitialTime, dur);
            }
          }

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

      {/* 🎬 Cinematic Fade-to-Black Overlay (ช่วง ~0.8s - 1.0s ก่อนจบวิดีโอ) */}
      <div
        ref={fadeBlackOverlayRef}
        className="absolute inset-0 bg-black pointer-events-none z-[4] transition-opacity duration-500 ease-out opacity-0"
      />

      {/* Unified 3-Zone Click / Double-Click Overlay (Left -10s, Center Play/Pause/Fullscreen, Right +10s) */}
      <div
        onClick={handlePlayerOverlayClick}
        className="absolute inset-0 z-10 touch-manipulation"
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
        isEnded={isEnded}
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

      {/* 🎬 YouTube-style End Screen Overlay (Dynamic 3 Cards on PC) */}
      <PlayerEndScreen
        isVisible={isEnded && !isLooping}
        isFullscreen={isFullscreen}
        currentVideo={currentVideo || { id: videoId, title, category: videoCategory, author_name: channelName }}
        relatedVideos={relatedVideos}
        onReplay={togglePlay}
      />

      {/* Telemetry HUD (Stats for Nerds) */}
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
        videoId={videoId}
        videoSlug={videoSlug}
        videoCategory={videoCategory}
        src={src}
        showToast={showToast}
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
        isMobileView={isMobileView}
        isFullscreen={isFullscreen}
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
      />

      {/* Modern High-Performance Bottom Controls Bar */}
      <PlayerBottomBar
        showControls={showControls}
        isPlaying={isPlaying}
        isEnded={isEnded}
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
        progressBarRef={progressBarRef}
        scrubberKnobRef={scrubberKnobRef}
        isHoveringSeek={isHoveringSeek}
        setIsHoveringSeek={setIsHoveringSeek}
        previewPercent={previewPercent}
        hoverPercent={hoverPercent}
        previewTime={previewTime}
        hoverTime={hoverTime}
        lastHoverTimeRef={lastHoverTimeRef}
        lastHoverPercentRef={lastHoverPercentRef}
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
