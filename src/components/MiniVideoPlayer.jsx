'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Play } from 'lucide-react';
import {
  formatTimePair,
  parseSubtitleCues,
  findActiveSubtitleCue,
  normalizeDisplayCueText,
  computeSubtitleBoxLayout,
} from './player/playerUtils';
import MiniPlayerBottomBar from './player/MiniPlayerBottomBar';

/**
 * Lightweight TubeLock Studio Mini Player.
 * Optimized strictly for previewing videos, seeking, playback speed, volume,
 * fullscreen, and live edited subtitle tracks — without watch-page telemetry,
 * view counters, history saving, end screens, or storyboard sprite preloading.
 */
export default function MiniVideoPlayer({
  src,
  poster,
  title = '',
  defaultVolume = 0.8,
  defaultAutoplay = true,
  currentVideo = null,
}) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const seekTrackRef = useRef(null);
  const bufferBarRef = useRef(null);
  const progressBarRef = useRef(null);
  const scrubberKnobRef = useRef(null);
  const timeDisplayRef = useRef(null);

  const hlsInstanceRef = useRef(null);
  const hlsRetryRef = useRef(0);
  const isUserPausedRef = useRef(false);
  const isEndedRef = useRef(false);
  const isScrubbingRef = useRef(false);
  const latestScrubTimeRef = useRef(0);
  const controlsTimerRef = useRef(null);
  const toastTimerRef = useRef(null);
  const clickTimerRef = useRef(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isEnded, setIsEnded] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [hlsError, setHlsError] = useState('');
  const [showPoster, setShowPoster] = useState(true);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(defaultVolume);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  // Scrubbing / Hover state
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [isHoveringSeek, setIsHoveringSeek] = useState(false);
  const [scrubPercent, setScrubPercent] = useState(0);
  const [hoverPercent, setHoverPercent] = useState(0);
  const [previewTime, setPreviewTime] = useState(0);
  const [hoverTime, setHoverTime] = useState(0);

  // Measure container size for subtitle placement inside 16:9 box
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [videoRatio, setVideoRatio] = useState(16 / 9);

  // Live Studio Subtitles preview
  const subtitleTracks = useMemo(() => {
    const raw = currentVideo?.subtitle_tracks;
    if (!Array.isArray(raw)) return [];
    return raw.filter((t) => t && (t.srt || t.vtt));
  }, [currentVideo?.subtitle_tracks]);

  const [isCcActive, setIsCcActive] = useState(true);
  const [selectedTrackId, setSelectedTrackId] = useState(() => {
    const hasTh = subtitleTracks.some((t) => t.id === 'th' || t.lang === 'th');
    return hasTh ? 'th' : subtitleTracks[0]?.id || 'th';
  });

  const activeSubTrack = useMemo(() => {
    if (subtitleTracks.length === 0) return null;
    return (
      subtitleTracks.find((t) => t.id === selectedTrackId) ||
      subtitleTracks.find((t) => t.id === 'th' || t.lang === 'th') ||
      subtitleTracks[0]
    );
  }, [subtitleTracks, selectedTrackId]);

  const subtitleCues = useMemo(() => {
    if (!activeSubTrack) return [];
    return parseSubtitleCues(activeSubTrack.vtt || activeSubTrack.srt || '');
  }, [activeSubTrack]);

  const hasSubtitles = subtitleTracks.length > 0 && subtitleCues.length > 0;
  const activeCueText = useMemo(() => {
    if (!isCcActive || !hasSubtitles) return '';
    return findActiveSubtitleCue(subtitleCues, currentTime) || '';
  }, [isCcActive, hasSubtitles, subtitleCues, currentTime]);

  const showToast = useCallback((msg) => {
    setToastMessage(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMessage(''), 1800);
  }, []);

  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused && !isScrubbingRef.current) {
        setShowControls(false);
      }
    }, 2600);
  }, []);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    };
  }, []);

  // Measure container for subtitle layout
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof window === 'undefined') return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      setContainerSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    };
    measure();
    let observer = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver((entries) => {
        const cr = entries[0]?.contentRect;
        if (!cr) return;
        const w = Math.round(cr.width);
        const h = Math.round(cr.height);
        setContainerSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
      });
      observer.observe(el);
    }
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [isFullscreen]);

  // Sync fullscreenchange event
  useEffect(() => {
    const onFsChange = () => {
      const full = Boolean(
        document.fullscreenElement ||
          document.webkitFullscreenElement ||
          document.mozFullScreenElement
      );
      setIsFullscreen(full);
      setShowSpeedMenu(false);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
    };
  }, []);

  // Sync volume & playbackRate to native video element
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = volume;
    v.muted = isMuted;
  }, [volume, isMuted]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.playbackRate = playbackRate;
  }, [playbackRate]);

  // Initialize HLS or Native Video playback
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !src) return;

    hlsRetryRef.current = 0;
    isUserPausedRef.current = false;
    isEndedRef.current = false;

    if (hlsInstanceRef.current) {
      hlsInstanceRef.current.destroy();
      hlsInstanceRef.current = null;
    }

    const isHls = src.startsWith('blob:') || src.includes('.m3u8') || src.includes('playlist');
    let mounted = true;

    async function initStream() {
      setHlsError('');
      setIsBuffering(true);
      if (isHls) {
        const { default: Hls } = await import('hls.js');
        if (!mounted || !videoRef.current) return;

        if (Hls.isSupported()) {
          const hls = new Hls({
            maxBufferLength: 30,
            maxMaxBufferLength: 60,
            backBufferLength: 15,
            enableWorker: true,
            lowLatencyMode: false,
          });
          hlsInstanceRef.current = hls;
          hls.loadSource(src);
          hls.attachMedia(videoRef.current);

          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (!mounted || !videoRef.current) return;
            setIsBuffering(false);
            videoRef.current.playbackRate = playbackRate;
            if (defaultAutoplay) {
              videoRef.current.play().catch(() => {
                if (videoRef.current) {
                  videoRef.current.muted = true;
                  setIsMuted(true);
                  videoRef.current.play().catch(() => {});
                }
              });
            }
          });

          hls.on(Hls.Events.ERROR, (_ev, data) => {
            if (!mounted || !data?.fatal) return;
            if (hlsRetryRef.current < 2) {
              hlsRetryRef.current += 1;
              if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
              else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
              return;
            }
            setHlsError('ไม่สามารถโหลดสตรีมตัวอย่างได้');
            setIsBuffering(false);
          });
          return;
        }

        if (v.canPlayType('application/vnd.apple.mpegurl')) {
          v.src = src;
          setIsBuffering(false);
          if (defaultAutoplay) v.play().catch(() => {});
          return;
        }

        setHlsError('เบราว์เซอร์ไม่รองรับการเล่น HLS');
        setIsBuffering(false);
      } else {
        v.src = src;
        setIsBuffering(false);
        if (defaultAutoplay) v.play().catch(() => {});
      }
    }

    initStream();
    return () => {
      mounted = false;
      if (hlsInstanceRef.current) {
        hlsInstanceRef.current.destroy();
        hlsInstanceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // Direct-DOM Smooth Progress Loop
  useEffect(() => {
    let rafId = null;
    const tick = () => {
      const v = videoRef.current;
      if (v && !isScrubbingRef.current) {
        const dur = v.duration && isFinite(v.duration) ? v.duration : duration;
        const cur = v.currentTime || 0;
        if (dur > 0) {
          const pct = Math.min(100, Math.max(0, (cur / dur) * 100));
          if (progressBarRef.current) progressBarRef.current.style.width = `${pct}%`;
          if (scrubberKnobRef.current) scrubberKnobRef.current.style.left = `${pct}%`;
          if (timeDisplayRef.current) timeDisplayRef.current.textContent = formatTimePair(cur, dur);
        }
        if (Math.abs(cur - currentTime) >= 0.2) {
          setCurrentTime(cur);
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [duration, currentTime]);

  const updateBufferProgress = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.duration || !bufferBarRef.current) return;
    if (v.buffered.length > 0) {
      const end = v.buffered.end(v.buffered.length - 1);
      const pct = Math.min(100, (end / v.duration) * 100);
      bufferBarRef.current.style.width = `${pct}%`;
    }
  }, []);

  const commitSeek = useCallback(
    (targetSec) => {
      const v = videoRef.current;
      if (!v) return;
      const dur = v.duration && isFinite(v.duration) ? v.duration : duration;
      const clamped = Math.max(0, Math.min(dur || 0, targetSec));
      try {
        v.currentTime = clamped;
      } catch (_) {}
      setCurrentTime(clamped);
      if (dur > 0) {
        const pct = (clamped / dur) * 100;
        if (progressBarRef.current) progressBarRef.current.style.width = `${pct}%`;
        if (scrubberKnobRef.current) scrubberKnobRef.current.style.left = `${pct}%`;
        if (timeDisplayRef.current) timeDisplayRef.current.textContent = formatTimePair(clamped, dur);
      }
      isEndedRef.current = false;
      setIsEnded(false);
      resetControlsTimer();
    },
    [duration, resetControlsTimer]
  );

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (isEndedRef.current || v.ended) {
      commitSeek(0);
      v.play().catch(() => {});
      return;
    }
    if (v.paused) {
      isUserPausedRef.current = false;
      v.play().catch(() => {});
    } else {
      isUserPausedRef.current = true;
      v.pause();
    }
    resetControlsTimer();
  }, [commitSeek, resetControlsTimer]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      if (!next && volume === 0) setVolume(0.5);
      return next;
    });
    resetControlsTimer();
  }, [volume, resetControlsTimer]);

  const handleVolumeChange = (e) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    setIsMuted(val === 0);
    resetControlsTimer();
  };

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el || typeof document === 'undefined') return;
    const activeFs =
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement;

    if (!activeFs && !isFullscreen) {
      try {
        if (el.requestFullscreen) await el.requestFullscreen();
        else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
        else setIsFullscreen(true);
      } catch {
        setIsFullscreen(true);
      }
    } else {
      try {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
        else setIsFullscreen(false);
      } catch {
        setIsFullscreen(false);
      }
    }
    resetControlsTimer();
  }, [isFullscreen, resetControlsTimer]);

  const handleSelectPlaybackRate = (rate) => {
    setPlaybackRate(rate);
    if (videoRef.current) videoRef.current.playbackRate = rate;
    showToast(rate === 1 ? 'ความเร็วปกติ' : `ความเร็ว ${rate}x`);
    resetControlsTimer();
  };

  const handleCycleOrToggleCc = useCallback(() => {
    if (!hasSubtitles) return;
    if (subtitleTracks.length === 1) {
      setIsCcActive((prev) => {
        const next = !prev;
        showToast(next ? `เปิดคำบรรยาย: ${activeSubTrack?.label || 'CC'}` : 'ปิดคำบรรยาย');
        return next;
      });
      return;
    }

    if (!isCcActive) {
      setIsCcActive(true);
      setSelectedTrackId(subtitleTracks[0].id);
      showToast(`คำบรรยาย: ${subtitleTracks[0].label}`);
      return;
    }

    const idx = subtitleTracks.findIndex((t) => t.id === activeSubTrack?.id);
    if (idx >= 0 && idx < subtitleTracks.length - 1) {
      const nextTrack = subtitleTracks[idx + 1];
      setSelectedTrackId(nextTrack.id);
      showToast(`คำบรรยาย: ${nextTrack.label}`);
    } else {
      setIsCcActive(false);
      showToast('ปิดคำบรรยาย');
    }
  }, [hasSubtitles, subtitleTracks, isCcActive, activeSubTrack, showToast]);

  // Scrubber math
  const calcScrubFromClientX = useCallback(
    (clientX) => {
      const track = seekTrackRef.current;
      if (!track || !duration) return { pct: 0, time: 0 };
      const rect = track.getBoundingClientRect();
      const clampedX = Math.max(0, Math.min(clientX - rect.left, rect.width));
      const pct = rect.width > 0 ? (clampedX / rect.width) * 100 : 0;
      return { pct, time: (pct / 100) * duration };
    },
    [duration]
  );

  const handlePointerDown = (e) => {
    e.stopPropagation();
    e.preventDefault();
    isScrubbingRef.current = true;
    setIsScrubbing(true);
    const { pct, time } = calcScrubFromClientX(e.clientX);
    latestScrubTimeRef.current = time;
    setScrubPercent(pct);
    setPreviewTime(time);
    if (progressBarRef.current) progressBarRef.current.style.width = `${pct}%`;
    if (scrubberKnobRef.current) scrubberKnobRef.current.style.left = `${pct}%`;
  };

  const handleSeekMouseMove = (e) => {
    const { pct, time } = calcScrubFromClientX(e.clientX);
    setHoverPercent(pct);
    setHoverTime(time);
    if (isScrubbingRef.current) {
      latestScrubTimeRef.current = time;
      setScrubPercent(pct);
      setPreviewTime(time);
      if (progressBarRef.current) progressBarRef.current.style.width = `${pct}%`;
      if (scrubberKnobRef.current) scrubberKnobRef.current.style.left = `${pct}%`;
    }
  };

  const handlePointerUp = useCallback(() => {
    if (!isScrubbingRef.current) return;
    isScrubbingRef.current = false;
    setIsScrubbing(false);
    commitSeek(latestScrubTimeRef.current);
  }, [commitSeek]);

  useEffect(() => {
    if (!isScrubbing) return;
    const onMove = (e) => {
      const { pct, time } = calcScrubFromClientX(e.clientX);
      latestScrubTimeRef.current = time;
      setScrubPercent(pct);
      setPreviewTime(time);
      if (progressBarRef.current) progressBarRef.current.style.width = `${pct}%`;
      if (scrubberKnobRef.current) scrubberKnobRef.current.style.left = `${pct}%`;
    };
    const onUp = () => handlePointerUp();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [isScrubbing, calcScrubFromClientX, handlePointerUp]);

  // Focused keyboard shortcuts (never hijacks Studio inputs/scroll)
  useEffect(() => {
    const onKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target?.tagName) || e.target?.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!document.fullscreenElement && !containerRef.current?.contains(document.activeElement)) {
        return;
      }

      const code = e.code;
      if (code === 'Space' || code === 'KeyK') {
        e.preventDefault();
        togglePlay();
      } else if (code === 'KeyM') {
        e.preventDefault();
        toggleMute();
      } else if (code === 'KeyF') {
        e.preventDefault();
        toggleFullscreen();
      } else if (code === 'KeyC' && hasSubtitles) {
        e.preventDefault();
        handleCycleOrToggleCc();
      } else if (code === 'ArrowRight') {
        e.preventDefault();
        commitSeek((videoRef.current?.currentTime || 0) + 5);
      } else if (code === 'ArrowLeft') {
        e.preventDefault();
        commitSeek((videoRef.current?.currentTime || 0) - 5);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePlay, toggleMute, toggleFullscreen, hasSubtitles, handleCycleOrToggleCc, commitSeek]);

  const handleVideoSurfaceClick = (e) => {
    e.stopPropagation();
    containerRef.current?.focus({ preventScroll: true });
    if (showSpeedMenu) {
      setShowSpeedMenu(false);
      return;
    }
    if (e.detail >= 2) {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      toggleFullscreen();
      return;
    }
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => {
      togglePlay();
      clickTimerRef.current = null;
    }, 180);
  };

  const effectiveDuration = duration > 0 ? duration : 0;
  const currentProgressPct =
    effectiveDuration > 0 ? Math.min(100, Math.max(0, (currentTime / effectiveDuration) * 100)) : 0;
  const activeScrubPercent = isScrubbing ? scrubPercent : currentProgressPct;
  const activeTimeDisplay = isScrubbing
    ? formatTimePair(previewTime, duration)
    : formatTimePair(currentTime, duration);

  const subtitleLayout = useMemo(() => {
    const layout = computeSubtitleBoxLayout({
      containerWidth: containerSize.width,
      containerHeight: containerSize.height,
      videoRatio,
      aspectMode: 'fit',
      showControls,
      isPlaying,
      isMobile: !isFullscreen,
    });
    if (isFullscreen) return layout;
    return {
      ...layout,
      bottomPx: showControls || !isPlaying ? 38 : 10,
    };
  }, [containerSize.width, containerSize.height, videoRatio, showControls, isPlaying, isFullscreen]);

  const displayCue = normalizeDisplayCueText(activeCueText);

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onMouseMove={resetControlsTimer}
      onMouseLeave={() => {
        if (isPlaying && !showSpeedMenu && !isScrubbing) setShowControls(false);
      }}
      className={`relative bg-black select-none overflow-hidden outline-none group/player ${
        isFullscreen
          ? 'fixed inset-0 z-50 h-screen w-screen rounded-none'
          : 'w-full aspect-video rounded-none'
      } ${!showControls && isPlaying ? 'cursor-none' : 'cursor-default'}`}
    >
      {/* Native Video */}
      <video
        ref={videoRef}
        poster={poster}
        crossOrigin="anonymous"
        autoPlay={defaultAutoplay}
        playsInline
        preload="metadata"
        controlsList="nodownload nofullscreen noremoteplayback"
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => {
          setIsBuffering(false);
          setIsPlaying(true);
          setShowPoster(false);
          isEndedRef.current = false;
          setIsEnded(false);
          isUserPausedRef.current = false;
          if (videoRef.current?.videoWidth && videoRef.current?.videoHeight) {
            setVideoRatio(videoRef.current.videoWidth / videoRef.current.videoHeight);
          }
          resetControlsTimer();
        }}
        onPause={() => {
          const v = videoRef.current;
          if (!v || v.readyState < 1) return;
          if (v.ended || (v.duration > 0 && v.currentTime >= v.duration - 0.35)) {
            isEndedRef.current = true;
            setIsEnded(true);
            setIsPlaying(false);
            setShowControls(true);
            return;
          }
          if (!isUserPausedRef.current && v.readyState >= 2) {
            v.play().catch(() => {});
            return;
          }
          setIsPlaying(false);
          setShowControls(true);
        }}
        onEnded={() => {
          isEndedRef.current = true;
          setIsEnded(true);
          setIsPlaying(false);
          setShowControls(true);
        }}
        onDurationChange={(e) => {
          const d = e.target.duration;
          if (d && isFinite(d) && d > 0) setDuration(d);
        }}
        onLoadedMetadata={(e) => {
          const d = e.target.duration;
          if (d && isFinite(d) && d > 0) setDuration(d);
          if (e.target.videoWidth && e.target.videoHeight) {
            setVideoRatio(e.target.videoWidth / e.target.videoHeight);
          }
          updateBufferProgress();
        }}
        onProgress={updateBufferProgress}
        onError={() => {
          setHlsError('ไม่สามารถเล่นวิดีโอตัวอย่างได้');
          setIsBuffering(false);
        }}
        className="w-full h-full object-contain pointer-events-none block"
      />

      {/* Poster Backdrop before playback starts */}
      {poster && (
        <div
          className={`absolute inset-0 z-[2] pointer-events-none transition-opacity duration-300 ${
            showPoster ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={poster}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover blur-md scale-110 opacity-40"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={poster}
            alt={title || 'Video cover'}
            className="relative z-[1] w-full h-full object-contain"
          />
        </div>
      )}

      {/* Click / Double-click Surface */}
      <div
        onClick={handleVideoSurfaceClick}
        className="absolute inset-0 z-10 touch-manipulation"
      />

      {/* Brief Status Toast */}
      {toastMessage && (
        <div
          className={`absolute left-1/2 -translate-x-1/2 z-40 pointer-events-none whitespace-nowrap rounded-full bg-black/75 border border-white/15 text-white font-semibold backdrop-blur-md shadow-lg ${
            isFullscreen ? 'top-6 px-3.5 py-1 text-xs' : 'top-2 px-2.5 py-0.5 text-[10px]'
          }`}
        >
          {toastMessage}
        </div>
      )}

      {/* Center Buffering / Error / Play Button */}
      <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
        {hlsError ? (
          <div className="pointer-events-auto rounded-xl bg-black/90 border border-rose-500/35 px-3.5 py-2 text-center text-[11px] text-rose-400 max-w-[85%]">
            {hlsError}
          </div>
        ) : isBuffering ? (
          <svg
            className={`${isFullscreen ? 'w-12 h-12' : 'w-8 h-8'} animate-spin drop-shadow-md`}
            viewBox="0 0 48 48"
          >
            <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="3" />
            <circle
              cx="24"
              cy="24"
              r="20"
              fill="none"
              stroke="#FF7A00"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="40 126"
            />
          </svg>
        ) : (
          !isPlaying &&
          !isEnded && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                togglePlay();
              }}
              className={`pointer-events-auto rounded-full bg-black/45 hover:bg-[#FF7A00] border border-white/25 text-white flex items-center justify-center transition shadow-xl backdrop-blur-sm cursor-pointer ${
                isFullscreen ? 'w-14 h-14' : 'w-10 h-10'
              }`}
              title="เล่น"
            >
              <Play className={`${isFullscreen ? 'w-6 h-6' : 'w-4.5 h-4.5'} fill-white ml-0.5`} />
            </button>
          )
        )}
      </div>

      {/* Live CC Preview Overlay */}
      {displayCue && !isEnded && (
        <div
          className="absolute z-25 flex justify-center pointer-events-none transition-all duration-150"
          style={{
            bottom: `${subtitleLayout.bottomPx}px`,
            left: `${subtitleLayout.sideInsetPx}px`,
            right: `${subtitleLayout.sideInsetPx}px`,
          }}
        >
          <span
            className={`inline-block max-w-full whitespace-pre-line text-center break-words rounded-md bg-black/75 text-white font-medium shadow-md ${
              isFullscreen ? 'px-3 py-1 text-lg leading-snug' : 'px-2 py-0.5 text-[11px] leading-tight'
            }`}
          >
            {displayCue}
          </span>
        </div>
      )}

      {/* Minimalist Studio Bottom Bar + Speed Menu */}
      <MiniPlayerBottomBar
        isFullscreen={isFullscreen}
        showControls={showControls}
        isPlaying={isPlaying}
        isEnded={isEnded}
        isScrubbing={isScrubbing}
        activeTimeDisplay={activeTimeDisplay}
        timeDisplayRef={timeDisplayRef}
        togglePlay={togglePlay}
        toggleMute={toggleMute}
        isMuted={isMuted}
        volume={volume}
        handleVolumeChange={handleVolumeChange}
        playbackRate={playbackRate}
        onSelectPlaybackRate={handleSelectPlaybackRate}
        isCcActive={isCcActive}
        hasSubtitles={hasSubtitles}
        subtitleLabel={activeSubTrack?.label || ''}
        onCycleOrToggleCc={handleCycleOrToggleCc}
        toggleFullscreen={toggleFullscreen}
        seekTrackRef={seekTrackRef}
        bufferBarRef={bufferBarRef}
        progressBarRef={progressBarRef}
        scrubberKnobRef={scrubberKnobRef}
        initialBufferPct={0}
        activeScrubPercent={activeScrubPercent}
        hoverPercent={hoverPercent}
        hoverTime={hoverTime}
        previewTime={previewTime}
        previewPercent={scrubPercent}
        isHoveringSeek={isHoveringSeek}
        setIsHoveringSeek={setIsHoveringSeek}
        handlePointerDown={handlePointerDown}
        handleSeekMouseMove={handleSeekMouseMove}
        handlePointerUp={handlePointerUp}
        resetControlsTimer={resetControlsTimer}
        showSpeedMenu={showSpeedMenu}
        setShowSpeedMenu={setShowSpeedMenu}
      />
    </div>
  );
}
