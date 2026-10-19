'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Play, RotateCcw } from 'lucide-react';
import { encodeVideoSlug } from '@/lib/videoUtils';
import { extractDominantColor } from '@/lib/colorExtractor';

// Track pre-warmed videos in memory
const preWarmedIds = new Set();

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
 * Extract keywords from text
 */
function extractKeywords(text) {
  if (!text || typeof text !== 'string') return new Set();
  const cleaned = text
    .toLowerCase()
    .replace(/[^\u0E00-\u0E7Fa-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
  return new Set(cleaned);
}

/**
 * YouTube-style Dynamic Recommendation Scorer & Weighted Sampler
 */
export function getDynamicRecommendations(currentVideo, allVideos = [], count = 3) {
  if (!allVideos || allVideos.length === 0) return [];

  const currentId = currentVideo?.id ? String(currentVideo.id) : null;
  const currentCategory = currentVideo?.category?.toLowerCase() || '';
  const currentAuthor = currentVideo?.author_name || '';
  const currentUserId = currentVideo?.user_id;
  const currentTokens = extractKeywords(`${currentVideo?.title || ''} ${currentVideo?.tags || ''}`);

  // 1. Filter out current video and invalid items
  const candidates = allVideos.filter((v) => {
    if (!v || !v.id) return false;
    if (currentId && String(v.id) === currentId) return false;
    if (v.status && v.status !== 'READY') return false;
    return true;
  });

  if (candidates.length <= count) {
    return candidates;
  }

  // 2. Score candidates with dynamic weighting
  const scored = candidates.map((v) => {
    let score = 0;

    // A. Category match (high relevance)
    const vCat = (v.category || '').toLowerCase();
    if (currentCategory && vCat && currentCategory === vCat) {
      score += 48;
    }

    // B. Channel / Author match
    if (currentAuthor && v.author_name && currentAuthor === v.author_name) {
      score += 35;
    }
    if (currentUserId && v.user_id && currentUserId === v.user_id) {
      score += 35;
    }

    // C. Keyword / Tag overlap
    const vTokens = extractKeywords(`${v.title || ''} ${v.tags || ''}`);
    let matchCount = 0;
    for (const token of currentTokens) {
      if (vTokens.has(token)) {
        matchCount++;
      }
    }
    score += Math.min(matchCount * 14, 42);

    // D. Popularity boost
    const views = Number(v.views_count) || 0;
    if (views > 0) {
      score += Math.min(Math.log10(views + 1) * 3, 12);
    }

    // E. Dynamic Jitter (+0 to +25) - ensures fresh, dynamic recommendation mix
    score += Math.random() * 25;

    return { video: v, score };
  });

  // 3. Sort by highest dynamic score and slice target count
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, count).map((item) => item.video);
}

/**
 * EndScreenCard: Single recommendation card with dynamic dominant color hover background
 */
function EndScreenCard({ video: v, isThirdOnMobile, onPreWarm, isFullscreen = false }) {
  const [dominantColor, setDominantColor] = useState(null);
  const [isHovered, setIsHovered] = useState(false);
  const imgRef = useRef(null);

  const videoSlug = encodeVideoSlug(v.id, v.category) || v.id;
  const watchUrl = `/watch/${videoSlug}`;
  const durationStr = formatBadgeDuration(v.duration);
  const viewsStr = formatThaiViews(v.views_count);
  const timeAgoStr = formatThaiTimeAgo(v.created_at);
  const thumbnail = v.thumbnail_url || (v.id ? `/streams/stream_vid_${v.id}/poster.jpg` : null);

  const handleImageLoad = (e) => {
    const color = extractDominantColor(e.target);
    if (color) setDominantColor(color);
  };

  useEffect(() => {
    if (imgRef.current && imgRef.current.complete && imgRef.current.naturalWidth > 0) {
      const color = extractDominantColor(imgRef.current);
      if (color) setDominantColor(color);
    }
  }, [thumbnail]);

  const cardHoverStyle = dominantColor ? {
    '--hover-tint-dark': dominantColor.darkBg,
    '--hover-tint-light': dominantColor.lightBg,
  } : undefined;

  return (
    <Link
      href={watchUrl}
      onMouseEnter={() => {
        setIsHovered(true);
        onPreWarm(v.id);
      }}
      onMouseLeave={() => setIsHovered(false)}
      className={`group flex flex-col cursor-pointer ${isFullscreen ? 'p-2 sm:p-2.5 -m-2 sm:-m-2.5' : 'p-1.5 sm:p-1.5 -m-2 sm:-m-2.5'
        } rounded-2xl yt-card-hover transition-all duration-200 ${isThirdOnMobile ? 'hidden md:flex' : 'flex'
        }`}
      style={cardHoverStyle}
    >
      {/* Thumbnail Container */}
      <div
        className="relative w-full aspect-video rounded-xl overflow-hidden bg-zinc-900 transition-all duration-300 shadow-2xl"
      >
        {thumbnail ? (
          <img
            ref={imgRef}
            src={thumbnail}
            alt={v.title || 'Recommended video'}
            crossOrigin="anonymous"
            onLoad={handleImageLoad}
            className="w-full h-full object-cover transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-zinc-800 text-zinc-500">
            <Play className={isFullscreen ? "w-10 h-10 fill-zinc-600 opacity-60" : "w-8 h-8 fill-zinc-600 opacity-60"} />
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
    </Link>
  );
}

export default function PlayerEndScreen({
  isVisible = false,
  isFullscreen = false,
  currentVideo = null,
  relatedVideos = [],
  onReplay = null,
}) {
  const [recommendations, setRecommendations] = useState([]);
  const hasSampledRef = useRef(false);

  // Compute dynamic recommendations whenever isVisible becomes true
  useEffect(() => {
    if (isVisible) {
      const recs = getDynamicRecommendations(currentVideo, relatedVideos, 3);
      setRecommendations(recs);
      hasSampledRef.current = true;
    } else {
      hasSampledRef.current = false;
    }
  }, [isVisible, currentVideo, relatedVideos]);

  // Pre-warm video on card hover for instant playback
  const handlePreWarm = (vidId) => {
    if (!vidId || preWarmedIds.has(vidId)) return;
    preWarmedIds.add(vidId);
    fetch(`/api/videos/${vidId}/source`, {
      method: 'GET',
      priority: 'low',
      cache: 'no-store',
    }).catch(() => {
      preWarmedIds.delete(vidId);
    });
  };

  if (!isVisible || recommendations.length === 0) {
    return null;
  }

  const containerMaxWidth = isFullscreen
    ? 'max-w-[92vw] xl:max-w-[1440px] 2xl:max-w-[1680px]'
    : 'max-w-5xl';

  return (
    <div
      className={`absolute inset-0 z-20 flex flex-col justify-center items-center pointer-events-auto bg-black transition-all duration-300 animate-fadeIn select-none ${isFullscreen
        ? 'px-4 px-8 pb-20 pt-10'
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
        ? 'gap-5 sm:gap-6 md:gap-7 lg:gap-8'
        : 'gap-3 sm:gap-4 md:gap-5'
        }`}>
        {recommendations.map((v, idx) => (
          <EndScreenCard
            key={v.id}
            video={v}
            isFullscreen={isFullscreen}
            isThirdOnMobile={idx === 2}
            onPreWarm={handlePreWarm}
          />
        ))}
      </div>
    </div>
  );
}
