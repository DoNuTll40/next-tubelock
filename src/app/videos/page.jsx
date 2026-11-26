'use client';

import { useState, useEffect, useId, useMemo, useRef } from 'react';
import Link from 'next/link';
import {
  Film,
  Search,
  Plus,
  Pencil,
  Captions,
  Play,
  MoreVertical,
  Copy,
  Check,
  Trash2,
  ExternalLink,
  RefreshCw,
  Loader2,
  LockKeyhole,
  Eye,
  LayoutGrid,
  List,
  AlertTriangle,
  Cpu,
  Clock,
  SlidersHorizontal,
  Globe,
  Link2,
  Lock,
} from 'lucide-react';
import DeleteVideoModal from '@/components/DeleteVideoModal';
import VideoCard from '@/components/VideoCard';
import { AnimatedTabPanel, AnimatedTabs } from '@/components/ui/AnimatedTabs';
import { getVisibilityMeta } from '@/lib/videoVisibility';
import { useSession } from '@/context/SessionContext';
import { usePosterPreference } from '@/lib/usePosterPreference';
import { usePosterReveal } from '@/lib/usePosterReveal';
import { invalidateClientVideoCache } from '@/lib/playbackResolver';
import {
  encodeVideoSlug,
  formatResolutionBadge,
  isMatureVideo,
  RESTRICTED_POSTER,
} from '@/lib/videoUtils';
import {
  formatVideoDuration,
  formatFileSize,
  getCategoryLabel,
} from '@/lib/videoEditorUtils';

function formatThaiDate(iso) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('th-TH', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '-';
  }
}

function getStatusMeta(status, progress = 0) {
  const s = String(status || '').toUpperCase();
  if (s === 'READY') {
    return {
      label: 'พร้อมรับชม',
      badgeClass: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
      isProcessing: false,
    };
  }
  if (s === 'FAILED') {
    return {
      label: 'ล้มเหลว',
      badgeClass: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/25',
      isProcessing: false,
    };
  }
  if (s === 'TRANSCODING' || s === 'PROCESSING') {
    const pct = Number(progress) || 0;
    return {
      label: pct > 0 ? `กำลังแปลง ${pct}%` : 'กำลังประมวลผล',
      badgeClass: 'bg-[#FF7A00]/15 text-[#FF7A00] border-[#FF7A00]/30',
      isProcessing: true,
    };
  }
  return {
    label: s || 'รอดำเนินการ',
    badgeClass: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25',
    isProcessing: true,
  };
}

function getRatingMeta(rating) {
  const r = String(rating || 'all').toLowerCase();
  if (r === 'mature') {
    return {
      label: 'จำกัดเฉพาะ',
      className: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/25',
    };
  }
  if (r === '18+') {
    return {
      label: '18+',
      className: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/25',
    };
  }
  if (r === '13+') {
    return {
      label: '13+',
      className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25',
    };
  }
  return {
    label: 'ทั่วไป',
    className: 'bg-zinc-500/10 text-[#6C655D] dark:text-[#AAAAAA] border-[#EFECE6] dark:border-white/10',
  };
}

