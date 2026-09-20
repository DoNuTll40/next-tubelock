'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import VideoPlayer from '@/components/VideoPlayer';
import VideoCard from '@/components/VideoCard';
import DescriptionBox from '@/components/watch/DescriptionBox';
import {
  Share2, Layers, ThumbsUp, ThumbsDown,
  Sparkles, Bookmark, UploadCloud,
  AlertCircle, ArrowLeft
} from 'lucide-react';
import { resolveClientPlaybackSource } from '@/lib/playbackResolver';
import { formatResolutionBadge } from '@/lib/videoUtils';

// ============================================================================
// 🎛️ [Video Player Desktop Height Settings]
// ปรับความสูงของเครื่องเล่นวิดีโอบน Desktop (PC) ได้ที่นี่จุดเดียวจบ:
// - ยิ่งค่าน้อยลง -> วิดีโอจะยิ่งสูงและใหญ่ขึ้น (เช่น 80 = เต็มตาชิดขอบ, 100 = ขนาดใหญ่, 128 = มาตรฐานปัจจุบัน)
// ============================================================================
const DESKTOP_HEADER_OFFSET_PX = 105;
const DESKTOP_PLAYER_MAX_HEIGHT = `calc(100vh - ${DESKTOP_HEADER_OFFSET_PX}px)`;

