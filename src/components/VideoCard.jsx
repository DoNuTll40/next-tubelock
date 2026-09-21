'use client';

import Link from 'next/link';
import {
  Play,
  Clock,
  MoreVertical,
  Layers,
  Trash2,
  Loader2,
  Copy,
  ListPlus,
  Bookmark,
  Share2
} from 'lucide-react';
import { useState, useRef } from 'react';
import { formatResolutionBadge } from '@/lib/videoUtils';

// Module-level Set: track which video IDs are already pre-warmed this session
const preWarmedIds = new Set();

export default function VideoCard({
  video,
  replace = false,
  compact = false,
  half = false,
  onDelete = null,
}) {
  const [showMenu, setShowMenu] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const hoverTimerRef = useRef(null);

  // Pre-warm: ดึง source URL ล่วงหน้าเงียบๆ เมื่อ user hover card
  // ทำให้ server cache warm → พอกด play จะโหลดแค่ ~30ms แทน ~11s
  const handlePreWarm = () => {
    if (!video?.id || preWarmedIds.has(video.id)) return;
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      preWarmedIds.add(video.id);
      fetch(`/api/videos/${video.id}/source`, {
        method: 'GET',
        priority: 'low',
        cache: 'no-store',
      }).catch(() => {
        // Silent fail — pre-warm เป็นแค่ optimization ไม่ใช่ critical path
        preWarmedIds.delete(video.id);
      });
    }, 120); // debounce 120ms กันยิง hover แวบเดียว
  };

  const handlePreWarmCancel = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
  };

  const handleDelete = async () => {
    try {
      setIsDeleting(true);
      setDeleteError(null);
      const res = await fetch(`/api/videos/${video.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'ไม่สามารถลบวิดีโอได้');
      }
      setShowDeleteModal(false);
      onDelete?.(video.id);
    } catch (err) {
      console.error('Delete video error:', err);
      setDeleteError(err.message || 'เกิดข้อผิดพลาดในการลบ');
    } finally {
      setIsDeleting(false);
    }
  };

  const formatDuration = (sec) => {
    if (!sec) return '00:00';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const fileSizeMB = (Number(video.file_size_bytes || 0) / (1024 * 1024)).toFixed(1);
  const resBadge = formatResolutionBadge(video.resolution);
  const effectiveThumbnail = video.thumbnail_url || (video.id ? `/streams/stream_vid_${video.id}/poster.jpg` : null);
  const is4K = resBadge === '4K';
  const is2K = resBadge === '2K';

  // ==========================================
  // 1. โหมด HALF (ปุ่ม 3 จุดอยู่มุมล่างขวา แสดงเฉพาะตอน Hover)
  // ==========================================
  if (half) {
    return (
      <div
        className="flex gap-3 group relative select-none items-stretch p-1.5 -m-1.5 rounded-xl hover:bg-black/[0.04] dark:hover:bg-white/5 transition-colors cursor-pointer"
        onMouseEnter={handlePreWarm}
        onMouseLeave={handlePreWarmCancel}
        onFocus={handlePreWarm}
      >
        {/* Thumbnail ฝั่งซ้าย */}
        <Link
          href={`/watch/${video.id}`}
          replace={replace}
          className="relative aspect-video w-[204.8px] h-[115.2px] xl:w-[294.4px] xl:h-[165.6px] rounded-xl bg-zinc-900 overflow-hidden shrink-0 shadow-2xs group-hover:opacity-95 transition-opacity"
        >
          {effectiveThumbnail && !imgError ? (
            <img
              src={effectiveThumbnail}
              alt={video.title}
              onError={() => setImgError(true)}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-zinc-900 text-zinc-500">
              <Play className="w-6 h-6 fill-current opacity-60" />
            </div>
          )}

          {video.duration > 0 && (
            <div className="absolute bottom-1 right-1 z-10 bg-black/80 text-white text-[11px] font-semibold px-1.5 py-0.5 rounded font-mono">
              {formatDuration(video.duration)}
            </div>
          )}
        </Link>

        {/* คอลัมน์ข้อมูลฝั่งขวา: relative เพื่อใช้วางปุ่มมุมล่างขวา */}
        <div className="flex-1 min-w-0 pr-8 py-0.5 flex flex-col justify-start relative">
          {/* 1. Title */}
          <Link href={`/watch/${video.id}`} replace={replace}>
            <h4 className="text-[#0F0F0F] dark:text-[#F1F1F1] text-[15px] font-semibold line-clamp-2 leading-[1.3] group-hover:text-black dark:group-hover:text-white transition-colors">
              {video.title}
            </h4>
          </Link>

          {/* 2. OneDrive Cloud Storage (อยู่ติดกับ Title) */}
          <span className="text-[#606060] dark:text-[#AAAAAA] text-[12px] truncate block mt-1 hover:text-[#0F0F0F] dark:hover:text-[#F1F1F1] transition-colors">
            OneDrive Cloud Storage
          </span>

          {/* 3. ยอดวิว / สตรีม (อยู่ติดด้านล่างต่อลงมาทันที) */}
          <div className="flex items-center gap-1.5 text-[#606060] dark:text-[#888888] text-[12px] mt-1 truncate">
            <span>{video.views_count ? `${video.views_count.toLocaleString()} views` : '270K views'}</span>
            <span>•</span>
            <span>HLS</span>
          </div>

          {/* 4. เฉพาะปุ่ม 3 จุด เมนู: ตรึงไว้ที่มุมล่างขวาสุด และแสดงเฉพาะตอน Hover ตัวการ์ด */}
          <div className="absolute right-0 bottom-0">
            <VideoMenu
              video={video}
              variant="half"
              showMenu={showMenu}
              setShowMenu={setShowMenu}
              onOpenDeleteModal={() => setShowDeleteModal(true)}
              canDelete={Boolean(onDelete)}
            />
          </div>
        </div>

        <DeleteModal
          isOpen={showDeleteModal}
          onClose={() => setShowDeleteModal(false)}
          onConfirm={handleDelete}
          isDeleting={isDeleting}
          deleteError={deleteError}
          videoTitle={video.title}
        />
      </div>
    );
  }

  // ==========================================
  // 2. โหมด COMPACT (แบบเดิม กะทัดรัด)
  // ==========================================
  if (compact) {
    return (
      <div
        className="flex gap-2.5 group relative select-none items-start p-1.5 -m-1.5 rounded-xl hover:bg-black/[0.04] dark:hover:bg-white/5 transition-colors cursor-pointer"
        onMouseEnter={handlePreWarm}
        onMouseLeave={handlePreWarmCancel}
        onFocus={handlePreWarm}
      >
        <Link
          href={`/watch/${video.id}`}
          replace={replace}
          className="relative aspect-video w-[168px] rounded-xl bg-zinc-900 overflow-hidden shrink-0 shadow-2xs group-hover:opacity-95 transition-opacity"
        >
          {effectiveThumbnail && !imgError ? (
            <img
              src={effectiveThumbnail}
              alt={video.title}
              onError={() => setImgError(true)}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-zinc-900 text-zinc-500">
              <Play className="w-6 h-6 fill-current opacity-60" />
            </div>
          )}

          {video.duration > 0 && (
            <div className="absolute bottom-1 right-1 z-10 bg-black/80 text-white text-[11px] font-semibold px-1 py-0.2 rounded font-mono">
              {formatDuration(video.duration)}
            </div>
          )}
        </Link>

        <div className="flex-1 min-w-0 pr-1 flex flex-col justify-start">
          <Link href={`/watch/${video.id}`} replace={replace}>
            <h4 className="text-[#0F0F0F] dark:text-[#F1F1F1] text-[14px] font-semibold line-clamp-2 leading-[1.3] group-hover:text-black dark:group-hover:text-white transition-colors">
              {video.title}
            </h4>
          </Link>
          <span className="text-[#606060] dark:text-[#AAAAAA] text-[12px] truncate mt-1 hover:text-[#0F0F0F] dark:hover:text-[#F1F1F1] transition-colors">
            OneDrive Cloud Storage
          </span>
          <div className="flex items-center gap-1 text-[#606060] dark:text-[#888888] text-[12px] mt-0.5 truncate">
            <span>{video.views_count ? `${video.views_count.toLocaleString()} ครั้ง` : '270K views'}</span>
            <span>•</span>
            <span>HLS Direct</span>
          </div>
        </div>

        {onDelete && (
          <VideoMenu
            video={video}
            variant="compact"
            showMenu={showMenu}
            setShowMenu={setShowMenu}
            onOpenDeleteModal={() => setShowDeleteModal(true)}
            canDelete={Boolean(onDelete)}
          />
        )}

        <DeleteModal
          isOpen={showDeleteModal}
          onClose={() => setShowDeleteModal(false)}
          onConfirm={handleDelete}
          isDeleting={isDeleting}
          deleteError={deleteError}
          videoTitle={video.title}
        />
      </div>
    );
  }

  // ==========================================
  // 3. โหมดปกติ (Card Grid)
  // ==========================================
  return (
    <div
      className="flex flex-col group relative select-none"
      onMouseEnter={handlePreWarm}
      onMouseLeave={handlePreWarmCancel}
      onFocus={handlePreWarm}
    >
      <Link href={`/watch/${video.id}`} replace={replace} className="flex flex-col">
        <div className="relative aspect-video w-full rounded-2xl bg-[#1E1B18] overflow-hidden border border-[#EFECE6] dark:border-white/10 shadow-xs">
          {video.thumbnail_url && !imgError ? (
            <>
              <img
                src={video.thumbnail_url}
                alt=""
                aria-hidden="true"
                onError={() => setImgError(true)}
                className="absolute inset-0 w-full h-full object-cover blur-sm scale-110 opacity-30 select-none pointer-events-none"
              />
              <img
                src={video.thumbnail_url}
                alt={video.title}
                onError={() => setImgError(true)}
                className="relative z-10 w-full h-full object-contain drop-shadow-sm"
                loading="lazy"
              />
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-[#151413]">
              <Play className="w-8 h-8 text-[#C4BEB4] stroke-[1.5]" />
            </div>
          )}

          {/* Badges */}
          <div className="absolute top-2.5 left-2.5 z-10 flex gap-1 items-center">
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-md border backdrop-blur-md uppercase tracking-wide ${is4K
                ? 'bg-[#FF7A00] text-white border-[#FF7A00] shadow-xs'
                : is2K
                  ? 'bg-amber-500/90 text-white border-amber-400/50'
                  : 'bg-black/75 text-white border-white/10 font-semibold'
                }`}
            >
              {resBadge}
            </span>
            {Number(video.fps) > 0 && (
              <span className="bg-black/75 backdrop-blur-md text-zinc-200 text-[10px] font-medium px-1.5 py-0.5 rounded-md border border-white/10 font-mono">
                {Number(video.fps).toFixed(0)} fps
              </span>
            )}
          </div>

          {video.duration > 0 && (
            <div className="absolute bottom-2.5 right-2.5 z-10 bg-black/80 text-white text-[11px] font-semibold px-2 py-0.5 rounded-md flex items-center gap-1 border border-white/10 font-mono">
              <Clock className="w-3 h-3 stroke-[2]" />
              {formatDuration(video.duration)}
            </div>
          )}
        </div>
      </Link>

      <div className="flex items-start gap-3 pt-3 px-0.5">
        <div className="w-9 h-9 rounded-full bg-[#FFF4EB] dark:bg-[#FF7A00]/15 border border-[#FF7A00]/20 flex items-center justify-center shrink-0 mt-0.5 shadow-xs">
          <Layers className="w-4 h-4 text-[#FF7A00]" />
        </div>

        <div className="flex-1 min-w-0 pr-1">
          <Link href={`/watch/${video.id}`} replace={replace}>
            <h3 className="text-sm font-bold text-[#212529] dark:text-[#F1F1F1] line-clamp-2 leading-snug group-hover:text-[#FF7A00] transition-colors">
              {video.title}
            </h3>
          </Link>

          <div className="flex flex-col text-[12px] text-[#8C857B] dark:text-[#AAAAAA] mt-1 leading-normal">
            <span className="truncate hover:text-[#212529] dark:hover:text-[#F1F1F1] transition-colors">
              {video.description ? video.description.replace('สแกนจากโฟลเดอร์ ', '') : 'OneDrive Storage'}
            </span>
            <div className="flex items-center gap-1.5 text-[11px] text-[#8C857B] dark:text-[#888888]">
              <span className="font-semibold text-[#FF7A00] uppercase bg-[#FFF4EB] dark:bg-[#FF7A00]/15 px-1.5 py-0.2 rounded text-[10px]">
                {video.codec ? video.codec.toUpperCase() : 'H264'}
              </span>
              <span>•</span>
              <span className="font-mono">{fileSizeMB} MB</span>
              <span>•</span>
              <span>{video.source_type === 'hls' ? 'HLS Stream' : 'Direct'}</span>
            </div>
          </div>
        </div>

        <VideoMenu
          video={video}
          variant="grid"
          showMenu={showMenu}
          setShowMenu={setShowMenu}
          onOpenDeleteModal={() => setShowDeleteModal(true)}
          canDelete={Boolean(onDelete)}
        />
      </div>

      <DeleteModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
        isDeleting={isDeleting}
        deleteError={deleteError}
        videoTitle={video.title}
      />
    </div>
  );
}