function StudioActionDropdown({
  video,
  watchHref,
  isOpen,
  hoverReveal = false,
  onToggle,
  onClose,
  onCopyLink,
  copiedId,
  onRequestDelete,
}) {
  const menuRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };
    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [isOpen, onClose]);

  const isCopied = copiedId === video.id;
  const triggerVisibility = hoverReveal
    ? isOpen
      ? 'opacity-100 bg-black/10 dark:bg-white/10 text-[#212529] dark:text-[#F1F1F1]'
      : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 text-[#8C857B] dark:text-[#AAAAAA] hover:text-[#212529] dark:hover:text-[#F1F1F1] hover:bg-black/10 dark:hover:bg-white/10'
    : 'text-[#6C655D] dark:text-[#CCCCCC] hover:text-[#212529] dark:hover:text-white hover:bg-[#F4F0E8] dark:hover:bg-white/10';

  return (
    <div className="relative shrink-0 z-20" ref={menuRef}>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggle();
        }}
        title="ตัวเลือกเพิ่มเติม"
        className={`relative z-20 ${hoverReveal ? 'p-1.5' : 'w-8 h-8'} rounded-full flex items-center justify-center transition-all cursor-pointer ${triggerVisibility}`}
      >
        <MoreVertical className={hoverReveal ? 'w-5 h-5' : 'w-4 h-4'} />
      </button>

      {isOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-full mt-1.5 w-56 rounded-2xl bg-white dark:bg-[#212121] border border-[#EFECE6] dark:border-white/15 shadow-2xl py-1.5 z-40 text-xs text-[#212529] dark:text-[#F1F1F1]"
        >
          <Link
            href={`/videos/${video.id}/edit`}
            onClick={onClose}
            className="flex items-center gap-2.5 px-3.5 py-2 hover:bg-[#F4F0E8] dark:hover:bg-white/10 transition"
          >
            <Pencil className="w-3.5 h-3.5 text-[#FF7A00]" />
            <span>แก้ไขรายละเอียดและภาพปก</span>
          </Link>
          <Link
            href={`/videos/${video.id}/edit?tab=subtitles`}
            onClick={onClose}
            className="flex items-center gap-2.5 px-3.5 py-2 hover:bg-[#F4F0E8] dark:hover:bg-white/10 transition"
          >
            <Captions className="w-3.5 h-3.5 text-emerald-500" />
            <span>แก้ไขคำบรรยาย (Subtitles)</span>
          </Link>
          <Link
            href={`/videos/${video.id}/edit?tab=tech`}
            onClick={onClose}
            className="flex items-center gap-2.5 px-3.5 py-2 hover:bg-[#F4F0E8] dark:hover:bg-white/10 transition"
          >
            <Cpu className="w-3.5 h-3.5 text-sky-500" />
            <span>ข้อมูลเทคนิค & รีแปลง HLS</span>
          </Link>
          <div className="my-1 border-t border-[#EFECE6] dark:border-white/10" />
          <Link
            href={watchHref}
            onClick={onClose}
            className="flex items-center gap-2.5 px-3.5 py-2 hover:bg-[#F4F0E8] dark:hover:bg-white/10 transition"
          >
            <ExternalLink className="w-3.5 h-3.5 text-[#8C857B] dark:text-[#AAAAAA]" />
            <span>ดูใน TubeLock</span>
          </Link>
          <button
            type="button"
            onClick={() => {
              onCopyLink(video, watchHref);
              onClose();
            }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 hover:bg-[#F4F0E8] dark:hover:bg-white/10 transition text-left cursor-pointer"
          >
            {isCopied ? (
              <Check className="w-3.5 h-3.5 text-emerald-500" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-[#8C857B] dark:text-[#AAAAAA]" />
            )}
            <span>{isCopied ? 'คัดลอกลิงก์แล้ว' : 'คัดลอกลิงก์รับชม'}</span>
          </button>
          <div className="my-1 border-t border-[#EFECE6] dark:border-white/10" />
          <button
            type="button"
            onClick={() => {
              onClose();
              onRequestDelete(video);
            }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 hover:bg-rose-500/10 text-rose-600 dark:text-rose-400 transition text-left cursor-pointer font-semibold"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>ลบวิดีโอถาวร</span>
          </button>
        </div>
      )}
    </div>
  );
}

function StudioThumbnail({ video, isMature, allow18Plus, revealedPoster, onReveal, children }) {
  const hasRealPoster = Boolean(video.thumbnail_url) && video.thumbnail_url !== RESTRICTED_POSTER;
  const posterSrc = isMature
    ? allow18Plus
      ? `/api/videos/${video.id}/poster`
      : revealedPoster?.url || RESTRICTED_POSTER
    : hasRealPoster
    ? video.thumbnail_url
    : null;

  const isMasked = isMature && !allow18Plus && !revealedPoster?.url;

  return (
    <div className="relative aspect-video bg-[#111111] overflow-hidden shrink-0">
      {isMasked ? (
        <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 bg-gradient-to-br from-[#231912] via-[#17120e] to-[#0f0d0c] p-3 text-center">
          <LockKeyhole className="w-5 h-5 text-[#FF7A00]" />
          <span className="text-[11px] font-semibold text-zinc-200">เนื้อหาจำกัดอายุ 18+</span>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onReveal();
            }}
            className="px-2.5 py-1 rounded-full bg-[#FF7A00]/20 hover:bg-[#FF7A00] text-[#FF7A00] hover:text-white border border-[#FF7A00]/40 text-[10px] font-semibold transition inline-flex items-center gap-1 cursor-pointer"
          >
            <Eye className="w-3 h-3" />
            <span>แสดงภาพปก</span>
          </button>
        </div>
      ) : posterSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={posterSrc}
          alt={video.title || 'video thumbnail'}
          loading="lazy"
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center text-zinc-500 gap-1">
          <Film className="w-6 h-6 opacity-60" />
          <span className="text-[10px]">ยังไม่มีภาพปก</span>
        </div>
      )}
      {children}
    </div>
  );
}

