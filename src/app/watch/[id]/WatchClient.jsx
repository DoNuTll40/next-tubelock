'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import VideoCard from '@/components/VideoCard';
import DescriptionBox from '@/components/watch/DescriptionBox';
import {
  DESKTOP_PLAYER_MAX_HEIGHT,
  useGlobalPlayer,
} from '@/context/GlobalPlayerContext';
import {
  Share2,
  ThumbsUp,
  ThumbsDown,
  Film,
  Bookmark,
  UploadCloud,
  AlertCircle,
  ArrowLeft,
} from 'lucide-react';
import { formatResolutionBadge } from '@/lib/videoUtils';

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const remSec = s % 60;
  const h = Math.floor(m / 60);
  const remMin = m % 60;
  if (h > 0) {
    return `${h}:${remMin.toString().padStart(2, '0')}:${remSec.toString().padStart(2, '0')}`;
  }
  return `${remMin}:${remSec.toString().padStart(2, '0')}`;
}

const subscribeDesktopLg = (cb) => {
  if (typeof window === 'undefined') return () => {};
  const mq = window.matchMedia('(min-width: 1024px)');
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};
const getDesktopLgSnapshot = () =>
  typeof window !== 'undefined' ? window.matchMedia('(min-width: 1024px)').matches : null;
const getDesktopLgServerSnapshot = () => null;

