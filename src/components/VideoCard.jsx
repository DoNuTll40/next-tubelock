'use client';

import Link from 'next/link';
import { Play, Clock, HardDrive, MoreVertical, Layers, Trash2, Loader2, Copy, X } from 'lucide-react';
import { useState } from 'react';
import { formatResolutionBadge } from '@/lib/videoUtils';

export default function VideoCard({ video, replace = false, compact = false, onDelete = null, half = false }) {
  const [showMenu, setShowMenu] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const handleDelete = async () => {
    try {
      setIsDeleting(true);
      setDeleteError(null);
      const res = await fetch(`/api/videos/${video.id}`, {
        method: 'DELETE',
      });
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

  if (compact) {
    return (
      <div className="flex gap-2.5 group relative select-none items-start p-1.5 -m-1.5 rounded-xl hover:bg-black/[0.04] transition-colors cursor-pointer">
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
            <h4 className="text-[#0F0F0F] text-[14px] font-semibold line-clamp-2 leading-[1.3] group-hover:text-black transition-colors">
              {video.title}
            </h4>
          </Link>
          <span className="text-[#606060] text-[12px] truncate mt-1 hover:text-[#0F0F0F] transition-colors">
            OneDrive Cloud Storage
          </span>
          <div className="flex items-center gap-1 text-[#606060] text-[12px] mt-0.5 truncate">
            <span>{video.views_count ? `${video.views_count.toLocaleString()} ครั้ง` : '270K views'}</span>
            <span>•</span>
            <span>HLS Direct</span>
          </div>
        </div>

        {/* Compact 3-Dots Menu if onDelete is present */}
        {onDelete && (
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setShowMenu(!showMenu)}
              className="p-1 rounded-full hover:bg-[#EFECE6] text-[#8C857B] hover:text-[#212529] transition cursor-pointer"
              title="ตัวเลือกเพิ่มเติม"
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </button>
            {showMenu && (
              <>
                {/* Desktop click-outside backdrop */}
                <div
                  className="hidden sm:block fixed inset-0 z-40"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMenu(false);
                  }}
                />
                {/* Desktop Popover */}
                <div
                  className="hidden sm:flex absolute right-0 top-7 z-50 w-36 bg-white rounded-xl border border-[#EFECE6] shadow-xl p-1 flex-col gap-0.5 text-xs"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setShowMenu(false);
                      setShowDeleteModal(true);
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-rose-50 text-rose-600 font-medium flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                    <span>ลบวิดีโอ</span>
                  </button>
                </div>
                {/* Mobile YouTube Bottom Action Sheet */}
                <div
                  className="sm:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex flex-col justify-end"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMenu(false);
                  }}
                >
                  <div
                    className="bg-white rounded-t-3xl p-4 pb-10 flex flex-col gap-1.5 shadow-2xl border-t border-zinc-100 max-w-lg mx-auto w-full"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="w-10 h-1 bg-zinc-300 rounded-full mx-auto mb-2" />
                    <div className="flex items-center gap-3 px-2 pb-3 border-b border-zinc-100 mb-1">
                      <div className="w-14 aspect-video rounded-lg bg-zinc-900 overflow-hidden shrink-0 relative">
                        {video.thumbnail_url && (
                          <img src={video.thumbnail_url} alt="" className="w-full h-full object-cover" />
                        )}
                      </div>
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="text-xs font-bold text-zinc-900 line-clamp-1">{video.title}</span>
                        <span className="text-[11px] text-zinc-500 truncate">{fileSizeMB} MB • {resBadge}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowMenu(false)}
                        className="p-1.5 rounded-full hover:bg-zinc-100 text-zinc-400 cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowMenu(false);
                        setShowDeleteModal(true);
                      }}
                      className="w-full text-left px-3 py-3 rounded-2xl hover:bg-rose-50 active:bg-rose-100 text-rose-600 font-semibold flex items-center gap-3 text-sm transition cursor-pointer"
                    >
                      <Trash2 className="w-5 h-5 text-rose-500" />
                      <span>ลบวิดีโอ (ถาวร)</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Delete Confirmation Modal for compact mode */}
        {showDeleteModal && (
          <div
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
            onClick={(e) => {
              e.stopPropagation();
              if (!isDeleting) setShowDeleteModal(false);
            }}
          >
            <div
              className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-zinc-100 flex flex-col gap-4 text-left"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-600 shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div className="flex flex-col min-w-0">
                  <h3 className="text-base font-bold text-[#0F0F0F] leading-tight">
                    ลบวิดีโอนี้?
                  </h3>
                  <span className="text-xs text-[#8C857B] truncate">
                    {video.title}
                  </span>
                </div>
              </div>

              <p className="text-xs text-[#606060] leading-relaxed">
                วิดีโอนี้จะถูกลบออกจากฐานข้อมูลและลบไฟล์ทั้งหมดบน <strong className="text-[#0F0F0F]">OneDrive ถาวร</strong> โดยไม่สามารถกู้คืนได้
              </p>

              {deleteError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-600 font-medium">
                  {deleteError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => setShowDeleteModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-[#0F0F0F] bg-zinc-100 hover:bg-zinc-200 disabled:opacity-50 transition cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={handleDelete}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 active:scale-95 disabled:opacity-50 transition flex items-center gap-1.5 cursor-pointer shadow-sm shadow-rose-200"
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
        )}
      </div>
    );
  }

  if (half) {
    return (
      <div className="flex gap-2 group relative select-none items-start p-1.5 -m-1.5 rounded-xl hover:bg-black/[0.04] transition-colors cursor-pointer">
        <Link
          href={`/watch/${video.id}`}
          replace={replace}
          className="relative aspect-video w-[256px] h-[144px] rounded-xl bg-zinc-900 overflow-hidden shrink-0 shadow-2xs group-hover:opacity-95 transition-opacity"
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
            <h4 className="text-[#0F0F0F] text-[14px] font-semibold line-clamp-2 leading-[1.3] group-hover:text-black transition-colors">
              {video.title}
            </h4>
          </Link>
          <span className="text-[#606060] text-[12px] truncate mt-1 hover:text-[#0F0F0F] transition-colors">
            OneDrive Cloud Storage
          </span>
          <div className="flex items-center gap-1 text-[#606060] text-[12px] mt-0.5 truncate">
            <span>{video.views_count ? `${video.views_count.toLocaleString()} ครั้ง` : '270K views'}</span>
            <span>•</span>
            <span>HLS Direct</span>
          </div>
        </div>

        {/* Compact 3-Dots Menu if onDelete is present */}
        {onDelete && (
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setShowMenu(!showMenu)}
              className="p-1 rounded-full hover:bg-[#EFECE6] text-[#8C857B] hover:text-[#212529] transition cursor-pointer"
              title="ตัวเลือกเพิ่มเติม"
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </button>
            {showMenu && (
              <>
                {/* Desktop click-outside backdrop */}
                <div
                  className="hidden sm:block fixed inset-0 z-40"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMenu(false);
                  }}
                />
                {/* Desktop Popover */}
                <div
                  className="hidden sm:flex absolute right-0 top-7 z-50 w-36 bg-white rounded-xl border border-[#EFECE6] shadow-xl p-1 flex-col gap-0.5 text-xs"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setShowMenu(false);
                      setShowDeleteModal(true);
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-rose-50 text-rose-600 font-medium flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                    <span>ลบวิดีโอ</span>
                  </button>
                </div>
                {/* Mobile YouTube Bottom Action Sheet */}
                <div
                  className="sm:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex flex-col justify-end"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMenu(false);
                  }}
                >
                  <div
                    className="bg-white rounded-t-3xl p-4 pb-10 flex flex-col gap-1.5 shadow-2xl border-t border-zinc-100 max-w-lg mx-auto w-full"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="w-10 h-1 bg-zinc-300 rounded-full mx-auto mb-2" />
                    <div className="flex items-center gap-3 px-2 pb-3 border-b border-zinc-100 mb-1">
                      <div className="w-14 aspect-video rounded-lg bg-zinc-900 overflow-hidden shrink-0 relative">
                        {video.thumbnail_url && (
                          <img src={video.thumbnail_url} alt="" className="w-full h-full object-cover" />
                        )}
                      </div>
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="text-xs font-bold text-zinc-900 line-clamp-1">{video.title}</span>
                        <span className="text-[11px] text-zinc-500 truncate">{fileSizeMB} MB • {resBadge}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowMenu(false)}
                        className="p-1.5 rounded-full hover:bg-zinc-100 text-zinc-400 cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowMenu(false);
                        setShowDeleteModal(true);
                      }}
                      className="w-full text-left px-3 py-3 rounded-2xl hover:bg-rose-50 active:bg-rose-100 text-rose-600 font-semibold flex items-center gap-3 text-sm transition cursor-pointer"
                    >
                      <Trash2 className="w-5 h-5 text-rose-500" />
                      <span>ลบวิดีโอ (ถาวร)</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Delete Confirmation Modal for compact mode */}
        {showDeleteModal && (
          <div
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
            onClick={(e) => {
              e.stopPropagation();
              if (!isDeleting) setShowDeleteModal(false);
            }}
          >
            <div
              className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-zinc-100 flex flex-col gap-4 text-left"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-600 shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div className="flex flex-col min-w-0">
                  <h3 className="text-base font-bold text-[#0F0F0F] leading-tight">
                    ลบวิดีโอนี้?
                  </h3>
                  <span className="text-xs text-[#8C857B] truncate">
                    {video.title}
                  </span>
                </div>
              </div>

              <p className="text-xs text-[#606060] leading-relaxed">
                วิดีโอนี้จะถูกลบออกจากฐานข้อมูลและลบไฟล์ทั้งหมดบน <strong className="text-[#0F0F0F]">OneDrive ถาวร</strong> โดยไม่สามารถกู้คืนได้
              </p>

              {deleteError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-600 font-medium">
                  {deleteError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => setShowDeleteModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-[#0F0F0F] bg-zinc-100 hover:bg-zinc-200 disabled:opacity-50 transition cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={handleDelete}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 active:scale-95 disabled:opacity-50 transition flex items-center gap-1.5 cursor-pointer shadow-sm shadow-rose-200"
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
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col group relative select-none">
      <Link
        href={`/watch/${video.id}`}
        replace={replace}
        className="flex flex-col"
      >
        {/* 16:9 Thumbnail Screen */}
        <div className="relative aspect-video w-full rounded-2xl bg-[#1E1B18] overflow-hidden border border-[#EFECE6] shadow-xs">
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

          {/* Top Badges */}
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

          {/* Bottom Duration Badge */}
          {video.duration > 0 && (
            <div className="absolute bottom-2.5 right-2.5 z-10 bg-black/80 text-white text-[11px] font-semibold px-2 py-0.5 rounded-md flex items-center gap-1 border border-white/10 font-mono">
              <Clock className="w-3 h-3 stroke-[2]" />
              {formatDuration(video.duration)}
            </div>
          )}
        </div>
      </Link>

      {/* Video Details Row (YouTube PC & Mobile Layout) */}
      <div className="flex items-start gap-3 pt-3 px-0.5">
        {/* Author / Channel Avatar */}
        <div className="w-9 h-9 rounded-full bg-[#FFF4EB] border border-[#FF7A00]/20 flex items-center justify-center shrink-0 mt-0.5 shadow-xs">
          <Layers className="w-4 h-4 text-[#FF7A00]" />
        </div>

        {/* Info Column */}
        <div className="flex-1 min-w-0 pr-1">
          <Link href={`/watch/${video.id}`} replace={replace}>
            <h3 className="text-sm font-bold text-[#212529] line-clamp-2 leading-snug group-hover:text-[#FF7A00] transition-colors">
              {video.title}
            </h3>
          </Link>

          <div className="flex flex-col text-[12px] text-[#8C857B] mt-1 leading-normal">
            <span className="truncate hover:text-[#212529] transition-colors">
              {video.description ? video.description.replace('สแกนจากโฟลเดอร์ ', '') : 'OneDrive Storage'}
            </span>
            <div className="flex items-center gap-1.5 text-[11px] text-[#8C857B]">
              <span className="font-semibold text-[#FF7A00] uppercase bg-[#FFF4EB] px-1.5 py-0.2 rounded text-[10px]">
                {video.codec ? video.codec.toUpperCase() : 'H264'}
              </span>
              <span>•</span>
              <span className="font-mono">{fileSizeMB} MB</span>
              <span>•</span>
              <span>{video.source_type === 'hls' ? 'HLS Stream' : 'Direct'}</span>
            </div>
          </div>
        </div>

        {/* 3-Dots Menu Button */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowMenu(!showMenu)}
            className="p-1.5 -mr-1 rounded-full hover:bg-[#EFECE6] text-[#8C857B] hover:text-[#212529] transition cursor-pointer"
            title="ตัวเลือกเพิ่มเติม"
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {/* Responsive Menu: Desktop Popover / Mobile Bottom Sheet */}
          {showMenu && (
            <>
              {/* Desktop click-outside backdrop */}
              <div
                className="hidden sm:block fixed inset-0 z-40"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMenu(false);
                }}
              />

              {/* Desktop Dropdown Popover */}
              <div
                className="hidden sm:flex absolute right-0 top-8 z-50 w-44 bg-white rounded-2xl border border-[#EFECE6] shadow-xl p-1.5 flex-col gap-1 text-xs"
                onClick={(e) => e.stopPropagation()}
              >
                <Link
                  href={`/watch/${video.id}`}
                  className="px-3 py-2 rounded-xl hover:bg-[#FBF9F5] text-[#212529] font-medium flex items-center gap-2"
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
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-[#FBF9F5] text-[#212529] font-medium flex items-center gap-2 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5 text-zinc-500" />
                  <span>คัดลอกลิงก์</span>
                </button>

                <div className="h-px bg-zinc-100 my-0.5" />

                <button
                  type="button"
                  onClick={() => {
                    setShowMenu(false);
                    setShowDeleteModal(true);
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-rose-50 text-rose-600 font-medium flex items-center gap-2 transition cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                  <span>ลบวิดีโอ</span>
                </button>
              </div>

              {/* Mobile YouTube Bottom Action Sheet */}
              <div
                className="sm:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex flex-col justify-end"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMenu(false);
                }}
              >
                <div
                  className="bg-white rounded-t-3xl p-4 pb-10 flex flex-col gap-1.5 shadow-2xl border-t border-zinc-100 max-w-lg mx-auto w-full"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Top drag handle */}
                  <div className="w-10 h-1 bg-zinc-300 rounded-full mx-auto mb-2" />

                  {/* Video preview row */}
                  <div className="flex items-center gap-3 px-2 pb-3 border-b border-zinc-100 mb-1">
                    <div className="w-14 aspect-video rounded-lg bg-zinc-900 overflow-hidden shrink-0 relative">
                      {video.thumbnail_url && (
                        <img src={video.thumbnail_url} alt="" className="w-full h-full object-cover" />
                      )}
                    </div>
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-xs font-bold text-zinc-900 line-clamp-1">{video.title}</span>
                      <span className="text-[11px] text-zinc-500 truncate">{fileSizeMB} MB • {resBadge}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowMenu(false)}
                      className="p-1.5 rounded-full hover:bg-zinc-100 text-zinc-400 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Actions */}
                  <Link
                    href={`/watch/${video.id}`}
                    className="px-3 py-3 rounded-2xl hover:bg-zinc-50 active:bg-zinc-100 text-zinc-800 font-medium flex items-center gap-3 text-sm"
                  >
                    <Play className="w-5 h-5 text-[#FF7A00]" />
                    <span>เล่นวิดีโอ</span>
                  </Link>

                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/watch/${video.id}`);
                      setShowMenu(false);
                    }}
                    className="w-full text-left px-3 py-3 rounded-2xl hover:bg-zinc-50 active:bg-zinc-100 text-zinc-800 font-medium flex items-center gap-3 text-sm cursor-pointer"
                  >
                    <Copy className="w-5 h-5 text-zinc-500" />
                    <span>คัดลอกลิงก์</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowMenu(false);
                      setShowDeleteModal(true);
                    }}
                    className="w-full text-left px-3 py-3 rounded-2xl hover:bg-rose-50 active:bg-rose-100 text-rose-600 font-semibold flex items-center gap-3 text-sm transition cursor-pointer"
                  >
                    <Trash2 className="w-5 h-5 text-rose-500" />
                    <span>ลบวิดีโอ (ถาวร)</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={(e) => {
            e.stopPropagation();
            if (!isDeleting) setShowDeleteModal(false);
          }}
        >
          <div
            className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-zinc-100 flex flex-col gap-4 text-left"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-600 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="flex flex-col min-w-0">
                <h3 className="text-base font-bold text-[#0F0F0F] leading-tight">
                  ลบวิดีโอนี้?
                </h3>
                <span className="text-xs text-[#8C857B] truncate">
                  {video.title}
                </span>
              </div>
            </div>

            <p className="text-xs text-[#606060] leading-relaxed">
              วิดีโอนี้จะถูกลบออกจากฐานข้อมูลและลบไฟล์ทั้งหมดบน <strong className="text-[#0F0F0F]">OneDrive ถาวร</strong> โดยไม่สามารถกู้คืนได้
            </p>

            {deleteError && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-600 font-medium">
                {deleteError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setShowDeleteModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-[#0F0F0F] bg-zinc-100 hover:bg-zinc-200 disabled:opacity-50 transition cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleDelete}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 active:scale-95 disabled:opacity-50 transition flex items-center gap-1.5 cursor-pointer shadow-sm shadow-rose-200"
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
      )}
    </div>
  );
}
