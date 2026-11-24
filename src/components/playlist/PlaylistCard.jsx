'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Globe, Link2, ListVideo, Lock, LockKeyhole, MoreVertical, Pencil, Play, Trash2 } from 'lucide-react';
import { extractDominantColor } from '@/lib/colorExtractor';
import { prewarmVideoSourceClient } from '@/lib/playbackResolver';
import { usePosterPreference } from '@/lib/usePosterPreference';
import { RESTRICTED_POSTER } from '@/lib/videoUtils';

const visibilityOptions = {
  private: { icon: Lock, label: 'ส่วนตัว' },
  unlisted: { icon: Link2, label: 'ไม่แสดงในรายการ' },
  public: { icon: Globe, label: 'สาธารณะ' },
};
const updatedDate = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeZone: 'Asia/Bangkok' });
const menuItem = 'flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium hover:bg-[#F4F0E8] dark:hover:bg-white/10';
const TUBELOCK_ORANGE_CARD_THEME = {
  '--stack-top-light': 'hsl(28, 42%, 82%)',
  '--stack-mid-light': 'hsl(28, 52%, 68%)',
  '--stack-top-dark': 'hsl(28, 42%, 24%)',
  '--stack-mid-dark': 'hsl(28, 48%, 38%)',
  '--hover-tint-light': 'hsla(28, 85%, 38%, 0.09)',
  '--hover-tint-dark': 'hsla(28, 85%, 58%, 0.18)',
};

export function PlaylistVisibility({ visibility }) {
  const { icon: Icon, label } = visibilityOptions[visibility] ?? visibilityOptions.private;
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {label}
    </span>
  );
}

