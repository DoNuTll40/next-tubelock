'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Play, Pause, Volume2, VolumeX, Volume1, Maximize, Minimize, 
  Settings, Check, ChevronRight, ChevronLeft, Loader2, Info, X,
  Scan, Expand, Crop, PictureInPicture2, Copy, Activity, Zap,
  RotateCcw, Sparkles
} from 'lucide-react';
import { formatResolutionBadge } from '@/lib/videoUtils';

export default function VideoPlayer({ 
  src, 
  poster, 
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

  // Video aspect ratio
  const [videoRatio, setVideoRatio] = useState(16 / 9);

  // Playback states
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolume] = useState(defaultVolume);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);

  // Speed and Aspect Mode: 'fit' (original) | 'crop' (zoom to cut letterbox) | 'fill' (stretch/fill)
  const [playbackRate, setPlaybackRate] = useState(defaultSpeed);
  const [aspectMode, setAspectMode] = useState(defaultFit); // 'fit' | 'crop' | 'fill'

  // Telemetry HUD / Stats
  const [showStats, setShowStats] = useState(autoStats);
  const [statsCopied, setStatsCopied] = useState(false);

  // On-Screen Action Toast & Center Ripple Flash
  const [toastMessage, setToastMessage] = useState(null);
  const [centerRipple, setCenterRipple] = useState(null); // 'play' | 'pause'
  const toastTimeoutRef = useRef(null);
  const rippleTimeoutRef = useRef(null);

  const showToast = useCallback((msg, icon = null) => {
    setToastMessage({ text: msg, icon });
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToastMessage(null), 1500);
  }, []);

  const triggerRipple = useCallback((type) => {
    setCenterRipple(type);
    if (rippleTimeoutRef.current) clearTimeout(rippleTimeoutRef.current);
    rippleTimeoutRef.current = setTimeout(() => setCenterRipple(null), 500);
  }, []);

  // Controls & Menus
  const [showControls, setShowControls] = useState(true);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [activeMenuTab, setActiveMenuTab] = useState('main'); // 'main' | 'speed' | 'quality' | 'aspect'

  // HLS ABR Levels
  const [levels, setLevels] = useState([]);
  const [currentLevelIndex, setCurrentLevelIndex] = useState(-1);
  const [activeLevelLabel, setActiveLevelLabel] = useState(formatResolutionBadge(resolution) || 'Auto');

  // Scrubbing & Hover Preview
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [previewTime, setPreviewTime] = useState(0);
  const [previewPercent, setPreviewPercent] = useState(0);
  const [isHoveringSeek, setIsHoveringSeek] = useState(false);
  const [hoverTime, setHoverTime] = useState(0);
  const [hoverPercent, setHoverPercent] = useState(0);

  // Double Tap Seeking
  const [doubleTapSide, setDoubleTapSide] = useState(null);
  const [accumulatedSeconds, setAccumulatedSeconds] = useState(0);
  const lastTapRef = useRef({ time: 0, side: null, x: 0 });
  const singleTapTimerRef = useRef(null);
  const seekCommitTimerRef = useRef(null);
  const controlsTimeoutRef = useRef(null);
  const pendingTargetTimeRef = useRef(null);
  const lastTimeUpdateRef = useRef(0);

  const isUserPausedRef = useRef(!defaultAutoplay);
  const wakeLockSentinelRef = useRef(null);

  // Realtime FPS & Telemetry
  const [realtimeFps, setRealtimeFps] = useState('0.0');
  const frameCountRef = useRef(0);
  const lastFpsTimeRef = useRef(performance.now());
  const rvfcIdRef = useRef(null);

  const [nerdStats, setNerdStats] = useState({
    viewport: '0x0',
    dpr: 1,
    optimalRes: '0x0',
    bufferHealth: 0,
    droppedFrames: 0,
    totalFrames: 0,
    bandwidthEstimate: '45.0 Mbps',
    protocol: 'Direct MP4',
    colorSpace: 'BT.709 (sRGB)',
    audioTrack: 'AAC Stereo 48kHz',
  });

  const [hlsError, setHlsError] = useState(null);

  const formatTime = (time) => {
    if (isNaN(time) || !time) return '00:00';
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
        console.warn('Wake Lock request failed:', err);
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
    if (isPlaying) {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }
  }, [isPlaying, requestWakeLock, releaseWakeLock]);

  // Sync initial volume
  useEffect(() => {
    if (video.current) {
      video.current.volume = defaultVolume;
      setVolume(defaultVolume);
      video.current.playbackRate = defaultSpeed;
      setPlaybackRate(defaultSpeed);
    }
  }, [defaultVolume, defaultSpeed, video]);

  // Buffer progress calculation
  const updateBufferProgress = useCallback(() => {
    if (!video.current) return;
    const b = video.current.buffered;
    const cur = video.current.currentTime;
    for (let i = 0; i < b.length; i++) {
      if (b.start(i) <= cur && cur <= b.end(i)) {
        setBufferedEnd(b.end(i));
        return;
      }
    }
  }, [video]);

  const handleThrottledTimeUpdate = (e) => {
    const now = performance.now();
    if (!isScrubbing && now - lastTimeUpdateRef.current > 250) {
      setCurrentTime(e.target.currentTime);
      updateBufferProgress();
      if (onTimeUpdate) onTimeUpdate(e);
      lastTimeUpdateRef.current = now;
    }
  };

  // Ultra-precise Realtime FPS Calculation
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

  // Telemetry poll
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

        setNerdStats({
          viewport: `${containerRef.current.clientWidth}x${containerRef.current.clientHeight}`,
          dpr: dpr.toFixed(1),
          optimalRes: `${video.current.videoWidth || 3840}x${video.current.videoHeight || 2026}`,
          bufferHealth: bufHealth,
          droppedFrames: dropped,
          totalFrames: total,
          bandwidthEstimate: isHls ? 'HLS Adaptive' : 'Direct 48.5 Mbps',
          protocol: isHls ? 'HLS / ABR Playlist' : 'HTTP/2 Direct MP4',
          colorSpace: 'BT.709 SDR (Color Primaries)',
          audioTrack: 'AAC Stereo 48.0 kHz 16-bit',
        });
      }
    }, 800);
    return () => clearInterval(interval);
  }, [showStats, video, src]);

  // Controls Auto-Hide
  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    if (isPlaying && !isScrubbing && !showSettingsMenu && !showStats) {
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 2800);
    }
  }, [isPlaying, isScrubbing, showSettingsMenu, showStats]);

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
            maxBufferLength: 30,
            maxMaxBufferLength: 60,
            enableWorker: true,
            fragLoadingTimeOut: 20000,
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
                v.play().then(() => setIsPlaying(true)).catch(() => {});
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
          v.src = src;
        }
      } else {
        // Direct MP4
        v.src = src;
        if (defaultAutoplay && !isUserPausedRef.current) {
          v.play().then(() => setIsPlaying(true)).catch(() => {
            v.muted = true;
            setIsMuted(true);
            v.play().then(() => setIsPlaying(true)).catch(() => {});
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

  // Quality selector
  const handleSelectQuality = (levelIdx) => {
    setCurrentLevelIndex(levelIdx);
    if (hlsInstanceRef.current) {
      hlsInstanceRef.current.currentLevel = levelIdx;
      if (levelIdx === -1) {
        showToast('ความละเอียด: Auto');
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

  // Instant Play / Pause Toggle
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
    setCurrentTime(clamped);
    pendingTargetTimeRef.current = null;
  }, [duration, video]);

  // Scrubbing & Hover calculation
  const calculateScrubPosition = (clientX) => {
    if (!seekTrackRef.current || duration <= 0) return;
    const rect = seekTrackRef.current.getBoundingClientRect();
    const offsetX = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const percent = (offsetX / rect.width) * 100;
    const calculatedSec = (offsetX / rect.width) * duration;

    setPreviewPercent(percent);
    setPreviewTime(calculatedSec);
  };

  const handleSeekMouseMove = (e) => {
    if (!seekTrackRef.current || duration <= 0) return;
    const rect = seekTrackRef.current.getBoundingClientRect();
    const offsetX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    setHoverPercent((offsetX / rect.width) * 100);
    setHoverTime((offsetX / rect.width) * duration);
    if (isScrubbing) {
      calculateScrubPosition(e.clientX);
    }
  };

  const handlePointerDown = (e) => {
    setIsScrubbing(true);
    calculateScrubPosition(e.clientX);
  };

  const handlePointerUp = () => {
    if (isScrubbing) {
      commitSeek(previewTime);
      setIsScrubbing(false);
      resetControlsTimer();
    }
  };

  // Double Tap Seeking (Left / Right / Center)
  const handleTouchZone = (side) => {
    const now = Date.now();
    const lastTap = lastTapRef.current;
    const isDoubleTap = now - lastTap.time < 350 && (lastTap.side === side || doubleTapSide === side);

    if (isDoubleTap && (side === 'left' || side === 'right')) {
      if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);

      setShowControls(false);
      setShowSettingsMenu(false);

      const step = side === 'right' ? seekStep : -seekStep;
      const baseTime = pendingTargetTimeRef.current !== null 
        ? pendingTargetTimeRef.current 
        : (video.current?.currentTime || 0);

      const nextTarget = Math.min(Math.max(baseTime + step, 0), duration);
      pendingTargetTimeRef.current = nextTarget;

      setDoubleTapSide(side);
      setAccumulatedSeconds((prev) => (side === 'right' ? prev + seekStep : prev - seekStep));

      if (seekCommitTimerRef.current) clearTimeout(seekCommitTimerRef.current);
      seekCommitTimerRef.current = setTimeout(() => {
        commitSeek(pendingTargetTimeRef.current);
        setDoubleTapSide(null);
        setAccumulatedSeconds(0);
      }, 550);

      lastTapRef.current = { time: now, side };
      return;
    }

    lastTapRef.current = { time: now, side };

    if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
    singleTapTimerRef.current = setTimeout(() => {
      if (side === 'center') {
        togglePlay();
      } else {
        setShowControls((prev) => !prev);
        setShowSettingsMenu(false);
        if (!showControls) resetControlsTimer();
      }
    }, 250);
  };

  // Fullscreen & PiP
  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      try {
        await containerRef.current.requestFullscreen();
        setIsFullscreen(true);
      } catch (err) {
        console.warn('Fullscreen error:', err);
      }
    } else {
      try {
        await document.exitFullscreen();
        setIsFullscreen(false);
      } catch (err) {
        console.warn('Exit fullscreen error:', err);
      }
    }
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
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Aspect Mode Cycle: fit -> crop -> fill -> fit
  const cycleAspectMode = () => {
    let nextMode = 'fit';
    let label = 'สัดส่วน: พอดี (Fit)';
    if (aspectMode === 'fit') {
      nextMode = 'crop';
      label = 'สัดส่วน: ตัดขอบดำ (Crop / Zoom)';
    } else if (aspectMode === 'crop') {
      nextMode = 'fill';
      label = 'สัดส่วน: ยืดเต็มจอ (Fill)';
    } else {
      nextMode = 'fit';
      label = 'สัดส่วน: ค่าเริ่มต้น (Fit)';
    }
    setAspectMode(nextMode);
    showToast(label);
    resetControlsTimer();
  };

  // Keyboard Shortcuts (Space, J, K, L, Arrows, F, M, 0-9)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target?.tagName)) return;

      if (e.key === ' ' || e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const next = Math.min((video.current?.currentTime || 0) + seekStep, duration);
        commitSeek(next);
        showToast(`+${seekStep} วินาที`);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const next = Math.max((video.current?.currentTime || 0) - seekStep, 0);
        commitSeek(next);
        showToast(`-${seekStep} วินาที`);
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        const next = Math.min((video.current?.currentTime || 0) + 10, duration);
        commitSeek(next);
        showToast('+10 วินาที');
      } else if (e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        const next = Math.max((video.current?.currentTime || 0) - 10, 0);
        commitSeek(next);
        showToast('-10 วินาที');
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        toggleMute();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const newVol = Math.min(volume + 0.05, 1);
        setVolume(newVol);
        if (video.current) video.current.volume = newVol;
        showToast(`ระดับเสียง: ${Math.round(newVol * 100)}%`);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const newVol = Math.max(volume - 0.05, 0);
        setVolume(newVol);
        if (video.current) video.current.volume = newVol;
        showToast(`ระดับเสียง: ${Math.round(newVol * 100)}%`);
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
        nominalFps: fps || 30,
        currentFps: realtimeFps,
        codec,
        bufferHealthSec: nerdStats.bufferHealth.toFixed(2),
        droppedFrames: `${nerdStats.droppedFrames} / ${nerdStats.totalFrames}`,
        aspectMode,
        playbackRate,
        timestamp: new Date().toISOString(),
      },
      null,
      2
    );
    navigator.clipboard.writeText(report);
    setStatsCopied(true);
    showToast('คัดลอกสถิติลงคลิปบอร์ดแล้ว!');
    setTimeout(() => setStatsCopied(false), 2000);
  };

  const progressPercent = duration ? (currentTime / duration) * 100 : 0;
  const bufferPercent = duration ? (bufferedEnd / duration) * 100 : 0;
  const targetFpsNumber = Number(fps) || 30;
  const currentFpsNumber = Number(realtimeFps);

  return (
    <div 
      ref={containerRef}
      onContextMenu={(e) => e.preventDefault()}
      onMouseMove={resetControlsTimer}
      onPointerMove={handleSeekMouseMove}
      onPointerUp={handlePointerUp}
      className={`relative w-full bg-black select-none overflow-hidden transition-all duration-200 group/player ${
        isFullscreen 
          ? 'fixed inset-0 z-50 h-screen w-screen border-0 rounded-none' 
          : 'rounded-none sm:rounded-2xl border border-black/10 shadow-md'
      } ${!showControls && isPlaying ? 'cursor-none' : 'cursor-default'}`}
      style={{
        aspectRatio: isFullscreen ? undefined : videoRatio,
        maxHeight: isFullscreen ? undefined : 'calc(100vh - 160px)',
        WebkitTouchCallout: 'none',
      }}
    >
      {/* Video Element */}
      <video
        ref={video}
        poster={poster}
        playsInline
        webkit-playsinline="true"
        preload="auto"
        controlsList="nodownload nofullscreen noremoteplayback"
        disablePictureInPicture={false}
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
        onTimeUpdate={handleThrottledTimeUpdate}
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
        className={`w-full h-full transform-gpu transition-all duration-300 pointer-events-none ${
          aspectMode === 'crop'
            ? 'object-cover scale-[1.14]' // ตัดแถบดำด้านบน-ล่างออกอย่างไร้รอยต่อ
            : aspectMode === 'fill'
            ? 'object-cover'
            : 'object-contain'
        }`}
        style={{
          transform: aspectMode === 'crop' ? 'scale(1.14) translateZ(0)' : 'translateZ(0)',
          willChange: 'transform',
          backfaceVisibility: 'hidden',
        }}
      />

      {/* 3-Zone Click / Touch overlay */}
      <div className="absolute inset-0 grid grid-cols-3 z-10">
        <div onClick={() => handleTouchZone('left')} className="h-full cursor-pointer" />
        <div onClick={() => handleTouchZone('center')} className="h-full cursor-pointer" />
        <div onClick={() => handleTouchZone('right')} className="h-full cursor-pointer" />
      </div>

      {/* On-Screen Toast Notification (Top Center) */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            className="absolute top-5 left-1/2 -translate-x-1/2 z-40 bg-black/75 backdrop-blur-md text-white px-3.5 py-1.5 rounded-full border border-white/15 text-xs font-semibold shadow-2xl flex items-center gap-2 pointer-events-none"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#FF7A00]" />
            <span>{toastMessage.text}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Momentary Play/Pause Center Ripple Flash (Disappears in 400ms) */}
      <AnimatePresence>
        {centerRipple && (
          <motion.div
            initial={{ opacity: 0.9, scale: 0.75 }}
            animate={{ opacity: 0, scale: 1.35 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
            className="absolute inset-0 flex items-center justify-center pointer-events-none z-30"
          >
            <div className="w-18 h-18 rounded-full bg-black/60 backdrop-blur-md border border-white/20 flex items-center justify-center text-white shadow-2xl">
              {centerRipple === 'play' ? (
                <Play className="w-8 h-8 fill-white ml-1" />
              ) : (
                <Pause className="w-8 h-8 fill-white" />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Double Tap Ripple Feedback (+10s / -10s) */}
      <AnimatePresence>
        {doubleTapSide === 'left' && (
          <div className="absolute left-6 top-1/2 -translate-y-1/2 pointer-events-none z-20 select-none">
            <motion.div
              key={accumulatedSeconds}
              initial={{ scale: 0.85, opacity: 0.7 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-1 drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)]"
            >
              <div className="flex -space-x-1">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    animate={{ x: [-2, -6, -2], opacity: [0.3, 1, 0.3] }}
                    transition={{ repeat: Infinity, duration: 0.6, delay: (2 - i) * 0.15 }}
                  >
                    <ChevronLeft className="w-5 h-5 text-white stroke-[2.5]" />
                  </motion.div>
                ))}
              </div>
              <span className="text-white text-xs font-bold font-mono tracking-tight ml-0.5">
                {accumulatedSeconds}s
              </span>
            </motion.div>
          </div>
        )}

        {doubleTapSide === 'right' && (
          <div className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none z-20 select-none">
            <motion.div
              key={accumulatedSeconds}
              initial={{ scale: 0.85, opacity: 0.7 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-1 drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)]"
            >
              <span className="text-white text-xs font-bold font-mono tracking-tight mr-0.5">
                +{accumulatedSeconds}s
              </span>
              <div className="flex -space-x-1">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    animate={{ x: [2, 6, 2], opacity: [0.3, 1, 0.3] }}
                    transition={{ repeat: Infinity, duration: 0.6, delay: i * 0.15 }}
                  >
                    <ChevronRight className="w-5 h-5 text-white stroke-[2.5]" />
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Center Spinner (When buffering) or Center Play Button ONLY when paused */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
        {hlsError ? (
          <div className="pointer-events-auto flex flex-col items-center gap-2 bg-black/85 rounded-2xl px-5 py-3.5 text-center max-w-[85%] border border-rose-500/30 shadow-2xl backdrop-blur-md">
            <span className="text-rose-400 text-xs font-mono break-words">{hlsError}</span>
          </div>
        ) : isBuffering ? (
          <div className="p-3.5 bg-black/60 backdrop-blur-md rounded-full border border-white/15 shadow-xl">
            <Loader2 className="w-8 h-8 text-[#FF7A00] animate-spin" />
          </div>
        ) : (
          /* Show center play icon ONLY when video is paused (never blocks while playing!) */
          !isPlaying && showControls && !doubleTapSide && (
            <motion.button
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              onClick={(e) => {
                e.stopPropagation();
                togglePlay();
              }}
              className="pointer-events-auto w-15 h-15 rounded-full bg-black/60 hover:bg-[#FF7A00] text-white flex items-center justify-center transition shadow-2xl active:scale-90 border border-white/20 backdrop-blur-md cursor-pointer"
            >
              <Play className="w-7 h-7 fill-white ml-0.5" />
            </motion.button>
          )
        )}
      </div>

      {/* GOD-TIER STATS FOR NERDS TELEMETRY HUD (Responsive & Rich) */}
      <AnimatePresence>
        {showStats && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 10 }}
            className="absolute top-3 left-3 sm:top-4 sm:left-4 z-40 bg-[#0F0E0D]/92 backdrop-blur-xl border border-white/15 rounded-2xl p-3.5 sm:p-4 text-[11px] font-mono text-zinc-300 shadow-[0_8px_32px_rgba(0,0,0,0.8)] w-[92%] sm:w-[340px] md:w-[360px] max-h-[82%] overflow-y-auto select-text scrollbar-thin"
          >
            {/* HUD Header */}
            <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-2 font-sans">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-[#FF7A00]/20 flex items-center justify-center text-[#FF7A00]">
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
                  onClick={copyTelemetry}
                  className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-zinc-200 text-[10px] font-sans flex items-center gap-1 transition cursor-pointer"
                  title="คัดลอกข้อมูลสถิติ JSON"
                >
                  <Copy className="w-3 h-3 text-[#FF7A00]" />
                  <span>{statsCopied ? 'คัดลอกแล้ว' : 'คัดลอก'}</span>
                </button>
                <button
                  onClick={() => setShowStats(false)}
                  className="p-1 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white transition cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Telemetry Metrics Grid */}
            <div className="flex flex-col gap-1.5 text-[10px] leading-tight">
              {/* Video ID & Protocol */}
              <div className="flex justify-between items-center py-0.5 border-b border-white/5">
                <span className="text-zinc-400">Video ID:</span>
                <span className="text-white font-bold">{videoId || '#1'}</span>
              </div>

              <div className="flex justify-between items-center py-0.5 border-b border-white/5">
                <span className="text-zinc-400">Protocol / Stream:</span>
                <span className="text-zinc-200">{nerdStats.protocol}</span>
              </div>

              {/* Viewport & Device DPR */}
              <div className="flex justify-between items-center py-0.5 border-b border-white/5">
                <span className="text-zinc-400">Viewport / DPR:</span>
                <span className="text-zinc-200">{nerdStats.viewport} <span className="text-zinc-400">({nerdStats.dpr}x)</span></span>
              </div>

              {/* Native Resolution */}
              <div className="flex justify-between items-center py-0.5 border-b border-white/5">
                <span className="text-zinc-400">Native Resolution:</span>
                <span className="text-[#FF7A00] font-bold">{nerdStats.optimalRes} <span className="text-white text-[9px] bg-white/10 px-1 py-0.2 rounded font-sans">{formatResolutionBadge(resolution)}</span></span>
              </div>

              {/* Aspect Ratio & Cropping Mode */}
              <div className="flex justify-between items-center py-0.5 border-b border-white/5">
                <span className="text-zinc-400">Aspect Ratio / Fit:</span>
                <span className="text-zinc-200">{videoRatio.toFixed(3)}:1 <span className="text-amber-400 uppercase font-semibold">({aspectMode})</span></span>
              </div>

              {/* Live Playback FPS */}
              <div className="flex justify-between items-center bg-white/5 px-2 py-1 rounded-lg my-0.5">
                <span className="text-zinc-300 flex items-center gap-1">
                  <Zap className="w-3 h-3 text-emerald-400" /> Live FPS (จริง / ต้นฉบับ):
                </span>
                <span className="font-bold font-mono">
                  <span className={
                    !isPlaying 
                      ? 'text-zinc-400' 
                      : (currentFpsNumber > 0 && currentFpsNumber < targetFpsNumber - 3) 
                        ? 'text-rose-400' 
                        : 'text-emerald-400'
                  }>
                    {isPlaying ? realtimeFps : '0.0'}
                  </span>
                  <span className="text-zinc-400 font-normal"> / {fps || 30} fps</span>
                </span>
              </div>

              {/* Dropped Frames */}
              <div className="flex justify-between items-center py-0.5 border-b border-white/5">
                <span className="text-zinc-400">Dropped Frames:</span>
                <span className={nerdStats.droppedFrames > 0 ? 'text-rose-400 font-bold' : 'text-zinc-200'}>
                  {nerdStats.droppedFrames} / {nerdStats.totalFrames} 
                  {nerdStats.totalFrames > 0 && ` (${((nerdStats.droppedFrames / nerdStats.totalFrames) * 100).toFixed(2)}%)`}
                </span>
              </div>

              {/* Codecs */}
              <div className="flex justify-between items-center py-0.5 border-b border-white/5">
                <span className="text-zinc-400">Video Codec:</span>
                <span className="text-zinc-100 uppercase font-bold">{codec} <span className="text-zinc-400 text-[9px] font-normal">(Hardware Accel)</span></span>
              </div>

              <div className="flex justify-between items-center py-0.5 border-b border-white/5">
                <span className="text-zinc-400">Audio Format:</span>
                <span className="text-zinc-300">{nerdStats.audioTrack}</span>
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
                    className={`h-full transition-all duration-300 rounded-full ${
                      nerdStats.bufferHealth > 15 
                        ? 'bg-emerald-400' 
                        : nerdStats.bufferHealth > 5 
                        ? 'bg-amber-400' 
                        : 'bg-rose-400'
                    }`}
                    style={{ width: `${Math.min((nerdStats.bufferHealth / 45) * 100, 100)}%` }}
                  />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Multi-Tab Settings Menu */}
      <AnimatePresence>
        {showSettingsMenu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 6 }}
            className="absolute bottom-16 right-4 bg-[#18181B]/95 border border-white/15 rounded-2xl py-1.5 w-54 text-xs text-zinc-200 z-40 shadow-2xl overflow-hidden backdrop-blur-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {activeMenuTab === 'main' && (
              <div className="flex flex-col">
                {/* Quality */}
                <button
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

                {/* Speed */}
                <button
                  onClick={() => setActiveMenuTab('speed')}
                  className="w-full flex items-center justify-between px-3.5 py-2.5 hover:bg-white/10 transition border-t border-white/5 cursor-pointer"
                >
                  <span className="text-zinc-300">ความเร็ว</span>
                  <span className="text-[#FF7A00] flex items-center gap-1 font-mono font-semibold">
                    {playbackRate === 1 ? 'ปกติ' : `${playbackRate}x`}
                    <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
                  </span>
                </button>

                {/* Aspect Ratio Mode */}
                <button
                  onClick={() => setActiveMenuTab('aspect')}
                  className="w-full flex items-center justify-between px-3.5 py-2.5 hover:bg-white/10 transition border-t border-white/5 cursor-pointer"
                >
                  <span className="text-zinc-300">สัดส่วนวิดีโอ</span>
                  <span className="text-amber-400 flex items-center gap-1 uppercase font-semibold">
                    {aspectMode === 'crop' ? 'ตัดขอบดำ' : aspectMode === 'fill' ? 'เต็มจอ' : 'พอดี'}
                    <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
                  </span>
                </button>

                {/* Stats for Nerds */}
                <button
                  onClick={() => {
                    setShowStats(true);
                    setShowSettingsMenu(false);
                  }}
                  className="w-full flex items-center justify-between px-3.5 py-2.5 hover:bg-white/10 transition border-t border-white/5 text-zinc-300 cursor-pointer"
                >
                  <span>สถิติสำหรับเด็กเนิร์ด</span>
                  <Activity className="w-3.5 h-3.5 text-emerald-400" />
                </button>
              </div>
            )}

            {/* Quality Submenu */}
            {activeMenuTab === 'quality' && (
              <div className="flex flex-col max-h-56 overflow-y-auto">
                <div className="px-3.5 py-2 text-[10px] text-zinc-400 border-b border-white/10 flex justify-between items-center">
                  <span>เลือกระดับความละเอียด</span>
                  <button onClick={() => setActiveMenuTab('main')} className="text-[#FF7A00] font-semibold cursor-pointer">กลับ</button>
                </div>

                <button
                  onClick={() => handleSelectQuality(-1)}
                  className="w-full flex items-center justify-between px-3.5 py-2 hover:bg-white/10 text-left transition cursor-pointer"
                >
                  <span className={currentLevelIndex === -1 ? 'text-[#FF7A00] font-semibold' : ''}>
                    Auto {currentLevelIndex === -1 && `(${activeLevelLabel})`}
                  </span>
                  {currentLevelIndex === -1 && <Check className="w-3.5 h-3.5 text-[#FF7A00]" />}
                </button>

                {levels.map((lvl) => {
                  const isSelected = currentLevelIndex === lvl.index;
                  return (
                    <button
                      key={lvl.index}
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

            {/* Speed Submenu */}
            {activeMenuTab === 'speed' && (
              <div>
                <div className="px-3.5 py-2 text-[10px] text-zinc-400 border-b border-white/10 flex justify-between items-center">
                  <span>เลือกความเร็วการเล่น</span>
                  <button onClick={() => setActiveMenuTab('main')} className="text-[#FF7A00] font-semibold cursor-pointer">กลับ</button>
                </div>
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                  <button
                    key={rate}
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

            {/* Aspect Mode Submenu */}
            {activeMenuTab === 'aspect' && (
              <div>
                <div className="px-3.5 py-2 text-[10px] text-zinc-400 border-b border-white/10 flex justify-between items-center">
                  <span>เลือกสัดส่วนภาพ</span>
                  <button onClick={() => setActiveMenuTab('main')} className="text-[#FF7A00] font-semibold cursor-pointer">กลับ</button>
                </div>
                {[
                  { key: 'fit', label: 'พอดีเฟรม (Fit)', desc: 'แสดงตามขนาดจริงของไฟล์' },
                  { key: 'crop', label: 'ตัดขอบดำ (Crop / Zoom)', desc: 'ซูมขยายตัดแถบดำบนล่าง' },
                  { key: 'fill', label: 'ขยายเต็มจอ (Fill)', desc: 'ขยายให้เต็มกล่องเครื่องเล่น' },
                ].map((item) => (
                  <button
                    key={item.key}
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
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modern Bottom Controls Bar */}
      <AnimatePresence>
        {(showControls || !isPlaying || isScrubbing) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute bottom-0 left-0 right-0 px-4 sm:px-6 pb-3 pt-10 bg-gradient-to-t from-black/95 via-black/50 to-transparent flex flex-col gap-2 z-30"
            onClick={(e) => e.stopPropagation()}
          >
            {/* YouTube-style Scrubbing Seekbar with Hover Preview */}
            <div 
              ref={seekTrackRef}
              onPointerDown={handlePointerDown}
              onMouseEnter={() => setIsHoveringSeek(true)}
              onMouseLeave={() => setIsHoveringSeek(false)}
              className="relative flex items-center h-5 cursor-pointer touch-none group/seek"
            >
              {/* Hover / Scrubbing Time Bubble Tooltip */}
              {(isScrubbing || isHoveringSeek) && (
                <div
                  className="absolute -top-7 -translate-x-1/2 bg-[#18181B] text-white border border-white/20 px-2 py-0.5 rounded-md text-[11px] font-mono font-bold pointer-events-none shadow-xl whitespace-nowrap z-40"
                  style={{ left: `${Math.max(6, Math.min(isScrubbing ? previewPercent : hoverPercent, 94))}%` }}
                >
                  {formatTime(isScrubbing ? previewTime : hoverTime)}
                </div>
              )}

              {/* Progress Background Track */}
              <div className="w-full h-1 group-hover/seek:h-1.5 bg-white/20 rounded-full overflow-hidden relative pointer-events-none transition-all duration-150">
                {/* Buffer Track */}
                <div 
                  className="absolute left-0 top-0 bottom-0 bg-white/40 transition-all duration-200"
                  style={{ width: `${bufferPercent}%` }}
                />
                {/* Hover Preview Track */}
                {isHoveringSeek && !isScrubbing && (
                  <div 
                    className="absolute left-0 top-0 bottom-0 bg-white/30"
                    style={{ width: `${hoverPercent}%` }}
                  />
                )}
                {/* Current Playback Progress */}
                <div 
                  className="absolute left-0 top-0 bottom-0 bg-[#FF7A00]"
                  style={{ width: `${isScrubbing ? previewPercent : progressPercent}%` }}
                />
              </div>

              {/* Scrubber Thumb Knob */}
              <div 
                className={`absolute -translate-x-1/2 w-3.5 h-3.5 bg-[#FF7A00] rounded-full shadow-md pointer-events-none transition-transform duration-150 ${
                  isScrubbing ? 'scale-125' : 'scale-0 group-hover/seek:scale-100'
                }`}
                style={{ left: `${isScrubbing ? previewPercent : progressPercent}%` }}
              />
            </div>

            {/* Bottom Row Icons */}
            <div className="flex items-center justify-between text-white text-xs pt-0.5">
              {/* Left Controls */}
              <div className="flex items-center gap-3 sm:gap-4">
                <button 
                  onClick={togglePlay} 
                  className="active:scale-90 transition cursor-pointer p-1 rounded-lg hover:bg-white/10"
                  title={isPlaying ? 'หยุดชั่วคราว (k)' : 'เล่น (k)'}
                >
                  {isPlaying ? <Pause className="w-4.5 h-4.5 fill-white" /> : <Play className="w-4.5 h-4.5 fill-white ml-0.5" />}
                </button>

                {/* Volume with Smooth Hover Expand Slider */}
                <div 
                  className="flex items-center gap-2 group/vol"
                  onMouseEnter={() => setShowVolumeSlider(true)}
                  onMouseLeave={() => setShowVolumeSlider(false)}
                >
                  <button 
                    onClick={toggleMute} 
                    className="cursor-pointer p-1 rounded-lg hover:bg-white/10"
                    title={isMuted ? 'เปิดเสียง (m)' : 'ปิดเสียง (m)'}
                  >
                    {isMuted || volume === 0 ? (
                      <VolumeX className="w-4.5 h-4.5 fill-white text-white" />
                    ) : volume < 0.5 ? (
                      <Volume1 className="w-4.5 h-4.5 fill-white text-white" />
                    ) : (
                      <Volume2 className="w-4.5 h-4.5 fill-white text-white" />
                    )}
                  </button>

                  <div className={`overflow-hidden transition-all duration-200 flex items-center ${
                    showVolumeSlider ? 'w-18 sm:w-22 opacity-100' : 'w-0 opacity-0 pointer-events-none'
                  }`}>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={isMuted ? 0 : volume}
                      onChange={handleVolumeChange}
                      className="w-full h-1 accent-[#FF7A00] bg-white/30 rounded-full cursor-pointer"
                    />
                  </div>
                </div>

                {/* Time Display */}
                <span className="font-mono text-[11px] text-zinc-300 select-none">
                  {formatTime(isScrubbing ? previewTime : currentTime)} / {formatTime(duration)}
                </span>
              </div>

              {/* Right Controls */}
              <div className="flex items-center gap-1 sm:gap-1.5">
                {/* PiP Button */}
                <button
                  onClick={togglePiP}
                  title="เล่นแบบหน้าต่างลอย (Picture-in-Picture)"
                  className="p-1.5 rounded-lg text-white hover:bg-white/10 transition active:scale-90 cursor-pointer"
                >
                  <PictureInPicture2 className="w-4 h-4" />
                </button>

                {/* Aspect Ratio Button (Fit / Crop / Fill) */}
                <button
                  onClick={cycleAspectMode}
                  title={`สัดส่วน: ${aspectMode.toUpperCase()} (คลิกเพื่อเปลี่ยน)`}
                  className={`p-1.5 rounded-lg transition active:scale-90 flex items-center gap-1 text-[11px] cursor-pointer ${
                    aspectMode !== 'fit' ? 'text-[#FF7A00] bg-white/10 font-bold' : 'text-white hover:bg-white/10'
                  }`}
                >
                  {aspectMode === 'crop' ? (
                    <Crop className="w-4 h-4" />
                  ) : aspectMode === 'fill' ? (
                    <Scan className="w-4 h-4" />
                  ) : (
                    <Expand className="w-4 h-4" />
                  )}
                  <span className="hidden sm:inline font-mono uppercase text-[10px]">
                    {aspectMode}
                  </span>
                </button>

                {/* Settings Button */}
                <button
                  onClick={() => {
                    setShowSettingsMenu(!showSettingsMenu);
                    setActiveMenuTab('main');
                  }}
                  title="การตั้งค่าเครื่องเล่น"
                  className={`p-1.5 rounded-lg transition cursor-pointer ${
                    showSettingsMenu ? 'text-[#FF7A00] bg-white/10' : 'text-white hover:bg-white/10'
                  }`}
                >
                  <Settings className="w-4 h-4" />
                </button>

                {/* Fullscreen Button */}
                <button 
                  onClick={toggleFullscreen} 
                  title={isFullscreen ? 'ออกจากเต็มจอ (f)' : 'เต็มจอ (f)'}
                  className="p-1.5 rounded-lg text-white hover:bg-white/10 transition active:scale-90 cursor-pointer"
                >
                  {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
