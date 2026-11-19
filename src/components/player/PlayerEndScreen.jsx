'use client';

import React, { useState, useEffect, useEffectEvent, useRef, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { Play, RotateCcw, Loader2, LockKeyhole, X } from 'lucide-react';
import { encodeVideoSlug, getVideoResumeTime, isMatureVideo, RESTRICTED_POSTER } from '@/lib/videoUtils';
import { usePosterReveal } from '@/lib/usePosterReveal';
import { usePosterPreference } from '@/lib/usePosterPreference';
import { useSession } from '@/context/SessionContext';
import { useVideoWatchProgress } from '@/lib/useVideoWatchProgress';
import { extractDominantColor } from '@/lib/colorExtractor';

// Track pre-warmed videos in memory
const preWarmedIds = new Set();
const PLAYLIST_COUNTDOWN_SECONDS = 5;

/**
 * Format Badge Duration (YouTube Style: 45:27, 7:06, 3:40:08)
 */
export function formatBadgeDuration(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  if (s === 0) return '00:00';
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

/**
 * Format Thai Views Count (YouTube Style: 7.1 หมื่น ครั้ง, 1.2 แสน ครั้ง, 135 ครั้ง)
 */
export function formatThaiViews(count) {
  const n = Number(count) || 0;
  if (n < 1000) return `${n.toLocaleString()} ครั้ง`;
  if (n < 10000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')} พัน ครั้ง`;
  if (n < 100000) return `${(n / 10000).toFixed(1).replace(/\.0$/, '')} หมื่น ครั้ง`;
  if (n < 1000000) return `${(n / 100000).toFixed(1).replace(/\.0$/, '')} แสน ครั้ง`;
  return `${(n / 1000000).toFixed(1).replace(/\.0$/, '')} ล้าน ครั้ง`;
}

/**
 * Format Thai Relative Time Ago (YouTube Style: 5 ชม. ที่แล้ว, 3 เดือนที่แล้ว, 1 วันที่แล้ว)
 */
export function formatThaiTimeAgo(dateInput) {
  if (!dateInput) return '';
  const now = Date.now();
  const past = new Date(dateInput).getTime();
  if (isNaN(past)) return '';
  const diffSec = Math.max(0, Math.floor((now - past) / 1000));

  if (diffSec < 60) return 'เมื่อสักครู่';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} นาทีที่แล้ว`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} ชม. ที่แล้ว`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay} วันที่แล้ว`;
  const diffWeek = Math.floor(diffDay / 7);
  if (diffWeek < 4) return `${diffWeek} สัปดาห์ที่แล้ว`;
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth < 12) return `${diffMonth} เดือนที่แล้ว`;
  const diffYear = Math.floor(diffDay / 365);
  return `${diffYear} ปีที่แล้ว`;
}

/**
 * YouTube-style Dynamic Recommendation Scorer & Weighted Sampler
 */
export function getDynamicRecommendations(currentVideo, allVideos = [], count = 3) {
  if (!Array.isArray(allVideos) || allVideos.length === 0) return [];
  const curId = currentVideo?.id ? String(currentVideo.id) : null;
  const seen = new Set();
  const filtered = [];
  for (let i = 0; i < allVideos.length; i++) {
    const v = allVideos[i];
    if (!v || !v.id) continue;
    const id = String(v.id);
    if (curId && id === curId) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    filtered.push(v);
    if (filtered.length >= count) break;
  }
  return filtered;
}

/**
 * EndScreenCard: Single recommendation card with dynamic dominant color hover background
 */
function EndScreenCard({ video: v, isThirdOnMobile, onPreWarm, isFullscreen = false, onSelectVideo = null, onPlayNext = null }) {
  const [dominantColor, setDominantColor] = useState(null);
  const imgRef = useRef(null);

  const videoSlug = encodeVideoSlug(v.id, v.category) || v.id;
  const durationStr = formatBadgeDuration(v.duration);
  const viewsStr = formatThaiViews(v.views_count);
  const timeAgoStr = formatThaiTimeAgo(v.created_at);
  const isMature = isMatureVideo(v);
  const isLoggedIn = Boolean(useSession());
  const showAdultPoster = usePosterPreference(isMature);
  const { poster, revealPoster } = usePosterReveal(isMature ? v.id : null, !showAdultPoster);
  const showRestriction = isMature && !showAdultPoster && poster?.status !== 'ready';
  const canRevealPoster = showRestriction && isLoggedIn;
  const { isMusic, pos, progressPct } = useVideoWatchProgress(v);
  const resumeTime = isMusic ? 0 : getVideoResumeTime(pos, v.duration);
  const watchUrl = `/watch/${videoSlug}${resumeTime ? `?t=${resumeTime}` : ''}`;
  const thumbnail = isMature
    ? (showAdultPoster ? `/api/videos/${v.id}/poster` : poster?.url || RESTRICTED_POSTER)
    : v.thumbnail_url || (v.id ? `/streams/stream_vid_${v.id}/poster.jpg` : null);

  const handleImageLoad = (e) => {
    const color = extractDominantColor(e.target);
    if (color) setDominantColor(color);
  };

  useEffect(() => {
    if (!isMature && imgRef.current && imgRef.current.complete && imgRef.current.naturalWidth > 0) {
      const color = extractDominantColor(imgRef.current);
      if (color) setDominantColor(color);
    }
  }, [thumbnail, isMature]);

  const cardHoverStyle = dominantColor ? {
    '--hover-tint-dark': dominantColor.darkBg,
    '--hover-tint-light': dominantColor.lightBg,
  } : undefined;
  const Action = onPlayNext ? 'button' : Link;

  return (
    <div
      onMouseEnter={() => onPreWarm(v.id)}
      className={`relative group flex flex-col cursor-pointer ${isFullscreen ? 'p-2 sm:p-2.5 -m-2 sm:-m-2.5' : 'p-1.5 sm:p-1.5 -m-2 sm:-m-2.5'
        } rounded-2xl yt-card-hover transition-all duration-200 ${isThirdOnMobile ? 'hidden md:flex' : 'flex'
        }`}
      style={cardHoverStyle}
    >
      <Action
        href={onPlayNext ? undefined : watchUrl}
        type={onPlayNext ? 'button' : undefined}
        onClick={(e) => {
          if (onPlayNext) {
            onPlayNext();
            return;
          }
          if (onSelectVideo && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
            e.preventDefault();
            onSelectVideo(v, resumeTime);
          } else {
            if (isFullscreen || (typeof document !== 'undefined' && (document.fullscreenElement || document.webkitFullscreenElement))) {
              try {
                sessionStorage.setItem('tubelock_keep_fullscreen', '1');
              } catch (_) {}
            }
          }
        }}
        aria-label={v.title || 'เล่นวิดีโอ'}
        className="absolute inset-0 z-10 cursor-pointer rounded-2xl focus-visible:outline-2 focus-visible:outline-[#FF7A00]"
      />
      {/* Thumbnail Container */}
      <div
        className={`relative w-full aspect-video rounded-xl overflow-hidden bg-zinc-900 transition-all duration-300 shadow-2xl ${canRevealPoster ? 'z-20' : ''}`}
      >
        {thumbnail ? (
          <img
            ref={imgRef}
            src={thumbnail}
            alt={v.title || 'Recommended video'}
            crossOrigin={isMature ? undefined : "anonymous"}
            onLoad={isMature ? undefined : handleImageLoad}
            className="w-full h-full object-cover transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-zinc-800 text-zinc-500">
            <Play className={isFullscreen ? "w-10 h-10 fill-zinc-600 opacity-60" : "w-8 h-8 fill-zinc-600 opacity-60"} />
          </div>
        )}

        {showRestriction && (isLoggedIn ? (
          <button
            type="button"
            disabled={poster?.status === 'loading'}
            aria-busy={poster?.status === 'loading'}
            onClick={() => void revealPoster(poster?.status === 'failed')}
            className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1.5 text-white cursor-pointer disabled:cursor-wait focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-[#FF7A00]"
          >
            <span className="flex items-center gap-1 text-xs font-semibold">
              <LockKeyhole aria-hidden="true" className="size-3.5 text-[#FF9A40]" />
              เนื้อหาจำกัดอายุ 18+
            </span>
            <span aria-live="polite" className="inline-flex items-center gap-1.5 rounded-full border border-[#FF7A00]/35 bg-[#21160f] px-3 py-1 text-[11px] font-medium">
              {poster?.status === 'loading' ? (
                <><Loader2 aria-hidden="true" className="size-3 animate-spin" />กำลังโหลดภาพปก</>
              ) : poster?.status === 'failed' ? 'ลองโหลดภาพปกอีกครั้ง' : 'แสดงภาพปก'}
            </span>
          </button>
        ) : (
          <div
            aria-hidden="true"
            className="absolute inset-0 z-20 flex flex-col items-center justify-center text-white pointer-events-none"
          >
            <span className="flex items-center gap-1 text-xs font-semibold">
              <LockKeyhole aria-hidden="true" className="size-3.5 text-[#FF9A40]" />
              เนื้อหาจำกัดอายุ 18+
            </span>
          </div>
        ))}

        {progressPct > 0 && (
          <div
            role="progressbar"
            aria-label="ความคืบหน้าการรับชม"
            aria-valuenow={Math.round(progressPct)}
            className="absolute inset-x-0 bottom-0 h-1 bg-black/40 pointer-events-none"
          >
            <div className="h-full bg-[#FF7A00]" style={{ width: `${progressPct}%` }} />
          </div>
        )}

        {/* Duration Badge */}
        {v.duration > 0 && (
          <div className={`absolute bg-black/85 backdrop-blur-sm text-white font-mono font-semibold rounded shadow-md pointer-events-none ${isFullscreen
            ? 'right-2.5 bottom-2.5 text-xs sm:text-sm px-2 py-0.5'
            : 'right-1.5 bottom-1.5 text-[10px] sm:text-xs px-1.5 py-0.5'
            }`}>
            {durationStr}
          </div>
        )}

      </div>

      {/* Video Info */}
      <div className={`flex flex-col min-w-0 ${isFullscreen ? 'mt-2.5 sm:mt-3.5' : 'mt-2 sm:mt-2.5'}`}>
        {/* Title */}
        <h4 className={`text-white font-semibold line-clamp-2 leading-snug group-hover:text-[#FF7A00] transition-colors ${isFullscreen
          ? 'text-sm sm:text-base md:text-lg xl:text-xl'
          : 'text-xs sm:text-sm md:text-[15px]'
          }`}>
          {v.title}
        </h4>

        {/* Author Name */}
        <div className={`flex items-center gap-1.5 truncate ${isFullscreen ? 'mt-1.5 sm:mt-2' : 'mt-1'}`}>
          {v.author_picture && (
            <img
              src={v.author_picture}
              alt={v.author_name || 'Channel'}
              className={`rounded-full object-cover shrink-0 ring-1 ring-white/15 ${isFullscreen ? 'w-4 h-4 sm:w-5 sm:h-5' : 'w-3.5 h-3.5 sm:w-4 sm:h-4'
                }`}
              referrerPolicy="no-referrer"
            />
          )}
          <span className={`text-zinc-300 dark:text-[#AAAAAA] truncate font-medium ${isFullscreen ? 'text-xs sm:text-sm md:text-base' : 'text-[11px] sm:text-xs'
            }`}>
            {v.author_name || 'TubeLock'}
          </span>
        </div>

        {/* Views & Time Ago */}
        <div className={`flex items-center gap-1 text-zinc-400 dark:text-[#888888] truncate ${isFullscreen ? 'text-xs sm:text-sm mt-1' : 'text-[10px] sm:text-[11px] mt-0.5'
          }`}>
          <span>{viewsStr}</span>
          {timeAgoStr && (
            <>
              <span>•</span>
              <span>{timeAgoStr}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * MobileEndScreenPrompt: YouTube-style single featured recommendation prompt ("วิดีโอแนะนำ") for mobile viewports
 */
function MobileEndScreenPrompt({ video: v, isFullscreen = false, onPreWarm, onSelectVideo = null, onDismiss = null, onPlayNext = null, countdown = null }) {
  const videoSlug = encodeVideoSlug(v.id, v.category) || v.id;
  const durationStr = formatBadgeDuration(v.duration);
  const isMature = isMatureVideo(v);
  const isLoggedIn = Boolean(useSession());
  const showAdultPoster = usePosterPreference(isMature);
  const { poster, revealPoster } = usePosterReveal(isMature ? v.id : null, !showAdultPoster);
  const showRestriction = isMature && !showAdultPoster && poster?.status !== 'ready';
  const canRevealPoster = showRestriction && isLoggedIn;
  const { isMusic, pos, progressPct } = useVideoWatchProgress(v);
  const resumeTime = isMusic ? 0 : getVideoResumeTime(pos, v.duration);
  const watchUrl = `/watch/${videoSlug}${resumeTime ? `?t=${resumeTime}` : ''}`;
  const thumbnail = isMature
    ? (showAdultPoster ? `/api/videos/${v.id}/poster` : poster?.url || RESTRICTED_POSTER)
    : v.thumbnail_url || (v.id ? `/streams/stream_vid_${v.id}/poster.jpg` : null);

  useEffect(() => {
    if (v?.id) onPreWarm?.(v.id);
  }, [v?.id, onPreWarm]);

  const handlePlay = (e) => {
    e?.stopPropagation?.();
    if (onSelectVideo && !e?.metaKey && !e?.ctrlKey && !e?.shiftKey && !e?.altKey) {
      e?.preventDefault?.();
      onSelectVideo(v, resumeTime);
    } else if (
      isFullscreen ||
      (typeof document !== 'undefined' && (document.fullscreenElement || document.webkitFullscreenElement))
    ) {
      try {
        sessionStorage.setItem('tubelock_keep_fullscreen', '1');
      } catch (_) {}
    }
  };

  const Action = onPlayNext ? 'button' : Link;
  const actionProps = onPlayNext
    ? { type: 'button', onClick: onPlayNext }
    : { href: watchUrl, onClick: handlePlay };

  return (
    <div
      className={`absolute inset-0 z-40 flex flex-col justify-between bg-[#0F0F0F]/95 backdrop-blur-md text-white select-none pointer-events-auto animate-fadeIn ${
        isFullscreen
          ? 'px-6 sm:px-10 pt-[calc(0.875rem+var(--player-safe-top,0px))] pb-[calc(1rem+var(--player-safe-bottom,0px))]'
          : 'px-3.5 py-2.5'
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#FF7A00] shadow-[0_0_8px_#FF7A00]" />
          <span className={`font-semibold text-white/95 ${isFullscreen ? 'text-sm sm:text-base' : 'text-xs'}`}>
            {countdown !== null ? `กำลังเล่นรายการถัดไปใน ${countdown} วินาที` : onPlayNext ? 'รายการถัดไป' : 'วิดีโอแนะนำ'}
          </span>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss?.();
          }}
          aria-label={onPlayNext ? 'ปิดการเล่นรายการถัดไป' : 'ปิดวิดีโอแนะนำ'}
          className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 active:bg-white/25 border border-white/15 backdrop-blur-md text-white/90 hover:text-white active:scale-90 transition cursor-pointer"
        >
          <X className={isFullscreen ? 'w-5 h-5' : 'w-4 h-4'} />
        </button>
      </div>

      {/* Single Featured Video Row */}
      <div className={`flex items-center w-full max-w-3xl mx-auto my-auto min-h-0 ${isFullscreen ? 'gap-5 sm:gap-7' : 'gap-3.5'}`}>
        <div
          className={`relative aspect-video rounded-xl overflow-hidden bg-zinc-900 border border-white/15 shrink-0 shadow-2xl ${
            isFullscreen ? 'w-[45%] max-w-[330px]' : 'w-[44%] max-w-[172px]'
          }`}
        >
          {!canRevealPoster && (
            <Action
              {...actionProps}
              aria-label={v.title || 'เล่นวิดีโอ'}
              className="absolute inset-0 z-10 rounded-xl"
            />
          )}

          {thumbnail ? (
            <img
              src={thumbnail}
              alt={v.title || 'Recommended video'}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-zinc-800 text-zinc-500">
              <Play className="w-8 h-8 fill-zinc-600 opacity-60" />
            </div>
          )}

          {showRestriction && (isLoggedIn ? (
            <button
              type="button"
              disabled={poster?.status === 'loading'}
              aria-busy={poster?.status === 'loading'}
              onClick={(e) => {
                e.stopPropagation();
                void revealPoster(poster?.status === 'failed');
              }}
              className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1 text-white cursor-pointer disabled:cursor-wait"
            >
              <span className="flex items-center gap-1 text-[11px] font-semibold">
                <LockKeyhole aria-hidden="true" className="size-3 text-[#FF9A40]" />
                18+
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-[#FF7A00]/35 bg-[#21160f] px-2 py-0.5 text-[10px] font-medium">
                {poster?.status === 'loading' ? (
                  <><Loader2 aria-hidden="true" className="size-2.5 animate-spin" />กำลังโหลด</>
                ) : poster?.status === 'failed' ? 'ลองอีกครั้ง' : 'แสดงภาพปก'}
              </span>
            </button>
          ) : (
            <div
              aria-hidden="true"
              className="absolute inset-0 z-20 flex flex-col items-center justify-center text-white pointer-events-none"
            >
              <span className="flex items-center gap-1 text-[11px] font-semibold">
                <LockKeyhole aria-hidden="true" className="size-3 text-[#FF9A40]" />
                18+
              </span>
            </div>
          ))}

          {progressPct > 0 && (
            <div
              role="progressbar"
              aria-label="ความคืบหน้าการรับชม"
              aria-valuenow={Math.round(progressPct)}
              className="absolute inset-x-0 bottom-0 h-1 bg-black/40 pointer-events-none"
            >
              <div className="h-full bg-[#FF7A00]" style={{ width: `${progressPct}%` }} />
            </div>
          )}

          {v.duration > 0 && (
            <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 text-[10px] sm:text-xs bg-black/85 text-white font-mono font-semibold rounded pointer-events-none">
              {durationStr}
            </span>
          )}
        </div>

        <Action
          {...actionProps}
          className="flex flex-col justify-center min-w-0 flex-1 text-left cursor-pointer"
        >
          <span className={`font-semibold text-[#FF7A00] ${isFullscreen ? 'text-xs mb-1' : 'text-[10px] mb-0.5'}`}>
            รายการถัดไป
          </span>
          <span className={`text-white font-bold leading-snug ${isFullscreen ? 'text-base sm:text-xl line-clamp-3' : 'text-[13px] line-clamp-2'}`}>
            {v.title}
          </span>
          <span className={`text-zinc-400 truncate ${isFullscreen ? 'text-xs sm:text-sm mt-1.5' : 'text-[11px] mt-0.5'}`}>
            {v.author_name || 'TubeLock'}
          </span>
        </Action>
      </div>

      {/* Bottom Action Pills */}
      <div className={`grid grid-cols-2 w-full max-w-3xl mx-auto shrink-0 ${isFullscreen ? 'gap-3.5 sm:gap-4' : 'gap-2.5'}`}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss?.();
          }}
          className={`rounded-full bg-white/10 hover:bg-white/15 active:bg-white/20 border border-white/15 backdrop-blur-md active:scale-[0.98] text-white/95 font-semibold flex items-center justify-center transition cursor-pointer ${
            isFullscreen ? 'h-10 sm:h-11 text-xs sm:text-sm' : 'h-8.5 text-xs'
          }`}
        >
          {onPlayNext ? 'ยกเลิก' : 'ปิด'}
        </button>

        <Action
          {...actionProps}
          className={`rounded-full bg-[#FF7A00] hover:bg-[#FF8C1A] active:bg-[#E56E00] border border-[#FF9A40]/40 active:scale-[0.98] text-white font-bold flex items-center justify-center gap-1.5 shadow-[0_4px_20px_rgba(255,122,0,0.35)] transition cursor-pointer ${
            isFullscreen ? 'h-10 sm:h-11 text-xs sm:text-sm' : 'h-8.5 text-xs'
          }`}
        >
          <Play className={isFullscreen ? 'w-4 h-4 fill-white text-white' : 'w-3.5 h-3.5 fill-white text-white'} />
          <span>เล่นเลย</span>
        </Action>
      </div>
    </div>
  );
}

