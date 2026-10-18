'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Search, Trash2, PauseCircle, PlayCircle,
  X, AlertTriangle, ArrowRight, Film
} from 'lucide-react';
import { formatResolutionBadge, isMusicVideo, encodeVideoSlug } from '@/lib/videoUtils';
import { extractDominantColor } from '@/lib/colorExtractor';

// Helper: Group items by Date (YouTube Standard: วันนี้, เมื่อวานนี้, สัปดาห์นี้, เดือนนี้, ก่อนหน้านี้)
function groupHistoryByDate(items) {
  const groups = {
    today: { id: 'today', title: 'วันนี้', items: [] },
    yesterday: { id: 'yesterday', title: 'เมื่อวานนี้', items: [] },
    thisWeek: { id: 'thisWeek', title: 'สัปดาห์นี้', items: [] },
    thisMonth: { id: 'thisMonth', title: 'เดือนนี้', items: [] },
    older: { id: 'older', title: 'ก่อนหน้านี้', items: [] },
  };

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const startOfThisWeek = startOfToday - ((now.getDay() + 6) % 7) * 86400000;
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  for (const item of items) {
    const time = item.updated_at ? new Date(item.updated_at).getTime() : 0;
    if (time >= startOfToday) {
      groups.today.items.push(item);
    } else if (time >= startOfYesterday) {
      groups.yesterday.items.push(item);
    } else if (time >= startOfThisWeek) {
      groups.thisWeek.items.push(item);
    } else if (time >= startOfThisMonth) {
      groups.thisMonth.items.push(item);
    } else {
      groups.older.items.push(item);
    }
  }

  return Object.values(groups).filter((g) => g.items.length > 0);
}

function formatDuration(sec) {
  if (!sec || isNaN(sec)) return '0:00';
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const remSec = s % 60;
  const h = Math.floor(m / 60);
  const remMin = m % 60;
  if (h > 0) {
    return `${h}:${remMin.toString().padStart(2, '0')}:${remSec.toString().padStart(2, '0')}`;
  }
  return `${remMin}:${remSec.toString().padStart(2, '0')}`;
}