export default function WatchPage() {
  const params = useParams();
  const id = params?.id;
  const router = useRouter();

  const [video, setVideo] = useState(null);
  const [relatedVideos, setRelatedVideos] = useState([]);
  const [playerConfig, setPlayerConfig] = useState(() => {
    if (typeof window === 'undefined') return null;
    try {
      const saved = localStorage.getItem('tubelock_settings');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [streamUrl, setStreamUrl] = useState('');
  const [storyboard, setStoryboard] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [liked, setLiked] = useState(false);
  const [disliked, setDisliked] = useState(false);
  const [likeCount, setLikeCount] = useState(652);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [activeFilter, setActiveFilter] = useState('all');
  const [detectedRatio, setDetectedRatio] = useState(null);

  const videoRef = useRef(null);
  const playerWrapperRef = useRef(null);
  const [playerHeight, setPlayerHeight] = useState(0);
  const activeBlobUrlsRef = useRef([]);

  // Compute effective video aspect ratio: detected from stream player first, then metadata, fallback to 16/9
  const videoResolution = video?.resolution;
  const videoWidth = video?.width;
  const videoHeight = video?.height;

  const videoRatio = useMemo(() => {
    if (detectedRatio && detectedRatio > 0) return detectedRatio;
    if (typeof videoResolution === 'string' && videoResolution.includes('x')) {
      const parts = videoResolution.split('x');
      const w = parseFloat(parts[0]);
      const h = parseFloat(parts[1]);
      if (w > 0 && h > 0) return w / h;
    } else if (videoWidth && videoHeight) {
      return videoWidth / videoHeight;
    }
    if (video?.category === 'shorts') return 9 / 16;
    return 16 / 9;
  }, [detectedRatio, videoResolution, videoWidth, videoHeight, video?.category]);

  // Measure player height for mobile sticky chips (O(1) updates only on resize)
  useEffect(() => {
    const el = playerWrapperRef.current;
    if (!el) return;

    const updateHeight = () => {
      if (el) {
        const h = el.getBoundingClientRect().height;
        if (h > 0) {
          setPlayerHeight(h);
          document.documentElement.style.setProperty('--watch-player-height', `${h}px`);
        }
      }
    };

    updateHeight();

    const ro = new ResizeObserver(updateHeight);
    ro.observe(el);

    return () => {
      ro.disconnect();
    };
  }, [streamUrl, videoRatio]);

  // Memoized filter for related videos (O(N) single pass, prevents re-filtering on renders)
  const filteredRelated = useMemo(() => {
    if (!relatedVideos || relatedVideos.length === 0) return [];
    if (activeFilter === '4k') {
      return relatedVideos.filter((v) => v.resolution?.includes('2160') || v.resolution?.includes('4K'));
    }
    if (activeFilter === 'cloud') {
      return relatedVideos.filter((v) => v.source_type === 'hls' || v.source_type === 'onedrive');
    }
    return relatedVideos;
  }, [relatedVideos, activeFilter]);


  // Fetch video data & stream source
  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    async function initWatch() {
      try {
        setError(null);
        setStreamUrl('');

        // Revoke previous blob URLs
        for (const u of activeBlobUrlsRef.current) {
          try { URL.revokeObjectURL(u); } catch (_) { }
        }
        activeBlobUrlsRef.current = [];

        // ⚡ Fast Step 1: Fetch Video Metadata (<40ms) so Title, Thumbnail & Details appear instantly!
        fetch(`/api/videos/${id}`)
          .then((res) => res.ok && res.json())
          .then((data) => {
            if (!cancelled && data?.video) {
              setVideo(data.video);
            }
          })
          .catch(() => { });

        // ⚡ Fast Step 2: Fetch Related Videos in parallel
        fetch('/api/videos')
          .then((res) => res.ok && res.json())
          .then((listJson) => {
            if (!cancelled && listJson?.data) {
              setRelatedVideos(listJson.data.filter((v) => String(v.id) !== String(id)));
            }
          })
          .catch(() => { });

        // ⚡ Step 3: Fetch Stream Source from OneDrive (Edge CDN cached on server)
        const sourceRes = await fetch(`/api/videos/${id}/source`, { cache: 'no-store' });
        if (!sourceRes.ok) {
          const errData = await sourceRes.json().catch(() => ({}));
          throw new Error(errData.error || `ไม่สามารถโหลดวิดีโอได้ (รหัส ${sourceRes.status})`);
        }

        const sourceData = await sourceRes.json();

        document.title = `(${sourceData?.video?.id}) ${sourceData?.video?.title} - TubeLock`;

        if (cancelled) return;

        if (sourceData.video) {
          setVideo(sourceData.video);
        }

        // ⚡ Step 4: Resolve Playback URL & Storyboard (With Auto-Recovery for Expired Tokens)
        let resolved;
        try {
          resolved = await resolveClientPlaybackSource(sourceData);
        } catch (resolveErr) {
          console.warn('[WatchPage] Token expired or fetch failed, auto-recovering with fresh tokens...', resolveErr);
          const freshRes = await fetch(`/api/videos/${id}/source?fresh=1`, { cache: 'no-store' });
          if (!freshRes.ok) throw resolveErr;
          const freshSourceData = await freshRes.json();
          resolved = await resolveClientPlaybackSource(freshSourceData);
        }

        if (cancelled) return;

        if (resolved.blobUrls && resolved.blobUrls.length > 0) {
          activeBlobUrlsRef.current = resolved.blobUrls;
        }

        setStreamUrl(resolved.url);
        if (resolved.aspectRatio) {
          setDetectedRatio(resolved.aspectRatio);
        }
        if (resolved.storyboard) {
          setStoryboard(resolved.storyboard);
        } else if (resolved.storyboardPromise) {
          resolved.storyboardPromise.then((sb) => {
            if (!cancelled && sb) {
              setStoryboard(sb);
            }
          }).catch(() => { });
        } else {
          setStoryboard(null);
        }
      } catch (err) {
        console.error('[WatchPage Error]:', err);
        if (!cancelled) {
          setError(err.message || 'เกิดข้อผิดพลาดในการโหลดวิดีโอ');
        }
      }
    }

    initWatch();

    return () => {
      cancelled = true;
      for (const u of activeBlobUrlsRef.current) {
        try { URL.revokeObjectURL(u); } catch (_) { }
      }
      activeBlobUrlsRef.current = [];
    };
  }, [id]);

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
      setLikeCount((c) => Math.max(0, c - 1));
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
        setLikeCount((c) => Math.max(0, c - 1));
      }
    }
  };

  const formatDuration = (sec) => {
    if (!sec) return '00:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleSeek = (seconds) => {
    if (videoRef.current) {
      videoRef.current.currentTime = seconds;
      videoRef.current.play().catch(() => { });
    }
    // Smooth scroll to video on mobile if needed
    if (typeof window !== 'undefined' && window.innerWidth < 1024 && playerWrapperRef.current) {
      playerWrapperRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

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

  const fileSizeMB = video ? (Number(video.file_size_bytes || 0) / (1024 * 1024)).toFixed(1) : '0';
  const resBadge = video ? formatResolutionBadge(video.resolution) : '';
  const viewsDisplay = video?.views_count ? `${video.views_count.toLocaleString()} ครั้ง` : '270K views';

  return (
    <div className="w-full max-w-[1720px] mx-auto px-0 sm:px-4 md:px-6 lg:px-3 pt-0 lg:pt-3 pb-16 sm:py-5">
      <div className="block lg:flex lg:flex-row lg:items-start lg:justify-center lg:gap-3 w-full">
        {/* Left Column: Player + Details (YouTube Standard Full-Width Layout) */}
        {/* On mobile (< lg): 'contents' unwraps the column so sticky player & chips track full-page scrolling */}
        {/* On desktop (lg+): standard flex column alongside the related videos sidebar */}
        <div
          className="contents lg:flex lg:flex-col lg:min-w-0 shrink"
          style={{
            width: (videoRatio && videoRatio >= 0.98)
              ? `min(100%, calc((${DESKTOP_PLAYER_MAX_HEIGHT}) * ${videoRatio}))`
              : (videoRatio && videoRatio < 0.98)
                ? `min(100%, calc((${DESKTOP_PLAYER_MAX_HEIGHT}) * (16 / 9)))`
                : '100%',
            maxWidth: (videoRatio && videoRatio >= 0.98)
              ? `min(100%, calc((${DESKTOP_PLAYER_MAX_HEIGHT}) * ${videoRatio}))`
              : (videoRatio && videoRatio < 0.98)
                ? `min(100%, calc((${DESKTOP_PLAYER_MAX_HEIGHT}) * (16 / 9)))`
                : '100%',
          }}
        >
          {/* 🎯 Video Player: Sticky on mobile across entire page / Static in Left Col on desktop */}
          <div
            ref={playerWrapperRef}
            className={`sticky top-0 z-30 w-full bg-black lg:bg-transparent lg:static lg:z-auto ${videoRatio < 0.98 ? 'h-[min(48vh,380px)] lg:h-auto flex justify-center items-center lg:block' : ''
              }`}
          >
            {streamUrl ? (
              <VideoPlayer
                src={streamUrl}
                poster={video?.thumbnail_url || (video?.id ? `/streams/stream_vid_${video.id}/poster.jpg` : null)}
                storyboard={storyboard}
                title={video?.title}
                onBack={() => router.push('/')}
                resolution={video?.resolution}
                width={video?.width}
                height={video?.height}
                aspectRatio={videoRatio}
                fps={video?.fps}
                codec={video?.codec}
                videoId={video?.id}
                videoRef={videoRef}
                desktopMaxHeight={DESKTOP_PLAYER_MAX_HEIGHT}
                defaultVolume={playerConfig?.volume ?? 0.8}
                defaultAutoplay={playerConfig?.autoplay ?? true}
                defaultSpeed={playerConfig?.default_speed ?? 1}
                defaultFit={playerConfig?.default_fit ?? 'fit'}
                seekStep={playerConfig?.seek_step ?? 10}
                autoStats={playerConfig?.auto_stats ?? false}
                onRatioChange={(r) => setDetectedRatio(r)}
              />
            ) : (
              /* Instant Player Shell: Thumbnail + Center Glowing Spinner */
              <div
                className={`relative bg-zinc-950 sm:rounded-2xl overflow-hidden flex items-center justify-center select-none ${videoRatio < 0.98
                  ? 'w-full h-[min(48vh,380px)] lg:h-auto lg:aspect-video'
                  : 'w-full h-auto'
                  }`}
                style={{
                  aspectRatio: videoRatio < 0.98 ? undefined : `${videoRatio}`,
                  maxWidth: videoRatio >= 0.98 ? `calc((${DESKTOP_PLAYER_MAX_HEIGHT}) * ${videoRatio})` : undefined,
                  maxHeight: DESKTOP_PLAYER_MAX_HEIGHT,
                  margin: videoRatio >= 0.98 ? 0 : '0 auto',
                }}
              >
                {/* Background Poster / Thumbnail */}
                {video?.thumbnail_url && (
                  <img
                    src={video.thumbnail_url}
                    alt={video?.title || 'Thumbnail'}
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    className="absolute inset-0 w-full h-full object-cover opacity-60 filter blur-[1px] scale-105 transition-opacity duration-500"
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/65 backdrop-blur-[0.5px]" />

                {/* Center Glowing Spinner */}
                <div className="relative z-10 flex flex-col items-center gap-3.5 px-4 text-center">
                  <div className="relative flex items-center justify-center">
                    <div className="absolute w-14 h-14 rounded-full bg-[#FF7A00]/25 blur-lg animate-pulse" />
                    <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-full border-[3px] border-white/15 border-t-[#FF7A00] animate-spin" />
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-white text-xs sm:text-sm font-semibold tracking-wide drop-shadow-md">
                      กำลังเตรียมสัญญาณภาพ...
                    </span>
                    <span className="text-zinc-400 text-[10px] sm:text-[11px] font-mono">
                      เชื่อมต่อคลาวด์สตรีมมิ่ง TubeLock
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 📱 YouTube-Style Video Details Section */}
          <div className="w-full flex flex-col gap-3 p-3.5 sm:px-0 sm:pt-3.5 bg-[#FBF9F5] dark:bg-[#0F0F0F] transition-colors">
            {/* 1. Title */}
            {video ? (
              <h1 className="text-[17px] sm:text-xl font-bold text-[#0F0F0F] dark:text-[#F1F1F1] leading-snug tracking-tight">
                {video.title}
              </h1>
            ) : (
              <div className="h-7 bg-[#EFECE6] dark:bg-white/10 rounded-lg w-3/4 animate-pulse my-0.5" />
            )}

            {/* 2. YouTube-Style Channel (Left) + Action Buttons (Right) in Single Line on Desktop */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 py-1">
              {/* Channel Info & Subscribe Button */}
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-[#FF7A00] to-[#FF9E40] flex items-center justify-center text-white shadow-xs shrink-0">
                  <Layers className="w-5 h-5 text-white" />
                </div>
                <div className="flex flex-col min-w-0 pr-1 sm:pr-2">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-[14px] sm:text-[15px] text-[#0F0F0F] dark:text-[#F1F1F1] truncate leading-tight">
                      OneDrive Cloud Storage
                    </span>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" title="เชื่อมต่อแล้ว" />
                  </div>
                  <span className="text-[11.5px] text-[#606060] dark:text-[#AAAAAA] truncate">
                    TubeLock Private Streaming • 62.4K
                  </span>
                </div>

                {/* YouTube Subscribe Capsule Button */}
                <button
                  type="button"
                  onClick={() => setIsSubscribed(!isSubscribed)}
                  className={`px-4 py-2 rounded-full text-xs font-bold transition active:scale-95 shrink-0 cursor-pointer shadow-xs ${isSubscribed
                    ? 'bg-[#EFECE6] dark:bg-[#272727] hover:bg-[#E5E0D8] dark:hover:bg-[#333333] text-[#0F0F0F] dark:text-[#F1F1F1]'
                    : 'bg-[#0F0F0F] dark:bg-[#F1F1F1] hover:bg-[#272727] dark:hover:bg-[#E0E0E0] text-white dark:text-[#0F0F0F]'
                    }`}
                >
                  {isSubscribed ? 'ติดตามแล้ว' : 'ติดตาม'}
                </button>
              </div>

              {/* Action Buttons: Like/Dislike, Share, Save */}
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5 select-none -mx-3.5 px-3.5 sm:mx-0 sm:px-0">
                {/* Like / Dislike Split Pill */}
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

                {/* Share Pill */}
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#0000000a] dark:bg-white/10 hover:bg-[#00000012] dark:hover:bg-white/15 text-[#0F0F0F] dark:text-[#F1F1F1] text-xs font-semibold transition active:scale-95 shrink-0 cursor-pointer"
                >
                  <Share2 className="w-4 h-4" />
                  <span>{copied ? 'คัดลอกแล้ว!' : 'แชร์'}</span>
                </button>

                {/* Save / Bookmark Pill */}
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

            {/* 3. YouTube-Style Description Box (Interactive Timestamps, URLs, Expandable Body) */}
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

        {/* Right / Sidebar: Related Videos Column (YouTube Desktop Standard ~400px) */}
        <div className="w-full lg:w-[360px] xl:w-[450px] shrink-0 flex flex-col gap-3 px-3.5 sm:px-0 pb-16">
          {/* 🏷️ YouTube Recommendation Filter Chips: Sticky directly under video player on mobile! */}
          <div
            style={{
              top: playerHeight ? `${playerHeight}px` : 'var(--watch-player-height, 56.25vw)',
            }}
            className="sticky z-20 bg-[#FBF9F5] dark:bg-[#0F0F0F] -mx-3.5 px-3.5 py-2.5 border-b border-[#EFECE6]/80 dark:border-white/10 lg:static lg:mx-0 lg:px-0 lg:py-0.5 lg:border-none lg:bg-transparent"
          >
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 select-none">
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
            /* Premium YouTube-Style Empty Recommendations Card */
            <div className="bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 rounded-2xl p-6 text-center shadow-xs flex flex-col items-center gap-3.5 mt-1">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-[#FF7A00]/15 to-[#FF9E40]/25 flex items-center justify-center text-[#FF7A00]">
                <Sparkles className="w-6 h-6" />
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
          ) : (
            <>
              {/* Mobile: Full-width feed cards (YouTube mobile app experience) */}
              <div className="flex flex-col gap-4 sm:hidden">
                {filteredRelated.map((item) => (
                  <VideoCard key={`mob-${item.id}`} video={item} replace={true} compact={false} />
                ))}
              </div>

              {/* Desktop / Tablet: Compact sidebar cards (YouTube standard) */}
              <div className="hidden sm:flex flex-col gap-2.5">
                {filteredRelated.map((item) => (
                  <div key={`desk-wrap-${item.id}`}>
                    <VideoCard
                      key={`desk-${item.id}`}
                      video={item}
                      replace={true}
                      half={true}
                    // compact={true}
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