export function PlaylistCover({ playlist, className = '', onLoad, children }) {
  const mature = Boolean(playlist.preview_is_mature);
  const allow18Plus = usePosterPreference(mature);
  const coverVideoId = playlist.cover_video_id || playlist.first_video_id || null;
  const isMasked = mature && !allow18Plus;
  const thumbnail = mature
    ? (allow18Plus && coverVideoId ? `/api/videos/${coverVideoId}/poster` : RESTRICTED_POSTER)
    : playlist.preview_thumbnail;
  const [failedCorsSource, setFailedCorsSource] = useState(null);
  const sampleColors = Boolean(onLoad && !isMasked && failedCorsSource !== thumbnail);
  const imgRef = useRef(null);
  const onLoadRef = useRef(onLoad);

  useEffect(() => {
    onLoadRef.current = onLoad;
  }, [onLoad]);

  useEffect(() => {
    if (!sampleColors) return;
    const raf = requestAnimationFrame(() => {
      const el = imgRef.current;
      if (el && el.complete && el.naturalWidth > 0) {
        onLoadRef.current?.({ currentTarget: el });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [sampleColors, thumbnail]);

  return (
    <div className={`relative isolate flex aspect-video w-full items-center justify-center overflow-hidden bg-[#EFECE6] dark:bg-[#222222] ${className}`}>
      {thumbnail ? (
        <Image
          ref={imgRef}
          key={sampleColors ? 'sample' : 'display'}
          src={thumbnail}
          alt=""
          fill
          unoptimized
          className="object-cover"
          crossOrigin={sampleColors ? 'anonymous' : undefined}
          onLoad={sampleColors ? onLoad : undefined}
          onError={sampleColors ? () => setFailedCorsSource(thumbnail) : undefined}
        />
      ) : (
        <ListVideo className="size-12 text-[#8C857B] dark:text-[#AAAAAA]" aria-hidden="true" />
      )}
      {isMasked && (
        <span className="absolute left-2 top-2 z-10 inline-flex items-center gap-1.5 rounded-md bg-black/80 px-2 py-1 text-xs font-semibold text-white">
          <LockKeyhole className="size-3.5" aria-hidden="true" />
          เนื้อหาจำกัดอายุ 18+
        </span>
      )}
      {children}
    </div>
  );
}

export default function PlaylistCard({ playlist, onCopyLink, onEdit, onDelete }) {
  const menuId = useId();
  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [coverColor, setCoverColor] = useState(null);
  const listKey = encodeURIComponent(playlist.route_key);
  const detailHref = `/playlist/${listKey}`;
  const playable = playlist.first_video_slug && (playlist.first_video_status == null || playlist.first_video_status === 'READY');
  const watchHref = playable ? `/watch/${playlist.first_video_slug}?list=${listKey}&index=1` : null;
  const coverAction = watchHref ? 'เล่นทั้งหมดใน' : 'ดูเพลย์ลิสต์';
  const updatedAt = Date.parse(playlist.updated_at);
  const mature = Boolean(playlist.preview_is_mature);
  const allow18Plus = usePosterPreference(mature);
  const coverVideoId = playlist.cover_video_id || playlist.first_video_id || null;
  const isMasked = mature && !allow18Plus;
  const tintSource = mature
    ? (allow18Plus && coverVideoId ? `/api/videos/${coverVideoId}/poster` : null)
    : (playlist.preview_thumbnail || null);
  const activeColor = tintSource && coverColor?.src === tintSource ? coverColor.color : null;

  useEffect(() => {
    if (!isMenuOpen) return;
    function closeOnOutsideClick(event) {
      if (!menuRef.current?.contains(event.target)) setIsMenuOpen(false);
    }
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [isMenuOpen]);

  function prewarm() {
    if (watchHref && playlist.first_video_id) {
      prewarmVideoSourceClient(playlist.first_video_id, { immediate: true });
    }
  }

  function runMenuAction(action) {
    setIsMenuOpen(false);
    triggerRef.current?.focus();
    action();
  }

  const cardThemeStyle = activeColor
    ? {
        '--stack-top-light': activeColor.stackTopLight,
        '--stack-mid-light': activeColor.stackMidLight,
        '--stack-top-dark': activeColor.stackTopDark,
        '--stack-mid-dark': activeColor.stackMidDark,
        '--hover-tint-light': activeColor.lightBg,
        '--hover-tint-dark': activeColor.darkBg,
      }
    : isMasked
      ? TUBELOCK_ORANGE_CARD_THEME
      : undefined;

  return (
    <article
      className={`min-w-0 rounded-2xl p-2 -m-2 yt-card-hover ${isMenuOpen ? 'relative z-30' : ''}`}
      style={cardThemeStyle}
    >
      <Link
        href={watchHref ?? detailHref}
        prefetch={false}
        onClick={prewarm}
        aria-label={`${coverAction} ${playlist.title}, วิดีโอ ${playlist.item_count} รายการ${playlist.preview_is_mature ? ', เนื้อหาจำกัดอายุ 18+' : ''}`}
        className="group block rounded-2xl"
      >
        <div
          aria-hidden="true"
          className="mx-6 mb-[1.5px] h-[4px] rounded-t-lg bg-[var(--stack-top-light,#DDD7CE)] transition-colors duration-300 dark:bg-[var(--stack-top-dark,#2E2E2E)]"
        />
        <div
          aria-hidden="true"
          className="mx-3 mb-[2px] h-[5px] rounded-t-lg bg-[var(--stack-mid-light,#C6BEB3)] transition-colors duration-300 dark:bg-[var(--stack-mid-dark,#484848)]"
        />
        <PlaylistCover
          playlist={playlist}
          className="rounded-2xl"
          onLoad={tintSource ? ({ currentTarget }) => {
            const color = extractDominantColor(currentTarget);
            if (color) {
              setCoverColor((prev) => (
                prev?.src === tintSource && prev?.color?.rgb === color.rgb
                  ? prev
                  : { src: tintSource, color }
              ));
            }
          } : undefined}
        >
          {watchHref && (
            <span className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 text-sm font-bold text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
              <Play className="size-4 fill-current" aria-hidden="true" />
              เล่นทั้งหมด
            </span>
          )}
          <span className="absolute bottom-2 right-2 z-10 inline-flex items-center gap-1.5 rounded-md bg-black/80 px-2 py-1 font-mono text-xs font-semibold text-white">
            <ListVideo aria-hidden="true" className="size-3.5" />
            วิดีโอ {playlist.item_count} รายการ
          </span>
        </PlaylistCover>
      </Link>
      <div className="flex items-start justify-between gap-2 pt-2.5">
        <div className="min-w-0 space-y-1">
          <Link
            href={detailHref}
            prefetch={false}
            className="block truncate text-sm font-bold hover:text-[#9E4700] dark:hover:text-[#FF9E40]"
          >
            {playlist.title}
          </Link>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#6C655D] dark:text-[#AAAAAA]">
            <PlaylistVisibility visibility={playlist.visibility} />
            <span aria-hidden="true">•</span>
            <span>เพลย์ลิสต์</span>
          </div>
          {Number.isFinite(updatedAt) && (
            <p className="text-xs text-[#6C655D] dark:text-[#AAAAAA]">
              อัปเดต <time dateTime={new Date(updatedAt).toISOString()}>{updatedDate.format(updatedAt)}</time>
            </p>
          )}
        </div>
        <div
          ref={menuRef}
          className="relative shrink-0"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setIsMenuOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && isMenuOpen) {
              event.stopPropagation();
              setIsMenuOpen(false);
              triggerRef.current?.focus();
            }
          }}
        >
          <button
            ref={triggerRef}
            type="button"
            aria-expanded={isMenuOpen}
            aria-controls={isMenuOpen ? menuId : undefined}
            aria-label={`จัดการเพลย์ลิสต์ ${playlist.title}`}
            onClick={() => {
              triggerRef.current?.focus();
              setIsMenuOpen((open) => !open);
            }}
            className="grid size-8 cursor-pointer place-items-center rounded-full hover:bg-[#F4F0E8] dark:hover:bg-white/10"
          >
            <MoreVertical className="size-4" aria-hidden="true" />
          </button>
          {isMenuOpen && (
            <div id={menuId} className="absolute right-0 z-20 mt-1 w-48 rounded-xl border border-[#EFECE6] bg-white p-1 shadow-xl dark:border-white/10 dark:bg-[#181818]">
              {watchHref ? (
                <Link
                  href={watchHref}
                  prefetch={false}
                  onClick={() => runMenuAction(prewarm)}
                  className={menuItem}
                >
                  <Play className="size-4 shrink-0" aria-hidden="true" />
                  เล่นทั้งหมด
                </Link>
              ) : (
                <button type="button" disabled className={`${menuItem} disabled:cursor-default disabled:opacity-50`}>
                  <Play className="size-4 shrink-0" aria-hidden="true" />
                  เล่นทั้งหมด
                </button>
              )}
              <Link href={detailHref} prefetch={false} onClick={() => setIsMenuOpen(false)} className={menuItem}>
                <ListVideo className="size-4 shrink-0" aria-hidden="true" />
                ดูทั้งเพลย์ลิสต์
              </Link>
              <button type="button" onClick={() => runMenuAction(() => onCopyLink(detailHref))} className={menuItem}>
                <Link2 className="size-4 shrink-0" aria-hidden="true" />
                คัดลอกลิงก์
              </button>
              {playlist.kind === 'normal' && (
                <>
                  <button type="button" onClick={() => runMenuAction(onEdit)} className={menuItem}>
                    <Pencil className="size-4 shrink-0" aria-hidden="true" />
                    แก้ไขรายละเอียด
                  </button>
                  <button type="button" onClick={() => runMenuAction(onDelete)} className={`${menuItem} text-rose-600 dark:text-rose-400`}>
                    <Trash2 className="size-4 shrink-0" aria-hidden="true" />
                    ลบเพลย์ลิสต์
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <Link href={detailHref} prefetch={false} className="mt-1.5 inline-block text-xs font-semibold hover:text-[#9E4700] dark:hover:text-[#FF9E40]">
        ดูทั้งเพลย์ลิสต์
      </Link>
    </article>
  );
}