function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60_000);
    const hours = Math.floor(diff / 3_600_000);
    const days = Math.floor(diff / 86_400_000);

    if (mins < 1) return 'เมื่อสักครู่';
    if (mins < 60) return `${mins} นาทีที่แล้ว`;
    if (hours < 24) return `${hours} ชั่วโมงที่แล้ว`;
    if (days === 1) return 'เมื่อวานนี้';
    if (days < 7) return `${days} วันที่แล้ว`;
    return new Date(dateStr).toLocaleDateString('th-TH', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

/**
 * Single Video Item in Watch History with YouTube Themed Dynamic Color Hover
 */
function HistoryVideoItem({ item, onDelete, isDeleting }) {
  const [dominantColor, setDominantColor] = useState(null);
  const imgRef = useRef(null);

  const isMusic = isMusicVideo(item);
  const resBadge = formatResolutionBadge(item.resolution);
  const dur = item.duration || 0;
  const pos = isMusic ? 0 : (item.last_position_seconds || 0);
  // เพลงในหน้าประวัติการรับชม: เคยดูแล้วให้เส้นเต็ม 100% เลย ไม่ระบุเวลาดู
  const progressPct = isMusic ? 100 : (dur > 0 && pos > 0 ? Math.min((pos / dur) * 100, 100) : 0);
  const videoSlug = encodeVideoSlug(item.video_id, item.category) || item.video_id;
  const watchUrl = `/watch/${videoSlug}${!isMusic && pos > 5 ? `?t=${pos}` : ''}`;

  const handleImageLoad = (e) => {
    const color = extractDominantColor(e.target);
    if (color) setDominantColor(color);
  };

  useEffect(() => {
    if (imgRef.current && imgRef.current.complete && imgRef.current.naturalWidth > 0) {
      const color = extractDominantColor(imgRef.current);
      if (color) setDominantColor(color);
    }
  }, [item.thumbnail_url]);

  useEffect(() => {
    if (isMusic && item.video_id && typeof window !== 'undefined') {
      try {
        localStorage.removeItem(`tubelock_pos_${item.video_id}`);
      } catch (_) {}
    }
  }, [isMusic, item.video_id]);

  // Dynamic CSS variables derived from video's thumbnail color (YouTube signature style)
  const cardHoverStyle = dominantColor ? {
    '--hover-tint-dark': dominantColor.darkBg,
    '--hover-tint-light': dominantColor.lightBg,
  } : undefined;

  return (
    <div
      className="group relative flex flex-row items-start gap-3 sm:gap-4 p-2 sm:p-2.5 rounded-2xl yt-card-hover transition-colors cursor-pointer select-none"
      style={cardHoverStyle}
    >
      {/* Thumbnail (16:9) with Watched Progress Bar */}
      <Link
        href={watchUrl}
        className="relative aspect-video w-[140px] sm:w-[200px] md:w-[240px] shrink-0 rounded-xl overflow-hidden bg-zinc-900 shadow-2xs group-hover:opacity-95 transition"
      >
        {item.thumbnail_url ? (
          <img
            ref={imgRef}
            src={item.thumbnail_url}
            alt={item.title}
            crossOrigin="anonymous"
            onLoad={handleImageLoad}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-zinc-800 text-zinc-500">
            <Film className="w-6 h-6 opacity-40" />
          </div>
        )}

        {/* Duration Badge */}
        <div className="absolute right-1.5 bottom-1.5 bg-black/80 backdrop-blur-xs text-white text-[10px] sm:text-[11px] font-mono font-semibold px-1.5 py-0.5 rounded">
          {formatDuration(dur)}
        </div>

        {/* Resolution Badge */}
        {resBadge && (
          <div className="absolute left-1.5 top-1.5 bg-[#FF7A00] text-white text-[9px] font-bold px-1.5 py-0.2 rounded shadow-xs uppercase">
            {resBadge}
          </div>
        )}

        {/* YouTube Watch Progress Bar */}
        {progressPct > 0 && (
          <div className="absolute left-0 right-0 bottom-0 h-1 bg-black/40 overflow-hidden">
            <div
              className="h-full bg-[#FF7A00]"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}
      </Link>

      {/* Video Details: Clean YouTube standard */}
      <div className="flex-1 min-w-0 pr-8">
        {/* Title */}
        <Link
          href={watchUrl}
          className="font-medium text-xs sm:text-sm md:text-[15px] text-[#0F0F0F] dark:text-[#F1F1F1] group-hover:text-black dark:group-hover:text-white line-clamp-2 leading-snug transition-colors"
          title={item.title}
        >
          {item.title}
        </Link>

        {/* Channel Name */}
        <div className="flex items-center gap-1.5 text-xs text-[#606060] dark:text-[#AAAAAA] mt-1.5">
          {item.author_picture ? (
            <img
              src={item.author_picture}
              alt={item.author_name || 'Channel'}
              className="w-4 h-4 rounded-full object-cover shrink-0"
            />
          ) : (
            <div className="w-4 h-4 rounded-full bg-[#FF7A00] text-white text-[9px] font-bold flex items-center justify-center shrink-0">
              {(item.author_name || 'D').charAt(0)}
            </div>
          )}
          <span className="truncate hover:text-[#0F0F0F] dark:hover:text-[#F1F1F1] transition">
            {item.author_name || 'DONUŤ'}
          </span>
        </div>

        {/* Views & Relative Watch Date */}
        <div className="flex items-center gap-1 text-xs text-[#606060] dark:text-[#AAAAAA] mt-0.5">
          <span>{item.views_count ? `${item.views_count.toLocaleString()} ครั้ง` : '0 ครั้ง'}</span>
          <span>•</span>
          <span>{formatRelativeTime(item.updated_at)}</span>
        </div>
      </div>

      {/* Dismiss "X" Button (Top Right of row) */}
      <div className="absolute right-1.5 top-2.5">
        <button
          type="button"
          onClick={(e) => onDelete(e, item.video_id)}
          disabled={isDeleting}
          className="p-1.5 rounded-full text-[#8C857B] dark:text-[#888888] hover:text-[#0F0F0F] dark:hover:text-white hover:bg-black/10 dark:hover:bg-white/10 opacity-60 sm:opacity-0 group-hover:opacity-100 transition cursor-pointer"
          title="ลบออกจากประวัติการรับชม"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export default function HistoryClient({ initialHistory = [], initialUser, initialIsPaused = false }) {
  const router = useRouter();
  const [history, setHistory] = useState(initialHistory);
  const [searchQuery, setSearchQuery] = useState('');
  const [isPaused, setIsPaused] = useState(initialIsPaused);
  const [showClearModal, setShowClearModal] = useState(false);
  const [showPauseModal, setShowPauseModal] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  // Search filter
  const filteredHistory = useMemo(() => {
    if (!searchQuery.trim()) return history;
    const q = searchQuery.toLowerCase().trim();
    return history.filter((item) =>
      (item.title && item.title.toLowerCase().includes(q)) ||
      (item.author_name && item.author_name.toLowerCase().includes(q))
    );
  }, [history, searchQuery]);

  const grouped = useMemo(() => {
    return groupHistoryByDate(filteredHistory);
  }, [filteredHistory]);

  // Delete single video
  const handleDeleteItem = async (e, videoId) => {
    e.preventDefault();
    e.stopPropagation();
    setDeletingId(videoId);

    // Optimistic UI update
    setHistory((prev) => prev.filter((item) => item.video_id !== videoId));

    try {
      await fetch(`/api/history?videoId=${videoId}`, { method: 'DELETE' });
    } catch (err) {
      console.error('Failed to delete history item:', err);
    } finally {
      setDeletingId(null);
    }
  };

  // Clear all history
  const handleClearAll = async () => {
    setIsDeletingAll(true);
    try {
      const res = await fetch('/api/history?all=true', { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setHistory([]);
        setShowClearModal(false);
      }
    } catch (err) {
      console.error('Failed to clear all history:', err);
    } finally {
      setIsDeletingAll(false);
    }
  };

  // Toggle pause history
  const handleTogglePause = () => {
    const nextState = !isPaused;
    setIsPaused(nextState);
    setShowPauseModal(false);

    // Set cookie for 1 year
    document.cookie = `tubelock_pause_history=${nextState}; path=/; max-age=31536000; SameSite=Lax`;
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 select-none">
      <div className="flex flex-col lg:flex-row gap-8 lg:gap-12 items-start">
        {/* Left / Main Column: History Videos List */}
        <div className="flex-1 min-w-0 w-full">
          {/* Header */}
          <div className="flex items-center justify-between pb-4 mb-2 border-b border-[#EFECE6] dark:border-white/10">
            <h1 className="text-xl sm:text-2xl font-bold text-[#0F0F0F] dark:text-[#F1F1F1] tracking-tight">
              ประวัติการรับชม
            </h1>

            {/* Mobile Actions Button */}
            <div className="flex items-center gap-2 lg:hidden">
              {history.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowClearModal(true)}
                  className="p-2 rounded-full hover:bg-rose-50 dark:hover:bg-rose-950/30 text-rose-500 transition active:scale-95 cursor-pointer"
                  title="ล้างประวัติทั้งหมด"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Mobile Search Input */}
          <div className="block lg:hidden mb-4">
            <div className="relative flex items-center w-full">
              <Search className="w-4 h-4 text-[#8C857B] dark:text-[#888888] absolute left-3.5 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ค้นหาในประวัติการดู"
                className="w-full pl-9 pr-9 py-2 bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 rounded-xl text-xs sm:text-sm focus:outline-none focus:border-[#FF7A00] transition"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 text-[#8C857B] hover:text-[#0F0F0F] dark:hover:text-[#F1F1F1]"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Empty State */}
          {history.length === 0 ? (
            <div className="bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 rounded-2xl p-8 sm:p-12 text-center flex flex-col items-center gap-4 my-6 max-w-md mx-auto">
              <div className="w-14 h-14 rounded-2xl bg-[#FF7A00]/10 flex items-center justify-center text-[#FF7A00]">
                <Film className="w-7 h-7 stroke-[1.8]" />
              </div>
              <div className="flex flex-col gap-1">
                <h3 className="text-base font-bold text-[#0F0F0F] dark:text-[#F1F1F1]">
                  ยังไม่มีประวัติการรับชม
                </h3>
                <p className="text-xs text-[#606060] dark:text-[#AAAAAA] leading-relaxed">
                  วิดีโอที่คุณรับชมบน TubeLock จะปรากฏที่นี่
                </p>
              </div>
              <Link
                href="/"
                className="mt-2 inline-flex items-center gap-2 px-4 py-2 bg-[#FF7A00] hover:bg-[#E56E00] text-white font-semibold text-xs rounded-xl transition active:scale-95"
              >
                <span>สำรวจวิดีโอหน้าแรก</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          ) : filteredHistory.length === 0 ? (
            /* No Search Results */
            <div className="bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 rounded-xl p-8 text-center flex flex-col items-center gap-2.5 my-6">
              <Search className="w-7 h-7 text-[#8C857B]" />
              <p className="text-sm font-semibold text-[#0F0F0F] dark:text-[#F1F1F1]">
                ไม่พบวิดีโอที่ตรงกับ &ldquo;{searchQuery}&rdquo;
              </p>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="text-xs text-[#FF7A00] font-bold hover:underline cursor-pointer"
              >
                ล้างการค้นหา
              </button>
            </div>
          ) : (
            /* Grouped History List (Authentic YouTube Style with Themed Video Color Hover) */
            <div className="flex flex-col gap-6">
              {grouped.map((group) => (
                <div key={group.id} className="flex flex-col">
                  {/* Group Header */}
                  <h2 className="text-base font-bold text-[#0F0F0F] dark:text-[#F1F1F1] py-2 mb-2">
                    {group.title}
                  </h2>

                  {/* Video List */}
                  <div className="flex flex-col gap-1">
                    {group.items.map((item) => (
                      <HistoryVideoItem
                        key={item.history_id || item.video_id}
                        item={item}
                        onDelete={handleDeleteItem}
                        isDeleting={deletingId === item.video_id}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Column: Clean YouTube Desktop Control Sidebar (~300px) */}
        <div className="hidden lg:flex flex-col w-[280px] xl:w-[320px] shrink-0 sticky top-20 gap-3">
          {/* Search History Input */}
          <div className="relative flex items-center">
            <Search className="w-4 h-4 text-[#8C857B] dark:text-[#888888] absolute left-3.5 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ค้นหาในประวัติการดู"
              className="w-full pl-9 pr-9 py-2 bg-transparent border-b border-[#EFECE6] dark:border-white/15 text-sm focus:outline-none focus:border-[#FF7A00] transition placeholder:text-[#8C857B]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 text-[#8C857B] hover:text-[#0F0F0F] dark:hover:text-[#F1F1F1]"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="h-px bg-[#EFECE6] dark:bg-white/10 my-1" />

          {/* Clear All History Button */}
          <button
            type="button"
            onClick={() => setShowClearModal(true)}
            disabled={history.length === 0}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition text-left cursor-pointer ${history.length === 0
                ? 'opacity-30 cursor-not-allowed text-[#8C857B]'
                : 'hover:bg-rose-50 dark:hover:bg-rose-950/20 text-rose-600 dark:text-rose-400'
              }`}
          >
            <Trash2 className="w-4 h-4 shrink-0" />
            <span>ล้างประวัติการดูทั้งหมด</span>
          </button>

          {/* Pause / Resume History Button */}
          <button
            type="button"
            onClick={() => setShowPauseModal(true)}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium hover:bg-black/5 dark:hover:bg-white/10 text-[#0F0F0F] dark:text-[#F1F1F1] transition text-left cursor-pointer"
          >
            {isPaused ? (
              <>
                <PlayCircle className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>เปิดบันทึกประวัติการดูต่อ</span>
              </>
            ) : (
              <>
                <PauseCircle className="w-4 h-4 text-[#8C857B] dark:text-[#AAAAAA] shrink-0" />
                <span>หยุดบันทึกประวัติการดูชั่วคราว</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Confirmation Modal: Clear All History */}
      {showClearModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#1F1F1F] rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-[#EFECE6] dark:border-white/10 flex flex-col gap-4 animate-scaleUp">
            <div className="flex items-center gap-3 text-rose-500">
              <div className="w-10 h-10 rounded-full bg-rose-50 dark:bg-rose-950/40 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-rose-500" />
              </div>
              <h3 className="text-base font-bold text-[#0F0F0F] dark:text-[#F1F1F1]">
                ล้างประวัติการดูทั้งหมด?
              </h3>
            </div>

            <p className="text-xs sm:text-sm text-[#606060] dark:text-[#AAAAAA] leading-relaxed">
              ประวัติการรับชมวิดีโอทั้งหมดของคุณจะถูกลบออกจากบัญชีนี้ และตำแหน่งเวลาที่ค้างไว้จะถูกรีเซ็ตทั้งหมด
            </p>

            <div className="flex items-center justify-end gap-2.5 mt-2">
              <button
                type="button"
                onClick={() => setShowClearModal(false)}
                disabled={isDeletingAll}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-[#606060] dark:text-[#AAAAAA] hover:bg-black/5 dark:hover:bg-white/10 transition cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleClearAll}
                disabled={isDeletingAll}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white transition shadow-xs active:scale-95 cursor-pointer disabled:opacity-50"
              >
                {isDeletingAll ? 'กำลังล้าง...' : 'ล้างประวัติทั้งหมด'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal: Pause History */}
      {showPauseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#1F1F1F] rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-[#EFECE6] dark:border-white/10 flex flex-col gap-4 animate-scaleUp">
            <h3 className="text-base font-bold text-[#0F0F0F] dark:text-[#F1F1F1]">
              {isPaused ? 'เปิดบันทึกประวัติการดูต่อ?' : 'หยุดบันทึกประวัติการดูชั่วคราว?'}
            </h3>

            <p className="text-xs sm:text-sm text-[#606060] dark:text-[#AAAAAA] leading-relaxed">
              {isPaused
                ? 'วิดีโอที่คุณรับชมหลังจากนี้จะถูกบันทึกในประวัติการรับชมอีกครั้ง'
                : 'เมื่อหยุดบันทึก วิดีโอที่คุณรับชมจะไม่ถูกเพิ่มลงในประวัติ และจะไม่บันทึกเวลาที่ดูค้างไว้'}
            </p>

            <div className="flex items-center justify-end gap-2.5 mt-2">
              <button
                type="button"
                onClick={() => setShowPauseModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-[#606060] dark:text-[#AAAAAA] hover:bg-black/5 dark:hover:bg-white/10 transition cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleTogglePause}
                className={`px-4 py-2 rounded-xl text-xs font-semibold text-white transition shadow-xs active:scale-95 cursor-pointer ${isPaused ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-[#FF7A00] hover:bg-[#E56E00]'
                  }`}
              >
                {isPaused ? 'เปิดบันทึกต่อ' : 'หยุดชั่วคราว'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
