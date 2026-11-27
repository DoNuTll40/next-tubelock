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
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import VideoCard from '@/components/VideoCard';
import DescriptionBox from '@/components/watch/DescriptionBox';
import WatchPlaylistPanel from '@/components/playlist/WatchPlaylistPanel';
import { AnimatedTabPanel, AnimatedTabs } from '@/components/ui/AnimatedTabs';
import {
  DESKTOP_PLAYER_MAX_HEIGHT,
  useGlobalPlayer,
} from '@/context/GlobalPlayerContext';
import { useSession } from '@/context/SessionContext';
import {
  Share2,
  ThumbsUp,
  ThumbsDown,
  Film,
  Bookmark,
  UploadCloud,
  AlertCircle,
  ArrowLeft,
  Lock,
  Link2,
} from 'lucide-react';
import { formatResolutionBadge } from '@/lib/videoUtils';

const SaveToPlaylistModal = dynamic(() => import('@/components/playlist/SaveToPlaylistModal'), { ssr: false });

const RELATED_FILTERS = [
  { id: 'all', label: 'ทั้งหมด' },
  { id: 'cloud', label: 'จาก OneDrive' },
  { id: '4k', label: 'ความละเอียด 4K' },
  { id: 'related', label: 'ที่เกี่ยวข้อง' },
];

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
  const pathname = usePathname();
  const session = useSession();
  const searchParams = useSearchParams();
  const urlT = searchParams?.get('t');
  const urlV = searchParams?.get('v')?.trim() || null;
  const urlList = searchParams?.get('list');
  const urlListIndex = searchParams?.get('index');
  const urlShuffle = searchParams?.get('shuffle');

  const {
    video: globalVideo,
    error,
    videoRatio: globalVideoRatio,
    relatedVideos: globalRelated,
    isDockedInWatch,
    isMiniplayer,
    handleSeek,
    dockPlayerSlot,
    undockPlayerSlot,
    hydrateWatchPage,
    playlistState,
    playlistNextVideo,
    loadPlaylist,
    clearPlaylist,
    restorePlaylistWatchLocation,
    selectPlaylistVideo,
    togglePlaylistShuffle,
    cyclePlaylistLoop,
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

  const videoId = video?.id;
  const [isSubscribed, setIsSubscribed] = useState(Boolean(initialVideo?.is_subscribed));
  const [subscriberCount, setSubscriberCount] = useState(Number(initialVideo?.subscribers_count || 0));
  const [isTogglingSub, setIsTogglingSub] = useState(false);
  const [activeFilter, setActiveFilter] = useState('all');
  const [avatarError, setAvatarError] = useState(false);
  const [prevVideoId, setPrevVideoId] = useState(initialVideo?.id ?? null);

  if ((video?.id ?? null) !== prevVideoId) {
    setPrevVideoId(video?.id ?? null);
    setAvatarError(false);
    setIsSubscribed(Boolean(video?.is_subscribed));
    setSubscriberCount(Number(video?.subscribers_count || 0));
  }

  const isChannelOwner =
    session?.id != null &&
    video?.user_id != null &&
    Number(session.id) === Number(video.user_id);

  const channelHref = video?.author_handle
    ? `/@${encodeURIComponent(video.author_handle)}`
    : null;

  const handleToggleSubscribe = async () => {
    if (!session?.id) {
      const { pathname: p, search: s } = window.location;
      router.push(`/login?from=${encodeURIComponent(p + s)}`);
      return;
    }
    const target = video?.author_handle || (video?.user_id != null ? String(video.user_id) : '');
    if (!target || isChannelOwner || isTogglingSub) return;

    const prevSub = isSubscribed;
    const prevCount = subscriberCount;
    setIsSubscribed(!prevSub);
    setSubscriberCount(Math.max(0, prevCount + (prevSub ? -1 : 1)));
    setIsTogglingSub(true);
    try {
      const res = await fetch(`/api/channels/${encodeURIComponent(target)}/subscribe`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        setIsSubscribed(prevSub);
        setSubscriberCount(prevCount);
      } else {
        setIsSubscribed(Boolean(data.subscribed));
        setSubscriberCount(Number(data.subscriberCount ?? prevCount));
      }
    } catch {
      setIsSubscribed(prevSub);
      setSubscriberCount(prevCount);
    } finally {
      setIsTogglingSub(false);
    }
  };

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
      if (!restorePlaylistWatchLocation()) router.refresh();
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [restorePlaylistWatchLocation, router]);

  useEffect(() => {
    void loadPlaylist();
  }, [loadPlaylist, pathname, urlList, urlListIndex, urlShuffle]);

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
    <div className="w-full max-w-[2560px] mx-auto overflow-x-clip px-0 sm:px-4 lg:px-5 pt-0 sm:pt-2 sm:pb-6 lg:pt-3">
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
            className={`sticky top-0 z-30 w-full ${(!isDockedInWatch || isMiniplayer) ? 'bg-black' : 'bg-transparent'} md:bg-transparent md:relative md:z-0 has-[[data-player-fullscreen="true"]]:!z-[100] ${videoRatio < 0.98 ? 'h-[min(48vh,380px)] md:h-auto flex justify-center items-center md:block' : ''
              }`}
            style={
              !isDockedInWatch || isMiniplayer
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
            <div className="flex flex-col gap-1.5">
              <h1 className="text-[17px] sm:text-xl font-bold text-[#0F0F0F] dark:text-[#F1F1F1] leading-snug tracking-tight">
                {video?.title || ''}
              </h1>
              {video?.visibility && video.visibility !== 'public' && (
                <div className="flex items-center">
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                      video.visibility === 'private'
                        ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/25'
                        : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25'
                    }`}
                  >
                    {video.visibility === 'private' ? (
                      <>
                        <Lock className="w-3 h-3" />
                        <span>ส่วนตัว</span>
                      </>
                    ) : (
                      <>
                        <Link2 className="w-3 h-3" />
                        <span>ไม่แสดงในรายการ</span>
                      </>
                    )}
                  </span>
                </div>
              )}
            </div>

            {/* 2. YouTube-Style Channel (Left) + Action Buttons (Right) */}
            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-3 py-1">
              <div className="flex justify-between items-center min-w-0">
                <div className="flex gap-3 items-center min-w-0">
                  {channelHref ? (
                    <Link href={channelHref} className="shrink-0">
                      {video?.author_picture && !avatarError ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={video.author_picture}
                          alt={video?.author_name || 'Channel'}
                          onError={() => setAvatarError(true)}
                          className="w-10 h-10 rounded-full object-cover shadow-xs ring-1 ring-black/10 dark:ring-white/10"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-[#FF7A00] to-[#FF9E40] flex items-center justify-center text-white font-bold shadow-xs text-sm">
                          {(video?.author_name || 'D').charAt(0).toUpperCase()}
                        </div>
                      )}
                    </Link>
                  ) : video?.author_picture && !avatarError ? (
                    // eslint-disable-next-line @next/next/no-img-element
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
                    {channelHref ? (
                      <Link
                        href={channelHref}
                        className="font-bold text-[14px] sm:text-[15px] text-[#0F0F0F] dark:text-[#F1F1F1] hover:text-[#FF7A00] transition truncate leading-tight"
                      >
                        {video?.author_name || 'DONUŤ'}
                      </Link>
                    ) : (
                      <span className="font-bold text-[14px] sm:text-[15px] text-[#0F0F0F] dark:text-[#F1F1F1] truncate leading-tight">
                        {video?.author_name || 'DONUŤ'}
                      </span>
                    )}
                    <span className="text-[12px] text-[#606060] dark:text-[#AAAAAA] truncate mt-0.5">
                      {subscriberCount > 0 ? `ผู้ติดตาม ${subscriberCount.toLocaleString('th-TH')} คน` : 'ไม่มีผู้ติดตาม'}
                    </span>
                  </div>
                </div>
                {isChannelOwner ? (
                  <Link
                    href={`/videos/${video.id}/edit`}
                    className="px-4 py-2 rounded-full text-xs font-bold transition active:scale-95 shrink-0 shadow-xs ml-3 bg-[#EFECE6] dark:bg-[#272727] hover:bg-[#E5E0D8] dark:hover:bg-[#333333] text-[#0F0F0F] dark:text-[#F1F1F1]"
                  >
                    แก้ไขวิดีโอ
                  </Link>
                ) : (
                  <button
                    type="button"
                    disabled={isTogglingSub}
                    onClick={handleToggleSubscribe}
                    className={`px-4 py-2 rounded-full text-xs font-bold transition active:scale-95 shrink-0 cursor-pointer shadow-xs ml-3 disabled:opacity-60 ${isSubscribed
                      ? 'bg-[#EFECE6] dark:bg-[#272727] hover:bg-[#E5E0D8] dark:hover:bg-[#333333] text-[#0F0F0F] dark:text-[#F1F1F1]'
                      : 'bg-[#0F0F0F] dark:bg-[#F1F1F1] hover:bg-[#272727] dark:hover:bg-[#E0E0E0] text-white dark:text-[#0F0F0F]'
                      }`}
                  >
                    {isSubscribed ? 'ติดตามแล้ว' : 'ติดตาม'}
                  </button>
                )}
              </div>

              {videoId && <WatchActions key={`${videoId}:${session?.id ?? ''}`} videoId={videoId} userId={session?.id} />}
            </div>

            <DescriptionBox
              video={video}
              viewsDisplay={viewsDisplay}
              fileSizeMB={fileSizeMB}
              formatDuration={formatDuration}
              resBadge={resBadge}
              onSeek={handleSeek}
              initialShowAdultPosters={initialShowAdultPosters}
            />
          </div>
        </div>

        {/* Right / Sidebar: Related Videos Column */}
        <div className={`w-full lg:w-[360px] xl:w-[450px] shrink-0 flex flex-col gap-3 px-3.5 sm:px-0 pt-2 lg:pt-0 ${playlistState ? 'pb-24 lg:pb-10' : 'pb-10'}`}>
          {playlistState && (
            <WatchPlaylistPanel
              key={playlistState.listKey}
              state={playlistState}
              nextVideo={playlistNextVideo}
              playerHeight={playerHeight}
              onSelect={selectPlaylistVideo}
              onToggleShuffle={togglePlaylistShuffle}
              onCycleLoop={cyclePlaylistLoop}
              onClose={clearPlaylist}
            />
          )}
          <div
            style={{
              top: playerHeight ? `${playerHeight}px` : '56.25vw',
            }}
            className="sticky z-20 -mx-3.5 px-3.5 py-2.5 bg-[#FBF9F5] dark:bg-[#0F0F0F] border-b border-[#EFECE6]/80 dark:border-white/10 sm:mx-0 sm:px-0 md:static md:py-0.5 md:border-none md:bg-transparent md:dark:bg-transparent"
          >
            <AnimatedTabs
              tabs={RELATED_FILTERS}
              value={activeFilter}
              onChange={setActiveFilter}
              label="กรองวิดีโอแนะนำ"
              variant="pill"
              behavior="filter"
              className="py-0.5"
            />
          </div>

          <AnimatedTabPanel value={activeFilter} behavior="filter">
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
                {filteredRelated.map((item) => (
                  <VideoCard key={`mob-${item.id}`} video={item} replace={true} compact={false} />
                ))}
              </div>
            ) : (
              <div className={`isolate ${isDesktopLg === null ? 'hidden lg:flex' : 'flex'} flex-col gap-2.5`}>
                {filteredRelated.map((item) => (
                  <VideoCard
                    key={`desk-${item.id}`}
                    video={item}
                    replace={true}
                    half={true}
                  />
                ))}
              </div>
            )}
          </AnimatedTabPanel>
        </div>
      </div>
    </div>
  );
}

function WatchActions({ videoId, userId }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [reaction, setReaction] = useState(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [isSaved, setIsSaved] = useState(false);
  const [isSaveOpen, setIsSaveOpen] = useState(false);
  const membershipChanged = useRef(false);
  const liked = reaction?.liked ?? false;
  const disliked = reaction?.disliked ?? false;

  useEffect(() => {
    const controller = new AbortController();
    const loadMembership = async () => {
      if (controller.signal.aborted) return;
      try {
        const response = await fetch(`/api/videos/${videoId}/playlists`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error();
        if (controller.signal.aborted) return;
        setReaction({ liked: data.liked, disliked: false, count: data.likeCount });
        if (!membershipChanged.current) setIsSaved(data.saved);
      } catch {
        if (!controller.signal.aborted) setError('โหลดสถานะวิดีโอไม่สำเร็จ');
      }
    };
    queueMicrotask(loadMembership);
    return () => controller.abort();
  }, [videoId, loadAttempt]);

  const openLogin = () => {
    const { pathname, search } = window.location;
    router.push(`/login?from=${encodeURIComponent(pathname + search)}`);
  };

  const handleReaction = async (isDislike) => {
    if (!userId) {
      openLogin();
      return;
    }
    if (isUpdating || !reaction) return;

    const nextLiked = !isDislike && !liked;
    const nextDisliked = isDislike && !disliked;
    setError('');
    setReaction({
      liked: nextLiked,
      disliked: nextDisliked,
      count: Math.max(0, reaction.count + Number(nextLiked) - Number(liked)),
    });
    if (nextLiked === liked) return;

    setIsUpdating(true);
    try {
      const url = '/api/playlists/LL/items';
      const response = await (nextLiked
        ? fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ videoId }),
          })
        : fetch(`${url}?videoId=${videoId}`, { method: 'DELETE' }));

      if (response.status === 401) {
        setReaction(reaction);
        openLogin();
        return;
      }
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error();
    } catch {
      setReaction(reaction);
      setError('อัปเดตสถานะถูกใจไม่สำเร็จ');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = () => {
    if (userId) setIsSaveOpen(true);
    else openLogin();
  };

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5 select-none -mx-3.5 px-3.5 sm:mx-0 sm:px-0">
        <div className="flex items-center bg-[#0000000a] dark:bg-white/10 hover:bg-[#00000012] dark:hover:bg-white/15 rounded-full text-xs font-semibold text-[#0F0F0F] dark:text-[#F1F1F1] shrink-0 transition">
          <button
            type="button"
            aria-label={reaction ? `ถูกใจ ${reaction.count} ครั้ง` : 'ถูกใจ'}
            aria-pressed={liked}
            disabled={isUpdating || Boolean(userId && !reaction)}
            onClick={() => void handleReaction(false)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-l-full active:scale-95 transition cursor-pointer hover:bg-black/5 dark:hover:bg-white/10 disabled:cursor-default"
          >
            <ThumbsUp className={`w-4 h-4 ${liked ? 'fill-[#FF7A00] text-[#FF7A00]' : 'text-[#0F0F0F] dark:text-[#F1F1F1]'}`} />
            <span className={liked ? 'text-[#FF7A00] font-bold' : ''}>{reaction?.count ?? 'ถูกใจ'}</span>
          </button>
          <div className="w-px h-4 bg-black/15 dark:bg-white/15" />
          <button
            type="button"
            aria-label="ไม่ชอบ"
            aria-pressed={disliked}
            disabled={isUpdating || Boolean(userId && !reaction)}
            onClick={() => void handleReaction(true)}
            className="px-3 py-2 rounded-r-full active:scale-95 transition cursor-pointer hover:bg-black/5 dark:hover:bg-white/10 disabled:cursor-default"
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
          aria-haspopup={userId ? 'dialog' : undefined}
          onClick={handleSave}
          className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#0000000a] dark:bg-white/10 hover:bg-[#00000012] dark:hover:bg-white/15 text-[#0F0F0F] dark:text-[#F1F1F1] text-xs font-semibold transition active:scale-95 shrink-0 cursor-pointer"
        >
          <Bookmark className={`w-4 h-4 ${isSaved ? 'fill-[#FF7A00] text-[#FF7A00]' : 'text-[#0F0F0F] dark:text-[#F1F1F1]'}`} />
          <span className={isSaved ? 'text-[#FF7A00] font-bold' : ''}>{isSaved ? 'บันทึกแล้ว' : 'บันทึก'}</span>
        </button>
      </div>

      {error && (
        <div className="mt-1.5 flex items-center gap-2 text-xs text-rose-700 dark:text-rose-400">
          <p role="alert">{error}</p>
          {!reaction && (
            <button
              type="button"
              className="font-semibold underline cursor-pointer"
              onClick={() => {
                setError('');
                setLoadAttempt((attempt) => attempt + 1);
              }}
            >
              ลองอีกครั้ง
            </button>
          )}
        </div>
      )}

      {isSaveOpen && (
        <SaveToPlaylistModal
          videoId={Number(videoId)}
          onClose={() => setIsSaveOpen(false)}
          onMembershipChange={({ saved }) => {
            membershipChanged.current = true;
            setIsSaved(saved);
          }}
        />
      )}
    </div>
  );
}