export default function WatchClient({
  initialVideo,
  initialRelated = [],
  initialTime = 0,
  initialShowAdultPosters = false,
  initialSource = null,
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlT = searchParams?.get('t');
  const urlV = searchParams?.get('v')?.trim() || null;

  const {
    video: globalVideo,
    error,
    videoRatio: globalVideoRatio,
    relatedVideos: globalRelated,
    isDockedInWatch,
    handleSeek,
    dockPlayerSlot,
    undockPlayerSlot,
    hydrateWatchPage,
  } = useGlobalPlayer();

  // Compute SSR fallback aspect ratio for initial pre-dock frame
  const initialRatio = useMemo(() => {
    const res = initialVideo?.active_version?.resolution || initialVideo?.resolution;
    if (typeof res === 'string' && res.includes('x')) {
      const [w, h] = res.split('x').map(parseFloat);
      if (w > 0 && h > 0) return w / h;
    }
    if (initialVideo?.width > 0 && initialVideo?.height > 0) {
      return initialVideo.width / initialVideo.height;
    }
    if (initialVideo?.category === 'shorts') return 9 / 16;
    return 16 / 9;
  }, [initialVideo]);

  const video = isDockedInWatch ? (globalVideo || initialVideo) : initialVideo;
  const relatedVideos = isDockedInWatch ? globalRelated : initialRelated;
  const videoRatio = isDockedInWatch ? globalVideoRatio : initialRatio;

  const [copied, setCopied] = useState(false);
  const [liked, setLiked] = useState(false);
  const [disliked, setDisliked] = useState(false);
  const [likeCount, setLikeCount] = useState(652);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [activeFilter, setActiveFilter] = useState('all');
  const [avatarError, setAvatarError] = useState(false);
  const [prevVideoId, setPrevVideoId] = useState(initialVideo?.id ?? null);

  if ((video?.id ?? null) !== prevVideoId) {
    setPrevVideoId(video?.id ?? null);
    setAvatarError(false);
  }

  const playerWrapperRef = useRef(null);
  const [playerHeight, setPlayerHeight] = useState(0);
  const isDesktopLg = useSyncExternalStore(
    subscribeDesktopLg,
    getDesktopLgSnapshot,
    getDesktopLgServerSnapshot
  );

  // Handle browser Back / Forward buttons
  useEffect(() => {
    const handlePopState = () => {
      router.refresh();
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [router]);

  // Clean URL query param (?t=...) after reading initial seek time, so page reload won't stick to old time!
  useEffect(() => {
    if (urlT && typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('t');
      window.history.replaceState(null, '', url.pathname + (url.search ? url.search : ''));
    }
  }, [urlT]);

  // Sync SSR watch page payload to GlobalPlayerContext (reuses already-primed stream if matched!)
  useLayoutEffect(() => {
    hydrateWatchPage({
      initialVideo,
      initialRelated,
      initialTime,
      initialShowAdultPosters,
      initialSource,
      requestedVersion: urlV,
    });
  }, [
    initialVideo,
    initialRelated,
    initialTime,
    initialShowAdultPosters,
    initialSource,
    urlV,
    hydrateWatchPage,
  ]);

  // Dock persistent singleton #movie_player into #player-primary-container via DOM Reparenting
  useLayoutEffect(() => {
    const slotEl = playerWrapperRef.current;
    if (!slotEl) return undefined;
    dockPlayerSlot(slotEl);
    return () => {
      undockPlayerSlot(slotEl);
    };
  }, [dockPlayerSlot, undockPlayerSlot]);

  // Measure player height for mobile sticky chips (< 768px only; tablet/desktop md+ uses static flow)
  useEffect(() => {
    const el = playerWrapperRef.current;
    if (!el) return;

    const updateHeight = () => {
      if (typeof window !== 'undefined' && window.innerWidth >= 768) return;
      if (el) {
        const h = Math.round(el.getBoundingClientRect().height);
        if (h > 0) {
          setPlayerHeight((prev) => (prev === h ? prev : h));
        }
      }
    };

    updateHeight();
    const ro = new ResizeObserver(updateHeight);
    ro.observe(el);
    return () => ro.disconnect();
  }, [videoRatio, isDockedInWatch]);

  const handleCopyLink = () => {
    if (typeof window !== 'undefined') {
      navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleLike = () => {
    if (liked) {
      setLiked(false);
      setLikeCount((c) => c - 1);
    } else {
      setLiked(true);
      setLikeCount((c) => c + 1);
      if (disliked) setDisliked(false);
    }
  };

  const handleDislike = () => {
    if (disliked) {
      setDisliked(false);
    } else {
      setDisliked(true);
      if (liked) {
        setLiked(false);
        setLikeCount((c) => c - 1);
      }
    }
  };

  const fileSizeMB = video?.file_size_bytes
    ? (Number(video.file_size_bytes) / (1024 * 1024)).toFixed(1)
    : '0';

  const resBadge = formatResolutionBadge(video?.resolution);
  const viewsCount =
    typeof video?.views_count === 'number' || video?.views_count
      ? Number(video.views_count)
      : 0;
  const viewsDisplay = `${viewsCount.toLocaleString()} ครั้ง`;

  // Filter recommendations across the ranked pool, keeping DOM compact at max 20 cards
  const currentVideoCategory = video?.category;
  const filteredRelated = useMemo(() => {
    if (!relatedVideos) return [];
    let result = relatedVideos;
    if (activeFilter === 'cloud') {
      result = relatedVideos.filter((v) => v.source_type === 'hls' || v.onedrive_folder_id);
    } else if (activeFilter === '4k') {
      result = relatedVideos.filter((v) => {
        const r = (v.resolution || '').toLowerCase();
        return r.includes('4k') || r.includes('2160') || (v.width && v.width >= 3840);
      });
    } else if (activeFilter === 'related') {
      result = relatedVideos.filter((v) => {
        if (!currentVideoCategory || !v.category) return true;
        return v.category === currentVideoCategory;
      });
    }
    return result.slice(0, 20);
  }, [relatedVideos, activeFilter, currentVideoCategory]);

  if (error && !video) {
    return (
      <div className="max-w-md mx-auto p-8 text-center flex flex-col items-center gap-4 mt-16 bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 rounded-3xl shadow-sm">
        <div className="w-14 h-14 rounded-full bg-rose-50 dark:bg-rose-950/40 flex items-center justify-center text-rose-500">
          <AlertCircle className="w-7 h-7 stroke-[1.8]" />
        </div>
        <div>
          <h2 className="text-base font-bold text-[#212529] dark:text-[#F1F1F1]">เกิดข้อผิดพลาดในการโหลด</h2>
          <p className="text-xs text-[#8C857B] dark:text-[#AAAAAA] mt-1.5 leading-relaxed">{error || 'ไม่พบข้อมูลวิดีโอ'}</p>
        </div>
        <button
          type="button"
          onClick={() => router.push('/')}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#F5F2EB] dark:bg-white/10 hover:bg-[#EFECE6] dark:hover:bg-white/15 text-[#212529] dark:text-[#F1F1F1] rounded-xl text-xs font-semibold transition active:scale-95 cursor-pointer mt-2"
        >
          <ArrowLeft className="w-4 h-4" />
          กลับสู่หน้าหลัก
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[2560px] mx-auto px-0 sm:px-4 lg:px-5 pt-0 sm:pt-2 sm:pb-6 lg:pt-3">
      {/* ⚠️ Alert Banner */}
      {error && (
        <div className="bg-rose-500/10 border-b border-rose-500/20 px-4 py-3 text-rose-500 dark:text-rose-400 text-xs sm:text-sm flex items-center justify-between z-30 relative mb-3 rounded-xl">
          <div className="flex items-center gap-2 max-w-4xl mx-auto w-full">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => router.push('/')}
            className="text-xs underline hover:no-underline font-semibold cursor-pointer shrink-0 ml-4"
          >
            กลับหน้าหลัก
          </button>
        </div>
      )}

      <div className="block lg:flex lg:flex-row lg:items-start lg:justify-center lg:gap-4 w-full">
        {/* Left Column: Player Slot + Details */}
        <div
          className="contents md:flex md:flex-col md:w-full md:mx-auto lg:mx-0 lg:flex-1 lg:min-w-0"
          style={{
            maxWidth: (videoRatio && videoRatio >= 0.98)
              ? `min(100%, calc((${DESKTOP_PLAYER_MAX_HEIGHT}) * ${videoRatio}))`
              : (videoRatio && videoRatio < 0.98)
                ? `min(100%, calc((${DESKTOP_PLAYER_MAX_HEIGHT}) * (16 / 9)))`
                : '100%',
          }}
        >
          {/* 🎯 Primary Player Slot: Receives singleton #movie_player (AmbientLight + VideoPlayer) via DOM Reparenting */}
          <div
            ref={playerWrapperRef}
            id="player-primary-container"
            className={`sticky top-0 z-30 w-full bg-black md:bg-transparent md:relative md:z-0 has-[[data-player-fullscreen="true"]]:!z-[100] ${videoRatio < 0.98 ? 'h-[min(48vh,380px)] md:h-auto flex justify-center items-center md:block' : ''
              }`}
            style={
              !isDockedInWatch
                ? {
                    aspectRatio: videoRatio < 0.98 ? '16 / 9' : `${videoRatio}`,
                    maxHeight: DESKTOP_PLAYER_MAX_HEIGHT,
                  }
                : undefined
            }
          />

          {/* 📱 YouTube-Style Video Details Section (SSR Rendered Immediately!) */}
          <div className="relative z-10 w-full flex flex-col gap-3 p-3.5 sm:px-0 sm:pt-3.5 bg-[#FBF9F5] dark:bg-[#0F0F0F] sm:bg-transparent dark:sm:bg-transparent transition-colors">
            {/* 1. Title */}
            <h1 className="text-[17px] sm:text-xl font-bold text-[#0F0F0F] dark:text-[#F1F1F1] leading-snug tracking-tight">
              {video?.title || ''}
            </h1>

            {/* 2. YouTube-Style Channel (Left) + Action Buttons (Right) */}
            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-3 py-1">
              <div className="flex justify-between items-center min-w-0">
                <div className="flex gap-3 items-center min-w-0">
                  {video?.author_picture && !avatarError ? (
                    <img
                      src={video.author_picture}
                      alt={video?.author_name || 'Channel'}
                      onError={() => setAvatarError(true)}
                      className="w-10 h-10 rounded-full object-cover shadow-xs shrink-0 ring-1 ring-black/10 dark:ring-white/10"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-[#FF7A00] to-[#FF9E40] flex items-center justify-center text-white font-bold shadow-xs shrink-0 text-sm">
                      {(video?.author_name || 'D').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="flex flex-col min-w-0 pr-1 sm:pr-2">
                    <span className="font-bold text-[14px] sm:text-[15px] text-[#0F0F0F] dark:text-[#F1F1F1] truncate leading-tight">
                      {video?.author_name || 'DONUŤ'}
                    </span>
                    <span className="text-[12px] text-[#606060] dark:text-[#AAAAAA] truncate mt-0.5">
                      {video?.subscribers_count ? `ผู้ติดตาม ${video.subscribers_count} คน` : 'ไม่มีผู้ติดตาม'}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsSubscribed(!isSubscribed)}
                  className={`px-4 py-2 rounded-full text-xs font-bold transition active:scale-95 shrink-0 cursor-pointer shadow-xs ml-3 ${isSubscribed
                    ? 'bg-[#EFECE6] dark:bg-[#272727] hover:bg-[#E5E0D8] dark:hover:bg-[#333333] text-[#0F0F0F] dark:text-[#F1F1F1]'
                    : 'bg-[#0F0F0F] dark:bg-[#F1F1F1] hover:bg-[#272727] dark:hover:bg-[#E0E0E0] text-white dark:text-[#0F0F0F]'
                    }`}
                >
                  {isSubscribed ? 'ติดตามแล้ว' : 'ติดตาม'}
                </button>
              </div>

              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5 select-none -mx-3.5 px-3.5 sm:mx-0 sm:px-0">
                <div className="flex items-center bg-[#0000000a] dark:bg-white/10 hover:bg-[#00000012] dark:hover:bg-white/15 rounded-full text-xs font-semibold text-[#0F0F0F] dark:text-[#F1F1F1] shrink-0 transition">
                  <button
                    type="button"
                    onClick={handleLike}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-l-full active:scale-95 transition cursor-pointer hover:bg-black/5 dark:hover:bg-white/10"
                  >
                    <ThumbsUp className={`w-4 h-4 ${liked ? 'fill-[#FF7A00] text-[#FF7A00]' : 'text-[#0F0F0F] dark:text-[#F1F1F1]'}`} />
                    <span className={liked ? 'text-[#FF7A00] font-bold' : ''}>{likeCount}</span>
                  </button>
                  <div className="w-px h-4 bg-black/15 dark:bg-white/15" />
                  <button
                    type="button"
                    onClick={handleDislike}
                    className="px-3 py-2 rounded-r-full active:scale-95 transition cursor-pointer hover:bg-black/5 dark:hover:bg-white/10"
                  >
                    <ThumbsDown className={`w-4 h-4 ${disliked ? 'fill-[#FF7A00] text-[#FF7A00]' : 'text-[#0F0F0F] dark:text-[#F1F1F1]'}`} />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#0000000a] dark:bg-white/10 hover:bg-[#00000012] dark:hover:bg-white/15 text-[#0F0F0F] dark:text-[#F1F1F1] text-xs font-semibold transition active:scale-95 shrink-0 cursor-pointer"
                >
                  <Share2 className="w-4 h-4" />
                  <span>{copied ? 'คัดลอกแล้ว!' : 'แชร์'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsSaved(!isSaved)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#0000000a] dark:bg-white/10 hover:bg-[#00000012] dark:hover:bg-white/15 text-[#0F0F0F] dark:text-[#F1F1F1] text-xs font-semibold transition active:scale-95 shrink-0 cursor-pointer"
                >
                  <Bookmark className={`w-4 h-4 ${isSaved ? 'fill-[#FF7A00] text-[#FF7A00]' : 'text-[#0F0F0F] dark:text-[#F1F1F1]'}`} />
                  <span className={isSaved ? 'text-[#FF7A00] font-bold' : ''}>{isSaved ? 'บันทึกแล้ว' : 'บันทึก'}</span>
                </button>
              </div>
            </div>

            <DescriptionBox
              video={video}
              viewsDisplay={viewsDisplay}
              fileSizeMB={fileSizeMB}
              formatDuration={formatDuration}
              resBadge={resBadge}
              onSeek={handleSeek}
            />
          </div>
        </div>

        {/* Right / Sidebar: Related Videos Column */}
        <div className="w-full lg:w-[360px] xl:w-[450px] shrink-0 flex flex-col gap-3 px-3.5 sm:px-0 pt-2 lg:pt-0 pb-10">
          <div
            style={{
              top: playerHeight ? `${playerHeight}px` : '56.25vw',
            }}
            className="sticky z-20 -mx-3.5 px-3.5 py-2.5 bg-[#FBF9F5] dark:bg-[#0F0F0F] border-b border-[#EFECE6]/80 dark:border-white/10 sm:mx-0 sm:px-0 md:static md:py-0.5 md:border-none md:bg-transparent md:dark:bg-transparent"
          >
            <div className="flex items-center gap-1.5 overflow-x-auto overscroll-x-contain scrollbar-none py-0.5 select-none">
              {[
                { id: 'all', label: 'ทั้งหมด' },
                { id: 'cloud', label: 'จาก OneDrive' },
                { id: '4k', label: 'ความละเอียด 4K' },
                { id: 'related', label: 'ที่เกี่ยวข้อง' },
              ].map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setActiveFilter(chip.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition active:scale-95 shrink-0 cursor-pointer ${activeFilter === chip.id
                    ? 'bg-[#0F0F0F] dark:bg-[#F1F1F1] text-white dark:text-[#0F0F0F] shadow-xs'
                    : 'bg-[#0000000a] dark:bg-white/10 hover:bg-[#00000012] dark:hover:bg-white/15 text-[#0F0F0F] dark:text-[#F1F1F1]'
                    }`}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>

          {filteredRelated.length === 0 ? (
            <div className="bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 rounded-2xl p-6 text-center shadow-xs flex flex-col items-center gap-3.5 mt-1">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-[#FF7A00]/15 to-[#FF9E40]/25 flex items-center justify-center text-[#FF7A00]">
                <Film className="w-6 h-6 stroke-[1.8]" />
              </div>
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-bold text-[#0F0F0F] dark:text-[#F1F1F1]">
                  ยังไม่มีวิดีโอแนะนำอื่น
                </h3>
                <p className="text-xs text-[#606060] dark:text-[#AAAAAA] leading-relaxed max-w-[240px]">
                  อัปโหลดวิดีโอเข้าคลาวด์ OneDrive เพื่อรับชมแบบ Private ABR สตรีมมิ่ง
                </p>
              </div>
              <Link
                href="/upload"
                className="px-4 py-2 bg-[#FF7A00] hover:bg-[#E56E00] text-white text-xs font-bold rounded-xl shadow-xs transition active:scale-95 flex items-center gap-1.5"
              >
                <UploadCloud className="w-4 h-4" />
                <span>อัปโหลดวิดีโอใหม่</span>
              </Link>
            </div>
          ) : isDesktopLg === false ? (
            <div className="isolate grid grid-cols-1 sm:grid-cols-2 gap-4">
              {filteredRelated.map((item, idx) => (
                <div
                  key={`mob-${item.id}`}
                  style={idx >= 4 ? { contentVisibility: 'auto', containIntrinsicSize: '0 260px' } : undefined}
                >
                  <VideoCard video={item} replace={true} compact={false} />
                </div>
              ))}
            </div>
          ) : (
            <div className={`isolate ${isDesktopLg === null ? 'hidden lg:flex' : 'flex'} flex-col gap-2.5`}>
              {filteredRelated.map((item, idx) => (
                <div
                  key={`desk-wrap-${item.id}`}
                  style={idx >= 4 ? { contentVisibility: 'auto', containIntrinsicSize: '0 116px' } : undefined}
                >
                  <VideoCard
                    key={`desk-${item.id}`}
                    video={item}
                    replace={true}
                    half={true}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