function StudioVideoCard({
  video,
  session,
  openMenuId,
  setOpenMenuId,
  copiedId,
  onCopyLink,
  onRequestDelete,
}) {
  const watchSlug = encodeVideoSlug(video.id, video.category) || String(video.id);
  const watchHref = `/watch/${watchSlug}`;
  const statusMeta = getStatusMeta(video.status, video.transcode_progress);
  const subtitleCount = Number(video.subtitle_count) || 0;
  const isMenuOpen = openMenuId === video.id;
  const isMature = isMatureVideo(video);

  const normalizedVideo = {
    ...video,
    title: video.title || video.raw_file_name || `วิดีโอ #${video.id}`,
    author_name: video.author_name || session?.name || 'DONUŤ',
    author_picture: video.author_picture || session?.picture || '',
  };

  const progressOverride = statusMeta.isProcessing
    ? Math.min(100, Math.max(8, Number(video.transcode_progress) || 12))
    : 0;

  return (
    <VideoCard
      video={normalizedVideo}
      href={`/videos/${video.id}/edit`}
      enablePrewarm={false}
      progressPctOverride={progressOverride}
      isMenuOpen={isMenuOpen}
      renderMeta={() => (
        <div className="flex flex-col text-[12px] text-[#8C857B] dark:text-[#AAAAAA] mt-1 leading-normal">
          <span className="relative z-20 truncate font-medium cursor-default">
            {normalizedVideo.author_name} • {formatThaiDate(video.created_at)}
          </span>
          <div className="flex items-center flex-wrap gap-1.5 text-[11px] text-[#8C857B] dark:text-[#888888] mt-0.5">
            <span className={`px-1.5 py-0.2 rounded text-[10px] font-semibold border ${statusMeta.badgeClass}`}>
              {statusMeta.label}
            </span>
            {(() => {
              const vis = getVisibilityMeta(video.visibility);
              const VisIcon = vis.id === 'private' ? Lock : vis.id === 'unlisted' ? Link2 : Globe;
              return (
                <span className={`px-1.5 py-0.2 rounded text-[10px] font-semibold border inline-flex items-center gap-0.5 ${vis.badgeClass}`}>
                  <VisIcon className="w-2.5 h-2.5" />
                  {vis.label}
                </span>
              );
            })()}
            {isMature && (
              <span className="font-semibold text-rose-500 bg-rose-500/10 dark:bg-rose-500/20 px-1.5 py-0.2 rounded text-[10px] border border-rose-500/30 shrink-0">
                18+
              </span>
            )}
            <span className="font-semibold text-[#FF7A00] uppercase bg-[#FFF4EB] dark:bg-[#FF7A00]/15 px-1.5 py-0.2 rounded text-[10px]">
              {video.codec ? video.codec.toUpperCase() : 'H264'}
            </span>
            <span>•</span>
            <span className="font-mono">{formatFileSize(video.file_size_bytes)}</span>
            <span>•</span>
            <span className={subtitleCount > 0 ? 'text-sky-600 dark:text-sky-400 font-medium' : ''}>
              {subtitleCount > 0 ? `ซับ ${subtitleCount} แทร็ก` : 'ไม่มีซับ'}
            </span>
          </div>
        </div>
      )}
      renderMenu={() => (
        <StudioActionDropdown
          video={video}
          watchHref={watchHref}
          isOpen={isMenuOpen}
          hoverReveal={true}
          onToggle={() => setOpenMenuId(isMenuOpen ? null : video.id)}
          onClose={() => setOpenMenuId(null)}
          onCopyLink={onCopyLink}
          copiedId={copiedId}
          onRequestDelete={onRequestDelete}
        />
      )}
    />
  );
}

