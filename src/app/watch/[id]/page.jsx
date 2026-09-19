'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import VideoPlayer from '@/components/VideoPlayer';
import VideoCard from '@/components/VideoCard';
import { 
  ArrowLeft, Clock, HardDrive, Cpu, CheckCircle2, 
  AlertCircle, Share2, PlaySquare, ChevronDown, ChevronUp,
  Layers, Sparkles
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [isDescOpen, setIsDescOpen] = useState(false);

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
    let cancelled = false;

    async function initWatch() {
      if (!id) return;

      try {
        setLoading(true);
        setError(null);
        setStreamUrl('');

        // Revoke previous blob URLs
        for (const u of activeBlobUrlsRef.current) {
          try { URL.revokeObjectURL(u); } catch (_) {}
        }
        activeBlobUrlsRef.current = [];

        // 1. Fetch Source
        const sourceRes = await fetch(`/api/videos/${id}/source`);
        if (!sourceRes.ok) {
          const errData = await sourceRes.json().catch(() => ({}));
          throw new Error(errData.error || `ไม่สามารถโหลดวิดีโอได้ (รหัส ${sourceRes.status})`);
        }

        const sourceData = await sourceRes.json();
        if (cancelled) return;

        if (!sourceData.video) {
          throw new Error('ไม่พบข้อมูลวิดีโอนี้ในระบบ');
        }

        setVideo(sourceData.video);

        // 2. Resolve Playback URL (Direct MP4 or Nested HLS Blob)
        const resolved = await resolveClientPlaybackSource(sourceData);
        if (cancelled) return;

        if (resolved.blobUrls && resolved.blobUrls.length > 0) {
          activeBlobUrlsRef.current = resolved.blobUrls;
        }

        setStreamUrl(resolved.url);
        setStoryboard(resolved.storyboard || null);

        // 3. Fetch Related Videos
        const listRes = await fetch('/api/videos');
        if (listRes.ok) {
          const listJson = await listRes.json();
          const all = listJson?.data || [];
          if (!cancelled) {
            setRelatedVideos(all.filter((v) => String(v.id) !== String(id)));
          }
        }
      } catch (err) {
        console.error('[WatchPage Error]:', err);
        if (!cancelled) {
          setError(err.message || 'เกิดข้อผิดพลาดในการโหลดวิดีโอ');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
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

  const formatDuration = (sec) => {
    if (!sec) return '00:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  if (loading) {
    return (
      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-4 animate-pulse flex flex-col lg:flex-row gap-6 select-none">
        <div className="flex-1 flex flex-col gap-4">
          <div className="w-full aspect-video bg-[#EFECE6] rounded-2xl" />
          <div className="h-6 bg-[#EFECE6] rounded-lg w-3/4" />
          <div className="flex gap-2">
            <div className="h-7 w-20 bg-[#EFECE6] rounded-lg" />
            <div className="h-7 w-24 bg-[#EFECE6] rounded-lg" />
            <div className="h-7 w-20 bg-[#EFECE6] rounded-lg" />
          </div>
          <div className="h-28 bg-[#EFECE6] rounded-2xl w-full mt-2" />
        </div>
        <div className="w-full lg:w-96 flex flex-col gap-4">
          <div className="h-5 bg-[#EFECE6] rounded w-1/3" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex gap-3">
              <div className="w-40 aspect-video bg-[#EFECE6] rounded-xl shrink-0" />
              <div className="flex-1 space-y-2 py-1">
                <div className="h-3.5 bg-[#EFECE6] rounded w-full" />
                <div className="h-3 bg-[#EFECE6] rounded w-2/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || !video) {
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

  const fileSizeMB = (Number(video.file_size_bytes || 0) / (1024 * 1024)).toFixed(1);
  const resBadge = formatResolutionBadge(video.resolution);
  const is4K = resBadge === '4K';
  const is2K = resBadge === '2K';

  return (
    <div className="w-full max-w-[1720px] mx-auto px-0 sm:px-4 md:px-6 lg:px-8 py-0 sm:py-5">
      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* Left / Main Player Column */}
        <div className="flex-1 w-full min-w-0 flex flex-col">
          {/* Player Wrapper */}
          <div className="relative w-full">
            {/* Mobile-only Back Button Overlay */}
            <button
              type="button"
              onClick={() => router.push('/')}
              className="sm:hidden absolute top-3 left-3 z-40 p-2 rounded-full bg-black/60 hover:bg-black/80 text-white backdrop-blur-md transition active:scale-90 border border-white/10 shadow-lg cursor-pointer"
              title="ย้อนกลับสู่หน้าหลัก"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>

            {streamUrl ? (
              <VideoPlayer
                src={streamUrl}
                poster={video.thumbnail_url}
                storyboard={storyboard}
                resolution={video.resolution}
                fps={video.fps}
                codec={video.codec}
                videoId={video.id}
                videoRef={videoRef}
                defaultVolume={playerConfig?.volume ?? 0.8}
                defaultAutoplay={playerConfig?.autoplay ?? true}
                defaultSpeed={playerConfig?.default_speed ?? 1}
                defaultFit={playerConfig?.default_fit ?? 'fit'}
                seekStep={playerConfig?.seek_step ?? 10}
                autoStats={playerConfig?.auto_stats ?? false}
              />
            ) : (
              <div className="aspect-video w-full flex items-center justify-center text-white text-xs bg-black sm:rounded-2xl">
                กำลังเตรียมสัญญาณภาพ...
              </div>
            )}
          </div>

          {/* Video Metadata Section */}
          <div className="flex flex-col gap-4 p-4 sm:px-0 sm:pt-4">
            {/* Title */}
            <h1 className="text-base sm:text-xl font-bold text-[#212529] leading-snug">
              {video.title}
            </h1>

            {/* Badges & Actions Row */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#EFECE6]">
              {/* Badges */}
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`font-bold text-xs px-2.5 py-1 rounded-lg uppercase tracking-wide ${
                    is4K
                      ? 'bg-[#FF7A00] text-white shadow-xs'
                      : is2K
                      ? 'bg-amber-500 text-white'
                      : 'bg-[#F0EDE6] text-[#212529]'
                  }`}
                >
                  {resBadge}
                </span>

                {Number(video.fps) > 0 && (
                  <span className="bg-[#F0EDE6] text-[#212529] font-medium text-xs px-2.5 py-1 rounded-lg font-mono">
                    {Number(video.fps).toFixed(0)} FPS
                  </span>
                )}

                <span className="bg-[#FFF4EB] text-[#FF7A00] font-semibold text-xs px-2.5 py-1 rounded-lg uppercase">
                  {video.codec ? video.codec.toUpperCase() : 'H264'}
                </span>

                <span className="bg-[#F0EDE6] text-[#6C757D] font-medium text-xs px-2.5 py-1 rounded-lg">
                  {video.source_type === 'hls' ? 'HLS Adaptive' : 'Direct Stream'}
                </span>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#F0EDE6] hover:bg-[#E5E0D8] text-[#212529] text-xs font-semibold transition active:scale-95 cursor-pointer shadow-xs"
                >
                  <Share2 className="w-3.5 h-3.5 text-[#6C757D]" />
                  <span>{copied ? 'คัดลอกแล้ว!' : 'แชร์'}</span>
                </button>
              </div>
            </div>

            {/* Channel Info & Description Card */}
            <div className="bg-white border border-[#EFECE6] rounded-2xl p-4 flex flex-col gap-3 text-xs shadow-xs">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#FFF4EB] border border-[#FF7A00]/20 flex items-center justify-center shrink-0">
                  <Layers className="w-5 h-5 text-[#FF7A00]" />
                </div>
                <div className="flex flex-col">
                  <span className="font-bold text-sm text-[#212529]">OneDrive Cloud Storage</span>
                  <span className="text-[11px] text-[#8C857B]">วิดีโอที่สตรีมผ่าน TubeLock</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-[#6C757D] pt-2 border-t border-[#F5F2EB]">
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-[#8C857B]" />
                  {formatDuration(video.duration)}
                </span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <HardDrive className="w-3.5 h-3.5 text-[#8C857B]" />
                  {fileSizeMB} MB
                </span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <Cpu className="w-3.5 h-3.5 text-[#8C857B]" />
                  {video.codec ? video.codec.toUpperCase() : 'H264'}
                </span>
              </div>

              <div className="border-t border-[#F5F2EB] pt-2 flex flex-col gap-1.5">
                <div
                  onClick={() => setIsDescOpen(!isDescOpen)}
                  className="flex items-center justify-between cursor-pointer select-none text-[#495057] font-semibold"
                >
                  <span>คำอธิบายไฟล์</span>
                  {isDescOpen ? <ChevronUp className="w-3.5 h-3.5 text-[#8C857B]" /> : <ChevronDown className="w-3.5 h-3.5 text-[#8C857B]" />}
                </div>

                <div className={`text-[#6C757D] leading-relaxed transition-all ${isDescOpen ? 'block' : 'line-clamp-2'}`}>
                  {video.description || 'ไม่มีคำอธิบายเพิ่มเติมสำหรับไฟล์นี้'}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right / Sidebar: Related Videos Column */}
        <div className="w-full lg:w-[380px] xl:w-[420px] flex flex-col gap-3 px-4 sm:px-0 pb-10">
          <div className="flex items-center gap-1.5 pb-1">
            <PlaySquare className="w-4 h-4 text-[#FF7A00]" />
            <h2 className="text-sm font-bold text-[#212529]">
              วิดีโอถัดไป ({relatedVideos.length})
            </h2>
          </div>

          {relatedVideos.length === 0 ? (
            <div className="bg-white border border-[#EFECE6] rounded-2xl p-8 text-center text-xs text-[#8C857B]">
              ไม่มีวิดีโออื่นในคลัง
            </div>
          ) : (
            <div className="flex flex-col gap-3">
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