// ==========================================
// Sub-component: VideoMenu
// ==========================================
function VideoMenu({
  video,
  variant = 'compact', // 'half' | 'compact' | 'grid'
  showMenu,
  setShowMenu,
  onOpenDeleteModal,
  canDelete = false,
}) {
  const isHalf = variant === 'half';

  return (
    <div className="relative shrink-0">
      {/* ซ่อนปุ่มไว้เป็นค่าเริ่มต้น และแสดงเมื่อนำเมาส์มาวางบน Card (group-hover:opacity-100) */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setShowMenu(!showMenu);
        }}
        className={`p-1.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 text-[#8C857B] dark:text-[#AAAAAA] hover:text-[#212529] dark:hover:text-[#F1F1F1] transition-all cursor-pointer ${showMenu ? 'opacity-100 bg-black/10 dark:bg-white/10' : 'opacity-0 group-hover:opacity-100'
          }`}
        title="ตัวเลือกเพิ่มเติม"
      >
        <MoreVertical className={variant === 'compact' ? 'w-4 h-4' : 'w-6 h-6'} />
      </button>

      {showMenu && (
        <>
          {/* Backdrop ดักคลิกนอกเมนูเพื่อปิด */}
          <div
            className="fixed inset-0 z-40 cursor-default"
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(false);
            }}
          />

          {/* ------------------------------------------------------------- */}
          {/* 1. เมนู HALF (ลอยจากมุมล่าง ขนาดใหญ่ สไตล์ YouTube)            */}
          {/* ------------------------------------------------------------- */}
          {isHalf ? (
            <div
              className="absolute right-0 bottom-full mb-2 z-50 w-64 bg-[#282828] text-[#F1F1F1] rounded-2xl shadow-2xl border border-white/10 py-2 flex flex-col text-[14px] backdrop-blur-md animate-in fade-in zoom-in-95 duration-100 cursor-default select-none"
              onClick={(e) => e.stopPropagation()}
            >
              <Link
                href={`/watch/${video.id}`}
                className="w-full px-4 py-2.5 hover:bg-white/10 flex items-center gap-3.5 transition-colors"
                onClick={() => setShowMenu(false)}
              >
                <Play className="w-5 h-5 text-zinc-300 stroke-[1.8]" />
                <span>เล่นวิดีโอ</span>
              </Link>

              <button
                type="button"
                className="w-full text-left px-4 py-2.5 hover:bg-white/10 flex items-center gap-3.5 transition-colors cursor-pointer"
                onClick={() => setShowMenu(false)}
              >
                <ListPlus className="w-5 h-5 text-zinc-300 stroke-[1.8]" />
                <span>เพิ่มลงในคิว</span>
              </button>

              <button
                type="button"
                className="w-full text-left px-4 py-2.5 hover:bg-white/10 flex items-center gap-3.5 transition-colors cursor-pointer"
                onClick={() => setShowMenu(false)}
              >
                <Clock className="w-5 h-5 text-zinc-300 stroke-[1.8]" />
                <span>บันทึกไปยังดูภายหลัง</span>
              </button>

              <button
                type="button"
                className="w-full text-left px-4 py-2.5 hover:bg-white/10 flex items-center gap-3.5 transition-colors cursor-pointer"
                onClick={() => setShowMenu(false)}
              >
                <Bookmark className="w-5 h-5 text-zinc-300 stroke-[1.8]" />
                <span>บันทึกไปยังเพลย์ลิสต์</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(`${window.location.origin}/watch/${video.id}`);
                  setShowMenu(false);
                }}
                className="w-full text-left px-4 py-2.5 hover:bg-white/10 flex items-center gap-3.5 transition-colors cursor-pointer"
              >
                <Share2 className="w-5 h-5 text-zinc-300 stroke-[1.8]" />
                <span>แชร์ / คัดลอกลิงก์</span>
              </button>

              {canDelete && (
                <>
                  <div className="h-px bg-white/10 my-1.5" />
                  <button
                    type="button"
                    onClick={() => {
                      setShowMenu(false);
                      onOpenDeleteModal();
                    }}
                    className="w-full text-left px-4 py-2.5 hover:bg-rose-500/15 text-rose-400 flex items-center gap-3.5 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-5 h-5 text-rose-400 stroke-[1.8]" />
                    <span>ลบวิดีโอ</span>
                  </button>
                </>
              )}
            </div>
          ) : (
            /* ------------------------------------------------------------- */
            /* 2. เมนู COMPACT / GRID (เมนูกะทัดรัดแบบเดิม)                     */
            /* ------------------------------------------------------------- */
            <div
              className="absolute right-0 top-full mt-1 z-50 w-40 bg-[#1c1c1c] text-[#F1F1F1] rounded-xl border border-white/10 shadow-2xl p-1.5 flex flex-col gap-0.5 text-xs animate-in fade-in zoom-in-95 duration-100 cursor-default select-none"
              onClick={(e) => e.stopPropagation()}
            >
              <Link
                href={`/watch/${video.id}`}
                className="w-full px-2.5 py-2 rounded-lg hover:bg-white/10 flex items-center gap-2 text-zinc-200 transition-colors"
                onClick={() => setShowMenu(false)}
              >
                <Play className="w-3.5 h-3.5 text-[#FF7A00]" />
                <span>เล่นวิดีโอ</span>
              </Link>

              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(`${window.location.origin}/watch/${video.id}`);
                  setShowMenu(false);
                }}
                className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-white/10 flex items-center gap-2 text-zinc-300 transition-colors cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5 text-zinc-400" />
                <span>คัดลอกลิงก์</span>
              </button>

              {canDelete && (
                <>
                  <div className="h-px bg-white/10 my-0.5" />
                  <button
                    type="button"
                    onClick={() => {
                      setShowMenu(false);
                      onOpenDeleteModal();
                    }}
                    className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-rose-950/40 text-rose-400 flex items-center gap-2 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                    <span>ลบวิดีโอ</span>
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ==========================================
// Sub-component: Delete Confirmation Modal
// ==========================================
function DeleteModal({ isOpen, onClose, onConfirm, isDeleting, deleteError, videoTitle }) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={(e) => {
        e.stopPropagation();
        if (!isDeleting) onClose();
      }}
    >
      <div
        className="bg-white dark:bg-[#181818] rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-zinc-100 dark:border-white/10 flex flex-col gap-4 text-left"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-900/50 flex items-center justify-center text-rose-600 dark:text-rose-400 shrink-0">
            <Trash2 className="w-5 h-5" />
          </div>
          <div className="flex flex-col min-w-0">
            <h3 className="text-base font-bold text-[#0F0F0F] dark:text-[#F1F1F1] leading-tight">
              ลบวิดีโอนี้?
            </h3>
            <span className="text-xs text-[#8C857B] dark:text-[#AAAAAA] truncate">{videoTitle}</span>
          </div>
        </div>

        <p className="text-xs text-[#606060] dark:text-[#AAAAAA] leading-relaxed">
          วิดีโอนี้จะถูกลบออกจากฐานข้อมูลและลบไฟล์ทั้งหมดบน{' '}
          <strong className="text-[#0F0F0F] dark:text-[#F1F1F1]">OneDrive ถาวร</strong> โดยไม่สามารถกู้คืนได้
        </p>

        {deleteError && (
          <div className="p-2.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 rounded-xl text-xs text-rose-600 dark:text-rose-400 font-medium">
            {deleteError}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            disabled={isDeleting}
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-[#0F0F0F] dark:text-[#F1F1F1] bg-zinc-100 dark:bg-white/10 hover:bg-zinc-200 dark:hover:bg-white/15 disabled:opacity-50 transition cursor-pointer"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            disabled={isDeleting}
            onClick={onConfirm}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 active:scale-95 disabled:opacity-50 transition flex items-center gap-1.5 cursor-pointer shadow-sm shadow-rose-200 dark:shadow-none"
          >
            {isDeleting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>กำลังลบ...</span>
              </>
            ) : (
              <>
                <Trash2 className="w-3.5 h-3.5" />
                <span>ยืนยันการลบ</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}