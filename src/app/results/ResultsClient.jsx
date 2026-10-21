'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  SlidersHorizontal,
  CheckCircle2,
  MoreVertical,
  Play,
  Search,
  Sparkles,
  X,
  Clock,
  Share2,
  Bookmark,
  ListPlus
} from 'lucide-react';
import { formatResolutionBadge, encodeVideoSlug, isMusicVideo } from '@/lib/videoUtils';

const FILTER_CHIPS = [
  { id: 'all', label: 'ทั้งหมด' },
  { id: 'shorts', label: 'Shorts' },
  { id: 'unwatched', label: 'ยังไม่ได้ดู' },
  { id: 'watched', label: 'ดูแล้ว' },
  { id: 'videos', label: 'วิดีโอ' },
  { id: 'recent', label: 'อัปโหลดล่าสุด' },
  { id: 'live', label: 'ไลฟ์สด' },
];

export default function ResultsClient({ initialQuery = '' }) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const queryFromUrl = searchParams.get('search_query') || initialQuery;
  const currentQuery = queryFromUrl ? queryFromUrl.replace(/\+/g, ' ') : '';

  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeChip, setActiveChip] = useState('all');
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [sortBy, setSortBy] = useState('relevance'); // relevance, date, views
  const [durationFilter, setDurationFilter] = useState('all'); // all, short (<4m), medium (4-20m), long (>20m)
  const [featureFilter, setFeatureFilter] = useState('all'); // all, 4k, 60fps

  // Load videos from API
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/videos')
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data?.data && Array.isArray(data.data)) {
          setVideos(data.data);
        }
      })
      .catch((err) => {
        console.error('Failed to load search videos:', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Helper to apply chips and panel filters
  const applyFilters = (videoList) => {
    let result = [...videoList];

    // Apply Chip Filter
    if (activeChip === 'shorts') {
      result = result.filter(
        (v) =>
          v.category === 'shorts' ||
          (v.tags && v.tags.includes('shorts')) ||
          (v.duration && v.duration <= 60)
      );
    } else if (activeChip === 'watched') {
      result = result.filter((v) => v.has_watched);
    } else if (activeChip === 'unwatched') {
      result = result.filter((v) => !v.has_watched);
    } else if (activeChip === 'recent') {
      result = [...result].sort(
        (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
      );
    }

    // Apply Filter Panel: Duration
    if (durationFilter === 'short') {
      result = result.filter((v) => v.duration && v.duration < 240);
    } else if (durationFilter === 'medium') {
      result = result.filter((v) => v.duration && v.duration >= 240 && v.duration <= 1200);
    } else if (durationFilter === 'long') {
      result = result.filter((v) => v.duration && v.duration > 1200);
    }

    // Apply Filter Panel: Features (4K, 60FPS)
    if (featureFilter === '4k') {
      result = result.filter(
        (v) =>
          (v.resolution && (v.resolution.includes('4K') || v.resolution.includes('2160'))) ||
          v.title.toLowerCase().includes('4k')
      );
    } else if (featureFilter === '60fps') {
      result = result.filter(
        (v) => (v.fps && Number(v.fps) >= 59) || v.title.toLowerCase().includes('60')
      );
    }

    // Apply Filter Panel: Sort
    if (sortBy === 'date') {
      result = [...result].sort(
        (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
      );
    } else if (sortBy === 'views') {
      result = [...result].sort(
        (a, b) => Number(b.views_count || 0) - Number(a.views_count || 0)
      );
    }

    return result;
  };

  // 🚀 Advanced Multi-Signal YouTube-Grade Relevance Search Algorithm
  const searchResults = useMemo(() => {
    if (!Array.isArray(videos) || videos.length === 0) return [];

    const rawQ = currentQuery.trim().toLowerCase();
    if (!rawQ) {
      return applyFilters(videos);
    }

    const qNormalized = rawQ.replace(/\s+/g, '');
    const queryTokens = rawQ.split(/\s+/).filter(Boolean);

    // Scoring function across multiple signals
    const scored = videos.map((video) => {
      let score = 0;
      let matchedTokensCount = 0;

      const title = (video.title || '').toLowerCase();
      const titleNormalized = title.replace(/\s+/g, '');
      const desc = (video.description || '').toLowerCase();
      const descNormalized = desc.replace(/\s+/g, '');
      const author = (video.author_name || '').toLowerCase();
      const authorNormalized = author.replace(/\s+/g, '');
      const tags = Array.isArray(video.tags) ? video.tags.map((t) => String(t).toLowerCase()) : [];
      const res = (video.resolution || '').toLowerCase();
      const fps = String(video.fps || '');
      const codec = (video.codec || '').toLowerCase();
      const category = (video.category || '').toLowerCase();

      // 1. 🏆 Title Matching (Highest Priority)
      if (title === rawQ || titleNormalized === qNormalized) {
        score += 300; // Exact match
      } else if (title.startsWith(rawQ) || titleNormalized.startsWith(qNormalized)) {
        score += 180; // Starts with query
      } else if (title.includes(rawQ) || titleNormalized.includes(qNormalized)) {
        score += 120; // Contains full phrase (with or without spaces for Thai)
      }

      // 2. 👤 Channel / Author Matching
      if (author === rawQ || authorNormalized === qNormalized) {
        score += 150;
      } else if (author.includes(rawQ) || authorNormalized.includes(qNormalized)) {
        score += 80;
      }

      // 3. 📝 Description Matching
      if (desc.includes(rawQ) || descNormalized.includes(qNormalized)) {
        score += 40;
      }

      // 4. 🏷️ Category & Intent Matching
      const musicKeywords = ['เพลง', 'ดนตรี', 'music', 'song', 'mv', 'official'];
      const gamingKeywords = ['เกม', 'game', 'gaming', 'gameplay', 'walkthrough'];
      const shortsKeywords = ['ช็อต', 'ขาสั้น', 'shorts', 'short'];

      if (musicKeywords.some((kw) => rawQ.includes(kw))) {
        if (category === 'music' || tags.some((t) => musicKeywords.includes(t)) || title.includes('mv') || title.includes('เพลง')) {
          score += 60;
        }
      }
      if (gamingKeywords.some((kw) => rawQ.includes(kw))) {
        if (category === 'gaming' || tags.some((t) => gamingKeywords.includes(t)) || title.includes('game')) {
          score += 60;
        }
      }
      if (shortsKeywords.some((kw) => rawQ.includes(kw))) {
        if (category === 'shorts' || (video.duration && video.duration <= 60)) {
          score += 60;
        }
      }

      // 5. ⚡ Technical Specs & Codec Detection (Deep Metadata Matching)
      const is4kQuery = queryTokens.some((t) => ['4k', '2160', '2160p', 'uhd'].includes(t));
      const is60fpsQuery = queryTokens.some((t) => ['60', '60fps', 'fps'].includes(t));
      const isHdrQuery = queryTokens.some((t) => ['hdr', 'hdr10', 'hdr60'].includes(t));
      const isAv1Query = queryTokens.some((t) => ['av1', 'av01'].includes(t));
      const isH264Query = queryTokens.some((t) => ['h264', 'x264', 'avc'].includes(t));

      if (is4kQuery) {
        if (res.includes('4k') || res.includes('2160') || Number(video.file_size_bytes) > 50000000 || title.includes('4k')) {
          score += 70;
        }
      }
      if (is60fpsQuery) {
        if (Number(video.fps) >= 59 || title.includes('60') || desc.includes('60')) {
          score += 70;
        }
      }
      if (isHdrQuery) {
        if (title.includes('hdr') || desc.includes('hdr')) {
          score += 50;
        }
      }
      if (isAv1Query && codec.includes('av1')) {
        score += 70;
      }
      if (isH264Query && (codec.includes('h264') || codec.includes('avc'))) {
        score += 50;
      }

      // 6. 🧩 Multi-Token & Tags Scorer
      queryTokens.forEach((token) => {
        let tokenMatched = false;

        // Title token
        if (title.includes(token)) {
          score += 25;
          tokenMatched = true;
        }
        // Channel token
        if (author.includes(token)) {
          score += 20;
          tokenMatched = true;
        }
        // Tag token
        if (tags.some((t) => t.includes(token))) {
          score += 15;
          tokenMatched = true;
        }
        // Description token
        if (desc.includes(token)) {
          score += 8;
          tokenMatched = true;
        }

        if (tokenMatched) matchedTokensCount++;
      });

      // 🎯 Multi-word completion bonus: if ALL tokens matched, give huge relevance boost
      if (queryTokens.length > 1 && matchedTokensCount === queryTokens.length) {
        score += 80;
      }

      // Freshness bonus
      if (score > 0 && video.created_at) {
        const daysOld = (Date.now() - new Date(video.created_at).getTime()) / (1000 * 60 * 60 * 24);
        if (daysOld < 30) score += 10;
        if (daysOld < 7) score += 15;
      }

      return { video, score };
    });

    const matched = scored.filter((item) => item.score > 0);

    const sortedVideos = matched
      .sort((a, b) => b.score - a.score)
      .map((item) => item.video);

    return applyFilters(sortedVideos);
  }, [videos, currentQuery, activeChip, durationFilter, featureFilter, sortBy]);

  return (
    <div className="w-full min-h-[calc(100vh-56px)] bg-[#FBF9F5] dark:bg-[#0F0F0F] text-[#0F0F0F] dark:text-[#F1F1F1] pb-16">
      {/* 🧭 Top Filter Chips & Filter Toggle Bar */}
      <div className="sticky top-14 z-30 bg-[#FBF9F5]/98 dark:bg-[#0F0F0F]/98 backdrop-blur-md border-b border-[#EFECE6]/80 dark:border-white/10 px-4 md:px-6 py-2.5 transition-colors">
        <div className="max-w-[1190px] mx-auto flex items-center justify-between gap-3">
          {/* Left: Chips scroll container */}
          <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden py-0.5">
            {FILTER_CHIPS.map((chip) => {
              const isActive = activeChip === chip.id;
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setActiveChip(chip.id)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all duration-150 cursor-pointer ${isActive
                    ? 'bg-[#0F0F0F] text-white dark:bg-[#F1F1F1] dark:text-[#0F0F0F] shadow-xs'
                    : 'bg-black/5 dark:bg-white/10 text-[#0F0F0F] dark:text-[#F1F1F1] hover:bg-black/10 dark:hover:bg-white/20'
                    }`}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>

          {/* Right: Filter options button (ตัวกรอง) */}
          <button
            type="button"
            onClick={() => setShowFilterPanel((prev) => !prev)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition cursor-pointer shrink-0 ${showFilterPanel
              ? 'bg-black/15 dark:bg-white/20 text-[#FF7A00]'
              : 'hover:bg-black/5 dark:hover:bg-white/10 text-[#0F0F0F] dark:text-[#F1F1F1]'
              }`}
            title="ตัวกรองการค้นหา"
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span className="hidden sm:inline">ตัวกรอง</span>
          </button>
        </div>

        {/* 🎛️ Collapsible YouTube Search Filter Panel */}
        {showFilterPanel && (
          <div className="max-w-[1190px] mx-auto pt-4 pb-2 border-t border-black/10 dark:border-white/10 mt-3 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs animate-in fade-in slide-in-from-top-2 duration-200">
            {/* 1. จัดเรียงตาม */}
            <div>
              <span className="font-semibold uppercase tracking-wider text-[#606060] dark:text-[#AAAAAA] block mb-2">
                จัดเรียงตาม
              </span>
              <div className="flex flex-col gap-1.5">
                {[
                  { id: 'relevance', label: 'ความเกี่ยวข้อง' },
                  { id: 'date', label: 'วันที่อัปโหลด' },
                  { id: 'views', label: 'ยอดดู' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setSortBy(opt.id)}
                    className={`text-left py-1 hover:text-[#FF7A00] transition ${sortBy === opt.id ? 'font-bold text-[#FF7A00]' : 'text-[#606060] dark:text-[#AAAAAA]'
                      }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 2. ระยะเวลา */}
            <div>
              <span className="font-semibold uppercase tracking-wider text-[#606060] dark:text-[#AAAAAA] block mb-2">
                ระยะเวลา
              </span>
              <div className="flex flex-col gap-1.5">
                {[
                  { id: 'all', label: 'ทั้งหมด' },
                  { id: 'short', label: 'สั้น (< 4 นาที)' },
                  { id: 'medium', label: 'ปานกลาง (4–20 นาที)' },
                  { id: 'long', label: 'ยาว (> 20 นาที)' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setDurationFilter(opt.id)}
                    className={`text-left py-1 hover:text-[#FF7A00] transition ${durationFilter === opt.id ? 'font-bold text-[#FF7A00]' : 'text-[#606060] dark:text-[#AAAAAA]'
                      }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 3. คุณสมบัติ */}
            <div>
              <span className="font-semibold uppercase tracking-wider text-[#606060] dark:text-[#AAAAAA] block mb-2">
                คุณสมบัติ
              </span>
              <div className="flex flex-col gap-1.5">
                {[
                  { id: 'all', label: 'ทั้งหมด' },
                  { id: '4k', label: '4K Ultra HD' },
                  { id: '60fps', label: '60 FPS' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setFeatureFilter(opt.id)}
                    className={`text-left py-1 hover:text-[#FF7A00] transition ${featureFilter === opt.id ? 'font-bold text-[#FF7A00]' : 'text-[#606060] dark:text-[#AAAAAA]'
                      }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 4. ล้างตัวกรอง */}
            <div className="flex flex-col justify-start">
              <span className="font-semibold uppercase tracking-wider text-[#606060] dark:text-[#AAAAAA] block mb-2">
                การตั้งค่า
              </span>
              <button
                onClick={() => {
                  setSortBy('relevance');
                  setDurationFilter('all');
                  setFeatureFilter('all');
                  setActiveChip('all');
                }}
                className="text-left text-[#FF7A00] hover:underline py-1 flex items-center gap-1 font-medium"
              >
                <X className="w-3.5 h-3.5" /> รีเซ็ตตัวกรองทั้งหมด
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 🎬 Search Results List (YouTube Desktop Horizontal Format) */}
      <div className="mx-auto px-4 md:px-6 pt-5">
        {loading ? (
          // Skeleton Loader
          <div className="flex flex-col gap-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex flex-col sm:flex-row gap-4 animate-pulse">
                <div className="w-full sm:w-[360px] md:w-[420px] lg:w-[480px] xl:w-[500px] aspect-video rounded-2xl bg-black/5 dark:bg-white/5 shrink-0" />
                <div className="flex-1 flex flex-col gap-2 py-1">
                  <div className="h-5 w-4/5 rounded bg-black/5 dark:bg-white/5" />
                  <div className="h-3 w-1/3 rounded bg-black/5 dark:bg-white/5" />
                  <div className="flex items-center gap-2 mt-2">
                    <div className="w-6 h-6 rounded-full bg-black/5 dark:bg-white/5 shrink-0" />
                    <div className="h-3.5 w-28 rounded bg-black/5 dark:bg-white/5" />
                  </div>
                  <div className="h-3 w-3/5 rounded bg-black/5 dark:bg-white/5 mt-1" />
                </div>
              </div>
            ))}
          </div>
        ) : searchResults.length > 0 ? (
          // List of horizontal video cards
          <div className="flex flex-col gap-4">
            {searchResults.map((video) => (
              <HorizontalVideoCard key={video.id} video={video} />
            ))}
          </div>
        ) : (
          // Empty State with YouTube Recommended Fallback
          <div className="flex flex-col py-8">
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="w-16 h-16 rounded-full bg-black/5 dark:bg-white/5 flex items-center justify-center mb-3">
                <Search className="w-7 h-7 text-[#8C857B] dark:text-[#AAAAAA]" />
              </div>
              <h3 className="text-lg font-semibold mb-1">ไม่พบผลการค้นหาสำหรับ "{currentQuery}"</h3>
              <p className="text-xs text-[#606060] dark:text-[#AAAAAA] max-w-md">
                ลองค้นหาด้วยคำอื่น หรือเลือกดูวิดีโอน่าสนใจด้านล่างนี้
              </p>
            </div>

            {/* YouTube-style 'วิดีโอแนะนำสำหรับคุณ' */}
            {videos.length > 0 && (
              <div className="mt-4 pt-6 border-t border-black/10 dark:border-white/10">
                <h4 className="text-base font-semibold mb-4 text-[#0F0F0F] dark:text-[#F1F1F1] flex items-center gap-2">
                  {/* <Sparkles className="w-4 h-4 text-[#FF7A00]" /> */}
                  <span>วิดีโอแนะนำสำหรับคุณ</span>
                </h4>
                <div className="flex flex-col gap-4">
                  {videos.slice(0, 8).map((video) => (
                    <HorizontalVideoCard key={video.id} video={video} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// 📺 YouTube Horizontal Search Video Card Component
function HorizontalVideoCard({ video }) {
  const [imgError, setImgError] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef(null);

  const formatDuration = (sec) => {
    if (!sec) return '00:00';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const formatViews = (views) => {
    const num = Number(views || 0);
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)} ล้าน`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)} พัน`;
    return `${num}`;
  };

  const formatTimeAgo = (dateStr) => {
    if (!dateStr) return 'ไม่นานมานี้';
    const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
    if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))} นาทีที่ผ่านมา`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} ชั่วโมงที่ผ่านมา`;
    if (diff < 2592000) return `${Math.floor(diff / 86400)} วันที่ผ่านมา`;
    if (diff < 31536000) return `${Math.floor(diff / 2592000)} เดือนที่แล้ว`;
    return `${Math.floor(diff / 31536000)} ปีที่แล้ว`;
  };

  const videoSlug = encodeVideoSlug(video?.id, video?.category) || video?.id;
  const isMusic = isMusicVideo(video);
  const pos = Number(video?.last_position_seconds || 0);
  const dur = Number(video?.duration || 0);
  const watchUrl = `/watch/${videoSlug}${!isMusic && pos > 5 ? `?t=${pos}` : ''}`;

  const resBadge = formatResolutionBadge(video.resolution);
  const effectiveThumbnail =
    video.thumbnail_url || (video.id ? `/streams/stream_vid_${video.id}/poster.jpg` : null);
  const is4K = resBadge === '4K' || (video.title && video.title.toLowerCase().includes('4k'));
  const is60Fps = (video.fps && Number(video.fps) >= 59) || (video.title && video.title.toLowerCase().includes('60'));

  const progressPct = dur > 0 && pos > 0 ? Math.min((pos / dur) * 100, 100) : 0;

  // Close menu on click outside
  useEffect(() => {
    if (!showMenu) return;
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  return (
    <div className="group flex flex-col sm:flex-row gap-4 relative select-none">
      {/* 🖼️ Left Thumbnail Container */}
      <Link
        href={watchUrl}
        className="w-full sm:w-[360px] md:w-[420px] lg:w-[480px] aspect-video rounded-2xl overflow-hidden relative bg-zinc-900 shrink-0 shadow-2xs group-hover:shadow-md transition duration-200"
      >
        {effectiveThumbnail && !imgError ? (
          <img
            src={effectiveThumbnail}
            alt={video.title}
            onError={() => setImgError(true)}
            className="w-full h-full object-cover transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-zinc-900 text-zinc-500">
            <Play className="w-8 h-8 fill-current opacity-60" />
          </div>
        )}

        {/* Duration badge bottom-right */}
        {video.duration > 0 && (
          <div className="absolute bottom-2 right-2 bg-black/80 text-white text-[12px] font-semibold px-1.5 py-0.5 rounded font-mono z-10 shadow-xs">
            {formatDuration(video.duration)}
          </div>
        )}

        {/* Progress bar (if watched / in progress) */}
        {progressPct > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20 z-10">
            <div className="h-full bg-[#FF7A00]" style={{ width: `${progressPct}%` }} />
          </div>
        )}
      </Link>

      {/* 📋 Right Info Column */}
      <div className="flex-1 min-w-0 flex flex-col justify-start pt-0.5 relative pr-8">
        {/* Title */}
        <Link href={watchUrl}>
          <h3 className="text-[17px] sm:text-[18px] font-normal sm:font-medium leading-snug line-clamp-2 text-[#0F0F0F] dark:text-[#F1F1F1] group-hover:text-black dark:group-hover:text-white transition-colors">
            {video.title}
          </h3>
        </Link>

        {/* Metadata: Views & Date */}
        <div className="flex items-center gap-1.5 text-[12px] text-[#606060] dark:text-[#AAAAAA] mt-1 truncate">
          <span>{`การรับชม ${formatViews(video.views_count)} ครั้ง`}</span>
          <span>•</span>
          <span>{formatTimeAgo(video.created_at)}</span>
        </div>

        {/* Channel Row (Avatar + Name + Verified Badge) */}
        <div className="flex items-center gap-2 mt-3 mb-2">
          {video.author_picture ? (
            <img
              src={video.author_picture}
              alt={video.author_name || 'Channel'}
              className="w-6 h-6 rounded-full object-cover shrink-0 ring-1 ring-black/10 dark:ring-white/10"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-6 h-6 rounded-full bg-[#FF7A00] flex items-center justify-center text-white text-[11px] font-bold shrink-0">
              {(video.author_name || 'D')[0].toUpperCase()}
            </div>
          )}

          <span className="text-[12px] font-medium text-[#606060] dark:text-[#AAAAAA] hover:text-[#0F0F0F] dark:hover:text-white transition-colors truncate">
            {video.author_name || 'DONUŤ'}
          </span>

          {/* <CheckCircle2 className="w-3.5 h-3.5 text-[#606060] dark:text-[#AAAAAA] shrink-0" /> */}
        </div>

        {/* Description snippet */}
        <p className="text-[12px] text-[#606060] dark:text-[#AAAAAA] line-clamp-1 sm:line-clamp-2 leading-relaxed mt-0.5">
          {video.description ||
            `วิดีโอคุณภาพสูงรับชมผ่าน TubeLock Private HLS Stream ระบบสตรีมมิ่งความละเอียดคมชัด รองรับการเล่นบนทุกอุปกรณ์`}
        </p>

        {/* Badges row: 4K, 60FPS, Codec */}
        <div className="flex items-center gap-1.5 mt-3 flex-wrap">
          {is4K && (
            <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 text-[#606060] dark:text-[#AAAAAA] tracking-wider border border-black/10 dark:border-white/10">
              4K
            </span>
          )}

          {is60Fps && (
            <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 text-[#606060] dark:text-[#AAAAAA] tracking-wider border border-black/10 dark:border-white/10">
              60FPS
            </span>
          )}

          {video.codec && (
            <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 text-[#606060] dark:text-[#AAAAAA] tracking-wider">
              {video.codec.toUpperCase()}
            </span>
          )}

          <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 text-[#606060] dark:text-[#AAAAAA] tracking-wider">
            คำบรรยาย
          </span>
        </div>

        {/* ⋯ Three-dots menu button (top-right of text column) */}
        <div ref={menuRef} className="absolute right-0 top-0">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setShowMenu((prev) => !prev);
            }}
            className="p-1.5 rounded-full hover:bg-black/10 dark:hover:bg-white/15 text-[#606060] dark:text-[#AAAAAA] hover:text-[#0F0F0F] dark:hover:text-white transition opacity-0 group-hover:opacity-100 cursor-pointer"
            title="การดำเนินการเพิ่มเติม"
          >
            <MoreVertical className="w-5 h-5" />
          </button>

          {showMenu && (
            <div className="absolute right-0 top-8 z-30 w-52 bg-white dark:bg-[#282828] border border-black/10 dark:border-white/10 rounded-xl shadow-xl py-1.5 text-sm text-[#0F0F0F] dark:text-[#F1F1F1] animate-in fade-in zoom-in-95 duration-100">
              <button
                type="button"
                onClick={() => {
                  setShowMenu(false);
                  navigator.clipboard?.writeText(window.location.origin + watchUrl);
                }}
                className="w-full px-4 py-2 flex items-center gap-3 hover:bg-black/5 dark:hover:bg-white/10 text-left transition"
              >
                <Share2 className="w-4 h-4 text-[#8C857B] dark:text-[#AAAAAA]" />
                <span>คัดลอกลิงก์</span>
              </button>
              <button
                type="button"
                onClick={() => setShowMenu(false)}
                className="w-full px-4 py-2 flex items-center gap-3 hover:bg-black/5 dark:hover:bg-white/10 text-left transition"
              >
                <Clock className="w-4 h-4 text-[#8C857B] dark:text-[#AAAAAA]" />
                <span>บันทึกไปยังดูภายหลัง</span>
              </button>
              <button
                type="button"
                onClick={() => setShowMenu(false)}
                className="w-full px-4 py-2 flex items-center gap-3 hover:bg-black/5 dark:hover:bg-white/10 text-left transition"
              >
                <ListPlus className="w-4 h-4 text-[#8C857B] dark:text-[#AAAAAA]" />
                <span>บันทึกไปยังเพลย์ลิสต์</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
