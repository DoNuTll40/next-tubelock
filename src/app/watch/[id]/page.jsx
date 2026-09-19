'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import VideoPlayer from '@/components/VideoPlayer';
import VideoCard from '@/components/VideoCard';
import { 
  ArrowLeft, Clock, HardDrive, Cpu, 
  AlertCircle, Share2, PlaySquare, ChevronDown, ChevronUp,
  Layers, Loader2, ThumbsUp, ThumbsDown, Download,
  SlidersHorizontal, Sparkles, Check, Bookmark, MoreVertical
} from 'lucide-react';
import { resolveClientPlaybackSource } from '@/lib/playbackResolver';
import { formatResolutionBadge } from '@/lib/videoUtils';

export default function WatchPage() {
  const params = useParams();
  const id = params?.id;
  const router = useRouter();

  const [video, setVideo] = useState(null);
  const [relatedVideos, setRelatedVideos] = useState([]);
  const [playerConfig, setPlayerConfig] = useState(null);
  const [streamUrl, setStreamUrl] = useState('');
  const [storyboard, setStoryboard] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [isDescOpen, setIsDescOpen] = useState(false);
  const [liked, setLiked] = useState(false);
  const [disliked, setDisliked] = useState(false);
  const [likeCount, setLikeCount] = useState(652);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [activeFilter, setActiveFilter] = useState('all');

  const videoRef = useRef(null);
  const activeBlobUrlsRef = useRef([]);

  // Load saved player settings from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('tubelock_settings');
      if (saved) {
        setPlayerConfig(JSON.parse(saved));
      }
    } catch (e) {
      console.warn('Failed to parse tubelock_settings:', e);
    }
  }, []);

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
          try { URL.revokeObjectURL(u); } catch (_) {}
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
          .catch(() => {});

        // ⚡ Fast Step 2: Fetch Related Videos in parallel
        fetch('/api/videos')
          .then((res) => res.ok && res.json())
          .then((listJson) => {
            if (!cancelled && listJson?.data) {
              setRelatedVideos(listJson.data.filter((v) => String(v.id) !== String(id)));
            }
          })
          .catch(() => {});

        // ⚡ Step 3: Fetch Stream Source from OneDrive (Edge CDN cached on server)
        const sourceRes = await fetch(`/api/videos/${id}/source`, { cache: 'no-store' });
        if (!sourceRes.ok) {
          const errData = await sourceRes.json().catch(() => ({}));
          throw new Error(errData.error || `ไม่สามารถโหลดวิดีโอได้ (รหัส ${sourceRes.status})`);
        }

        const sourceData = await sourceRes.json();
        if (cancelled) return;

        if (sourceData.video) {
          setVideo(sourceData.video);
        }

        // ⚡ Step 4: Resolve Playback URL & Storyboard
        const resolved = await resolveClientPlaybackSource(sourceData);
        if (cancelled) return;

        if (resolved.blobUrls && resolved.blobUrls.length > 0) {
          activeBlobUrlsRef.current = resolved.blobUrls;
        }

        setStreamUrl(resolved.url);
        if (resolved.storyboard) {
          setStoryboard(resolved.storyboard);
        } else if (resolved.storyboardPromise) {
          resolved.storyboardPromise.then((sb) => {
            if (!cancelled && sb) {
              setStoryboard(sb);
            }
          }).catch(() => {});
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
        try { URL.revokeObjectURL(u); } catch (_) {}
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

  if (error && !video) {
    return (
      <div className="max-w-md mx-auto p-8 text-center flex flex-col items-center gap-4 mt-16 bg-white border border-[#EFECE6] rounded-3xl shadow-sm">
        <div className="w-14 h-14 rounded-full bg-rose-50 flex items-center justify-center text-rose-500">
          <AlertCircle className="w-7 h-7 stroke-[1.8]" />
        </div>
        <div>
          <h2 className="text-base font-bold text-[#212529]">เกิดข้อผิดพลาดในการโหลด</h2>
          <p className="text-xs text-[#8C857B] mt-1.5 leading-relaxed">{error || 'ไม่พบข้อมูลวิดีโอ'}</p>
        </div>
        <button
          type="button"
          onClick={() => router.push('/')}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#F5F2EB] hover:bg-[#EFECE6] text-[#212529] rounded-xl text-xs font-semibold transition active:scale-95 cursor-pointer mt-2"
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
    <div className="w-full max-w-[1720px] mx-auto px-0 sm:px-4 md:px-6 lg:px-8 pt-0 sm:pt-4 pb-16 sm:py-6">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-0 sm:gap-6 items-start">
        {/* 🎯 Video Player: Sticky on mobile across entire page / Static in Left Col on desktop */}
        <div className="sticky top-0 z-30 w-full bg-black sm:static sm:z-auto sm:rounded-2xl sm:overflow-hidden sm:border sm:border-black/10 sm:shadow-lg lg:col-start-1 lg:row-start-1">
          {streamUrl ? (
            <VideoPlayer
              src={streamUrl}
              poster={video?.thumbnail_url}
              storyboard={storyboard}
              title={video?.title}
              onBack={() => router.push('/')}
              resolution={video?.resolution}
              fps={video?.fps}
              codec={video?.codec}
              videoId={video?.id}
              videoRef={videoRef}
              defaultVolume={playerConfig?.volume ?? 0.8}
              defaultAutoplay={playerConfig?.autoplay ?? true}
              defaultSpeed={playerConfig?.default_speed ?? 1}
              defaultFit={playerConfig?.default_fit ?? 'fit'}
              seekStep={playerConfig?.seek_step ?? 10}
              autoStats={playerConfig?.auto_stats ?? false}
            />
          ) : (
            /* Instant Player Shell: Thumbnail + Center Glowing Spinner */
            <div className="aspect-video w-full relative bg-zinc-950 sm:rounded-2xl overflow-hidden flex items-center justify-center select-none">
              {/* Background Poster / Thumbnail */}
              {video?.thumbnail_url && (
                <img
                  src={video.thumbnail_url}
                  alt={video?.title || 'Thumbnail'}
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

        {/* 📱 YouTube-Style Video Details Section (Left Col Row 2 on desktop) */}
        <div className="flex flex-col gap-3.5 p-3.5 sm:px-0 sm:pt-4 bg-[#FBF9F5] lg:col-start-1 lg:row-start-2">
          {/* Title */}
          {video ? (
            <h1 className="text-[17px] sm:text-xl font-bold text-[#0F0F0F] leading-snug line-clamp-2">
              {video.title}
            </h1>
          ) : (
            <div className="h-6 sm:h-7 bg-[#EFECE6] rounded-lg w-3/4 animate-pulse my-0.5" />
          )}

          {/* Views, Tags & Expand Trigger */}
          <div className="flex items-center gap-1.5 text-xs text-[#606060] font-normal">
            <span>{viewsDisplay}</span>
            <span>•</span>
            <span>HLS Direct</span>
            <span>•</span>
            <span className="text-[#FF7A00] font-medium">#TubeLock</span>
            <button
              type="button"
              onClick={() => setIsDescOpen(!isDescOpen)}
              className="text-[#0F0F0F] font-semibold hover:underline cursor-pointer ml-1"
            >
              {isDescOpen ? 'แสดงน้อยลง' : '...เพิ่มเติม'}
            </button>
          </div>

          {/* 👤 YouTube Channel Row */}
          <div className="flex items-center justify-between gap-3 py-1">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-[#FF7A00] to-[#FF9E40] flex items-center justify-center text-white shadow-xs shrink-0">
                <Layers className="w-5 h-5 text-white" />
              </div>
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1">
                  <span className="font-bold text-[14px] text-[#0F0F0F] truncate">
                    OneDrive Cloud Storage
                  </span>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" title="เชื่อมต่อแล้ว" />
                </div>
                <span className="text-[11px] text-[#606060] truncate">
                  TubeLock Private Streaming • 62.4K
                </span>
              </div>
            </div>

            {/* YouTube-Style Subscribe / Save Pill Button */}
            <button
              type="button"
              onClick={() => {
                setIsSubscribed(!isSubscribed);
                showToast && showToast(isSubscribed ? 'ยกเลิกการติดตามแล้ว' : 'ติดตามช่องนี้แล้ว');
              }}
              className={`px-4 py-2 rounded-full text-xs font-semibold transition active:scale-95 shrink-0 cursor-pointer ${
                isSubscribed 
                  ? 'bg-[#F2F2F2] hover:bg-[#E5E5E5] text-[#0F0F0F]' 
                  : 'bg-[#0F0F0F] hover:bg-[#272727] text-white'
              }`}
            >
              {isSubscribed ? 'ติดตามแล้ว' : 'ติดตาม'}
            </button>
          </div>

          {/* 🔘 YouTube Pill Action Buttons Bar */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1 select-none -mx-3.5 px-3.5 sm:mx-0 sm:px-0">
            {/* Like / Dislike Split Pill */}
            <div className="flex items-center bg-[#F2F2F2] rounded-full text-xs font-semibold text-[#0F0F0F] shrink-0">
              <button
                type="button"
                onClick={handleLike}
                className="flex items-center gap-1.5 px-3.5 py-2 hover:bg-black/5 rounded-l-full active:scale-95 transition cursor-pointer"
              >
                <ThumbsUp className={`w-4 h-4 ${liked ? 'fill-[#FF7A00] text-[#FF7A00]' : 'text-[#0F0F0F]'}`} />
                <span>{likeCount}</span>
              </button>
              <div className="w-px h-4 bg-zinc-300" />
              <button
                type="button"
                onClick={handleDislike}
                className="px-3 py-2 hover:bg-black/5 rounded-r-full active:scale-95 transition cursor-pointer"
              >
                <ThumbsDown className={`w-4 h-4 ${disliked ? 'fill-[#FF7A00] text-[#FF7A00]' : 'text-[#0F0F0F]'}`} />
              </button>
            </div>

            {/* Share Pill */}
            <button
              type="button"
              onClick={handleCopyLink}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-[#F2F2F2] hover:bg-[#E5E5E5] text-[#0F0F0F] text-xs font-semibold transition active:scale-95 shrink-0 cursor-pointer"
            >
              <Share2 className="w-4 h-4" />
              <span>{copied ? 'คัดลอกแล้ว!' : 'แชร์'}</span>
            </button>

            {/* Resolution / Codec Badge Pill */}
            <div className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-[#F2F2F2] text-[#0F0F0F] text-xs font-semibold shrink-0">
              <SlidersHorizontal className="w-3.5 h-3.5 text-[#FF7A00]" />
              <span>{resBadge || '4K'} • {video?.codec ? video.codec.toUpperCase() : 'H264'}</span>
            </div>

            {/* File Size MB */}
            <div className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-[#F2F2F2] text-[#0F0F0F] text-xs font-semibold shrink-0">
              <HardDrive className="w-3.5 h-3.5 text-zinc-500" />
              <span>{fileSizeMB} MB</span>
            </div>

            {/* Duration Pill */}
            <div className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-[#F2F2F2] text-[#0F0F0F] text-xs font-semibold shrink-0">
              <Clock className="w-3.5 h-3.5 text-zinc-500" />
              <span>{formatDuration(video?.duration)}</span>
            </div>
          </div>

          {/* 💬 YouTube-Style Comments & Description Preview Card */}
          <div 
            onClick={() => setIsDescOpen(!isDescOpen)}
            className="bg-[#F2F2F2] hover:bg-[#EBEBEB] rounded-2xl p-3.5 flex flex-col gap-2 transition cursor-pointer select-none"
          >
            <div className="flex items-center justify-between text-xs font-bold text-[#0F0F0F]">
              <div className="flex items-center gap-2">
                <span>รายละเอียดและข้อมูลไฟล์</span>
                <span className="text-[11px] text-[#606060] font-normal">
                  {formatDuration(video?.duration)} • {fileSizeMB} MB
                </span>
              </div>
              {isDescOpen ? <ChevronUp className="w-4 h-4 text-[#606060]" /> : <ChevronDown className="w-4 h-4 text-[#606060]" />}
            </div>

            <div className={`text-xs text-[#282828] leading-relaxed transition-all ${isDescOpen ? 'block' : 'line-clamp-2'}`}>
              {video ? (video.description || 'วิดีโอนี้สตรีมตรงผ่าน OneDrive HLS Engine คุณภาพสูง ปรับความละเอียดตามความเร็วเน็ตอัตโนมัติ (ABR)') : 'กำลังโหลด...'}
            </div>
          </div>

          {/* 🏷️ YouTube Recommendation Filter Chips */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pt-1 select-none -mx-3.5 px-3.5 sm:mx-0 sm:px-0">
            {[
              { id: 'all', label: 'ทั้งหมด' },
              { id: 'cloud', label: 'จาก OneDrive' },
              { id: '4k', label: 'ความละเอียดสูง 4K' },
              { id: 'related', label: 'ที่เกี่ยวข้อง' },
            ].map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => setActiveFilter(chip.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition active:scale-95 shrink-0 cursor-pointer ${
                  activeFilter === chip.id
                    ? 'bg-[#0F0F0F] text-white'
                    : 'bg-[#F2F2F2] text-[#0F0F0F] hover:bg-[#E5E5E5]'
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>

        {/* Right / Sidebar: Related Videos Column (Spans Col 2 on Desktop / Flows underneath on Mobile) */}
        <div className="w-full flex flex-col gap-3 px-3.5 sm:px-0 pb-16 lg:col-start-2 lg:row-start-1 lg:row-span-3">
          <div className="hidden lg:flex items-center gap-1.5 pb-1">
            <PlaySquare className="w-4 h-4 text-[#FF7A00]" />
            <h2 className="text-sm font-bold text-[#0F0F0F]">
              วิดีโอถัดไป ({relatedVideos.length})
            </h2>
          </div>

          {relatedVideos.length === 0 ? (
            <div className="bg-[#F2F2F2] rounded-2xl p-8 text-center text-xs text-[#606060]">
              ไม่มีวิดีโออื่นในคลัง
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:gap-3">
              {relatedVideos.map((item) => (
                <VideoCard key={item.id} video={item} replace={true} compact={true} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