function StudioVideoRow({
  video,
  openMenuId,
  setOpenMenuId,
  copiedId,
  onCopyLink,
  onRequestDelete,
}) {
  const isMature = isMatureVideo(video);
  const allow18Plus = usePosterPreference(isMature);
  const { poster: revealedPoster, revealPoster } = usePosterReveal(
    isMature ? video.id : null,
    !allow18Plus
  );

  const watchSlug = encodeVideoSlug(video.id, video.category) || String(video.id);
  const watchHref = `/watch/${watchSlug}`;
  const statusMeta = getStatusMeta(video.status, video.transcode_progress);
  const ratingMeta = getRatingMeta(video.content_rating);
  const subtitleCount = Number(video.subtitle_count) || 0;
  const isMenuOpen = openMenuId === video.id;

  return (
    <div
      className={`group relative rounded-2xl bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 hover:border-[#D8D1C7] dark:hover:border-white/25 p-3 sm:px-4 sm:py-3 shadow-xs transition flex flex-col sm:flex-row sm:items-center gap-3.5 ${
        isMenuOpen ? 'z-30' : ''
      }`}
    >
      <div className="w-full sm:w-40 shrink-0 rounded-xl overflow-hidden">
        <StudioThumbnail
          video={video}
          isMature={isMature}
          allow18Plus={allow18Plus}
          revealedPoster={revealedPoster}
          onReveal={revealPoster}
        >
          {Number(video.duration) > 0 && (
            <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/80 text-white text-[10px] font-mono font-semibold">
              {formatVideoDuration(video.duration)}
            </span>
          )}
        </StudioThumbnail>
      </div>

      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href={`/videos/${video.id}/edit`}
            className="text-sm font-bold text-[#212529] dark:text-[#F1F1F1] hover:text-[#FF7A00] transition truncate max-w-full"
          >
            {video.title || video.raw_file_name || `วิดีโอ #${video.id}`}
          </Link>
          <span className="text-[10px] font-mono text-[#8C857B] dark:text-[#8E8E8E]">
            #{video.id}
          </span>
        </div>

        <p className="text-xs text-[#6C655D] dark:text-[#9A9A9A] line-clamp-1">
          {video.description || `${getCategoryLabel(video.category)} • ${video.raw_file_name || 'Stream ready'}`}
        </p>

        <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-semibold">
          <span className={`px-2 py-0.5 rounded-md border ${statusMeta.badgeClass}`}>
            {statusMeta.label}
          </span>
          {(() => {
            const vis = getVisibilityMeta(video.visibility);
            const VisIcon = vis.id === 'private' ? Lock : vis.id === 'unlisted' ? Link2 : Globe;
            return (
              <span className={`px-2 py-0.5 rounded-md border inline-flex items-center gap-1 ${vis.badgeClass}`}>
                <VisIcon className="w-3 h-3" />
                {vis.label}
              </span>
            );
          })()}
          <span className={`px-2 py-0.5 rounded-md border ${ratingMeta.className}`}>
            {ratingMeta.label}
          </span>
          <span className="px-2 py-0.5 rounded-md border bg-[#F4F0E8] dark:bg-[#222222] border-[#EFECE6] dark:border-white/10 text-[#6C655D] dark:text-[#CCCCCC] font-mono">
            {formatResolutionBadge(video.resolution)} {(video.codec || '').toUpperCase()}
          </span>
          <span
            className={`px-2 py-0.5 rounded-md border inline-flex items-center gap-1 ${
              subtitleCount > 0
                ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/25'
                : 'bg-zinc-500/10 text-[#8C857B] dark:text-[#8E8E8E] border-[#EFECE6] dark:border-white/10'
            }`}
          >
            <Captions className="w-3 h-3" />
            {subtitleCount > 0 ? `${subtitleCount} แทร็ก` : 'ไม่มีซับ'}
          </span>
          <span className="text-[#8C857B] dark:text-[#8E8E8E] font-mono ml-1">
            {formatFileSize(video.file_size_bytes)} • {formatThaiDate(video.created_at)}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-end gap-1.5 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-[#EFECE6] dark:border-white/10">
        <Link
          href={`/videos/${video.id}/edit`}
          className="px-3 py-1.5 rounded-xl bg-[#F4F0E8] dark:bg-[#222222] hover:bg-[#FF7A00] text-[#212529] dark:text-[#F1F1F1] hover:text-white border border-[#EFECE6] dark:border-white/10 text-xs font-semibold inline-flex items-center gap-1.5 transition"
        >
          <Pencil className="w-3.5 h-3.5" />
          <span>รายละเอียด</span>
        </Link>
        <Link
          href={`/videos/${video.id}/edit?tab=subtitles`}
          className="px-3 py-1.5 rounded-xl bg-[#F4F0E8] dark:bg-[#222222] hover:bg-[#EFECE6] dark:hover:bg-[#2c2c2c] border border-[#EFECE6] dark:border-white/10 text-xs font-semibold text-[#212529] dark:text-[#F1F1F1] inline-flex items-center gap-1.5 transition"
        >
          <Captions className="w-3.5 h-3.5 text-emerald-500" />
          <span className="hidden md:inline">คำบรรยาย</span>
        </Link>
        <Link
          href={watchHref}
          title="ดูใน TubeLock"
          className="p-2 rounded-xl bg-[#F4F0E8] dark:bg-[#222222] hover:bg-[#EFECE6] dark:hover:bg-[#2c2c2c] border border-[#EFECE6] dark:border-white/10 text-[#212529] dark:text-[#F1F1F1] transition"
        >
          <Play className="w-3.5 h-3.5" />
        </Link>
        <StudioActionDropdown
          video={video}
          watchHref={watchHref}
          isOpen={isMenuOpen}
          onToggle={() => setOpenMenuId(isMenuOpen ? null : video.id)}
          onClose={() => setOpenMenuId(null)}
          onCopyLink={onCopyLink}
          copiedId={copiedId}
          onRequestDelete={onRequestDelete}
        />
      </div>
    </div>
  );
}

export default function StudioContentPage() {
  const session = useSession();
  const filterTabsId = useId();
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState('all'); // 'all' | 'ready' | 'processing' | 'failed' | 'subtitled' | 'mature'
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'list'
  const [openMenuId, setOpenMenuId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function loadStudioVideos() {
      try {
        const res = await fetch('/api/videos?mine=1', { cache: 'no-store' });
        if (cancelled) return;
        if (res.status === 401) {
          setAuthRequired(true);
          setLoading(false);
          return;
        }
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setErrorMsg(json?.error || 'ไม่สามารถโหลดคลังวิดีโอได้');
        } else {
          const rows = Array.isArray(json?.data)
            ? json.data
            : Array.isArray(json?.videos)
            ? json.videos
            : [];
          setVideos(rows);
          setErrorMsg('');
          setAuthRequired(false);
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(err.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อ');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadStudioVideos();
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  const counts = useMemo(() => {
    const c = { all: videos.length, ready: 0, processing: 0, failed: 0, subtitled: 0, mature: 0 };
    for (const v of videos) {
      const s = String(v.status || '').toUpperCase();
      if (s === 'READY') c.ready += 1;
      else if (s === 'FAILED') c.failed += 1;
      else c.processing += 1;

      if (Number(v.subtitle_count) > 0) c.subtitled += 1;
      if (isMatureVideo(v)) c.mature += 1;
    }
    return c;
  }, [videos]);

  const filteredVideos = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return videos.filter((v) => {
      const s = String(v.status || '').toUpperCase();
      if (filterTab === 'ready' && s !== 'READY') return false;
      if (filterTab === 'failed' && s !== 'FAILED') return false;
      if (filterTab === 'processing' && (s === 'READY' || s === 'FAILED')) return false;
      if (filterTab === 'subtitled' && Number(v.subtitle_count || 0) === 0) return false;
      if (filterTab === 'mature' && !isMatureVideo(v)) return false;

      if (!q) return true;
      const hay = [
        v.title,
        v.raw_file_name,
        v.category,
        v.tags,
        String(v.id),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [videos, filterTab, searchQuery]);

  const handleCopyLink = async (video, watchHref) => {
    const url = `${window.location.origin}${watchHref}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(video.id);
      setTimeout(() => {
        setCopiedId((cur) => (cur === video.id ? null : cur));
      }, 2000);
    } catch (_) {}
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || isDeleting) return;
    setIsDeleting(true);
    setDeleteError('');
    try {
      const res = await fetch(`/api/videos/${deleteTarget.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'ลบวิดีโอไม่สำเร็จ');
      }
      invalidateClientVideoCache(deleteTarget.id);
      setVideos((prev) => prev.filter((item) => item.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err.message || 'ไม่สามารถลบวิดีโอได้');
    } finally {
      setIsDeleting(false);
    }
  };

  if (!loading && authRequired) {
    return (
      <div className="min-h-[75vh] px-4 py-12 flex items-center justify-center bg-[#FBF9F5] dark:bg-[#0F0F0F]">
        <div className="max-w-md w-full rounded-3xl bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 p-8 text-center space-y-4 shadow-sm">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-[#FF7A00]/15 border border-[#FF7A00]/30 flex items-center justify-center text-[#FF7A00]">
            <LockKeyhole className="w-7 h-7" />
          </div>
          <h1 className="text-xl font-bold text-[#212529] dark:text-[#F1F1F1]">
            เข้าสู่ระบบเพื่อเปิดคลังวิดีโอ Studio
          </h1>
          <p className="text-xs sm:text-sm text-[#6C655D] dark:text-[#9A9A9A] leading-relaxed">
            หน้าจัดการรายละเอียด แก้ไขภาพปก และแก้ไขซับไตเติลสงวนไว้สำหรับเจ้าของวิดีโอและผู้ดูแลระบบเท่านั้น
          </p>
          <div className="pt-2 flex items-center justify-center gap-2.5">
            <Link
              href="/login?next=/videos"
              className="px-5 py-2.5 rounded-full bg-[#FF7A00] hover:bg-[#E66E00] text-white text-sm font-semibold transition shadow-sm"
            >
              เข้าสู่ระบบ
            </Link>
            <Link
              href="/"
              className="px-5 py-2.5 rounded-full bg-[#F4F0E8] dark:bg-[#222222] hover:bg-[#EFECE6] dark:hover:bg-[#2c2c2c] text-[#212529] dark:text-[#F1F1F1] text-sm font-semibold transition"
            >
              กลับหน้าแรก
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FBF9F5] dark:bg-[#0F0F0F] text-[#212529] dark:text-[#F1F1F1] pb-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
        {/* Studio Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-[#FF7A00]/15 border border-[#FF7A00]/30 flex items-center justify-center text-[#FF7A00]">
                <SlidersHorizontal className="w-4.5 h-4.5" />
              </div>
              <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">
                เนื้อหาของช่อง (TubeLock Studio)
              </h1>
            </div>
            <p className="text-xs sm:text-sm text-[#6C655D] dark:text-[#9A9A9A]">
              จัดการวิดีโอทั้งหมดของ <strong className="text-[#212529] dark:text-[#F1F1F1]">{session?.name || 'คุณ'}</strong>{' '}
              — แก้ไขชื่อเรื่อง ภาพปก ซับไตเติลหลายภาษา และตรวจสอบสถานะ HLS
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                setRefreshTick((t) => t + 1);
              }}
              className="px-3.5 py-2 rounded-full bg-white dark:bg-[#181818] hover:bg-[#F4F0E8] dark:hover:bg-[#222222] border border-[#EFECE6] dark:border-white/10 text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#FF7A00]' : ''}`} />
              <span>รีเฟรช</span>
            </button>
            <Link
              href="/upload/queue"
              className="px-3.5 py-2 rounded-full bg-white dark:bg-[#181818] hover:bg-[#F4F0E8] dark:hover:bg-[#222222] border border-[#EFECE6] dark:border-white/10 text-xs font-semibold inline-flex items-center gap-1.5 transition"
            >
              <Clock className="w-3.5 h-3.5 text-[#FF7A00]" />
              <span>คิวแปลงไฟล์</span>
            </Link>
            <Link
              href="/upload"
              className="px-4 py-2 rounded-full bg-[#FF7A00] hover:bg-[#E66E00] text-white text-xs font-semibold inline-flex items-center gap-1.5 transition shadow-sm"
            >
              <Plus className="w-4 h-4" />
              <span>อัปโหลดวิดีโอใหม่</span>
            </Link>
          </div>
        </div>

        {/* Search, Filter Tabs & View Toggle */}
        <div className="bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 rounded-2xl p-3.5 sm:p-4 shadow-xs space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-[#8C857B] dark:text-[#8E8E8E] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ค้นหาชื่อวิดีโอ, แท็ก, ชื่อไฟล์ หรือรหัสวิดีโอ..."
                className="w-full pl-10 pr-4 py-2 rounded-xl bg-[#F4F0E8] dark:bg-[#222222] border border-[#EFECE6] dark:border-white/10 focus:border-[#FF7A00] outline-none text-xs sm:text-sm text-[#212529] dark:text-[#F1F1F1] placeholder-[#8C857B] dark:placeholder-[#71717A]"
              />
            </div>

            <div className="flex items-center justify-end gap-1 p-1 rounded-xl bg-[#F4F0E8] dark:bg-[#222222] border border-[#EFECE6] dark:border-white/10 self-end sm:self-auto">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer ${
                  viewMode === 'grid'
                    ? 'bg-white dark:bg-[#181818] text-[#FF7A00] shadow-xs'
                    : 'text-[#6C655D] dark:text-[#AAAAAA]'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>การ์ด</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer ${
                  viewMode === 'list'
                    ? 'bg-white dark:bg-[#181818] text-[#FF7A00] shadow-xs'
                    : 'text-[#6C655D] dark:text-[#AAAAAA]'
                }`}
              >
                <List className="w-3.5 h-3.5" />
                <span>รายการ</span>
              </button>
            </div>
          </div>

          <AnimatedTabs
            id={filterTabsId}
            tabs={[
              { id: 'all', label: 'วิดีโอทั้งหมด', badge: counts.all },
              { id: 'ready', label: 'พร้อมรับชม', badge: counts.ready },
              { id: 'processing', label: 'กำลังประมวลผล', badge: counts.processing },
              { id: 'failed', label: 'ล้มเหลว', badge: counts.failed },
              { id: 'subtitled', label: 'มีซับไตเติล', badge: counts.subtitled },
              { id: 'mature', label: 'จำกัดอายุ 18+', badge: counts.mature },
            ]}
            value={filterTab}
            onChange={setFilterTab}
            label="ตัวกรองวิดีโอ"
            variant="pill"
            behavior="filter"
          />
        </div>

        {/* Content Body */}
        {errorMsg && (
          <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs sm:text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <AnimatedTabPanel id={filterTabsId} value={filterTab} behavior="filter">
          {loading && videos.length === 0 ? (
            <div className="py-20 flex flex-col items-center justify-center gap-3 text-[#6C655D] dark:text-[#9A9A9A]">
              <Loader2 className="w-7 h-7 animate-spin text-[#FF7A00]" />
              <span className="text-sm font-medium">กำลังโหลดคลังวิดีโอของคุณ...</span>
            </div>
          ) : filteredVideos.length === 0 ? (
            <div className="rounded-3xl bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 p-12 text-center space-y-3">
              <Film className="w-10 h-10 mx-auto text-[#8C857B] dark:text-[#71717A] opacity-60" />
              <h2 className="text-base font-bold">
                {videos.length === 0 ? 'ยังไม่มีวิดีโอในคลังของคุณ' : 'ไม่พบวิดีโอตามตัวกรองที่เลือก'}
              </h2>
              <p className="text-xs sm:text-sm text-[#6C655D] dark:text-[#9A9A9A]">
                {videos.length === 0
                  ? 'เริ่มต้นอัปโหลดวิดีโอแรกเพื่อประมวลผลสตรีม HLS และซับไตเติล AI'
                  : 'ลองล้างคำค้นหาหรือเปลี่ยนแถบตัวกรองด้านบน'}
              </p>
              {videos.length === 0 ? (
                <Link
                  href="/upload"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#FF7A00] hover:bg-[#E66E00] text-white text-xs font-semibold transition"
                >
                  <Plus className="w-4 h-4" />
                  <span>อัปโหลดวิดีโอ</span>
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setFilterTab('all');
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#F4F0E8] dark:bg-[#222222] text-xs font-semibold hover:bg-[#EFECE6] dark:hover:bg-[#2c2c2c] transition cursor-pointer"
                >
                  <span>แสดงทั้งหมด</span>
                </button>
              )}
            </div>
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-y-4 -mx-2">
              {filteredVideos.map((video) => (
                <StudioVideoCard
                  key={video.id}
                  video={video}
                  session={session}
                  openMenuId={openMenuId}
                  setOpenMenuId={setOpenMenuId}
                  copiedId={copiedId}
                  onCopyLink={handleCopyLink}
                  onRequestDelete={(target) => {
                    setDeleteError('');
                    setDeleteTarget(target);
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredVideos.map((video) => (
                <StudioVideoRow
                  key={video.id}
                  video={video}
                  openMenuId={openMenuId}
                  setOpenMenuId={setOpenMenuId}
                  copiedId={copiedId}
                  onCopyLink={handleCopyLink}
                  onRequestDelete={(target) => {
                    setDeleteError('');
                    setDeleteTarget(target);
                  }}
                />
              ))}
            </div>
          )}
        </AnimatedTabPanel>
      </div>

      <DeleteVideoModal
        isOpen={Boolean(deleteTarget)}
        onClose={() => !isDeleting && setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        isDeleting={isDeleting}
        deleteError={deleteError}
        videoTitle={deleteTarget?.title || deleteTarget?.raw_file_name || ''}
      />
    </div>
  );
}