/**
 * DesktopCountdownEndScreen: YouTube Desktop-style single focused "Up Next" countdown card
 * with continuous SVG circular progress ring, cover-extracted ambient glow & TubeLock pill controls.
 * Clicking "ยกเลิก" smoothly transitions to the standard 3-card recommendation end screen.
 */
function DesktopCountdownEndScreen({
  video: v,
  seconds,
  isFullscreen = false,
  onPreWarm,
  onPlayNext,
  onCancel,
  onReplay = null,
}) {
  const [dominantColor, setDominantColor] = useState(null);
  const [failedCorsSrc, setFailedCorsSrc] = useState(null);
  const imgRef = useRef(null);

  const durationStr = formatBadgeDuration(v.duration);
  const viewsStr = formatThaiViews(v.views_count);
  const timeAgoStr = formatThaiTimeAgo(v.created_at);
  const isMature = isMatureVideo(v);
  const isLoggedIn = Boolean(useSession());
  const showAdultPoster = usePosterPreference(isMature);
  const { poster, revealPoster } = usePosterReveal(isMature ? v.id : null, !showAdultPoster);
  const showRestriction = isMature && !showAdultPoster && poster?.status !== 'ready';
  const canRevealPoster = showRestriction && isLoggedIn;
  const { progressPct } = useVideoWatchProgress(v);
  const thumbnail = isMature
    ? (showAdultPoster ? `/api/videos/${v.id}/poster` : poster?.url || RESTRICTED_POSTER)
    : v.thumbnail_url || (v.id ? `/streams/stream_vid_${v.id}/poster.jpg` : null);
  const canSample = Boolean(!isMature && thumbnail && failedCorsSrc !== thumbnail);

  useEffect(() => {
    if (v?.id) onPreWarm?.(v.id);
  }, [v?.id, onPreWarm]);

  const sampleFromElement = useCallback((el) => {
    if (!el || !el.complete || !el.naturalWidth) return;
    const color = extractDominantColor(el);
    if (color) setDominantColor(color);
  }, []);

  useEffect(() => {
    if (!canSample) return;
    const raf = requestAnimationFrame(() => sampleFromElement(imgRef.current));
    return () => cancelAnimationFrame(raf);
  }, [canSample, thumbnail, sampleFromElement]);

  const accentColor = !isMature && dominantColor?.accentDark
    ? dominantColor.accentDark
    : '#FF9E40';
  const ambientGlow = !isMature && dominantColor?.darkBg
    ? dominantColor.darkBg
    : 'hsla(28, 85%, 58%, 0.18)';
  const ringBorder = !isMature && dominantColor?.borderDark
    ? dominantColor.borderDark
    : 'rgba(255, 255, 255, 0.16)';

  return (
    <div
      className={`absolute inset-0 z-20 flex flex-col items-center justify-center overflow-hidden bg-[#0B0B0B]/95 text-white backdrop-blur-md select-none pointer-events-auto animate-fadeIn ${
        isFullscreen ? 'px-8 pt-10 pb-24' : 'px-6 pt-5 pb-16'
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Cover-extracted ambient radial glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 transition-opacity duration-500"
        style={{
          background: `radial-gradient(ellipse 68% 58% at 50% 45%, ${ambientGlow}, transparent 76%)`,
        }}
      />

      <div
        className={`relative z-10 flex w-full flex-col items-center text-center ${
          isFullscreen ? 'max-w-[480px] xl:max-w-[540px]' : 'max-w-[332px] md:max-w-[368px]'
        }`}
      >
        {/* Top Countdown Status */}
        <div className={`flex items-center gap-2 ${isFullscreen ? 'mb-3.5 text-sm sm:text-base' : 'mb-2.5 text-xs sm:text-[13px]'}`}>
          <span
            className="size-2 rounded-full animate-pulse"
            style={{ backgroundColor: accentColor, boxShadow: `0 0 10px ${accentColor}` }}
          />
          <span className="font-medium text-white/85">
            รายการถัดไปใน{' '}
            <span className="font-bold tabular-nums" style={{ color: accentColor }}>
              {seconds}
            </span>{' '}
            วินาที
          </span>
        </div>

        {/* Hero 16:9 Thumbnail + Continuous SVG Countdown Ring */}
        <div
          className="group/next relative aspect-video w-full overflow-hidden rounded-2xl bg-zinc-900 shadow-[0_24px_64px_rgba(0,0,0,0.65)] transition-shadow duration-300"
          style={{ boxShadow: `0 22px 60px rgba(0, 0, 0, 0.65), 0 0 0 1px ${ringBorder}` }}
        >
          {!canRevealPoster && (
            <button
              type="button"
              onClick={onPlayNext}
              aria-label={`เล่น ${v.title || 'รายการถัดไป'} ทันที`}
              className="absolute inset-0 z-10 cursor-pointer rounded-2xl focus-visible:outline-2 focus-visible:outline-[#FF7A00]"
            />
          )}

          {thumbnail ? (
            <img
              ref={imgRef}
              key={canSample ? `sample-${thumbnail}` : `display-${thumbnail}`}
              src={thumbnail}
              alt={v.title || 'Next video'}
              crossOrigin={canSample ? 'anonymous' : undefined}
              onLoad={canSample ? (e) => sampleFromElement(e.currentTarget) : undefined}
              onError={canSample ? () => setFailedCorsSrc(thumbnail) : undefined}
              className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover/next:scale-[1.03]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-zinc-800 text-zinc-500">
              <Play className="size-10 fill-zinc-600 opacity-60" />
            </div>
          )}

          {/* Subtle center vignette + SVG Countdown Play Medallion */}
          {!showRestriction && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35 transition-colors duration-300 group-hover/next:bg-black/25">
              <div
                className={`relative grid place-items-center rounded-full bg-black/60 backdrop-blur-md shadow-2xl transition-transform duration-200 group-hover/next:scale-110 group-active/next:scale-95 ${
                  isFullscreen ? 'size-20' : 'size-16'
                }`}
              >
                <svg
                  viewBox="0 0 64 64"
                  aria-hidden="true"
                  className="absolute inset-0 size-full -rotate-90"
                >
                  <circle
                    cx="32"
                    cy="32"
                    r="28"
                    fill="none"
                    stroke="rgba(255, 255, 255, 0.2)"
                    strokeWidth="3.2"
                  />
                  <circle
                    cx="32"
                    cy="32"
                    r="28"
                    fill="none"
                    stroke={accentColor}
                    strokeWidth="3.2"
                    strokeLinecap="round"
                    className="animate-endscreen-countdown"
                    style={{
                      animationDuration: `${PLAYLIST_COUNTDOWN_SECONDS}s`,
                      filter: `drop-shadow(0 0 6px ${accentColor})`,
                    }}
                  />
                </svg>
                <Play
                  className={`translate-x-0.5 fill-white text-white ${isFullscreen ? 'size-8' : 'size-6'}`}
                  aria-hidden="true"
                />
              </div>
            </div>
          )}

          {showRestriction && (isLoggedIn ? (
            <button
              type="button"
              disabled={poster?.status === 'loading'}
              aria-busy={poster?.status === 'loading'}
              onClick={() => void revealPoster(poster?.status === 'failed')}
              className="absolute inset-0 z-20 flex cursor-pointer flex-col items-center justify-center gap-1.5 text-white disabled:cursor-wait focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-[#FF7A00]"
            >
              <span className="flex items-center gap-1 text-xs font-semibold">
                <LockKeyhole aria-hidden="true" className="size-3.5 text-[#FF9A40]" />
                เนื้อหาจำกัดอายุ 18+
              </span>
              <span aria-live="polite" className="inline-flex items-center gap-1.5 rounded-full border border-[#FF7A00]/35 bg-[#21160f] px-3 py-1 text-[11px] font-medium">
                {poster?.status === 'loading' ? (
                  <><Loader2 aria-hidden="true" className="size-3 animate-spin" />กำลังโหลดภาพปก</>
                ) : poster?.status === 'failed' ? 'ลองโหลดภาพปกอีกครั้ง' : 'แสดงภาพปก'}
              </span>
            </button>
          ) : (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center text-white"
            >
              <span className="flex items-center gap-1 text-xs font-semibold">
                <LockKeyhole aria-hidden="true" className="size-3.5 text-[#FF9A40]" />
                เนื้อหาจำกัดอายุ 18+
              </span>
            </div>
          ))}

          {progressPct > 0 && (
            <div
              role="progressbar"
              aria-label="ความคืบหน้าการรับชม"
              aria-valuenow={Math.round(progressPct)}
              className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-black/40"
            >
              <div className="h-full bg-[#FF7A00]" style={{ width: `${progressPct}%` }} />
            </div>
          )}

          {v.duration > 0 && (
            <div
              className={`pointer-events-none absolute rounded bg-black/85 font-mono font-semibold text-white shadow-md backdrop-blur-xs ${
                isFullscreen ? 'right-2.5 bottom-2.5 px-2 py-0.5 text-xs' : 'right-2 bottom-2 px-1.5 py-0.5 text-[11px]'
              }`}
            >
              {durationStr}
            </div>
          )}
        </div>

        {/* Video Title & Channel Meta */}
        <button
          type="button"
          onClick={onPlayNext}
          className={`group/title w-full cursor-pointer text-center ${isFullscreen ? 'mt-4' : 'mt-2.5'}`}
        >
          <h4
            className={`line-clamp-2 font-bold leading-snug text-white transition-colors group-hover/title:text-[#FF9E40] ${
              isFullscreen ? 'text-lg sm:text-xl' : 'text-sm sm:text-[15px]'
            }`}
          >
            {v.title}
          </h4>
        </button>

        <div className={`flex max-w-full items-center justify-center gap-1.5 text-zinc-400 ${isFullscreen ? 'mt-2 text-xs sm:text-sm' : 'mt-1 text-[11px] sm:text-xs'}`}>
          {v.author_picture && (
            <img
              src={v.author_picture}
              alt={v.author_name || 'Channel'}
              className={`shrink-0 rounded-full object-cover ring-1 ring-white/15 ${isFullscreen ? 'size-5' : 'size-4'}`}
              referrerPolicy="no-referrer"
            />
          )}
          <span className="truncate font-medium text-zinc-300">{v.author_name || 'TubeLock'}</span>
          {viewsStr && (
            <>
              <span aria-hidden="true">•</span>
              <span className="shrink-0">{viewsStr}</span>
            </>
          )}
          {timeAgoStr && (
            <>
              <span aria-hidden="true">•</span>
              <span className="shrink-0">{timeAgoStr}</span>
            </>
          )}
        </div>

        {/* Clean Action Pill Row */}
        <div className={`flex flex-wrap items-center justify-center gap-2.5 ${isFullscreen ? 'mt-5' : 'mt-3.5'}`}>
          <button
            type="button"
            onClick={onCancel}
            className={`cursor-pointer rounded-full border border-white/15 bg-white/10 font-semibold text-white/95 backdrop-blur-md transition hover:bg-white/20 active:scale-95 ${
              isFullscreen ? 'h-10 px-5 text-sm' : 'h-9 px-4 text-xs'
            }`}
          >
            ยกเลิก
          </button>

          <button
            type="button"
            onClick={onPlayNext}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[#FF9A40]/40 bg-[#FF7A00] font-bold text-white shadow-[0_4px_20px_rgba(255,122,0,0.35)] transition hover:bg-[#FF8C1A] active:scale-95 ${
              isFullscreen ? 'h-10 px-6 text-sm' : 'h-9 px-5 text-xs'
            }`}
          >
            <Play className={isFullscreen ? 'size-4 fill-white text-white' : 'size-3.5 fill-white text-white'} aria-hidden="true" />
            <span>เล่นเลย</span>
          </button>

          {onReplay && (
            <button
              type="button"
              onClick={onReplay}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-white/15 bg-white/10 font-semibold text-white/90 backdrop-blur-md transition hover:bg-white/20 hover:text-white active:scale-95 ${
                isFullscreen ? 'h-10 px-4 text-sm' : 'h-9 px-3.5 text-xs'
              }`}
            >
              <RotateCcw className={isFullscreen ? 'size-4' : 'size-3.5'} aria-hidden="true" />
              <span>เล่นซ้ำ</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PlayerEndScreen({
  isVisible = false,
  isFullscreen = false,
  isMobileView = false,
  currentVideo = null,
  relatedVideos = [],
  onReplay = null,
  onSelectVideo = null,
  onDismiss = null,
  playlistNextVideo = null,
  onPlayNext = null,
}) {
  const [seconds, setSeconds] = useState(PLAYLIST_COUNTDOWN_SECONDS);
  const [countdownCancelled, setCountdownCancelled] = useState(false);
  const countdownTimer = useRef(null);
  const hasPlaylistNext = Boolean(playlistNextVideo && onPlayNext);
  const showCountdown = isVisible && hasPlaylistNext && !countdownCancelled;

  const recommendations = useMemo(() => {
    if (!isVisible) return [];
    if (!hasPlaylistNext) return getDynamicRecommendations(currentVideo, relatedVideos, 3);
    const others = relatedVideos.filter((video) => String(video?.id) !== String(playlistNextVideo.id));
    return [playlistNextVideo, ...getDynamicRecommendations(currentVideo, others, 2)];
  }, [isVisible, currentVideo, relatedVideos, hasPlaylistNext, playlistNextVideo]);

  function stopCountdown() {
    clearInterval(countdownTimer.current);
    setCountdownCancelled(true);
  }

  function playPlaylistNext() {
    stopCountdown();
    onPlayNext?.();
  }

  const finishCountdown = useEffectEvent(playPlaylistNext);
  useEffect(() => {
    if (!showCountdown) return;
    const deadline = Date.now() + PLAYLIST_COUNTDOWN_SECONDS * 1000;
    const timer = setInterval(() => {
      const remaining = Math.ceil((deadline - Date.now()) / 1000);
      if (remaining <= 0) finishCountdown();
      else setSeconds(remaining);
    }, 250);
    countdownTimer.current = timer;
    return () => clearInterval(timer);
  }, [showCountdown]);

  // Pre-warm video on card hover for instant playback
  const handlePreWarm = useCallback((vidId) => {
    if (!vidId || preWarmedIds.has(vidId)) return;
    preWarmedIds.add(vidId);
    fetch(`/api/videos/${vidId}/source`, {
      method: 'GET',
      priority: 'low',
      cache: 'no-store',
    }).catch(() => {
      preWarmedIds.delete(vidId);
    });
  }, []);

  if (!isVisible || recommendations.length === 0) {
    return null;
  }

  if (isMobileView) {
    return (
      <MobileEndScreenPrompt
        video={recommendations[0]}
        isFullscreen={isFullscreen}
        onPreWarm={handlePreWarm}
        onSelectVideo={onSelectVideo}
        onDismiss={() => {
          if (hasPlaylistNext) stopCountdown();
          onDismiss?.();
        }}
        onPlayNext={hasPlaylistNext ? playPlaylistNext : null}
        countdown={showCountdown ? seconds : null}
      />
    );
  }

  if (showCountdown && playlistNextVideo) {
    return (
      <DesktopCountdownEndScreen
        video={playlistNextVideo}
        seconds={seconds}
        isFullscreen={isFullscreen}
        onPreWarm={handlePreWarm}
        onPlayNext={playPlaylistNext}
        onCancel={stopCountdown}
        onReplay={onReplay ? () => {
          stopCountdown();
          onReplay();
        } : null}
      />
    );
  }

  const containerMaxWidth = isFullscreen
    ? 'max-w-[92vw] xl:max-w-[1440px] 2xl:max-w-[1680px]'
    : 'max-w-5xl';

  return (
    <div
      className={`absolute inset-0 z-20 flex flex-col justify-center items-center pointer-events-auto bg-black transition-all duration-300 animate-fadeIn select-none ${isFullscreen
        ? 'px-8 pb-20 pt-10'
        : 'px-3 sm:px-6 md:px-8 pb-16 pt-8'
        }`}
      onClick={(e) => {
        // Prevent background clicks from triggering seek/pause
        e.stopPropagation();
      }}
    >
      {/* Optional Top Quick Replay Button */}
      {onReplay && (
        <div className={`w-full flex justify-end ${containerMaxWidth} ${isFullscreen ? 'mb-3 sm:mb-5' : 'mb-2 sm:mb-4'}`}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onReplay();
            }}
            className={`inline-flex items-center gap-2 rounded-full bg-white/10 hover:bg-white/20 text-white/90 hover:text-white font-semibold backdrop-blur-md border border-white/15 transition cursor-pointer shadow-lg ${isFullscreen ? 'px-4 py-2 text-sm' : 'px-3 py-1.5 text-xs'
              }`}
          >
            <RotateCcw className={isFullscreen ? "w-4 h-4" : "w-3.5 h-3.5"} />
            <span>เล่นซ้ำ</span>
          </button>
        </div>
      )}

      {/* 3 Video Cards Row (YouTube Desktop 3-Card Layout) */}
      <div className={`grid grid-cols-2 md:grid-cols-3 w-full mx-auto items-start ${containerMaxWidth} ${isFullscreen
        ? 'gap-5 sm:gap-6'
        : 'gap-3 sm:gap-4 md:gap-5'
        }`}>
        {recommendations.map((v, idx) => (
          <EndScreenCard
            key={v.id}
            video={v}
            isFullscreen={isFullscreen}
            isThirdOnMobile={idx === 2}
            onPreWarm={handlePreWarm}
            onSelectVideo={onSelectVideo}
            onPlayNext={hasPlaylistNext && idx === 0 ? playPlaylistNext : null}
          />
        ))}
      </div>
    </div>
  );
}
